//! Closed-form candidate shape validation (task-047 / aggregate extent budget).
//!
//! Expected outcomes are derived from the rules in ADR-0002 and
//! `world/v1/CONTRACT.md` section 4, not supplied by fixtures: every reject
//! case starts from a tree this file has already proven acceptable, applies
//! exactly one named corruption, and asserts the specific typed reason. Budget
//! cases assert against the value read back from the live ruleset generation,
//! so an implementation that hardcoded a limit would fail them. Aggregate
//! extent cases build trees whose primitives individually fit the budget and
//! assert [`ShapeRejection::AggregateExtentBudgetExceeded`] from the canonical
//! collider at the origin.

use aigent_protocol::{
    shape_node::Primitive, BoxPrimitive, CapsulePrimitive, ColorRgba, ConePrimitive,
    CylinderPrimitive, LocalTransform, PanelPrimitive, Quaternion, ShapeNode, ShapeTree,
    SpherePrimitive, Vector3Millimeters,
};
use world_server::{
    derive_collider, validate_candidate, validate_shape_tree, Axis, DimensionField,
    RulesetParameters, ShapeClass, ShapeRejection, WorldPointMm, WORLD_BOUND_MM,
};

/// A parameter map that the ruleset contract itself accepts as a live
/// generation. Asserting `validate_candidate` here keeps budget tests honest:
/// they cannot pass by feeding the shape validator a map no generation could
/// ever hold.
fn live_parameters(overrides: &[(&str, i64)]) -> RulesetParameters {
    let mut parameters = RulesetParameters::catalog_defaults();
    for (path, value) in overrides {
        parameters.set(*path, *value);
    }
    validate_candidate(&parameters).expect("overrides must form a legal live generation");
    parameters
}

fn defaults() -> RulesetParameters {
    live_parameters(&[])
}

fn identity() -> Quaternion {
    Quaternion {
        x: 0.0,
        y: 0.0,
        z: 0.0,
        w: 1.0,
    }
}

fn transform(x_mm: i64, y_mm: i64, z_mm: i64) -> Option<LocalTransform> {
    Some(LocalTransform {
        translation: Some(Vector3Millimeters { x_mm, y_mm, z_mm }),
        rotation: Some(identity()),
    })
}

fn cube(size_mm: i64) -> Option<Primitive> {
    Some(Primitive::Box(BoxPrimitive {
        size_x_mm: size_mm,
        size_y_mm: size_mm,
        size_z_mm: size_mm,
    }))
}

fn node(node_id: u32, parent_node_id: u32) -> ShapeNode {
    ShapeNode {
        node_id,
        parent_node_id,
        transform: transform(0, 0, 0),
        joint_name: None,
        color: None,
        material_tags: Vec::new(),
        primitive: cube(1_000),
    }
}

/// Root box, a jointed sphere child, a zero-segment capsule, a cylinder, a
/// cone, and a panel: every v1 primitive appears at least once.
fn canonical_tree() -> ShapeTree {
    ShapeTree {
        nodes: vec![
            ShapeNode {
                color: Some(ColorRgba {
                    red: 255,
                    green: 128,
                    blue: 0,
                    alpha: 255,
                }),
                material_tags: vec!["metal".into(), "matte".into()],
                ..node(1, 0)
            },
            ShapeNode {
                joint_name: Some("shoulder".into()),
                transform: transform(500, 800, 0),
                primitive: Some(Primitive::Sphere(SpherePrimitive { radius_mm: 250 })),
                ..node(2, 1)
            },
            ShapeNode {
                joint_name: Some("elbow".into()),
                transform: transform(0, -600, 0),
                // ADR-0002: the capsule's cylindrical segment alone may be zero.
                primitive: Some(Primitive::Capsule(CapsulePrimitive {
                    radius_mm: 200,
                    segment_length_mm: 0,
                })),
                ..node(3, 2)
            },
            ShapeNode {
                primitive: Some(Primitive::Cylinder(CylinderPrimitive {
                    radius_mm: 150,
                    height_mm: 900,
                })),
                ..node(4, 1)
            },
            ShapeNode {
                primitive: Some(Primitive::Cone(ConePrimitive {
                    radius_mm: 150,
                    height_mm: 900,
                })),
                ..node(5, 4)
            },
            ShapeNode {
                primitive: Some(Primitive::Panel(PanelPrimitive {
                    width_mm: 2_000,
                    height_mm: 1_500,
                    thickness_mm: 20,
                })),
                ..node(6, 1)
            },
        ],
    }
}

/// Apply exactly one corruption to the canonical tree and return the reason.
fn reject_reason(corrupt: impl FnOnce(&mut ShapeTree)) -> ShapeRejection {
    let mut shape = canonical_tree();
    corrupt(&mut shape);
    validate_shape_tree(&shape, ShapeClass::Body, &defaults())
        .expect_err("corrupted candidate must reject")
}

fn node_at(shape: &mut ShapeTree, node_id: u32) -> &mut ShapeNode {
    shape
        .nodes
        .iter_mut()
        .find(|node| node.node_id == node_id)
        .expect("node present")
}

#[test]
fn canonical_tree_is_accepted_for_both_classes() {
    let shape = canonical_tree();
    let parameters = defaults();
    assert_eq!(
        validate_shape_tree(&shape, ShapeClass::Body, &parameters),
        Ok(())
    );
    assert_eq!(
        validate_shape_tree(&shape, ShapeClass::Object, &parameters),
        Ok(())
    );
}

/// The one dimension ADR-0002 allows to be zero.
#[test]
fn capsule_segment_of_zero_is_legal_but_negative_is_not() {
    let parameters = defaults();
    for segment_length_mm in [0_i64, 1, 5_000] {
        let mut shape = canonical_tree();
        node_at(&mut shape, 3).primitive = Some(Primitive::Capsule(CapsulePrimitive {
            radius_mm: 200,
            segment_length_mm,
        }));
        assert_eq!(
            validate_shape_tree(&shape, ShapeClass::Body, &parameters),
            Ok(()),
            "segment {segment_length_mm} must be legal"
        );
    }
    assert_eq!(
        reject_reason(|shape| {
            node_at(shape, 3).primitive = Some(Primitive::Capsule(CapsulePrimitive {
                radius_mm: 200,
                segment_length_mm: -1,
            }));
        }),
        ShapeRejection::NegativeSegmentLength {
            node_id: 3,
            value_mm: -1
        }
    );
}

#[test]
fn empty_tree_rejects() {
    let empty = ShapeTree { nodes: Vec::new() };
    assert_eq!(
        validate_shape_tree(&empty, ShapeClass::Body, &defaults()),
        Err(ShapeRejection::EmptyTree)
    );
}

#[test]
fn zero_node_id_rejects() {
    assert_eq!(
        reject_reason(|shape| node_at(shape, 6).node_id = 0),
        ShapeRejection::ZeroNodeId
    );
}

#[test]
fn duplicate_node_id_rejects() {
    assert_eq!(
        reject_reason(|shape| node_at(shape, 6).node_id = 4),
        ShapeRejection::DuplicateNodeId { node_id: 4 }
    );
}

#[test]
fn unknown_parent_rejects() {
    assert_eq!(
        reject_reason(|shape| node_at(shape, 6).parent_node_id = 99),
        ShapeRejection::UnknownParent {
            node_id: 6,
            parent_node_id: 99
        }
    );
}

#[test]
fn missing_root_rejects() {
    // Every node has a parent, so nothing anchors the tree.
    assert_eq!(
        reject_reason(|shape| node_at(shape, 1).parent_node_id = 6),
        ShapeRejection::NoRoot
    );
}

#[test]
fn multiple_roots_reject() {
    assert_eq!(
        reject_reason(|shape| node_at(shape, 4).parent_node_id = 0),
        ShapeRejection::MultipleRoots { node_ids: [1, 4] }
    );
}

#[test]
fn cycle_rejects_even_with_a_valid_root_present() {
    // 1 stays the root; 4 -> 5 -> 4 is an isolated cycle.
    assert_eq!(
        reject_reason(|shape| node_at(shape, 4).parent_node_id = 5),
        ShapeRejection::Cycle { node_id: 4 }
    );
}

#[test]
fn self_parent_rejects_as_a_cycle() {
    assert_eq!(
        reject_reason(|shape| node_at(shape, 5).parent_node_id = 5),
        ShapeRejection::Cycle { node_id: 5 }
    );
}

#[test]
fn missing_primitive_rejects() {
    assert_eq!(
        reject_reason(|shape| node_at(shape, 4).primitive = None),
        ShapeRejection::MissingPrimitive { node_id: 4 }
    );
}

/// Every strictly positive dimension of every v1 primitive, at zero and at a
/// negative value. The panel row is what makes "a panel has non-zero
/// thickness" executable.
#[test]
fn non_positive_dimensions_reject_per_primitive_and_field() {
    let cases: Vec<(Primitive, DimensionField)> = vec![
        (
            Primitive::Box(BoxPrimitive {
                size_x_mm: 0,
                size_y_mm: 100,
                size_z_mm: 100,
            }),
            DimensionField::SizeX,
        ),
        (
            Primitive::Box(BoxPrimitive {
                size_x_mm: 100,
                size_y_mm: 0,
                size_z_mm: 100,
            }),
            DimensionField::SizeY,
        ),
        (
            Primitive::Box(BoxPrimitive {
                size_x_mm: 100,
                size_y_mm: 100,
                size_z_mm: 0,
            }),
            DimensionField::SizeZ,
        ),
        (
            Primitive::Sphere(SpherePrimitive { radius_mm: 0 }),
            DimensionField::Radius,
        ),
        (
            Primitive::Capsule(CapsulePrimitive {
                radius_mm: 0,
                segment_length_mm: 100,
            }),
            DimensionField::Radius,
        ),
        (
            Primitive::Cylinder(CylinderPrimitive {
                radius_mm: 0,
                height_mm: 100,
            }),
            DimensionField::Radius,
        ),
        (
            Primitive::Cylinder(CylinderPrimitive {
                radius_mm: 100,
                height_mm: 0,
            }),
            DimensionField::Height,
        ),
        (
            Primitive::Cone(ConePrimitive {
                radius_mm: 0,
                height_mm: 100,
            }),
            DimensionField::Radius,
        ),
        (
            Primitive::Cone(ConePrimitive {
                radius_mm: 100,
                height_mm: 0,
            }),
            DimensionField::Height,
        ),
        (
            Primitive::Panel(PanelPrimitive {
                width_mm: 0,
                height_mm: 100,
                thickness_mm: 10,
            }),
            DimensionField::Width,
        ),
        (
            Primitive::Panel(PanelPrimitive {
                width_mm: 100,
                height_mm: 0,
                thickness_mm: 10,
            }),
            DimensionField::Height,
        ),
        (
            Primitive::Panel(PanelPrimitive {
                width_mm: 100,
                height_mm: 100,
                thickness_mm: 0,
            }),
            DimensionField::Thickness,
        ),
    ];

    for (primitive, field) in cases {
        assert_eq!(
            reject_reason(|shape| node_at(shape, 4).primitive = Some(primitive)),
            ShapeRejection::NonPositiveDimension {
                node_id: 4,
                field,
                value_mm: 0
            },
            "zero {field:?} must reject"
        );
        assert_eq!(
            reject_reason(|shape| node_at(shape, 4).primitive = Some(negate(primitive, field))),
            ShapeRejection::NonPositiveDimension {
                node_id: 4,
                field,
                value_mm: -7
            },
            "negative {field:?} must reject"
        );
    }
}

/// Set the named field of `primitive` to a negative value.
fn negate(primitive: Primitive, field: DimensionField) -> Primitive {
    let mut primitive = primitive;
    match (&mut primitive, field) {
        (Primitive::Box(shape), DimensionField::SizeX) => shape.size_x_mm = -7,
        (Primitive::Box(shape), DimensionField::SizeY) => shape.size_y_mm = -7,
        (Primitive::Box(shape), DimensionField::SizeZ) => shape.size_z_mm = -7,
        (Primitive::Sphere(shape), DimensionField::Radius) => shape.radius_mm = -7,
        (Primitive::Capsule(shape), DimensionField::Radius) => shape.radius_mm = -7,
        (Primitive::Cylinder(shape), DimensionField::Radius) => shape.radius_mm = -7,
        (Primitive::Cylinder(shape), DimensionField::Height) => shape.height_mm = -7,
        (Primitive::Cone(shape), DimensionField::Radius) => shape.radius_mm = -7,
        (Primitive::Cone(shape), DimensionField::Height) => shape.height_mm = -7,
        (Primitive::Panel(shape), DimensionField::Width) => shape.width_mm = -7,
        (Primitive::Panel(shape), DimensionField::Height) => shape.height_mm = -7,
        (Primitive::Panel(shape), DimensionField::Thickness) => shape.thickness_mm = -7,
        other => panic!("unhandled primitive/field pair: {other:?}"),
    }
    primitive
}

#[test]
fn missing_transform_or_rotation_rejects() {
    assert_eq!(
        reject_reason(|shape| node_at(shape, 2).transform = None),
        ShapeRejection::MissingTransform { node_id: 2 }
    );
    // The protobuf default quaternion is (0,0,0,0), not identity, so an absent
    // rotation cannot be read as "unrotated".
    assert_eq!(
        reject_reason(|shape| {
            node_at(shape, 2).transform = Some(LocalTransform {
                translation: Some(Vector3Millimeters {
                    x_mm: 0,
                    y_mm: 0,
                    z_mm: 0,
                }),
                rotation: None,
            });
        }),
        ShapeRejection::MissingRotation { node_id: 2 }
    );
}

#[test]
fn non_finite_rotation_rejects() {
    for bad in [f64::NAN, f64::INFINITY, f64::NEG_INFINITY] {
        assert_eq!(
            reject_reason(|shape| {
                node_at(shape, 2).transform = Some(LocalTransform {
                    translation: None,
                    rotation: Some(Quaternion {
                        x: bad,
                        y: 0.0,
                        z: 0.0,
                        w: 1.0,
                    }),
                });
            }),
            ShapeRejection::NonFiniteRotation { node_id: 2 },
            "{bad} must reject"
        );
    }
}

/// A non-unit quaternion is how scale or shear would be smuggled through a
/// schema that has no scale field, so it must reject.
#[test]
fn non_unit_rotation_rejects_but_tolerance_accepts() {
    for scale in [2.0_f64, 0.5, 0.0] {
        assert_eq!(
            reject_reason(|shape| {
                node_at(shape, 2).transform = Some(LocalTransform {
                    translation: None,
                    rotation: Some(Quaternion {
                        x: 0.0,
                        y: 0.0,
                        z: 0.0,
                        w: scale,
                    }),
                });
            }),
            ShapeRejection::NonUnitRotation { node_id: 2 },
            "magnitude {scale} must reject"
        );
    }

    // Within the documented 1e-6 tolerance on squared magnitude.
    let mut shape = canonical_tree();
    node_at(&mut shape, 2).transform = Some(LocalTransform {
        translation: None,
        rotation: Some(Quaternion {
            x: 0.0,
            y: 0.0,
            z: 0.0,
            w: (1.0_f64 - 1e-7).sqrt(),
        }),
    });
    assert_eq!(
        validate_shape_tree(&shape, ShapeClass::Body, &defaults()),
        Ok(())
    );
}

#[test]
fn translation_outside_the_world_bound_rejects() {
    for (axis, value) in [
        (Axis::X, WORLD_BOUND_MM + 1),
        (Axis::Y, -WORLD_BOUND_MM - 1),
        (Axis::Z, i64::MIN),
    ] {
        let (x_mm, y_mm, z_mm) = match axis {
            Axis::X => (value, 0, 0),
            Axis::Y => (0, value, 0),
            Axis::Z => (0, 0, value),
        };
        assert_eq!(
            reject_reason(|shape| node_at(shape, 2).transform = transform(x_mm, y_mm, z_mm)),
            ShapeRejection::TranslationOutOfBounds {
                node_id: 2,
                axis,
                value_mm: value
            }
        );
    }
    // The bound itself is inclusive.
    // Use one primitive so this assertion isolates the per-node translation
    // boundary from the independent aggregate-extent budget.
    let mut shape = ShapeTree {
        nodes: vec![node(1, 0)],
    };
    node_at(&mut shape, 1).transform = transform(WORLD_BOUND_MM, -WORLD_BOUND_MM, 0);
    assert_eq!(
        validate_shape_tree(&shape, ShapeClass::Body, &defaults()),
        Ok(())
    );
}

#[test]
fn invalid_and_duplicate_joint_names_reject() {
    for bad in ["Shoulder", "1st", "", "shoulder!", &"a".repeat(65)] {
        assert_eq!(
            reject_reason(|shape| node_at(shape, 4).joint_name = Some(bad.to_string())),
            ShapeRejection::InvalidJointName { node_id: 4 },
            "{bad:?} must reject"
        );
    }
    // A 64-character name is the longest legal identifier.
    let mut shape = canonical_tree();
    node_at(&mut shape, 4).joint_name = Some(format!("a{}", "b".repeat(63)));
    assert_eq!(
        validate_shape_tree(&shape, ShapeClass::Body, &defaults()),
        Ok(())
    );

    assert_eq!(
        reject_reason(|shape| node_at(shape, 4).joint_name = Some("elbow".into())),
        ShapeRejection::DuplicateJointName { node_id: 4 }
    );
}

/// An invalid joint name and an invalid material tag are different defects and
/// must not collapse into one reason.
#[test]
fn invalid_and_duplicate_material_tags_reject() {
    assert_eq!(
        reject_reason(|shape| node_at(shape, 4).material_tags = vec!["Metal".into()]),
        ShapeRejection::InvalidMaterialTag { node_id: 4 }
    );
    assert_ne!(
        reject_reason(|shape| node_at(shape, 4).material_tags = vec!["Metal".into()]),
        reject_reason(|shape| node_at(shape, 4).joint_name = Some("Metal".into())),
        "material-tag and joint-name defects must be distinguishable"
    );
    assert_eq!(
        reject_reason(
            |shape| node_at(shape, 4).material_tags = vec!["metal".into(), "metal".into()]
        ),
        ShapeRejection::DuplicateMaterialTag { node_id: 4 }
    );
    // The same tag on two different nodes is legal.
    let mut shape = canonical_tree();
    node_at(&mut shape, 4).material_tags = vec!["metal".into()];
    assert_eq!(
        validate_shape_tree(&shape, ShapeClass::Body, &defaults()),
        Ok(())
    );
}

#[test]
fn color_component_above_255_rejects() {
    assert_eq!(
        reject_reason(|shape| {
            node_at(shape, 1).color = Some(ColorRgba {
                red: 0,
                green: 256,
                blue: 0,
                alpha: 255,
            });
        }),
        ShapeRejection::ColorOutOfRange {
            node_id: 1,
            component: 256
        }
    );
}

/// The same tree flips outcome purely because the live generation changed.
#[test]
fn part_budget_is_read_from_the_live_generation() {
    let shape = canonical_tree();
    let parts = shape.nodes.len() as i64;

    // Both classes: only the live parameter changes between accept and reject,
    // so a hardcoded limit or a lookup that reads the wrong class's path fails.
    for (class, parts_path, joints_path) in [
        (
            ShapeClass::Body,
            "shape.body_max_parts",
            "shape.body_max_joints",
        ),
        (
            ShapeClass::Object,
            "shape.object_max_parts",
            "shape.object_max_joints",
        ),
    ] {
        let exact = live_parameters(&[(parts_path, parts), (joints_path, parts)]);
        assert_eq!(
            validate_shape_tree(&shape, class, &exact),
            Ok(()),
            "{class:?} must accept at exactly its live part budget"
        );

        let tight = live_parameters(&[(parts_path, parts - 1), (joints_path, parts - 1)]);
        assert_eq!(
            validate_shape_tree(&shape, class, &tight),
            Err(ShapeRejection::PartBudgetExceeded {
                limit: (parts - 1) as u32,
                found: parts as usize
            }),
            "{class:?} must reject one below its live part budget"
        );
    }
}

#[test]
fn joint_budget_is_read_from_the_live_generation() {
    let shape = canonical_tree();
    let joints = shape
        .nodes
        .iter()
        .filter(|node| node.joint_name.is_some())
        .count() as i64;
    assert!(joints > 0, "canonical tree must exercise joints");

    for (class, joints_path) in [
        (ShapeClass::Body, "shape.body_max_joints"),
        (ShapeClass::Object, "shape.object_max_joints"),
    ] {
        let exact = live_parameters(&[(joints_path, joints)]);
        assert_eq!(
            validate_shape_tree(&shape, class, &exact),
            Ok(()),
            "{class:?} must accept at exactly its live joint budget"
        );

        let tight = live_parameters(&[(joints_path, joints - 1)]);
        assert_eq!(
            validate_shape_tree(&shape, class, &tight),
            Err(ShapeRejection::JointBudgetExceeded {
                limit: (joints - 1) as u32,
                found: joints as u32
            }),
            "{class:?} must reject one above its live joint budget"
        );
    }
}

#[test]
fn extent_budget_is_read_from_the_live_generation() {
    let mut shape = canonical_tree();
    node_at(&mut shape, 4).primitive = Some(Primitive::Cylinder(CylinderPrimitive {
        radius_mm: 150,
        height_mm: 6_000,
    }));

    // `shape.max_extent_mm` is one path shared by both classes.
    for class in [ShapeClass::Body, ShapeClass::Object] {
        let exact = live_parameters(&[("shape.max_extent_mm", 6_000)]);
        assert_eq!(
            validate_shape_tree(&shape, class, &exact),
            Ok(()),
            "{class:?} must accept at exactly the live extent budget"
        );

        let tight = live_parameters(&[("shape.max_extent_mm", 5_999)]);
        assert_eq!(
            validate_shape_tree(&shape, class, &tight),
            Err(ShapeRejection::ExtentBudgetExceeded {
                node_id: 4,
                axis: Axis::Y,
                extent_mm: 6_000,
                limit_mm: 5_999
            }),
            "{class:?} must reject one below the live extent budget"
        );
    }
}

/// A dimension large enough to overflow the doubled extent must reject, not
/// wrap into an apparently legal value.
#[test]
fn extent_arithmetic_overflow_rejects() {
    let reason = reject_reason(|shape| {
        node_at(shape, 4).primitive = Some(Primitive::Sphere(SpherePrimitive {
            radius_mm: i64::MAX,
        }));
    });
    assert!(
        matches!(
            reason,
            ShapeRejection::ExtentBudgetExceeded { node_id: 4, .. }
        ),
        "unexpected reason: {reason:?}"
    );
}

/// Bodies and placed objects carry different budgets, so one tree can be a
/// legal object and an illegal body under the same live generation.
#[test]
fn body_and_object_budgets_differ_on_one_tree() {
    let parameters = defaults();
    let body_limit = parameters.get("shape.body_max_parts").unwrap();
    let object_limit = parameters.get("shape.object_max_parts").unwrap();
    assert!(
        body_limit < object_limit,
        "catalog defaults must separate the two classes"
    );

    let count = body_limit + 1;
    let mut nodes = vec![node(1, 0)];
    for node_id in 2..=count as u32 {
        nodes.push(node(node_id, 1));
    }
    let shape = ShapeTree { nodes };

    assert_eq!(
        validate_shape_tree(&shape, ShapeClass::Body, &parameters),
        Err(ShapeRejection::PartBudgetExceeded {
            limit: body_limit as u32,
            found: count as usize
        })
    );
    assert_eq!(
        validate_shape_tree(&shape, ShapeClass::Object, &parameters),
        Ok(())
    );
}

/// A generation that does not carry a budget path rejects rather than falling
/// back to a constant.
#[test]
fn a_generation_missing_a_shape_path_rejects() {
    let parameters =
        RulesetParameters::from_sorted_pairs([("movement.lease_ttl_ms".into(), 10_000)]);
    assert_eq!(
        validate_shape_tree(&canonical_tree(), ShapeClass::Body, &parameters),
        Err(ShapeRejection::MissingBudgetParameter {
            path: "shape.body_max_parts"
        })
    );
    assert_eq!(
        validate_shape_tree(&canonical_tree(), ShapeClass::Object, &parameters),
        Err(ShapeRejection::MissingBudgetParameter {
            path: "shape.object_max_parts"
        })
    );
}

/// Validation is all-or-nothing: a rejected candidate is byte-identical
/// afterwards, and validating twice gives the same answer.
#[test]
fn a_rejected_candidate_is_left_untouched() {
    let mut shape = canonical_tree();
    node_at(&mut shape, 4).parent_node_id = 5;
    let before = shape.clone();

    let first = validate_shape_tree(&shape, ShapeClass::Body, &defaults());
    assert!(first.is_err());
    assert_eq!(shape, before, "rejection must not mutate the candidate");
    assert_eq!(
        validate_shape_tree(&shape, ShapeClass::Body, &defaults()),
        first,
        "validation must be a pure function of candidate and generation"
    );
}

/// Input array order is not semantic (`world/v1` section 4.1), so shuffling
/// the node array cannot change the outcome.
#[test]
fn node_array_order_does_not_change_the_outcome() {
    let parameters = defaults();
    let mut reversed = canonical_tree();
    reversed.nodes.reverse();
    assert_eq!(
        validate_shape_tree(&reversed, ShapeClass::Body, &parameters),
        Ok(())
    );

    let mut broken = canonical_tree();
    node_at(&mut broken, 6).parent_node_id = 99;
    let mut broken_reversed = broken.clone();
    broken_reversed.nodes.reverse();
    assert_eq!(
        validate_shape_tree(&broken, ShapeClass::Body, &parameters),
        validate_shape_tree(&broken_reversed, ShapeClass::Body, &parameters)
    );

    // With two independent defects present, array order must not decide which
    // one is named either: reporting follows canonical ascending node_id, so
    // node 4 is reported whichever end of the array it sits at.
    let mut two_defects = canonical_tree();
    node_at(&mut two_defects, 4).primitive = None;
    node_at(&mut two_defects, 6).primitive = None;
    let mut two_defects_reversed = two_defects.clone();
    two_defects_reversed.nodes.reverse();
    assert_eq!(
        validate_shape_tree(&two_defects, ShapeClass::Body, &parameters),
        Err(ShapeRejection::MissingPrimitive { node_id: 4 })
    );
    assert_eq!(
        validate_shape_tree(&two_defects_reversed, ShapeClass::Body, &parameters),
        Err(ShapeRejection::MissingPrimitive { node_id: 4 })
    );

    // The same for two nodes with unresolvable parents.
    let mut two_bad_parents = canonical_tree();
    node_at(&mut two_bad_parents, 5).parent_node_id = 98;
    node_at(&mut two_bad_parents, 6).parent_node_id = 99;
    let mut two_bad_parents_reversed = two_bad_parents.clone();
    two_bad_parents_reversed.nodes.reverse();
    assert_eq!(
        validate_shape_tree(&two_bad_parents, ShapeClass::Body, &parameters),
        Err(ShapeRejection::UnknownParent {
            node_id: 5,
            parent_node_id: 98
        })
    );
    assert_eq!(
        validate_shape_tree(&two_bad_parents_reversed, ShapeClass::Body, &parameters),
        Err(ShapeRejection::UnknownParent {
            node_id: 5,
            parent_node_id: 98
        })
    );
}

/// Two unit cubes whose individual local extents stay under the budget, but
/// whose separation makes the canonical aggregate X extent exceed it.
fn separated_cubes_on_x(child_x_mm: i64) -> ShapeTree {
    ShapeTree {
        nodes: vec![
            ShapeNode {
                primitive: cube(1_000),
                ..node(1, 0)
            },
            ShapeNode {
                transform: transform(child_x_mm, 0, 0),
                primitive: cube(1_000),
                ..node(2, 1)
            },
        ],
    }
}

/// Aggregate X extent for [`separated_cubes_on_x`]: min=-500, max=child_x+500.
fn separated_cubes_aggregate_x_extent_mm(child_x_mm: i64) -> f64 {
    let min_x = -500.0;
    let max_x = child_x_mm as f64 + 500.0;
    max_x - min_x
}

#[test]
fn aggregate_extent_rejects_when_primitives_fit_but_separation_exceeds() {
    // Each cube is 1000 mm locally. Child at x=4001 -> aggregate X = 5001.
    let shape = separated_cubes_on_x(4_001);
    let limit = 5_000_i64;
    let parameters = live_parameters(&[("shape.max_extent_mm", limit)]);
    let expected_extent = separated_cubes_aggregate_x_extent_mm(4_001);
    assert_eq!(expected_extent, 5_001.0);

    for class in [ShapeClass::Body, ShapeClass::Object] {
        assert_eq!(
            validate_shape_tree(&shape, class, &parameters),
            Err(ShapeRejection::AggregateExtentBudgetExceeded {
                axis: Axis::X,
                extent_mm_bits: expected_extent.to_bits(),
                limit_mm: limit,
            }),
            "{class:?} must reject the aggregate X excess with exact context"
        );
    }
}

#[test]
fn aggregate_extent_accepts_exact_budget_and_rejects_one_over() {
    let limit = 5_000_i64;
    let parameters = live_parameters(&[("shape.max_extent_mm", limit)]);

    let exact = separated_cubes_on_x(4_000);
    assert_eq!(separated_cubes_aggregate_x_extent_mm(4_000), 5_000.0);
    for class in [ShapeClass::Body, ShapeClass::Object] {
        assert_eq!(
            validate_shape_tree(&exact, class, &parameters),
            Ok(()),
            "{class:?} must accept aggregate extent equal to the budget"
        );
    }

    let over = separated_cubes_on_x(4_001);
    let expected_extent = separated_cubes_aggregate_x_extent_mm(4_001);
    for class in [ShapeClass::Body, ShapeClass::Object] {
        assert_eq!(
            validate_shape_tree(&over, class, &parameters),
            Err(ShapeRejection::AggregateExtentBudgetExceeded {
                axis: Axis::X,
                extent_mm_bits: expected_extent.to_bits(),
                limit_mm: limit,
            }),
            "{class:?} must reject one millimetre over the aggregate budget"
        );
    }
}

#[test]
fn per_primitive_extent_budget_still_wins_independently() {
    let shape = ShapeTree {
        nodes: vec![ShapeNode {
            primitive: Some(Primitive::Box(BoxPrimitive {
                size_x_mm: 6_000,
                size_y_mm: 100,
                size_z_mm: 100,
            })),
            ..node(1, 0)
        }],
    };
    let parameters = live_parameters(&[("shape.max_extent_mm", 5_000)]);
    for class in [ShapeClass::Body, ShapeClass::Object] {
        assert_eq!(
            validate_shape_tree(&shape, class, &parameters),
            Err(ShapeRejection::ExtentBudgetExceeded {
                node_id: 1,
                axis: Axis::X,
                extent_mm: 6_000,
                limit_mm: 5_000,
            }),
            "{class:?} must keep the per-primitive rejection distinct and earlier"
        );
    }
}

#[test]
fn aggregate_extent_rejection_is_independent_of_node_array_order() {
    let mut shape = separated_cubes_on_x(4_001);
    // Also exceed on Y so fixed X precedence is observable.
    node_at(&mut shape, 2).transform = transform(4_001, 4_001, 0);
    let parameters = live_parameters(&[("shape.max_extent_mm", 5_000)]);
    let expected = ShapeRejection::AggregateExtentBudgetExceeded {
        axis: Axis::X,
        extent_mm_bits: separated_cubes_aggregate_x_extent_mm(4_001).to_bits(),
        limit_mm: 5_000,
    };

    let mut shuffled = shape.clone();
    shuffled.nodes.reverse();
    assert_eq!(
        validate_shape_tree(&shape, ShapeClass::Body, &parameters),
        Err(expected.clone())
    );
    assert_eq!(
        validate_shape_tree(&shuffled, ShapeClass::Body, &parameters),
        Err(expected)
    );
}

/// 45 degrees about +Z as a unit quaternion (half-angle pi/8).
fn z_rotation_45() -> Quaternion {
    let half = std::f64::consts::FRAC_PI_4 / 2.0;
    Quaternion {
        x: 0.0,
        y: 0.0,
        z: half.sin(),
        w: half.cos(),
    }
}

#[test]
fn rotated_aggregate_extent_consumes_canonical_collider_output() {
    let limit = 1_000_i64;
    let parameters = live_parameters(&[("shape.max_extent_mm", limit)]);
    let primitive = Some(Primitive::Box(BoxPrimitive {
        size_x_mm: 1_000,
        size_y_mm: 1_000,
        size_z_mm: 100,
    }));

    let identity = ShapeTree {
        nodes: vec![ShapeNode {
            primitive,
            ..node(1, 0)
        }],
    };
    assert_eq!(
        validate_shape_tree(&identity, ShapeClass::Body, &parameters),
        Ok(())
    );

    let rotated = ShapeTree {
        nodes: vec![ShapeNode {
            transform: Some(LocalTransform {
                translation: Some(Vector3Millimeters {
                    x_mm: 0,
                    y_mm: 0,
                    z_mm: 0,
                }),
                rotation: Some(z_rotation_45()),
            }),
            primitive,
            ..node(1, 0)
        }],
    };
    let collider = derive_collider(&rotated, WorldPointMm::origin()).expect("rotated collider");
    let extent_x = collider.aggregate().max().x() - collider.aggregate().min().x();
    assert!(
        extent_x > limit as f64,
        "rotated X extent must exceed the local-axis budget ({extent_x})"
    );

    let before = rotated.clone();
    let rejection = validate_shape_tree(&rotated, ShapeClass::Object, &parameters)
        .expect_err("rotated aggregate must reject");
    assert_eq!(
        rejection,
        ShapeRejection::AggregateExtentBudgetExceeded {
            axis: Axis::X,
            extent_mm_bits: extent_x.to_bits(),
            limit_mm: limit,
        }
    );
    assert_eq!(
        rotated, before,
        "aggregate rejection must leave the candidate untouched"
    );
}
