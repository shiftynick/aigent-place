//! Fixed-tick world core: order, apply, expire leases, publish generation.

use crate::entity::{EntityError, EntityStore, PositionRequest, ShapeSlot};
use crate::generation::{AppliedCommand, ImmutableGeneration};
use crate::lease::LeaseTable;
use crate::order::{canonical_command_order, CommandKey};
use crate::persist::{CommittedGeneration, DurableJournal, InMemoryJournal, JournalError};
use crate::rng::{deterministic_draw_u128, DrawInput, DrawScope, RngError};
use crate::ruleset::{RulesetParameters, RulesetStore, RulesetValidationError};
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

/// Internal harness effects. Wire MOVE maps to [`CommandEffect::UpsertLease`].
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
    /// Create an authoritative entity at a requested metre position. An entity
    /// ID is allocated only when this effect is accepted (ADR-0002).
    CreateEntity {
        position: PositionRequest,
        shape: Option<ShapeSlot>,
    },
    /// Move an existing entity to a requested metre position.
    SetEntityPosition {
        entity_id: u64,
        position: PositionRequest,
    },
    /// Replace an entity's opaque shape slot. Storage only: candidate
    /// validation is task-047 and collider derivation is task-048.
    SetEntityShape {
        entity_id: u64,
        shape: Option<ShapeSlot>,
    },
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
    StaleArrivalTick {
        arrival_tick: u64,
        next_tick: u64,
    },
    Ruleset(RulesetValidationError),
    Persistence(JournalError),
    Rng(RngError),
    /// Entity-store failure outside a command (recovery of persisted state).
    /// Domain rejections inside a tick are recorded results, not tick failures.
    Entity(EntityError),
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
            Self::Ruleset(error) => write!(f, "ruleset validation failed: {error:?}"),
            Self::Persistence(error) => write!(f, "persistence error: {error}"),
            Self::Rng(error) => write!(f, "{error}"),
            Self::Entity(error) => write!(f, "entity state error: {error}"),
        }
    }
}

impl std::error::Error for WorldError {}

impl From<RngError> for WorldError {
    fn from(value: RngError) -> Self {
        Self::Rng(value)
    }
}

impl From<EntityError> for WorldError {
    fn from(value: EntityError) -> Self {
        Self::Entity(value)
    }
}

/// Authoritative fixed-tick simulation skeleton.
#[derive(Debug)]
pub struct World {
    seed: [u8; 32],
    clock: TickClock,
    leases: LeaseTable,
    entities: EntityStore,
    pending: Vec<QueuedCommand>,
    world_value: i64,
    published: Option<ImmutableGeneration>,
    rulesets: RulesetStore,
    journal: DurableJournal,
    /// When false, pending ruleset is rolled back at activate_at_tick.
    soak_ok: bool,
    /// Tentative tick awaiting async durability (not yet authoritative).
    tentative: Option<TentativeTick>,
}

/// Draft world state for one tick, installed only after durable commit.
#[derive(Debug, Clone)]
struct TentativeTick {
    leases: LeaseTable,
    entities: EntityStore,
    world_value: i64,
    rulesets: RulesetStore,
    generation: ImmutableGeneration,
    /// Commands removed from `pending` for this tick; restored on writer failure.
    restored_pending: Vec<QueuedCommand>,
    remaining_pending: Vec<QueuedCommand>,
}

impl World {
    #[must_use]
    pub fn new(config: WorldConfig) -> Self {
        Self::with_journal(config, DurableJournal::memory())
    }

    /// Construct a world that uses an already-opened durable journal (no recovery).
    #[must_use]
    pub fn with_journal(config: WorldConfig, journal: DurableJournal) -> Self {
        let rulesets = RulesetStore::new();
        let lease_ttl = rulesets.live().parameters.lease_ttl_ms();
        let _ = config.lease_ttl_ms; // reserved; live ruleset owns TTL
        Self {
            seed: config.world_seed,
            clock: TickClock::new(),
            leases: LeaseTable::new(lease_ttl),
            entities: EntityStore::new(),
            pending: Vec::new(),
            world_value: 0,
            published: None,
            rulesets,
            journal,
            soak_ok: true,
            tentative: None,
        }
    }

    #[must_use]
    pub fn rulesets(&self) -> &RulesetStore {
        &self.rulesets
    }

    /// Authoritative entity table. Mutations reach it only through an accepted
    /// command in a durably committed tick.
    #[must_use]
    pub fn entities(&self) -> &EntityStore {
        &self.entities
    }

    #[must_use]
    pub fn journal(&self) -> &DurableJournal {
        &self.journal
    }

    pub fn journal_mut(&mut self) -> &mut DurableJournal {
        &mut self.journal
    }

    pub fn set_soak_ok(&mut self, soak_ok: bool) {
        self.soak_ok = soak_ok;
    }

    /// Schedule a validated ruleset candidate. Invalid candidates leave live unchanged.
    pub fn schedule_ruleset(&mut self, parameters: RulesetParameters) -> Result<u64, WorldError> {
        self.rulesets
            .schedule(parameters, self.clock.last_completed())
            .map_err(WorldError::Ruleset)
    }

    /// Reconstruct world from the journal's last committed generation.
    /// Fails closed on corrupt or gapped committed history.
    pub fn recover_from_journal(
        config: WorldConfig,
        journal: DurableJournal,
    ) -> Result<Self, WorldError> {
        Self::recover_durable(config, journal)
    }

    /// Convenience: recover from an in-memory journal handle.
    pub fn recover_from_memory_journal(
        config: WorldConfig,
        journal: InMemoryJournal,
    ) -> Result<Self, WorldError> {
        Self::recover_durable(config, DurableJournal::Memory(journal))
    }

    fn recover_durable(
        config: WorldConfig,
        mut journal: DurableJournal,
    ) -> Result<Self, WorldError> {
        journal.discard_pending();
        let recovered = journal.recover().map_err(WorldError::Persistence)?;
        let mut world = Self::with_journal(config, journal);
        if let Some(last) = recovered.last_committed {
            world.world_value = last.world_value;
            world.rulesets = RulesetStore::from_recovered(last.ruleset, last.pending_ruleset);
            world
                .leases
                .set_default_ttl_ms(world.rulesets.live().parameters.lease_ttl_ms());
            for (body_id, lease) in last.active_leases {
                world.leases.restore(body_id, lease);
            }
            world
                .entities
                .restore(last.entities, last.next_entity_id)
                .map_err(WorldError::Entity)?;
            while world.clock.last_completed() < last.generation {
                let _ = world.clock.advance();
            }
        }
        Ok(world)
    }

    #[must_use]
    pub fn last_completed_tick(&self) -> u64 {
        self.clock.last_completed()
    }

    /// Most recently published immutable generation, if any.
    #[must_use]
    pub fn last_generation(&self) -> Option<&ImmutableGeneration> {
        self.published.as_ref()
    }

    /// Tick index that will run on the next [`Self::advance_tick`] call.
    #[must_use]
    pub fn next_tick(&self) -> u64 {
        self.clock.next_tick()
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

    /// Run one simulation tick. Mutations become authoritative only after the
    /// durable commit succeeds (ADR-0005). Sync journals commit inline; async
    /// SQLite enqueues and installs when [`Self::poll_durable`] observes success.
    ///
    /// For async journals this may wait for the writer. The 20 Hz simulation
    /// stage must use [`Self::advance_tick_nonblocking`] + [`Self::poll_durable`]
    /// so it never awaits storage.
    pub fn advance_tick(&mut self) -> Result<&ImmutableGeneration, WorldError> {
        let _ = self.poll_durable()?;
        match self.advance_tick_nonblocking()? {
            TickAdvance::Published => Ok(self
                .published
                .as_ref()
                .expect("published after TickAdvance::Published")),
            TickAdvance::Submitted { .. } => {
                self.wait_durable()?;
                Ok(self
                    .published
                    .as_ref()
                    .expect("published after durable wait"))
            }
            TickAdvance::Busy => Err(WorldError::Persistence(JournalError::WriterBusy)),
        }
    }

    /// Non-blocking tick advance for the async writer path.
    ///
    /// Callers own durability polling via [`Self::poll_durable`] before invoking
    /// this method so an install cannot be swallowed inside a subsequent submit.
    pub fn advance_tick_nonblocking(&mut self) -> Result<TickAdvance, WorldError> {
        if self.tentative.is_some() {
            return Ok(TickAdvance::Busy);
        }
        if self
            .journal
            .as_async_sqlite_mut()
            .is_some_and(|writer| writer.in_flight())
        {
            return Ok(TickAdvance::Busy);
        }

        let tick = self.clock.next_tick();
        let mut due = Vec::new();
        let mut remaining = Vec::new();
        for command in self.pending.drain(..) {
            if command.arrival_tick <= tick {
                due.push(command);
            } else {
                remaining.push(command);
            }
        }

        let restore_pending =
            |world: &mut Self, due: Vec<QueuedCommand>, remaining: Vec<QueuedCommand>| {
                world.pending = due;
                world.pending.extend(remaining);
            };

        let mut leases = self.leases.clone();
        // Draft copies: nothing here reaches authoritative state until the
        // durable commit succeeds and `install_tentative` runs (ADR-0005).
        let mut entities = self.entities.clone();
        let mut world_value = self.world_value;
        let mut rulesets = self.rulesets.clone();
        let keys: Vec<CommandKey> = due.iter().map(QueuedCommand::key).collect();
        let order = canonical_command_order(&keys);

        let mut applied = Vec::new();
        let mut rng_draws = Vec::new();
        for (canonical_index, &index) in order.iter().enumerate() {
            let command = &due[index];
            let summary = match apply_effect(
                &self.seed,
                tick,
                canonical_index as u32,
                command,
                &mut leases,
                &mut entities,
                &mut world_value,
            ) {
                Ok(summary) => summary,
                Err(error) => {
                    restore_pending(self, due, remaining);
                    return Err(error);
                }
            };
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

        let expired_leases = leases.expire_due(tick);
        if rulesets.try_activate_at_boundary(tick, self.soak_ok) {
            leases.set_default_ttl_ms(rulesets.live().parameters.lease_ttl_ms());
        }

        let command_summaries: Vec<String> = applied
            .iter()
            .map(|command| command.summary.clone())
            .collect();
        let packet = CommittedGeneration {
            generation: tick,
            world_value,
            ruleset: rulesets.live().clone(),
            pending_ruleset: rulesets.pending().cloned(),
            command_summaries,
            active_leases: leases.snapshots(),
            entities: entities.snapshots(),
            next_entity_id: entities.next_entity_id(),
            integrity_hex: String::new(),
        };
        let generation = ImmutableGeneration {
            generation: tick,
            tick,
            world_value,
            ruleset_generation_id: rulesets.live().generation_id,
            active_leases: leases.snapshots(),
            applied_commands: applied,
            expired_leases,
            rng_draws,
            entities: entities.snapshots(),
            next_entity_id: entities.next_entity_id(),
        };

        if self.journal.is_async() {
            let writer = self.journal.as_async_sqlite_mut().expect("async journal");
            match writer.try_submit(packet) {
                Ok(()) => {
                    self.tentative = Some(TentativeTick {
                        leases,
                        entities,
                        world_value,
                        rulesets,
                        generation,
                        restored_pending: due,
                        remaining_pending: remaining,
                    });
                    // Keep command queue empty until install/fail; restore on fail.
                    Ok(TickAdvance::Submitted { generation: tick })
                }
                Err(error) => {
                    restore_pending(self, due, remaining);
                    Err(WorldError::Persistence(error))
                }
            }
        } else {
            if let Err(error) = self.journal.begin(packet) {
                restore_pending(self, due, remaining);
                return Err(WorldError::Persistence(error));
            }
            match self.journal.commit() {
                Ok(_) => {
                    self.pending = remaining;
                    self.install_tentative(TentativeTick {
                        leases,
                        entities,
                        world_value,
                        rulesets,
                        generation,
                        restored_pending: due,
                        remaining_pending: Vec::new(),
                    });
                    Ok(TickAdvance::Published)
                }
                Err(error) => {
                    self.journal.discard_pending();
                    restore_pending(self, due, remaining);
                    Err(WorldError::Persistence(error))
                }
            }
        }
    }

    /// Install a successfully committed async generation, if ready.
    pub fn poll_durable(&mut self) -> Result<Option<&ImmutableGeneration>, WorldError> {
        let Some(writer) = self.journal.as_async_sqlite_mut() else {
            return Ok(None);
        };
        match writer.try_poll() {
            Ok(Some(_packet)) => {
                let arrived_during_flight = std::mem::take(&mut self.pending);
                let mut tentative = self
                    .tentative
                    .take()
                    .expect("committed generation has tentative state");
                self.pending = std::mem::take(&mut tentative.remaining_pending);
                self.pending.extend(arrived_during_flight);
                self.install_tentative(tentative);
                Ok(self.published.as_ref())
            }
            Ok(None) => Ok(None),
            Err(error) => {
                let arrived_during_flight = std::mem::take(&mut self.pending);
                if let Some(tentative) = self.tentative.take() {
                    self.pending = tentative.restored_pending;
                    self.pending.extend(tentative.remaining_pending);
                }
                self.pending.extend(arrived_during_flight);
                Err(WorldError::Persistence(error))
            }
        }
    }

    /// Block until an in-flight async generation commits or fails.
    pub fn wait_durable(&mut self) -> Result<&ImmutableGeneration, WorldError> {
        while self.tentative.is_some() {
            if self.poll_durable()?.is_some() {
                break;
            }
            std::thread::sleep(std::time::Duration::from_millis(1));
        }
        self.published
            .as_ref()
            .ok_or(WorldError::Persistence(JournalError::NoPending))
    }

    #[must_use]
    pub fn has_tentative(&self) -> bool {
        self.tentative.is_some()
    }

    fn install_tentative(&mut self, tentative: TentativeTick) {
        let _ = self.clock.advance();
        self.leases = tentative.leases;
        self.entities = tentative.entities;
        self.world_value = tentative.world_value;
        self.rulesets = tentative.rulesets;
        self.published = Some(tentative.generation);
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
}

/// Outcome of a non-blocking tick attempt.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum TickAdvance {
    /// Sync journal committed and the generation is published.
    Published,
    /// Async writer accepted the sealed packet; call [`World::poll_durable`].
    Submitted { generation: u64 },
    /// Prior generation still awaiting durability.
    Busy,
}

/// Apply one canonically ordered command to the draft tick state.
///
/// An `Err` here aborts the whole tick and is reserved for infrastructure
/// failures. An entity *domain* rejection is not a tick failure: it mutates
/// nothing, allocates no ID or revision, and is published as a recorded
/// rejection summary, exactly as `world/v1` section 1 requires.
fn apply_effect(
    seed: &[u8; 32],
    tick: u64,
    canonical_index: u32,
    command: &QueuedCommand,
    leases: &mut LeaseTable,
    entities: &mut EntityStore,
    world_value: &mut i64,
) -> Result<(String, Option<crate::rng::DrawResult>), WorldError> {
    match &command.effect {
        CommandEffect::UpsertLease { body_id, ttl_ms } => {
            let applied = leases.upsert(
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
            let removed = leases.cancel(*body_id);
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
            let draw = deterministic_draw_u128(seed, &input, *bound)?;
            Ok((format!("seeded_draw:value={}", draw.value), Some(draw)))
        }
        CommandEffect::BumpWorldValue { delta } => {
            *world_value = world_value.saturating_add(*delta);
            Ok((format!("bump:delta={delta}:value={}", *world_value), None))
        }
        CommandEffect::CreateEntity { position, shape } => {
            let summary = match entities.create(*position, shape.clone()) {
                Ok(created) => format!(
                    "create_entity:accepted:id={}:rev={}",
                    created.entity_id, created.revision
                ),
                Err(error) => format!("create_entity:rejected={}", error.reason()),
            };
            Ok((summary, None))
        }
        CommandEffect::SetEntityPosition {
            entity_id,
            position,
        } => Ok((
            entity_mutation_summary(
                "set_entity_position",
                *entity_id,
                entities.set_position(*entity_id, *position),
            ),
            None,
        )),
        CommandEffect::SetEntityShape { entity_id, shape } => Ok((
            entity_mutation_summary(
                "set_entity_shape",
                *entity_id,
                entities.set_shape_slot(*entity_id, shape.clone()),
            ),
            None,
        )),
    }
}

/// Published summary for an entity mutation attempt. Accepted, no-op, and
/// rejected outcomes are distinguishable, so they produce distinct digests.
fn entity_mutation_summary(
    label: &str,
    entity_id: u64,
    outcome: Result<crate::entity::MutationOutcome, EntityError>,
) -> String {
    match outcome {
        Ok(outcome) if outcome.applied() => {
            format!("{label}:id={entity_id}:applied:rev={}", outcome.revision())
        }
        Ok(outcome) => format!("{label}:id={entity_id}:noop:rev={}", outcome.revision()),
        Err(error) => format!("{label}:id={entity_id}:rejected={}", error.reason()),
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
