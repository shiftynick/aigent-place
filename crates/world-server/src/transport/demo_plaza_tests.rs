//! Actual ADR-0012 bodies on ADR-0013 terrain, through unchanged ground/sweep.
use super::*;
use crate::movement::{collider_at, step_move_toward, MoveIntent, MoveStepResult};
use crate::{
    derive_collider, Heightfield, HeightfieldProfile, PositionRequest, RulesetParameters,
    WorldPointMm,
};
use hmac::{Hmac, Mac};
use std::collections::{BTreeMap, BTreeSet};

// Independent NoiseV1 oracle: profile branching and instance methods are not
// used to determine the expected exterior or mixed-column heights.
fn noise(seed: &[u8; 32], x: i64, z: i64) -> i64 {
    let mut mac = Hmac::<Sha256>::new_from_slice(seed).unwrap();
    mac.update(b"aigent.place/heightfield/sample/v1");
    mac.update(&1u16.to_be_bytes());
    mac.update(&x.to_be_bytes());
    mac.update(&z.to_be_bytes());
    let digest = mac.finalize().into_bytes();
    i64::from_be_bytes([0, 0, 0, 0, 0, 0, digest[6] & 0x3f, digest[7]]) - 8192
}

fn expected_sample(seed: &[u8; 32], x: i64, z: i64) -> i64 {
    if (-16..=16).contains(&x) && (-16..=16).contains(&z) {
        0
    } else {
        noise(seed, x, z)
    }
}

#[test]
fn plaza_inclusive_samples_exterior_noise_and_negative_chunk_seams() {
    for seed in [[0; 32], [7; 32], [0xa5; 32]] {
        let plaza = Heightfield::ephemeral_demo_plaza(seed);
        let normal = Heightfield::new(seed, 1000).unwrap();
        assert_eq!(plaza.profile(), HeightfieldProfile::EphemeralDemoPlazaV1);
        assert_eq!(normal.profile(), HeightfieldProfile::NoiseV1);
        for x in -17..=17 {
            for z in -17..=17 {
                assert_eq!(plaza.sample_height_mm(x, z), expected_sample(&seed, x, z));
                assert_eq!(normal.sample_height_mm(x, z), noise(&seed, x, z));
            }
        }
        for (x, z) in [(-100, -100), (100, 100), (16, 17), (-17, -16)] {
            assert_eq!(plaza.sample_height_mm(x, z), noise(&seed, x, z));
        }
        // Global x=0 / z=0 lie on negative/positive chunk seams, including the
        // flat samples near origin and ordinary exterior samples along them.
        for local in [0, 16, 17, 48, 64] {
            let left = plaza.chunk_view(-1, 0).unwrap();
            let right = plaza.chunk_view(0, 0).unwrap();
            assert_eq!(
                left.sample_at_local(64, local).unwrap(),
                right.sample_at_local(0, local).unwrap()
            );
            assert_eq!(
                right.sample_at_local(0, local).unwrap(),
                expected_sample(&seed, 0, local)
            );
            let below = plaza.chunk_view(0, -1).unwrap();
            assert_eq!(
                below.sample_at_local(local, 64).unwrap(),
                right.sample_at_local(local, 0).unwrap()
            );
        }
        for (x, z) in [
            (-17, -17),
            (-16, -16),
            (15, 15),
            (16, 0),
            (0, -17),
            (17, 17),
        ] {
            let expected = [(x, z), (x + 1, z), (x, z + 1), (x + 1, z + 1)]
                .into_iter()
                .map(|(x, z)| expected_sample(&seed, x, z))
                .max()
                .unwrap();
            assert_eq!(plaza.terrain_column(x, z).unwrap().top_y_mm(), expected);
        }
    }
}

fn assert_support(hf: &Heightfield, shape: &ShapeTree, x: f64, z: f64) {
    let input = WorldPointMm::new(x, 12345.0, z).unwrap();
    let grounded = hf.ground(shape, input).unwrap();
    assert_eq!(grounded.translation().x().to_bits(), input.x().to_bits());
    assert_eq!(grounded.translation().z().to_bits(), input.z().to_bits());
    assert_eq!(grounded.support_top_mm(), 0);
    assert_eq!(grounded.translation().y(), 900.0);
    let collider = derive_collider(shape, grounded.translation()).unwrap();
    assert_eq!(collider.aggregate().min().y().to_bits(), 0f64.to_bits());
    assert_eq!(collider.aggregate().max().y(), 1800.0);
    assert_eq!(
        collider.aggregate().max().x() - collider.aggregate().min().x(),
        1000.0
    );
    assert_eq!(
        collider.aggregate().max().z() - collider.aggregate().min().z(),
        1000.0
    );
}

// Drive the actual movement kernel per 50 ms tick, updating its real collider
// projection. No teleport endpoint or admitted-command assertion is a pass.
fn walk(hf: &Heightfield, shape: &ShapeTree, start: [i64; 2], target: [i64; 2], speed: u32) -> u64 {
    let parameters = RulesetParameters::catalog_defaults();
    let grounded = hf
        .ground(
            shape,
            WorldPointMm::new(start[0] as f64, 0.0, start[1] as f64).unwrap(),
        )
        .unwrap();
    let position = PositionRequest::new(
        start[0] as f64 / 1000.0,
        grounded.translation().y() / 1000.0,
        start[1] as f64 / 1000.0,
    )
    .validate()
    .unwrap();
    let entity = crate::EntitySnapshot {
        entity_id: 1,
        revision: 1,
        position,
        shape: Some(ShapeSlot::from_encoded(shape.encode_to_vec())),
    };
    let mut entities = BTreeMap::from([(1, entity)]);
    let mut draft = crate::DraftCollisionView::rebuild(
        &entities,
        &parameters,
        &BTreeSet::from([1]),
        &BTreeSet::from([1]),
    )
    .unwrap();
    let intent = MoveIntent::new(target[0], target[1], speed).unwrap();
    let distance = ((target[0] - start[0]) as f64).hypot((target[1] - start[1]) as f64);
    let limit = (distance / (f64::from(speed) * 0.05)).ceil() as u64 + 3;
    for tick in 1..=limit {
        let before = entities[&1].position;
        match step_move_toward(hf, &entities, &draft, &parameters, 1, intent).unwrap() {
            MoveStepResult::Moved {
                position,
                reached_target,
                blocked_contact,
            } => {
                assert!(
                    blocked_contact.is_none(),
                    "clear inset leg {start:?}->{target:?}: {blocked_contact:?}"
                );
                assert_eq!(position.y(), 0.9);
                assert!(
                    (position.x() - before.x()).hypot(position.z() - before.z())
                        <= f64::from(speed) * 0.00005 + 1e-10
                );
                let entity = entities.get_mut(&1).unwrap();
                entity.position = position;
                entity.revision += 1;
                let (_, collider) = collider_at(entity, &parameters).unwrap();
                assert_eq!(collider.aggregate().min().y(), 0.0);
                draft.insert(1, collider);
                if reached_target {
                    assert!((position.x() * 1000.0 - target[0] as f64).abs() < 1e-8);
                    assert!((position.z() * 1000.0 - target[1] as f64).abs() < 1e-8);
                    return tick;
                }
            }
            MoveStepResult::ZeroLengthNoOp if start == target => return 0,
            other => panic!("inset leg {start:?}->{target:?} failed at tick{tick}: {other:?}"),
        }
    }
    panic!("inset target not physically reached: {start:?}->{target:?}");
}

#[test]
fn both_real_composed_bodies_ground_exactly_at_inset_and_flat_boundary() {
    let hf = Heightfield::ephemeral_demo_plaza([0; 32]);
    for variant in [0, 1] {
        let shape = demo_body_shape(variant);
        for (x, z) in [
            (-8000.0, -8000.0),
            (8000.0, 8000.0),
            (-15500.0, 15500.0),
            (15500.0, -15500.0),
            (-0.0, 0.0),
        ] {
            assert_support(&hf, &shape, x, z);
        }
        for (x, z) in [
            (-15501.0, 0.0),
            (15501.0, 0.0),
            (0.0, 15501.0),
            (0.0, -15501.0),
        ] {
            let grounded = hf
                .ground(&shape, WorldPointMm::new(x, 0.0, z).unwrap())
                .unwrap();
            let cells = grounded.selected_cells();
            let expected = cells
                .iter()
                .map(|cell| {
                    [
                        (cell.x, cell.z),
                        (cell.x + 1, cell.z),
                        (cell.x, cell.z + 1),
                        (cell.x + 1, cell.z + 1),
                    ]
                    .into_iter()
                    .map(|(x, z)| expected_sample(&[0; 32], x, z))
                    .max()
                    .unwrap()
                })
                .max()
                .unwrap();
            assert_eq!(grounded.support_top_mm(), expected);
        }
    }
}

#[test]
fn wide_legs_and_dense_intercepts_use_real_tick_ground_and_sweep_both_directions() {
    // All endpoints are in convex [-8,8]^2 m; straight segments stay within it.
    // Including each real body's 0.5 m footprint leaves >=7.5 m flat-cell
    // clearance. Dense samples verify that argument, not arbitrary noisy paths.
    let hf = Heightfield::ephemeral_demo_plaza([0; 32]);
    let waypoints = [[-6000, -4000], [6000, -4000], [6000, 4000], [-6000, 4000]];
    let starts = [
        [-8000, -8000],
        [-8000, 0],
        [-8000, 8000],
        [0, -8000],
        [0, 0],
        [0, 8000],
        [8000, -8000],
        [8000, 0],
        [8000, 8000],
    ];
    let mut world = World::ephemeral_demo_plaza(WorldConfig::default());
    for (id, target) in [(b"a".as_slice(), 0), (b"b".as_slice(), 2000)] {
        queue_world_effect(
            &mut world,
            id,
            CommandKind::Move,
            1,
            &DecodedCommandPayload::Move(MoveIntent::new(target, 0, 500).unwrap()),
        )
        .unwrap();
    }
    let spawned = world.advance_tick().unwrap().entities.clone();
    assert_eq!(spawned.len(), 2);
    for (index, entity) in spawned.values().enumerate() {
        let shape = ShapeTree::decode(entity.shape.as_ref().unwrap().as_bytes()).unwrap();
        let spawn = [
            (entity.position.x() * 1000.0).round() as i64,
            (entity.position.z() * 1000.0).round() as i64,
        ];
        assert_eq!(spawn, [index as i64 * 2000, 0]);
        assert_eq!(entity.position.y(), 0.9);
        for target in waypoints {
            assert!(walk(&hf, &shape, spawn, target, 500) >= 100);
            assert!(walk(&hf, &shape, target, spawn, 500) >= 100);
        }
        for index in 0..4 {
            let (a, b) = (waypoints[index], waypoints[(index + 1) % 4]);
            assert!(walk(&hf, &shape, a, b, 500) >= 100);
            assert!(walk(&hf, &shape, b, a, 500) >= 100);
        }
        for start in starts {
            for x in (-8000..=8000).step_by(2000) {
                for z in (-8000..=8000).step_by(2000) {
                    walk(&hf, &shape, start, [x, z], 900);
                    walk(&hf, &shape, [x, z], start, 900);
                }
            }
        }
    }
}

#[test]
fn plaza_boundary_does_not_disable_exterior_terrain_blocking() {
    let hf = Heightfield::ephemeral_demo_plaza([0; 32]);
    // Independent corner max is positive at the north transition cell.
    let top = expected_sample(&[0; 32], 0, 17)
        .max(expected_sample(&[0; 32], 1, 17))
        .max(0);
    assert!(top > 0);
    for variant in [0, 1] {
        let shape = demo_body_shape(variant);
        let parameters = RulesetParameters::catalog_defaults();
        let entity = crate::EntitySnapshot {
            entity_id: 1,
            revision: 1,
            position: PositionRequest::new(0.0, 0.9, 15.5).validate().unwrap(),
            shape: Some(ShapeSlot::from_encoded(shape.encode_to_vec())),
        };
        let entities = BTreeMap::from([(1, entity)]);
        let draft = crate::DraftCollisionView::rebuild(
            &entities,
            &parameters,
            &BTreeSet::from([1]),
            &BTreeSet::from([1]),
        )
        .unwrap();
        assert!(matches!(
            step_move_toward(
                &hf,
                &entities,
                &draft,
                &parameters,
                1,
                MoveIntent::new(0, 18000, 500).unwrap()
            )
            .unwrap(),
            MoveStepResult::NoProgress {
                blocker: crate::BlockerKey::Terrain { .. }
            }
        ));
    }
}

#[test]
fn plaza_pending_capacity_is_unique_and_third_is_typed_before_allocation() {
    let mut world = World::ephemeral_demo_plaza(WorldConfig::default());
    let queue = |world: &mut World, id: &[u8], sequence| {
        queue_world_effect(
            world,
            id,
            CommandKind::Move,
            sequence,
            &DecodedCommandPayload::Move(MoveIntent::new(0, 0, 500).unwrap()),
        )
    };
    queue(&mut world, b"a", 1).unwrap();
    queue(&mut world, b"a", 2).unwrap();
    queue(&mut world, b"b", 1).unwrap();
    assert!(matches!(
        queue(&mut world, b"c", 1),
        Err(AdmissionFailure::Rejected(
            aigent_protocol::CommandRejectionCode::Conflict
        ))
    ));
    assert_eq!(world.entities().next_entity_id(), 1);
    assert!(!world.has_body_or_pending_spawn(b"c"));
    let generation = world.advance_tick().unwrap();
    assert_eq!(generation.next_entity_id, 3);
    assert_eq!(generation.aigent_bodies.len(), 2);
    assert_eq!(generation.entities.len(), 2);
    assert!(!generation.aigent_bodies.contains_key(b"c".as_slice()));
    assert!(generation
        .entities
        .values()
        .all(|entity| entity.position.y() == 0.9));
    queue(&mut world, b"a", 3).unwrap();
    assert!(matches!(
        queue(&mut world, b"c", 2),
        Err(AdmissionFailure::Rejected(
            aigent_protocol::CommandRejectionCode::Conflict
        ))
    ));
    world.advance_tick().unwrap();
    assert_eq!(world.entities().next_entity_id(), 3);
}

#[test]
fn plaza_simultaneous_newborns_keep_per_part_collision_reservations() {
    let mut world = World::ephemeral_demo_plaza(WorldConfig::default());
    for (id, target) in [(b"a".as_slice(), 2000), (b"b".as_slice(), 0)] {
        queue_world_effect(
            &mut world,
            id,
            CommandKind::Move,
            1,
            &DecodedCommandPayload::Move(MoveIntent::new(target, 0, 500).unwrap()),
        )
        .unwrap();
    }
    let mut typed_entity_blocks = 0;
    for _ in 0..80 {
        let generation = world.advance_tick().unwrap();
        assert_eq!(generation.entities.len(), 2);
        assert_eq!(generation.next_entity_id, 3);
        let colliders = generation
            .entities
            .values()
            .map(|entity| {
                collider_at(entity, &RulesetParameters::catalog_defaults())
                    .unwrap()
                    .1
            })
            .collect::<Vec<_>>();
        for a in colliders[0].parts() {
            for b in colliders[1].parts() {
                assert!(
                    !a.bounds().overlaps_positive_volume(b.bounds()),
                    "newborn or active body penetrated its peer"
                );
            }
        }
        typed_entity_blocks += generation
            .lease_terminations
            .iter()
            .filter(|term| {
                term.reason == crate::LeaseTerminationReason::Blocked
                    && term.conflicting_entity_id.is_some()
            })
            .count();
    }
    assert_eq!(typed_entity_blocks, 2);
}

#[test]
fn activity_stopped_first_bootstrap_preserves_occupied_spawn_footprint() {
    let mut world = World::ephemeral_demo_activity(WorldConfig::default(), [9; 16]);
    queue_world_effect(
        &mut world,
        b"first",
        CommandKind::Move,
        1,
        &DecodedCommandPayload::Move(MoveIntent::new(0, 0, 500).unwrap()),
    )
    .unwrap();
    assert!(world.attach_demo_participant(
        b"first".to_vec(),
        b"cfirst".to_vec(),
        b"sess-1".to_vec()
    ));
    world.advance_tick().unwrap();
    queue_world_effect(
        &mut world,
        b"first",
        CommandKind::Stop,
        2,
        &DecodedCommandPayload::None,
    )
    .unwrap();
    world.advance_tick().unwrap();
    let first = world.body_for_aigent(b"first").unwrap();
    assert!(world.leases().get(first).is_none());
    queue_world_effect(
        &mut world,
        b"second",
        CommandKind::Move,
        1,
        &DecodedCommandPayload::Move(MoveIntent::new(2000, 0, 500).unwrap()),
    )
    .unwrap();
    assert!(world.attach_demo_participant(
        b"second".to_vec(),
        b"csecond".to_vec(),
        b"sess-2".to_vec()
    ));
    let generation = world.advance_tick().unwrap();
    let bodies = generation.entities.values().collect::<Vec<_>>();
    assert_eq!(bodies.len(), 2);
    assert_ne!(bodies[0].position, bodies[1].position);
    let colliders = bodies
        .iter()
        .map(|e| {
            collider_at(e, &RulesetParameters::catalog_defaults())
                .unwrap()
                .1
        })
        .collect::<Vec<_>>();
    assert!(!colliders[0].parts().iter().any(|a| colliders[1]
        .parts()
        .iter()
        .any(|b| a.bounds().overlaps_positive_volume(b.bounds()))));
    for _ in 0..21 {
        world.advance_tick().unwrap();
    }
    assert_eq!(
        world.demo_activity_state().unwrap().phase,
        crate::demo_activity::DemoPhase::Separate
    );
}
