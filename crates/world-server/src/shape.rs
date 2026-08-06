//! Closed-form validation of a complete candidate shape tree.
//!
//! Implements ADR-0002 "Shape grammar and collider" and `world/v1/CONTRACT.md`
//! section 4. A shape is one rooted acyclic tree of parametric primitives; the
//! same grammar serves aigent bodies and placed objects, which carry different
//! ruleset budgets.
//!
//! Three properties are load-bearing and are the reason this module exists
//! (`ARCHITECTURE.md` section 6, "there is no malicious-asset surface"):
//!
//! * **All-or-nothing.** [`validate_shape_tree`] borrows the candidate and
//!   returns a value. It never rewrites, clamps, truncates, or partially
//!   accepts a tree, so a rejected candidate mutates nothing anywhere.
//! * **Bounded.** The part budget is checked before any per-node work, so an
//!   oversized tree costs one comparison. The remainder is three linear node
//!   passes — identity, the per-node rules, then the reachability walk — plus
//!   two tree-wide sorts and one sort of each node's own tag list. Heap
//!   allocation is fixed at five buffers, three taken before the per-node pass
//!   and two by the reachability walk after it; each is sized from a quantity
//!   already known when it is taken, and none is allocated per node. Reasons
//!   are reported in the canonical ascending `node_id` order, so input array
//!   order cannot change either the outcome or which defect is named.
//! * **Live budgets.** Part, joint, and extent limits are read from the live
//!   ruleset generation's parameter map, never from constants in this file. A
//!   generation missing a `shape.*` path rejects the candidate rather than
//!   silently substituting a default.
//!
//! One input is **not** bounded by a shape budget: `material_tags` has no
//! count limit in `ruleset/v1/CONTRACT.md`, so a single node may carry
//! arbitrarily many. Work stays linear-times-log in the encoded candidate the
//! transport already accepted — no shape budget multiplies it, and no node
//! allocates for its own tags — but that means the ceiling on this one surface
//! is the connection's message-size cap rather than the ruleset. Giving tags
//! their own catalog budget is a ruleset-contract change and is filed
//! separately rather than invented here.
//!
//! Shear is not representable: `LocalTransform` carries only a translation and
//! a rotation, and the rotation must be a unit quaternion. The unit-magnitude
//! check is therefore what keeps a rotation from smuggling in scale or shear,
//! and rejecting a non-unit quaternion is how ADR-0002's "shear rejects the
//! complete candidate shape" is enforced against this schema.
//!
//! Deriving the canonical AABB collider — and therefore the aggregate bound
//! that composed transforms imply — is task-048 and is deliberately not done
//! here. `shape.max_extent_mm` is applied at the granularity this module can
//! compute in closed integer form: each primitive's own local extent.
//! See [`ShapeBudgets::max_extent_mm`].

use crate::ruleset::RulesetParameters;
use aigent_protocol::{shape_node, Quaternion, ShapeNode, ShapeTree};

/// Hard world bound in millimetres (`world/v1/CONTRACT.md` section 3.1).
///
/// Transform translations are bounded by the same interval as world positions
/// so that no single node offset can leave the finite world.
pub const WORLD_BOUND_MM: i64 = 100_000_000;

/// Tolerance on a rotation's squared magnitude (`world/v1` section 4.1).
pub const QUATERNION_UNIT_TOLERANCE: f64 = 1e-6;

/// Maximum length of a joint name or material tag.
pub const MAX_IDENTIFIER_LEN: usize = 64;

/// Which ruleset budget class a candidate shape is validated against.
///
/// Bodies and placed objects deliberately have different part and joint
/// budgets (`ruleset/v1/CONTRACT.md` section 3).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ShapeClass {
    /// An aigent body shape (`shape.body_*` paths).
    Body,
    /// A placed object shape (`shape.object_*` paths).
    Object,
}

impl ShapeClass {
    fn max_parts_path(self) -> &'static str {
        match self {
            Self::Body => "shape.body_max_parts",
            Self::Object => "shape.object_max_parts",
        }
    }

    fn max_joints_path(self) -> &'static str {
        match self {
            Self::Body => "shape.body_max_joints",
            Self::Object => "shape.object_max_joints",
        }
    }
}

/// Which strictly positive primitive dimension failed, for a typed rejection
/// reason.
///
/// A capsule's cylindrical segment is deliberately absent: it is the one
/// dimension allowed to be zero, so its failure is
/// [`ShapeRejection::NegativeSegmentLength`] rather than a non-positive one.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum DimensionField {
    SizeX,
    SizeY,
    SizeZ,
    Radius,
    Height,
    Width,
    Thickness,
}

/// A world coordinate axis.
///
/// Shared by shape-extent rejections and entity position-boundary rejections:
/// both name the same right-handed axis from ADR-0002 (`x`/`z` horizontal,
/// `y` up), so they are one type rather than two identical ones.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Axis {
    X,
    Y,
    Z,
}

impl Axis {
    #[must_use]
    pub const fn as_str(self) -> &'static str {
        match self {
            Self::X => "x",
            Self::Y => "y",
            Self::Z => "z",
        }
    }
}

/// Closed set of reasons a complete candidate shape is rejected.
///
/// Every variant rejects the whole tree; there is no partial acceptance. The
/// command boundary that consumes these will report them all as the protocol's
/// `PHYSICS_REJECTION_CODE_INVALID_SHAPE`; the detail carried here is what an
/// owner needs in order to fix the candidate, and what tests assert on.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum ShapeRejection {
    /// The live ruleset generation does not carry a required budget path.
    MissingBudgetParameter { path: &'static str },
    /// A budget path exists but holds a value outside its catalog range.
    InvalidBudgetParameter { path: &'static str, value: i64 },
    /// A shape must contain at least one node.
    EmptyTree,
    /// Node count exceeds the class part budget.
    PartBudgetExceeded { limit: u32, found: usize },
    /// Nodes carrying a joint name exceed the class joint budget.
    JointBudgetExceeded { limit: u32, found: u32 },
    /// `node_id` zero is reserved to mean "no parent".
    ZeroNodeId,
    /// Two nodes share one `node_id`.
    DuplicateNodeId { node_id: u32 },
    /// A `parent_node_id` names no node in this tree.
    UnknownParent { node_id: u32, parent_node_id: u32 },
    /// No node has `parent_node_id == 0`.
    NoRoot,
    /// More than one node has `parent_node_id == 0`.
    MultipleRoots { node_ids: [u32; 2] },
    /// Parent references form a cycle, so this node never reaches the root.
    Cycle { node_id: u32 },
    /// A node carries no `LocalTransform`.
    MissingTransform { node_id: u32 },
    /// A node carries a transform with no rotation. The protobuf default
    /// quaternion is `(0, 0, 0, 0)`, not identity, so absence cannot be read
    /// as "unrotated".
    MissingRotation { node_id: u32 },
    /// A rotation component is NaN or infinite.
    NonFiniteRotation { node_id: u32 },
    /// A rotation's squared magnitude is not within tolerance of one, so it
    /// encodes scale or shear rather than an orientation.
    NonUnitRotation { node_id: u32 },
    /// A translation component leaves the finite world bound.
    TranslationOutOfBounds {
        node_id: u32,
        axis: Axis,
        value_mm: i64,
    },
    /// A node carries none of the six v1 primitives.
    MissingPrimitive { node_id: u32 },
    /// A primitive dimension that must be strictly positive is not.
    NonPositiveDimension {
        node_id: u32,
        field: DimensionField,
        value_mm: i64,
    },
    /// A capsule's cylindrical segment is negative. Zero is legal.
    NegativeSegmentLength { node_id: u32, value_mm: i64 },
    /// A primitive's own local extent exceeds `shape.max_extent_mm`.
    ExtentBudgetExceeded {
        node_id: u32,
        axis: Axis,
        extent_mm: i64,
        limit_mm: i64,
    },
    /// A joint name is not `[a-z][a-z0-9_.-]{0,63}`.
    InvalidJointName { node_id: u32 },
    /// Two nodes claim the same joint name.
    DuplicateJointName { node_id: u32 },
    /// A material tag is not `[a-z][a-z0-9_.-]{0,63}`.
    InvalidMaterialTag { node_id: u32 },
    /// One node repeats a material tag.
    DuplicateMaterialTag { node_id: u32 },
    /// An RGBA component is outside `0..=255`.
    ColorOutOfRange { node_id: u32, component: u32 },
}

/// Budgets resolved from one live ruleset generation for one shape class.
///
/// Fields are private and the only constructor is [`ShapeBudgets::from_ruleset`],
/// which range-checks every value against the `ruleset/v1/CONTRACT.md` catalog.
/// A caller therefore cannot hand the validator a budget the catalog could not
/// hold — such as an unbounded part count — and so cannot defeat the
/// boundedness this module's tests rely on.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct ShapeBudgets {
    max_parts: u32,
    max_joints: u32,
    max_extent_mm: i64,
}

impl ShapeBudgets {
    /// Maximum node count (`shape.body_max_parts` / `shape.object_max_parts`).
    #[must_use]
    pub fn max_parts(&self) -> u32 {
        self.max_parts
    }

    /// Maximum count of nodes carrying a joint name.
    #[must_use]
    pub fn max_joints(&self) -> u32 {
        self.max_joints
    }

    /// Maximum local extent of any single primitive on any of its own axes,
    /// from `shape.max_extent_mm`.
    ///
    /// The aggregate bound over composed transforms needs the canonical
    /// collider and is applied where that collider is derived (task-048); this
    /// per-primitive bound is the part expressible in closed integer form
    /// without composing rotations.
    #[must_use]
    pub fn max_extent_mm(&self) -> i64 {
        self.max_extent_mm
    }
    /// Read this class's budgets from a live ruleset generation.
    ///
    /// Returns a typed rejection rather than a constant fallback when a path
    /// is absent or outside its `ruleset/v1/CONTRACT.md` range, so budgets can
    /// never silently stop tracking the live generation.
    pub fn from_ruleset(
        parameters: &RulesetParameters,
        class: ShapeClass,
    ) -> Result<Self, ShapeRejection> {
        let max_parts = bounded_budget(parameters, class.max_parts_path(), 1, 256)?;
        let max_joints = bounded_budget(parameters, class.max_joints_path(), 0, 256)?;
        let max_extent_mm = bounded_budget(parameters, "shape.max_extent_mm", 1, 100_000)?;
        Ok(Self {
            // Ranges above keep every value inside `u32` / `i64`.
            max_parts: max_parts as u32,
            max_joints: max_joints as u32,
            max_extent_mm,
        })
    }
}

fn bounded_budget(
    parameters: &RulesetParameters,
    path: &'static str,
    low: i64,
    high: i64,
) -> Result<i64, ShapeRejection> {
    let value = parameters
        .get(path)
        .ok_or(ShapeRejection::MissingBudgetParameter { path })?;
    if !(low..=high).contains(&value) {
        return Err(ShapeRejection::InvalidBudgetParameter { path, value });
    }
    Ok(value)
}

/// Validate a complete candidate shape tree against the live ruleset.
///
/// This is the single entry point used by `place_object`, `set_shape`, and
/// body creation. It is all-or-nothing: the candidate is borrowed immutably
/// and either the whole tree is legal or the first typed reason is returned.
///
/// # Errors
///
/// Returns the [`ShapeRejection`] naming the first violated rule. Rules are
/// checked cheapest-first so an oversized candidate is rejected before any
/// per-node work is done.
pub fn validate_shape_tree(
    shape: &ShapeTree,
    class: ShapeClass,
    parameters: &RulesetParameters,
) -> Result<(), ShapeRejection> {
    let budgets = ShapeBudgets::from_ruleset(parameters, class)?;
    validate_shape_tree_with_budgets(shape, &budgets)
}

/// Validate against already-resolved budgets.
///
/// Callers validating many candidates against one live generation resolve
/// [`ShapeBudgets`] once and use this entry point.
///
/// # Errors
///
/// Returns the [`ShapeRejection`] naming the first violated rule.
pub fn validate_shape_tree_with_budgets(
    shape: &ShapeTree,
    budgets: &ShapeBudgets,
) -> Result<(), ShapeRejection> {
    let nodes = &shape.nodes;
    if nodes.is_empty() {
        return Err(ShapeRejection::EmptyTree);
    }
    // Checked before any per-node work so an oversized candidate costs one
    // comparison rather than a full traversal.
    if nodes.len() > budgets.max_parts as usize {
        return Err(ShapeRejection::PartBudgetExceeded {
            limit: budgets.max_parts,
            found: nodes.len(),
        });
    }

    // Every buffer the per-node pass uses is taken here, before that pass
    // begins, each sized from a quantity already known: the budget-checked node
    // count, the class joint budget, and the widest material-tag list. The
    // per-node pass itself allocates nothing; the only further allocation is
    // the fixed pair `check_connected_acyclic` takes once that pass completes.
    // Allocation count is therefore five, not a function of tree size.
    let widest_tag_list = nodes
        .iter()
        .map(|node| node.material_tags.len())
        .max()
        .unwrap_or(0);
    let mut index_by_id: Vec<(u32, u32)> = Vec::with_capacity(nodes.len());
    let mut joint_names: Vec<(&str, u32)> =
        Vec::with_capacity(nodes.len().min(budgets.max_joints as usize));
    // Reused across nodes rather than rebuilt per node.
    let mut tag_scratch: Vec<&str> = Vec::with_capacity(widest_tag_list);

    // Pass one establishes identity only, so that pass two can run in the
    // canonical ascending-`node_id` order `world/v1` section 4.1 defines.
    // Input array order is not semantic, and it must not decide which of
    // several defects is reported either.
    for (index, node) in nodes.iter().enumerate() {
        if node.node_id == 0 {
            return Err(ShapeRejection::ZeroNodeId);
        }
        // `index` is bounded by `max_parts` (<= 256), so the cast is exact.
        index_by_id.push((node.node_id, index as u32));
    }
    index_by_id.sort_unstable();
    if let Some(window) = index_by_id.windows(2).find(|pair| pair[0].0 == pair[1].0) {
        return Err(ShapeRejection::DuplicateNodeId {
            node_id: window[0].0,
        });
    }

    let mut root: Option<u32> = None;
    let mut joint_count: u32 = 0;

    for &(_, index) in &index_by_id {
        let node = &nodes[index as usize];
        if node.parent_node_id == 0 {
            if let Some(existing) = root {
                return Err(ShapeRejection::MultipleRoots {
                    node_ids: [existing, node.node_id],
                });
            }
            root = Some(node.node_id);
        }
        validate_transform(node)?;
        validate_primitive(node, budgets.max_extent_mm)?;
        validate_color(node)?;
        validate_material_tags(node, &mut tag_scratch)?;

        if let Some(name) = node.joint_name.as_deref() {
            if !is_valid_identifier(name) {
                return Err(ShapeRejection::InvalidJointName {
                    node_id: node.node_id,
                });
            }
            joint_count = joint_count.saturating_add(1);
            if joint_count > budgets.max_joints {
                return Err(ShapeRejection::JointBudgetExceeded {
                    limit: budgets.max_joints,
                    found: joint_count,
                });
            }
            joint_names.push((name, node.node_id));
        }
    }

    if root.is_none() {
        return Err(ShapeRejection::NoRoot);
    }

    joint_names.sort_unstable();
    if let Some(window) = joint_names.windows(2).find(|pair| pair[0].0 == pair[1].0) {
        return Err(ShapeRejection::DuplicateJointName {
            node_id: window[1].1,
        });
    }

    check_connected_acyclic(nodes, &index_by_id)
}

/// Confirm every node reaches the single root without revisiting a node.
///
/// Each non-root node has exactly one parent, so a node that fails to reach
/// the root must walk into a cycle. Detecting cycles therefore also proves the
/// tree is connected. Nodes finalized by an earlier walk are not rewalked, so
/// total work is linear in node count.
///
/// This is the last of the five allocation sites the module header counts: two
/// buffers, both sized from the already-budget-checked node count, both taken
/// once before the walk rather than per node. `path` cannot outgrow its
/// capacity because a node is marked `ON_PATH` before it is pushed, so no walk
/// pushes the same node twice.
fn check_connected_acyclic(
    nodes: &[ShapeNode],
    index_by_id: &[(u32, u32)],
) -> Result<(), ShapeRejection> {
    const UNKNOWN: u8 = 0;
    const ON_PATH: u8 = 1;
    const REACHES_ROOT: u8 = 2;

    let mut state = vec![UNKNOWN; nodes.len()];
    let mut path: Vec<usize> = Vec::with_capacity(nodes.len());

    // Canonical ascending-`node_id` order, so which node is named in an
    // `UnknownParent` or `Cycle` reason cannot depend on input array order.
    for &(_, start) in index_by_id {
        path.clear();
        let mut cursor = start as usize;
        loop {
            match state[cursor] {
                REACHES_ROOT => break,
                ON_PATH => {
                    return Err(ShapeRejection::Cycle {
                        node_id: nodes[cursor].node_id,
                    })
                }
                _ => {}
            }
            state[cursor] = ON_PATH;
            path.push(cursor);
            let parent_id = nodes[cursor].parent_node_id;
            if parent_id == 0 {
                break;
            }
            let Ok(found) = index_by_id.binary_search_by_key(&parent_id, |entry| entry.0) else {
                return Err(ShapeRejection::UnknownParent {
                    node_id: nodes[cursor].node_id,
                    parent_node_id: parent_id,
                });
            };
            cursor = index_by_id[found].1 as usize;
        }
        for &index in &path {
            state[index] = REACHES_ROOT;
        }
    }
    Ok(())
}

fn validate_transform(node: &ShapeNode) -> Result<(), ShapeRejection> {
    let transform = node
        .transform
        .as_ref()
        .ok_or(ShapeRejection::MissingTransform {
            node_id: node.node_id,
        })?;
    let rotation = transform
        .rotation
        .as_ref()
        .ok_or(ShapeRejection::MissingRotation {
            node_id: node.node_id,
        })?;
    validate_rotation(node.node_id, rotation)?;

    // An absent translation is the protobuf default zero vector, which is a
    // meaningful and legal offset. An absent rotation is not, which is why the
    // two are treated differently.
    if let Some(translation) = transform.translation.as_ref() {
        for (axis, value) in [
            (Axis::X, translation.x_mm),
            (Axis::Y, translation.y_mm),
            (Axis::Z, translation.z_mm),
        ] {
            if !(-WORLD_BOUND_MM..=WORLD_BOUND_MM).contains(&value) {
                return Err(ShapeRejection::TranslationOutOfBounds {
                    node_id: node.node_id,
                    axis,
                    value_mm: value,
                });
            }
        }
    }
    Ok(())
}

fn validate_rotation(node_id: u32, rotation: &Quaternion) -> Result<(), ShapeRejection> {
    let components = [rotation.x, rotation.y, rotation.z, rotation.w];
    if components.iter().any(|value| !value.is_finite()) {
        return Err(ShapeRejection::NonFiniteRotation { node_id });
    }
    let magnitude_squared = components.iter().map(|value| value * value).sum::<f64>();
    if (magnitude_squared - 1.0).abs() > QUATERNION_UNIT_TOLERANCE {
        return Err(ShapeRejection::NonUnitRotation { node_id });
    }
    Ok(())
}

/// Check the node's primitive dimensions and its own local extent budget.
///
/// Local extents follow the half-extent table in `world/v1/CONTRACT.md`
/// section 4.2, doubled to full extents. Arithmetic is checked: a dimension
/// large enough to overflow is by construction far past any legal
/// `shape.max_extent_mm` (whose catalog maximum is 100000), so overflow is
/// reported as extent excess rather than panicking or wrapping.
fn validate_primitive(node: &ShapeNode, max_extent_mm: i64) -> Result<(), ShapeRejection> {
    let node_id = node.node_id;
    let primitive = node
        .primitive
        .as_ref()
        .ok_or(ShapeRejection::MissingPrimitive { node_id })?;

    let extents = match primitive {
        shape_node::Primitive::Box(shape) => {
            positive(node_id, DimensionField::SizeX, shape.size_x_mm)?;
            positive(node_id, DimensionField::SizeY, shape.size_y_mm)?;
            positive(node_id, DimensionField::SizeZ, shape.size_z_mm)?;
            [
                Some(shape.size_x_mm),
                Some(shape.size_y_mm),
                Some(shape.size_z_mm),
            ]
        }
        shape_node::Primitive::Sphere(shape) => {
            positive(node_id, DimensionField::Radius, shape.radius_mm)?;
            let diameter = shape.radius_mm.checked_mul(2);
            [diameter, diameter, diameter]
        }
        shape_node::Primitive::Capsule(shape) => {
            positive(node_id, DimensionField::Radius, shape.radius_mm)?;
            // ADR-0002: the cylindrical segment alone may be zero.
            if shape.segment_length_mm < 0 {
                return Err(ShapeRejection::NegativeSegmentLength {
                    node_id,
                    value_mm: shape.segment_length_mm,
                });
            }
            let diameter = shape.radius_mm.checked_mul(2);
            let height = diameter.and_then(|value| value.checked_add(shape.segment_length_mm));
            [diameter, height, diameter]
        }
        shape_node::Primitive::Cylinder(shape) => {
            positive(node_id, DimensionField::Radius, shape.radius_mm)?;
            positive(node_id, DimensionField::Height, shape.height_mm)?;
            let diameter = shape.radius_mm.checked_mul(2);
            [diameter, Some(shape.height_mm), diameter]
        }
        shape_node::Primitive::Cone(shape) => {
            positive(node_id, DimensionField::Radius, shape.radius_mm)?;
            positive(node_id, DimensionField::Height, shape.height_mm)?;
            let diameter = shape.radius_mm.checked_mul(2);
            [diameter, Some(shape.height_mm), diameter]
        }
        shape_node::Primitive::Panel(shape) => {
            positive(node_id, DimensionField::Width, shape.width_mm)?;
            positive(node_id, DimensionField::Height, shape.height_mm)?;
            // A panel is thin, never flat: thickness must be non-zero.
            positive(node_id, DimensionField::Thickness, shape.thickness_mm)?;
            [
                Some(shape.width_mm),
                Some(shape.height_mm),
                Some(shape.thickness_mm),
            ]
        }
    };

    for (axis, extent) in [Axis::X, Axis::Y, Axis::Z].into_iter().zip(extents) {
        match extent {
            Some(value) if value <= max_extent_mm => {}
            _ => {
                return Err(ShapeRejection::ExtentBudgetExceeded {
                    node_id,
                    axis,
                    extent_mm: extent.unwrap_or(i64::MAX),
                    limit_mm: max_extent_mm,
                })
            }
        }
    }
    Ok(())
}

fn positive(node_id: u32, field: DimensionField, value_mm: i64) -> Result<(), ShapeRejection> {
    if value_mm <= 0 {
        return Err(ShapeRejection::NonPositiveDimension {
            node_id,
            field,
            value_mm,
        });
    }
    Ok(())
}

fn validate_color(node: &ShapeNode) -> Result<(), ShapeRejection> {
    let Some(color) = node.color.as_ref() else {
        return Ok(());
    };
    for component in [color.red, color.green, color.blue, color.alpha] {
        if component > 255 {
            return Err(ShapeRejection::ColorOutOfRange {
                node_id: node.node_id,
                component,
            });
        }
    }
    Ok(())
}

/// Validate one node's material tags, reusing a caller-owned scratch buffer so
/// the per-node pass performs no heap allocation of its own.
fn validate_material_tags<'a>(
    node: &'a ShapeNode,
    scratch: &mut Vec<&'a str>,
) -> Result<(), ShapeRejection> {
    scratch.clear();
    for tag in &node.material_tags {
        if !is_valid_identifier(tag) {
            return Err(ShapeRejection::InvalidMaterialTag {
                node_id: node.node_id,
            });
        }
        scratch.push(tag.as_str());
    }
    scratch.sort_unstable();
    if scratch.windows(2).any(|pair| pair[0] == pair[1]) {
        return Err(ShapeRejection::DuplicateMaterialTag {
            node_id: node.node_id,
        });
    }
    Ok(())
}

/// `[a-z][a-z0-9_.-]{0,63}` (`world/v1/CONTRACT.md` section 4.1).
#[must_use]
pub fn is_valid_identifier(value: &str) -> bool {
    if value.len() > MAX_IDENTIFIER_LEN {
        return false;
    }
    let mut characters = value.chars();
    let Some(first) = characters.next() else {
        return false;
    };
    if !first.is_ascii_lowercase() {
        return false;
    }
    characters.all(|character| {
        character.is_ascii_lowercase()
            || character.is_ascii_digit()
            || character == '_'
            || character == '.'
            || character == '-'
    })
}
