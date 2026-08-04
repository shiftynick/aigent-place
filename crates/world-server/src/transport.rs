//! WebSocket listen + outbound fan-out drain (ADR-0010, task-033/034).
//!
//! Tokio/axum owns accept and per-connection I/O. Simulation publishes into
//! [`PublicationMailbox`] without waiting; [`TransportState::drain_fanout`]
//! encodes observe traffic and `try_send`s onto bounded per-connection
//! channels. Slow clients fill those channels and are isolated via outbound
//! overflow observation — the drain path never awaits a socket write.

use crate::fanout::{PublicationMailbox, PublishOutcome, SnapshotFanout};
use crate::generation::ImmutableGeneration;
use crate::outbound::{ObserveOutcome, QUEUE_LIMIT_BYTES};
use crate::session::{
    AuthoritativeResult, ClientHello, CommandOutcome, CommandSubmit, ConnectionMode,
    ConnectionRole, FeatureOffer, HandshakeOutcome, IdentityBinding, SessionHub,
};
use crate::snapshot::StubSnapshotPayload;
use aigent_protocol::{
    command_result, envelope, handshake_frame, CommandAccepted, CommandKind, CommandRejected,
    CommandResult, ConnectionMode as ProtoMode, ConnectionRole as ProtoRole, Envelope,
    FeatureSelection, FullSnapshot, HandshakeFrame, HandshakeReject, ProtocolError,
    ProtocolErrorCode, ServerHello, SnapshotDelta, SnapshotResyncRequired,
};
use axum::extract::ws::{Message, WebSocket};
use axum::extract::{ConnectInfo, State, WebSocketUpgrade};
use axum::response::IntoResponse;
use axum::routing::get;
use axum::Router;
use bytes::Bytes;
use futures_util::{SinkExt, StreamExt};
use prost::Message as ProstMessage;
use std::collections::HashMap;
use std::net::SocketAddr;
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::Arc;
use tokio::net::TcpListener;
use tokio::sync::{mpsc, watch, Mutex};

const OUTBOUND_CHANNEL_CAP: usize = 8;

#[derive(Debug)]
struct LiveSocket {
    close_tx: watch::Sender<bool>,
    outbound_tx: mpsc::Sender<Bytes>,
    /// When true, the socket task stops pumping outbound frames (stuck writer).
    outbound_paused: Arc<AtomicBool>,
    /// Frames that could not enter the bounded channel (bounded; never silent-grow).
    pending: std::sync::Mutex<std::collections::VecDeque<Bytes>>,
    /// Frames accepted into channel or pending but not yet written to the socket.
    inflight: AtomicU64,
}

/// Shared transport state. Demo identity uses trusted inject (not production auth).
#[derive(Debug)]
pub struct TransportState {
    pub sessions: Mutex<SessionHub>,
    pub fanout: Mutex<SnapshotFanout>,
    pub mailbox: PublicationMailbox,
    /// Logical next arrival tick (simulation-facing counter; not a frame counter).
    pub next_arrival_tick: AtomicU64,
    /// Stamps applied to admitted mutating commands (test/observe).
    pub stamped_arrivals: Mutex<Vec<(Vec<u8>, u64)>>,
    connection_seq: AtomicU64,
    server_message_seq: AtomicU64,
    sockets: Mutex<HashMap<Vec<u8>, LiveSocket>>,
    /// When false, refuse non-loopback peer addresses for trusted-inject demo.
    allow_non_loopback: AtomicBool,
}

impl TransportState {
    #[must_use]
    pub fn new(hub: SessionHub) -> Arc<Self> {
        Self::new_with_options(hub, false)
    }

    #[must_use]
    pub fn new_with_options(hub: SessionHub, allow_non_loopback: bool) -> Arc<Self> {
        Arc::new(Self {
            sessions: Mutex::new(hub),
            fanout: Mutex::new(SnapshotFanout::new()),
            mailbox: PublicationMailbox::new(),
            next_arrival_tick: AtomicU64::new(1),
            stamped_arrivals: Mutex::new(Vec::new()),
            connection_seq: AtomicU64::new(1),
            server_message_seq: AtomicU64::new(1),
            sockets: Mutex::new(HashMap::new()),
            allow_non_loopback: AtomicBool::new(allow_non_loopback),
        })
    }

    fn mint_connection_id(&self) -> Vec<u8> {
        let seq = self.connection_seq.fetch_add(1, Ordering::Relaxed);
        format!("conn-{seq}").into_bytes()
    }

    fn next_server_message_id(&self) -> u64 {
        self.server_message_seq.fetch_add(1, Ordering::Relaxed)
    }

    /// Current logical arrival tick without consuming it.
    pub fn peek_arrival_tick(&self) -> u64 {
        self.next_arrival_tick.load(Ordering::Relaxed)
    }

    /// Advance the logical tick (sim stage / tests).
    pub fn advance_logical_tick(&self) -> u64 {
        self.next_arrival_tick.fetch_add(1, Ordering::Relaxed)
    }

    /// Pause or resume the outbound pump for a connection (test / stuck-writer).
    pub async fn set_outbound_paused(&self, connection_id: &[u8], paused: bool) -> bool {
        let sockets = self.sockets.lock().await;
        if let Some(live) = sockets.get(connection_id) {
            live.outbound_paused.store(paused, Ordering::Relaxed);
            true
        } else {
            false
        }
    }

    /// Non-blocking publish from the simulation stage.
    pub fn publish_generation(&self, generation: ImmutableGeneration) {
        self.mailbox.publish_from_tick(generation);
    }

    /// Serialization-stage drain: observe prior undrained pressure, then encode
    /// observe traffic and try_send to sockets. Close only slow connections.
    /// Never awaits I/O. Queue byte accounting clears only after the socket
    /// task reports a send via [`Self::note_frame_sent`], so healthy writers
    /// that clear between ticks stay under the overflow window.
    pub async fn drain_fanout(&self, encoded_bytes: Option<usize>) -> DrainReport {
        // Observe first: pressure is from frames not yet written (and therefore
        // not yet cleared by note_frame_sent), not from this pass's enqueue.
        let mut report = self.observe_only().await;
        let Some(generation) = self.mailbox.take() else {
            return report;
        };
        let ids: Vec<Vec<u8>> = {
            let fanout = self.fanout.lock().await;
            fanout.connection_ids()
        };
        let mut delivered = 0usize;
        for connection_id in ids {
            if report.closed.iter().any(|id| id == &connection_id) {
                continue;
            }
            self.flush_pending(&connection_id).await;
            let payload = StubSnapshotPayload::from_generation(&generation);
            let provisional = encode_envelope(
                &connection_id,
                self.next_server_message_id(),
                envelope::Body::FullSnapshot(FullSnapshot {
                    baseline_id: 0,
                    payload: payload.digest.to_vec(),
                }),
            );
            let size = encoded_bytes.unwrap_or(provisional.len());
            let outcome = {
                let mut fanout = self.fanout.lock().await;
                fanout.publish_to(&connection_id, &generation, Some(size))
            };
            let Some(outcome) = outcome else {
                continue;
            };
            if matches!(outcome, PublishOutcome::ConnectionClosed) {
                continue;
            }
            let frames = {
                let fanout = self.fanout.lock().await;
                encode_publish_frames(
                    &connection_id,
                    self.next_server_message_id(),
                    &outcome,
                    fanout
                        .get(&connection_id)
                        .and_then(|c| c.snapshot.last_payload()),
                )
            };
            for frame in frames {
                if self.try_deliver(&connection_id, Bytes::from(frame)).await {
                    delivered += 1;
                }
            }
        }
        report.delivered = delivered;
        report
    }

    async fn observe_only(&self) -> DrainReport {
        let tick = self.peek_arrival_tick();
        let mut closed = Vec::new();
        let observe = {
            let mut fanout = self.fanout.lock().await;
            fanout.observe_all_at(tick)
        };
        for (connection_id, outcome) in observe {
            if matches!(outcome, ObserveOutcome::Closed { .. }) {
                closed.push(connection_id.clone());
                let sockets = self.sockets.lock().await;
                if let Some(live) = sockets.get(&connection_id) {
                    let _ = live.close_tx.send(true);
                }
            }
        }
        DrainReport {
            delivered: 0,
            closed,
        }
    }

    /// Called by the socket task after a successful WebSocket write.
    /// Accounting clears only when no frames remain in channel or pending.
    pub async fn note_frame_sent(&self, connection_id: &[u8]) {
        {
            let sockets = self.sockets.lock().await;
            let Some(live) = sockets.get(connection_id) else {
                return;
            };
            live.inflight.fetch_sub(1, Ordering::AcqRel);
            // Hold sockets across the zero-check and drain so try_deliver cannot
            // admit another frame that would then be cleared incorrectly.
            if live.inflight.load(Ordering::Acquire) == 0 {
                let mut fanout = self.fanout.lock().await;
                if let Some(connection) = fanout.get_mut(connection_id) {
                    connection.queue.drain_all();
                }
            }
        }
        self.flush_pending(connection_id).await;
    }

    async fn flush_pending(&self, connection_id: &[u8]) {
        let sockets = self.sockets.lock().await;
        let Some(live) = sockets.get(connection_id) else {
            return;
        };
        let mut pending = live
            .pending
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner);
        while let Some(frame) = pending.pop_front() {
            match live.outbound_tx.try_send(frame.clone()) {
                Ok(()) => {}
                Err(_) => {
                    pending.push_front(frame);
                    break;
                }
            }
        }
    }

    /// Deliver one frame without awaiting. Returns true if accepted by the channel
    /// or buffered in the bounded pending deque. When pending is full, the oldest
    /// pending frame is evicted so the newest (especially command results) is kept.
    /// Snapshot byte-cap accounting stays in the fan-out publish path; command
    /// results must call [`OutboundQueue::enqueue_event`] before this.
    async fn try_deliver(&self, connection_id: &[u8], frame: Bytes) -> bool {
        let sockets = self.sockets.lock().await;
        let Some(live) = sockets.get(connection_id) else {
            return false;
        };
        match live.outbound_tx.try_send(frame.clone()) {
            Ok(()) => {
                live.inflight.fetch_add(1, Ordering::AcqRel);
                true
            }
            Err(_) => {
                let mut pending = live
                    .pending
                    .lock()
                    .unwrap_or_else(std::sync::PoisonError::into_inner);
                if pending.len() >= OUTBOUND_CHANNEL_CAP {
                    // Evict oldest undelivered frame; keep newest. Inflight count
                    // unchanged (one out, one in).
                    let _ = pending.pop_front();
                    pending.push_back(frame);
                } else {
                    pending.push_back(frame);
                    live.inflight.fetch_add(1, Ordering::AcqRel);
                }
                true
            }
        }
    }
}

/// Summary of one non-blocking drain pass.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct DrainReport {
    pub delivered: usize,
    pub closed: Vec<Vec<u8>>,
}

/// Bind `addr` and serve the WebSocket upgrade route forever.
pub async fn serve(addr: SocketAddr, state: Arc<TransportState>) -> Result<(), std::io::Error> {
    let listener = TcpListener::bind(addr).await?;
    let app = router(state);
    axum::serve(
        listener,
        app.into_make_service_with_connect_info::<SocketAddr>(),
    )
    .await
}

/// Bind an ephemeral local port and return `(bound_addr, server_future)`.
pub async fn serve_ephemeral(
    state: Arc<TransportState>,
) -> Result<
    (
        SocketAddr,
        impl std::future::Future<Output = Result<(), std::io::Error>>,
    ),
    std::io::Error,
> {
    let listener = TcpListener::bind(SocketAddr::from(([127, 0, 0, 1], 0))).await?;
    let addr = listener.local_addr()?;
    let app = router(state);
    Ok((addr, async move {
        axum::serve(
            listener,
            app.into_make_service_with_connect_info::<SocketAddr>(),
        )
        .await
    }))
}

fn router(state: Arc<TransportState>) -> Router {
    Router::new()
        .route("/ws", get(ws_handler))
        .with_state(state)
}

async fn ws_handler(
    ws: WebSocketUpgrade,
    State(state): State<Arc<TransportState>>,
    ConnectInfo(peer): ConnectInfo<SocketAddr>,
) -> impl IntoResponse {
    ws.on_upgrade(move |socket| handle_socket(socket, state, peer))
}

async fn handle_socket(mut socket: WebSocket, state: Arc<TransportState>, peer: SocketAddr) {
    if !state.allow_non_loopback.load(Ordering::Relaxed) && !peer.ip().is_loopback() {
        let reject = encode_reject(ProtocolErrorCode::InvalidEnvelope);
        let _ = socket.send(Message::Binary(reject.into())).await;
        let _ = socket.close().await;
        return;
    }

    let Some(Ok(Message::Binary(first))) = socket.next().await else {
        let _ = socket.close().await;
        return;
    };

    let frame = match HandshakeFrame::decode(first.as_ref()) {
        Ok(frame) => frame,
        Err(_) => {
            let reject = encode_reject(ProtocolErrorCode::InvalidEnvelope);
            let _ = socket.send(Message::Binary(reject.into())).await;
            let _ = socket.close().await;
            return;
        }
    };

    let Some(handshake_frame::Body::ClientHello(wire_hello)) = frame.body else {
        let reject = encode_reject(ProtocolErrorCode::InvalidEnvelope);
        let _ = socket.send(Message::Binary(reject.into())).await;
        let _ = socket.close().await;
        return;
    };

    let connection_id = state.mint_connection_id();
    let semantic = match wire_to_semantic_hello(wire_hello, connection_id.clone()) {
        Ok(hello) => hello,
        Err(code) => {
            let reject = encode_reject(code);
            let _ = socket.send(Message::Binary(reject.into())).await;
            let _ = socket.close().await;
            return;
        }
    };
    let role = semantic.role;

    let outcome = {
        let mut hub = state.sessions.lock().await;
        hub.handshake(semantic)
    };

    let (close_tx, mut close_rx) = watch::channel(false);
    let (outbound_tx, mut outbound_rx) = mpsc::channel::<Bytes>(OUTBOUND_CHANNEL_CAP);
    match outcome {
        HandshakeOutcome::Accepted {
            mode,
            protocol_major,
            connection_id,
            session_epoch,
            features,
            upgrade_required,
            displaced,
        } => {
            if let Some(notice) = displaced {
                let mut sockets = state.sockets.lock().await;
                if let Some(previous) = sockets.remove(&notice.replaced_connection_id) {
                    let _ = previous.close_tx.send(true);
                }
                let mut fanout = state.fanout.lock().await;
                // Keep fanout entry until the old socket exits; new attach below.
                let _ = fanout.get_mut(&notice.replaced_connection_id);
            }
            {
                let mut fanout = state.fanout.lock().await;
                fanout.attach(connection_id.clone());
                if let Some(connection) = fanout.get_mut(&connection_id) {
                    connection.role = role;
                }
            }
            {
                let mut sockets = state.sockets.lock().await;
                sockets.insert(
                    connection_id.clone(),
                    LiveSocket {
                        close_tx: close_tx.clone(),
                        outbound_tx,
                        outbound_paused: Arc::new(AtomicBool::new(false)),
                        pending: std::sync::Mutex::new(std::collections::VecDeque::new()),
                        inflight: AtomicU64::new(0),
                    },
                );
            }
            let outbound_paused = {
                let sockets = state.sockets.lock().await;
                sockets
                    .get(&connection_id)
                    .expect("just inserted")
                    .outbound_paused
                    .clone()
            };
            let hello = ServerHello {
                connection_id: connection_id.clone(),
                selected_protocol_major: protocol_major,
                role: role_to_proto(role),
                mode: mode_to_proto(mode),
                selected_features: features
                    .iter()
                    .map(|feature| FeatureSelection {
                        feature_id: feature.feature_id.clone(),
                        selected_version: feature.version,
                    })
                    .collect(),
                session_epoch: session_epoch.unwrap_or_default(),
                upgrade_notice: if upgrade_required {
                    Some(aigent_protocol::UpgradeNotice {
                        code: ProtocolErrorCode::UpgradeRequired as i32,
                        message: "upgrade required".into(),
                        compatibility: vec![],
                    })
                } else {
                    None
                },
                deprecation_notice: None,
            };
            let bytes = HandshakeFrame {
                body: Some(handshake_frame::Body::ServerHello(hello)),
            }
            .encode_to_vec();
            if socket.send(Message::Binary(bytes.into())).await.is_err() {
                cleanup_connection(&state, &connection_id).await;
                return;
            }

            loop {
                tokio::select! {
                    _ = close_rx.changed() => {
                        if *close_rx.borrow() {
                            let _ = socket.close().await;
                            break;
                        }
                    }
                    outbound = outbound_rx.recv(), if !outbound_paused.load(Ordering::Relaxed) => {
                        match outbound {
                            Some(frame) => {
                                if socket.send(Message::Binary(frame)).await.is_err() {
                                    break;
                                }
                                state.note_frame_sent(&connection_id).await;
                            }
                            None => break,
                        }
                    }
                    message = socket.next() => {
                        let Some(message) = message else { break; };
                        let Ok(message) = message else { break; };
                        match message {
                            Message::Binary(payload) => {
                                if !handle_post_handshake_binary(&state, &connection_id, payload.as_ref()).await {
                                    let _ = socket.close().await;
                                    break;
                                }
                            }
                            Message::Close(_) => break,
                            Message::Ping(payload) => {
                                let _ = socket.send(Message::Pong(payload)).await;
                            }
                            Message::Pong(_) | Message::Text(_) => {}
                        }
                    }
                }
            }
            cleanup_connection(&state, &connection_id).await;
        }
        HandshakeOutcome::Rejected { code } => {
            let reject = encode_reject(code);
            let _ = socket.send(Message::Binary(reject.into())).await;
            let _ = socket.close().await;
        }
    }
}

async fn cleanup_connection(state: &TransportState, connection_id: &[u8]) {
    let mut sockets = state.sockets.lock().await;
    sockets.remove(connection_id);
    let mut fanout = state.fanout.lock().await;
    // Leave closed queues for observe tests; drop attachment on exit.
    fanout.detach(connection_id);
}

/// Returns false when the connection must close.
async fn handle_post_handshake_binary(
    state: &TransportState,
    connection_id: &[u8],
    payload: &[u8],
) -> bool {
    let envelope = match Envelope::decode(payload) {
        Ok(envelope) => envelope,
        Err(_) => return false,
    };
    if envelope.protocol_major == 0
        || envelope.connection_id.is_empty()
        || envelope.message_id == 0
        || envelope.body.is_none()
    {
        return false;
    }
    let Some(envelope::Body::Command(command)) = envelope.body else {
        return true;
    };
    let arrival_tick = state.peek_arrival_tick();
    let submit = CommandSubmit {
        connection_id: connection_id.to_vec(),
        protocol_major: envelope.protocol_major,
        message_id: envelope.message_id,
        session_epoch: command
            .metadata
            .as_ref()
            .map(|meta| meta.session_epoch.clone())
            .unwrap_or_default(),
        sequence: command
            .metadata
            .as_ref()
            .map(|meta| meta.sequence)
            .unwrap_or(0),
        idempotency_key: command
            .metadata
            .as_ref()
            .map(|meta| meta.idempotency_key.clone())
            .unwrap_or_default(),
        kind: CommandKind::try_from(command.kind).unwrap_or(CommandKind::Unspecified),
        content_digest: {
            use sha2::{Digest, Sha256};
            Sha256::digest(&command.payload).to_vec()
        },
        required_features: envelope
            .metadata
            .map(|meta| {
                meta.required_features
                    .into_iter()
                    .map(|feature| FeatureOffer {
                        feature_id: feature.feature_id,
                        version: feature.version,
                    })
                    .collect()
            })
            .unwrap_or_default(),
    };
    let outcome = {
        let mut hub = state.sessions.lock().await;
        hub.submit_command(submit)
    };
    state
        .stamped_arrivals
        .lock()
        .await
        .push((connection_id.to_vec(), arrival_tick));

    if let Some(frame) =
        encode_command_outcome(connection_id, state.next_server_message_id(), &outcome)
    {
        let frame = Bytes::from(frame);
        {
            let mut fanout = state.fanout.lock().await;
            if let Some(connection) = fanout.get_mut(connection_id) {
                let _ = connection.queue.enqueue_event(frame.len());
            }
        }
        let _ = state.try_deliver(connection_id, frame).await;
    }
    true
}

fn encode_publish_frames(
    connection_id: &[u8],
    message_id: u64,
    outcome: &PublishOutcome,
    last_payload: Option<&StubSnapshotPayload>,
) -> Vec<Vec<u8>> {
    match outcome {
        PublishOutcome::FullSnapshot { baseline_id, .. } => {
            let digest = last_payload
                .map(|payload| payload.digest.to_vec())
                .unwrap_or_else(|| vec![0; 32]);
            vec![encode_envelope(
                connection_id,
                message_id,
                envelope::Body::FullSnapshot(FullSnapshot {
                    baseline_id: *baseline_id,
                    payload: digest,
                }),
            )]
        }
        PublishOutcome::Delta { baseline_id, .. } => {
            let digest = last_payload
                .map(|payload| payload.digest.to_vec())
                .unwrap_or_else(|| b"delta".to_vec());
            vec![encode_envelope(
                connection_id,
                message_id,
                envelope::Body::SnapshotDelta(SnapshotDelta {
                    baseline_id: *baseline_id,
                    payload: digest,
                }),
            )]
        }
        PublishOutcome::ResyncRequired { required, .. } => vec![encode_envelope(
            connection_id,
            message_id,
            envelope::Body::SnapshotResyncRequired(SnapshotResyncRequired {
                reason: required.reason as i32,
                baseline_id: required.requested_baseline_id,
            }),
        )],
        PublishOutcome::ConnectionClosed => Vec::new(),
    }
}

fn encode_command_outcome(
    connection_id: &[u8],
    message_id: u64,
    outcome: &CommandOutcome,
) -> Option<Vec<u8>> {
    match outcome {
        CommandOutcome::Result {
            command_message_id,
            sequence,
            idempotency_key,
            result,
            ..
        } => {
            let body = match result {
                AuthoritativeResult::Accepted { .. } => {
                    command_result::Outcome::Accepted(CommandAccepted {
                        affected_entities: vec![],
                        payload: vec![],
                        affected_world_entities: vec![],
                    })
                }
                AuthoritativeResult::Rejected { code } => {
                    command_result::Outcome::Rejected(CommandRejected {
                        code: *code as i32,
                        message: format!("{code:?}"),
                        payload: vec![],
                    })
                }
            };
            Some(encode_envelope(
                connection_id,
                message_id,
                envelope::Body::CommandResult(CommandResult {
                    command_message_id: *command_message_id,
                    sequence: *sequence,
                    idempotency_key: idempotency_key.clone(),
                    outcome: Some(body),
                }),
            ))
        }
        CommandOutcome::ProtocolError {
            code,
            related_message_id,
        } => Some(encode_envelope(
            connection_id,
            message_id,
            envelope::Body::ProtocolError(ProtocolError {
                related_message_id: *related_message_id,
                code: *code as i32,
                message: format!("{code:?}"),
                retry_after_ticks: None,
            }),
        )),
    }
}

fn encode_envelope(connection_id: &[u8], message_id: u64, body: envelope::Body) -> Vec<u8> {
    Envelope {
        protocol_major: 1,
        connection_id: connection_id.to_vec(),
        message_id,
        metadata: None,
        body: Some(body),
    }
    .encode_to_vec()
}

fn wire_to_semantic_hello(
    wire: aigent_protocol::ClientHello,
    connection_id: Vec<u8>,
) -> Result<ClientHello, ProtocolErrorCode> {
    let role = match ProtoRole::try_from(wire.role) {
        Ok(ProtoRole::Aigent) => ConnectionRole::Aigent,
        Ok(ProtoRole::Viewer) => ConnectionRole::Viewer,
        _ => return Err(ProtocolErrorCode::InvalidEnvelope),
    };
    let aigent_id = if wire.aigent_id.is_empty() {
        None
    } else {
        Some(wire.aigent_id.clone())
    };
    if role == ConnectionRole::Aigent && aigent_id.is_none() {
        return Err(ProtocolErrorCode::InvalidEnvelope);
    }
    if role == ConnectionRole::Viewer && aigent_id.is_some() {
        return Err(ProtocolErrorCode::InvalidEnvelope);
    }

    let identity = match role {
        ConnectionRole::Aigent => IdentityBinding::TestTrustedInject {
            aigent_id: aigent_id.clone().expect("checked"),
        },
        ConnectionRole::Viewer => IdentityBinding::TestTrustedInject {
            aigent_id: b"viewer".to_vec(),
        },
    };

    let mut offered_features = Vec::new();
    for feature in wire.offered_features {
        let version = feature
            .supported_versions
            .iter()
            .copied()
            .max()
            .unwrap_or(0);
        if version == 0 {
            continue;
        }
        offered_features.push(FeatureOffer {
            feature_id: feature.feature_id,
            version,
        });
    }

    Ok(ClientHello {
        role,
        offered_majors: wire.offered_protocol_majors,
        offered_features,
        aigent_id,
        connection_id,
        identity,
    })
}

fn encode_reject(code: ProtocolErrorCode) -> Vec<u8> {
    HandshakeFrame {
        body: Some(handshake_frame::Body::HandshakeReject(HandshakeReject {
            code: code as i32,
            message: format!("{code:?}"),
            compatibility: vec![],
        })),
    }
    .encode_to_vec()
}

fn mode_to_proto(mode: ConnectionMode) -> i32 {
    match mode {
        ConnectionMode::CommandCapable => ProtoMode::CommandCapable as i32,
        ConnectionMode::SpectateOnly => ProtoMode::SpectateOnly as i32,
    }
}

fn role_to_proto(role: ConnectionRole) -> i32 {
    match role {
        ConnectionRole::Aigent => ProtoRole::Aigent as i32,
        ConnectionRole::Viewer => ProtoRole::Viewer as i32,
    }
}

/// Test helper: queue capacity used by transport outbound channels.
#[must_use]
pub fn outbound_channel_cap() -> usize {
    OUTBOUND_CHANNEL_CAP
}

/// Test helper: protocol queue byte limit.
#[must_use]
pub fn outbound_queue_limit_bytes() -> usize {
    QUEUE_LIMIT_BYTES
}
