//! ADR-0012 demo creation validates before allocation and retains physical truth.
use aigent_protocol::{
    shape_node::Primitive, BoxPrimitive, ColorRgba, LocalTransform, Quaternion, ShapeNode,
    ShapeTree, SpherePrimitive, Vector3Millimeters,
};
use prost::Message;
use world_server::{
    derive_collider, validate_shape_tree, CommandEffect, DurableJournal, PositionRequest,
    QueuedCommand, RealEntityRecord, RulesetParameters, ShapeClass, ShapeSlot, World, WorldConfig,
    WorldPointMm,
};

fn composed_shape() -> ShapeTree {
    let node = |id, parent, primitive| ShapeNode {
        node_id: id,
        parent_node_id: parent,
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
            red: 80,
            green: 160,
            blue: 220,
            alpha: 255,
        }),
        material_tags: vec![],
        primitive: Some(primitive),
    };
    ShapeTree {
        nodes: vec![
            node(
                1,
                0,
                Primitive::Box(BoxPrimitive {
                    size_x_mm: 1000,
                    size_y_mm: 1800,
                    size_z_mm: 1000,
                }),
            ),
            node(2, 1, Primitive::Sphere(SpherePrimitive { radius_mm: 250 })),
        ],
    }
}

fn create(world: &mut World, id: &[u8], shape: ShapeSlot) {
    world
        .enqueue(QueuedCommand {
            arrival_tick: world.next_tick(),
            aigent_id: id.to_vec(),
            sequence: 1,
            effect: CommandEffect::CreateAndBindDemoBody {
                aigent_id: id.to_vec(),
                position: PositionRequest::new(0.0, 1.0, 0.0),
                shape,
            },
        })
        .unwrap();
}

fn assert_rejected_without_allocation(
    world: &mut World,
    id: &[u8],
    shape: ShapeSlot,
    reason: &str,
) {
    let before = world.entities().next_entity_id();
    create(world, id, shape);
    let generation = world.advance_tick().unwrap();
    assert_eq!(
        generation.next_entity_id, before,
        "rejection must not consume an ID"
    );
    assert!(generation.entities.is_empty(), "no partial body");
    assert!(generation.aigent_bodies.is_empty(), "no partial binding");
    assert!(generation.active_leases.is_empty());
    assert!(
        generation.applied_commands[0].summary.contains(reason),
        "{:?}",
        generation.applied_commands
    );
    assert_eq!(world.body_for_aigent(id), None);
}

#[test]
fn malformed_and_invalid_shapes_reject_before_id_or_binding() {
    for defect in ["decode", "colour", "primitive", "parent"] {
        let mut world = World::new(WorldConfig::default());
        let mut tree = composed_shape();
        let (shape, reason) = match defect {
            "decode" => (ShapeSlot::from_encoded(vec![0xff]), "shape_decode"),
            "colour" => {
                tree.nodes[0].color.as_mut().unwrap().red = 256;
                (
                    ShapeSlot::from_encoded(tree.encode_to_vec()),
                    "ColorOutOfRange",
                )
            }
            "primitive" => {
                tree.nodes[0].primitive = None;
                (
                    ShapeSlot::from_encoded(tree.encode_to_vec()),
                    "MissingPrimitive",
                )
            }
            _ => {
                tree.nodes[1].parent_node_id = 99;
                (
                    ShapeSlot::from_encoded(tree.encode_to_vec()),
                    "UnknownParent",
                )
            }
        };
        assert_rejected_without_allocation(&mut world, b"bad", shape, reason);
        create(
            &mut world,
            b"valid",
            ShapeSlot::from_encoded(composed_shape().encode_to_vec()),
        );
        let generation = world.advance_tick().unwrap();
        assert_eq!(generation.next_entity_id, 2);
        assert_eq!(generation.aigent_bodies[b"valid".as_slice()], 1);
    }
}

#[test]
fn invalid_existing_body_projection_rejects_creation_without_partial_state() {
    let mut world = World::new(WorldConfig::default());
    world
        .enqueue(QueuedCommand {
            arrival_tick: 1,
            aigent_id: b"existing".to_vec(),
            sequence: 1,
            effect: CommandEffect::CreateEntity {
                position: PositionRequest::new(4.0, 1.0, 0.0),
                shape: Some(ShapeSlot::from_encoded(vec![0xff])),
            },
        })
        .unwrap();
    world
        .enqueue(QueuedCommand {
            arrival_tick: 1,
            aigent_id: b"existing".to_vec(),
            sequence: 2,
            effect: CommandEffect::BindAigentBody {
                aigent_id: b"existing".to_vec(),
                body_id: 1,
            },
        })
        .unwrap();
    world.advance_tick().unwrap();
    let before = world.entities().snapshots();
    create(
        &mut world,
        b"new",
        ShapeSlot::from_encoded(composed_shape().encode_to_vec()),
    );
    let generation = world.advance_tick().unwrap();
    assert_eq!(generation.entities, before);
    assert_eq!(generation.next_entity_id, 2);
    assert!(!generation.aigent_bodies.contains_key(b"new".as_slice()));
    assert!(generation.active_leases.is_empty());
    assert!(generation.applied_commands[0]
        .summary
        .contains("rejected=collision_projection:ShapeDecode"));
}

#[test]
fn authoritative_creation_enforces_live_body_part_and_extent_budgets() {
    for (path, value, reason) in [
        ("shape.body_max_parts", 1, "PartBudgetExceeded"),
        ("shape.max_extent_mm", 1799, "ExtentBudgetExceeded"),
    ] {
        let mut world = World::new(WorldConfig::default());
        let mut parameters = RulesetParameters::catalog_defaults();
        parameters.set(path, value);
        if path == "shape.body_max_parts" {
            parameters.set("shape.body_max_joints", 0);
        }
        world.schedule_ruleset(parameters).unwrap();
        world.advance_ticks(2).unwrap();
        assert_rejected_without_allocation(
            &mut world,
            b"over-budget",
            ShapeSlot::from_encoded(composed_shape().encode_to_vec()),
            reason,
        );
        // A legal candidate still receives the first ID; rejection did not
        // poison the allocator or install a hidden binding.
        let mut legal = composed_shape();
        legal.nodes.pop();
        if path == "shape.max_extent_mm" {
            legal.nodes[0].primitive = Some(Primitive::Sphere(SpherePrimitive { radius_mm: 250 }));
        }
        create(
            &mut world,
            b"legal",
            ShapeSlot::from_encoded(legal.encode_to_vec()),
        );
        world.advance_tick().unwrap();
        assert_eq!(world.body_for_aigent(b"legal"), Some(1));
    }
}

#[test]
fn committed_recovered_and_wire_shapes_preserve_exact_candidate_and_grounding() {
    let path = std::env::temp_dir().join(format!(
        "aigent-place-task-068-shape-truth-{}.sqlite",
        std::process::id()
    ));
    let _ = std::fs::remove_file(&path);
    let tree = composed_shape();
    let bytes = tree.encode_to_vec();
    let mut world = World::with_journal(
        WorldConfig::default(),
        DurableJournal::sqlite(&path).unwrap(),
    );
    create(
        &mut world,
        b"physical",
        ShapeSlot::from_encoded(bytes.clone()),
    );
    let generation = world.advance_tick().unwrap().clone();
    let body = generation.aigent_bodies[b"physical".as_slice()];
    let entity = &generation.entities[&body];
    assert_eq!(entity.shape.as_ref().unwrap().as_bytes(), bytes);
    assert_ne!(
        entity.position.y(),
        1.0,
        "stored entity position includes actual grounding"
    );
    let wire = RealEntityRecord::from_snapshot(entity).unwrap();
    assert_eq!(wire.shape, Some(tree.clone()));
    let grounded_collider = derive_collider(
        &tree,
        WorldPointMm::new(
            entity.position.x() * 1000.0,
            entity.position.y() * 1000.0,
            entity.position.z() * 1000.0,
        )
        .unwrap(),
    )
    .unwrap();
    assert_eq!(
        grounded_collider.aggregate().max().y() - grounded_collider.aggregate().min().y(),
        1800.0
    );
    let committed = world.journal().last_committed().unwrap();
    assert_eq!(committed.entities, generation.entities);
    assert_eq!(committed.aigent_bodies, generation.aigent_bodies);
    drop(world);
    let mut recovered = World::recover_from_journal(
        WorldConfig::default(),
        DurableJournal::sqlite(&path).unwrap(),
    )
    .unwrap();
    assert_eq!(recovered.body_for_aigent(b"physical"), Some(body));
    assert_eq!(recovered.entities().snapshots(), generation.entities);
    recovered.advance_tick().unwrap();
    assert_eq!(
        RealEntityRecord::from_snapshot(&recovered.entities().snapshots()[&body])
            .unwrap()
            .shape,
        Some(tree)
    );
    drop(recovered);
    let _ = std::fs::remove_file(path);
}

#[test]
fn duplicate_creation_keeps_existing_shape_and_allocator() {
    let mut world = World::new(WorldConfig::default());
    let tree = composed_shape();
    validate_shape_tree(
        &tree,
        ShapeClass::Body,
        &RulesetParameters::catalog_defaults(),
    )
    .unwrap();
    create(
        &mut world,
        b"same",
        ShapeSlot::from_encoded(tree.encode_to_vec()),
    );
    world.advance_tick().unwrap();
    let before = world.entities().snapshots();
    create(&mut world, b"same", ShapeSlot::from_encoded(vec![0xff]));
    let generation = world.advance_tick().unwrap();
    assert_eq!(generation.next_entity_id, 2);
    assert_eq!(generation.entities, before);
    assert_eq!(generation.aigent_bodies.len(), 1);
    assert!(generation.applied_commands[0].summary.contains(":noop:"));
}
