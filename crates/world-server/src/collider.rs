//! Canonical AABB collider derivation from a validated shape tree.
//!
//! Implements ADR-0002 "Shape grammar and collider" and `world/v1/CONTRACT.md`
//! section 5. Given an already-validated [`ShapeTree`] and an entity world
//! translation in millimetres, this module derives one conservative world-axis
//! aligned bounding box per node, ordered by ascending `node_id`, plus the
//! aggregate AABB and horizontal footprint consumed by grounding, placement,
//! and enclosure.
//!
//! Composition follows the accepted right-handed convention used by the
//! `world/v1` contract evaluator: parent orientation and origin compose before
//! the child; local translation is rotated by the parent orientation before
//! addition; quaternion product is Hamilton `parent * child`. World half-
//! extents use `abs(R) * h` from section 5. Color, material tags, and joint
//! names never enter the derivation or the canonical bit encoding.
//!
//! Aggregate ruleset extent budgeting is deliberately not applied here
//! (task-2929451841000001). This boundary only fails closed on non-finite
//! arithmetic and on invariants a validated tree must already satisfy.

use aigent_protocol::{shape_node, Quaternion, ShapeNode, ShapeTree};

/// A finite world-space point in millimetres.
///
/// Fields are private so callers cannot bypass the finite / negative-zero
/// invariant. Components stay in millimetres because odd primitive dimensions
/// and rotated extents are fractional under `f64` division.
#[derive(Debug, Clone, Copy)]
pub struct WorldPointMm {
    x: f64,
    y: f64,
    z: f64,
}

impl WorldPointMm {
    /// Validate millimetre components into a canonical world point.
    ///
    /// # Errors
    ///
    /// Returns [`ColliderDerivationError::NonFiniteWorldTranslation`] when any
    /// caller-supplied component is NaN or infinite. Internal derivation sites
    /// that build derived coordinates remap that failure to
    /// [`ColliderDerivationError::NonFiniteDerivedArithmetic`].
    pub fn new(x: f64, y: f64, z: f64) -> Result<Self, ColliderDerivationError> {
        Ok(Self {
            x: canonicalize_mm(x).ok_or(ColliderDerivationError::NonFiniteWorldTranslation)?,
            y: canonicalize_mm(y).ok_or(ColliderDerivationError::NonFiniteWorldTranslation)?,
            z: canonicalize_mm(z).ok_or(ColliderDerivationError::NonFiniteWorldTranslation)?,
        })
    }

    /// The world origin in millimetres.
    #[must_use]
    pub const fn origin() -> Self {
        Self {
            x: 0.0,
            y: 0.0,
            z: 0.0,
        }
    }

    #[must_use]
    pub const fn x(self) -> f64 {
        self.x
    }

    #[must_use]
    pub const fn y(self) -> f64 {
        self.y
    }

    #[must_use]
    pub const fn z(self) -> f64 {
        self.z
    }
}

impl PartialEq for WorldPointMm {
    fn eq(&self, other: &Self) -> bool {
        self.x.to_bits() == other.x.to_bits()
            && self.y.to_bits() == other.y.to_bits()
            && self.z.to_bits() == other.z.to_bits()
    }
}

impl Eq for WorldPointMm {}

/// An axis-aligned bounding box in millimetres.
#[derive(Debug, Clone, Copy)]
pub struct Aabb {
    min: WorldPointMm,
    max: WorldPointMm,
}

impl Aabb {
    #[must_use]
    pub const fn min(self) -> WorldPointMm {
        self.min
    }

    #[must_use]
    pub const fn max(self) -> WorldPointMm {
        self.max
    }

    /// True only when the intersection has strictly positive extent on all
    /// three axes. Exact face, edge, and point contact are not overlap.
    #[must_use]
    pub fn overlaps_positive_volume(self, other: Self) -> bool {
        self.max.x() > other.min.x()
            && self.min.x() < other.max.x()
            && self.max.y() > other.min.y()
            && self.min.y() < other.max.y()
            && self.max.z() > other.min.z()
            && self.min.z() < other.max.z()
    }

    /// Horizontal (`x`/`z`) footprint of this box.
    #[must_use]
    pub fn horizontal_footprint(self) -> HorizontalFootprint {
        HorizontalFootprint {
            min_x: self.min.x(),
            max_x: self.max.x(),
            min_z: self.min.z(),
            max_z: self.max.z(),
        }
    }

    fn from_center_half(
        center: WorldPointMm,
        half: [f64; 3],
    ) -> Result<Self, ColliderDerivationError> {
        let min = derived_world_point(
            checked_sub(center.x(), half[0])?,
            checked_sub(center.y(), half[1])?,
            checked_sub(center.z(), half[2])?,
        )?;
        let max = derived_world_point(
            checked_add(center.x(), half[0])?,
            checked_add(center.y(), half[1])?,
            checked_add(center.z(), half[2])?,
        )?;
        Ok(Self { min, max })
    }

    fn component_wise_union(parts: &[NodeAabb]) -> Result<Self, ColliderDerivationError> {
        let first = parts
            .first()
            .ok_or(ColliderDerivationError::MissingValidatedInvariant {
                detail: "empty node aabb list",
            })?;
        let mut min_x = first.bounds.min.x();
        let mut min_y = first.bounds.min.y();
        let mut min_z = first.bounds.min.z();
        let mut max_x = first.bounds.max.x();
        let mut max_y = first.bounds.max.y();
        let mut max_z = first.bounds.max.z();
        for part in parts.iter().skip(1) {
            min_x = min_x.min(part.bounds.min.x());
            min_y = min_y.min(part.bounds.min.y());
            min_z = min_z.min(part.bounds.min.z());
            max_x = max_x.max(part.bounds.max.x());
            max_y = max_y.max(part.bounds.max.y());
            max_z = max_z.max(part.bounds.max.z());
        }
        Ok(Self {
            min: derived_world_point(min_x, min_y, min_z)?,
            max: derived_world_point(max_x, max_y, max_z)?,
        })
    }
}

impl PartialEq for Aabb {
    fn eq(&self, other: &Self) -> bool {
        self.min == other.min && self.max == other.max
    }
}

impl Eq for Aabb {}

/// Aggregate horizontal footprint on the `x`/`z` plane.
#[derive(Debug, Clone, Copy)]
pub struct HorizontalFootprint {
    min_x: f64,
    max_x: f64,
    min_z: f64,
    max_z: f64,
}

impl HorizontalFootprint {
    #[must_use]
    pub const fn min_x(self) -> f64 {
        self.min_x
    }

    #[must_use]
    pub const fn max_x(self) -> f64 {
        self.max_x
    }

    #[must_use]
    pub const fn min_z(self) -> f64 {
        self.min_z
    }

    #[must_use]
    pub const fn max_z(self) -> f64 {
        self.max_z
    }
}

impl PartialEq for HorizontalFootprint {
    fn eq(&self, other: &Self) -> bool {
        self.min_x.to_bits() == other.min_x.to_bits()
            && self.max_x.to_bits() == other.max_x.to_bits()
            && self.min_z.to_bits() == other.min_z.to_bits()
            && self.max_z.to_bits() == other.max_z.to_bits()
    }
}

impl Eq for HorizontalFootprint {}

/// One node's conservative world AABB, tagged with its `node_id`.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct NodeAabb {
    node_id: u32,
    bounds: Aabb,
}

impl NodeAabb {
    #[must_use]
    pub const fn node_id(self) -> u32 {
        self.node_id
    }

    #[must_use]
    pub const fn bounds(self) -> Aabb {
        self.bounds
    }
}

/// Ordered union of per-node AABBs plus the aggregate hull of those parts.
///
/// Parts are never merged for overlap or sweep; [`Collider::aggregate`] is the
/// component-wise min/max used by world-bound, broadphase, budget, and
/// enclosure checks.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Collider {
    parts: Vec<NodeAabb>,
    aggregate: Aabb,
}

impl Collider {
    /// Per-node AABBs in ascending `node_id` order.
    #[must_use]
    pub fn parts(&self) -> &[NodeAabb] {
        &self.parts
    }

    /// Component-wise min/max over [`Collider::parts`].
    #[must_use]
    pub fn aggregate(&self) -> Aabb {
        self.aggregate
    }

    /// Aggregate horizontal footprint.
    #[must_use]
    pub fn horizontal_footprint(&self) -> HorizontalFootprint {
        self.aggregate.horizontal_footprint()
    }

    /// Same-build deterministic bit/byte encoding of the ordered part AABBs.
    ///
    /// Encoding is little-endian: for each part, `node_id` (`u32`) then the six
    /// `f64` IEEE-754 bit patterns of `min.x/y/z` and `max.x/y/z`. Color,
    /// material tags, and joint names are absent by construction.
    #[must_use]
    pub fn canonical_bits(&self) -> Vec<u8> {
        let mut bytes = Vec::with_capacity(self.parts.len() * (4 + 6 * 8));
        for part in &self.parts {
            bytes.extend_from_slice(&part.node_id.to_le_bytes());
            for component in [
                part.bounds.min.x(),
                part.bounds.min.y(),
                part.bounds.min.z(),
                part.bounds.max.x(),
                part.bounds.max.y(),
                part.bounds.max.z(),
            ] {
                bytes.extend_from_slice(&component.to_bits().to_le_bytes());
            }
        }
        bytes
    }
}

/// Closed set of reasons collider derivation fails.
///
/// Derivation assumes the tree was already accepted by shape validation. Any
/// missing transform, rotation, primitive, parent, or identity invariant at
/// this boundary is treated as a fail-closed programming/contract error rather
/// than silently inventing geometry.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum ColliderDerivationError {
    /// Caller-supplied [`WorldPointMm`] components were NaN or infinite.
    NonFiniteWorldTranslation,
    /// Checked derived geometry arithmetic produced a non-finite value
    /// (add/sub/dot/extent/quaternion product/integer cast), or an internally
    /// constructed world coordinate failed finiteness after that arithmetic.
    NonFiniteDerivedArithmetic,
    /// A supposedly validated-tree invariant required by derivation is absent.
    MissingValidatedInvariant { detail: &'static str },
}

/// Derive the canonical collider for a validated shape at a world translation.
///
/// # Errors
///
/// Returns [`ColliderDerivationError`] when derived geometry arithmetic becomes
/// non-finite, or when a transform / primitive / parent invariant that shape
/// validation should already have enforced is missing.
pub fn derive_collider(
    shape: &ShapeTree,
    translation: WorldPointMm,
) -> Result<Collider, ColliderDerivationError> {
    if shape.nodes.is_empty() {
        return Err(ColliderDerivationError::MissingValidatedInvariant {
            detail: "empty shape tree",
        });
    }

    let mut index_by_id: Vec<(u32, u32)> = Vec::with_capacity(shape.nodes.len());
    for (index, node) in shape.nodes.iter().enumerate() {
        if node.node_id == 0 {
            return Err(ColliderDerivationError::MissingValidatedInvariant {
                detail: "zero node_id",
            });
        }
        index_by_id.push((node.node_id, index as u32));
    }
    index_by_id.sort_unstable();
    if index_by_id.windows(2).any(|pair| pair[0].0 == pair[1].0) {
        return Err(ColliderDerivationError::MissingValidatedInvariant {
            detail: "duplicate node_id",
        });
    }

    let mut parts = Vec::with_capacity(shape.nodes.len());
    let mut composed: Vec<Option<ComposedPose>> = vec![None; shape.nodes.len()];
    // Tracks the active parent-walk so a cyclic "validated" tree fails closed
    // instead of overflowing the stack.
    let mut on_path = vec![false; shape.nodes.len()];

    for &(_, index) in &index_by_id {
        let node = &shape.nodes[index as usize];
        let pose = compose_pose(
            node,
            &shape.nodes,
            &index_by_id,
            &mut composed,
            &mut on_path,
        )?;
        let half = primitive_half_extents_mm(node)?;
        let matrix = rotation_matrix(pose.rotation);
        let world_half = [
            checked_extent(matrix[0], half)?,
            checked_extent(matrix[1], half)?,
            checked_extent(matrix[2], half)?,
        ];
        let center = derived_world_point(
            checked_add(translation.x(), pose.center[0])?,
            checked_add(translation.y(), pose.center[1])?,
            checked_add(translation.z(), pose.center[2])?,
        )?;
        parts.push(NodeAabb {
            node_id: node.node_id,
            bounds: Aabb::from_center_half(center, world_half)?,
        });
    }

    let aggregate = Aabb::component_wise_union(&parts)?;
    Ok(Collider { parts, aggregate })
}

#[derive(Clone, Copy)]
struct ComposedPose {
    center: [f64; 3],
    rotation: UnitQuat,
}

#[derive(Clone, Copy)]
struct UnitQuat {
    x: f64,
    y: f64,
    z: f64,
    w: f64,
}

fn compose_pose(
    node: &ShapeNode,
    nodes: &[ShapeNode],
    index_by_id: &[(u32, u32)],
    cache: &mut [Option<ComposedPose>],
    on_path: &mut [bool],
) -> Result<ComposedPose, ColliderDerivationError> {
    let index = index_by_id
        .binary_search_by_key(&node.node_id, |entry| entry.0)
        .map_err(|_| ColliderDerivationError::MissingValidatedInvariant {
            detail: "node missing from index",
        })?;
    let node_index = index_by_id[index].1 as usize;
    if let Some(pose) = cache[node_index] {
        return Ok(pose);
    }
    if on_path[node_index] {
        return Err(ColliderDerivationError::MissingValidatedInvariant {
            detail: "cycle in parent references",
        });
    }
    on_path[node_index] = true;
    let composed = compose_pose_uncached(node, nodes, index_by_id, cache, on_path);
    on_path[node_index] = false;
    let pose = composed?;
    cache[node_index] = Some(pose);
    Ok(pose)
}

fn compose_pose_uncached(
    node: &ShapeNode,
    nodes: &[ShapeNode],
    index_by_id: &[(u32, u32)],
    cache: &mut [Option<ComposedPose>],
    on_path: &mut [bool],
) -> Result<ComposedPose, ColliderDerivationError> {
    let transform =
        node.transform
            .as_ref()
            .ok_or(ColliderDerivationError::MissingValidatedInvariant {
                detail: "missing transform",
            })?;
    let rotation =
        transform
            .rotation
            .as_ref()
            .ok_or(ColliderDerivationError::MissingValidatedInvariant {
                detail: "missing rotation",
            })?;
    let local_rotation = normalize_quaternion(rotation)?;
    let local_translation = match transform.translation.as_ref() {
        Some(vector) => [
            i64_to_f64_mm(vector.x_mm)?,
            i64_to_f64_mm(vector.y_mm)?,
            i64_to_f64_mm(vector.z_mm)?,
        ],
        None => [0.0, 0.0, 0.0],
    };

    if node.parent_node_id == 0 {
        return Ok(ComposedPose {
            center: local_translation,
            rotation: local_rotation,
        });
    }

    let parent_index = index_by_id
        .binary_search_by_key(&node.parent_node_id, |entry| entry.0)
        .map_err(|_| ColliderDerivationError::MissingValidatedInvariant {
            detail: "unknown parent",
        })?;
    let parent_node = &nodes[index_by_id[parent_index].1 as usize];
    let parent = compose_pose(parent_node, nodes, index_by_id, cache, on_path)?;
    let rotated = rotate_vector(parent.rotation, local_translation)?;
    Ok(ComposedPose {
        center: [
            checked_add(parent.center[0], rotated[0])?,
            checked_add(parent.center[1], rotated[1])?,
            checked_add(parent.center[2], rotated[2])?,
        ],
        rotation: multiply_quaternion(parent.rotation, local_rotation)?,
    })
}

fn primitive_half_extents_mm(node: &ShapeNode) -> Result<[f64; 3], ColliderDerivationError> {
    let primitive =
        node.primitive
            .as_ref()
            .ok_or(ColliderDerivationError::MissingValidatedInvariant {
                detail: "missing primitive",
            })?;
    // Half-extents from `world/v1/CONTRACT.md` section 4.2. Integer millimetre
    // parameters become `f64` so odd sizes and rotated extents stay exact under
    // division by two.
    match primitive {
        shape_node::Primitive::Box(shape) => Ok([
            i64_to_f64_mm(shape.size_x_mm)? / 2.0,
            i64_to_f64_mm(shape.size_y_mm)? / 2.0,
            i64_to_f64_mm(shape.size_z_mm)? / 2.0,
        ]),
        shape_node::Primitive::Sphere(shape) => {
            let radius = i64_to_f64_mm(shape.radius_mm)?;
            Ok([radius, radius, radius])
        }
        shape_node::Primitive::Capsule(shape) => {
            let radius = i64_to_f64_mm(shape.radius_mm)?;
            let segment = i64_to_f64_mm(shape.segment_length_mm)?;
            Ok([radius, segment / 2.0 + radius, radius])
        }
        shape_node::Primitive::Cylinder(shape) => {
            let radius = i64_to_f64_mm(shape.radius_mm)?;
            let height = i64_to_f64_mm(shape.height_mm)?;
            Ok([radius, height / 2.0, radius])
        }
        shape_node::Primitive::Cone(shape) => {
            let radius = i64_to_f64_mm(shape.radius_mm)?;
            let height = i64_to_f64_mm(shape.height_mm)?;
            Ok([radius, height / 2.0, radius])
        }
        shape_node::Primitive::Panel(shape) => Ok([
            i64_to_f64_mm(shape.width_mm)? / 2.0,
            i64_to_f64_mm(shape.height_mm)? / 2.0,
            i64_to_f64_mm(shape.thickness_mm)? / 2.0,
        ]),
    }
}

fn normalize_quaternion(rotation: &Quaternion) -> Result<UnitQuat, ColliderDerivationError> {
    let components = [rotation.x, rotation.y, rotation.z, rotation.w];
    if components.iter().any(|value| !value.is_finite()) {
        return Err(ColliderDerivationError::MissingValidatedInvariant {
            detail: "non-finite rotation",
        });
    }
    let magnitude_squared = components.iter().map(|value| value * value).sum::<f64>();
    if !magnitude_squared.is_finite() || magnitude_squared == 0.0 {
        return Err(ColliderDerivationError::MissingValidatedInvariant {
            detail: "degenerate rotation",
        });
    }
    let magnitude = magnitude_squared.sqrt();
    if !magnitude.is_finite() || magnitude == 0.0 {
        return Err(ColliderDerivationError::MissingValidatedInvariant {
            detail: "degenerate rotation magnitude",
        });
    }
    let mut normalized = UnitQuat {
        x: rotation.x / magnitude,
        y: rotation.y / magnitude,
        z: rotation.z / magnitude,
        w: rotation.w / magnitude,
    };
    // Canonical sign: first non-zero of (w, x, y, z) is made positive so q and
    // -q share one representation (`world/v1` section 4.1).
    let first = [normalized.w, normalized.x, normalized.y, normalized.z]
        .into_iter()
        .find(|value| *value != 0.0);
    if let Some(value) = first {
        if value < 0.0 {
            normalized.x = -normalized.x;
            normalized.y = -normalized.y;
            normalized.z = -normalized.z;
            normalized.w = -normalized.w;
        }
    }
    Ok(UnitQuat {
        x: canonicalize_mm(normalized.x).ok_or(
            ColliderDerivationError::MissingValidatedInvariant {
                detail: "non-finite normalized rotation",
            },
        )?,
        y: canonicalize_mm(normalized.y).ok_or(
            ColliderDerivationError::MissingValidatedInvariant {
                detail: "non-finite normalized rotation",
            },
        )?,
        z: canonicalize_mm(normalized.z).ok_or(
            ColliderDerivationError::MissingValidatedInvariant {
                detail: "non-finite normalized rotation",
            },
        )?,
        w: canonicalize_mm(normalized.w).ok_or(
            ColliderDerivationError::MissingValidatedInvariant {
                detail: "non-finite normalized rotation",
            },
        )?,
    })
}

fn multiply_quaternion(a: UnitQuat, b: UnitQuat) -> Result<UnitQuat, ColliderDerivationError> {
    // Hamilton product; compose as parent * child (parent before child).
    let product = Quaternion {
        x: a.w * b.x + a.x * b.w + a.y * b.z - a.z * b.y,
        y: a.w * b.y - a.x * b.z + a.y * b.w + a.z * b.x,
        z: a.w * b.z + a.x * b.y - a.y * b.x + a.z * b.w,
        w: a.w * b.w - a.x * b.x - a.y * b.y - a.z * b.z,
    };
    if ![product.x, product.y, product.z, product.w]
        .iter()
        .all(|value| value.is_finite())
    {
        return Err(ColliderDerivationError::NonFiniteDerivedArithmetic);
    }
    normalize_quaternion(&product)
}

fn rotation_matrix(q: UnitQuat) -> [[f64; 3]; 3] {
    [
        [
            1.0 - 2.0 * (q.y * q.y + q.z * q.z),
            2.0 * (q.x * q.y - q.z * q.w),
            2.0 * (q.x * q.z + q.y * q.w),
        ],
        [
            2.0 * (q.x * q.y + q.z * q.w),
            1.0 - 2.0 * (q.x * q.x + q.z * q.z),
            2.0 * (q.y * q.z - q.x * q.w),
        ],
        [
            2.0 * (q.x * q.z - q.y * q.w),
            2.0 * (q.y * q.z + q.x * q.w),
            1.0 - 2.0 * (q.x * q.x + q.y * q.y),
        ],
    ]
}

fn rotate_vector(q: UnitQuat, vector: [f64; 3]) -> Result<[f64; 3], ColliderDerivationError> {
    let matrix = rotation_matrix(q);
    Ok([
        checked_dot(matrix[0], vector)?,
        checked_dot(matrix[1], vector)?,
        checked_dot(matrix[2], vector)?,
    ])
}

fn checked_extent(row: [f64; 3], half: [f64; 3]) -> Result<f64, ColliderDerivationError> {
    let mut sum = 0.0_f64;
    for (matrix_element, half_extent) in row.into_iter().zip(half) {
        let absolute = matrix_element.abs();
        if !absolute.is_finite() {
            return Err(ColliderDerivationError::NonFiniteDerivedArithmetic);
        }
        sum = checked_add(sum, absolute * half_extent)?;
    }
    canonicalize_mm(sum).ok_or(ColliderDerivationError::NonFiniteDerivedArithmetic)
}

fn checked_dot(row: [f64; 3], vector: [f64; 3]) -> Result<f64, ColliderDerivationError> {
    let mut sum = 0.0_f64;
    for (matrix_element, component) in row.into_iter().zip(vector) {
        sum = checked_add(sum, matrix_element * component)?;
    }
    canonicalize_mm(sum).ok_or(ColliderDerivationError::NonFiniteDerivedArithmetic)
}

fn checked_add(left: f64, right: f64) -> Result<f64, ColliderDerivationError> {
    let sum = left + right;
    canonicalize_mm(sum).ok_or(ColliderDerivationError::NonFiniteDerivedArithmetic)
}

fn checked_sub(left: f64, right: f64) -> Result<f64, ColliderDerivationError> {
    let difference = left - right;
    canonicalize_mm(difference).ok_or(ColliderDerivationError::NonFiniteDerivedArithmetic)
}

fn i64_to_f64_mm(value: i64) -> Result<f64, ColliderDerivationError> {
    let as_f64 = value as f64;
    // Exact for every legal millimetre integer in the world bound; still reject
    // if casting somehow produced a non-finite value.
    canonicalize_mm(as_f64).ok_or(ColliderDerivationError::NonFiniteDerivedArithmetic)
}

/// Build a world point from already-checked derivation arithmetic.
///
/// Remaps [`WorldPointMm::new`]'s caller-translation error to
/// [`ColliderDerivationError::NonFiniteDerivedArithmetic`] so internal sites
/// do not mislabel derived geometry failures.
fn derived_world_point(x: f64, y: f64, z: f64) -> Result<WorldPointMm, ColliderDerivationError> {
    WorldPointMm::new(x, y, z).map_err(|err| match err {
        ColliderDerivationError::NonFiniteWorldTranslation => {
            ColliderDerivationError::NonFiniteDerivedArithmetic
        }
        other => other,
    })
}

fn canonicalize_mm(value: f64) -> Option<f64> {
    if !value.is_finite() {
        return None;
    }
    Some(if value == 0.0 { 0.0 } else { value })
}

#[cfg(test)]
mod tests {
    use super::{checked_add, ColliderDerivationError};

    #[test]
    fn finite_derived_operands_that_overflow_use_arithmetic_error() {
        assert_eq!(
            checked_add(f64::MAX, f64::MAX),
            Err(ColliderDerivationError::NonFiniteDerivedArithmetic)
        );
    }
}
