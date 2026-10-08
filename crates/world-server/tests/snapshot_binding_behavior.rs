//! ADR-0011 same-generation private binding and public physical movement aims.
use std::sync::Arc;
use std::time::Duration;

use aigent_protocol::{
    envelope, handshake_frame, ClientHello, ConnectionRole, Envelope, HandshakeFrame,
    WorldSnapshotBodyProto, WorldSnapshotDeltaProto,
};
use futures_util::{SinkExt, StreamExt};
use prost::Message;
use tokio_tungstenite::tungstenite::Message as WsMessage;
use world_server::{
    serve_ephemeral, EntitySnapshot, ImmutableGeneration, LeaseSnapshot, Position, SessionHub,
    TransportState, World, WorldConfig,
};

type Socket =
    tokio_tungstenite::WebSocketStream<tokio_tungstenite::MaybeTlsStream<tokio::net::TcpStream>>;

fn generation() -> ImmutableGeneration {
    let mut world = World::new(WorldConfig::default());
    let mut generation = world.advance_tick().unwrap().clone();
    for id in [7, 9] {
        generation.entities.insert(
            id,
            EntitySnapshot {
                entity_id: id,
                revision: 1,
                position: Position::origin(),
                shape: None,
            },
        );
    }
    generation.aigent_bodies.insert(b"a".to_vec(), 7);
    generation.aigent_bodies.insert(b"b".to_vec(), 9);
    generation.active_leases.insert(
        7,
        LeaseSnapshot {
            body_id: 7,
            aigent_id: b"a".to_vec(),
            sequence: 1,
            granted_tick: 1,
            expire_tick: 201,
            target_x_mm: 1500,
            target_z_mm: -500,
            speed_mm_per_s: 500,
            consecutive_no_progress_ticks: 0,
        },
    );
    generation
}

async fn connect(url: &str, role: ConnectionRole, id: &[u8]) -> (Socket, Vec<u8>) {
    let (mut socket, _) = tokio_tungstenite::connect_async(url).await.unwrap();
    socket
        .send(WsMessage::Binary(
            HandshakeFrame {
                body: Some(handshake_frame::Body::ClientHello(ClientHello {
                    role: role as i32,
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
    let WsMessage::Binary(bytes) = socket.next().await.unwrap().unwrap() else {
        panic!("binary hello");
    };
    let Some(handshake_frame::Body::ServerHello(hello)) =
        HandshakeFrame::decode(bytes.as_ref()).unwrap().body
    else {
        panic!("server hello");
    };
    (socket, hello.connection_id)
}

async fn frame(socket: &mut Socket) -> envelope::Body {
    for _ in 0..16 {
        let next = tokio::time::timeout(Duration::from_secs(2), socket.next())
            .await
            .unwrap()
            .unwrap()
            .unwrap();
        if let WsMessage::Binary(bytes) = next {
            let body = Envelope::decode(bytes.as_ref()).unwrap().body.unwrap();
            if matches!(
                body,
                envelope::Body::FullSnapshot(_) | envelope::Body::SnapshotDelta(_)
            ) {
                return body;
            }
        }
    }
    panic!("snapshot missing");
}

#[tokio::test]
async fn wire_binding_is_private_generation_atomic_and_recovers_on_reconnect_resync() {
    let state = TransportState::new(SessionHub::new_v1());
    let (addr, server) = serve_ephemeral(Arc::clone(&state)).await.unwrap();
    let task = tokio::spawn(async move {
        let _ = server.await;
    });
    let url = format!("ws://{addr}/ws");
    let (mut a, aid) = connect(&url, ConnectionRole::Aigent, b"a").await;
    let (mut b, _) = connect(&url, ConnectionRole::Aigent, b"b").await;
    let (mut viewer, _) = connect(&url, ConnectionRole::Viewer, b"").await;
    let mut old = generation();
    old.aigent_bodies.clear();
    old.active_leases.clear();
    state
        .world
        .lock()
        .await
        .bind_aigent_body_for_test(b"a".to_vec(), 9);
    state.publish_generation(old.clone());
    state.drain_fanout(None).await;
    for socket in [&mut a, &mut b, &mut viewer] {
        let envelope::Body::FullSnapshot(full) = frame(socket).await else {
            panic!("first full");
        };
        let full = WorldSnapshotBodyProto::decode(full.payload.as_slice()).unwrap();
        assert_eq!(
            full.self_body_id, None,
            "unbound old generation cannot use mutable-world binding or hash focus"
        );
    }
    let bound = generation();
    state.publish_generation(bound.clone());
    state.drain_fanout(None).await;
    for (socket, expected) in [(&mut a, Some(7)), (&mut b, Some(9)), (&mut viewer, None)] {
        let envelope::Body::SnapshotDelta(delta) = frame(socket).await else {
            panic!("binding delta");
        };
        let delta = WorldSnapshotDeltaProto::decode(delta.payload.as_slice()).unwrap();
        assert_eq!(delta.self_body_id, expected);
        assert_eq!(delta.modified[0].aim.as_ref().unwrap().target_x_mm, 1500);
    }
    // Same pose and revision: only the physical intent changes.
    let mut changed = bound.clone();
    changed.active_leases.get_mut(&7).unwrap().target_x_mm = 2500;
    state.publish_generation(changed.clone());
    state.drain_fanout(None).await;
    for socket in [&mut a, &mut b, &mut viewer] {
        let envelope::Body::SnapshotDelta(delta) = frame(socket).await else {
            panic!("aim delta");
        };
        let delta = WorldSnapshotDeltaProto::decode(delta.payload.as_slice()).unwrap();
        assert_eq!(delta.modified.len(), 1);
        assert_eq!(delta.modified[0].revision, 1);
        assert_eq!(delta.modified[0].aim.as_ref().unwrap().target_x_mm, 2500);
    }
    changed.active_leases.clear();
    changed.aigent_bodies.remove(b"a".as_slice());
    state.publish_generation(changed.clone());
    state.drain_fanout(None).await;
    for (socket, expected) in [(&mut a, None), (&mut b, Some(9)), (&mut viewer, None)] {
        let envelope::Body::SnapshotDelta(delta) = frame(socket).await else {
            panic!("removal delta");
        };
        let delta = WorldSnapshotDeltaProto::decode(delta.payload.as_slice()).unwrap();
        assert_eq!(delta.self_body_id, expected, "absence restates unbound");
        assert_eq!(delta.modified.len(), 1);
        assert!(delta.modified[0].aim.is_none());
    }
    // Resync uses the supplied published generation, not cached binding.
    let size = |_frame: &world_server::RealFrameShape<'_>| 128;
    let mut fanout = state.fanout.lock().await;
    let (_, full, _, _) = fanout
        .client_resync_real(&aid, &bound, &size)
        .unwrap()
        .unwrap();
    assert_eq!(full.self_body_id, Some(7));
    assert!(full
        .bodies
        .iter()
        .find(|record| record.entity_id == 7)
        .unwrap()
        .aim
        .is_some());
    drop(fanout);
    // No world generation has been committed in this synthetic schedule.
    // The transport resync fallback must clear even an already cached binding.
    assert!(state.deliver_client_resync(&aid).await);
    let envelope::Body::FullSnapshot(fallback) = frame(&mut a).await else {
        panic!("fallback resync full");
    };
    assert_eq!(
        WorldSnapshotBodyProto::decode(fallback.payload.as_slice())
            .unwrap()
            .self_body_id,
        None
    );
    let (mut reconnected, _) = connect(&url, ConnectionRole::Aigent, b"a").await;
    state.publish_generation(bound);
    state.drain_fanout(None).await;
    let envelope::Body::FullSnapshot(full) = frame(&mut reconnected).await else {
        panic!("reconnect full");
    };
    assert_eq!(
        WorldSnapshotBodyProto::decode(full.payload.as_slice())
            .unwrap()
            .self_body_id,
        Some(7)
    );
    let _ = reconnected.close(None).await;
    let _ = b.close(None).await;
    let _ = viewer.close(None).await;
    task.abort();
}

#[test]
fn real_arrival_and_expiry_remove_public_aim_from_delta_and_resync() {
    use aigent_protocol::{
        shape_node::Primitive, BoxPrimitive, LocalTransform, Quaternion, ShapeNode, ShapeTree,
        Vector3Millimeters,
    };
    use world_server::{
        CommandEffect, MoveIntent, PositionRequest, QueuedCommand, RealPublishOutcome, ShapeSlot,
        SnapshotFanout,
    };
    for ttl_ms in [10_000, 50] {
        let mut world = World::new(WorldConfig::default());
        let shape = ShapeSlot::from_encoded(
            ShapeTree {
                nodes: vec![ShapeNode {
                    node_id: 1,
                    parent_node_id: 0,
                    transform: Some(LocalTransform {
                        translation: Some(Vector3Millimeters::default()),
                        rotation: Some(Quaternion {
                            w: 1.0,
                            ..Default::default()
                        }),
                    }),
                    primitive: Some(Primitive::Box(BoxPrimitive {
                        size_x_mm: 1000,
                        size_y_mm: 1000,
                        size_z_mm: 1000,
                    })),
                    ..Default::default()
                }],
            }
            .encode_to_vec(),
        );
        world
            .enqueue(QueuedCommand {
                arrival_tick: 1,
                aigent_id: b"a".to_vec(),
                sequence: 1,
                effect: CommandEffect::CreateAndBindDemoBody {
                    aigent_id: b"a".to_vec(),
                    position: PositionRequest::new(0.0, 1.0, 0.0),
                    shape,
                },
            })
            .unwrap();
        world.advance_tick().unwrap();
        let id = world.body_for_aigent(b"a").unwrap();
        world
            .enqueue(QueuedCommand {
                arrival_tick: 2,
                aigent_id: b"a".to_vec(),
                sequence: 2,
                effect: CommandEffect::UpsertMoveLease {
                    body_id: Some(id),
                    intent: MoveIntent {
                        target_x_mm: if ttl_ms == 50 { 1500 } else { 50 },
                        target_z_mm: 0,
                        speed_mm_per_s: 500,
                    },
                    ttl_ms: Some(ttl_ms),
                },
            })
            .unwrap();
        let moving = world.advance_tick().unwrap().clone();
        assert!(moving.active_leases.contains_key(&id));
        let mut fanout = SnapshotFanout::new();
        fanout.attach(b"c".to_vec());
        fanout.get_mut(b"c").unwrap().role = world_server::ConnectionRole::Aigent;
        fanout.get_mut(b"c").unwrap().aigent_id = Some(b"a".to_vec());
        let size = |_frame: &world_server::RealFrameShape<'_>| 128;
        let RealPublishOutcome::FullSnapshot { wire_bytes, .. } = fanout
            .publish_real_interest_to(b"c", &moving, &size)
            .unwrap()
        else {
            panic!("full");
        };
        assert!(WorldSnapshotBodyProto::decode(wire_bytes.as_slice())
            .unwrap()
            .bodies[0]
            .aim
            .is_some());
        let ended = world.advance_tick().unwrap().clone();
        assert!(!ended.active_leases.contains_key(&id));
        if ttl_ms == 50 {
            assert_eq!(
                ended.lease_terminations[0].reason,
                world_server::LeaseTerminationReason::Expired
            );
        } else {
            assert_eq!(ended.entities[&id].position.x(), 0.05);
            assert!(ended.lease_terminations.is_empty());
        }
        let RealPublishOutcome::Delta { wire_bytes, .. } = fanout
            .publish_real_interest_to(b"c", &ended, &size)
            .unwrap()
        else {
            panic!("delta");
        };
        let delta = WorldSnapshotDeltaProto::decode(wire_bytes.as_slice()).unwrap();
        assert_eq!(delta.self_body_id, Some(id));
        assert_eq!(delta.modified.len(), 1);
        assert!(delta.modified[0].aim.is_none());
        let (_, full, _, _) = fanout
            .client_resync_real(b"c", &ended, &size)
            .unwrap()
            .unwrap();
        assert_eq!(full.self_body_id, Some(id));
        assert!(full.bodies[0].aim.is_none());
    }
}
