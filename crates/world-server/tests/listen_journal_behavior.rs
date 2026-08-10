//! Listen path recovers MOVE leases from the durable SQLite journal (task-039).

use std::path::PathBuf;
use std::sync::Arc;
use std::time::Duration;

use aigent_protocol::{
    command_result, envelope, handshake_frame, ClientHello, Command, CommandKind, CommandMetadata,
    ConnectionRole, Envelope, HandshakeFrame, MovePayload, ServerHello,
};
use futures_util::{SinkExt, StreamExt};
use prost::Message;
use tokio_tungstenite::tungstenite::Message as WsMessage;
use world_server::{
    decode_placeholder_payload, serve_ephemeral, DurableJournal, JournalError, SessionHub,
    SqliteJournal, TransportState, World, WorldConfig,
};

type Socket =
    tokio_tungstenite::WebSocketStream<tokio_tungstenite::MaybeTlsStream<tokio::net::TcpStream>>;

fn temp_db(name: &str) -> PathBuf {
    let mut path = std::env::temp_dir();
    path.push(format!(
        "aigent-place-task-039-{}-{}-{}.sqlite",
        name,
        std::process::id(),
        std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .expect("time")
            .as_nanos()
    ));
    path
}

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

fn move_command(
    connection_id: &[u8],
    session_epoch: &[u8],
    message_id: u64,
    sequence: u64,
    idempotency_key: &[u8],
) -> Vec<u8> {
    Envelope {
        protocol_major: 1,
        connection_id: connection_id.to_vec(),
        message_id,
        metadata: Some(aigent_protocol::EnvelopeMetadata {
            required_features: vec![],
        }),
        body: Some(envelope::Body::Command(Command {
            metadata: Some(CommandMetadata {
                session_epoch: session_epoch.to_vec(),
                sequence,
                idempotency_key: idempotency_key.to_vec(),
            }),
            kind: CommandKind::Move as i32,
            payload: MovePayload {
                target_x_mm: 5_000,
                target_z_mm: 0,
                speed_mm_per_s: 1_000,
            }
            .encode_to_vec(),
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
        .expect("hello");
    let reply = ws.next().await.expect("reply").expect("ok");
    let WsMessage::Binary(bytes) = reply else {
        panic!("expected ServerHello");
    };
    let frame = HandshakeFrame::decode(bytes.as_ref()).unwrap();
    match frame.body {
        Some(handshake_frame::Body::ServerHello(hello)) => (ws, hello),
        other => panic!("expected ServerHello, got {other:?}"),
    }
}

async fn next_command_result(ws: &mut Socket) -> aigent_protocol::CommandResult {
    for _ in 0..32 {
        let msg = tokio::time::timeout(Duration::from_secs(2), ws.next())
            .await
            .expect("timeout")
            .expect("closed")
            .expect("ok");
        let WsMessage::Binary(bytes) = msg else {
            continue;
        };
        let envelope = Envelope::decode(bytes.as_ref()).unwrap();
        if let Some(envelope::Body::CommandResult(result)) = envelope.body {
            return result;
        }
    }
    panic!("no CommandResult received");
}

async fn next_full_snapshot_bodies(ws: &mut Socket) -> Vec<u64> {
    for _ in 0..64 {
        let msg = tokio::time::timeout(Duration::from_secs(2), ws.next())
            .await
            .expect("timeout waiting for snapshot")
            .expect("closed")
            .expect("ok");
        let WsMessage::Binary(bytes) = msg else {
            continue;
        };
        let envelope = Envelope::decode(bytes.as_ref()).unwrap();
        if let Some(envelope::Body::FullSnapshot(full)) = envelope.body {
            let (_tick, _digest, bodies) =
                decode_placeholder_payload(&full.payload).expect("placeholder payload");
            return bodies.into_iter().map(|body| body.body_id).collect();
        }
    }
    panic!("no FullSnapshot received");
}

fn cleanup(path: &std::path::Path) {
    let _ = std::fs::remove_file(path);
    let stem = path.display().to_string();
    let _ = std::fs::remove_file(format!("{stem}-wal"));
    let _ = std::fs::remove_file(format!("{stem}-shm"));
}

#[tokio::test]
async fn listen_restart_serves_recovered_move_lease_in_first_snapshot() {
    let path = temp_db("move-recover");
    let aigent_id = b"durable-move-a";

    let granted_body = {
        let state =
            TransportState::try_new_with_durable_journal(SessionHub::new_v1(), false, &path)
                .expect("open fresh durable journal");
        // Drive ticks explicitly so the lease is durably committed before we
        // drop the world (sim loop + axum would keep Arc alive across abort).
        let (addr, server) = serve_ephemeral(Arc::clone(&state)).await.unwrap();
        let server_task = tokio::spawn(async move {
            let _ = server.await;
        });
        let url = format!("ws://{addr}/ws");
        let (mut ws, hello) = connect(&url, ConnectionRole::Aigent, aigent_id).await;
        ws.send(WsMessage::Binary(
            move_command(
                &hello.connection_id,
                &hello.session_epoch,
                1,
                1,
                b"durable-move-1",
            )
            .into(),
        ))
        .await
        .expect("send move");
        let result = next_command_result(&mut ws).await;
        assert!(matches!(
            result.outcome,
            Some(command_result::Outcome::Accepted(_))
        ));

        let body_id = {
            let mut world = state.world.lock().await;
            world
                .advance_tick()
                .expect("durable tick must install the granted MOVE lease");
            let body_id = world
                .body_for_aigent(aigent_id)
                .expect("demo body bound for aigent");
            assert!(
                world.leases().get(body_id).is_some(),
                "MOVE lease must be live after durable install"
            );
            assert!(
                world
                    .journal()
                    .last_committed()
                    .is_some_and(|packet| packet.active_leases.contains_key(&body_id)),
                "MOVE lease must be present in the committed journal packet"
            );
            body_id
        };

        drop(ws);
        server_task.abort();
        let _ = server_task.await;
        drop(state);
        body_id
    };

    let state = TransportState::try_new_with_durable_journal(SessionHub::new_v1(), false, &path)
        .expect("recover durable journal after restart");
    {
        let world = state.world.lock().await;
        assert_eq!(world.body_for_aigent(aigent_id), Some(granted_body));
        assert!(
            world.leases().get(granted_body).is_some(),
            "recovered world must restore the active MOVE lease before serving"
        );
    }
    let (addr, server) = serve_ephemeral(Arc::clone(&state)).await.unwrap();
    tokio::spawn(async move {
        let _ = server.await;
    });
    let url = format!("ws://{addr}/ws");
    let (mut viewer, _) = connect(&url, ConnectionRole::Viewer, b"").await;

    // First post-restart tick installs a published generation from recovered
    // leases; drain that as the first observe snapshot (no prior baseline).
    {
        let mut world = state.world.lock().await;
        let generation = world.advance_tick().expect("post-restart tick").clone();
        assert!(
            generation.active_leases.contains_key(&granted_body),
            "published generation after restart must carry the recovered MOVE lease"
        );
        state.publish_generation(generation);
    }
    let report = state.drain_fanout(None).await;
    assert!(
        report.delivered >= 1,
        "first post-restart drain must deliver a snapshot"
    );
    let bodies = next_full_snapshot_bodies(&mut viewer).await;
    assert!(
        bodies.contains(&granted_body),
        "first snapshot after restart must include recovered MOVE lease body {granted_body}; got {bodies:?}"
    );

    cleanup(&path);
}

#[test]
fn durable_listen_open_rejects_corrupt_journal() {
    let path = temp_db("corrupt-open");
    {
        let journal = DurableJournal::sqlite(&path).unwrap();
        let mut world = World::with_journal(WorldConfig::default(), journal);
        world
            .enqueue(world_server::QueuedCommand {
                arrival_tick: 1,
                aigent_id: b"a".to_vec(),
                sequence: 1,
                effect: world_server::CommandEffect::BumpWorldValue { delta: 1 },
            })
            .unwrap();
        world.advance_tick().unwrap();
        drop(world);
    }
    let sqlite = SqliteJournal::open(&path).unwrap();
    assert!(sqlite.corrupt_last_integrity_for_test().unwrap());
    drop(sqlite);

    let err = TransportState::try_new_with_durable_journal(SessionHub::new_v1(), false, &path)
        .expect_err("corrupt journal must fail closed at listen startup");
    let message = err.to_string();
    assert!(
        matches!(
            err,
            world_server::WorldError::Persistence(JournalError::CorruptCommitted { generation: 1 })
        ),
        "expected corrupt committed error, got {err:?}"
    );
    assert!(
        message.contains("corrupt committed generation 1"),
        "startup error should name the corrupt generation; got {message}"
    );
    cleanup(&path);
}

#[test]
fn durable_listen_open_rejects_gapped_journal() {
    let path = temp_db("gap-open");
    let base = {
        let journal = DurableJournal::sqlite(&path).unwrap();
        let mut world = World::with_journal(WorldConfig::default(), journal);
        world
            .enqueue(world_server::QueuedCommand {
                arrival_tick: 1,
                aigent_id: b"a".to_vec(),
                sequence: 1,
                effect: world_server::CommandEffect::BumpWorldValue { delta: 1 },
            })
            .unwrap();
        world.advance_tick().unwrap();
        let base = world.journal().last_committed().unwrap().clone();
        drop(world);
        base
    };
    let sqlite = SqliteJournal::open(&path).unwrap();
    sqlite
        .push_gapped_committed_for_test(world_server::CommittedGeneration {
            generation: base.generation + 2,
            world_value: base.world_value,
            ruleset: base.ruleset,
            pending_ruleset: None,
            command_summaries: vec!["gap".into()],
            active_leases: base.active_leases,
            aigent_bodies: base.aigent_bodies,
            entities: base.entities,
            next_entity_id: base.next_entity_id,
            integrity_hex: String::new(),
        })
        .unwrap();
    drop(sqlite);

    let err = TransportState::try_new_with_durable_journal(SessionHub::new_v1(), false, &path)
        .expect_err("gapped journal must fail closed at listen startup");
    let message = err.to_string();
    assert!(
        matches!(
            err,
            world_server::WorldError::Persistence(JournalError::GenerationGap { .. })
        ),
        "expected generation gap, got {err:?}"
    );
    assert!(
        message.contains("generation gap"),
        "startup error should describe the gap; got {message}"
    );
    cleanup(&path);
}
