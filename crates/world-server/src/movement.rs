//! Continuous swept movement for typed MOVE leases (world/v1 §6, ADR-0002/0003).
//!
//! Runtime contact uses server `f64` slab times. Equal-time ties use the contract
//! entity/terrain key, independent of collection order. Legal face contact at
//! the start of a segment does not block motion away (slab early-outs). Initial
//! positive-volume overlap fails closed.

use crate::collider::{
    derive_collider, Aabb, Collider, ColliderDerivationError, HorizontalFootprint, WorldPointMm,
};
use crate::entity::{EntitySnapshot, Position, ShapeSlot};
use crate::heightfield::{Heightfield, HeightfieldError, TerrainColumn};
use crate::ruleset::RulesetParameters;
use crate::shape::{validate_shape_tree, ShapeClass, WORLD_BOUND_MM};
use crate::tick::TICK_MS;
use aigent_protocol::ShapeTree;
use prost::Message;
use std::cmp::Ordering;
use std::collections::{BTreeMap, BTreeSet};
use std::fmt;

/// Decoded, validated MOVE intent carried across transport → session → world.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct MoveIntent {
    pub target_x_mm: i64,
    pub target_z_mm: i64,
    pub speed_mm_per_s: u32,
}

impl MoveIntent {
    /// Validate wire millimetre target and strictly positive speed.
    pub fn new(
        target_x_mm: i64,
        target_z_mm: i64,
        speed_mm_per_s: u32,
    ) -> Result<Self, MoveDecodeError> {
        if speed_mm_per_s == 0 {
            return Err(MoveDecodeError::NonPositiveSpeed);
        }
        if !(-WORLD_BOUND_MM..=WORLD_BOUND_MM).contains(&target_x_mm)
            || !(-WORLD_BOUND_MM..=WORLD_BOUND_MM).contains(&target_z_mm)
        {
            return Err(MoveDecodeError::TargetOutOfBounds);
        }
        Ok(Self {
            target_x_mm,
            target_z_mm,
            speed_mm_per_s,
        })
    }
}

/// Failures decoding or validating a MOVE payload before world mutation.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum MoveDecodeError {
    EmptyPayload,
    DecodeFailed,
    NonPositiveSpeed,
    TargetOutOfBounds,
}

impl fmt::Display for MoveDecodeError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::EmptyPayload => write!(f, "MOVE payload is empty"),
            Self::DecodeFailed => write!(f, "MOVE payload is not a valid MovePayload"),
            Self::NonPositiveSpeed => write!(f, "MOVE speed_mm_per_s must be positive"),
            Self::TargetOutOfBounds => write!(f, "MOVE target outside world bound"),
        }
    }
}

impl std::error::Error for MoveDecodeError {}

/// Decode MOVE payload bytes. Protobuf field order and unknown fields are
/// intentionally tolerated by the v1 compatibility contract.
pub fn decode_move_payload(bytes: &[u8]) -> Result<MoveIntent, MoveDecodeError> {
    if bytes.is_empty() {
        return Err(MoveDecodeError::EmptyPayload);
    }
    let decoded =
        aigent_protocol::MovePayload::decode(bytes).map_err(|_| MoveDecodeError::DecodeFailed)?;
    MoveIntent::new(
        decoded.target_x_mm,
        decoded.target_z_mm,
        decoded.speed_mm_per_s,
    )
}

/// Encode a validated intent to canonical protobuf bytes.
#[must_use]
pub fn encode_move_payload(intent: MoveIntent) -> Vec<u8> {
    aigent_protocol::MovePayload {
        target_x_mm: intent.target_x_mm,
        target_z_mm: intent.target_z_mm,
        speed_mm_per_s: intent.speed_mm_per_s,
    }
    .encode_to_vec()
}

/// Typed blocker identity for equal-time tie resolution.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum BlockerKey {
    Entity { entity_id: u64 },
    Terrain { cell_x: i64, cell_z: i64 },
}

impl BlockerKey {
    fn tie_tuple(self) -> (i128, i128, u8) {
        // Entity sorts before terrain only when both numeric key components are
        // equal (world/v1 §6).
        match self {
            Self::Entity { entity_id } => (entity_id as i128, 0, 0),
            Self::Terrain { cell_x, cell_z } => (cell_x as i128, cell_z as i128, 1),
        }
    }
}

impl PartialOrd for BlockerKey {
    fn partial_cmp(&self, other: &Self) -> Option<Ordering> {
        Some(self.cmp(other))
    }
}

impl Ord for BlockerKey {
    fn cmp(&self, other: &Self) -> Ordering {
        self.tie_tuple().cmp(&other.tie_tuple())
    }
}

/// Outcome of one continuous sweep attempt.
#[derive(Debug, Clone, PartialEq)]
pub enum SweepOutcome {
    /// Segment clear; body may occupy `end`.
    Clear,
    /// Earliest legal contact along the segment at fraction `t` in (0, 1].
    Contact {
        t: f64,
        position: Position,
        blocker: BlockerKey,
    },
    /// Starting pose has positive-volume overlap (illegal).
    IllegalInitialOverlap { blocker: BlockerKey },
}

/// Failures while preparing or executing a move step.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum MovementError {
    MissingEntity { entity_id: u64 },
    MissingShape { entity_id: u64 },
    ShapeDecode { entity_id: u64 },
    ShapeValidation { entity_id: u64 },
    Collider(ColliderDerivationError),
    Heightfield(HeightfieldError),
    OutOfWorldBounds,
}

impl fmt::Display for MovementError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::MissingEntity { entity_id } => write!(f, "missing entity {entity_id}"),
            Self::MissingShape { entity_id } => write!(f, "entity {entity_id} has no shape"),
            Self::ShapeDecode { entity_id } => write!(f, "entity {entity_id} shape decode failed"),
            Self::ShapeValidation { entity_id } => {
                write!(f, "entity {entity_id} shape validation failed")
            }
            Self::Collider(error) => write!(f, "collider derivation: {error:?}"),
            Self::Heightfield(error) => write!(f, "heightfield: {error}"),
            Self::OutOfWorldBounds => write!(f, "motion leaves world bound"),
        }
    }
}

impl std::error::Error for MovementError {}

impl From<ColliderDerivationError> for MovementError {
    fn from(value: ColliderDerivationError) -> Self {
        Self::Collider(value)
    }
}

impl From<HeightfieldError> for MovementError {
    fn from(value: HeightfieldError) -> Self {
        Self::Heightfield(value)
    }
}

/// Per-tick move result used by lease execution.
#[derive(Debug, Clone, PartialEq)]
pub enum MoveStepResult {
    /// Target already occupied; no mutation.
    ZeroLengthNoOp,
    /// Visible position change (revision must increment once).
    Moved {
        position: Position,
        reached_target: bool,
        blocked_contact: Option<BlockerKey>,
    },
    /// Contact produced no progress from the start pose.
    NoProgress { blocker: BlockerKey },
    /// Illegal starting overlap.
    IllegalOverlap { blocker: BlockerKey },
}

/// Millimetres of travel allowed this tick from frozen ruleset + requested speed.
pub fn tick_travel_mm(requested_speed_mm_per_s: u32, parameters: &RulesetParameters) -> f64 {
    let max_speed = parameters.max_speed_mm_per_s();
    let sweep_max = parameters.sweep_max_mm();
    let speed = requested_speed_mm_per_s.min(max_speed);
    let from_speed = f64::from(speed) * f64::from(TICK_MS) / 1_000.0;
    from_speed.min(f64::from(sweep_max))
}

/// Decode, validate as a body, and derive a collider at a metre position.
pub fn collider_at(
    entity: &EntitySnapshot,
    parameters: &RulesetParameters,
) -> Result<(ShapeTree, Collider), MovementError> {
    let shape_slot = entity.shape.as_ref().ok_or(MovementError::MissingShape {
        entity_id: entity.entity_id,
    })?;
    let shape = decode_shape(entity.entity_id, shape_slot)?;
    validate_shape_tree(&shape, ShapeClass::Body, parameters).map_err(|_| {
        MovementError::ShapeValidation {
            entity_id: entity.entity_id,
        }
    })?;
    // This helper is used for moving bodies and therefore enforces Body
    // budgets. DraftCollisionView::rebuild separately validates obstacles as
    // Object geometry.
    let translation = metres_to_world_mm(entity.position)?;
    let collider = derive_collider(&shape, translation)?;
    Ok((shape, collider))
}

fn decode_shape(entity_id: u64, shape_slot: &ShapeSlot) -> Result<ShapeTree, MovementError> {
    ShapeTree::decode(shape_slot.as_bytes()).map_err(|_| MovementError::ShapeDecode { entity_id })
}

fn metres_to_world_mm(position: Position) -> Result<WorldPointMm, MovementError> {
    let x = metres_to_mm(position.x()).ok_or(MovementError::OutOfWorldBounds)?;
    let y = metres_to_mm(position.y()).ok_or(MovementError::OutOfWorldBounds)?;
    let z = metres_to_mm(position.z()).ok_or(MovementError::OutOfWorldBounds)?;
    WorldPointMm::new(x, y, z).map_err(|_| MovementError::OutOfWorldBounds)
}

fn metres_to_mm(metres: f64) -> Option<f64> {
    let mm = metres * 1000.0;
    if !mm.is_finite() {
        return None;
    }
    Some(if mm == 0.0 { 0.0 } else { mm })
}

fn mm_to_metres(mm: f64) -> Result<f64, MovementError> {
    let metres = mm / 1000.0;
    if !metres.is_finite() {
        return Err(MovementError::OutOfWorldBounds);
    }
    Ok(if metres == 0.0 { 0.0 } else { metres })
}

/// Ground horizontal millimetre coordinates onto the heightfield for `shape`.
pub fn ground_horizontal(
    heightfield: &Heightfield,
    shape: &ShapeTree,
    x_mm: f64,
    z_mm: f64,
    y_hint_mm: f64,
) -> Result<Position, MovementError> {
    let translation = WorldPointMm::new(x_mm, y_hint_mm, z_mm)?;
    let grounded = heightfield.ground(shape, translation)?;
    let pose = grounded.translation();
    Position::new(
        mm_to_metres(pose.x())?,
        mm_to_metres(pose.y())?,
        mm_to_metres(pose.z())?,
    )
    .map_err(|_| MovementError::OutOfWorldBounds)
}

/// Draft collision projection rebuilt from current tentative entity geometry.
#[derive(Debug, Clone)]
pub struct DraftCollisionView {
    /// Shaped colliders keyed by ascending entity ID.
    colliders: BTreeMap<u64, Collider>,
}

impl DraftCollisionView {
    /// Build from active bodies and admitted object candidates. Bound but
    /// unleased bodies are sleeping and therefore absent.
    pub fn rebuild(
        entities: &BTreeMap<u64, EntitySnapshot>,
        parameters: &RulesetParameters,
        active_body_ids: &BTreeSet<u64>,
        bound_body_ids: &BTreeSet<u64>,
    ) -> Result<Self, MovementError> {
        let mut view = Self {
            colliders: BTreeMap::new(),
        };
        for (entity_id, entity) in entities {
            let active_body = active_body_ids.contains(entity_id);
            view.sync_entity(
                entity,
                parameters,
                active_body,
                bound_body_ids.contains(entity_id),
            )?;
        }
        Ok(view)
    }

    /// Incrementally synchronize one entity's collision participation.
    pub fn sync_entity(
        &mut self,
        entity: &EntitySnapshot,
        parameters: &RulesetParameters,
        active_body: bool,
        bound_body: bool,
    ) -> Result<(), MovementError> {
        if bound_body && !active_body {
            self.remove(entity.entity_id);
            return Ok(());
        }
        let Some(shape_slot) = entity.shape.as_ref() else {
            self.remove(entity.entity_id);
            return Ok(());
        };
        let Ok(shape) = ShapeTree::decode(shape_slot.as_bytes()) else {
            self.remove(entity.entity_id);
            return if active_body {
                Err(MovementError::ShapeDecode {
                    entity_id: entity.entity_id,
                })
            } else {
                Ok(())
            };
        };
        let class = if active_body {
            ShapeClass::Body
        } else {
            ShapeClass::Object
        };
        if validate_shape_tree(&shape, class, parameters).is_err() {
            self.remove(entity.entity_id);
            return if active_body {
                Err(MovementError::ShapeValidation {
                    entity_id: entity.entity_id,
                })
            } else {
                Ok(())
            };
        }
        let translation = metres_to_world_mm(entity.position)?;
        self.insert(entity.entity_id, derive_collider(&shape, translation)?);
        Ok(())
    }

    #[must_use]
    pub fn collider(&self, entity_id: u64) -> Option<&Collider> {
        self.colliders.get(&entity_id)
    }

    pub fn insert(&mut self, entity_id: u64, collider: Collider) {
        self.colliders.insert(entity_id, collider);
    }

    pub fn remove(&mut self, entity_id: u64) {
        self.colliders.remove(&entity_id);
    }

    #[must_use]
    pub fn overlaps(&self, candidate: &Collider) -> bool {
        self.colliders.values().any(|occupied| {
            candidate.parts().iter().any(|part| {
                occupied
                    .parts()
                    .iter()
                    .any(|other| part.bounds().overlaps_positive_volume(other.bounds()))
            })
        })
    }
}

/// Sweep every moving-part AABB from `start` toward grounded `end` against
/// terrain columns under the swept aggregate footprint and every other collider.
pub fn sweep_segment(
    heightfield: &Heightfield,
    moving: &Collider,
    start: Position,
    end: Position,
    obstacles: &DraftCollisionView,
    self_id: u64,
) -> Result<SweepOutcome, MovementError> {
    let start_mm = metres_to_world_mm(start)?;
    let end_mm = metres_to_world_mm(end)?;
    let delta = [
        end_mm.x() - start_mm.x(),
        end_mm.y() - start_mm.y(),
        end_mm.z() - start_mm.z(),
    ];
    if delta.iter().all(|v| *v == 0.0) {
        return Ok(SweepOutcome::Clear);
    }

    // Illegal initial overlap against entities or terrain.
    if let Some(blocker) = first_positive_overlap(heightfield, moving, obstacles, self_id)? {
        return Ok(SweepOutcome::IllegalInitialOverlap { blocker });
    }

    let mut best: Option<(f64, BlockerKey)> = None;
    for (obstacle_id, obstacle) in &obstacles.colliders {
        if *obstacle_id == self_id {
            continue;
        }
        for part in moving.parts() {
            for other in obstacle.parts() {
                if let Some(t) = sweep_pair(part.bounds(), delta, other.bounds()) {
                    consider(
                        &mut best,
                        t,
                        BlockerKey::Entity {
                            entity_id: *obstacle_id,
                        },
                    );
                }
            }
        }
    }

    let swept_footprint = swept_horizontal_footprint(moving.aggregate(), delta)?;
    for cell in heightfield.select_cells(swept_footprint)? {
        let column = heightfield.terrain_column(cell.x, cell.z)?;
        let obstacle = terrain_column_aabb(column)?;
        for part in moving.parts() {
            if let Some(t) = sweep_pair(part.bounds(), delta, obstacle) {
                consider(
                    &mut best,
                    t,
                    BlockerKey::Terrain {
                        cell_x: cell.x,
                        cell_z: cell.z,
                    },
                );
            }
        }
    }

    match best {
        None => Ok(SweepOutcome::Clear),
        Some((0.0, blocker)) => {
            // Face contact at t=0 while not overlapping: motion away already
            // early-outed in sweep_pair. Remaining t=0 means no progress into
            // the contact plane.
            Ok(SweepOutcome::Contact {
                t: 0.0,
                position: start,
                blocker,
            })
        }
        Some((t, blocker)) => {
            let x = start_mm.x() + delta[0] * t;
            let y = start_mm.y() + delta[1] * t;
            let z = start_mm.z() + delta[2] * t;
            let position = Position::new(mm_to_metres(x)?, mm_to_metres(y)?, mm_to_metres(z)?)
                .map_err(|_| MovementError::OutOfWorldBounds)?;
            Ok(SweepOutcome::Contact {
                t,
                position,
                blocker,
            })
        }
    }
}

fn consider(best: &mut Option<(f64, BlockerKey)>, t: f64, blocker: BlockerKey) {
    if !(0.0..=1.0).contains(&t) || !t.is_finite() {
        return;
    }
    match best {
        None => *best = Some((t, blocker)),
        Some((best_t, best_blocker)) => {
            if t < *best_t || (t == *best_t && blocker < *best_blocker) {
                *best = Some((t, blocker));
            }
        }
    }
}

fn first_positive_overlap(
    heightfield: &Heightfield,
    moving: &Collider,
    obstacles: &DraftCollisionView,
    self_id: u64,
) -> Result<Option<BlockerKey>, MovementError> {
    for (obstacle_id, obstacle) in &obstacles.colliders {
        if *obstacle_id == self_id {
            continue;
        }
        for part in moving.parts() {
            for other in obstacle.parts() {
                if part.bounds().overlaps_positive_volume(other.bounds()) {
                    return Ok(Some(BlockerKey::Entity {
                        entity_id: *obstacle_id,
                    }));
                }
            }
        }
    }
    for cell in heightfield.select_cells_for_collider(moving)? {
        let column = heightfield.terrain_column(cell.x, cell.z)?;
        let obstacle = terrain_column_aabb(column)?;
        for part in moving.parts() {
            if part.bounds().overlaps_positive_volume(obstacle) {
                return Ok(Some(BlockerKey::Terrain {
                    cell_x: cell.x,
                    cell_z: cell.z,
                }));
            }
        }
    }
    Ok(None)
}

fn terrain_column_aabb(column: TerrainColumn) -> Result<Aabb, MovementError> {
    let min = WorldPointMm::new(
        column.min_x_mm() as f64,
        column.lower_y_mm() as f64,
        column.min_z_mm() as f64,
    )?;
    let max = WorldPointMm::new(
        column.max_x_mm() as f64,
        column.top_y_mm() as f64,
        column.max_z_mm() as f64,
    )?;
    Ok(Aabb::try_from_min_max(min, max)?)
}

fn swept_horizontal_footprint(
    aggregate: Aabb,
    delta: [f64; 3],
) -> Result<HorizontalFootprint, MovementError> {
    let end_min_x = aggregate.min().x() + delta[0];
    let end_max_x = aggregate.max().x() + delta[0];
    let end_min_z = aggregate.min().z() + delta[2];
    let end_max_z = aggregate.max().z() + delta[2];
    let min = WorldPointMm::new(
        aggregate.min().x().min(end_min_x),
        aggregate.min().y(),
        aggregate.min().z().min(end_min_z),
    )?;
    let max = WorldPointMm::new(
        aggregate.max().x().max(end_max_x),
        aggregate.max().y(),
        aggregate.max().z().max(end_max_z),
    )?;
    Ok(Aabb::try_from_min_max(min, max)?.horizontal_footprint())
}

/// Continuous AABB slab sweep on one axis-aligned pair over `delta`.
///
/// Returns the entry time in `[0, 1]` when the intervals collide during the
/// segment, or `None` when they miss or only separate from legal contact.
fn sweep_pair(moving: Aabb, delta: [f64; 3], obstacle: Aabb) -> Option<f64> {
    let mut entry = f64::NEG_INFINITY;
    let mut exit = f64::INFINITY;
    let axes = [
        (
            delta[0],
            moving.min().x(),
            moving.max().x(),
            obstacle.min().x(),
            obstacle.max().x(),
        ),
        (
            delta[1],
            moving.min().y(),
            moving.max().y(),
            obstacle.min().y(),
            obstacle.max().y(),
        ),
        (
            delta[2],
            moving.min().z(),
            moving.max().z(),
            obstacle.min().z(),
            obstacle.max().z(),
        ),
    ];
    for (velocity, moving_min, moving_max, obstacle_min, obstacle_max) in axes {
        if velocity == 0.0 {
            if moving_max <= obstacle_min || moving_min >= obstacle_max {
                return None;
            }
            continue;
        }
        // Already separated and moving further away: no hit.
        if moving_max <= obstacle_min && velocity < 0.0 {
            return None;
        }
        if moving_min >= obstacle_max && velocity > 0.0 {
            return None;
        }
        let (first, last) = if velocity > 0.0 {
            (
                (obstacle_min - moving_max) / velocity,
                (obstacle_max - moving_min) / velocity,
            )
        } else {
            (
                (obstacle_max - moving_min) / velocity,
                (obstacle_min - moving_max) / velocity,
            )
        };
        entry = entry.max(first);
        exit = exit.min(last);
    }
    if !entry.is_finite() || !exit.is_finite() {
        return None;
    }
    if entry > exit || exit < 0.0 || entry > 1.0 {
        return None;
    }
    Some(entry.max(0.0))
}

/// Execute one tick of a move-toward lease for `entity_id`.
pub fn step_move_toward(
    heightfield: &Heightfield,
    entities: &BTreeMap<u64, EntitySnapshot>,
    draft: &DraftCollisionView,
    parameters: &RulesetParameters,
    entity_id: u64,
    intent: MoveIntent,
) -> Result<MoveStepResult, MovementError> {
    let entity = entities
        .get(&entity_id)
        .ok_or(MovementError::MissingEntity { entity_id })?;
    let (shape, moving) = match draft.collider(entity_id) {
        Some(collider) => {
            let shape_slot = entity
                .shape
                .as_ref()
                .ok_or(MovementError::MissingShape { entity_id })?;
            let shape = decode_shape(entity_id, shape_slot)?;
            (shape, collider.clone())
        }
        None => {
            let (shape, collider) = collider_at(entity, parameters)?;
            (shape, collider)
        }
    };

    let travel_mm = tick_travel_mm(intent.speed_mm_per_s, parameters);
    let start = entity.position;
    if !collider_within_world(&moving) {
        return Err(MovementError::OutOfWorldBounds);
    }
    if let Some(blocker) = first_positive_overlap(heightfield, &moving, draft, entity_id)? {
        return Ok(MoveStepResult::IllegalOverlap { blocker });
    }
    let start_mm = metres_to_world_mm(start)?;
    let target_x = intent.target_x_mm as f64;
    let target_z = intent.target_z_mm as f64;
    let dx = target_x - start_mm.x();
    let dz = target_z - start_mm.z();
    let remaining = (dx * dx + dz * dz).sqrt();
    if remaining == 0.0 || travel_mm == 0.0 {
        // Exact horizontal target already occupied (after prior grounding).
        let grounded = ground_horizontal(
            heightfield,
            &shape,
            start_mm.x(),
            start_mm.z(),
            start_mm.y(),
        )?;
        let grounded_collider = derive_collider(&shape, metres_to_world_mm(grounded)?)?;
        if !collider_within_world(&grounded_collider) {
            return Err(MovementError::OutOfWorldBounds);
        }
        if grounded == start {
            return Ok(MoveStepResult::ZeroLengthNoOp);
        }
        // Re-grounding without horizontal travel is still continuous motion;
        // it cannot tunnel vertically through an entity or terrain surface.
        return match sweep_segment(heightfield, &moving, start, grounded, draft, entity_id)? {
            SweepOutcome::Clear => Ok(MoveStepResult::Moved {
                position: grounded,
                reached_target: true,
                blocked_contact: None,
            }),
            SweepOutcome::IllegalInitialOverlap { blocker } => {
                Ok(MoveStepResult::IllegalOverlap { blocker })
            }
            SweepOutcome::Contact {
                t,
                position,
                blocker,
            } if t == 0.0 || same_public_position(start, position) => {
                Ok(MoveStepResult::NoProgress { blocker })
            }
            SweepOutcome::Contact {
                position, blocker, ..
            } => Ok(MoveStepResult::Moved {
                position,
                reached_target: true,
                blocked_contact: Some(blocker),
            }),
        };
    }

    let step = travel_mm.min(remaining);
    let scale = step / remaining;
    let step_x = start_mm.x() + dx * scale;
    let step_z = start_mm.z() + dz * scale;
    let end = ground_horizontal(heightfield, &shape, step_x, step_z, start_mm.y())?;

    // Ensure the grounded end collider stays inside the world bound.
    let end_collider = {
        let translation = metres_to_world_mm(end)?;
        derive_collider(&shape, translation)?
    };
    if !collider_within_world(&end_collider) {
        return Err(MovementError::OutOfWorldBounds);
    }

    match sweep_segment(heightfield, &moving, start, end, draft, entity_id)? {
        SweepOutcome::Clear => {
            let reached = step >= remaining;
            Ok(MoveStepResult::Moved {
                position: end,
                reached_target: reached,
                blocked_contact: None,
            })
        }
        SweepOutcome::IllegalInitialOverlap { blocker } => {
            Ok(MoveStepResult::IllegalOverlap { blocker })
        }
        SweepOutcome::Contact {
            t,
            position,
            blocker,
        } => {
            if t == 0.0 || same_public_position(start, position) {
                Ok(MoveStepResult::NoProgress { blocker })
            } else {
                Ok(MoveStepResult::Moved {
                    position,
                    reached_target: false,
                    blocked_contact: Some(blocker),
                })
            }
        }
    }
}

fn same_public_position(a: Position, b: Position) -> bool {
    // Public world coordinates are integer millimetres. A repeated contact can
    // differ by a sub-millimetre f64 round trip while remaining the same
    // authoritative protocol position; do not reset the blocked counter for it.
    (a.x() * 1_000.0).round() == (b.x() * 1_000.0).round()
        && (a.y() * 1_000.0).round() == (b.y() * 1_000.0).round()
        && (a.z() * 1_000.0).round() == (b.z() * 1_000.0).round()
}

fn collider_within_world(collider: &Collider) -> bool {
    let agg = collider.aggregate();
    let bound = WORLD_BOUND_MM as f64;
    agg.min().x() >= -bound
        && agg.max().x() <= bound
        && agg.min().y() >= -bound
        && agg.max().y() <= bound
        && agg.min().z() >= -bound
        && agg.max().z() <= bound
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::collider::WorldPointMm;
    use aigent_protocol::{
        shape_node::Primitive, BoxPrimitive, LocalTransform, Quaternion, ShapeNode,
        Vector3Millimeters,
    };

    fn box_aabb(min: [f64; 3], max: [f64; 3]) -> Aabb {
        Aabb::try_from_min_max(
            WorldPointMm::new(min[0], min[1], min[2]).unwrap(),
            WorldPointMm::new(max[0], max[1], max[2]).unwrap(),
        )
        .unwrap()
    }

    fn box_collider(center: [f64; 3], size: [i64; 3]) -> Collider {
        let shape = ShapeTree {
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
                color: None,
                material_tags: Vec::new(),
                primitive: Some(Primitive::Box(BoxPrimitive {
                    size_x_mm: size[0],
                    size_y_mm: size[1],
                    size_z_mm: size[2],
                })),
            }],
        };
        derive_collider(
            &shape,
            WorldPointMm::new(center[0], center[1], center[2]).unwrap(),
        )
        .unwrap()
    }

    #[test]
    fn thin_obstacle_is_not_tunnelled() {
        let moving = box_aabb([-100.0, 0.0, -100.0], [100.0, 200.0, 100.0]);
        let wall = box_aabb([210.0, 0.0, -500.0], [220.0, 200.0, 500.0]);
        let delta = [2_000.0, 0.0, 0.0];
        let t = sweep_pair(moving, delta, wall).expect("contact");
        // Right face at 100 meets wall left at -10 → travel 110 over 1000.
        assert!((t - 0.055).abs() < 1e-9, "t={t}");
    }

    #[test]
    fn motion_away_from_face_contact_is_clear() {
        let moving = box_aabb([-100.0, 0.0, -100.0], [100.0, 200.0, 100.0]);
        // Wall touching the left face.
        let wall = box_aabb([-200.0, 0.0, -100.0], [-100.0, 200.0, 100.0]);
        let delta = [500.0, 0.0, 0.0];
        assert!(sweep_pair(moving, delta, wall).is_none());
    }

    #[test]
    fn equal_time_prefers_lower_entity_key() {
        let left = BlockerKey::Entity { entity_id: 2 };
        let right = BlockerKey::Entity { entity_id: 5 };
        assert!(left < right);
        let terrain = BlockerKey::Terrain {
            cell_x: 2,
            cell_z: 0,
        };
        // Same numeric first components: entity sorts before terrain.
        assert!(BlockerKey::Entity { entity_id: 2 } < terrain);
    }

    #[test]
    fn equal_time_sweep_prefers_lower_entity_under_reversed_insertion() {
        let heightfield = Heightfield::new([7; 32], 1_000).unwrap();
        let moving = box_collider([0.0, 20_000.0, 0.0], [100, 100, 100]);
        let obstacle = box_collider([750.0, 20_000.0, 0.0], [100, 100, 100]);
        let start = Position::new(0.0, 20.0, 0.0).unwrap();
        let end = Position::new(1.0, 20.0, 0.0).unwrap();

        for ids in [[9, 2], [2, 9]] {
            let mut draft = DraftCollisionView {
                colliders: BTreeMap::new(),
            };
            for id in ids {
                draft.insert(id, obstacle.clone());
            }
            let outcome = sweep_segment(&heightfield, &moving, start, end, &draft, 1).unwrap();
            assert!(matches!(
                outcome,
                SweepOutcome::Contact {
                    blocker: BlockerKey::Entity { entity_id: 2 },
                    ..
                }
            ));
        }
    }

    #[test]
    fn decode_rejects_empty_and_zero_speed() {
        assert_eq!(
            decode_move_payload(&[]).unwrap_err(),
            MoveDecodeError::EmptyPayload
        );
        let bad = aigent_protocol::MovePayload {
            target_x_mm: 1,
            target_z_mm: 0,
            speed_mm_per_s: 0,
        }
        .encode_to_vec();
        assert_eq!(
            decode_move_payload(&bad).unwrap_err(),
            MoveDecodeError::NonPositiveSpeed
        );
    }
}
