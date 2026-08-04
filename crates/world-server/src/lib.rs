//! Authoritative fixed-tick world core skeleton.
//!
//! Wire `MOVE` remains unavailable (`UNSUPPORTED_MESSAGE`) until a typed
//! payload exists. Movement TTL/expiry is exercised through an internal lease
//! harness only (operator Q1=B / task-005).

mod generation;
mod lease;
mod order;
mod rng;
mod tick;
mod world;

pub use generation::{AppliedCommand, ImmutableGeneration};
pub use lease::{LeaseSnapshot, LeaseTable};
pub use order::{canonical_command_order, CommandKey};
pub use rng::{
    deterministic_draw, deterministic_draw_u128, DrawInput, DrawResult, DrawScope, RngError,
};
pub use tick::{ms_to_ticks, ticks_to_ms, TickClock, DEFAULT_LEASE_TTL_MS, TICK_HZ, TICK_MS};
pub use world::{replay_log, CommandEffect, QueuedCommand, World, WorldConfig, WorldError};

/// Documented smoke marker printed by the `world-server` binary.
pub const SMOKE_MARKER: &str = "world-server: smoke ok";
