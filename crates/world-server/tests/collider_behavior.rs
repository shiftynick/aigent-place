//! Canonical AABB collider derivation (task-048).
//!
//! Expectations come from ADR-0002 and `world/v1/CONTRACT.md` section 5, plus
//! an independent corner-minmax oracle for rotated boxes. Production
//! `derive_collider` is never used to build expected bounds.

use aigent_protocol::{
    shape_node::Primitive, BoxPrimitive, CapsulePrimitive, ColorRgba, ConePrimitive,
    CylinderPrimitive, LocalTransform, PanelPrimitive, Quaternion, ShapeNode, ShapeTree,
    SpherePrimitive, Vector3Millimeters,
};
use world_server::{derive_collider, Aabb, ColliderDerivationError, WorldPointMm};

fn identity() -> Quaternion {
    Quaternion {
        x: 0.0,
        y: 0.0,
        z: 0.0,
        w: 1.0,
    }
}

fn transform(x_mm: i64, y_mm: i64, z_mm: i64, rotation: Quaternion) -> Option<LocalTransform> {
    Some(LocalTransform {
        translation: Some(Vector3Millimeters { x_mm, y_mm, z_mm }),
        rotation: Some(rotation),
    })
}

fn transform_identity(x_mm: i64, y_mm: i64, z_mm: i64) -> Option<LocalTransform> {
    transform(x_mm, y_mm, z_mm, identity())
}

fn box_primitive(size_x_mm: i64, size_y_mm: i64, size_z_mm: i64) -> Option<Primitive> {
    Some(Primitive::Box(BoxPrimitive {
        size_x_mm,
        size_y_mm,
        size_z_mm,
    }))
}

fn node(
    node_id: u32,
    parent_node_id: u32,
    x_mm: i64,
    y_mm: i64,
    z_mm: i64,
    primitive: Option<Primitive>,
) -> ShapeNode {
    ShapeNode {
        node_id,
        parent_node_id,
        transform: transform_identity(x_mm, y_mm, z_mm),
        joint_name: None,
        color: None,
        material_tags: Vec::new(),
        primitive,
    }
}

fn assert_close(actual: f64, expected: f64, label: &str) {
    assert_close_within(actual, expected, 1e-9, label);
}

fn assert_close_within(actual: f64, expected: f64, tol: f64, label: &str) {
    let delta = (actual - expected).abs();
    assert!(
        delta <= tol,
        "{label}: actual={actual} expected={expected} delta={delta} tol={tol}"
    );
}

fn assert_aabb_matches(actual: Aabb, expected_min: [f64; 3], expected_max: [f64; 3]) {
    assert_aabb_matches_within(actual, expected_min, expected_max, 1e-9);
}

fn assert_aabb_matches_within(
    actual: Aabb,
    expected_min: [f64; 3],
    expected_max: [f64; 3],
    tol: f64,
) {
    assert_close_within(actual.min().x(), expected_min[0], tol, "min.x");
    assert_close_within(actual.min().y(), expected_min[1], tol, "min.y");
    assert_close_within(actual.min().z(), expected_min[2], tol, "min.z");
    assert_close_within(actual.max().x(), expected_max[0], tol, "max.x");
    assert_close_within(actual.max().y(), expected_max[1], tol, "max.y");
    assert_close_within(actual.max().z(), expected_max[2], tol, "max.z");
}

/// Independent `abs(R)*h` world-half extents matching CONTRACT §5 / world-contract.mjs.
fn oracle_abs_r_half(local_half: [f64; 3], rotation: [f64; 4]) -> [f64; 3] {
    let m = rotation_matrix(rotation);
    let mut half = [0.0_f64; 3];
    for i in 0..3 {
        half[i] = m[i][0].abs() * local_half[0]
            + m[i][1].abs() * local_half[1]
            + m[i][2].abs() * local_half[2];
        if half[i] == 0.0 {
            half[i] = 0.0;
        }
    }
    half
}

fn oracle_aabb_from_abs_r(
    world_center: [f64; 3],
    local_half: [f64; 3],
    rotation: [f64; 4],
) -> ([f64; 3], [f64; 3]) {
    let half = oracle_abs_r_half(local_half, rotation);
    let mut min = [
        world_center[0] - half[0],
        world_center[1] - half[1],
        world_center[2] - half[2],
    ];
    let mut max = [
        world_center[0] + half[0],
        world_center[1] + half[1],
        world_center[2] + half[2],
    ];
    for axis in 0..3 {
        if min[axis] == 0.0 {
            min[axis] = 0.0;
        }
        if max[axis] == 0.0 {
            max[axis] = 0.0;
        }
    }
    (min, max)
}

/// Independent unit-quaternion normalization matching `world-contract.mjs`.
fn normalize_quat(q: [f64; 4]) -> [f64; 4] {
    let magnitude = (q[0] * q[0] + q[1] * q[1] + q[2] * q[2] + q[3] * q[3]).sqrt();
    let mut n = [
        q[0] / magnitude,
        q[1] / magnitude,
        q[2] / magnitude,
        q[3] / magnitude,
    ];
    let first = [n[3], n[0], n[1], n[2]]
        .into_iter()
        .find(|value| *value != 0.0)
        .expect("non-degenerate");
    if first < 0.0 {
        n[0] = -n[0];
        n[1] = -n[1];
        n[2] = -n[2];
        n[3] = -n[3];
    }
    n
}

fn multiply_quat(a: [f64; 4], b: [f64; 4]) -> [f64; 4] {
    normalize_quat([
        a[3] * b[0] + a[0] * b[3] + a[1] * b[2] - a[2] * b[1],
        a[3] * b[1] - a[0] * b[2] + a[1] * b[3] + a[2] * b[0],
        a[3] * b[2] + a[0] * b[1] - a[1] * b[0] + a[2] * b[3],
        a[3] * b[3] - a[0] * b[0] - a[1] * b[1] - a[2] * b[2],
    ])
}

fn rotation_matrix(q: [f64; 4]) -> [[f64; 3]; 3] {
    let [x, y, z, w] = q;
    [
        [
            1.0 - 2.0 * (y * y + z * z),
            2.0 * (x * y - z * w),
            2.0 * (x * z + y * w),
        ],
        [
            2.0 * (x * y + z * w),
            1.0 - 2.0 * (x * x + z * z),
            2.0 * (y * z - x * w),
        ],
        [
            2.0 * (x * z - y * w),
            2.0 * (y * z + x * w),
            1.0 - 2.0 * (x * x + y * y),
        ],
    ]
}

fn rotate_vector(q: [f64; 4], v: [f64; 3]) -> [f64; 3] {
    let m = rotation_matrix(q);
    [
        m[0][0] * v[0] + m[0][1] * v[1] + m[0][2] * v[2],
        m[1][0] * v[0] + m[1][1] * v[1] + m[1][2] * v[2],
        m[2][0] * v[0] + m[2][1] * v[1] + m[2][2] * v[2],
    ]
}

/// Corner-minmax oracle for one oriented box. Does not call production code.
fn oracle_oriented_aabb(
    world_center: [f64; 3],
    local_half: [f64; 3],
    rotation: [f64; 4],
) -> ([f64; 3], [f64; 3]) {
    let mut min = [f64::INFINITY; 3];
    let mut max = [f64::NEG_INFINITY; 3];
    for sx in [-1.0_f64, 1.0] {
        for sy in [-1.0_f64, 1.0] {
            for sz in [-1.0_f64, 1.0] {
                let local = [sx * local_half[0], sy * local_half[1], sz * local_half[2]];
                let rotated = rotate_vector(rotation, local);
                let corner = [
                    world_center[0] + rotated[0],
                    world_center[1] + rotated[1],
                    world_center[2] + rotated[2],
                ];
                for axis in 0..3 {
                    min[axis] = min[axis].min(corner[axis]);
                    max[axis] = max[axis].max(corner[axis]);
                }
            }
        }
    }
    // Match production canonicalization of exact negative zero.
    for axis in 0..3 {
        if min[axis] == 0.0 {
            min[axis] = 0.0;
        }
        if max[axis] == 0.0 {
            max[axis] = 0.0;
        }
    }
    (min, max)
}

fn assert_corners_inside(
    bounds: Aabb,
    world_center: [f64; 3],
    local_half: [f64; 3],
    rotation: [f64; 4],
) {
    for sx in [-1.0_f64, 1.0] {
        for sy in [-1.0_f64, 1.0] {
            for sz in [-1.0_f64, 1.0] {
                let local = [sx * local_half[0], sy * local_half[1], sz * local_half[2]];
                let rotated = rotate_vector(rotation, local);
                let corner = [
                    world_center[0] + rotated[0],
                    world_center[1] + rotated[1],
                    world_center[2] + rotated[2],
                ];
                assert!(
                    corner[0] >= bounds.min().x() - 1e-9 && corner[0] <= bounds.max().x() + 1e-9,
                    "corner x {corner:?} outside {bounds:?}"
                );
                assert!(
                    corner[1] >= bounds.min().y() - 1e-9 && corner[1] <= bounds.max().y() + 1e-9,
                    "corner y {corner:?} outside {bounds:?}"
                );
                assert!(
                    corner[2] >= bounds.min().z() - 1e-9 && corner[2] <= bounds.max().z() + 1e-9,
                    "corner z {corner:?} outside {bounds:?}"
                );
            }
        }
    }
}

fn quat_from_proto(q: &Quaternion) -> [f64; 4] {
    normalize_quat([q.x, q.y, q.z, q.w])
}

#[test]
fn world_point_rejects_non_finite_and_canonicalizes_negative_zero() {
    assert_eq!(
        WorldPointMm::new(f64::NAN, 0.0, 0.0),
        Err(ColliderDerivationError::NonFiniteWorldTranslation)
    );
    assert_eq!(
        WorldPointMm::new(0.0, f64::INFINITY, 0.0),
        Err(ColliderDerivationError::NonFiniteWorldTranslation)
    );
    assert_eq!(
        WorldPointMm::new(0.0, 0.0, f64::NEG_INFINITY),
        Err(ColliderDerivationError::NonFiniteWorldTranslation)
    );
    let point = WorldPointMm::new(-0.0, 1.0, -0.0).expect("finite");
    assert_eq!(point.x().to_bits(), 0.0_f64.to_bits());
    assert_eq!(point.z().to_bits(), 0.0_f64.to_bits());
}

#[test]
fn rotated_box_matches_world_contract_fixture() {
    // Exact case from scripts/world-contract.test.mjs
    // "primitive transforms derive rotated conservative AABBs".
    let half_turn = std::f64::consts::FRAC_1_SQRT_2;
    let shape = ShapeTree {
        nodes: vec![ShapeNode {
            transform: transform(
                10,
                20,
                30,
                Quaternion {
                    x: 0.0,
                    y: 0.0,
                    z: half_turn,
                    w: half_turn,
                },
            ),
            ..node(1, 0, 0, 0, 0, box_primitive(200, 400, 600))
        }],
    };
    let translation = WorldPointMm::new(100.0, 200.0, 300.0).expect("finite");
    let collider = derive_collider(&shape, translation).expect("fixture");
    assert_eq!(collider.parts()[0].node_id(), 1);
    assert_aabb_matches(
        collider.parts()[0].bounds(),
        [-90.0, 120.0, 30.0],
        [310.0, 320.0, 630.0],
    );
}

#[test]
fn identity_primitives_match_contract_half_extents() {
    let cases: Vec<(Primitive, [f64; 3])> = vec![
        (
            Primitive::Box(BoxPrimitive {
                size_x_mm: 100,
                size_y_mm: 200,
                size_z_mm: 300,
            }),
            [50.0, 100.0, 150.0],
        ),
        (
            Primitive::Sphere(SpherePrimitive { radius_mm: 40 }),
            [40.0, 40.0, 40.0],
        ),
        (
            Primitive::Capsule(CapsulePrimitive {
                radius_mm: 10,
                segment_length_mm: 20,
            }),
            [10.0, 20.0, 10.0],
        ),
        (
            Primitive::Cylinder(CylinderPrimitive {
                radius_mm: 15,
                height_mm: 80,
            }),
            [15.0, 40.0, 15.0],
        ),
        (
            Primitive::Cone(ConePrimitive {
                radius_mm: 12,
                height_mm: 60,
            }),
            [12.0, 30.0, 12.0],
        ),
        (
            Primitive::Panel(PanelPrimitive {
                width_mm: 100,
                height_mm: 50,
                thickness_mm: 4,
            }),
            [50.0, 25.0, 2.0],
        ),
    ];

    for (index, (primitive, half)) in cases.into_iter().enumerate() {
        let shape = ShapeTree {
            nodes: vec![node(1, 0, 0, 0, 0, Some(primitive))],
        };
        let collider = derive_collider(&shape, WorldPointMm::origin()).expect("identity primitive");
        assert_eq!(collider.parts().len(), 1);
        assert_aabb_matches(
            collider.parts()[0].bounds(),
            [-half[0], -half[1], -half[2]],
            [half[0], half[1], half[2]],
        );
        assert_eq!(
            collider.aggregate(),
            collider.parts()[0].bounds(),
            "case {index}"
        );
        let footprint = collider.horizontal_footprint();
        assert_eq!(footprint.min_x(), -half[0]);
        assert_eq!(footprint.max_x(), half[0]);
        assert_eq!(footprint.min_z(), -half[2]);
        assert_eq!(footprint.max_z(), half[2]);
    }
}

#[test]
fn entity_translation_offsets_every_part() {
    let shape = ShapeTree {
        nodes: vec![
            node(1, 0, 0, 0, 0, box_primitive(100, 100, 100)),
            node(2, 1, 200, 0, 0, box_primitive(50, 50, 50)),
        ],
    };
    let translation = WorldPointMm::new(1_000.0, 2_000.0, 3_000.0).expect("finite");
    let collider = derive_collider(&shape, translation).expect("tree");
    assert_aabb_matches(
        collider.parts()[0].bounds(),
        [950.0, 1950.0, 2950.0],
        [1050.0, 2050.0, 3050.0],
    );
    assert_aabb_matches(
        collider.parts()[1].bounds(),
        [1175.0, 1975.0, 2975.0],
        [1225.0, 2025.0, 3025.0],
    );
}

#[test]
fn parent_orientation_rotates_child_translation_before_addition() {
    // 90° about +y: local +x maps to −z. Parent before child (Hamilton parent*child).
    let parent_rotation = Quaternion {
        x: 0.0,
        y: (std::f64::consts::FRAC_PI_2 / 2.0).sin(),
        z: 0.0,
        w: (std::f64::consts::FRAC_PI_2 / 2.0).cos(),
    };
    let child_rotation = Quaternion {
        x: (std::f64::consts::FRAC_PI_2 / 2.0).sin(),
        y: 0.0,
        z: 0.0,
        w: (std::f64::consts::FRAC_PI_2 / 2.0).cos(),
    };
    let shape = ShapeTree {
        nodes: vec![
            ShapeNode {
                transform: transform(10, 20, 30, parent_rotation),
                ..node(1, 0, 0, 0, 0, box_primitive(20, 40, 60))
            },
            ShapeNode {
                transform: transform(100, 0, 0, child_rotation),
                ..node(2, 1, 0, 0, 0, box_primitive(10, 10, 10))
            },
        ],
    };

    let parent_q = quat_from_proto(&parent_rotation);
    let child_q = quat_from_proto(&child_rotation);
    let composed_child_q = multiply_quat(parent_q, child_q);
    let parent_center = [10.0, 20.0, 30.0];
    let child_local = [100.0, 0.0, 0.0];
    let rotated_child = rotate_vector(parent_q, child_local);
    let child_center = [
        parent_center[0] + rotated_child[0],
        parent_center[1] + rotated_child[1],
        parent_center[2] + rotated_child[2],
    ];

    let (parent_min, parent_max) =
        oracle_oriented_aabb(parent_center, [10.0, 20.0, 30.0], parent_q);
    let (child_min, child_max) =
        oracle_oriented_aabb(child_center, [5.0, 5.0, 5.0], composed_child_q);

    let collider = derive_collider(&shape, WorldPointMm::origin()).expect("composed");
    assert_eq!(collider.parts()[0].node_id(), 1);
    assert_eq!(collider.parts()[1].node_id(), 2);
    // Independent corner-minmax oracle (not production abs(R)*h).
    assert_aabb_matches_within(collider.parts()[0].bounds(), parent_min, parent_max, 1e-6);
    assert_aabb_matches_within(collider.parts()[1].bounds(), child_min, child_max, 1e-6);
    assert_corners_inside(
        collider.parts()[0].bounds(),
        parent_center,
        [10.0, 20.0, 30.0],
        parent_q,
    );
    assert_corners_inside(
        collider.parts()[1].bounds(),
        child_center,
        [5.0, 5.0, 5.0],
        composed_child_q,
    );
    // Independent CONTRACT §5 abs(R)*h formula.
    let (parent_abs_min, parent_abs_max) =
        oracle_aabb_from_abs_r(parent_center, [10.0, 20.0, 30.0], parent_q);
    let (child_abs_min, child_abs_max) =
        oracle_aabb_from_abs_r(child_center, [5.0, 5.0, 5.0], composed_child_q);
    assert_aabb_matches(collider.parts()[0].bounds(), parent_abs_min, parent_abs_max);
    assert_aabb_matches(collider.parts()[1].bounds(), child_abs_min, child_abs_max);

    // Child centre must follow parent rotation of local translation, not child rotation.
    let child_bounds = collider.parts()[1].bounds();
    let cx = (child_bounds.min().x() + child_bounds.max().x()) / 2.0;
    let cy = (child_bounds.min().y() + child_bounds.max().y()) / 2.0;
    let cz = (child_bounds.min().z() + child_bounds.max().z()) / 2.0;
    assert_close(cx, child_center[0], "child center x");
    assert_close(cy, child_center[1], "child center y");
    assert_close(cz, child_center[2], "child center z");
}

#[test]
fn rotated_box_matches_independent_corner_oracle() {
    // Unit quaternion for yaw θ = 0.6 about +y: (0, sin(θ/2), 0, cos(θ/2)).
    let angle = 0.6_f64;
    let rotation = Quaternion {
        x: 0.0,
        y: (angle / 2.0).sin(),
        z: 0.0,
        w: (angle / 2.0).cos(),
    };
    let shape = ShapeTree {
        nodes: vec![ShapeNode {
            transform: transform(5, -7, 11, rotation),
            ..node(1, 0, 0, 0, 0, box_primitive(80, 20, 40))
        }],
    };
    let q = quat_from_proto(&rotation);
    let translation = WorldPointMm::new(100.0, 200.0, 300.0).expect("finite");
    let center = [
        translation.x() + 5.0,
        translation.y() - 7.0,
        translation.z() + 11.0,
    ];
    let (expected_min, expected_max) = oracle_oriented_aabb(center, [40.0, 10.0, 20.0], q);
    let collider = derive_collider(&shape, translation).expect("rotated");
    assert_aabb_matches_within(
        collider.parts()[0].bounds(),
        expected_min,
        expected_max,
        1e-6,
    );
    assert_corners_inside(collider.parts()[0].bounds(), center, [40.0, 10.0, 20.0], q);
    let (abs_min, abs_max) = oracle_aabb_from_abs_r(center, [40.0, 10.0, 20.0], q);
    assert_aabb_matches(collider.parts()[0].bounds(), abs_min, abs_max);
}

#[test]
fn parts_sort_by_ascending_node_id_despite_shuffled_input() {
    let mut nodes = vec![
        node(30, 10, 300, 0, 0, box_primitive(20, 20, 20)),
        node(10, 0, 0, 0, 0, box_primitive(100, 100, 100)),
        node(20, 10, 0, 200, 0, box_primitive(40, 40, 40)),
    ];
    // Already shuffled; shuffle again into a second order and compare bits.
    let shape_a = ShapeTree {
        nodes: nodes.clone(),
    };
    nodes.swap(0, 2);
    nodes.swap(1, 2);
    let shape_b = ShapeTree { nodes };

    let a = derive_collider(&shape_a, WorldPointMm::origin()).expect("a");
    let b = derive_collider(&shape_b, WorldPointMm::origin()).expect("b");
    assert_eq!(
        a.parts()
            .iter()
            .map(|part| part.node_id())
            .collect::<Vec<_>>(),
        vec![10, 20, 30]
    );
    assert_eq!(a.canonical_bits(), b.canonical_bits());
    assert_eq!(a.aggregate(), b.aggregate());
}

#[test]
fn aggregate_is_component_wise_minmax_not_a_hull_merge_of_parts() {
    let shape = ShapeTree {
        nodes: vec![
            node(1, 0, 0, 0, 0, box_primitive(100, 100, 100)),
            node(2, 1, 500, 0, 0, box_primitive(100, 100, 100)),
        ],
    };
    let collider = derive_collider(&shape, WorldPointMm::origin()).expect("two boxes");
    // Parts remain separate: gap between them is not filled for overlap.
    let left = collider.parts()[0].bounds();
    let right = collider.parts()[1].bounds();
    assert!(!left.overlaps_positive_volume(right));

    let aggregate = collider.aggregate();
    assert_aabb_matches(aggregate, [-50.0, -50.0, -50.0], [550.0, 50.0, 50.0]);
    // Aggregate spans the gap, but parts do not merge into one overlap participant.
    assert_eq!(collider.parts().len(), 2);
}

#[test]
fn overlap_requires_strictly_positive_extent_on_all_axes() {
    let a = derive_collider(
        &ShapeTree {
            nodes: vec![node(1, 0, 0, 0, 0, box_primitive(100, 100, 100))],
        },
        WorldPointMm::origin(),
    )
    .expect("a")
    .parts()[0]
        .bounds();
    // Exact face contact on +x: a.max.x == b.min.x
    let face = derive_collider(
        &ShapeTree {
            nodes: vec![node(1, 0, 100, 0, 0, box_primitive(100, 100, 100))],
        },
        WorldPointMm::origin(),
    )
    .expect("face")
    .parts()[0]
        .bounds();
    assert_eq!(a.max().x(), face.min().x());
    assert!(!a.overlaps_positive_volume(face));

    // Edge contact: share an edge (touch on x and z, overlap would need y).
    let edge = derive_collider(
        &ShapeTree {
            nodes: vec![node(1, 0, 100, 0, 100, box_primitive(100, 100, 100))],
        },
        WorldPointMm::origin(),
    )
    .expect("edge")
    .parts()[0]
        .bounds();
    assert!(!a.overlaps_positive_volume(edge));

    // Point contact at the corner.
    let point = derive_collider(
        &ShapeTree {
            nodes: vec![node(1, 0, 100, 100, 100, box_primitive(100, 100, 100))],
        },
        WorldPointMm::origin(),
    )
    .expect("point")
    .parts()[0]
        .bounds();
    assert!(!a.overlaps_positive_volume(point));

    // Strictly positive volume overlap.
    let overlap = derive_collider(
        &ShapeTree {
            nodes: vec![node(1, 0, 50, 0, 0, box_primitive(100, 100, 100))],
        },
        WorldPointMm::origin(),
    )
    .expect("overlap")
    .parts()[0]
        .bounds();
    assert!(a.overlaps_positive_volume(overlap));
}

#[test]
fn cosmetic_fields_do_not_change_canonical_bits() {
    let bare = ShapeTree {
        nodes: vec![
            node(1, 0, 0, 0, 0, box_primitive(100, 200, 300)),
            node(2, 1, 40, 50, 60, box_primitive(10, 20, 30)),
        ],
    };
    let mut painted = bare.clone();
    painted.nodes[0].color = Some(ColorRgba {
        red: 255,
        green: 0,
        blue: 128,
        alpha: 255,
    });
    painted.nodes[0].material_tags = vec!["metal".into(), "shiny".into()];
    painted.nodes[0].joint_name = Some("root".into());
    painted.nodes[1].color = Some(ColorRgba {
        red: 1,
        green: 2,
        blue: 3,
        alpha: 4,
    });
    painted.nodes[1].material_tags = vec!["wood".into()];
    painted.nodes[1].joint_name = Some("limb".into());

    let translation = WorldPointMm::new(7.0, -3.0, 11.0).expect("finite");
    let bare_bits = derive_collider(&bare, translation)
        .expect("bare")
        .canonical_bits();
    let painted_bits = derive_collider(&painted, translation)
        .expect("painted")
        .canonical_bits();
    assert_eq!(bare_bits, painted_bits);
    assert!(!bare_bits.is_empty());
}

#[test]
fn canonical_bits_are_little_endian_node_id_and_f64_patterns() {
    let shape = ShapeTree {
        nodes: vec![node(42, 0, 10, 20, 30, box_primitive(100, 100, 100))],
    };
    let collider = derive_collider(&shape, WorldPointMm::origin()).expect("one part");
    let bits = collider.canonical_bits();
    assert_eq!(bits.len(), 4 + 6 * 8);
    assert_eq!(&bits[0..4], &42u32.to_le_bytes());
    let bounds = collider.parts()[0].bounds();
    let values = [
        bounds.min().x(),
        bounds.min().y(),
        bounds.min().z(),
        bounds.max().x(),
        bounds.max().y(),
        bounds.max().z(),
    ];
    for (index, value) in values.into_iter().enumerate() {
        let start = 4 + index * 8;
        assert_eq!(&bits[start..start + 8], &value.to_bits().to_le_bytes());
    }
}

#[test]
fn fail_closed_on_empty_tree_and_missing_invariants() {
    assert_eq!(
        derive_collider(&ShapeTree { nodes: Vec::new() }, WorldPointMm::origin()),
        Err(ColliderDerivationError::MissingValidatedInvariant {
            detail: "empty shape tree"
        })
    );

    let mut missing_transform = ShapeTree {
        nodes: vec![node(1, 0, 0, 0, 0, box_primitive(10, 10, 10))],
    };
    missing_transform.nodes[0].transform = None;
    assert!(matches!(
        derive_collider(&missing_transform, WorldPointMm::origin()),
        Err(ColliderDerivationError::MissingValidatedInvariant {
            detail: "missing transform"
        })
    ));

    let mut missing_rotation = ShapeTree {
        nodes: vec![node(1, 0, 0, 0, 0, box_primitive(10, 10, 10))],
    };
    missing_rotation.nodes[0].transform = Some(LocalTransform {
        translation: Some(Vector3Millimeters {
            x_mm: 0,
            y_mm: 0,
            z_mm: 0,
        }),
        rotation: None,
    });
    assert!(matches!(
        derive_collider(&missing_rotation, WorldPointMm::origin()),
        Err(ColliderDerivationError::MissingValidatedInvariant {
            detail: "missing rotation"
        })
    ));

    let mut missing_primitive = ShapeTree {
        nodes: vec![node(1, 0, 0, 0, 0, box_primitive(10, 10, 10))],
    };
    missing_primitive.nodes[0].primitive = None;
    assert!(matches!(
        derive_collider(&missing_primitive, WorldPointMm::origin()),
        Err(ColliderDerivationError::MissingValidatedInvariant {
            detail: "missing primitive"
        })
    ));

    let unknown_parent = ShapeTree {
        nodes: vec![node(1, 99, 0, 0, 0, box_primitive(10, 10, 10))],
    };
    assert!(matches!(
        derive_collider(&unknown_parent, WorldPointMm::origin()),
        Err(ColliderDerivationError::MissingValidatedInvariant {
            detail: "unknown parent"
        })
    ));

    let zero_id = ShapeTree {
        nodes: vec![node(0, 0, 0, 0, 0, box_primitive(10, 10, 10))],
    };
    assert!(matches!(
        derive_collider(&zero_id, WorldPointMm::origin()),
        Err(ColliderDerivationError::MissingValidatedInvariant {
            detail: "zero node_id"
        })
    ));

    let duplicate = ShapeTree {
        nodes: vec![
            node(1, 0, 0, 0, 0, box_primitive(10, 10, 10)),
            node(1, 0, 0, 0, 0, box_primitive(10, 10, 10)),
        ],
    };
    assert!(matches!(
        derive_collider(&duplicate, WorldPointMm::origin()),
        Err(ColliderDerivationError::MissingValidatedInvariant {
            detail: "duplicate node_id"
        })
    ));

    let mut non_finite_rotation = ShapeTree {
        nodes: vec![node(1, 0, 0, 0, 0, box_primitive(10, 10, 10))],
    };
    non_finite_rotation.nodes[0].transform = Some(LocalTransform {
        translation: Some(Vector3Millimeters {
            x_mm: 0,
            y_mm: 0,
            z_mm: 0,
        }),
        rotation: Some(Quaternion {
            x: f64::NAN,
            y: 0.0,
            z: 0.0,
            w: 1.0,
        }),
    });
    assert!(matches!(
        derive_collider(&non_finite_rotation, WorldPointMm::origin()),
        Err(ColliderDerivationError::MissingValidatedInvariant {
            detail: "non-finite rotation"
        })
    ));

    let cyclic = ShapeTree {
        nodes: vec![
            node(1, 2, 0, 0, 0, box_primitive(10, 10, 10)),
            node(2, 1, 0, 0, 0, box_primitive(10, 10, 10)),
        ],
    };
    assert!(matches!(
        derive_collider(&cyclic, WorldPointMm::origin()),
        Err(ColliderDerivationError::MissingValidatedInvariant {
            detail: "cycle in parent references"
        })
    ));
}

#[test]
fn capsule_zero_segment_half_extents_remain_radius_on_y() {
    let shape = ShapeTree {
        nodes: vec![node(
            1,
            0,
            0,
            0,
            0,
            Some(Primitive::Capsule(CapsulePrimitive {
                radius_mm: 25,
                segment_length_mm: 0,
            })),
        )],
    };
    let collider = derive_collider(&shape, WorldPointMm::origin()).expect("capsule");
    assert_aabb_matches(
        collider.parts()[0].bounds(),
        [-25.0, -25.0, -25.0],
        [25.0, 25.0, 25.0],
    );
}

#[test]
fn same_build_derivation_is_bit_identical_across_calls() {
    let shape = ShapeTree {
        nodes: vec![
            ShapeNode {
                transform: transform(
                    1,
                    2,
                    3,
                    Quaternion {
                        x: 0.1,
                        y: 0.2,
                        z: 0.3,
                        w: (1.0_f64 - 0.1 * 0.1 - 0.2 * 0.2 - 0.3 * 0.3).sqrt(),
                    },
                ),
                ..node(1, 0, 0, 0, 0, box_primitive(11, 13, 17))
            },
            node(2, 1, 9, -4, 5, box_primitive(3, 5, 7)),
        ],
    };
    let translation = WorldPointMm::new(123.5, -456.25, 789.125).expect("finite");
    let first = derive_collider(&shape, translation).expect("first");
    let second = derive_collider(&shape, translation).expect("second");
    assert_eq!(first.canonical_bits(), second.canonical_bits());
    assert_eq!(first, second);
}
