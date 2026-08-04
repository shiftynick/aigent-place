//! WebSocket listen path bridging sockets into [`SessionHub`] (ADR-0010).
//!
//! The Tokio/axum runtime owns accept and per-connection I/O. Session mutations
//! run under a short mutex; the simulation tick is not awaited here.
//!
//! Local demo bind: `ws://127.0.0.1:<port>/ws` (see README / binary `--listen`).
//! Trusted-inject demo identity is loopback-only unless `--listen-any` is set.

use crate::session::{
    ClientHello, CommandSubmit, ConnectionMode, ConnectionRole, FeatureOffer, HandshakeOutcome,
    IdentityBinding, SessionHub,
};
use aigent_protocol::{
    envelope, handshake_frame, CommandKind, ConnectionMode as ProtoMode,
    ConnectionRole as ProtoRole, Envelope, FeatureSelection, HandshakeFrame, HandshakeReject,
    ProtocolErrorCode, ServerHello,
};
use axum::extract::ws::{Message, WebSocket};
use axum::extract::{ConnectInfo, State, WebSocketUpgrade};
use axum::response::IntoResponse;
use axum::routing::get;
use axum::Router;
use futures_util::{SinkExt, StreamExt};
use prost::Message as ProstMessage;
use std::collections::HashMap;
use std::net::SocketAddr;
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::Arc;
use tokio::net::TcpListener;
use tokio::sync::{watch, Mutex};

#[derive(Debug)]
struct LiveSocket {
    close_tx: watch::Sender<bool>,
}

/// Shared transport state. Demo identity uses trusted inject (not production auth).
#[derive(Debug)]
pub struct TransportState {
    pub sessions: Mutex<SessionHub>,
    /// Logical next arrival tick (simulation-facing counter; not a frame counter).
    pub next_arrival_tick: AtomicU64,
    /// Stamps applied to admitted mutating commands (test/observe).
    pub stamped_arrivals: Mutex<Vec<(Vec<u8>, u64)>>,
    connection_seq: AtomicU64,
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
            next_arrival_tick: AtomicU64::new(1),
            stamped_arrivals: Mutex::new(Vec::new()),
            connection_seq: AtomicU64::new(1),
            sockets: Mutex::new(HashMap::new()),
            allow_non_loopback: AtomicBool::new(allow_non_loopback),
        })
    }

    fn mint_connection_id(&self) -> Vec<u8> {
        let seq = self.connection_seq.fetch_add(1, Ordering::Relaxed);
        format!("conn-{seq}").into_bytes()
    }

    /// Current logical arrival tick without consuming it.
    pub fn peek_arrival_tick(&self) -> u64 {
        self.next_arrival_tick.load(Ordering::Relaxed)
    }

    /// Advance the logical tick (sim stage / tests).
    pub fn advance_logical_tick(&self) -> u64 {
        self.next_arrival_tick.fetch_add(1, Ordering::Relaxed)
    }
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
            }
            {
                let mut sockets = state.sockets.lock().await;
                sockets.insert(
                    connection_id.clone(),
                    LiveSocket {
                        close_tx: close_tx.clone(),
                    },
                );
            }
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
                let mut sockets = state.sockets.lock().await;
                sockets.remove(&connection_id);
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
            let mut sockets = state.sockets.lock().await;
            sockets.remove(&connection_id);
        }
        HandshakeOutcome::Rejected { code } => {
            let reject = encode_reject(code);
            let _ = socket.send(Message::Binary(reject.into())).await;
            let _ = socket.close().await;
        }
    }
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
        // Non-command post-handshake bodies are ignored for task-033; wrong-direction
        // command path is rejected by closing when required fields are absent above.
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
    {
        let mut hub = state.sessions.lock().await;
        let _ = hub.submit_command(submit);
    }
    state
        .stamped_arrivals
        .lock()
        .await
        .push((connection_id.to_vec(), arrival_tick));
    true
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

    // SessionHub FeatureOffer carries one version; choose the client's max
    // supported version per feature_id (intersection lives in SessionHub).
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
