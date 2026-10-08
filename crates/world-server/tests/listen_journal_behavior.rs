//! Listen path recovers MOVE leases from the durable SQLite journal (task-039).

use std::path::PathBuf;
use std::sync::Arc;
use std::time::Duration;

use aigent_protocol::{
    command_result, envelope, handshake_frame, ClientHello, Command, CommandKind, CommandMetadata,
    CommandRejectionCode, ConnectionRole, Envelope, HandshakeFrame, MovePayload, ServerHello,
};
use futures_util::{SinkExt, StreamExt};
use prost::Message;
use tokio_tungstenite::tungstenite::Message as WsMessage;
use world_server::{
    decode_world_snapshot_body_ids, serve_ephemeral, DurableJournal, JournalError, SessionHub,
    SqliteJournal, TickAdvance, TransportState, World, WorldConfig,
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
            let bodies =
                decode_world_snapshot_body_ids(&full.payload).expect("real-body snapshot payload");
            return bodies;
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

fn stop_command(hello: &ServerHello) -> Vec<u8> {
    stop_command_at(hello, 2, 2, b"late-stop")
}

fn stop_command_at(hello: &ServerHello, message_id: u64, sequence: u64, key: &[u8]) -> Vec<u8> {
    let mut envelope = Envelope::decode(
        move_command(
            &hello.connection_id,
            &hello.session_epoch,
            message_id,
            sequence,
            key,
        )
        .as_slice(),
    )
    .unwrap();
    let Some(envelope::Body::Command(command)) = envelope.body.as_mut() else {
        panic!("expected command");
    };
    command.kind = CommandKind::Stop as i32;
    command.payload.clear();
    envelope.encode_to_vec()
}

#[tokio::test]
async fn move_after_busy_passes_uses_first_unsealed_durable_generation() {
    let path = temp_db("busy-arrival");
    let state =
        TransportState::try_new_with_durable_journal(SessionHub::new_v1(), false, &path).unwrap();
    {
        let mut world = state.world.lock().await;
        world
            .journal_mut()
            .as_async_sqlite_mut()
            .unwrap()
            .inject_delay_next(Duration::from_millis(20));
        assert_eq!(
            world.advance_tick_nonblocking().unwrap(),
            TickAdvance::Submitted { generation: 1 }
        );
        // Keep the sealed tick uninstalled, as when storage outlasts multiple
        // loop passes. No wall-clock wait is needed to reproduce the drift.
        for _ in 0..64 {
            assert_eq!(world.advance_tick_nonblocking().unwrap(), TickAdvance::Busy);
            state.advance_logical_tick();
        }
        assert_eq!(world.next_tick(), 1);
    }
    assert_eq!(state.peek_arrival_tick(), 65);
    let (addr, server) = serve_ephemeral(Arc::clone(&state)).await.unwrap();
    let server_task = tokio::spawn(async move {
        let _ = server.await;
    });
    let (mut ws, hello) = connect(
        &format!("ws://{addr}/ws"),
        ConnectionRole::Aigent,
        b"busy-a",
    )
    .await;
    ws.send(WsMessage::Binary(
        move_command(
            &hello.connection_id,
            &hello.session_epoch,
            1,
            1,
            b"busy-move",
        )
        .into(),
    ))
    .await
    .unwrap();
    assert!(matches!(
        next_command_result(&mut ws).await.outcome,
        Some(command_result::Outcome::Accepted(_))
    ));
    let (generation, body_id) = {
        let mut world = state.world.lock().await;
        assert_eq!(world.wait_durable().unwrap().tick, 1);
        assert_eq!(
            world.body_for_aigent(b"busy-a"),
            None,
            "sealed tick cannot acquire late spawn or MOVE"
        );
        let generation = world.advance_tick().unwrap().clone();
        assert_eq!(generation.tick, 2);
        let body_id = world
            .body_for_aigent(b"busy-a")
            .expect("first eligible tick must bind the body");
        assert!(generation.active_leases.contains_key(&body_id));
        assert_eq!(generation.applied_commands.len(), 2);
        assert_eq!(
            generation
                .applied_commands
                .iter()
                .map(|command| (
                    command.arrival_tick,
                    command.aigent_id.as_slice(),
                    command.sequence,
                    command.canonical_index
                ))
                .collect::<Vec<_>>(),
            vec![
                (2, b"\0busy-a".as_slice(), 1, 0),
                (2, b"busy-a".as_slice(), 1, 1)
            ]
        );
        (generation, body_id)
    };
    assert_eq!(
        state.stamped_arrivals.lock().await.as_slice(),
        &[(hello.connection_id.clone(), 2)]
    );
    state.publish_generation(generation);
    assert_eq!(state.drain_fanout(None).await.delivered, 1);
    assert!(next_full_snapshot_bodies(&mut ws).await.contains(&body_id));
    assert_eq!(
        state.peek_arrival_tick(),
        65,
        "durable catch-up cannot reset pressure clock"
    );
    drop(ws);
    server_task.abort();
    let _ = server_task.await;
    drop(state);
    cleanup(&path);
}

#[tokio::test]
async fn late_stop_preserves_sealed_move_order_after_success_or_retry() {
    for fail_first in [false, true] {
        let path = temp_db(if fail_first {
            "stop-retry"
        } else {
            "stop-success"
        });
        let state =
            TransportState::try_new_with_durable_journal(SessionHub::new_v1(), false, &path)
                .unwrap();
        let (addr, server) = serve_ephemeral(Arc::clone(&state)).await.unwrap();
        let server_task = tokio::spawn(async move {
            let _ = server.await;
        });
        let (mut ws, hello) = connect(
            &format!("ws://{addr}/ws"),
            ConnectionRole::Aigent,
            b"stop-a",
        )
        .await;
        ws.send(WsMessage::Binary(
            move_command(
                &hello.connection_id,
                &hello.session_epoch,
                1,
                1,
                b"sealed-move",
            )
            .into(),
        ))
        .await
        .unwrap();
        assert!(matches!(
            next_command_result(&mut ws).await.outcome,
            Some(command_result::Outcome::Accepted(_))
        ));
        {
            let mut world = state.world.lock().await;
            let writer = world.journal_mut().as_async_sqlite_mut().unwrap();
            writer.inject_delay_next(Duration::from_millis(20));
            if fail_first {
                writer.inject_fail_next(JournalError::Storage("arrival retry fixture".into()));
            }
            assert_eq!(
                world.advance_tick_nonblocking().unwrap(),
                TickAdvance::Submitted { generation: 1 }
            );
        }
        ws.send(WsMessage::Binary(stop_command(&hello).into()))
            .await
            .unwrap();
        assert!(matches!(
            next_command_result(&mut ws).await.outcome,
            Some(command_result::Outcome::Accepted(_))
        ));
        {
            let mut world = state.world.lock().await;
            let first = if fail_first {
                assert!(world.wait_durable().is_err());
                assert_eq!(world.body_for_aigent(b"stop-a"), None);
                world.advance_tick().unwrap().clone()
            } else {
                world.wait_durable().unwrap().clone()
            };
            assert_eq!(first.tick, 1);
            let body_id = world.body_for_aigent(b"stop-a").unwrap();
            assert!(
                first.active_leases.contains_key(&body_id),
                "late STOP must not enter the sealed/retried MOVE tick"
            );
            assert_eq!(first.applied_commands.len(), 2);
            assert!(first
                .applied_commands
                .iter()
                .all(|command| command.arrival_tick == 1));
            let second = world.advance_tick().unwrap();
            assert_eq!(second.tick, 2);
            assert_eq!(
                second.entities.len(),
                1,
                "retry cannot duplicate demo spawn"
            );
            assert!(
                second.active_leases.is_empty(),
                "late STOP must survive success and failure/retry"
            );
            assert_eq!(second.applied_commands.len(), 1);
            assert_eq!(
                (
                    second.applied_commands[0].arrival_tick,
                    second.applied_commands[0].sequence
                ),
                (2, 2)
            );
        }
        drop(ws);
        server_task.abort();
        let _ = server_task.await;
        drop(state);
        cleanup(&path);
    }
}

async fn reconnect_collision_preserves_original_and_replay(fail_then_retry: bool) {
    let path = temp_db(if fail_then_retry {
        "reconnect-retry"
    } else {
        "reconnect-busy"
    });
    let state =
        TransportState::try_new_with_durable_journal(SessionHub::new_v1(), false, &path).unwrap();
    {
        let mut world = state.world.lock().await;
        let writer = world.journal_mut().as_async_sqlite_mut().unwrap();
        if fail_then_retry {
            writer.inject_fail_next(JournalError::Storage("retry-busy fixture".into()));
        }
        assert_eq!(
            world.advance_tick_nonblocking().unwrap(),
            TickAdvance::Submitted { generation: 1 }
        );
    }
    let (addr, server) = serve_ephemeral(Arc::clone(&state)).await.unwrap();
    let server_task = tokio::spawn(async move {
        let _ = server.await;
    });
    let url = format!("ws://{addr}/ws");
    let (mut first, first_hello) = connect(&url, ConnectionRole::Aigent, b"reconnect-a").await;
    first
        .send(WsMessage::Binary(
            move_command(
                &first_hello.connection_id,
                &first_hello.session_epoch,
                1,
                1,
                b"original-move",
            )
            .into(),
        ))
        .await
        .unwrap();
    assert!(matches!(
        next_command_result(&mut first).await.outcome,
        Some(command_result::Outcome::Accepted(_))
    ));
    {
        let mut world = state.world.lock().await;
        if fail_then_retry {
            assert!(world.wait_durable().is_err());
            assert_eq!(
                world.advance_tick_nonblocking().unwrap(),
                TickAdvance::Submitted { generation: 1 }
            );
        }
        for _ in 0..64 {
            assert_eq!(world.advance_tick_nonblocking().unwrap(), TickAdvance::Busy);
            state.advance_logical_tick();
        }
    }
    let (mut second, second_hello) = connect(&url, ConnectionRole::Aigent, b"reconnect-a").await;
    assert_ne!(first_hello.session_epoch, second_hello.session_epoch);
    second
        .send(WsMessage::Binary(
            stop_command_at(&second_hello, 1, 1, b"colliding-stop").into(),
        ))
        .await
        .unwrap();
    let conflict = next_command_result(&mut second).await;
    assert!(matches!(conflict.outcome, Some(command_result::Outcome::Rejected(ref rejection)) if rejection.code == CommandRejectionCode::Conflict as i32),
        "reconnected seq1 collision must reject rather than falsely accept and drop STOP: {conflict:?}");
    second
        .send(WsMessage::Binary(
            stop_command_at(&second_hello, 2, 1, b"colliding-stop").into(),
        ))
        .await
        .unwrap();
    assert!(
        matches!(next_command_result(&mut second).await.outcome, Some(command_result::Outcome::Rejected(ref rejection)) if rejection.code == CommandRejectionCode::Conflict as i32)
    );
    {
        let mut world = state.world.lock().await;
        assert_eq!(world.wait_durable().unwrap().tick, 1);
        let generation = world.advance_tick().unwrap();
        assert_eq!(generation.tick, 2);
        assert_eq!(generation.entities.len(), 1);
        assert_eq!(
            generation.active_leases.len(),
            1,
            "rejected collision cannot replace original MOVE"
        );
        assert_eq!(
            generation.applied_commands.len(),
            2,
            "rejection cannot enqueue a partial or duplicate batch"
        );
        assert!(generation
            .applied_commands
            .iter()
            .all(|command| command.arrival_tick == 2));
    }
    second
        .send(WsMessage::Binary(
            stop_command_at(&second_hello, 3, 2, b"fresh-stop").into(),
        ))
        .await
        .unwrap();
    assert!(matches!(
        next_command_result(&mut second).await.outcome,
        Some(command_result::Outcome::Accepted(_))
    ));
    assert!(state
        .world
        .lock()
        .await
        .advance_tick()
        .unwrap()
        .active_leases
        .is_empty());
    let (mut third, third_hello) = connect(&url, ConnectionRole::Aigent, b"reconnect-a").await;
    third
        .send(WsMessage::Binary(
            stop_command_at(&third_hello, 1, 1, b"colliding-stop").into(),
        ))
        .await
        .unwrap();
    assert!(
        matches!(next_command_result(&mut third).await.outcome, Some(command_result::Outcome::Rejected(ref rejection)) if rejection.code == CommandRejectionCode::Conflict as i32),
        "rejected key must replay across epochs after the colliding batch disappears"
    );
    third
        .send(WsMessage::Binary(
            move_command(
                &third_hello.connection_id,
                &third_hello.session_epoch,
                2,
                2,
                b"original-move",
            )
            .into(),
        ))
        .await
        .unwrap();
    assert!(matches!(
        next_command_result(&mut third).await.outcome,
        Some(command_result::Outcome::Accepted(_))
    ));
    {
        let mut world = state.world.lock().await;
        let generation = world.advance_tick().unwrap();
        assert!(
            generation.applied_commands.is_empty(),
            "replays must not enqueue effects again"
        );
        assert!(generation.active_leases.is_empty());
        assert_eq!(generation.entities.len(), 1);
    }
    drop((first, second, third));
    server_task.abort();
    let _ = server_task.await;
    drop(state);
    cleanup(&path);
}

#[tokio::test]
async fn reconnect_during_busy_rejects_collision_and_preserves_replays() {
    reconnect_collision_preserves_original_and_replay(false).await;
}

#[tokio::test]
async fn reconnect_during_retry_busy_rejects_tentative_remaining_collision() {
    reconnect_collision_preserves_original_and_replay(true).await;
}

#[tokio::test]
async fn rejected_move_batch_does_not_leave_partial_spawn() {
    let state = TransportState::new(SessionHub::new_v1());
    state
        .world
        .lock()
        .await
        .enqueue(world_server::QueuedCommand {
            arrival_tick: 1,
            aigent_id: b"partial-a".to_vec(),
            sequence: 1,
            effect: world_server::CommandEffect::BumpWorldValue { delta: 9 },
        })
        .unwrap();
    let (addr, server) = serve_ephemeral(Arc::clone(&state)).await.unwrap();
    let server_task = tokio::spawn(async move {
        let _ = server.await;
    });
    let (mut ws, hello) = connect(
        &format!("ws://{addr}/ws"),
        ConnectionRole::Aigent,
        b"partial-a",
    )
    .await;
    ws.send(WsMessage::Binary(
        move_command(
            &hello.connection_id,
            &hello.session_epoch,
            1,
            1,
            b"partial-move",
        )
        .into(),
    ))
    .await
    .unwrap();
    let result = next_command_result(&mut ws).await;
    assert!(
        matches!(result.outcome, Some(command_result::Outcome::Rejected(ref rejection)) if rejection.code == CommandRejectionCode::Conflict as i32),
        "batch collision must reject: {result:?}"
    );
    let generation = state.world.lock().await.advance_tick().unwrap().clone();
    assert_eq!(generation.world_value, 9);
    assert!(
        generation.entities.is_empty(),
        "failed MOVE cannot leave its earlier spawn behind"
    );
    assert!(generation.aigent_bodies.is_empty());
    assert_eq!(generation.applied_commands.len(), 1);
    drop(ws);
    server_task.abort();
    let _ = server_task.await;
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
