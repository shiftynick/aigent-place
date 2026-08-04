//! Fixed-tick world core: order, apply, expire leases, publish generation.

use crate::generation::{AppliedCommand, ImmutableGeneration};
use crate::lease::LeaseTable;
use crate::order::{canonical_command_order, CommandKey};
use crate::rng::{deterministic_draw_u128, DrawInput, DrawScope, RngError};
use crate::tick::{TickClock, DEFAULT_LEASE_TTL_MS};
use std::fmt;

/// Configuration for a new world instance.
#[derive(Debug, Clone)]
pub struct WorldConfig {
    pub world_seed: [u8; 32],
    pub lease_ttl_ms: u32,
}

impl Default for WorldConfig {
    fn default() -> Self {
        Self {
            world_seed: [0; 32],
            lease_ttl_ms: DEFAULT_LEASE_TTL_MS,
        }
    }
}

/// Internal harness effects. Protocol MOVE is not admitted here.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum CommandEffect {
    /// Grant or renew a movement lease for `body_id` (internal only).
    UpsertLease { body_id: u64, ttl_ms: Option<u32> },
    /// Cancel a lease immediately.
    CancelLease { body_id: u64 },
    /// Deterministic draw addressed by this command's canonical index.
    /// `bound` is in `1..=2^64` per `replay/v1` section 9.
    SeededDraw {
        subsystem: String,
        purpose: String,
        entity_id: u64,
        draw_index: u32,
        bound: u128,
    },
    /// Simple mutable counter used for same-build replay equivalence tests.
    BumpWorldValue { delta: i64 },
}

/// Command waiting for its arrival tick.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct QueuedCommand {
    pub arrival_tick: u64,
    pub aigent_id: Vec<u8>,
    pub sequence: u64,
    pub effect: CommandEffect,
}

impl QueuedCommand {
    fn key(&self) -> CommandKey {
        CommandKey::new(self.arrival_tick, self.aigent_id.clone(), self.sequence)
    }
}

/// World-core failures.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum WorldError {
    DuplicateCommandTuple,
    StaleArrivalTick { arrival_tick: u64, next_tick: u64 },
    Rng(RngError),
}

impl fmt::Display for WorldError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::DuplicateCommandTuple => write!(f, "duplicate canonical command tuple"),
            Self::StaleArrivalTick {
                arrival_tick,
                next_tick,
            } => write!(
                f,
                "stale arrival_tick {arrival_tick}; next tick is {next_tick}"
            ),
            Self::Rng(error) => write!(f, "{error}"),
        }
    }
}

impl std::error::Error for WorldError {}

impl From<RngError> for WorldError {
    fn from(value: RngError) -> Self {
        Self::Rng(value)
    }
}

/// Authoritative fixed-tick simulation skeleton.
#[derive(Debug)]
pub struct World {
    seed: [u8; 32],
    clock: TickClock,
    leases: LeaseTable,
    pending: Vec<QueuedCommand>,
    world_value: i64,
    published: Option<ImmutableGeneration>,
}

impl World {
    #[must_use]
    pub fn new(config: WorldConfig) -> Self {
        Self {
            seed: config.world_seed,
            clock: TickClock::new(),
            leases: LeaseTable::new(config.lease_ttl_ms),
            pending: Vec::new(),
            world_value: 0,
            published: None,
        }
    }

    #[must_use]
    pub fn last_completed_tick(&self) -> u64 {
        self.clock.last_completed()
    }

    #[must_use]
    pub fn published(&self) -> Option<&ImmutableGeneration> {
        self.published.as_ref()
    }

    #[must_use]
    pub fn world_value(&self) -> i64 {
        self.world_value
    }

    /// Enqueue a command. Arrival order of this call does not affect evaluation order.
    /// `arrival_tick` must be the current or a future tick (`>= next_tick`).
    pub fn enqueue(&mut self, command: QueuedCommand) -> Result<(), WorldError> {
        let next_tick = self.clock.next_tick();
        if command.arrival_tick < next_tick {
            return Err(WorldError::StaleArrivalTick {
                arrival_tick: command.arrival_tick,
                next_tick,
            });
        }
        let key = command.key();
        if self.pending.iter().any(|existing| existing.key() == key) {
            return Err(WorldError::DuplicateCommandTuple);
        }
        self.pending.push(command);
        Ok(())
    }

    /// Run one simulation tick and publish an immutable generation.
    pub fn advance_tick(&mut self) -> Result<&ImmutableGeneration, WorldError> {
        let tick = self.clock.advance();
        let mut due = Vec::new();
        let mut remaining = Vec::new();
        for command in self.pending.drain(..) {
            if command.arrival_tick <= tick {
                due.push(command);
            } else {
                remaining.push(command);
            }
        }
        self.pending = remaining;

        let keys: Vec<CommandKey> = due.iter().map(QueuedCommand::key).collect();
        let order = canonical_command_order(&keys);

        let mut applied = Vec::new();
        let mut rng_draws = Vec::new();
        for (canonical_index, &index) in order.iter().enumerate() {
            let command = &due[index];
            let summary = self.apply_effect(tick, canonical_index as u32, command)?;
            if let Some(draw) = summary.1 {
                rng_draws.push((canonical_index as u32, draw));
            }
            applied.push(AppliedCommand {
                arrival_tick: command.arrival_tick,
                aigent_id: command.aigent_id.clone(),
                sequence: command.sequence,
                canonical_index: canonical_index as u32,
                summary: summary.0,
            });
        }

        let expired_leases = self.leases.expire_due(tick);
        let generation = ImmutableGeneration {
            generation: tick,
            tick,
            world_value: self.world_value,
            active_leases: self.leases.snapshots(),
            applied_commands: applied,
            expired_leases,
            rng_draws,
        };
        self.published = Some(generation);
        Ok(self.published.as_ref().expect("just published"))
    }

    /// Advance `count` ticks. `count` must be at least 1.
    pub fn advance_ticks(&mut self, count: u64) -> Result<&ImmutableGeneration, WorldError> {
        if count == 0 {
            return Err(WorldError::Rng(RngError::InvalidInput("no ticks advanced")));
        }
        for _ in 0..count {
            self.advance_tick()?;
        }
        Ok(self.published.as_ref().expect("published after advance"))
    }

    fn apply_effect(
        &mut self,
        tick: u64,
        canonical_index: u32,
        command: &QueuedCommand,
    ) -> Result<(String, Option<crate::rng::DrawResult>), WorldError> {
        match &command.effect {
            CommandEffect::UpsertLease { body_id, ttl_ms } => {
                let applied = self.leases.upsert(
                    *body_id,
                    command.aigent_id.clone(),
                    command.sequence,
                    tick,
                    *ttl_ms,
                );
                Ok((
                    format!(
                        "upsert_lease:body={body_id}:applied={applied}:seq={}",
                        command.sequence
                    ),
                    None,
                ))
            }
            CommandEffect::CancelLease { body_id } => {
                let removed = self.leases.cancel(*body_id);
                Ok((
                    format!("cancel_lease:body={body_id}:removed={removed}"),
                    None,
                ))
            }
            CommandEffect::SeededDraw {
                subsystem,
                purpose,
                entity_id,
                draw_index,
                bound,
            } => {
                let input = DrawInput {
                    rng_contract_version: 1,
                    subsystem: subsystem.clone(),
                    purpose: purpose.clone(),
                    scope: DrawScope::Generation(tick),
                    canonical_command_index: canonical_index,
                    entity_id: *entity_id,
                    draw_index: *draw_index,
                };
                let draw = deterministic_draw_u128(&self.seed, &input, *bound)?;
                Ok((format!("seeded_draw:value={}", draw.value), Some(draw)))
            }
            CommandEffect::BumpWorldValue { delta } => {
                self.world_value = self.world_value.saturating_add(*delta);
                Ok((
                    format!("bump:delta={delta}:value={}", self.world_value),
                    None,
                ))
            }
        }
    }
}

/// Replay a command log onto a fresh world with the same seed.
pub fn replay_log(
    config: WorldConfig,
    log: &[QueuedCommand],
    ticks: u64,
) -> Result<ImmutableGeneration, WorldError> {
    let mut world = World::new(config);
    for command in log {
        world.enqueue(command.clone())?;
    }
    world.advance_ticks(ticks)?;
    Ok(world.published().expect("published").clone())
}
