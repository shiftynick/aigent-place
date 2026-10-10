//! ADR-0013's temporary ownership boundary and actual CLI/listen behavior.
use std::path::{Path, PathBuf};
use std::process::{Command as ProcessCommand, Output, Stdio};
use std::sync::Arc;
use std::time::{Duration, Instant};

use aigent_protocol::{
    command_result, envelope, handshake_frame, ClientHello, Command, CommandKind, CommandMetadata,
    CommandRejectionCode, ConnectionRole, Envelope, HandshakeFrame, MovePayload, ServerHello,
};
use futures_util::{SinkExt, StreamExt};
use prost::Message;
use tokio_tungstenite::tungstenite::Message as WsMessage;
use world_server::{
    CommandEffect, DurableJournal, HeightfieldProfile, JournalError, PositionRequest,
    QueuedCommand, RulesetParameters, SessionHub, TransportState, World, WorldConfig, WorldError,
};

fn temporary(name: &str) -> PathBuf {
    std::env::temp_dir().join(format!("aigent-task069-{}-{name}", std::process::id()))
}

fn clean_sqlite(path: &Path) {
    for suffix in ["", "-wal", "-shm"] {
        let _ = std::fs::remove_file(format!("{}{suffix}", path.display()));
    }
}

fn entity_command() -> QueuedCommand {
    QueuedCommand {
        arrival_tick: 1,
        aigent_id: b"create".to_vec(),
        sequence: 1,
        effect: CommandEffect::CreateEntity {
            position: PositionRequest::new(1.0, 2.0, 3.0),
            shape: None,
        },
    }
}

#[test]
fn marked_memory_clone_recovery_refuses_empty_committed_and_pending_history() {
    for committed in [false, true] {
        let mut world = World::ephemeral_demo_plaza(WorldConfig::default());
        if committed {
            world.enqueue(entity_command()).unwrap();
            world.advance_tick().unwrap();
        }
        let mut journal = world.journal().as_memory().unwrap().clone();
        if committed {
            let mut next = journal.last_committed().unwrap().clone();
            next.generation += 1;
            journal.begin(next).unwrap();
        }
        let before_pending = journal.pending().cloned();
        let before_committed = journal.last_committed().cloned();
        assert_eq!(
            journal.recover(),
            Err(JournalError::EphemeralRecoveryUnsupported)
        );
        assert_eq!(journal.pending().cloned(), before_pending);
        assert_eq!(journal.last_committed().cloned(), before_committed);
        assert_eq!(
            DurableJournal::Memory(journal.clone()).recover(),
            Err(JournalError::EphemeralRecoveryUnsupported)
        );
        assert!(matches!(
            World::recover_from_memory_journal(WorldConfig::default(), journal.clone()),
            Err(WorldError::Persistence(
                JournalError::EphemeralRecoveryUnsupported
            ))
        ));
        assert!(matches!(
            World::recover_from_journal(WorldConfig::default(), DurableJournal::Memory(journal)),
            Err(WorldError::Persistence(
                JournalError::EphemeralRecoveryUnsupported
            ))
        ));
        let fresh = World::ephemeral_demo_plaza(WorldConfig::default());
        assert!(fresh.entities().snapshots().is_empty());
        assert_eq!(fresh.entities().next_entity_id(), 1);
        assert_eq!(fresh.next_tick(), 1);
    }
    assert!(world_server::InMemoryJournal::new().recover().is_ok());
}

fn assert_swap_rejected(mut world: World, wrong: DurableJournal) {
    world.enqueue(entity_command()).unwrap();
    let world_is_demo_plaza =
        world.heightfield().profile() == HeightfieldProfile::EphemeralDemoPlazaV1;
    let error = WorldError::JournalProfileMismatch {
        world_is_demo_plaza,
        journal_is_demo_plaza: !world_is_demo_plaza,
    };
    let original = std::mem::replace(world.journal_mut(), wrong);
    let before = world.entities().snapshots();
    let ruleset = world.rulesets().live().clone();
    let mut extra = entity_command();
    extra.sequence = 2;
    assert_eq!(world.enqueue(extra), Err(error.clone()));
    assert_eq!(
        world.schedule_ruleset(RulesetParameters::catalog_defaults()),
        Err(error.clone())
    );
    assert_eq!(world.advance_tick_nonblocking(), Err(error.clone()));
    assert_eq!(world.advance_tick().unwrap_err(), error);
    assert!(matches!(
        world.poll_durable(),
        Err(WorldError::JournalProfileMismatch { .. })
    ));
    assert!(matches!(
        world.wait_durable(),
        Err(WorldError::JournalProfileMismatch { .. })
    ));
    assert_eq!(world.next_tick(), 1);
    assert_eq!(world.last_completed_tick(), 0);
    assert_eq!(world.entities().snapshots(), before);
    assert_eq!(world.entities().next_entity_id(), 1);
    assert_eq!(world.rulesets().live(), &ruleset);
    assert!(world.last_generation().is_none());
    assert!(world.journal().pending().is_none());
    assert!(world.journal().last_committed().is_none());
    *world.journal_mut() = original;
    let generation = world.advance_tick().unwrap();
    assert_eq!(
        generation.applied_commands.len(),
        1,
        "original pending command preserved; rejected command not queued"
    );
    assert_eq!(generation.next_entity_id, 2);
}

#[test]
fn two_sided_journal_swaps_refuse_before_queue_clock_ids_or_commit() {
    let marked = World::ephemeral_demo_plaza(WorldConfig::default())
        .journal()
        .as_memory()
        .unwrap()
        .clone();
    assert_swap_rejected(
        World::new(WorldConfig::default()),
        DurableJournal::Memory(marked.clone()),
    );
    assert_swap_rejected(
        World::ephemeral_demo_plaza(WorldConfig::default()),
        DurableJournal::memory(),
    );
    let mut bad_constructor =
        World::with_journal(WorldConfig::default(), DurableJournal::Memory(marked));
    assert!(matches!(
        bad_constructor.advance_tick(),
        Err(WorldError::JournalProfileMismatch { .. })
    ));
    assert_eq!(bad_constructor.next_tick(), 1);
    for asynchronous in [false, true] {
        let path = temporary(if asynchronous {
            "swap-async.sqlite"
        } else {
            "swap-sync.sqlite"
        });
        clean_sqlite(&path);
        let journal = if asynchronous {
            DurableJournal::async_sqlite(&path)
        } else {
            DurableJournal::sqlite(&path)
        }
        .unwrap();
        assert_swap_rejected(World::ephemeral_demo_plaza(WorldConfig::default()), journal);
        let noise = World::recover_from_journal(
            WorldConfig::default(),
            DurableJournal::sqlite(&path).unwrap(),
        )
        .unwrap();
        assert!(noise.entities().snapshots().is_empty());
        assert_eq!(noise.next_tick(), 1);
        drop(noise);
        clean_sqlite(&path);
    }
}

fn run_cli(args: &[String], cwd: &Path) -> Output {
    let mut child = ProcessCommand::new(env!("CARGO_BIN_EXE_world-server"))
        .args(args)
        .current_dir(cwd)
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .unwrap();
    let deadline = Instant::now() + Duration::from_secs(3);
    let exited = loop {
        if child.try_wait().unwrap().is_some() {
            break true;
        }
        if Instant::now() >= deadline {
            child.kill().unwrap();
            break false;
        }
        std::thread::sleep(Duration::from_millis(10));
    };
    let output = child.wait_with_output().unwrap();
    assert!(
        exited,
        "CLI failed to reject/exit before serving: {}",
        String::from_utf8_lossy(&output.stderr)
    );
    output
}

#[test]
fn cli_plaza_journal_conflict_rejects_before_path_touch_or_listen() {
    let directory = temporary("cli-conflict");
    std::fs::create_dir_all(&directory).unwrap();
    for existing in [false, true] {
        let path = directory.join(if existing {
            "existing.sqlite"
        } else {
            "missing.sqlite"
        });
        if existing {
            std::fs::write(&path, b"unchanged invalid SQLite sentinel").unwrap();
        }
        for flag_first in [false, true] {
            let mut args = vec!["--listen".to_string(), "127.0.0.1:0".to_string()];
            if flag_first {
                args.push("--demo-plaza".into());
            }
            args.extend(["--journal".into(), path.to_str().unwrap().to_string()]);
            if !flag_first {
                args.push("--demo-plaza".into());
            }
            let output = run_cli(&args, &directory);
            assert_eq!(output.status.code(), Some(2));
            assert!(
                String::from_utf8_lossy(&output.stderr).contains("cannot combine with --journal")
            );
            if existing {
                assert_eq!(
                    std::fs::read(&path).unwrap(),
                    b"unchanged invalid SQLite sentinel"
                );
            } else {
                assert!(!path.exists());
            }
            assert!(!PathBuf::from(format!("{}-wal", path.display())).exists());
            assert!(!PathBuf::from(format!("{}-shm", path.display())).exists());
        }
    }
    let help = run_cli(&["--help".into()], &directory);
    assert!(help.status.success());
    let text = String::from_utf8_lossy(&help.stderr);
    for phrase in [
        "--demo-plaza",
        "temporary in-memory",
        "resets on restart",
        "noise terrain",
    ] {
        assert!(text.contains(phrase), "missing help disclosure: {phrase}");
    }
    std::fs::remove_dir_all(directory).unwrap();
}

struct OwnedProcess(std::process::Child);
impl Drop for OwnedProcess {
    fn drop(&mut self) {
        if self.0.try_wait().ok().flatten().is_none() {
            let _ = self.0.kill();
        }
        let _ = self.0.wait();
    }
}

#[tokio::test]
async fn cli_plaza_startup_discloses_temporary_reset_without_sqlite_artifact() {
    let directory = temporary("cli-startup");
    std::fs::create_dir_all(&directory).unwrap();
    let logpath = directory.join("startup.log");
    let log = std::fs::File::create(&logpath).unwrap();
    let reserved = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
    let address = reserved.local_addr().unwrap();
    drop(reserved);
    let mut child = OwnedProcess(
        ProcessCommand::new(env!("CARGO_BIN_EXE_world-server"))
            .args(["--listen", &address.to_string(), "--demo-plaza"])
            .current_dir(&directory)
            .stdout(Stdio::null())
            .stderr(log)
            .spawn()
            .unwrap(),
    );
    let deadline = Instant::now() + Duration::from_secs(3);
    let text = loop {
        let text = std::fs::read_to_string(&logpath).unwrap();
        if text.contains("temporary demo plaza") {
            break text;
        }
        if child.0.try_wait().unwrap().is_some() || Instant::now() >= deadline {
            break text;
        }
        std::thread::sleep(Duration::from_millis(10));
    };
    assert!(text.contains("temporary demo plaza"), "{text}");
    assert!(
        text.contains("marked in-memory state resets on restart"),
        "{text}"
    );
    assert!(text.contains("two demo bindings"), "{text}");
    let ready_deadline = Instant::now() + Duration::from_secs(3);
    loop {
        if std::net::TcpStream::connect(address).is_ok() {
            break;
        }
        assert!(
            Instant::now() < ready_deadline,
            "owned CLI server did not bind"
        );
        assert!(
            child.0.try_wait().unwrap().is_none(),
            "owned CLI server exited before bind"
        );
        std::thread::sleep(Duration::from_millis(10));
    }
    let url = format!("ws://{address}/ws");
    let (mut socket, hello) = connect(&url, b"actual-cli-plaza").await;
    assert!(matches!(
        send_move(&mut socket, &hello, 1).await.outcome,
        Some(command_result::Outcome::Accepted(_))
    ));
    let position = tokio::time::timeout(Duration::from_secs(2), async {
        loop {
            let message = socket.next().await.unwrap().unwrap();
            let WsMessage::Binary(bytes) = message else {
                continue;
            };
            let records = match Envelope::decode(bytes.as_ref()).unwrap().body {
                Some(envelope::Body::FullSnapshot(full)) => {
                    aigent_protocol::WorldSnapshotBodyProto::decode(full.payload.as_slice())
                        .unwrap()
                        .bodies
                }
                Some(envelope::Body::SnapshotDelta(delta)) => {
                    let delta =
                        aigent_protocol::WorldSnapshotDeltaProto::decode(delta.payload.as_slice())
                            .unwrap();
                    delta.entered.into_iter().chain(delta.modified).collect()
                }
                _ => continue,
            };
            if let Some(body) = records.into_iter().next() {
                break body.position_mm.unwrap();
            }
        }
    })
    .await
    .expect("actual CLI body observation");
    assert_eq!(
        position.y_mm, 900,
        "CLI flag must create actual flat profile, not just print a label"
    );
    drop(child);
    assert_eq!(
        std::fs::read_dir(&directory).unwrap().count(),
        1,
        "only the owned log exists; no SQLite journal"
    );
    std::fs::remove_dir_all(directory).unwrap();
}

type Socket =
    tokio_tungstenite::WebSocketStream<tokio_tungstenite::MaybeTlsStream<tokio::net::TcpStream>>;
async fn connect(url: &str, id: &[u8]) -> (Socket, ServerHello) {
    let (mut socket, _) = tokio_tungstenite::connect_async(url).await.unwrap();
    socket
        .send(WsMessage::Binary(
            HandshakeFrame {
                body: Some(handshake_frame::Body::ClientHello(ClientHello {
                    role: ConnectionRole::Aigent as i32,
                    offered_protocol_majors: vec![1],
                    offered_features: vec![],
                    aigent_id: id.to_vec(),
                })),
            }
            .encode_to_vec()
            .into(),
        ))
        .await
        .unwrap();
    let message = tokio::time::timeout(Duration::from_secs(2), socket.next())
        .await
        .unwrap()
        .unwrap()
        .unwrap();
    let WsMessage::Binary(bytes) = message else {
        panic!("binary hello expected");
    };
    let Some(handshake_frame::Body::ServerHello(hello)) =
        HandshakeFrame::decode(bytes.as_ref()).unwrap().body
    else {
        panic!("accepted hello expected");
    };
    (socket, hello)
}
async fn send_move(
    socket: &mut Socket,
    hello: &ServerHello,
    sequence: u64,
) -> aigent_protocol::CommandResult {
    socket
        .send(WsMessage::Binary(
            Envelope {
                protocol_major: 1,
                connection_id: hello.connection_id.clone(),
                message_id: sequence,
                metadata: Some(aigent_protocol::EnvelopeMetadata {
                    required_features: vec![],
                }),
                body: Some(envelope::Body::Command(Command {
                    metadata: Some(CommandMetadata {
                        session_epoch: hello.session_epoch.clone(),
                        sequence,
                        idempotency_key: format!("plaza/{sequence}").into_bytes(),
                    }),
                    kind: CommandKind::Move as i32,
                    payload: MovePayload {
                        target_x_mm: 6000,
                        target_z_mm: 0,
                        speed_mm_per_s: 500,
                    }
                    .encode_to_vec(),
                })),
            }
            .encode_to_vec()
            .into(),
        ))
        .await
        .unwrap();
    loop {
        let message = tokio::time::timeout(Duration::from_secs(2), socket.next())
            .await
            .unwrap()
            .unwrap()
            .unwrap();
        let WsMessage::Binary(bytes) = message else {
            continue;
        };
        if let Some(envelope::Body::CommandResult(result)) =
            Envelope::decode(bytes.as_ref()).unwrap().body
        {
            return result;
        }
    }
}

#[tokio::test]
async fn actual_websocket_third_join_conflict_and_same_process_reconnect() {
    let state = TransportState::new_demo_plaza(SessionHub::new_v1(), false);
    let (address, server) = world_server::serve_ephemeral(Arc::clone(&state))
        .await
        .unwrap();
    let task = tokio::spawn(async move {
        let _ = server.await;
    });
    let url = format!("ws://{address}/ws");
    let (mut a, ha) = connect(&url, b"plaza-a").await;
    let (mut b, hb) = connect(&url, b"plaza-b").await;
    let (mut c, hc) = connect(&url, b"plaza-c").await;
    assert!(matches!(
        send_move(&mut a, &ha, 1).await.outcome,
        Some(command_result::Outcome::Accepted(_))
    ));
    assert!(matches!(
        send_move(&mut b, &hb, 1).await.outcome,
        Some(command_result::Outcome::Accepted(_))
    ));
    assert!(
        matches!(send_move(&mut c,&hc,1).await.outcome,Some(command_result::Outcome::Rejected(ref rejection)) if rejection.code==CommandRejectionCode::Conflict as i32)
    );
    let body_a = {
        let mut world = state.world.lock().await;
        let generation = world.advance_tick().unwrap();
        assert_eq!(generation.entities.len(), 2);
        assert_eq!(generation.next_entity_id, 3);
        assert!(!generation.aigent_bodies.contains_key(b"plaza-c".as_slice()));
        assert_eq!(generation.active_leases.len(), 2);
        generation.aigent_bodies[b"plaza-a".as_slice()]
    };
    a.close(None).await.unwrap();
    let (mut reconnect, hr) = connect(&url, b"plaza-a").await;
    assert_ne!(ha.session_epoch, hr.session_epoch);
    assert!(matches!(
        send_move(&mut reconnect, &hr, 1).await.outcome,
        Some(command_result::Outcome::Accepted(_))
    ));
    let mut world = state.world.lock().await;
    world.advance_tick().unwrap();
    assert_eq!(world.body_for_aigent(b"plaza-a"), Some(body_a));
    assert_eq!(world.entities().next_entity_id(), 3);
    assert_eq!(world.body_for_aigent(b"plaza-c"), None);
    drop(world);
    task.abort();
}
