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
//! The live FIFO retains the same encoded frames it charges. Coalescing
//! withdraws pending state, and active writes remain charged until completion.

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
    decode_world_snapshot_body_ids, serve_ephemeral, ImmutableGeneration, LeaseSnapshot,
    SessionHub, TransportState, AOI_HARD_CAP, FIRST_ENTITY_ID, QUEUE_LIMIT_BYTES, TICK_MS,
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
        target_x_mm: 0,
        target_z_mm: 0,
        speed_mm_per_s: 1_000,
        consecutive_no_progress_ticks: 0,
    }
}

fn crowd_generation(tick: u64) -> ImmutableGeneration {
    crowd_generation_with_offset(tick, 0)
}

fn crowd_generation_with_offset(tick: u64, revision_offset: u64) -> ImmutableGeneration {
    let mut active_leases = BTreeMap::new();
    let mut entities = BTreeMap::new();
    for body_id in CROWD {
        let l = lease(body_id);
        // Place the entity at the placeholder pose so the AOI rank still
        // selects the same set as the legacy lease-based fixture.
        let placeholder = world_server::placeholder_body_from_lease(&l);
        let position = world_server::Position::new(
            placeholder.x_mm as f64 / 1000.0,
            placeholder.y_mm as f64 / 1000.0,
            placeholder.z_mm as f64 / 1000.0,
        )
        .expect("placeholder position is within world bounds");
        entities.insert(
            body_id,
            world_server::EntitySnapshot {
                entity_id: body_id,
                revision: 1 + revision_offset,
                position,
                shape: None,
            },
        );
        active_leases.insert(body_id, l);
    }
    ImmutableGeneration {
        generation: tick,
        tick,
        world_value: 0,
        ruleset_generation_id: 1,
        active_leases,
        aigent_bodies: Default::default(),
        applied_commands: vec![],
        expired_leases: vec![],
        lease_terminations: vec![],
        rng_draws: vec![],
        entities,
        next_entity_id: FIRST_ENTITY_ID,
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
/// Delta frames carry only the explicit `left_ids` set; the test assertions
/// use this to verify the size accounting, not the full body list.
fn state_frame_bodies(frame: &[u8]) -> (bool, Vec<u64>) {
    let envelope = Envelope::decode(frame).expect("envelope");
    let (is_full, payload) = match envelope.body {
        Some(envelope::Body::FullSnapshot(full)) => (true, full.payload),
        Some(envelope::Body::SnapshotDelta(delta)) => (false, delta.payload),
        other => panic!("expected a snapshot or delta frame, got {other:?}"),
    };
    if is_full {
        let bodies = decode_world_snapshot_body_ids(&payload).expect("real-body snapshot payload");
        (true, bodies)
    } else {
        use prost::Message;
        let proto = aigent_protocol::WorldSnapshotDeltaProto::decode(payload.as_slice())
            .expect("real-body delta payload");
        (false, proto.left_ids)
    }
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
    let (is_full, _bodies) = state_frame_bodies(&frame);
    assert!(!is_full, "an established baseline is followed by a delta");
    // The real-body delta carries only the explicit enter/leave records; the
    // prior full set is recoverable by the receiver from the baseline plus
    // the delta. The accounting assertion is the load-bearing one: queued
    // bytes must equal the frame the socket actually receives.
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
    let mut last_frame_bytes = frame_bytes;
    for drain in 1..=(expected_drains * 3 + 2) {
        let mut g = crowd_generation_with_offset(1 + drain as u64, drain as u64);
        for entity in g.entities.values_mut() {
            entity.revision = entity.revision.saturating_add(1);
        }
        state.publish_generation(g);
        state.advance_logical_tick();
        let report = state.drain_fanout(None).await;
        closed |= report.closed.iter().any(|id| id == &hello.connection_id);
        let queued = queued_bytes(&state, &hello.connection_id).await;
        if queued < owed {
            peak = owed;
            coalesced_at = Some(drain);
            break;
        }
        last_frame_bytes = queued.saturating_sub(owed).max(0);
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
        peak + last_frame_bytes > QUEUE_LIMIT_BYTES,
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
    for drain in 2..=(QUEUE_LIMIT_BYTES.div_ceil(first_charge) * 3 + 10) {
        let mut g = crowd_generation_with_offset(drain as u64, drain as u64 - 1);
        for entity in g.entities.values_mut() {
            entity.revision = entity.revision.saturating_add(1);
        }
        state.publish_generation(g);
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
    assert_eq!(frames.len(), 1, "only the promoted full snapshot remains");

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
    let bodies = decode_world_snapshot_body_ids(&full.payload).expect("real-body snapshot payload");
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
    // The new real-body delta is bigger than the placeholder full snapshot,
    // so the queue may coalesce mid-loop. We just need the queue to be
    // non-empty by the time we expire the baseline; the next publish will
    // notice either way.
    let until_threshold = QUEUE_LIMIT_BYTES.div_ceil(first_charge) * 3 - 1;
    for tick in 2..=until_threshold as u64 {
        let mut g = crowd_generation_with_offset(tick, tick - 1);
        for entity in g.entities.values_mut() {
            entity.revision = entity.revision.saturating_add(1);
        }
        state.publish_generation(g);
        state.advance_logical_tick();
        assert_eq!(state.drain_fanout(None).await.delivered, 1);
    }
    let loaded = queued_bytes(&state, &hello.connection_id).await;
    assert!(
        loaded > 0,
        "the queue must hold at least one frame before the next publish"
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
        queued,
        last.len(),
        "recovery withdraws pending state and charges exactly its notice"
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
        state.publish_generation(crowd_generation_with_offset(tick, tick - 1));
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

#[tokio::test]
async fn coalescing_withdraws_superseded_socket_frames() {
    let (state, url) = start_server().await;
    let (mut viewer, hello) = connect(&url, ConnectionRole::Viewer, b"").await;
    pause_writer(&state, &mut viewer, &hello.connection_id).await;
    state.publish_generation(crowd_generation(1));
    state.advance_logical_tick();
    state.drain_fanout(None).await;
    let mut owed = queued_bytes(&state, &hello.connection_id).await;
    let mut coalesced = false;
    for tick in 2..=150 {
        state.publish_generation(crowd_generation_with_offset(tick, tick));
        state.advance_logical_tick();
        state.drain_fanout(None).await;
        let next = queued_bytes(&state, &hello.connection_id).await;
        if next < owed {
            coalesced = true;
            break;
        }
        owed = next;
    }
    assert!(coalesced);
    let retained = queued_bytes(&state, &hello.connection_id).await;
    resume_writer(&state, &mut viewer, &hello.connection_id).await;
    let frames = drain_socket_frames(&mut viewer).await;
    assert_eq!(
        frames.len(),
        1,
        "superseded state must leave the physical queue"
    );
    assert_eq!(retained, frames.iter().map(Vec::len).sum::<usize>());
}

#[tokio::test]
async fn buffered_enter_is_not_lost_after_the_old_frame_count_limit() {
    let (state, url) = start_server().await;
    let (mut viewer, hello) = connect(&url, ConnectionRole::Viewer, b"").await;
    let mut empty = crowd_generation(1);
    empty.entities.clear();
    state.publish_generation(empty.clone());
    state.drain_fanout(None).await;
    next_binary_frame(&mut viewer).await;
    wait_for_empty_queue(&state, &hello.connection_id).await;
    pause_writer(&state, &mut viewer, &hello.connection_id).await;
    for tick in 2..=40 {
        let mut g = empty.clone();
        g.tick = tick;
        g.generation = tick;
        if tick >= 10 {
            g.entities
                .insert(1, crowd_generation(tick).entities.remove(&1).unwrap());
        }
        state.publish_generation(g);
        state.advance_logical_tick();
        state.drain_fanout(None).await;
    }
    resume_writer(&state, &mut viewer, &hello.connection_id).await;
    let frames = drain_socket_frames(&mut viewer).await;
    let mut bodies = std::collections::BTreeSet::new();
    for frame in frames {
        let envelope = Envelope::decode(frame.as_slice()).unwrap();
        match envelope.body.unwrap() {
            envelope::Body::FullSnapshot(full) => {
                bodies = decode_world_snapshot_body_ids(&full.payload)
                    .unwrap()
                    .into_iter()
                    .collect();
            }
            envelope::Body::SnapshotDelta(delta) => {
                let delta =
                    aigent_protocol::WorldSnapshotDeltaProto::decode(delta.payload.as_slice())
                        .unwrap();
                bodies.extend(delta.entered.iter().map(|record| record.entity_id));
                for id in delta.left_ids {
                    bodies.remove(&id);
                }
            }
            _ => {}
        }
    }
    assert_eq!(bodies, std::collections::BTreeSet::from([1]));
}

#[test]
fn invalid_shape_does_not_install_a_partial_snapshot() {
    let mut fanout = world_server::SnapshotFanout::new();
    fanout.attach(b"bad-shape".to_vec());
    let mut generation = crowd_generation(1);
    generation.entities.get_mut(&1).unwrap().position = world_server::Position::origin();
    generation.entities.get_mut(&1).unwrap().shape =
        Some(world_server::ShapeSlot::from_encoded(vec![0xff]));
    let result = fanout.publish_real_interest_to(b"bad-shape", &generation, &|_| 100);
    assert!(!matches!(
        result,
        Some(world_server::RealPublishOutcome::FullSnapshot { .. })
    ));
    let connection = fanout.get(b"bad-shape").unwrap();
    assert!(connection.snapshot.baseline_id().is_none());
    assert!(connection.interest_real.is_empty());
}

#[test]
fn delta_only_coalescing_emits_a_complete_full_snapshot() {
    let mut fanout = world_server::SnapshotFanout::new();
    fanout.attach(b"delta-only".to_vec());
    fanout.publish_real_interest_to(b"delta-only", &crowd_generation(1), &|_| 100);
    fanout.get_mut(b"delta-only").unwrap().queue.drain_all();
    let charge = QUEUE_LIMIT_BYTES / 2 + 1;
    assert!(matches!(
        fanout.publish_real_interest_to(
            b"delta-only",
            &crowd_generation_with_offset(2, 1),
            &|_| charge
        ),
        Some(world_server::RealPublishOutcome::Delta { .. })
    ));
    assert!(matches!(
        fanout.publish_real_interest_to(
            b"delta-only",
            &crowd_generation_with_offset(3, 2),
            &|_| charge
        ),
        Some(world_server::RealPublishOutcome::FullSnapshot { .. })
    ));
}

#[tokio::test]
async fn resync_waits_for_full_write_and_charges_exact_envelope() {
    let (state, url) = start_server().await;
    let (mut viewer, hello) = connect(&url, ConnectionRole::Viewer, b"").await;
    state.publish_generation(crowd_generation(1));
    state.drain_fanout(None).await;
    next_binary_frame(&mut viewer).await;
    wait_for_empty_queue(&state, &hello.connection_id).await;
    pause_writer(&state, &mut viewer, &hello.connection_id).await;
    assert!(state.deliver_client_resync(&hello.connection_id).await);
    assert!(
        state
            .fanout
            .lock()
            .await
            .get(&hello.connection_id)
            .unwrap()
            .hold_observe,
        "resync remains held while full is only buffered"
    );
    state.publish_generation(crowd_generation(2));
    assert_eq!(state.drain_fanout(None).await.delivered, 0);
    let retained = queued_bytes(&state, &hello.connection_id).await;
    resume_writer(&state, &mut viewer, &hello.connection_id).await;
    let frame = next_binary_frame(&mut viewer).await;
    assert_eq!(retained, frame.len());
    assert!(matches!(
        Envelope::decode(frame.as_slice()).unwrap().body,
        Some(envelope::Body::FullSnapshot(_))
    ));
    wait_for_empty_queue(&state, &hello.connection_id).await;
    assert!(
        !state
            .fanout
            .lock()
            .await
            .get(&hello.connection_id)
            .unwrap()
            .hold_observe
    );
}

#[tokio::test]
async fn ordered_results_are_not_evicted_by_frame_count_pressure() {
    let (state, url) = start_server().await;
    let (mut aigent, hello) = connect(&url, ConnectionRole::Aigent, b"ordered-results").await;
    pause_writer(&state, &mut aigent, &hello.connection_id).await;
    for sequence in 1..=24u64 {
        let frame = Envelope {
            protocol_major: 1,
            connection_id: hello.connection_id.clone(),
            message_id: sequence,
            metadata: Some(aigent_protocol::EnvelopeMetadata {
                required_features: vec![],
            }),
            body: Some(envelope::Body::Command(aigent_protocol::Command {
                metadata: Some(aigent_protocol::CommandMetadata {
                    session_epoch: hello.session_epoch.clone(),
                    sequence,
                    idempotency_key: sequence.to_be_bytes().to_vec(),
                }),
                kind: aigent_protocol::CommandKind::CancelIntent as i32,
                payload: vec![],
            })),
        }
        .encode_to_vec();
        aigent.send(WsMessage::Binary(frame.into())).await.unwrap();
    }
    // Ping follows the commands on this socket, so its pong is a server-side
    // admission barrier without assumptions about scheduler timing.
    round_trip(&mut aigent).await;
    let retained = queued_bytes(&state, &hello.connection_id).await;
    resume_writer(&state, &mut aigent, &hello.connection_id).await;
    let frames = drain_socket_frames(&mut aigent).await;
    assert_eq!(retained, frames.iter().map(Vec::len).sum::<usize>());
    let sequences: Vec<_> = frames
        .into_iter()
        .filter_map(
            |frame| match Envelope::decode(frame.as_slice()).unwrap().body {
                Some(envelope::Body::CommandResult(result)) => Some(result.sequence),
                _ => None,
            },
        )
        .collect();
    assert_eq!(sequences, (1..=24).collect::<Vec<_>>());
}

#[test]
fn failed_resync_preserves_baseline_interest_and_event_cursor() {
    let mut fanout = world_server::SnapshotFanout::new();
    fanout.attach(b"resync-error".to_vec());
    let generation = crowd_generation(1);
    fanout.publish_real_interest_to(b"resync-error", &generation, &|_| 100);
    let connection = fanout.get(b"resync-error").unwrap();
    let baseline = connection.snapshot.baseline_id();
    let interest = connection.interest_real.clone();
    let events = connection.events.clone();
    let mut corrupt = generation.clone();
    let entity_id = *interest.keys().next().unwrap();
    corrupt.entities.get_mut(&entity_id).unwrap().shape =
        Some(world_server::ShapeSlot::from_encoded(vec![0xff]));
    let error = fanout
        .client_resync_real(b"resync-error", &corrupt, &|_| 100)
        .unwrap_err();
    assert_eq!(error.entity_id, entity_id);
    let connection = fanout.get(b"resync-error").unwrap();
    assert_eq!(connection.snapshot.baseline_id(), baseline);
    assert_eq!(connection.interest_real, interest);
    assert_eq!(connection.events, events);
    assert_eq!(
        connection.snapshot.status(),
        world_server::SnapshotStatus::ResyncRequired
    );
    let recovery = fanout
        .client_resync_real(b"resync-error", &generation, &|_| 100)
        .unwrap()
        .unwrap();
    assert_ne!(Some(recovery.0), baseline);
}

#[test]
fn publishing_deltas_keeps_the_complete_retained_baseline() {
    let mut fanout = world_server::SnapshotFanout::new();
    fanout.attach(b"retained-baseline".to_vec());
    fanout.publish_real_interest_to(b"retained-baseline", &crowd_generation(1), &|_| 100);
    let retained = fanout
        .get(b"retained-baseline")
        .unwrap()
        .snapshot
        .retained_real_body()
        .unwrap()
        .clone();
    fanout.publish_real_interest_to(
        b"retained-baseline",
        &crowd_generation_with_offset(2, 1),
        &|_| 100,
    );
    assert_eq!(
        fanout
            .get(b"retained-baseline")
            .unwrap()
            .snapshot
            .retained_real_body(),
        Some(&retained)
    );
}
