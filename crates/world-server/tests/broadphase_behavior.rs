//! Uniform spatial-hash collision broadphase (task-050).
//!
//! Covers generation provenance, sleeping/unleased exclusion, insertion-order
//! independence, multi-cell / negative / boundary queries, overlap vs enclosure
//! candidates, and fail-closed invalid frozen geometry.

use aigent_protocol::{
    shape_node::Primitive, BoxPrimitive, LocalTransform, Quaternion, ShapeNode, ShapeTree,
    Vector3Millimeters,
};
use prost::Message;
use std::collections::BTreeMap;
use world_server::{
    Aabb, BroadphaseRebuildError, CollisionBroadphase, EntitySnapshot, ImmutableGeneration,
    LeaseSnapshot, Position, RulesetGeneration, RulesetParameters, ShapeSlot, WorldPointMm,
    FIRST_REVISION,
};

fn identity() -> Quaternion {
    Quaternion {
        x: 0.0,
        y: 0.0,
        z: 0.0,
        w: 1.0,
    }
}

fn box_tree(size_mm: i64) -> ShapeTree {
    ShapeTree {
        nodes: vec![ShapeNode {
            node_id: 1,
            parent_node_id: 0,
            transform: Some(LocalTransform {
                translation: Some(Vector3Millimeters {
                    x_mm: 0,
                    y_mm: 0,
                    z_mm: 0,
                }),
                rotation: Some(identity()),
            }),
            joint_name: None,
            color: None,
            material_tags: Vec::new(),
            primitive: Some(Primitive::Box(BoxPrimitive {
                size_x_mm: size_mm,
                size_y_mm: size_mm,
                size_z_mm: size_mm,
            })),
        }],
    }
}

fn encode_shape(tree: &ShapeTree) -> ShapeSlot {
    ShapeSlot::from_encoded(tree.encode_to_vec())
}

fn lease(body_id: u64) -> LeaseSnapshot {
    LeaseSnapshot {
        body_id,
        aigent_id: format!("a{body_id}").into_bytes(),
        sequence: 1,
        granted_tick: 1,
        expire_tick: 100,
        target_x_mm: 0,
        target_z_mm: 0,
        speed_mm_per_s: 1_000,
        consecutive_no_progress_ticks: 0,
    }
}

fn entity(id: u64, x_m: f64, y_m: f64, z_m: f64, shape: Option<ShapeSlot>) -> EntitySnapshot {
    EntitySnapshot {
        entity_id: id,
        revision: FIRST_REVISION,
        position: Position::new(x_m, y_m, z_m).expect("position"),
        shape,
    }
}

fn ruleset(generation_id: u64) -> RulesetGeneration {
    RulesetGeneration {
        generation_id,
        activated_tick: 1,
        parameters: RulesetParameters::catalog_defaults(),
    }
}

fn generation(
    ruleset_generation_id: u64,
    entities: BTreeMap<u64, EntitySnapshot>,
    active_leases: BTreeMap<u64, LeaseSnapshot>,
) -> ImmutableGeneration {
    let next_entity_id = entities
        .keys()
        .next_back()
        .copied()
        .unwrap_or(0)
        .saturating_add(1);
    ImmutableGeneration {
        generation: 7,
        tick: 7,
        world_value: 0,
        ruleset_generation_id,
        active_leases,
        aigent_bodies: Default::default(),
        applied_commands: Vec::new(),
        expired_leases: Vec::new(),
        lease_terminations: Vec::new(),
        rng_draws: Vec::new(),
        entities,
        next_entity_id,
    }
}

fn aabb_mm(min: [f64; 3], max: [f64; 3]) -> Aabb {
    Aabb::try_from_min_max(
        WorldPointMm::new(min[0], min[1], min[2]).expect("min"),
        WorldPointMm::new(max[0], max[1], max[2]).expect("max"),
    )
    .expect("aabb")
}

#[test]
fn rebuild_records_generation_provenance_and_cell_edge() {
    let shape = encode_shape(&box_tree(1_000));
    let mut entities = BTreeMap::new();
    entities.insert(1, entity(1, 0.0, 0.0, 0.0, Some(shape)));
    let mut leases = BTreeMap::new();
    leases.insert(1, lease(1));
    let gen = generation(3, entities, leases);
    let rules = ruleset(3);

    let index = CollisionBroadphase::rebuild(&gen, &rules).expect("rebuild");
    assert_eq!(index.world_generation(), 7);
    assert_eq!(index.ruleset_generation_id(), 3);
    assert_eq!(index.cell_edge_mm(), 10_000.0);
    assert_eq!(index.len(), 1);
}

#[test]
fn ruleset_generation_mismatch_fails_closed() {
    let gen = generation(1, BTreeMap::new(), BTreeMap::new());
    let err = CollisionBroadphase::rebuild(&gen, &ruleset(2)).expect_err("mismatch");
    assert_eq!(
        err,
        BroadphaseRebuildError::RulesetGenerationMismatch {
            world_ruleset_generation_id: 1,
            provided_ruleset_generation_id: 2,
        }
    );
}

#[test]
fn sleeping_unleased_and_shapeless_entities_are_absent() {
    let shaped = encode_shape(&box_tree(1_000));
    let mut entities = BTreeMap::new();
    // Active shaped.
    entities.insert(1, entity(1, 0.0, 0.0, 0.0, Some(shaped.clone())));
    // Sleeping/unleased shaped — present in the table but not leased.
    entities.insert(2, entity(2, 0.1, 0.0, 0.0, Some(shaped.clone())));
    // Active but shapeless.
    entities.insert(3, entity(3, 0.2, 0.0, 0.0, None));
    // Active with empty shape slot — treated as shapeless/absent.
    entities.insert(
        4,
        entity(4, 0.3, 0.0, 0.0, Some(ShapeSlot::from_encoded(Vec::new()))),
    );

    let mut leases = BTreeMap::new();
    leases.insert(1, lease(1));
    leases.insert(3, lease(3));
    leases.insert(4, lease(4));

    let index = CollisionBroadphase::rebuild(&generation(1, entities, leases), &ruleset(1))
        .expect("rebuild");
    assert_eq!(index.len(), 1);
    assert!(index.aggregate(1).is_some());
    assert!(index.aggregate(2).is_none());
    assert!(index.aggregate(3).is_none());
    assert!(index.aggregate(4).is_none());

    let hits = index
        .query_overlap_candidates(aabb_mm(
            [-2_000.0, -2_000.0, -2_000.0],
            [2_000.0, 2_000.0, 2_000.0],
        ))
        .expect("query");
    assert_eq!(hits, vec![1]);
}

#[test]
fn candidate_order_is_independent_of_insertion_and_hash_order() {
    let shape = encode_shape(&box_tree(1_000));
    // Insert entities in descending ID order into the maps; BTreeMap publishes
    // ascending, and query results must still be ascending regardless.
    let mut entities = BTreeMap::new();
    let mut leases = BTreeMap::new();
    for id in [9u64, 3, 7, 1, 5] {
        let x_m = (id as f64) * 0.05; // still overlapping a common query
        entities.insert(id, entity(id, x_m, 0.0, 0.0, Some(shape.clone())));
        leases.insert(id, lease(id));
    }

    let index = CollisionBroadphase::rebuild(&generation(1, entities, leases), &ruleset(1))
        .expect("rebuild");
    let query = aabb_mm([-1_000.0, -1_000.0, -1_000.0], [10_000.0, 1_000.0, 1_000.0]);
    let bucket = index.query_bucket_candidates(query).expect("bucket");
    let overlap = index.query_overlap_candidates(query).expect("overlap");
    assert_eq!(bucket, vec![1, 3, 5, 7, 9]);
    assert_eq!(overlap, vec![1, 3, 5, 7, 9]);
}

#[test]
fn multi_cell_negative_and_exact_boundary_queries() {
    let shape = encode_shape(&box_tree(2_000)); // ±1000 mm about centre
    let mut entities = BTreeMap::new();
    let mut leases = BTreeMap::new();

    // Straddles cell boundary at x=0 with default 10_000 mm cells? Place at
    // x = 9.5 m => 9500 mm, box extends [8500, 10500] — straddles 10000.
    entities.insert(1, entity(1, 9.5, 0.0, 0.0, Some(shape.clone())));
    leases.insert(1, lease(1));
    // Negative octant.
    entities.insert(2, entity(2, -12.0, -1.0, -2.0, Some(shape.clone())));
    leases.insert(2, lease(2));
    // Far positive, separate cell.
    entities.insert(3, entity(3, 40.0, 0.0, 0.0, Some(shape)));
    leases.insert(3, lease(3));

    let index = CollisionBroadphase::rebuild(&generation(1, entities, leases), &ruleset(1))
        .expect("rebuild");
    assert_eq!(index.cell_edge_mm(), 10_000.0);

    // Query that only covers the straddling entity's positive-side lobe.
    let near_boundary = index
        .query_overlap_candidates(aabb_mm(
            [10_000.0, -500.0, -500.0],
            [10_500.0, 500.0, 500.0],
        ))
        .expect("boundary");
    assert_eq!(near_boundary, vec![1]);

    // Exact face contact with entity 1 aggregate max.x = 10500: no positive volume.
    let face_touch = index
        .query_overlap_candidates(aabb_mm(
            [10_500.0, -500.0, -500.0],
            [11_000.0, 500.0, 500.0],
        ))
        .expect("face");
    assert!(face_touch.is_empty());

    let negative = index
        .query_overlap_candidates(aabb_mm(
            [-13_000.0, -2_000.0, -3_000.0],
            [-11_000.0, 0.0, -1_000.0],
        ))
        .expect("negative");
    assert_eq!(negative, vec![2]);

    let far = index
        .query_overlap_candidates(aabb_mm(
            [39_000.0, -1_000.0, -1_000.0],
            [41_000.0, 1_000.0, 1_000.0],
        ))
        .expect("far");
    assert_eq!(far, vec![3]);
}

#[test]
fn overlap_and_enclosure_candidate_predicates() {
    let small = encode_shape(&box_tree(1_000)); // ±500 mm
    let mut entities = BTreeMap::new();
    let mut leases = BTreeMap::new();
    entities.insert(1, entity(1, 0.0, 0.0, 0.0, Some(small.clone())));
    leases.insert(1, lease(1));
    entities.insert(2, entity(2, 5.0, 0.0, 0.0, Some(small)));
    leases.insert(2, lease(2));

    let index = CollisionBroadphase::rebuild(&generation(1, entities, leases), &ruleset(1))
        .expect("rebuild");

    // Overlaps only entity 1.
    let overlap = index
        .query_overlap_candidates(aabb_mm([-200.0, -200.0, -200.0], [200.0, 200.0, 200.0]))
        .expect("overlap");
    assert_eq!(overlap, vec![1]);

    // Object that fully cages entity 1 on X/Z with vertical coverage equality.
    let cage = aabb_mm([-600.0, -500.0, -600.0], [600.0, 500.0, 600.0]);
    let enclosed = index.query_enclosure_candidates(cage).expect("enclosure");
    assert_eq!(enclosed, vec![1]);

    // Horizontal equality is not strict containment.
    let touch_horizontal = aabb_mm([-500.0, -500.0, -600.0], [500.0, 500.0, 600.0]);
    let none = index
        .query_enclosure_candidates(touch_horizontal)
        .expect("no enclosure");
    assert!(none.is_empty());
}

#[test]
fn invalid_frozen_geometry_fails_closed() {
    let mut entities = BTreeMap::new();
    let mut leases = BTreeMap::new();
    entities.insert(
        1,
        entity(
            1,
            0.0,
            0.0,
            0.0,
            Some(ShapeSlot::from_encoded(vec![0xff, 0x00, 0xab])),
        ),
    );
    leases.insert(1, lease(1));
    let err = CollisionBroadphase::rebuild(&generation(1, entities, leases), &ruleset(1))
        .expect_err("decode");
    assert_eq!(
        err,
        BroadphaseRebuildError::ShapeDecodeFailed { entity_id: 1 }
    );

    // Decodable but structurally invalid (zero node ID). An empty protobuf is
    // also the canonical encoding of an absent slot, so use a non-empty invalid
    // tree to exercise validation rather than omission.
    let invalid = ShapeTree {
        nodes: vec![ShapeNode {
            node_id: 0,
            parent_node_id: 0,
            transform: None,
            joint_name: None,
            color: None,
            material_tags: Vec::new(),
            primitive: None,
        }],
    };
    let mut entities = BTreeMap::new();
    let mut leases = BTreeMap::new();
    entities.insert(2, entity(2, 0.0, 0.0, 0.0, Some(encode_shape(&invalid))));
    leases.insert(2, lease(2));
    let err = CollisionBroadphase::rebuild(&generation(1, entities, leases), &ruleset(1))
        .expect_err("validate");
    assert!(matches!(
        err,
        BroadphaseRebuildError::InvalidFrozenShape { entity_id: 2, .. }
    ));

    // Lease without a matching entity row.
    let mut leases = BTreeMap::new();
    leases.insert(9, lease(9));
    let err = CollisionBroadphase::rebuild(&generation(1, BTreeMap::new(), leases), &ruleset(1))
        .expect_err("missing");
    assert_eq!(
        err,
        BroadphaseRebuildError::MissingLeasedEntity { entity_id: 9 }
    );

    // A corrupt frozen entity map cannot redirect one ID to another body.
    let mut entities = BTreeMap::new();
    entities.insert(
        1,
        entity(2, 0.0, 0.0, 0.0, Some(encode_shape(&box_tree(1_000)))),
    );
    let mut leases = BTreeMap::new();
    leases.insert(1, lease(1));
    let err = CollisionBroadphase::rebuild(&generation(1, entities, leases), &ruleset(1))
        .expect_err("identity mismatch");
    assert_eq!(
        err,
        BroadphaseRebuildError::FrozenIdentityMismatch {
            map_key: 1,
            embedded_id: 2,
            record: "entity",
        }
    );
}

#[test]
fn bucket_candidates_may_be_conservative_relative_to_overlap() {
    let shape = encode_shape(&box_tree(1_000));
    let mut entities = BTreeMap::new();
    let mut leases = BTreeMap::new();
    // Two entities in the same 10 m cell, not overlapping each other.
    entities.insert(1, entity(1, 1.0, 0.0, 0.0, Some(shape.clone())));
    leases.insert(1, lease(1));
    entities.insert(2, entity(2, 8.0, 0.0, 0.0, Some(shape)));
    leases.insert(2, lease(2));

    let index = CollisionBroadphase::rebuild(&generation(1, entities, leases), &ruleset(1))
        .expect("rebuild");
    // Query overlaps only entity 1, but sits in the shared cell.
    let query = aabb_mm([500.0, -200.0, -200.0], [1_200.0, 200.0, 200.0]);
    let bucket = index.query_bucket_candidates(query).expect("bucket");
    let overlap = index.query_overlap_candidates(query).expect("overlap");
    assert_eq!(bucket, vec![1, 2]);
    assert_eq!(overlap, vec![1]);
}
