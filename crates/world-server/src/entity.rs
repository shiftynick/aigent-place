//! Authoritative entity store: monotonic IDs, revisions, canonical `f64` metre
//! positions, and an opaque shape slot.
//!
//! Identity, revision, and coordinate rules come from ADR-0002 (with terminal
//! revision fixed by ADR-0004) and `world/v1/CONTRACT.md` sections 2 and 3.
//!
//! # Ownership and deliberate non-ownership
//!
//! This module owns identity allocation, revision accounting, and canonical
//! position validation. It deliberately owns *none* of the geometry semantics:
//!
//! - shape trees are stored as opaque [`ShapeSlot`] bytes and are never decoded
//!   here; closed-form candidate validation belongs to task-047 and collider
//!   derivation to task-048;
//! - there is no active/sleeping lifecycle yet, so ADR-0004's terminal
//!   forced-sleep transition and its recovery diagnostic belong to the sleep and
//!   displacement task. The externally requested capacity rejection that
//!   protects that reserved increment *is* enforced here, because it is a
//!   revision rule rather than a lifecycle rule.

use std::collections::BTreeMap;
use std::fmt;

/// First entity ID. `0` is invalid and IDs are never reused (ADR-0002).
pub const FIRST_ENTITY_ID: u64 = 1;

/// Reserved terminal revision for forced sleep (ADR-0004).
pub const TERMINAL_REVISION: u64 = u64::MAX;

/// First revision of a newly created entity.
pub const FIRST_REVISION: u64 = 1;

/// An externally requested mutation rejects at or above this revision so the
/// reserved forced-sleep increment stays available (ADR-0004).
pub const REVISION_EXHAUSTION_THRESHOLD: u64 = TERMINAL_REVISION - 1;

/// Inclusive per-axis world bound in metres (`world/v1` section 3.1).
pub const WORLD_BOUND_METRES: f64 = 100_000.0;

/// Coordinate axis named by a boundary rejection.
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

/// Typed entity-store failures. Every variant is a no-effect rejection: it
/// allocates no ID, increments no revision, and mutates no stored state.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum EntityError {
    /// NaN or an infinity was supplied for `axis`.
    NonFinitePosition { axis: Axis },
    /// `axis` was finite but outside `[-100000.000, +100000.000]` metres.
    PositionOutOfBound { axis: Axis },
    /// No entity with this ID exists.
    UnknownEntity { entity_id: u64 },
    /// The global `u64` ID space is exhausted (`ENTITY_ID_EXHAUSTED`).
    EntityIdExhausted,
    /// The externally usable revision space is exhausted (`REVISION_EXHAUSTED`).
    RevisionExhausted { entity_id: u64 },
    /// Persisted entity state failed its invariants; recovery fails closed.
    CorruptEntityState { reason: &'static str },
}

impl EntityError {
    /// Stable lower-snake slug used in published command summaries and digests.
    #[must_use]
    pub fn reason(&self) -> String {
        match self {
            Self::NonFinitePosition { axis } => format!("non_finite_position_{}", axis.as_str()),
            Self::PositionOutOfBound { axis } => format!("position_out_of_bound_{}", axis.as_str()),
            Self::UnknownEntity { .. } => "unknown_entity".to_string(),
            Self::EntityIdExhausted => "entity_id_exhausted".to_string(),
            Self::RevisionExhausted { .. } => "revision_exhausted".to_string(),
            Self::CorruptEntityState { reason } => format!("corrupt_entity_state_{reason}"),
        }
    }
}

impl fmt::Display for EntityError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::NonFinitePosition { axis } => {
                write!(f, "non-finite position component {}", axis.as_str())
            }
            Self::PositionOutOfBound { axis } => write!(
                f,
                "position component {} outside +/-{WORLD_BOUND_METRES} metres",
                axis.as_str()
            ),
            Self::UnknownEntity { entity_id } => write!(f, "unknown entity {entity_id}"),
            Self::EntityIdExhausted => write!(f, "entity id space exhausted"),
            Self::RevisionExhausted { entity_id } => {
                write!(f, "revision space exhausted for entity {entity_id}")
            }
            Self::CorruptEntityState { reason } => {
                write!(f, "corrupt persisted entity state: {reason}")
            }
        }
    }
}

impl std::error::Error for EntityError {}

/// An unvalidated position in metres as supplied by a caller or command.
///
/// Equality is bitwise on the IEEE-754 representation. That is deliberate: a
/// request may carry NaN, and bitwise equality stays reflexive, so the type can
/// implement [`Eq`] and be embedded in comparable command records.
#[derive(Debug, Clone, Copy)]
pub struct PositionRequest {
    pub x: f64,
    pub y: f64,
    pub z: f64,
}

impl PositionRequest {
    #[must_use]
    pub const fn new(x: f64, y: f64, z: f64) -> Self {
        Self { x, y, z }
    }

    /// Reject non-finite and out-of-range components, then canonicalize.
    ///
    /// Rejection happens before any state, ruleset, or budget work, and a value
    /// outside the world bound is never clamped back into the world.
    pub fn validate(self) -> Result<Position, EntityError> {
        let x = check_axis(self.x, Axis::X)?;
        let y = check_axis(self.y, Axis::Y)?;
        let z = check_axis(self.z, Axis::Z)?;
        Ok(Position { x, y, z })
    }
}

impl PartialEq for PositionRequest {
    fn eq(&self, other: &Self) -> bool {
        self.x.to_bits() == other.x.to_bits()
            && self.y.to_bits() == other.y.to_bits()
            && self.z.to_bits() == other.z.to_bits()
    }
}

impl Eq for PositionRequest {}

impl From<Position> for PositionRequest {
    fn from(value: Position) -> Self {
        Self {
            x: value.x,
            y: value.y,
            z: value.z,
        }
    }
}

fn check_axis(value: f64, axis: Axis) -> Result<f64, EntityError> {
    if !value.is_finite() {
        return Err(EntityError::NonFinitePosition { axis });
    }
    if !(-WORLD_BOUND_METRES..=WORLD_BOUND_METRES).contains(&value) {
        return Err(EntityError::PositionOutOfBound { axis });
    }
    // Canonicalize negative zero so bitwise equality matches numeric equality.
    Ok(if value == 0.0 { 0.0 } else { value })
}

/// A validated canonical position: every component is finite, within
/// `[-100000.000, +100000.000]` metres, and free of negative zero.
///
/// Fields are private so the invariant cannot be bypassed. Equality is bitwise,
/// which coincides with numeric equality because of that invariant, and lets the
/// type implement [`Eq`] for the immutable generation and durable packet.
#[derive(Debug, Clone, Copy)]
pub struct Position {
    x: f64,
    y: f64,
    z: f64,
}

impl Position {
    /// Validate metre components into a canonical position.
    pub fn new(x: f64, y: f64, z: f64) -> Result<Self, EntityError> {
        PositionRequest::new(x, y, z).validate()
    }

    /// The world origin.
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

    /// Deterministic byte encoding for digests and the durable codec.
    #[must_use]
    pub fn to_bits(self) -> [u64; 3] {
        [self.x.to_bits(), self.y.to_bits(), self.z.to_bits()]
    }
}

impl PartialEq for Position {
    fn eq(&self, other: &Self) -> bool {
        self.x.to_bits() == other.x.to_bits()
            && self.y.to_bits() == other.y.to_bits()
            && self.z.to_bits() == other.z.to_bits()
    }
}

impl Eq for Position {}

/// Opaque storage for an entity's shape tree.
///
/// task-046 stores and republishes these bytes without decoding them. Candidate
/// validation (task-047) and collider derivation (task-048) own interpretation;
/// nothing here may assume the bytes are a well-formed `ShapeTree`.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct ShapeSlot {
    encoded: Vec<u8>,
}

impl ShapeSlot {
    /// Wrap already-encoded `ShapeTree` bytes without interpreting them.
    #[must_use]
    pub fn from_encoded(encoded: Vec<u8>) -> Self {
        Self { encoded }
    }

    #[must_use]
    pub fn as_bytes(&self) -> &[u8] {
        &self.encoded
    }

    #[must_use]
    pub fn len(&self) -> usize {
        self.encoded.len()
    }

    #[must_use]
    pub fn is_empty(&self) -> bool {
        self.encoded.is_empty()
    }
}

/// Frozen entity view published with an immutable generation.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct EntitySnapshot {
    pub entity_id: u64,
    pub revision: u64,
    pub position: Position,
    pub shape: Option<ShapeSlot>,
}

/// Result of an entity mutation attempt that was not rejected.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum MutationOutcome {
    /// An externally visible change: the revision advanced exactly once.
    Applied { entity_id: u64, revision: u64 },
    /// A semantic no-op: state and revision are unchanged (ADR-0002).
    NoOp { entity_id: u64, revision: u64 },
}

impl MutationOutcome {
    #[must_use]
    pub const fn entity_id(self) -> u64 {
        match self {
            Self::Applied { entity_id, .. } | Self::NoOp { entity_id, .. } => entity_id,
        }
    }

    #[must_use]
    pub const fn revision(self) -> u64 {
        match self {
            Self::Applied { revision, .. } | Self::NoOp { revision, .. } => revision,
        }
    }

    #[must_use]
    pub const fn applied(self) -> bool {
        matches!(self, Self::Applied { .. })
    }
}

/// Authoritative entity table plus the global monotonic ID allocator.
///
/// Iteration is by ascending unsigned entity ID; no operation depends on hash
/// iteration or insertion order.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct EntityStore {
    entities: BTreeMap<u64, EntitySnapshot>,
    /// Next ID to allocate. `0` marks the exhausted allocator, which is
    /// unambiguous because entity IDs start at `1` and are never reused.
    next_entity_id: u64,
}

impl Default for EntityStore {
    fn default() -> Self {
        Self::new()
    }
}

impl EntityStore {
    #[must_use]
    pub fn new() -> Self {
        Self {
            entities: BTreeMap::new(),
            next_entity_id: FIRST_ENTITY_ID,
        }
    }

    /// Create an entity. An ID is consumed only when this call returns `Ok`.
    pub fn create(
        &mut self,
        position: PositionRequest,
        shape: Option<ShapeSlot>,
    ) -> Result<EntitySnapshot, EntityError> {
        // Validate before touching the allocator: a rejected creation must not
        // consume a public ID (ADR-0002).
        let position = position.validate()?;
        if self.next_entity_id == 0 {
            return Err(EntityError::EntityIdExhausted);
        }
        let entity_id = self.next_entity_id;
        let snapshot = EntitySnapshot {
            entity_id,
            revision: FIRST_REVISION,
            position,
            shape,
        };
        self.entities.insert(entity_id, snapshot.clone());
        // Wrapping to 0 is the exhausted marker, never a reused ID.
        self.next_entity_id = entity_id.wrapping_add(1);
        Ok(snapshot)
    }

    /// Move an entity to a new canonical position.
    pub fn set_position(
        &mut self,
        entity_id: u64,
        position: PositionRequest,
    ) -> Result<MutationOutcome, EntityError> {
        let position = position.validate()?;
        let current = self.require(entity_id)?;
        if current.position == position {
            return Ok(MutationOutcome::NoOp {
                entity_id,
                revision: current.revision,
            });
        }
        let revision = next_revision(entity_id, current.revision)?;
        let entity = self.entities.get_mut(&entity_id).expect("checked above");
        entity.position = position;
        entity.revision = revision;
        Ok(MutationOutcome::Applied {
            entity_id,
            revision,
        })
    }

    /// Replace an entity's opaque shape slot. Storage only: the bytes are never
    /// decoded, validated, or turned into a collider here.
    pub fn set_shape_slot(
        &mut self,
        entity_id: u64,
        shape: Option<ShapeSlot>,
    ) -> Result<MutationOutcome, EntityError> {
        let current = self.require(entity_id)?;
        if current.shape == shape {
            return Ok(MutationOutcome::NoOp {
                entity_id,
                revision: current.revision,
            });
        }
        let revision = next_revision(entity_id, current.revision)?;
        let entity = self.entities.get_mut(&entity_id).expect("checked above");
        entity.shape = shape;
        entity.revision = revision;
        Ok(MutationOutcome::Applied {
            entity_id,
            revision,
        })
    }

    #[must_use]
    pub fn get(&self, entity_id: u64) -> Option<&EntitySnapshot> {
        self.entities.get(&entity_id)
    }

    /// Frozen view for publication, keyed and ordered by unsigned entity ID.
    #[must_use]
    pub fn snapshots(&self) -> BTreeMap<u64, EntitySnapshot> {
        self.entities.clone()
    }

    /// Ascending-ID iteration over the live table.
    pub fn iter(&self) -> impl Iterator<Item = (u64, &EntitySnapshot)> {
        self.entities.iter().map(|(id, entity)| (*id, entity))
    }

    /// Next ID the allocator will hand out; `0` means the space is exhausted.
    #[must_use]
    pub const fn next_entity_id(&self) -> u64 {
        self.next_entity_id
    }

    #[must_use]
    pub fn len(&self) -> usize {
        self.entities.len()
    }

    #[must_use]
    pub fn is_empty(&self) -> bool {
        self.entities.is_empty()
    }

    /// Reinstall a persisted entity table and allocator, failing closed on any
    /// state that violates the identity invariants.
    pub fn restore(
        &mut self,
        entities: BTreeMap<u64, EntitySnapshot>,
        next_entity_id: u64,
    ) -> Result<(), EntityError> {
        let mut highest = 0u64;
        for (key, entity) in &entities {
            if *key != entity.entity_id {
                return Err(EntityError::CorruptEntityState {
                    reason: "key_id_mismatch",
                });
            }
            if entity.entity_id < FIRST_ENTITY_ID {
                return Err(EntityError::CorruptEntityState {
                    reason: "zero_entity_id",
                });
            }
            if entity.revision < FIRST_REVISION {
                return Err(EntityError::CorruptEntityState {
                    reason: "zero_revision",
                });
            }
            highest = highest.max(entity.entity_id);
        }
        // `0` is the exhausted allocator; otherwise IDs must still be unused.
        if next_entity_id != 0 && next_entity_id <= highest {
            return Err(EntityError::CorruptEntityState {
                reason: "allocator_would_reuse_id",
            });
        }
        if next_entity_id != 0 && next_entity_id < FIRST_ENTITY_ID {
            return Err(EntityError::CorruptEntityState {
                reason: "allocator_below_first_id",
            });
        }
        self.entities = entities;
        self.next_entity_id = next_entity_id;
        Ok(())
    }

    /// Test-only: force an entity's revision to exercise exhaustion behavior.
    #[cfg(test)]
    fn force_revision_for_test(&mut self, entity_id: u64, revision: u64) {
        self.entities
            .get_mut(&entity_id)
            .expect("entity exists")
            .revision = revision;
    }

    fn require(&self, entity_id: u64) -> Result<&EntitySnapshot, EntityError> {
        self.entities
            .get(&entity_id)
            .ok_or(EntityError::UnknownEntity { entity_id })
    }
}

/// One increment, reserving ADR-0004's terminal forced-sleep revision.
fn next_revision(entity_id: u64, current: u64) -> Result<u64, EntityError> {
    if current >= REVISION_EXHAUSTION_THRESHOLD {
        return Err(EntityError::RevisionExhausted { entity_id });
    }
    Ok(current + 1)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn at(x: f64, y: f64, z: f64) -> PositionRequest {
        PositionRequest::new(x, y, z)
    }

    #[test]
    fn ids_are_monotonic_and_only_accepted_creation_consumes_one() {
        let mut store = EntityStore::new();
        assert_eq!(store.next_entity_id(), 1);
        assert_eq!(store.create(at(0.0, 0.0, 0.0), None).unwrap().entity_id, 1);
        assert_eq!(store.next_entity_id(), 2);

        // Rejected creation consumes nothing.
        assert_eq!(
            store.create(at(f64::NAN, 0.0, 0.0), None),
            Err(EntityError::NonFinitePosition { axis: Axis::X })
        );
        assert_eq!(store.next_entity_id(), 2);
        assert_eq!(store.len(), 1);

        assert_eq!(store.create(at(1.0, 2.0, 3.0), None).unwrap().entity_id, 2);
        assert_eq!(
            store.iter().map(|(id, _)| id).collect::<Vec<_>>(),
            vec![1, 2]
        );
    }

    #[test]
    fn bounds_are_closed_and_negative_zero_canonicalizes() {
        let bound = WORLD_BOUND_METRES;
        assert!(Position::new(bound, -bound, bound).is_ok());
        assert_eq!(
            Position::new(bound + 0.0004, 0.0, 0.0),
            Err(EntityError::PositionOutOfBound { axis: Axis::X })
        );
        assert_eq!(
            Position::new(0.0, 0.0, f64::NEG_INFINITY),
            Err(EntityError::NonFinitePosition { axis: Axis::Z })
        );
        let canonical = Position::new(-0.0, -0.0, -0.0).unwrap();
        assert_eq!(canonical, Position::origin());
        assert_eq!(canonical.to_bits(), [0, 0, 0]);
    }

    #[test]
    fn revision_increments_once_and_skips_no_ops() {
        let mut store = EntityStore::new();
        let created = store.create(at(1.0, 0.0, 0.0), None).unwrap();
        assert_eq!(created.revision, 1);

        let same = store.set_position(1, at(1.0, 0.0, 0.0)).unwrap();
        assert_eq!(
            same,
            MutationOutcome::NoOp {
                entity_id: 1,
                revision: 1
            }
        );
        let moved = store.set_position(1, at(2.0, 0.0, 0.0)).unwrap();
        assert_eq!(
            moved,
            MutationOutcome::Applied {
                entity_id: 1,
                revision: 2
            }
        );
        // Rejection leaves the revision alone.
        assert!(store.set_position(1, at(f64::INFINITY, 0.0, 0.0)).is_err());
        assert_eq!(store.get(1).unwrap().revision, 2);
        assert_eq!(store.get(1).unwrap().position.x(), 2.0);
    }

    #[test]
    fn shape_slot_is_stored_verbatim_and_no_op_aware() {
        let mut store = EntityStore::new();
        store
            .create(at(0.0, 0.0, 0.0), Some(ShapeSlot::from_encoded(vec![9])))
            .unwrap();
        let repeat = store
            .set_shape_slot(1, Some(ShapeSlot::from_encoded(vec![9])))
            .unwrap();
        assert!(!repeat.applied());
        let changed = store
            .set_shape_slot(1, Some(ShapeSlot::from_encoded(vec![9, 9])))
            .unwrap();
        assert!(changed.applied());
        assert_eq!(
            store.get(1).unwrap().shape.as_ref().unwrap().as_bytes(),
            [9, 9]
        );
        assert_eq!(store.get(1).unwrap().revision, 2);
    }

    #[test]
    fn revision_exhaustion_rejects_without_effect() {
        let mut store = EntityStore::new();
        store.create(at(0.0, 0.0, 0.0), None).unwrap();
        store.force_revision_for_test(1, REVISION_EXHAUSTION_THRESHOLD - 1);
        assert!(store.set_position(1, at(1.0, 0.0, 0.0)).unwrap().applied());
        assert_eq!(
            store.get(1).unwrap().revision,
            REVISION_EXHAUSTION_THRESHOLD
        );

        assert_eq!(
            store.set_position(1, at(2.0, 0.0, 0.0)),
            Err(EntityError::RevisionExhausted { entity_id: 1 })
        );
        assert_eq!(store.get(1).unwrap().position.x(), 1.0);
        assert_eq!(
            store.get(1).unwrap().revision,
            REVISION_EXHAUSTION_THRESHOLD
        );
        // The reserved terminal revision is still available for forced sleep.
        assert_eq!(TERMINAL_REVISION - REVISION_EXHAUSTION_THRESHOLD, 1);
    }

    #[test]
    fn unknown_entity_rejects_without_allocating() {
        let mut store = EntityStore::new();
        assert_eq!(
            store.set_position(7, at(0.0, 0.0, 0.0)),
            Err(EntityError::UnknownEntity { entity_id: 7 })
        );
        assert_eq!(store.next_entity_id(), FIRST_ENTITY_ID);
    }

    #[test]
    fn exhausted_allocator_rejects_instead_of_reusing() {
        let mut store = EntityStore::new();
        let mut entities = BTreeMap::new();
        entities.insert(
            u64::MAX,
            EntitySnapshot {
                entity_id: u64::MAX,
                revision: 1,
                position: Position::origin(),
                shape: None,
            },
        );
        store.restore(entities, 0).unwrap();
        assert_eq!(
            store.create(at(0.0, 0.0, 0.0), None),
            Err(EntityError::EntityIdExhausted)
        );
        assert_eq!(store.len(), 1);
    }

    #[test]
    fn restore_fails_closed_on_invariant_violations() {
        let mut store = EntityStore::new();
        let entity = EntitySnapshot {
            entity_id: 4,
            revision: 1,
            position: Position::origin(),
            shape: None,
        };
        let mut mismatched = BTreeMap::new();
        mismatched.insert(5, entity.clone());
        assert!(store.restore(mismatched, 9).is_err());

        let mut zero_revision = BTreeMap::new();
        zero_revision.insert(
            4,
            EntitySnapshot {
                revision: 0,
                ..entity.clone()
            },
        );
        assert!(store.restore(zero_revision, 9).is_err());

        let mut reusing = BTreeMap::new();
        reusing.insert(4, entity.clone());
        assert!(store.restore(reusing.clone(), 4).is_err());
        assert!(store.restore(reusing, 5).is_ok());
        assert_eq!(store.next_entity_id(), 5);
    }
}
