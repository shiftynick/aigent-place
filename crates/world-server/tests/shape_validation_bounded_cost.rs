//! Validation cost is bounded (task-047).
//!
//! `ARCHITECTURE.md` section 6 justifies the parametric grammar by claiming
//! "validation is closed-form and there is no malicious-asset surface". These
//! tests pin the two observable properties that claim rests on:
//!
//! 1. the part budget short-circuits **before** any per-node inspection, so an
//!    oversized candidate cannot make the server pay for its size; and
//! 2. traversal is iterative and terminating at the largest tree the catalog
//!    permits, including on the pathological deep chain and the deep chain
//!    that closes into a cycle.
//!
//! The workspace forbids `unsafe_code`, so a counting global allocator is not
//! available to measure heap use directly. Allocation is instead constrained by
//! construction: every buffer `validate_shape_tree` uses is allocated in one
//! block sized from the already-budget-checked node count, before the per-node
//! pass begins, and test 1 proves that pass is never reached when the budget
//! rejects.

use aigent_protocol::{
    shape_node::Primitive, BoxPrimitive, LocalTransform, Quaternion, ShapeNode, ShapeTree,
    Vector3Millimeters,
};
use world_server::{
    validate_shape_tree_with_budgets, RulesetParameters, ShapeBudgets, ShapeClass, ShapeRejection,
};

/// The catalog maximum for every `shape.*_max_parts` path.
const CATALOG_MAX_PARTS: u32 = 256;

fn node(node_id: u32, parent_node_id: u32, primitive: Option<Primitive>) -> ShapeNode {
    ShapeNode {
        node_id,
        parent_node_id,
        transform: Some(LocalTransform {
            translation: Some(Vector3Millimeters {
                x_mm: 10,
                y_mm: 20,
                z_mm: 30,
            }),
            rotation: Some(Quaternion {
                x: 0.0,
                y: 0.0,
                z: 0.0,
                w: 1.0,
            }),
        }),
        joint_name: None,
        color: None,
        material_tags: Vec::new(),
        primitive,
    }
}

fn unit_cube() -> Option<Primitive> {
    Some(Primitive::Box(BoxPrimitive {
        size_x_mm: 100,
        size_y_mm: 100,
        size_z_mm: 100,
    }))
}

/// A maximally deep tree: every node parents the previous one.
fn chain(node_count: u32, primitive: fn() -> Option<Primitive>) -> ShapeTree {
    ShapeTree {
        nodes: (1..=node_count)
            .map(|node_id| {
                node(
                    node_id,
                    if node_id == 1 { 0 } else { node_id - 1 },
                    primitive(),
                )
            })
            .collect(),
    }
}

fn budgets(max_parts: u32) -> ShapeBudgets {
    let mut parameters = RulesetParameters::catalog_defaults();
    parameters.set("shape.body_max_parts", i64::from(max_parts));
    parameters.set("shape.body_max_joints", i64::from(max_parts));
    ShapeBudgets::from_ruleset(&parameters, ShapeClass::Body).expect("budgets resolve")
}

/// Every node in this candidate is independently invalid, yet the reported
/// reason is the budget. That is only possible if the budget check runs before
/// any node is inspected — the property that bounds an oversized candidate's
/// cost to a single comparison.
#[test]
fn part_budget_short_circuits_before_any_per_node_work() {
    let oversized = chain(CATALOG_MAX_PARTS, || None);

    // Proof the nodes really are invalid: under a budget that admits them, the
    // very first node's defect is what rejects.
    assert_eq!(
        validate_shape_tree_with_budgets(&oversized, &budgets(CATALOG_MAX_PARTS)),
        Err(ShapeRejection::MissingPrimitive { node_id: 1 })
    );

    // Under a tighter budget the per-node defect is never observed.
    assert_eq!(
        validate_shape_tree_with_budgets(&oversized, &budgets(16)),
        Err(ShapeRejection::PartBudgetExceeded {
            limit: 16,
            found: CATALOG_MAX_PARTS as usize
        })
    );
}

/// `material_tags` is the one candidate-controlled input no shape budget
/// bounds (`ruleset/v1/CONTRACT.md` has no tag-count parameter). Validation
/// must still be correct and terminating on a wide tag list, and duplicate
/// detection must not degrade: the duplicate here sits at the very end, so a
/// check that gave up early would miss it.
#[test]
fn a_wide_material_tag_list_is_still_validated_correctly() {
    let wide: Vec<String> = (0..5_000).map(|index| format!("tag{index}")).collect();

    let mut accepted = chain(4, unit_cube);
    accepted.nodes[0].material_tags = wide.clone();
    assert_eq!(
        validate_shape_tree_with_budgets(&accepted, &budgets(CATALOG_MAX_PARTS)),
        Ok(()),
        "distinct tags must be accepted however many there are"
    );

    let mut duplicated = chain(4, unit_cube);
    let mut tags = wide.clone();
    tags.push("tag0".into());
    duplicated.nodes[0].material_tags = tags;
    assert_eq!(
        validate_shape_tree_with_budgets(&duplicated, &budgets(CATALOG_MAX_PARTS)),
        Err(ShapeRejection::DuplicateMaterialTag { node_id: 1 })
    );

    // One invalid tag anywhere in the list still rejects as an invalid tag,
    // distinctly from a duplicate.
    let mut invalid = chain(4, unit_cube);
    let mut tags = wide;
    tags.push("NotAnIdentifier".into());
    invalid.nodes[0].material_tags = tags;
    assert_eq!(
        validate_shape_tree_with_budgets(&invalid, &budgets(CATALOG_MAX_PARTS)),
        Err(ShapeRejection::InvalidMaterialTag { node_id: 1 })
    );
}

/// The deepest legal tree validates without recursing per level.
#[test]
fn the_deepest_catalog_legal_chain_validates() {
    let deep = chain(CATALOG_MAX_PARTS, unit_cube);
    assert_eq!(deep.nodes.len(), CATALOG_MAX_PARTS as usize);
    assert_eq!(
        validate_shape_tree_with_budgets(&deep, &budgets(CATALOG_MAX_PARTS)),
        Ok(())
    );
}

/// The adversarial shape of the same input: a maximal chain whose root instead
/// points back at the deepest node, so every node walks the whole chain before
/// discovering the cycle. Termination here is what makes the traversal safe to
/// run on untrusted input.
#[test]
fn a_maximal_chain_closed_into_a_cycle_terminates() {
    // A full-size chain whose head parents its own tail: no node has parent 0
    // any more, so the missing anchor is what rejects.
    let mut looped = chain(CATALOG_MAX_PARTS, unit_cube);
    looped.nodes[0].parent_node_id = CATALOG_MAX_PARTS;
    assert_eq!(
        validate_shape_tree_with_budgets(&looped, &budgets(CATALOG_MAX_PARTS)),
        Err(ShapeRejection::NoRoot)
    );

    // The same cycle alongside a genuine root, still at the catalog maximum:
    // now the cycle itself must be reported rather than looping forever.
    let mut with_root = chain(CATALOG_MAX_PARTS - 1, unit_cube);
    with_root.nodes[0].parent_node_id = CATALOG_MAX_PARTS - 1;
    with_root
        .nodes
        .insert(0, node(CATALOG_MAX_PARTS, 0, unit_cube()));
    assert_eq!(with_root.nodes.len(), CATALOG_MAX_PARTS as usize);
    assert_eq!(
        validate_shape_tree_with_budgets(&with_root, &budgets(CATALOG_MAX_PARTS)),
        Err(ShapeRejection::Cycle { node_id: 1 })
    );
}
