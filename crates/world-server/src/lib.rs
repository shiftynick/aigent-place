//! Authoritative fixed-tick world core and connection session skeleton.
//!
//! Wire `MOVE` remains unavailable (`UNSUPPORTED_MESSAGE`) until a typed
//! payload exists. Movement TTL/expiry is exercised through an internal lease
//! harness only (operator Q1=B / task-005).
//!
//! Connection sessions use test-only trusted `aigent_id` inject (operator Q2=A /
//! task-018); production authentication is deferred.

mod fanout;
mod generation;
mod lease;
mod order;
mod outbound;
mod rng;
mod session;
mod snapshot;
mod tick;
mod world;

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
pub use rng::{
    deterministic_draw, deterministic_draw_u128, DrawInput, DrawResult, DrawScope, RngError,
};
pub use session::{
    AuthoritativeResult, ClientHello, CommandOutcome, CommandSubmit, CompatibilityRecord,
    ConnectionDisplaced, ConnectionMode, ConnectionRole, FeatureOffer, HandshakeOutcome,
    IdentityBinding, SessionHub,
};
pub use snapshot::{SnapshotChannel, SnapshotResyncRequired, SnapshotStatus, StubSnapshotPayload};
pub use tick::{ms_to_ticks, ticks_to_ms, TickClock, DEFAULT_LEASE_TTL_MS, TICK_HZ, TICK_MS};
pub use world::{replay_log, CommandEffect, QueuedCommand, World, WorldConfig, WorldError};

/// Documented smoke marker printed by the `world-server` binary.
pub const SMOKE_MARKER: &str = "world-server: smoke ok";
