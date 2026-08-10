//! Uniform spatial-hash collision broadphase (ARCHITECTURE §5 / task-050).
//!
//! The index is rebuilt from one published [`ImmutableGeneration`] plus the
//! matching live [`RulesetGeneration`]. It is never mutated mid-tick: there is
//! no public insert/remove/update path.
//!
//! # Active-set bridge until task-052
//!
//! Sleep/wake lifecycle state is not yet stored on entities. Until task-052
//! implements explicit sleep, an entity is treated as **active** for this
//! broadphase only when its ID appears in [`ImmutableGeneration::active_leases`].
//! Absence from that map means sleeping/unleased and excludes the entity from
//! both overlap and enclosure candidate sets. This module does not implement
//! wake or displacement.
//!
//! Cell edge equals the validated ruleset `shape.max_extent_mm` (millimetres).
//! Candidate results are always returned in ascending unsigned entity ID;
//! bucket hash/insertion order cannot affect them.

use crate::collider::{derive_collider, Aabb, ColliderDerivationError, WorldPointMm};
use crate::entity::{EntitySnapshot, Position, ShapeSlot};
use crate::generation::ImmutableGeneration;
use crate::ruleset::RulesetGeneration;
use crate::shape::{validate_shape_tree, ShapeBudgets, ShapeClass, ShapeRejection};
use aigent_protocol::ShapeTree;
use prost::Message;
use std::collections::{BTreeMap, BTreeSet, HashMap};
use std::fmt;

/// Maximum cells a single query may enumerate before falling back to a full
/// deterministic scan of indexed aggregates. Caps attacker-controlled ranges
/// without changing exact overlap/enclosure results.
const MAX_ENUMERATED_QUERY_CELLS: u64 = 4_096;

/// One completed immutable collision broadphase for a published generation.
#[derive(Debug, Clone)]
pub struct CollisionBroadphase {
    world_generation: u64,
    ruleset_generation_id: u64,
    cell_edge_mm: f64,
    /// Active shaped aggregates keyed by ascending entity ID.
    aggregates: BTreeMap<u64, Aabb>,
    cells: HashMap<(i64, i64, i64), Vec<u64>>,
}

impl CollisionBroadphase {
    /// World generation ID this index was rebuilt from.
    #[must_use]
    pub const fn world_generation(&self) -> u64 {
        self.world_generation
    }

    /// Ruleset generation ID whose `shape.max_extent_mm` sized the cells.
    #[must_use]
    pub const fn ruleset_generation_id(&self) -> u64 {
        self.ruleset_generation_id
    }

    /// Uniform cell edge in millimetres (`shape.max_extent_mm`).
    #[must_use]
    pub const fn cell_edge_mm(&self) -> f64 {
        self.cell_edge_mm
    }

    /// Number of active shaped entities indexed.
    #[must_use]
    pub fn len(&self) -> usize {
        self.aggregates.len()
    }

    /// True when no active shaped entity was indexed.
    #[must_use]
    pub fn is_empty(&self) -> bool {
        self.aggregates.is_empty()
    }

    /// Look up a stored aggregate AABB by entity ID.
    #[must_use]
    pub fn aggregate(&self, entity_id: u64) -> Option<Aabb> {
        self.aggregates.get(&entity_id).copied()
    }

    /// Rebuild from one published immutable generation and its matching ruleset.
    ///
    /// Verifies `generation.ruleset_generation_id == ruleset.generation_id`,
    /// resolves `shape.max_extent_mm` from the ruleset (no silent default), and
    /// indexes only leased entities that carry a decodable, budget-valid shape.
    ///
    /// # Errors
    ///
    /// Returns a typed [`BroadphaseRebuildError`] on provenance mismatch,
    /// missing/invalid extent budget, missing leased entity rows, or frozen
    /// geometry that fails decode/validation/derivation. Shapeless leased
    /// entities are omitted, not errors.
    pub fn rebuild(
        generation: &ImmutableGeneration,
        ruleset: &RulesetGeneration,
    ) -> Result<Self, BroadphaseRebuildError> {
        if generation.ruleset_generation_id != ruleset.generation_id {
            return Err(BroadphaseRebuildError::RulesetGenerationMismatch {
                world_ruleset_generation_id: generation.ruleset_generation_id,
                provided_ruleset_generation_id: ruleset.generation_id,
            });
        }

        let budgets = ShapeBudgets::from_ruleset(&ruleset.parameters, ShapeClass::Body)
            .map_err(BroadphaseRebuildError::ShapeBudget)?;
        let cell_edge_mm = i64_extent_to_f64(budgets.max_extent_mm())?;
        if cell_edge_mm <= 0.0 {
            return Err(BroadphaseRebuildError::InvalidCellEdge {
                max_extent_mm: budgets.max_extent_mm(),
            });
        }

        let mut aggregates = BTreeMap::new();
        let mut cells: HashMap<(i64, i64, i64), Vec<u64>> = HashMap::new();

        // Lease map iteration is ascending body ID; results never depend on
        // hash order of the cell map built below.
        for &entity_id in generation.active_leases.keys() {
            let lease = &generation.active_leases[&entity_id];
            if lease.body_id != entity_id {
                return Err(BroadphaseRebuildError::FrozenIdentityMismatch {
                    map_key: entity_id,
                    embedded_id: lease.body_id,
                    record: "lease",
                });
            }
            let entity = generation
                .entities
                .get(&entity_id)
                .ok_or(BroadphaseRebuildError::MissingLeasedEntity { entity_id })?;
            if entity.entity_id != entity_id {
                return Err(BroadphaseRebuildError::FrozenIdentityMismatch {
                    map_key: entity_id,
                    embedded_id: entity.entity_id,
                    record: "entity",
                });
            }
            let Some(aggregate) = derive_active_aggregate(entity, &ruleset.parameters)? else {
                continue;
            };
            insert_entity(&mut cells, entity_id, aggregate, cell_edge_mm)?;
            aggregates.insert(entity_id, aggregate);
        }

        Ok(Self {
            world_generation: generation.generation,
            ruleset_generation_id: ruleset.generation_id,
            cell_edge_mm,
            aggregates,
            cells,
        })
    }

    /// Conservative bucket candidates for every cell the query AABB intersects.
    ///
    /// Exact AABB predicates are not applied. Results are unique and sorted by
    /// ascending unsigned entity ID.
    pub fn query_bucket_candidates(&self, query: Aabb) -> Result<Vec<u64>, BroadphaseQueryError> {
        self.gather_candidates(query, CandidateFilter::Bucket)
    }

    /// Candidates whose stored aggregate has positive-volume overlap with `query`.
    pub fn query_overlap_candidates(&self, query: Aabb) -> Result<Vec<u64>, BroadphaseQueryError> {
        self.gather_candidates(query, CandidateFilter::Overlap)
    }

    /// Candidates whose stored aggregate is enclosed by `query` under the
    /// section 7.1 aigent-enclosure rule (useful for placement).
    pub fn query_enclosure_candidates(
        &self,
        query: Aabb,
    ) -> Result<Vec<u64>, BroadphaseQueryError> {
        self.gather_candidates(query, CandidateFilter::Enclosure)
    }

    fn gather_candidates(
        &self,
        query: Aabb,
        filter: CandidateFilter,
    ) -> Result<Vec<u64>, BroadphaseQueryError> {
        let mut ids = BTreeSet::new();
        match self.intersected_cell_range(query)? {
            CellVisitPlan::Enumerate(range) => {
                for cell in range {
                    if let Some(bucket) = self.cells.get(&cell) {
                        for &entity_id in bucket {
                            if self.passes_filter(entity_id, query, filter) {
                                ids.insert(entity_id);
                            }
                        }
                    }
                }
            }
            CellVisitPlan::ScanAll => {
                // Deterministic full scan when the query cell volume would be
                // attacker-large. Bucket mode stays conservative via cell-range
                // overlap; exact modes apply the public AABB predicates.
                for (&entity_id, &aggregate) in &self.aggregates {
                    let include = match filter {
                        CandidateFilter::Bucket => {
                            cell_ranges_overlap(aggregate, query, self.cell_edge_mm)?
                        }
                        CandidateFilter::Overlap => aggregate.overlaps_positive_volume(query),
                        CandidateFilter::Enclosure => query.encloses_aigent_aggregate(aggregate),
                    };
                    if include {
                        ids.insert(entity_id);
                    }
                }
            }
        }
        Ok(ids.into_iter().collect())
    }

    fn passes_filter(&self, entity_id: u64, query: Aabb, filter: CandidateFilter) -> bool {
        let Some(&aggregate) = self.aggregates.get(&entity_id) else {
            return false;
        };
        match filter {
            CandidateFilter::Bucket => true,
            CandidateFilter::Overlap => aggregate.overlaps_positive_volume(query),
            CandidateFilter::Enclosure => query.encloses_aigent_aggregate(aggregate),
        }
    }

    fn intersected_cell_range(&self, query: Aabb) -> Result<CellVisitPlan, BroadphaseQueryError> {
        let (x0, x1) = axis_cell_span(query.min().x(), query.max().x(), self.cell_edge_mm)?;
        let (y0, y1) = axis_cell_span(query.min().y(), query.max().y(), self.cell_edge_mm)?;
        let (z0, z1) = axis_cell_span(query.min().z(), query.max().z(), self.cell_edge_mm)?;
        let count = checked_cell_count(x0, x1, y0, y1, z0, z1)?;
        if count > MAX_ENUMERATED_QUERY_CELLS {
            return Ok(CellVisitPlan::ScanAll);
        }
        Ok(CellVisitPlan::Enumerate(CellRangeIter {
            x1,
            y0,
            y1,
            z0,
            z1,
            x: x0,
            y: y0,
            z: z0,
            done: count == 0,
        }))
    }
}

#[derive(Clone, Copy)]
enum CandidateFilter {
    Bucket,
    Overlap,
    Enclosure,
}

enum CellVisitPlan {
    Enumerate(CellRangeIter),
    ScanAll,
}

struct CellRangeIter {
    x1: i64,
    y0: i64,
    y1: i64,
    z0: i64,
    z1: i64,
    x: i64,
    y: i64,
    z: i64,
    done: bool,
}

impl Iterator for CellRangeIter {
    type Item = (i64, i64, i64);

    fn next(&mut self) -> Option<Self::Item> {
        if self.done {
            return None;
        }
        let item = (self.x, self.y, self.z);
        if self.z < self.z1 {
            self.z += 1;
        } else if self.y < self.y1 {
            self.z = self.z0;
            self.y += 1;
        } else if self.x < self.x1 {
            self.z = self.z0;
            self.y = self.y0;
            self.x += 1;
        } else {
            self.done = true;
        }
        Some(item)
    }
}

fn cell_ranges_overlap(
    left: Aabb,
    right: Aabb,
    cell_edge_mm: f64,
) -> Result<bool, BroadphaseQueryError> {
    let (lx0, lx1) = axis_cell_span(left.min().x(), left.max().x(), cell_edge_mm)?;
    let (ly0, ly1) = axis_cell_span(left.min().y(), left.max().y(), cell_edge_mm)?;
    let (lz0, lz1) = axis_cell_span(left.min().z(), left.max().z(), cell_edge_mm)?;
    let (rx0, rx1) = axis_cell_span(right.min().x(), right.max().x(), cell_edge_mm)?;
    let (ry0, ry1) = axis_cell_span(right.min().y(), right.max().y(), cell_edge_mm)?;
    let (rz0, rz1) = axis_cell_span(right.min().z(), right.max().z(), cell_edge_mm)?;
    Ok(lx0 <= rx1 && rx0 <= lx1 && ly0 <= ry1 && ry0 <= ly1 && lz0 <= rz1 && rz0 <= lz1)
}

fn insert_entity(
    cells: &mut HashMap<(i64, i64, i64), Vec<u64>>,
    entity_id: u64,
    aggregate: Aabb,
    cell_edge_mm: f64,
) -> Result<(), BroadphaseRebuildError> {
    let (x0, x1) = axis_cell_span(aggregate.min().x(), aggregate.max().x(), cell_edge_mm)
        .map_err(|_| BroadphaseRebuildError::InvalidAggregate { entity_id })?;
    let (y0, y1) = axis_cell_span(aggregate.min().y(), aggregate.max().y(), cell_edge_mm)
        .map_err(|_| BroadphaseRebuildError::InvalidAggregate { entity_id })?;
    let (z0, z1) = axis_cell_span(aggregate.min().z(), aggregate.max().z(), cell_edge_mm)
        .map_err(|_| BroadphaseRebuildError::InvalidAggregate { entity_id })?;
    let count = checked_cell_count(x0, x1, y0, y1, z0, z1)
        .map_err(|_| BroadphaseRebuildError::InvalidAggregate { entity_id })?;
    // Validated aggregates span at most one cell edge per axis, so they cover
    // at most two cells per axis (eight total) when straddling boundaries.
    if count == 0 || count > 8 {
        return Err(BroadphaseRebuildError::InvalidAggregate { entity_id });
    }
    for x in x0..=x1 {
        for y in y0..=y1 {
            for z in z0..=z1 {
                cells.entry((x, y, z)).or_default().push(entity_id);
            }
        }
    }
    Ok(())
}

fn derive_active_aggregate(
    entity: &EntitySnapshot,
    parameters: &crate::ruleset::RulesetParameters,
) -> Result<Option<Aabb>, BroadphaseRebuildError> {
    let Some(shape_slot) = entity.shape.as_ref() else {
        return Ok(None);
    };
    if shape_slot.is_empty() {
        return Ok(None);
    }
    let shape = decode_shape(entity.entity_id, shape_slot)?;
    validate_shape_tree(&shape, ShapeClass::Body, parameters).map_err(|reason| {
        BroadphaseRebuildError::InvalidFrozenShape {
            entity_id: entity.entity_id,
            reason,
        }
    })?;
    let translation = position_to_world_mm(entity.entity_id, entity.position)?;
    let collider = derive_collider(&shape, translation).map_err(|reason| {
        BroadphaseRebuildError::ColliderDerivation {
            entity_id: entity.entity_id,
            reason,
        }
    })?;
    let aggregate = collider.aggregate();
    if !(aggregate.max().x() > aggregate.min().x()
        && aggregate.max().y() > aggregate.min().y()
        && aggregate.max().z() > aggregate.min().z())
    {
        return Err(BroadphaseRebuildError::InvalidAggregate {
            entity_id: entity.entity_id,
        });
    }
    Ok(Some(aggregate))
}

fn decode_shape(
    entity_id: u64,
    shape_slot: &ShapeSlot,
) -> Result<ShapeTree, BroadphaseRebuildError> {
    ShapeTree::decode(shape_slot.as_bytes())
        .map_err(|_| BroadphaseRebuildError::ShapeDecodeFailed { entity_id })
}

fn position_to_world_mm(
    entity_id: u64,
    position: Position,
) -> Result<WorldPointMm, BroadphaseRebuildError> {
    let x = metres_to_mm(position.x())
        .ok_or(BroadphaseRebuildError::NonFiniteMetresToMm { entity_id })?;
    let y = metres_to_mm(position.y())
        .ok_or(BroadphaseRebuildError::NonFiniteMetresToMm { entity_id })?;
    let z = metres_to_mm(position.z())
        .ok_or(BroadphaseRebuildError::NonFiniteMetresToMm { entity_id })?;
    WorldPointMm::new(x, y, z)
        .map_err(|_| BroadphaseRebuildError::NonFiniteMetresToMm { entity_id })
}

fn metres_to_mm(metres: f64) -> Option<f64> {
    let mm = metres * 1000.0;
    if !mm.is_finite() {
        return None;
    }
    Some(if mm == 0.0 { 0.0 } else { mm })
}

fn i64_extent_to_f64(value: i64) -> Result<f64, BroadphaseRebuildError> {
    let as_f64 = value as f64;
    if !as_f64.is_finite() || as_f64 <= 0.0 {
        return Err(BroadphaseRebuildError::InvalidCellEdge {
            max_extent_mm: value,
        });
    }
    Ok(as_f64)
}

fn axis_cell_span(min: f64, max: f64, edge_mm: f64) -> Result<(i64, i64), BroadphaseQueryError> {
    if !(min.is_finite() && max.is_finite() && edge_mm.is_finite()) || edge_mm <= 0.0 {
        return Err(BroadphaseQueryError::NonFiniteQueryAabb);
    }
    if max < min {
        return Err(BroadphaseQueryError::InvertedQueryAabb);
    }
    // Cell i covers [i*edge, (i+1)*edge). Positive-volume overlap uses the same
    // closed-AABB rule as narrowphase: a face exactly on a boundary does not
    // enter the next cell.
    let start = floor_to_i64(min / edge_mm)?;
    let end = {
        let ceil_i = ceil_to_i64(max / edge_mm)?;
        // When max lies exactly on a boundary, ceil(max/edge) == max/edge and
        // the last overlapped cell is that index minus one.
        ceil_i
            .checked_sub(1)
            .ok_or(BroadphaseQueryError::CellIndexOverflow)?
    };
    if end < start {
        // Zero-thickness query slab: still visit the single cell containing min
        // so conservative bucket queries remain useful for face-aligned sweeps.
        Ok((start, start))
    } else {
        Ok((start, end))
    }
}

fn floor_to_i64(value: f64) -> Result<i64, BroadphaseQueryError> {
    let floored = value.floor();
    if !floored.is_finite() {
        return Err(BroadphaseQueryError::CellIndexOverflow);
    }
    // Exact integers in the world millimetre domain fit i64; reject anything
    // outside the representable range rather than wrapping.
    if floored < (i64::MIN as f64) || floored > (i64::MAX as f64) {
        return Err(BroadphaseQueryError::CellIndexOverflow);
    }
    Ok(floored as i64)
}

fn ceil_to_i64(value: f64) -> Result<i64, BroadphaseQueryError> {
    let ceiled = value.ceil();
    if !ceiled.is_finite() {
        return Err(BroadphaseQueryError::CellIndexOverflow);
    }
    if ceiled < (i64::MIN as f64) || ceiled > (i64::MAX as f64) {
        return Err(BroadphaseQueryError::CellIndexOverflow);
    }
    Ok(ceiled as i64)
}

fn checked_cell_count(
    x0: i64,
    x1: i64,
    y0: i64,
    y1: i64,
    z0: i64,
    z1: i64,
) -> Result<u64, BroadphaseQueryError> {
    let x = checked_span(x0, x1)?;
    let y = checked_span(y0, y1)?;
    let z = checked_span(z0, z1)?;
    x.checked_mul(y)
        .and_then(|v| v.checked_mul(z))
        .ok_or(BroadphaseQueryError::CellIndexOverflow)
}

fn checked_span(lo: i64, hi: i64) -> Result<u64, BroadphaseQueryError> {
    if hi < lo {
        return Ok(0);
    }
    let delta = hi
        .checked_sub(lo)
        .ok_or(BroadphaseQueryError::CellIndexOverflow)?;
    u64::try_from(delta)
        .ok()
        .and_then(|v| v.checked_add(1))
        .ok_or(BroadphaseQueryError::CellIndexOverflow)
}

/// Typed failures while rebuilding the immutable index.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum BroadphaseRebuildError {
    RulesetGenerationMismatch {
        world_ruleset_generation_id: u64,
        provided_ruleset_generation_id: u64,
    },
    ShapeBudget(ShapeRejection),
    InvalidCellEdge {
        max_extent_mm: i64,
    },
    MissingLeasedEntity {
        entity_id: u64,
    },
    FrozenIdentityMismatch {
        map_key: u64,
        embedded_id: u64,
        record: &'static str,
    },
    ShapeDecodeFailed {
        entity_id: u64,
    },
    InvalidFrozenShape {
        entity_id: u64,
        reason: ShapeRejection,
    },
    ColliderDerivation {
        entity_id: u64,
        reason: ColliderDerivationError,
    },
    NonFiniteMetresToMm {
        entity_id: u64,
    },
    InvalidAggregate {
        entity_id: u64,
    },
}

impl fmt::Display for BroadphaseRebuildError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::RulesetGenerationMismatch {
                world_ruleset_generation_id,
                provided_ruleset_generation_id,
            } => write!(
                f,
                "ruleset generation mismatch: world={world_ruleset_generation_id} provided={provided_ruleset_generation_id}"
            ),
            Self::ShapeBudget(reason) => write!(f, "shape budget resolution failed: {reason:?}"),
            Self::InvalidCellEdge { max_extent_mm } => {
                write!(f, "invalid shape.max_extent_mm {max_extent_mm}")
            }
            Self::MissingLeasedEntity { entity_id } => {
                write!(f, "leased entity {entity_id} missing from generation")
            }
            Self::FrozenIdentityMismatch {
                map_key,
                embedded_id,
                record,
            } => write!(
                f,
                "frozen {record} identity mismatch: map key={map_key} embedded={embedded_id}"
            ),
            Self::ShapeDecodeFailed { entity_id } => {
                write!(f, "entity {entity_id} shape bytes failed to decode")
            }
            Self::InvalidFrozenShape { entity_id, reason } => {
                write!(f, "entity {entity_id} frozen shape invalid: {reason:?}")
            }
            Self::ColliderDerivation { entity_id, reason } => {
                write!(f, "entity {entity_id} collider derivation failed: {reason:?}")
            }
            Self::NonFiniteMetresToMm { entity_id } => {
                write!(f, "entity {entity_id} position metres-to-mm was non-finite")
            }
            Self::InvalidAggregate { entity_id } => {
                write!(f, "entity {entity_id} aggregate AABB is invalid for indexing")
            }
        }
    }
}

impl std::error::Error for BroadphaseRebuildError {}

/// Typed failures while querying a completed index.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum BroadphaseQueryError {
    NonFiniteQueryAabb,
    InvertedQueryAabb,
    CellIndexOverflow,
}

impl fmt::Display for BroadphaseQueryError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::NonFiniteQueryAabb => write!(f, "query AABB has non-finite bounds"),
            Self::InvertedQueryAabb => write!(f, "query AABB min exceeds max"),
            Self::CellIndexOverflow => write!(f, "query cell index overflow"),
        }
    }
}

impl std::error::Error for BroadphaseQueryError {}

#[cfg(test)]
mod tests {
    use super::{axis_cell_span, metres_to_mm, CollisionBroadphase};
    use crate::collider::{Aabb, WorldPointMm};
    use std::collections::{BTreeMap, HashMap};

    #[test]
    fn metres_to_mm_rejects_overflow_to_non_finite() {
        assert!(metres_to_mm(f64::MAX).is_none());
        assert_eq!(metres_to_mm(1.5), Some(1500.0));
        assert_eq!(metres_to_mm(-0.0), Some(0.0));
    }

    #[test]
    fn exact_boundary_excludes_next_cell() {
        let (start, end) = axis_cell_span(0.0, 10_000.0, 10_000.0).unwrap();
        assert_eq!((start, end), (0, 0));
        let (start, end) = axis_cell_span(0.0, 10_000.1, 10_000.0).unwrap();
        assert_eq!((start, end), (0, 1));
        let (start, end) = axis_cell_span(-5_000.0, 0.0, 10_000.0).unwrap();
        assert_eq!((start, end), (-1, -1));
    }

    #[test]
    fn query_canonicalizes_reversed_bucket_order_and_duplicate_cells() {
        let aggregate = Aabb::try_from_min_max(
            WorldPointMm::new(0.0, 0.0, 0.0).unwrap(),
            WorldPointMm::new(15_000.0, 1_000.0, 1_000.0).unwrap(),
        )
        .unwrap();
        let mut aggregates = BTreeMap::new();
        for entity_id in [1, 3, 5, 7, 9] {
            aggregates.insert(entity_id, aggregate);
        }
        let mut cells = HashMap::new();
        cells.insert((0, 0, 0), vec![9, 5, 1, 7, 3]);
        cells.insert((1, 0, 0), vec![3, 7, 1, 5, 9]);
        let index = CollisionBroadphase {
            world_generation: 1,
            ruleset_generation_id: 1,
            cell_edge_mm: 10_000.0,
            aggregates,
            cells,
        };

        assert_eq!(
            index.query_bucket_candidates(aggregate).unwrap(),
            vec![1, 3, 5, 7, 9]
        );
    }
}
