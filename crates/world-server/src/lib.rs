//! Authoritative fixed-tick world core and connection session skeleton.
//!
//! Wire `MOVE` carries a typed [`MovePayload`](aigent_protocol::MovePayload)
//! decoded into [`MoveIntent`]. Malformed payloads reject without world
//! mutation. Accepted MOVE commands queue a renewable move-toward lease that
//! executes continuous swept motion each tick.

mod aoi;
mod broadphase;
mod collider;
mod entity;
mod fanout;
mod generation;
mod heightfield;
mod lease;
mod movement;
mod order;
mod outbound;
mod persist;
mod rng;
mod ruleset;
mod session;
mod shape;
mod snapshot;
mod tick;
mod transport;
mod world;

pub use aoi::{
    aoi_cap_for_role, interest_diff, truncate_nearest, AoiEntity, AoiError, FocusPoint,
    InterestDiff, SpatialHash, AOI_HARD_CAP, VIEWER_AOI_CAPS,
};
pub use broadphase::{BroadphaseQueryError, BroadphaseRebuildError, CollisionBroadphase};
pub use collider::{
    derive_collider, Aabb, Collider, ColliderDerivationError, HorizontalFootprint, NodeAabb,
    WorldPointMm,
};
pub use heightfield::{
    sample_height_mm, CellCoord, ChunkSampleView, GroundingResult, Heightfield, HeightfieldConfig,
    HeightfieldError, TerrainColumn, CHUNK_SIZE_MM, DEFAULT_HEIGHTFIELD_CELL_SIZE_MM,
    EXACT_GROUNDING_MAX_BINARY_STEPS, EXACT_GROUNDING_MAX_RESIDUAL_STEPS, GENERATED_HEIGHT_MAX_MM,
    GENERATED_HEIGHT_MIN_MM, HEIGHTFIELD_GENERATOR_DOMAIN, HEIGHTFIELD_GENERATOR_VERSION,
    HEIGHTFIELD_MAX_SELECTED_CELLS,
};

pub use entity::{
    EntityError, EntitySnapshot, EntityStore, MutationOutcome, Position, PositionRequest,
    ShapeSlot, FIRST_ENTITY_ID, FIRST_REVISION, REVISION_EXHAUSTION_THRESHOLD, TERMINAL_REVISION,
    WORLD_BOUND_METRES,
};
pub use fanout::{
    ConnectionOutbound, EventStreamCursor, PublicationMailbox, PublishOutcome, SnapshotFanout,
};
pub use generation::{AppliedCommand, ImmutableGeneration};
pub use lease::{LeaseSnapshot, LeaseTable, LeaseTermination, LeaseTerminationReason};
pub use movement::{
    decode_move_payload, encode_move_payload, tick_travel_mm, BlockerKey, DraftCollisionView,
    MoveDecodeError, MoveIntent, MoveStepResult, MovementError,
};
pub use order::{canonical_command_order, CommandKey};
pub use outbound::{
    EnqueueStateOutcome, ObserveOutcome, OutboundQueue, StateKind, OVERFLOW_TICK_OBSERVATIONS,
    QUEUE_LIMIT_BYTES,
};
pub use persist::{
    AsyncSqliteWriter, CommittedGeneration, DurableJournal, InMemoryJournal, JournalError,
    RecoveredState, SqliteJournal, ASYNC_WRITER_QUEUE_CAP,
};
pub use rng::{
    deterministic_draw, deterministic_draw_u128, DrawInput, DrawResult, DrawScope, RngError,
};
pub use ruleset::{
    validate_candidate, PendingRuleset, RulesetGeneration, RulesetParameters, RulesetStore,
    RulesetValidationError, DEFAULT_BLOCKED_LEASE_TICKS,
    DEFAULT_LEASE_TTL_MS as RULESET_DEFAULT_LEASE_TTL_MS, DEFAULT_MAX_SPEED_MM_PER_S,
    DEFAULT_SWEEP_MAX_MM,
};
pub use session::{
    AuthoritativeResult, ClientHello, CommandOutcome, CommandSubmit, CompatibilityRecord,
    ConnectionDisplaced, ConnectionMode, ConnectionRole, DecodedCommandPayload, FeatureOffer,
    HandshakeOutcome, IdentityBinding, SessionHub,
};
pub use shape::{
    is_valid_identifier, validate_shape_tree, validate_shape_tree_with_budgets, Axis,
    DimensionField, ShapeBudgets, ShapeClass, ShapeRejection, MAX_IDENTIFIER_LEN,
    QUATERNION_UNIT_TOLERANCE, WORLD_BOUND_MM,
};
pub use snapshot::{
    decode_placeholder_payload, encode_placeholder_payload, placeholder_body_from_lease,
    PlaceholderBody, SnapshotChannel, SnapshotResyncRequired, SnapshotStatus, StubSnapshotPayload,
    PLACEHOLDER_MAGIC, PLACEHOLDER_VERSION,
};
pub use tick::{ms_to_ticks, ticks_to_ms, TickClock, DEFAULT_LEASE_TTL_MS, TICK_HZ, TICK_MS};
pub use transport::{
    outbound_channel_cap, outbound_queue_limit_bytes, serve, serve_ephemeral,
    spawn_simulation_loop, DrainReport, TransportState, DEFAULT_LISTEN_JOURNAL_PATH,
};
pub use world::{
    replay_log, CommandEffect, QueuedCommand, TickAdvance, World, WorldConfig, WorldError,
};

/// Documented smoke marker printed by the `world-server` binary.
pub const SMOKE_MARKER: &str = "world-server: smoke ok";
