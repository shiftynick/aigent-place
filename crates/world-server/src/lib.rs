//! Authoritative fixed-tick world core and connection session skeleton.
//!
//! Wire `MOVE` is admitted with an empty payload and applies an internal
//! movement lease (`UpsertLease`) until a typed move payload exists.
//!
//! Connection sessions use test-only trusted `aigent_id` inject (operator Q2=A /
//! task-018); production authentication is deferred.

mod aoi;
mod fanout;
mod generation;
mod lease;
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

pub use fanout::{
    ConnectionOutbound, EventStreamCursor, PublicationMailbox, PublishOutcome, SnapshotFanout,
};
pub use generation::{AppliedCommand, ImmutableGeneration};
pub use lease::{LeaseSnapshot, LeaseTable};
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
    RulesetValidationError, DEFAULT_LEASE_TTL_MS as RULESET_DEFAULT_LEASE_TTL_MS,
};
pub use session::{
    AuthoritativeResult, ClientHello, CommandOutcome, CommandSubmit, CompatibilityRecord,
    ConnectionDisplaced, ConnectionMode, ConnectionRole, FeatureOffer, HandshakeOutcome,
    IdentityBinding, SessionHub,
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
    spawn_simulation_loop, DrainReport, TransportState,
};
pub use world::{
    replay_log, CommandEffect, QueuedCommand, TickAdvance, World, WorldConfig, WorldError,
};

/// Documented smoke marker printed by the `world-server` binary.
pub const SMOKE_MARKER: &str = "world-server: smoke ok";
