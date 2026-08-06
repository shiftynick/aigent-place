//! Outbound byte pressure on the live socket path (task-041).
//!
//! ARCHITECTURE section 1 caps a connection's outbound queue at 256 KiB of the
//! bytes that reach its socket, then coalesces. The drain used to size that
//! pressure from a provisional envelope carrying only the 32-byte generation
//! digest while writing the full stub payload, so the guard measured something
//! other than what it sent.
//!
//! The oracle here never restates an expected size: every expectation is either
//! the length of the frame this connection actually received on the wire, or a
//! count derived from that measured length and the documented 256 KiB limit.
//!
//! Scope: these tests judge what a publish charges against what that publish
//! writes. They deliberately do not claim that a connection's queued bytes are
//! everything its socket still owes — the socket task holds its own bounded
//! buffer of already-queued frames, and coalescing replaces the fan-out's
//! replaceable state without withdrawing frames already handed to that buffer.
//! That divergence is filed separately, not asserted here.

use std::collections::BTreeMap;
use std::sync::Arc;
use std::time::Duration;

use aigent_protocol::{
    envelope, handshake_frame, ClientHello, ConnectionRole, Envelope, HandshakeFrame, ServerHello,
    SnapshotResyncReason,
};
use futures_util::{SinkExt, StreamExt};
use prost::Message;
use tokio_tungstenite::tungstenite::Message as WsMessage;
use world_server::{
    decode_placeholder_payload, serve_ephemeral, ImmutableGeneration, LeaseSnapshot, SessionHub,
    TransportState, AOI_HARD_CAP, QUEUE_LIMIT_BYTES, TICK_MS,
};

type Socket =
    tokio_tungstenite::WebSocketStream<tokio_tungstenite::MaybeTlsStream<tokio::net::TcpStream>>;

/// More bodies than the AOI hard cap, so every delivered frame is a full-cap
/// interest set: the size the accounting has to get right.
const CROWD: std::ops::RangeInclusive<u64> = 1..=150;

fn client_hello(role: ConnectionRole, aigent_id: &[u8]) -> Vec<u8> {
    HandshakeFrame {
        body: Some(handshake_frame::Body::ClientHello(ClientHello {
            role: role as i32,
            offered_protocol_majors: vec![1],
            offered_features: vec![],
            aigent_id: aigent_id.to_vec(),
        })),
    }
    .encode_to_vec()
}

async fn start_server() -> (Arc<TransportState>, String) {
    let state = TransportState::new(SessionHub::new_v1());
    let (addr, server) = serve_ephemeral(Arc::clone(&state)).await.expect("bind");
    tokio::spawn(async move {
        let _ = server.await;
    });
    (state, format!("ws://{addr}/ws"))
}

async fn connect(url: &str, role: ConnectionRole, aigent_id: &[u8]) -> (Socket, ServerHello) {
    let (mut ws, _) = tokio_tungstenite::connect_async(url)
        .await
        .expect("connect");
    ws.send(WsMessage::Binary(client_hello(role, aigent_id).into()))
        .await
        .expect("send hello");
    let reply = ws.next().await.expect("reply").expect("stream ok");
    let WsMessage::Binary(bytes) = reply else {
        panic!("expected a binary ServerHello");
    };
    let frame = HandshakeFrame::decode(bytes.as_ref()).expect("handshake frame");
    match frame.body {
        Some(handshake_frame::Body::ServerHello(hello)) => (ws, hello),
        other => panic!("expected ServerHello, got {other:?}"),
    }
}

fn lease(body_id: u64) -> LeaseSnapshot {
    LeaseSnapshot {
        body_id,
        aigent_id: format!("crowd-{body_id}").into_bytes(),
        sequence: 1,
        granted_tick: 1,
        expire_tick: 100_000,
    }
}

fn crowd_generation(tick: u64) -> ImmutableGeneration {
    let mut active_leases = BTreeMap::new();
    for body_id in CROWD {
        active_leases.insert(body_id, lease(body_id));
    }
    ImmutableGeneration {
        generation: tick,
        tick,
        world_value: 0,
        ruleset_generation_id: 1,
        active_leases,
        applied_commands: vec![],
        expired_leases: vec![],
        rng_draws: vec![],
    }
}

fn hard_cap() -> usize {
    AOI_HARD_CAP as usize
}

async fn next_message(ws: &mut Socket) -> WsMessage {
    tokio::time::timeout(Duration::from_secs(5), ws.next())
        .await
        .expect("frame before timeout")
        .expect("stream open")
        .expect("frame ok")
}

/// The next binary frame this socket receives, as raw bytes. Control frames are
/// skipped; the returned length is exactly what the WebSocket carried.
async fn next_binary_frame(ws: &mut Socket) -> Vec<u8> {
    for _ in 0..8 {
        if let WsMessage::Binary(bytes) = next_message(ws).await {
            return bytes.to_vec();
        }
    }
    panic!("no binary frame arrived");
}

/// The socket task only re-reads its pause flag when it loops, so a ping/pong
/// round trip is what makes a pause or resume take effect before the next
/// drain queues anything.
async fn round_trip(ws: &mut Socket) {
    ws.send(WsMessage::Ping(Vec::new().into()))
        .await
        .expect("send ping");
    for _ in 0..8 {
        if matches!(next_message(ws).await, WsMessage::Pong(_)) {
            return;
        }
    }
    panic!("socket task never completed a loop iteration");
}

async fn pause_writer(state: &TransportState, ws: &mut Socket, connection_id: &[u8]) {
    assert!(state.set_outbound_paused(connection_id, true).await);
    round_trip(ws).await;
}

async fn resume_writer(state: &TransportState, ws: &mut Socket, connection_id: &[u8]) {
    assert!(state.set_outbound_paused(connection_id, false).await);
    ws.send(WsMessage::Ping(Vec::new().into()))
        .await
        .expect("send ping");
}

async fn queued_bytes(state: &TransportState, connection_id: &[u8]) -> usize {
    let fanout = state.fanout.lock().await;
    fanout
        .get(connection_id)
        .expect("attached connection")
        .queue
        .queued_bytes()
}

/// Wait until the socket task has reported its write, which is what clears the
/// queue accounting. Without this a later measurement could include a frame the
/// connection no longer owes.
async fn wait_for_empty_queue(state: &TransportState, connection_id: &[u8]) {
    for _ in 0..200 {
        if queued_bytes(state, connection_id).await == 0 {
            return;
        }
        tokio::time::sleep(Duration::from_millis(10)).await;
    }
    panic!("outbound accounting never cleared after the socket wrote its frame");
}

/// Every binary frame already queued for this socket, oldest first.
async fn drain_socket_frames(ws: &mut Socket) -> Vec<Vec<u8>> {
    let mut frames = Vec::new();
    while let Ok(Some(Ok(message))) =
        tokio::time::timeout(Duration::from_millis(300), ws.next()).await
    {
        if let WsMessage::Binary(bytes) = message {
            frames.push(bytes.to_vec());
        }
    }
    frames
}

/// Body ids carried by a state frame, plus whether it was a full snapshot.
fn state_frame_bodies(frame: &[u8]) -> (bool, Vec<u64>) {
    let envelope = Envelope::decode(frame).expect("envelope");
    let (is_full, payload) = match envelope.body {
        Some(envelope::Body::FullSnapshot(full)) => (true, full.payload),
        Some(envelope::Body::SnapshotDelta(delta)) => (false, delta.payload),
        other => panic!("expected a snapshot or delta frame, got {other:?}"),
    };
    let (_tick, _digest, bodies) =
        decode_placeholder_payload(&payload).expect("stub placeholder payload");
    (
        is_full,
        bodies.into_iter().map(|body| body.body_id).collect(),
    )
}

#[tokio::test]
async fn queued_bytes_equal_the_snapshot_frame_the_socket_receives() {
    let (state, url) = start_server().await;
    let (mut viewer, hello) = connect(&url, ConnectionRole::Viewer, b"").await;
    // Hold the writer: the accounting clears as soon as the socket reports the
    // write, so the queue has to be read while it still owes the frame.
    pause_writer(&state, &mut viewer, &hello.connection_id).await;

    let generation = crowd_generation(1);
    assert!(
        generation.active_leases.len() > hard_cap(),
        "the crowd must exceed the hard cap or the per-body undercount is invisible"
    );
    state.publish_generation(generation);
    state.advance_logical_tick();
    let report = state.drain_fanout(None).await;
    assert_eq!(report.delivered, 1, "the viewer should be queued one frame");

    let queued = queued_bytes(&state, &hello.connection_id).await;

    resume_writer(&state, &mut viewer, &hello.connection_id).await;
    let frame = next_binary_frame(&mut viewer).await;
    let (is_full, bodies) = state_frame_bodies(&frame);
    assert!(is_full, "the first observe frame is a full snapshot");
    assert_eq!(
        bodies.len(),
        hard_cap(),
        "the delivered frame must carry a full-cap interest set"
    );
    assert_eq!(
        queued,
        frame.len(),
        "outbound pressure must be charged the bytes the socket actually received"
    );
}

#[tokio::test]
async fn delta_frames_are_charged_their_wire_bytes() {
    let (state, url) = start_server().await;
    let (mut viewer, hello) = connect(&url, ConnectionRole::Viewer, b"").await;

    // Establish a baseline so the next publish is a delta.
    state.publish_generation(crowd_generation(1));
    state.advance_logical_tick();
    assert_eq!(state.drain_fanout(None).await.delivered, 1);
    let (is_full, _) = state_frame_bodies(&next_binary_frame(&mut viewer).await);
    assert!(is_full, "the baseline frame is a full snapshot");
    wait_for_empty_queue(&state, &hello.connection_id).await;

    pause_writer(&state, &mut viewer, &hello.connection_id).await;
    state.publish_generation(crowd_generation(2));
    state.advance_logical_tick();
    assert_eq!(state.drain_fanout(None).await.delivered, 1);
    let queued = queued_bytes(&state, &hello.connection_id).await;

    resume_writer(&state, &mut viewer, &hello.connection_id).await;
    let frame = next_binary_frame(&mut viewer).await;
    let (is_full, bodies) = state_frame_bodies(&frame);
    assert!(!is_full, "an established baseline is followed by a delta");
    assert_eq!(
        bodies.len(),
        hard_cap(),
        "the stub delta carries the whole truncated body set on the wire"
    );
    assert_eq!(
        queued,
        frame.len(),
        "a delta must be charged its encoded frame, not a logical stand-in"
    );
}

#[tokio::test]
async fn paused_writer_reaches_the_coalesce_threshold_on_its_real_frame_bytes() {
    let (state, url) = start_server().await;
    let (mut viewer, hello) = connect(&url, ConnectionRole::Viewer, b"").await;

    // Measure one real frame for this connection before applying any pressure.
    state.publish_generation(crowd_generation(1));
    state.advance_logical_tick();
    assert_eq!(state.drain_fanout(None).await.delivered, 1);
    let frame_bytes = next_binary_frame(&mut viewer).await.len();
    wait_for_empty_queue(&state, &hello.connection_id).await;

    // Derived expectation: how many frames of that size the documented 256 KiB
    // threshold admits before the queue must coalesce.
    let expected_drains = QUEUE_LIMIT_BYTES.div_ceil(frame_bytes);
    assert!(
        expected_drains > 1,
        "one frame must not already exceed the limit, or coalescing proves nothing"
    );

    pause_writer(&state, &mut viewer, &hello.connection_id).await;
    let mut owed = 0usize;
    let mut peak = 0usize;
    let mut coalesced_at = None;
    let mut closed = false;
    for drain in 1..=(expected_drains + 2) {
        state.publish_generation(crowd_generation(1 + drain as u64));
        state.advance_logical_tick();
        let report = state.drain_fanout(None).await;
        closed |= report.closed.iter().any(|id| id == &hello.connection_id);
        let queued = queued_bytes(&state, &hello.connection_id).await;
        // Coalescing replaces the queued state with the newest item, so the
        // owed bytes falling is the observable threshold crossing.
        if queued < owed {
            peak = owed;
            coalesced_at = Some(drain);
            break;
        }
        owed = queued;
    }

    let coalesced_at = coalesced_at.expect(
        "a paused writer must reach the 256 KiB threshold once it is charged the bytes it owes",
    );
    assert!(
        (expected_drains - 1..=expected_drains + 1).contains(&coalesced_at),
        "coalescing happened at drain {coalesced_at}, but {frame_bytes}-byte frames imply \
         drain {expected_drains}"
    );
    assert!(
        peak + frame_bytes > QUEUE_LIMIT_BYTES,
        "the queue must actually reach the threshold before coalescing, not merely shrink"
    );
    assert!(
        peak <= QUEUE_LIMIT_BYTES,
        "coalescing must keep queued state at or under the documented limit"
    );
    assert!(
        !closed,
        "coalescing under the cap must isolate no connection; only sustained over-limit \
         pressure disconnects"
    );
}

#[tokio::test]
async fn coalescing_charges_the_promoted_full_snapshot_it_writes() {
    let (state, url) = start_server().await;
    let (mut viewer, hello) = connect(&url, ConnectionRole::Viewer, b"").await;
    // Paused before the first frame, so the queued full snapshot is still there
    // when coalescing has to drop it and promote the newest delta. That is the
    // branch that charges the promoted frame rather than the delta.
    pause_writer(&state, &mut viewer, &hello.connection_id).await;

    state.publish_generation(crowd_generation(1));
    state.advance_logical_tick();
    assert_eq!(state.drain_fanout(None).await.delivered, 1);
    let first_charge = queued_bytes(&state, &hello.connection_id).await;
    assert!(first_charge > 0, "the baseline frame must be charged");

    let mut owed = first_charge;
    let mut promoted = false;
    for drain in 2..=(QUEUE_LIMIT_BYTES.div_ceil(first_charge) + 2) {
        state.publish_generation(crowd_generation(drain as u64));
        state.advance_logical_tick();
        assert_eq!(state.drain_fanout(None).await.delivered, 1);
        let queued = queued_bytes(&state, &hello.connection_id).await;
        if queued < owed {
            promoted = true;
            break;
        }
        owed = queued;
    }
    assert!(promoted, "the queue must coalesce once it passes the limit");
    let promoted_charge = queued_bytes(&state, &hello.connection_id).await;

    resume_writer(&state, &mut viewer, &hello.connection_id).await;
    let frames = drain_socket_frames(&mut viewer).await;
    assert!(frames.len() >= 2, "the socket owed at least two frames");

    let baseline_frame = frames.first().expect("checked length");
    let (is_full, _) = state_frame_bodies(baseline_frame);
    assert!(is_full, "the oldest queued frame is the baseline snapshot");
    assert_eq!(
        first_charge,
        baseline_frame.len(),
        "the baseline frame must be charged the bytes it puts on the wire"
    );

    let promoted_frame = frames.last().expect("checked length");
    let envelope = Envelope::decode(promoted_frame.as_slice()).expect("envelope");
    let Some(envelope::Body::FullSnapshot(full)) = envelope.body else {
        panic!("a coalesce that drops the queued snapshot must promote to a full snapshot");
    };
    assert!(
        full.baseline_id > 1,
        "the promotion must install a fresh baseline, got {}",
        full.baseline_id
    );
    let (_tick, _digest, bodies) =
        decode_placeholder_payload(&full.payload).expect("stub placeholder payload");
    assert_eq!(
        bodies.len(),
        hard_cap(),
        "the promoted snapshot still carries a full-cap interest set"
    );
    assert_eq!(
        promoted_charge,
        promoted_frame.len(),
        "a promoted full snapshot must be charged the promoted frame it writes"
    );
}

#[tokio::test]
async fn a_resync_notice_is_charged_instead_of_the_delta_it_replaces() {
    let (state, url) = start_server().await;
    let (mut viewer, hello) = connect(&url, ConnectionRole::Viewer, b"").await;

    state.publish_generation(crowd_generation(1));
    state.advance_logical_tick();
    assert_eq!(state.drain_fanout(None).await.delivered, 1);
    let state_frame_bytes = next_binary_frame(&mut viewer).await.len();
    wait_for_empty_queue(&state, &hello.connection_id).await;

    // Lose the baseline the next delta would be built against, which is what
    // makes this publish emit a notice instead of a state payload.
    {
        let mut fanout = state.fanout.lock().await;
        let connection = fanout
            .get_mut(&hello.connection_id)
            .expect("attached connection");
        let baseline = connection.snapshot.baseline_id().expect("live baseline");
        connection.snapshot.expire_baseline(baseline);
    }
    pause_writer(&state, &mut viewer, &hello.connection_id).await;
    state.publish_generation(crowd_generation(2));
    state.advance_logical_tick();
    assert_eq!(state.drain_fanout(None).await.delivered, 1);
    let queued = queued_bytes(&state, &hello.connection_id).await;

    resume_writer(&state, &mut viewer, &hello.connection_id).await;
    let frame = next_binary_frame(&mut viewer).await;
    let envelope = Envelope::decode(frame.as_slice()).expect("envelope");
    let Some(envelope::Body::SnapshotResyncRequired(required)) = envelope.body else {
        panic!("an unusable baseline must answer with a resync-required notice");
    };
    assert_eq!(
        required.reason,
        SnapshotResyncReason::BaselineExpired as i32,
        "the notice must name why the baseline could not carry a delta"
    );
    assert_eq!(
        queued,
        frame.len(),
        "the queue must be charged the notice on the wire, not the delta it replaced"
    );
    assert!(
        queued < state_frame_bytes,
        "a notice carries no payload, so it must cost far less than a state frame"
    );
}

/// A loaded queue must not be answered with a promoted full snapshot when the
/// baseline is unusable: the notice is what goes on the wire, and the charge is
/// the notice. This is also why the ordering rarely changes anything — a notice
/// is small enough that adding it to a queue one frame under the limit does not
/// cross it, so the coalescing branch it now outranks is barely reachable.
#[tokio::test]
async fn an_unusable_baseline_answers_with_a_notice_under_load() {
    let (state, url) = start_server().await;
    let (mut viewer, hello) = connect(&url, ConnectionRole::Viewer, b"").await;
    pause_writer(&state, &mut viewer, &hello.connection_id).await;

    state.publish_generation(crowd_generation(1));
    state.advance_logical_tick();
    assert_eq!(state.drain_fanout(None).await.delivered, 1);
    let first_charge = queued_bytes(&state, &hello.connection_id).await;

    // Fill the queue to just under the threshold, so the next publish is the
    // one that has to coalesce and would otherwise promote its item to a fresh
    // full snapshot.
    let until_threshold = QUEUE_LIMIT_BYTES.div_ceil(first_charge) - 1;
    for tick in 2..=until_threshold as u64 {
        state.publish_generation(crowd_generation(tick));
        state.advance_logical_tick();
        assert_eq!(state.drain_fanout(None).await.delivered, 1);
    }
    let loaded = queued_bytes(&state, &hello.connection_id).await;
    assert!(
        loaded + first_charge > QUEUE_LIMIT_BYTES,
        "the next publish must be the one that crosses the threshold"
    );

    {
        let mut fanout = state.fanout.lock().await;
        let connection = fanout
            .get_mut(&hello.connection_id)
            .expect("attached connection");
        let baseline = connection.snapshot.baseline_id().expect("live baseline");
        connection.snapshot.expire_baseline(baseline);
    }
    state.publish_generation(crowd_generation(until_threshold as u64 + 1));
    state.advance_logical_tick();
    assert_eq!(state.drain_fanout(None).await.delivered, 1);
    let queued = queued_bytes(&state, &hello.connection_id).await;

    resume_writer(&state, &mut viewer, &hello.connection_id).await;
    let frames = drain_socket_frames(&mut viewer).await;
    let last = frames.last().expect("the socket owed frames");
    let envelope = Envelope::decode(last.as_slice()).expect("envelope");
    let Some(envelope::Body::SnapshotResyncRequired(_)) = envelope.body else {
        panic!(
            "an unusable baseline must answer with a notice rather than push a promoted \
             snapshot into a queue that is already at its limit"
        );
    };
    assert_eq!(
        queued - loaded,
        last.len(),
        "a loaded queue must be charged exactly the notice it wrote"
    );
}

#[tokio::test]
async fn production_sizing_drain_does_not_delay_logical_ticks() {
    let (state, url) = start_server().await;
    let mut sockets = Vec::new();
    for index in 0..4u8 {
        let (mut ws, hello) = connect(
            &url,
            ConnectionRole::Aigent,
            format!("stuck-aigent-{index}").as_bytes(),
        )
        .await;
        // Every writer is stuck, so nothing clears and each drain re-encodes a
        // full-cap frame for every connection under the production sizing path.
        pause_writer(&state, &mut ws, &hello.connection_id).await;
        sockets.push(ws);
    }

    let start = state.peek_arrival_tick();
    let ticker = {
        let state = Arc::clone(&state);
        tokio::spawn(async move {
            for _ in 0..40 {
                state.advance_logical_tick();
                tokio::task::yield_now().await;
            }
        })
    };

    // The listen loop awaits this drain between ticks, so the whole serialization
    // stage has to fit inside the tick budget it consumes: DRAINS drains stand
    // for DRAINS ticks of 50 ms. Failing this is a real budget breach, not a
    // slow machine — the work here is a few kilobytes of encoding per pass.
    const DRAINS: u64 = 20;
    let budget = Duration::from_millis(u64::from(TICK_MS) * DRAINS);
    let tick_budget = Duration::from_millis(u64::from(TICK_MS));
    let started = std::time::Instant::now();
    let mut worst = Duration::ZERO;
    let mut over_budget = 0usize;
    for tick in 1..=DRAINS {
        state.publish_generation(crowd_generation(tick));
        let pass = std::time::Instant::now();
        let _ = state.drain_fanout(None).await;
        let took = pass.elapsed();
        worst = worst.max(took);
        if took >= tick_budget {
            over_budget += 1;
        }
    }
    let elapsed = started.elapsed();
    ticker.await.expect("ticker");

    assert!(
        elapsed < budget,
        "sizing real frames for {} stuck writers took {elapsed:?} over {DRAINS} drains, \
         beyond the {budget:?} of tick budget those drains represent (worst pass {worst:?})",
        sockets.len()
    );
    // One pass may lose its slice to the OS; more than one means the drain
    // itself no longer fits the tick it is spending, which would make the
    // listen loop skip ticks.
    assert!(
        over_budget <= 1,
        "{over_budget} of {DRAINS} drains reached the {tick_budget:?} tick budget \
         (worst pass {worst:?})"
    );
    assert!(
        state.peek_arrival_tick() >= start + 40,
        "logical ticks must keep advancing while the drain encodes for stuck writers"
    );
}
