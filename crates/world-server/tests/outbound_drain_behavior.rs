//! Outbound WebSocket fan-out drain (task-034).

use std::sync::Arc;
use std::time::{Duration, Instant};

use aigent_protocol::{
    envelope, handshake_frame, ClientHello, Command, CommandKind, CommandMetadata, ConnectionRole,
    Envelope, HandshakeFrame, ServerHello,
};
use futures_util::{SinkExt, StreamExt};
use prost::Message;
use tokio_tungstenite::tungstenite::Message as WsMessage;
use world_server::{
    outbound_queue_limit_bytes, serve_ephemeral, ImmutableGeneration, SessionHub, TransportState,
    World, WorldConfig, OVERFLOW_TICK_OBSERVATIONS,
};

fn client_hello(role: ConnectionRole, aigent_id: Option<&[u8]>) -> Vec<u8> {
    HandshakeFrame {
        body: Some(handshake_frame::Body::ClientHello(ClientHello {
            role: role as i32,
            offered_protocol_majors: vec![1],
            offered_features: vec![],
            aigent_id: aigent_id.unwrap_or_default().to_vec(),
        })),
    }
    .encode_to_vec()
}

async fn connect(
    url: &str,
    role: ConnectionRole,
    aigent_id: Option<&[u8]>,
) -> (
    tokio_tungstenite::WebSocketStream<tokio_tungstenite::MaybeTlsStream<tokio::net::TcpStream>>,
    ServerHello,
) {
    let (mut ws, _) = tokio_tungstenite::connect_async(url)
        .await
        .expect("connect");
    ws.send(WsMessage::Binary(client_hello(role, aigent_id).into()))
        .await
        .expect("hello");
    let reply = ws.next().await.expect("reply").expect("ok");
    let WsMessage::Binary(bytes) = reply else {
        panic!("expected ServerHello binary");
    };
    let frame = HandshakeFrame::decode(bytes.as_ref()).unwrap();
    match frame.body {
        Some(handshake_frame::Body::ServerHello(hello)) => (ws, hello),
        other => panic!("expected ServerHello, got {other:?}"),
    }
}

async fn next_envelope(
    ws: &mut tokio_tungstenite::WebSocketStream<
        tokio_tungstenite::MaybeTlsStream<tokio::net::TcpStream>,
    >,
) -> Envelope {
    let msg = tokio::time::timeout(Duration::from_secs(2), ws.next())
        .await
        .unwrap()
        .unwrap()
        .unwrap();
    let WsMessage::Binary(bytes) = msg else {
        panic!("expected binary");
    };
    Envelope::decode(bytes.as_ref()).unwrap()
}

#[tokio::test]
async fn drain_delivers_full_snapshot_to_viewer_and_aigent() {
    let state = TransportState::new(SessionHub::new_v1());
    let (addr, server) = serve_ephemeral(Arc::clone(&state)).await.unwrap();
    tokio::spawn(async move {
        let _ = server.await;
    });
    let url = format!("ws://{addr}/ws");
    let (mut viewer, _) = connect(&url, ConnectionRole::Viewer, None).await;
    let (mut aigent, _) = connect(&url, ConnectionRole::Aigent, Some(b"agent-a")).await;

    let mut world = World::new(WorldConfig::default());
    let gen = world.advance_tick().unwrap().clone();
    state.publish_generation(gen);
    let report = state.drain_fanout(None).await;
    assert!(report.delivered >= 2);

    for ws in [&mut viewer, &mut aigent] {
        let envelope = next_envelope(ws).await;
        assert!(matches!(
            envelope.body,
            Some(envelope::Body::FullSnapshot(_))
        ));
    }
}

#[tokio::test]
async fn drain_delivers_delta_after_baseline() {
    let state = TransportState::new(SessionHub::new_v1());
    let (addr, server) = serve_ephemeral(Arc::clone(&state)).await.unwrap();
    tokio::spawn(async move {
        let _ = server.await;
    });
    let url = format!("ws://{addr}/ws");
    let (mut viewer, _) = connect(&url, ConnectionRole::Viewer, None).await;

    let mut world = World::new(WorldConfig::default());
    state.publish_generation(world.advance_tick().unwrap().clone());
    let _ = state.drain_fanout(None).await;
    let first = next_envelope(&mut viewer).await;
    assert!(matches!(first.body, Some(envelope::Body::FullSnapshot(_))));

    state.publish_generation(world.advance_tick().unwrap().clone());
    let report = state.drain_fanout(None).await;
    assert!(report.delivered >= 1);
    let second = next_envelope(&mut viewer).await;
    assert!(matches!(
        second.body,
        Some(envelope::Body::SnapshotDelta(_))
    ));
}

#[tokio::test]
async fn command_result_envelope_reaches_aigent_socket() {
    let state = TransportState::new(SessionHub::new_v1());
    let (addr, server) = serve_ephemeral(Arc::clone(&state)).await.unwrap();
    tokio::spawn(async move {
        let _ = server.await;
    });
    let url = format!("ws://{addr}/ws");
    let (mut aigent, hello) = connect(&url, ConnectionRole::Aigent, Some(b"agent-cmd")).await;

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
                idempotency_key: b"idem-1".to_vec(),
            }),
            kind: CommandKind::CancelIntent as i32,
            payload: vec![],
        })),
    }
    .encode_to_vec();
    aigent
        .send(WsMessage::Binary(command.into()))
        .await
        .expect("send command");

    let reply = next_envelope(&mut aigent).await;
    assert!(matches!(reply.body, Some(envelope::Body::CommandResult(_))));
}

#[tokio::test]
async fn protocol_error_envelope_reaches_aigent_socket() {
    let state = TransportState::new(SessionHub::new_v1());
    let (addr, server) = serve_ephemeral(Arc::clone(&state)).await.unwrap();
    tokio::spawn(async move {
        let _ = server.await;
    });
    let url = format!("ws://{addr}/ws");
    let (mut aigent, hello) = connect(&url, ConnectionRole::Aigent, Some(b"agent-err")).await;

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
                idempotency_key: vec![],
            }),
            kind: CommandKind::CancelIntent as i32,
            payload: vec![],
        })),
    }
    .encode_to_vec();
    aigent
        .send(WsMessage::Binary(command.into()))
        .await
        .expect("send command");

    let reply = next_envelope(&mut aigent).await;
    assert!(matches!(reply.body, Some(envelope::Body::ProtocolError(_))));
}

#[tokio::test]
async fn sustained_overflow_isolates_only_slow_connection() {
    let state = TransportState::new(SessionHub::new_v1());
    let (addr, server) = serve_ephemeral(Arc::clone(&state)).await.unwrap();
    tokio::spawn(async move {
        let _ = server.await;
    });
    let url = format!("ws://{addr}/ws");
    let (mut fast, _) = connect(&url, ConnectionRole::Viewer, None).await;
    let (mut slow, slow_hello) = connect(&url, ConnectionRole::Aigent, Some(b"slow-a")).await;
    let slow_id = slow_hello.connection_id.clone();
    assert!(state.set_outbound_paused(&slow_id, true).await);

    let oversized = outbound_queue_limit_bytes() + 1;
    let mut isolated = false;
    for i in 0u64..(u64::from(OVERFLOW_TICK_OBSERVATIONS) + 24) {
        let gen = ImmutableGeneration {
            generation: i + 1,
            tick: i + 1,
            world_value: 0,
            ruleset_generation_id: 1,
            active_leases: Default::default(),
            applied_commands: vec![],
            expired_leases: vec![],
            entities: Default::default(),
            next_entity_id: world_server::FIRST_ENTITY_ID,
            rng_draws: vec![],
        };
        state.publish_generation(gen);
        state.advance_logical_tick();
        let report = state.drain_fanout(Some(oversized)).await;
        while let Ok(Some(Ok(_msg))) =
            tokio::time::timeout(Duration::from_millis(5), fast.next()).await
        {}
        if report.closed.iter().any(|id| id == &slow_id) {
            isolated = true;
            break;
        }
    }
    assert!(isolated, "slow connection should be closed by overflow");

    let mut saw_end = false;
    for _ in 0..16 {
        match tokio::time::timeout(Duration::from_secs(1), slow.next()).await {
            Ok(None) => {
                saw_end = true;
                break;
            }
            Ok(Some(Ok(WsMessage::Close(_)))) | Ok(Some(Err(_))) => {
                saw_end = true;
                break;
            }
            Ok(Some(Ok(WsMessage::Binary(_)))) => continue,
            Ok(Some(Ok(_))) => continue,
            Err(_) => break,
        }
    }
    assert!(saw_end, "slow socket should end after overflow isolation");

    let gen = ImmutableGeneration {
        generation: 9_001,
        tick: 9_001,
        world_value: 1,
        ruleset_generation_id: 1,
        active_leases: Default::default(),
        applied_commands: vec![],
        expired_leases: vec![],
        entities: Default::default(),
        next_entity_id: world_server::FIRST_ENTITY_ID,
        rng_draws: vec![],
    };
    state.publish_generation(gen);
    state.advance_logical_tick();
    let report = state.drain_fanout(None).await;
    assert!(report.delivered >= 1);
    let msg = tokio::time::timeout(Duration::from_secs(2), fast.next())
        .await
        .unwrap()
        .unwrap()
        .unwrap();
    assert!(matches!(msg, WsMessage::Binary(_)));
}

#[tokio::test]
async fn drain_does_not_block_logical_ticks() {
    let state = TransportState::new(SessionHub::new_v1());
    let (addr, server) = serve_ephemeral(Arc::clone(&state)).await.unwrap();
    tokio::spawn(async move {
        let _ = server.await;
    });
    let url = format!("ws://{addr}/ws");
    let (_ws, _) = connect(&url, ConnectionRole::Viewer, None).await;

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
    let deadline = Instant::now() + Duration::from_millis(500);
    for i in 0u64..20 {
        state.publish_generation(ImmutableGeneration {
            generation: i + 1,
            tick: i + 1,
            world_value: 0,
            ruleset_generation_id: 1,
            active_leases: Default::default(),
            applied_commands: vec![],
            expired_leases: vec![],
            entities: Default::default(),
            next_entity_id: world_server::FIRST_ENTITY_ID,
            rng_draws: vec![],
        });
        let _ = state
            .drain_fanout(Some(outbound_queue_limit_bytes() + 64))
            .await;
        assert!(
            Instant::now() < deadline,
            "drain under oversized pressure must finish promptly"
        );
    }
    ticker.await.unwrap();
    assert!(state.peek_arrival_tick() >= start + 40);
}
