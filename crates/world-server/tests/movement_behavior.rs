//! Swept movement with typed MOVE payload (task-051).

use aigent_protocol::{
    shape_node::Primitive, BoxPrimitive, ColorRgba, LocalTransform, Quaternion, ShapeNode,
    ShapeTree, Vector3Millimeters,
};
use prost::Message;
use world_server::{
    decode_move_payload, encode_move_payload, CommandEffect, MoveIntent, PositionRequest,
    QueuedCommand, RulesetParameters, ShapeSlot, World, WorldConfig, DEFAULT_BLOCKED_LEASE_TICKS,
    DEFAULT_MAX_SPEED_MM_PER_S, DEFAULT_SWEEP_MAX_MM,
};

fn box_shape(size_x: i64, size_y: i64, size_z: i64) -> ShapeSlot {
    let tree = ShapeTree {
        nodes: vec![ShapeNode {
            node_id: 1,
            parent_node_id: 0,
            transform: Some(LocalTransform {
                translation: Some(Vector3Millimeters {
                    x_mm: 0,
                    y_mm: 0,
                    z_mm: 0,
                }),
                rotation: Some(Quaternion {
                    x: 0.0,
                    y: 0.0,
                    z: 0.0,
                    w: 1.0,
                }),
            }),
            joint_name: None,
            color: Some(ColorRgba {
                red: 1,
                green: 1,
                blue: 1,
                alpha: 255,
            }),
            material_tags: Vec::new(),
            primitive: Some(Primitive::Box(BoxPrimitive {
                size_x_mm: size_x,
                size_y_mm: size_y,
                size_z_mm: size_z,
            })),
        }],
    };
    ShapeSlot::from_encoded(tree.encode_to_vec())
}

fn cmd(tick: u64, aigent: &[u8], sequence: u64, effect: CommandEffect) -> QueuedCommand {
    QueuedCommand {
        arrival_tick: tick,
        aigent_id: aigent.to_vec(),
        sequence,
        effect,
    }
}

#[test]
fn catalog_includes_movement_physics_paths() {
    let defaults = RulesetParameters::catalog_defaults();
    assert_eq!(
        defaults.get("movement.max_speed_mm_per_s"),
        Some(i64::from(DEFAULT_MAX_SPEED_MM_PER_S))
    );
    assert_eq!(
        defaults.get("movement.blocked_lease_ticks"),
        Some(i64::from(DEFAULT_BLOCKED_LEASE_TICKS))
    );
    assert_eq!(
        defaults.get("physics.sweep_max_mm"),
        Some(i64::from(DEFAULT_SWEEP_MAX_MM))
    );
    let mut bad = RulesetParameters::catalog_defaults();
    bad.set("movement.max_speed_mm_per_s", 0);
    assert!(world_server::validate_candidate(&bad).is_err());
}

#[test]
fn move_payload_round_trip_and_rejects_malformed() {
    let intent = MoveIntent::new(1_500, -2_000, 3_000).unwrap();
    let bytes = encode_move_payload(intent);
    assert_eq!(decode_move_payload(&bytes).unwrap(), intent);
    assert!(decode_move_payload(&[]).is_err());
    let mut with_unknown = bytes.clone();
    with_unknown.extend_from_slice(&[0xa0, 0x06, 0x01]);
    assert_eq!(decode_move_payload(&with_unknown).unwrap(), intent);
    assert!(decode_move_payload(&[0x08]).is_err());
}

#[test]
fn zero_length_move_is_noop_without_revision_bump() {
    let mut world = World::new(WorldConfig::default());
    let shape = box_shape(1_000, 1_000, 1_000);
    world
        .enqueue(cmd(
            1,
            b"a",
            1,
            CommandEffect::CreateAndBindDemoBody {
                aigent_id: b"a".to_vec(),
                position: PositionRequest::new(0.0, 1.0, 0.0),
                shape,
            },
        ))
        .unwrap();
    world.advance_tick().unwrap();
    let body = world.body_for_aigent(b"a").unwrap();
    let before = world.entities().get(body).unwrap().clone();

    world
        .enqueue(cmd(
            2,
            b"a",
            2,
            CommandEffect::UpsertMoveLease {
                body_id: Some(body),
                intent: MoveIntent {
                    target_x_mm: 0,
                    target_z_mm: 0,
                    speed_mm_per_s: 1_000,
                },
                ttl_ms: Some(10_000),
            },
        ))
        .unwrap();
    world.advance_tick().unwrap();
    let after = world.entities().get(body).unwrap();
    assert_eq!(after.revision, before.revision);
    assert_eq!(after.position, before.position);
}

#[test]
fn lease_moves_body_and_increments_revision_once() {
    let mut world = World::new(WorldConfig::default());
    let shape = box_shape(1_000, 1_000, 1_000);
    world
        .enqueue(cmd(
            1,
            b"\0setup",
            1,
            CommandEffect::CreateAndBindDemoBody {
                aigent_id: b"pilot".to_vec(),
                position: PositionRequest::new(0.0, 1.0, 0.0),
                shape,
            },
        ))
        .unwrap();
    world
        .enqueue(cmd(
            1,
            b"pilot",
            1,
            CommandEffect::UpsertMoveLease {
                body_id: None,
                intent: MoveIntent {
                    target_x_mm: 10_000,
                    target_z_mm: 0,
                    speed_mm_per_s: 5_000, // 250 mm/tick at 50ms
                },
                ttl_ms: Some(10_000),
            },
        ))
        .unwrap();
    let gen = world.advance_tick().unwrap().clone();
    let body = world.body_for_aigent(b"pilot").unwrap();
    let entity = world.entities().get(body).unwrap();
    assert!(entity.position.x() > 0.0, "x={}", entity.position.x());
    assert_eq!(entity.revision, 2);
    assert!(gen.active_leases.contains_key(&body));
}

#[test]
fn low_speed_moves_without_integer_tick_stall() {
    let mut world = World::new(WorldConfig::default());
    world
        .enqueue(cmd(
            1,
            b"\0setup",
            1,
            CommandEffect::CreateAndBindDemoBody {
                aigent_id: b"slow".to_vec(),
                position: PositionRequest::new(0.0, 1.0, 0.0),
                shape: box_shape(1_000, 1_000, 1_000),
            },
        ))
        .unwrap();
    world.advance_tick().unwrap();
    let body = world.body_for_aigent(b"slow").unwrap();
    let before = world.entities().get(body).unwrap().position.x();
    world
        .enqueue(cmd(
            2,
            b"slow",
            1,
            CommandEffect::UpsertMoveLease {
                body_id: Some(body),
                intent: MoveIntent::new(1_000, 0, 1).unwrap(),
                ttl_ms: Some(10_000),
            },
        ))
        .unwrap();
    world.advance_tick().unwrap();
    assert!(world.entities().get(body).unwrap().position.x() > before);
}

#[test]
fn two_commands_same_tick_see_geometry_in_canonical_order() {
    let mut world = World::new(WorldConfig::default());
    let shape = box_shape(100, 1_800, 100);
    // Create two bodies.
    world
        .enqueue(cmd(
            1,
            b"\0a",
            1,
            CommandEffect::CreateAndBindDemoBody {
                aigent_id: b"aigent-1".to_vec(),
                position: PositionRequest::new(0.30, 1.0, 0.30),
                shape: shape.clone(),
            },
        ))
        .unwrap();
    world
        .enqueue(cmd(
            1,
            b"\0b",
            1,
            CommandEffect::CreateAndBindDemoBody {
                aigent_id: b"aigent-2".to_vec(),
                position: PositionRequest::new(0.45, 1.0, 0.30),
                shape,
            },
        ))
        .unwrap();
    world.advance_tick().unwrap();
    let left = world.body_for_aigent(b"aigent-1").unwrap();
    let right = world.body_for_aigent(b"aigent-2").unwrap();

    // Make both bodies active before the contested tick. At 1 mm/s each body
    // moves only 0.05 mm outward, preserving a 50.1 mm gap while ensuring
    // either body must remain a collider when only its peer is selected.
    for (aigent, body, target_x) in [
        (b"aigent-1".as_slice(), left, 0),
        (b"aigent-2".as_slice(), right, 1_000),
    ] {
        world
            .enqueue(cmd(
                2,
                aigent,
                1,
                CommandEffect::UpsertMoveLease {
                    body_id: Some(body),
                    intent: MoveIntent::new(target_x, 300, 1).unwrap(),
                    ttl_ms: Some(10_000),
                },
            ))
            .unwrap();
    }
    world.advance_tick().unwrap();

    // Both move toward origin; earlier aigent-id wins visibility.
    world
        .enqueue(cmd(
            3,
            b"aigent-2",
            2,
            CommandEffect::UpsertMoveLease {
                body_id: Some(right),
                intent: MoveIntent {
                    target_x_mm: 0,
                    target_z_mm: 300,
                    speed_mm_per_s: 50_000,
                },
                ttl_ms: Some(10_000),
            },
        ))
        .unwrap();
    world
        .enqueue(cmd(
            3,
            b"aigent-1",
            2,
            CommandEffect::UpsertMoveLease {
                body_id: Some(left),
                intent: MoveIntent {
                    target_x_mm: 1_000,
                    target_z_mm: 300,
                    speed_mm_per_s: 50_000,
                },
                ttl_ms: Some(10_000),
            },
        ))
        .unwrap();
    world.advance_tick().unwrap();
    let left_pos = world.entities().get(left).unwrap().position;
    let right_pos = world.entities().get(right).unwrap().position;
    // The canonical first body sees the already-active second body and stops
    // at contact after about 50.1 mm. Without the all-active collision set it
    // would travel the full 250 mm to approximately 0.54995 m.
    assert!(
        (left_pos.x() - 0.35005).abs() < 1e-9,
        "left={} right={}",
        left_pos.x(),
        right_pos.x()
    );
    assert!((right_pos.x() - 0.45005).abs() < 1e-9);
}

#[test]
fn same_tick_move_renewals_cannot_multiply_travel() {
    let mut world = World::new(WorldConfig::default());
    world
        .enqueue(cmd(
            1,
            b"\0runner",
            1,
            CommandEffect::CreateAndBindDemoBody {
                aigent_id: b"runner".to_vec(),
                position: PositionRequest::new(0.25, 1.0, 0.25),
                shape: box_shape(100, 1_000, 100),
            },
        ))
        .unwrap();
    world.advance_tick().unwrap();
    let body = world.body_for_aigent(b"runner").unwrap();
    let before = world.entities().get(body).unwrap().position.x();
    for sequence in [1, 2] {
        world
            .enqueue(cmd(
                2,
                b"runner",
                sequence,
                CommandEffect::UpsertMoveLease {
                    body_id: Some(body),
                    intent: MoveIntent::new(900, 250, 5_000).unwrap(),
                    ttl_ms: Some(10_000),
                },
            ))
            .unwrap();
    }
    world.advance_tick().unwrap();
    let travelled = world.entities().get(body).unwrap().position.x() - before;
    assert!(travelled > 0.0, "travelled={travelled}");
    assert!(travelled <= 0.250_001, "travelled={travelled}");
    assert_eq!(world.leases().get(body).unwrap().sequence, 2);
}

#[test]
fn blocked_threshold_terminates_lease() {
    let mut world = World::new(WorldConfig::default());
    let mut params = RulesetParameters::catalog_defaults();
    params.set("movement.blocked_lease_ticks", 2);
    params.set("governance.soak_delay_ticks", 0);
    params.set("governance.meta_soak_delay_ticks", 0);
    world.schedule_ruleset(params).unwrap();
    world.advance_tick().unwrap(); // activate

    let shape = box_shape(1_000, 1_000, 1_000);
    let wall = box_shape(100, 10_000, 2_000);
    world
        .enqueue(cmd(
            2,
            b"\0body",
            1,
            CommandEffect::CreateAndBindDemoBody {
                aigent_id: b"mover".to_vec(),
                position: PositionRequest::new(-2.0, 1.0, 0.0),
                shape,
            },
        ))
        .unwrap();
    world
        .enqueue(cmd(
            2,
            b"\0wall",
            1,
            CommandEffect::CreateEntity {
                position: PositionRequest::new(0.0, 5.0, 0.0),
                shape: Some(wall),
            },
        ))
        .unwrap();
    world.advance_tick().unwrap();
    let body = world.body_for_aigent(b"mover").unwrap();

    world
        .enqueue(cmd(
            3,
            b"mover",
            1,
            CommandEffect::UpsertMoveLease {
                body_id: Some(body),
                intent: MoveIntent {
                    target_x_mm: 5_000,
                    target_z_mm: 0,
                    speed_mm_per_s: 50_000,
                },
                ttl_ms: Some(60_000),
            },
        ))
        .unwrap();
    world.advance_tick().unwrap();
    // Find the first true no-progress tick. At threshold=2 the lease must
    // survive this tick with count 1 and terminate on exactly the next tick.
    for _ in 0..16 {
        if world
            .leases()
            .get(body)
            .is_some_and(|lease| lease.consecutive_no_progress_ticks == 1)
        {
            break;
        }
        world.advance_tick().unwrap();
    }
    let before_threshold = world
        .leases()
        .get(body)
        .expect("lease survives threshold - 1");
    assert_eq!(before_threshold.consecutive_no_progress_ticks, 1);
    let gen = world.advance_tick().unwrap().clone();
    assert!(
        gen.lease_terminations
            .iter()
            .any(|t| t.body_id == body
                && t.reason == world_server::LeaseTerminationReason::Blocked),
        "terminations={:?} lease={:?} entity={:?}",
        gen.lease_terminations,
        world.leases().get(body),
        world.entities().get(body)
    );
    assert!(world.leases().get(body).is_none());
}

#[test]
fn zero_length_move_rejects_illegal_starting_overlap() {
    let mut world = World::new(WorldConfig::default());
    let shape = box_shape(1_000, 1_000, 1_000);
    world
        .enqueue(cmd(
            1,
            b"\0body",
            1,
            CommandEffect::CreateAndBindDemoBody {
                aigent_id: b"overlap".to_vec(),
                position: PositionRequest::new(0.25, 1.0, 0.25),
                shape: shape.clone(),
            },
        ))
        .unwrap();
    world.advance_tick().unwrap();
    let body = world.body_for_aigent(b"overlap").unwrap();
    let position = world.entities().get(body).unwrap().position;
    world
        .enqueue(cmd(
            2,
            b"\0object",
            1,
            CommandEffect::CreateEntity {
                position: position.into(),
                shape: Some(shape),
            },
        ))
        .unwrap();
    world.advance_tick().unwrap();
    let revision = world.entities().get(body).unwrap().revision;
    world
        .enqueue(cmd(
            3,
            b"overlap",
            1,
            CommandEffect::UpsertMoveLease {
                body_id: Some(body),
                intent: MoveIntent::new(
                    (position.x() * 1_000.0) as i64,
                    (position.z() * 1_000.0) as i64,
                    1_000,
                )
                .unwrap(),
                ttl_ms: Some(10_000),
            },
        ))
        .unwrap();
    let generation = world.advance_tick().unwrap().clone();
    assert!(world.leases().get(body).is_none());
    assert_eq!(world.entities().get(body).unwrap().revision, revision);
    assert!(generation.lease_terminations.iter().any(|termination| {
        termination.body_id == body
            && termination.reason == world_server::LeaseTerminationReason::Blocked
    }));
}

#[test]
fn equal_time_tie_prefers_lower_entity_independent_of_order() {
    use world_server::BlockerKey;
    let a = BlockerKey::Entity { entity_id: 2 };
    let b = BlockerKey::Entity { entity_id: 9 };
    assert!(a < b);
    let terrain = BlockerKey::Terrain {
        cell_x: 2,
        cell_z: 0,
    };
    assert!(BlockerKey::Entity { entity_id: 2 } < terrain);
}

#[test]
fn lease_recovery_preserves_typed_intent() {
    let mut world = World::new(WorldConfig::default());
    let shape = box_shape(1_000, 1_000, 1_000);
    world
        .enqueue(cmd(
            1,
            b"\0s",
            1,
            CommandEffect::CreateAndBindDemoBody {
                aigent_id: b"r".to_vec(),
                position: PositionRequest::new(0.0, 1.0, 0.0),
                shape,
            },
        ))
        .unwrap();
    world
        .enqueue(cmd(
            1,
            b"r",
            1,
            CommandEffect::UpsertMoveLease {
                body_id: None,
                intent: MoveIntent {
                    target_x_mm: 8_000,
                    target_z_mm: -3_000,
                    speed_mm_per_s: 2_500,
                },
                ttl_ms: Some(10_000),
            },
        ))
        .unwrap();
    world.advance_tick().unwrap();
    let body = world.body_for_aigent(b"r").unwrap();
    let before = world.leases().get(body).unwrap();
    assert_eq!(before.target_x_mm, 8_000);
    assert_eq!(before.speed_mm_per_s, 2_500);

    let journal = match world.journal() {
        world_server::DurableJournal::Memory(j) => j.clone(),
        _ => panic!("expected memory journal"),
    };
    let recovered = World::recover_from_memory_journal(WorldConfig::default(), journal).unwrap();
    assert_eq!(recovered.body_for_aigent(b"r"), Some(body));
    let lease = recovered.leases().get(body).unwrap();
    assert_eq!(lease.target_x_mm, 8_000);
    assert_eq!(lease.target_z_mm, -3_000);
    assert_eq!(lease.speed_mm_per_s, 2_500);
}
