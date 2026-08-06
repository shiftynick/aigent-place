//! AOI truncation on the live WebSocket fan-out path (task-044).
//!
//! task-016 built nearest-first interest truncation, but nothing on the live
//! path called it: `drain_fanout` encoded every active lease with every focus
//! pinned at the world origin. These tests assert the bytes a connected client
//! actually receives, so they fail against that path.
//!
//! The expected survivor set is derived here from the generation's own lease
//! table and the ARCHITECTURE §1 rule (nearest-first Euclidean truncation under
//! the hard cap, ties by ascending body id). It deliberately does not call the
//! production ranking helper: an oracle that reused `truncate_nearest` could
//! not fail when the ranking itself is wrong.

use std::collections::BTreeMap;
use std::sync::Arc;
use std::time::Duration;

use aigent_protocol::{
    command_result, envelope, handshake_frame, ClientHello, Command, CommandKind, CommandMetadata,
    ConnectionRole, Envelope, HandshakeFrame, ServerHello, SnapshotResyncRequest,
};
use futures_util::{SinkExt, StreamExt};
use prost::Message;
use tokio_tungstenite::tungstenite::Message as WsMessage;
use world_server::{
    decode_placeholder_payload, placeholder_body_from_lease, serve_ephemeral, AoiError,
    ImmutableGeneration, LeaseSnapshot, SessionHub, SnapshotFanout, TransportState, AOI_HARD_CAP,
    VIEWER_AOI_CAPS,
};

type Socket =
    tokio_tungstenite::WebSocketStream<tokio_tungstenite::MaybeTlsStream<tokio::net::TcpStream>>;

/// Enough bodies to exceed the hard cap; the crowd plus the near band stays
/// under `2 * AOI_HARD_CAP`, so the direct truncation path is under test rather
/// than the dense spatial-hash gather.
const CROWD: std::ops::RangeInclusive<u64> = 1..=150;

/// Body ids whose placeholder poses sit near the world origin, so adding them
/// evicts part of the crowd from an origin-focused interest set.
const NEAR_ORIGIN_BAND: std::ops::RangeInclusive<u64> = 800..=839;

const WORLD_ORIGIN: (f64, f64, f64) = (0.0, 0.0, 0.0);

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

async fn start_server() -> (Arc<TransportState>, String) {
    let state = TransportState::new(SessionHub::new_v1());
    let (addr, server) = serve_ephemeral(Arc::clone(&state)).await.expect("bind");
    tokio::spawn(async move {
        let _ = server.await;
    });
    (state, format!("ws://{addr}/ws"))
}

async fn next_envelope(ws: &mut Socket) -> Envelope {
    let message = tokio::time::timeout(Duration::from_secs(5), ws.next())
        .await
        .expect("frame before timeout")
        .expect("stream open")
        .expect("frame ok");
    let WsMessage::Binary(bytes) = message else {
        panic!("expected a binary envelope");
    };
    Envelope::decode(bytes.as_ref()).expect("envelope")
}

/// Whether an observe frame was a full snapshot, plus the body ids it carried
/// in wire order. Command results and other traffic are skipped.
async fn next_state_body_ids(ws: &mut Socket) -> (bool, Vec<u64>) {
    for _ in 0..32 {
        let payload = match next_envelope(ws).await.body {
            Some(envelope::Body::FullSnapshot(full)) => (true, full.payload),
            Some(envelope::Body::SnapshotDelta(delta)) => (false, delta.payload),
            _ => continue,
        };
        let (is_full, bytes) = payload;
        let (_tick, _digest, bodies) =
            decode_placeholder_payload(&bytes).expect("stub placeholder payload");
        return (
            is_full,
            bodies.into_iter().map(|body| body.body_id).collect(),
        );
    }
    panic!("no snapshot or delta frame arrived");
}

fn lease(body_id: u64) -> LeaseSnapshot {
    LeaseSnapshot {
        body_id,
        aigent_id: format!("crowd-{body_id}").into_bytes(),
        sequence: 1,
        granted_tick: 1,
        expire_tick: 10_000,
    }
}

fn generation_of(
    tick: u64,
    leases: impl IntoIterator<Item = LeaseSnapshot>,
) -> ImmutableGeneration {
    let mut active_leases = BTreeMap::new();
    for lease in leases {
        active_leases.insert(lease.body_id, lease);
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

fn crowd_generation(tick: u64) -> ImmutableGeneration {
    generation_of(tick, CROWD.map(lease))
}

/// Placeholder pose in canonical metres, converted here from the millimetre
/// wire units so the oracle does not borrow the production conversion.
fn pose_of(generation: &ImmutableGeneration, body_id: u64) -> (f64, f64, f64) {
    let lease = generation
        .active_leases
        .get(&body_id)
        .expect("body has a live lease in this generation");
    let body = placeholder_body_from_lease(lease);
    (
        body.x_mm as f64 / 1000.0,
        body.y_mm as f64 / 1000.0,
        body.z_mm as f64 / 1000.0,
    )
}

/// Survivors the AOI contract requires for this generation and focus: the
/// `cap` nearest bodies by Euclidean distance, ties broken by ascending id.
fn expected_interest(
    generation: &ImmutableGeneration,
    focus: (f64, f64, f64),
    cap: usize,
) -> Vec<u64> {
    let mut ranked: Vec<(u64, f64)> = generation
        .active_leases
        .keys()
        .map(|&body_id| {
            let (x, y, z) = pose_of(generation, body_id);
            let (dx, dy, dz) = (x - focus.0, y - focus.1, z - focus.2);
            (body_id, dx * dx + dy * dy + dz * dz)
        })
        .collect();
    ranked.sort_by(|left, right| {
        left.1
            .partial_cmp(&right.1)
            .expect("finite distances")
            .then(left.0.cmp(&right.0))
    });
    ranked
        .into_iter()
        .take(cap)
        .map(|(body_id, _)| body_id)
        .collect()
}

fn hard_cap() -> usize {
    AOI_HARD_CAP as usize
}

/// Issue a real wire MOVE and wait for its authoritative acceptance, so the
/// world grants this aigent a body on the next tick.
async fn move_and_confirm(ws: &mut Socket, hello: &ServerHello, idempotency_key: &[u8]) {
    let command = Envelope {
        protocol_major: 1,
        connection_id: hello.connection_id.clone(),
        message_id: 1,
        metadata: Some(aigent_protocol::EnvelopeMetadata {
            required_features: vec![],
        }),
        body: Some(envelope::Body::Command(Command {
            metadata: Some(CommandMetadata {
                session_epoch: hello.session_epoch.clone(),
                sequence: 1,
                idempotency_key: idempotency_key.to_vec(),
            }),
            kind: CommandKind::Move as i32,
            payload: vec![],
        })),
    }
    .encode_to_vec();
    ws.send(WsMessage::Binary(command.into()))
        .await
        .expect("send move");
    match next_envelope(ws).await.body {
        Some(envelope::Body::CommandResult(result)) => assert!(
            matches!(result.outcome, Some(command_result::Outcome::Accepted(_))),
            "the move must be accepted before a lease can exist"
        ),
        other => panic!("expected a CommandResult, got {other:?}"),
    }
}

/// Advance the authoritative world one tick and clone what it published.
async fn advance_and_publish(state: &TransportState) -> ImmutableGeneration {
    let mut world = state.world.lock().await;
    world.advance_tick().expect("advance one tick");
    world
        .last_generation()
        .expect("published generation")
        .clone()
}

#[tokio::test]
async fn live_viewer_snapshot_truncates_to_the_hard_cap_nearest_first() {
    let (state, url) = start_server().await;
    let (mut viewer, _hello) = connect(&url, ConnectionRole::Viewer, b"").await;

    let generation = crowd_generation(1);
    assert!(
        generation.active_leases.len() > hard_cap(),
        "the crowd must exceed the hard cap or this test asserts nothing"
    );
    state.publish_generation(generation.clone());
    let report = state.drain_fanout(None).await;
    assert_eq!(report.delivered, 1, "the viewer should receive one frame");

    let (is_full, delivered) = next_state_body_ids(&mut viewer).await;
    assert!(is_full, "the first observe frame is a full snapshot");
    assert_eq!(
        delivered.len(),
        hard_cap(),
        "a live viewer snapshot must be truncated to the AOI hard cap"
    );
    assert_eq!(
        delivered,
        expected_interest(&generation, WORLD_ORIGIN, hard_cap()),
        "delivered bodies must be the nearest-first survivors for the viewer focus"
    );
}

#[tokio::test]
async fn live_aigent_interest_ranks_from_its_own_body() {
    let (state, url) = start_server().await;
    let aigent_id = b"aoi-focus-aigent".to_vec();
    let (mut aigent, hello) = connect(&url, ConnectionRole::Aigent, &aigent_id).await;

    // Take the aigent's own body from authoritative state rather than
    // re-deriving the server's aigent→body mapping: issue a real MOVE, advance
    // the world, and read back the lease the world granted to this aigent.
    move_and_confirm(&mut aigent, &hello, b"aoi-focus-move").await;
    let published = advance_and_publish(&state).await;
    let mut owned: Vec<LeaseSnapshot> = published
        .active_leases
        .values()
        .filter(|lease| lease.aigent_id == aigent_id)
        .cloned()
        .collect();
    assert_eq!(
        owned.len(),
        1,
        "the move should grant this aigent exactly one body"
    );
    let own_lease = owned.pop().expect("checked length");
    let own_body = own_lease.body_id;

    let generation = generation_of(2, CROWD.map(lease).chain(std::iter::once(own_lease)));
    let from_own_body = expected_interest(&generation, pose_of(&generation, own_body), hard_cap());
    let from_origin = expected_interest(&generation, WORLD_ORIGIN, hard_cap());
    assert_ne!(
        from_own_body, from_origin,
        "fixture must separate the aigent's body from the origin, or the test proves nothing"
    );

    state.publish_generation(generation.clone());
    let report = state.drain_fanout(None).await;
    assert_eq!(report.delivered, 1);

    let (is_full, delivered) = next_state_body_ids(&mut aigent).await;
    assert!(is_full, "the first observe frame is a full snapshot");
    assert_eq!(
        delivered.first().copied(),
        Some(own_body),
        "an aigent's own body is at distance zero from its focus"
    );
    assert_eq!(
        delivered, from_own_body,
        "aigent interest must rank against its own body, not the world origin"
    );
}

#[tokio::test]
async fn bodies_leaving_the_interest_set_stop_appearing_in_deltas() {
    let (state, url) = start_server().await;
    let (mut viewer, _hello) = connect(&url, ConnectionRole::Viewer, b"").await;

    let first = crowd_generation(1);
    state.publish_generation(first.clone());
    let _ = state.drain_fanout(None).await;
    let (is_full, delivered_first) = next_state_body_ids(&mut viewer).await;
    assert!(is_full, "the first observe frame is a full snapshot");
    assert_eq!(
        delivered_first,
        expected_interest(&first, WORLD_ORIGIN, hard_cap())
    );

    // A band of bodies nearer the viewer focus displaces part of the crowd.
    let second = generation_of(2, CROWD.chain(NEAR_ORIGIN_BAND).map(lease));
    let expected_second = expected_interest(&second, WORLD_ORIGIN, hard_cap());
    let leaving: Vec<u64> = delivered_first
        .iter()
        .copied()
        .filter(|body_id| !expected_second.contains(body_id))
        .collect();
    assert!(
        !leaving.is_empty(),
        "fixture must evict at least one body, or the leave assertion is vacuous"
    );

    state.publish_generation(second.clone());
    let _ = state.drain_fanout(None).await;
    let (is_full, delivered_second) = next_state_body_ids(&mut viewer).await;
    assert!(
        !is_full,
        "an established baseline should be followed by a delta"
    );
    assert_eq!(
        delivered_second, expected_second,
        "delta payloads must carry the same truncated interest set as the baseline"
    );
    for body_id in leaving {
        assert!(
            !delivered_second.contains(&body_id),
            "body {body_id} left the interest set and must stop being delivered"
        );
    }
}

#[tokio::test]
async fn client_resync_baseline_is_truncated() {
    // The socket handler delegates a SnapshotResyncRequest straight to
    // `SnapshotFanout::client_resync`, so this exercises the resync payload the
    // wire carries. Driving it here lets the world hold more bodies than the
    // cap, which the demo world cannot yet reach through commands alone.
    let generation = crowd_generation(1);
    let mut fanout = SnapshotFanout::new();
    fanout.attach(b"c1".to_vec());

    let (_baseline, payload, _events, _enqueue) = fanout
        .client_resync(b"c1", &generation, None)
        .expect("resync delivered");
    let delivered: Vec<u64> = payload.bodies.iter().map(|body| body.body_id).collect();
    assert_eq!(
        delivered,
        expected_interest(&generation, WORLD_ORIGIN, hard_cap()),
        "a client-requested resync must respect the AOI cap, not resend the world"
    );
}

#[tokio::test]
async fn socket_resync_request_delivers_the_truncated_set() {
    let (state, url) = start_server().await;

    // Two aigents move, so the authoritative world holds two bodies at
    // different distances from the origin. The demo world cannot reach 100
    // bodies through commands, so the viewer's policy cap is lowered instead —
    // truncation is observable either way, and the cap stays a legal non-zero
    // viewer cap.
    let (mut first, first_hello) = connect(&url, ConnectionRole::Aigent, b"resync-aigent-a").await;
    let (mut second, second_hello) =
        connect(&url, ConnectionRole::Aigent, b"resync-aigent-b").await;
    move_and_confirm(&mut first, &first_hello, b"resync-move-a").await;
    move_and_confirm(&mut second, &second_hello, b"resync-move-b").await;
    let published = advance_and_publish(&state).await;
    assert_eq!(
        published.active_leases.len(),
        2,
        "both moves should be live before the resync"
    );

    let (mut viewer, hello) = connect(&url, ConnectionRole::Viewer, b"").await;
    {
        let mut fanout = state.fanout.lock().await;
        fanout
            .get_mut(&hello.connection_id)
            .expect("attached connection")
            .viewer_aoi_cap = 1;
    }
    let expected = expected_interest(&published, WORLD_ORIGIN, 1);
    let excluded: Vec<u64> = published
        .active_leases
        .keys()
        .copied()
        .filter(|body_id| !expected.contains(body_id))
        .collect();
    assert_eq!(
        excluded.len(),
        1,
        "the cap must exclude exactly one body, or the assertion is vacuous"
    );

    let request = Envelope {
        protocol_major: 1,
        connection_id: hello.connection_id.clone(),
        message_id: 1,
        metadata: Some(aigent_protocol::EnvelopeMetadata {
            required_features: vec![],
        }),
        body: Some(envelope::Body::SnapshotResyncRequest(
            SnapshotResyncRequest { baseline_id: None },
        )),
    }
    .encode_to_vec();
    viewer
        .send(WsMessage::Binary(request.into()))
        .await
        .expect("send resync request");

    let (is_full, delivered) = next_state_body_ids(&mut viewer).await;
    assert!(is_full, "a resync request must answer with a full snapshot");
    assert_eq!(
        delivered, expected,
        "the resync baseline on the wire must carry only the truncated interest set"
    );
    for body_id in excluded {
        assert!(
            !delivered.contains(&body_id),
            "body {body_id} is outside the cap and must not reach the socket"
        );
    }
}

#[tokio::test]
async fn unusable_aoi_cap_publishes_nothing_rather_than_the_whole_world() {
    let (state, url) = start_server().await;
    let (mut viewer, hello) = connect(&url, ConnectionRole::Viewer, b"").await;
    {
        let mut fanout = state.fanout.lock().await;
        fanout
            .get_mut(&hello.connection_id)
            .expect("attached connection")
            .viewer_aoi_cap = 0;
    }

    let generation = crowd_generation(1);
    state.publish_generation(generation.clone());
    let report = state.drain_fanout(None).await;
    assert_eq!(
        report.delivered, 0,
        "an unusable AOI cap must suppress the publish, not fall back to everything"
    );
    assert_eq!(
        report.interest_unavailable,
        vec![(hello.connection_id.clone(), AoiError::ZeroCap)],
        "the drain must report the starved connection and its typed reason"
    );
    // Load-bearing and timing-free: nothing was ever queued, so no frame can
    // arrive later either. The socket-silence check below is a redundant
    // end-to-end confirmation, not the oracle.
    {
        let fanout = state.fanout.lock().await;
        assert_eq!(
            fanout
                .get(&hello.connection_id)
                .expect("attached connection")
                .queue
                .state_bytes(),
            0,
            "an unusable AOI cap must leave the outbound queue untouched"
        );
    }
    assert!(
        tokio::time::timeout(Duration::from_millis(250), viewer.next())
            .await
            .is_err(),
        "no snapshot may reach a connection whose interest set could not be computed"
    );

    // Recovery: restoring a cap from the documented degradation ladder must
    // resume delivery, with a fresh baseline rather than a stuck connection.
    let restored = VIEWER_AOI_CAPS[2];
    {
        let mut fanout = state.fanout.lock().await;
        fanout
            .get_mut(&hello.connection_id)
            .expect("attached connection")
            .viewer_aoi_cap = restored;
    }
    state.publish_generation(generation.clone());
    let report = state.drain_fanout(None).await;
    assert_eq!(report.delivered, 1, "delivery must resume after recovery");
    assert!(report.interest_unavailable.is_empty());

    let (is_full, delivered) = next_state_body_ids(&mut viewer).await;
    assert!(
        is_full,
        "the first frame after recovery is still a full snapshot baseline"
    );
    assert_eq!(
        delivered,
        expected_interest(&generation, WORLD_ORIGIN, restored as usize),
        "the recovered connection must receive the restored cap's truncated set"
    );
}
