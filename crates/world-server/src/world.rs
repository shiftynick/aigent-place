//! Fixed-tick world core: order, apply, execute leases, publish generation.

use crate::entity::{EntityError, EntitySnapshot, EntityStore, PositionRequest, ShapeSlot};
use crate::generation::{AppliedCommand, ImmutableGeneration};
use crate::heightfield::{Heightfield, DEFAULT_HEIGHTFIELD_CELL_SIZE_MM};
use crate::lease::{LeaseTable, LeaseTermination, LeaseTerminationReason};
use crate::movement::{
    collider_at, ground_horizontal, step_move_toward, BlockerKey, DraftCollisionView, MoveIntent,
    MoveStepResult, MovementError,
};
use crate::order::{canonical_command_order, CommandKey};
use crate::persist::{CommittedGeneration, DurableJournal, InMemoryJournal, JournalError};
use crate::rng::{deterministic_draw_u128, DrawInput, DrawScope, RngError};
use crate::ruleset::{RulesetParameters, RulesetStore, RulesetValidationError};
use crate::tick::{TickClock, DEFAULT_LEASE_TTL_MS};
use aigent_protocol::ShapeTree;
use prost::Message;
use std::collections::BTreeMap;
use std::collections::BTreeSet;
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

/// Internal command effects applied inside a tick.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum CommandEffect {
    /// Legacy internal lease harness retained for replay and durability tests.
    /// Existing callers use absent or shapeless body IDs. If pointed at shaped
    /// geometry, its compatibility intent moves toward the origin at 1 mm/s.
    UpsertLease { body_id: u64, ttl_ms: Option<u32> },
    /// Grant or renew a typed move-toward lease for the aigent's bound body.
    /// `body_id` is resolved at apply time from the aigent binding when `None`.
    UpsertMoveLease {
        body_id: Option<u64>,
        intent: MoveIntent,
        ttl_ms: Option<u32>,
    },
    /// Cancel a lease immediately. `None` resolves the bound body at apply time.
    CancelLease { body_id: Option<u64> },
    /// Create a shaped body and bind it to an aigent (narrow demo/test path).
    CreateAndBindDemoBody {
        aigent_id: Vec<u8>,
        position: PositionRequest,
        shape: ShapeSlot,
    },
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
    /// Bind an aigent identity to an existing body for transport/demo paths.
    BindAigentBody { aigent_id: Vec<u8>, body_id: u64 },
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
    Movement(MovementError),
    Heightfield(String),
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
            Self::Movement(error) => write!(f, "movement error: {error}"),
            Self::Heightfield(error) => write!(f, "heightfield error: {error}"),
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

impl From<MovementError> for WorldError {
    fn from(value: MovementError) -> Self {
        Self::Movement(value)
    }
}

/// Authoritative fixed-tick simulation skeleton.
#[derive(Debug)]
pub struct World {
    seed: [u8; 32],
    clock: TickClock,
    leases: LeaseTable,
    entities: EntityStore,
    /// Demo/transport binding from aigent identity to body entity ID.
    aigent_bodies: BTreeMap<Vec<u8>, u64>,
    heightfield: Heightfield,
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
    aigent_bodies: BTreeMap<Vec<u8>, u64>,
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
        let heightfield = Heightfield::new(config.world_seed, DEFAULT_HEIGHTFIELD_CELL_SIZE_MM)
            .unwrap_or_else(|_| {
                Heightfield::new(config.world_seed, DEFAULT_HEIGHTFIELD_CELL_SIZE_MM)
                    .expect("default heightfield cell size is valid")
            });
        Self {
            seed: config.world_seed,
            clock: TickClock::new(),
            leases: LeaseTable::new(lease_ttl),
            entities: EntityStore::new(),
            aigent_bodies: BTreeMap::new(),
            heightfield,
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

    #[must_use]
    pub fn heightfield(&self) -> &Heightfield {
        &self.heightfield
    }

    /// Authoritative entity table. Mutations reach it only through an accepted
    /// command in a durably committed tick.
    #[must_use]
    pub fn entities(&self) -> &EntityStore {
        &self.entities
    }

    #[must_use]
    pub fn leases(&self) -> &LeaseTable {
        &self.leases
    }

    /// Resolve the body bound to an aigent identity, if any.
    #[must_use]
    pub fn body_for_aigent(&self, aigent_id: &[u8]) -> Option<u64> {
        self.aigent_bodies.get(aigent_id).copied()
    }

    /// Whether an aigent already owns or has a queued/in-flight demo body.
    #[must_use]
    pub(crate) fn has_body_or_pending_spawn(&self, aigent_id: &[u8]) -> bool {
        self.aigent_bodies.contains_key(aigent_id)
            || self
                .tentative
                .as_ref()
                .is_some_and(|tick| tick.aigent_bodies.contains_key(aigent_id))
            || self
                .demo_spawn_commands()
                .any(|command_aigent| command_aigent == aigent_id)
    }

    /// Reserve the first deterministic non-overlapping listen/demo grid slot.
    #[must_use]
    pub(crate) fn next_demo_spawn_position(&self, shape: &ShapeSlot) -> Option<PositionRequest> {
        let mut occupied = self.entities.snapshots();
        let mut occupied_body_ids: BTreeSet<u64> = self.aigent_bodies.values().copied().collect();
        if let Some(tick) = &self.tentative {
            occupied.extend(tick.entities.snapshots());
            occupied_body_ids.extend(tick.aigent_bodies.values().copied());
        }
        let mut synthetic_id = u64::MAX;
        for (position, queued_shape) in self.demo_spawn_entries() {
            let Ok(tree) = ShapeTree::decode(queued_shape.as_bytes()) else {
                continue;
            };
            let Ok(grounded) = ground_horizontal(
                &self.heightfield,
                &tree,
                position.x * 1_000.0,
                position.z * 1_000.0,
                position.y * 1_000.0,
            ) else {
                continue;
            };
            while occupied.contains_key(&synthetic_id) {
                synthetic_id = synthetic_id.saturating_sub(1);
            }
            occupied.insert(
                synthetic_id,
                EntitySnapshot {
                    entity_id: synthetic_id,
                    revision: 1,
                    position: grounded,
                    shape: Some(queued_shape.clone()),
                },
            );
            occupied_body_ids.insert(synthetic_id);
            synthetic_id = synthetic_id.saturating_sub(1);
        }
        let parameters = &self.rulesets.live().parameters;
        let draft = DraftCollisionView::rebuild(
            &occupied,
            parameters,
            &occupied_body_ids,
            &BTreeSet::new(),
        )
        .ok()?;
        let tree = ShapeTree::decode(shape.as_bytes()).ok()?;

        // Bound this demo-only search so a saturated local grid fails closed
        // instead of stalling the listen path.
        (0..4_096usize).find_map(|slot| {
            let x = (slot % 200) as f64 * 2.0;
            let z = (slot / 200) as f64 * 2.0;
            let grounded =
                ground_horizontal(&self.heightfield, &tree, x * 1_000.0, z * 1_000.0, 1_000.0)
                    .ok()?;
            let candidate = EntitySnapshot {
                entity_id: u64::MAX,
                revision: 1,
                position: grounded,
                shape: Some(shape.clone()),
            };
            let (_, collider) = collider_at(&candidate, parameters).ok()?;
            (!draft.overlaps(&collider)).then(|| grounded.into())
        })
    }

    fn demo_spawn_commands(&self) -> impl Iterator<Item = &[u8]> {
        self.pending
            .iter()
            .chain(
                self.tentative
                    .iter()
                    .flat_map(|tick| tick.restored_pending.iter()),
            )
            .chain(
                self.tentative
                    .iter()
                    .flat_map(|tick| tick.remaining_pending.iter()),
            )
            .filter_map(|command| match &command.effect {
                CommandEffect::CreateAndBindDemoBody { aigent_id, .. } => {
                    Some(aigent_id.as_slice())
                }
                _ => None,
            })
    }

    fn demo_spawn_entries(&self) -> impl Iterator<Item = (&PositionRequest, &ShapeSlot)> {
        self.pending
            .iter()
            .chain(
                self.tentative
                    .iter()
                    .flat_map(|tick| tick.restored_pending.iter()),
            )
            .chain(
                self.tentative
                    .iter()
                    .flat_map(|tick| tick.remaining_pending.iter()),
            )
            .filter_map(|command| match &command.effect {
                CommandEffect::CreateAndBindDemoBody {
                    position, shape, ..
                } => Some((position, shape)),
                _ => None,
            })
    }

    /// Test/demo helper: bind without waiting for a tick (does not persist alone).
    /// Prefer [`CommandEffect::BindAigentBody`] inside a committed tick.
    pub fn bind_aigent_body_for_test(&mut self, aigent_id: Vec<u8>, body_id: u64) {
        self.aigent_bodies.insert(aigent_id, body_id);
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
            world.aigent_bodies = last.aigent_bodies;
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
        let mut entities = self.entities.clone();
        let mut aigent_bodies = self.aigent_bodies.clone();
        let mut world_value = self.world_value;
        let mut rulesets = self.rulesets.clone();
        let keys: Vec<CommandKey> = due.iter().map(QueuedCommand::key).collect();
        let order = canonical_command_order(&keys);

        let mut applied = Vec::new();
        let mut rng_draws = Vec::new();
        let mut lease_terminations: Vec<LeaseTermination> = Vec::new();
        let mut executed_move_bodies = BTreeSet::new();
        let mut movement_state = None;
        for (canonical_index, &index) in order.iter().enumerate() {
            let command = &due[index];
            let summary = match apply_effect(
                ApplyContext {
                    seed: &self.seed,
                    heightfield: &self.heightfield,
                    tick,
                    canonical_index: canonical_index as u32,
                },
                command,
                &mut leases,
                &mut entities,
                &mut aigent_bodies,
                &mut world_value,
                &mut lease_terminations,
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
            let mut summary_text = summary.0;
            if let CommandEffect::UpsertMoveLease { body_id, .. } = &command.effect {
                if let Some(resolved) = body_id
                    .as_ref()
                    .copied()
                    .or_else(|| aigent_bodies.get(&command.aigent_id).copied())
                {
                    if !executed_move_bodies.contains(&resolved)
                        && leases.get(resolved).is_some_and(|lease| {
                            lease.sequence == command.sequence
                                && lease.aigent_id == command.aigent_id
                        })
                    {
                        let selected = BTreeSet::from([resolved]);
                        let movement = match execute_active_leases(
                            LeaseExecutionContext {
                                heightfield: &self.heightfield,
                                aigent_bodies: &aigent_bodies,
                                parameters: rulesets.live().parameters.clone(),
                                selected_body_ids: &selected,
                            },
                            &mut leases,
                            &mut entities,
                            &mut lease_terminations,
                            &mut movement_state,
                        ) {
                            Ok(movement) => movement,
                            Err(error) => {
                                restore_pending(self, due, remaining);
                                return Err(error);
                            }
                        };
                        if let Some(detail) = movement.get(&resolved) {
                            summary_text.push(':');
                            summary_text.push_str(detail);
                        }
                        executed_move_bodies.insert(resolved);
                    }
                }
            }
            applied.push(AppliedCommand {
                arrival_tick: command.arrival_tick,
                aigent_id: command.aigent_id.clone(),
                sequence: command.sequence,
                canonical_index: canonical_index as u32,
                summary: summary_text,
            });
        }

        // Leases not renewed by a command continue once in ascending body ID.
        let continuing: BTreeSet<u64> = leases
            .iter_snapshots()
            .map(|lease| lease.body_id)
            .filter(|body_id| !executed_move_bodies.contains(body_id))
            .collect();
        if let Err(error) = execute_active_leases(
            LeaseExecutionContext {
                heightfield: &self.heightfield,
                aigent_bodies: &aigent_bodies,
                parameters: rulesets.live().parameters.clone(),
                selected_body_ids: &continuing,
            },
            &mut leases,
            &mut entities,
            &mut lease_terminations,
            &mut movement_state,
        ) {
            restore_pending(self, due, remaining);
            return Err(error);
        }

        let expired = leases.expire_due(tick);
        let expired_leases: Vec<u64> = expired.iter().map(|term| term.body_id).collect();
        lease_terminations.extend(expired);

        if rulesets.try_activate_at_boundary(tick, self.soak_ok) {
            leases.set_default_ttl_ms(rulesets.live().parameters.lease_ttl_ms());
            let max_speed = rulesets.live().parameters.max_speed_mm_per_s();
            lease_terminations.extend(leases.revalidate_for_ruleset(max_speed));
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
            aigent_bodies: aigent_bodies.clone(),
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
            aigent_bodies: aigent_bodies.clone(),
            applied_commands: applied,
            expired_leases,
            lease_terminations,
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
                        aigent_bodies,
                        world_value,
                        rulesets,
                        generation,
                        restored_pending: due,
                        remaining_pending: remaining,
                    });
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
                        aigent_bodies,
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
        self.aigent_bodies = tentative.aigent_bodies;
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

struct MovementExecutionState {
    entity_snapshots: BTreeMap<u64, crate::entity::EntitySnapshot>,
    draft: DraftCollisionView,
    active_body_ids: BTreeSet<u64>,
    bound_body_ids: BTreeSet<u64>,
}

impl MovementExecutionState {
    fn new(
        entities: &EntityStore,
        leases: &LeaseTable,
        aigent_bodies: &BTreeMap<Vec<u8>, u64>,
        parameters: &RulesetParameters,
    ) -> Result<Self, MovementError> {
        let entity_snapshots = entities.snapshots();
        let active_body_ids = active_shaped_body_ids(leases, &entity_snapshots);
        let bound_body_ids = aigent_bodies.values().copied().collect();
        let draft = DraftCollisionView::rebuild(
            &entity_snapshots,
            parameters,
            &active_body_ids,
            &bound_body_ids,
        )?;
        Ok(Self {
            entity_snapshots,
            draft,
            active_body_ids,
            bound_body_ids,
        })
    }

    fn sync(
        &mut self,
        entities: &EntityStore,
        leases: &LeaseTable,
        aigent_bodies: &BTreeMap<Vec<u8>, u64>,
        parameters: &RulesetParameters,
    ) -> Result<(), MovementError> {
        let current = entities.snapshots();
        let active_body_ids = active_shaped_body_ids(leases, &current);
        let bound_body_ids: BTreeSet<u64> = aigent_bodies.values().copied().collect();

        for removed in self
            .entity_snapshots
            .keys()
            .filter(|entity_id| !current.contains_key(entity_id))
        {
            self.draft.remove(*removed);
        }
        for (entity_id, entity) in &current {
            let active = active_body_ids.contains(entity_id);
            let bound = bound_body_ids.contains(entity_id);
            let changed = self.entity_snapshots.get(entity_id) != Some(entity)
                || self.active_body_ids.contains(entity_id) != active
                || self.bound_body_ids.contains(entity_id) != bound;
            if changed {
                self.draft.sync_entity(entity, parameters, active, bound)?;
            }
        }
        self.entity_snapshots = current;
        self.active_body_ids = active_body_ids;
        self.bound_body_ids = bound_body_ids;
        Ok(())
    }
}

fn active_shaped_body_ids(
    leases: &LeaseTable,
    entities: &BTreeMap<u64, crate::entity::EntitySnapshot>,
) -> BTreeSet<u64> {
    leases
        .iter_snapshots()
        .filter(|lease| {
            entities
                .get(&lease.body_id)
                .is_some_and(|entity| entity.shape.is_some())
        })
        .map(|lease| lease.body_id)
        .collect()
}

struct LeaseExecutionContext<'a> {
    heightfield: &'a Heightfield,
    aigent_bodies: &'a BTreeMap<Vec<u8>, u64>,
    parameters: RulesetParameters,
    selected_body_ids: &'a BTreeSet<u64>,
}

fn execute_active_leases(
    context: LeaseExecutionContext<'_>,
    leases: &mut LeaseTable,
    entities: &mut EntityStore,
    lease_terminations: &mut Vec<LeaseTermination>,
    movement_state: &mut Option<MovementExecutionState>,
) -> Result<BTreeMap<u64, String>, WorldError> {
    let blocked_limit = context.parameters.blocked_lease_ticks();
    let all_snapshots: Vec<_> = leases.iter_snapshots().collect();
    let snapshots: Vec<_> = all_snapshots
        .iter()
        .filter(|lease| context.selected_body_ids.contains(&lease.body_id))
        .cloned()
        .collect();
    if movement_state.is_none() {
        *movement_state = Some(MovementExecutionState::new(
            entities,
            leases,
            context.aigent_bodies,
            &context.parameters,
        )?);
    }
    let state = movement_state.as_mut().expect("initialized");
    state.sync(entities, leases, context.aigent_bodies, &context.parameters)?;
    if state.active_body_ids.is_empty() {
        return Ok(BTreeMap::new());
    }
    let mut summaries = BTreeMap::new();

    for lease in snapshots {
        // Skip leases cancelled earlier this tick.
        if leases.get(lease.body_id).is_none() {
            continue;
        }
        if entities
            .get(lease.body_id)
            .is_none_or(|entity| entity.shape.is_none())
        {
            continue;
        }
        let intent = LeaseTable::intent_of(&lease);
        let result = step_move_toward(
            context.heightfield,
            &state.entity_snapshots,
            &state.draft,
            &context.parameters,
            lease.body_id,
            intent,
        )?;
        match result {
            MoveStepResult::ZeroLengthNoOp => {
                leases.record_progress(lease.body_id, true);
                summaries.insert(lease.body_id, "move=noop".to_string());
            }
            MoveStepResult::Moved {
                position,
                reached_target,
                blocked_contact,
            } => {
                let outcome = match entities.set_position(
                    lease.body_id,
                    PositionRequest::new(position.x(), position.y(), position.z()),
                ) {
                    Ok(outcome) => outcome,
                    Err(EntityError::RevisionExhausted { .. }) => {
                        if let Some(term) = leases.terminate_invalidated(lease.body_id) {
                            lease_terminations.push(term);
                        }
                        summaries.insert(
                            lease.body_id,
                            "move=invalidated:reason=revision_exhausted".to_string(),
                        );
                        continue;
                    }
                    Err(error) => return Err(error.into()),
                };
                let updated = entities
                    .get(lease.body_id)
                    .expect("moved entity remains present")
                    .clone();
                let (_, collider) = crate::movement::collider_at(&updated, &context.parameters)?;
                state.entity_snapshots.insert(lease.body_id, updated);
                state.draft.insert(lease.body_id, collider);
                leases.record_progress(lease.body_id, true);
                if reached_target {
                    // Natural completion: drop the lease without a typed
                    // failure termination.
                    let _ = leases.cancel(lease.body_id);
                    state.draft.remove(lease.body_id);
                }
                let contact = blocked_contact
                    .map(|b| format!(":contact={}", stable_blocker(b)))
                    .unwrap_or_default();
                summaries.insert(
                    lease.body_id,
                    format!(
                        "move=moved:rev={}{contact}:reached={reached_target}",
                        outcome.revision(),
                    ),
                );
            }
            MoveStepResult::NoProgress { blocker } => {
                leases.record_progress(lease.body_id, false);
                let current = leases.get(lease.body_id).expect("lease present");
                if current.consecutive_no_progress_ticks >= blocked_limit {
                    let conflicting = match blocker {
                        BlockerKey::Entity { entity_id } => Some(entity_id),
                        BlockerKey::Terrain { .. } => None,
                    };
                    if let Some(term) = leases.terminate_blocked(lease.body_id, conflicting) {
                        lease_terminations.push(term);
                    }
                    summaries.insert(
                        lease.body_id,
                        format!(
                            "move=blocked:reason=threshold:blocker={}",
                            stable_blocker(blocker)
                        ),
                    );
                } else {
                    summaries.insert(
                        lease.body_id,
                        format!("move=no_progress:blocker={}", stable_blocker(blocker)),
                    );
                }
            }
            MoveStepResult::IllegalOverlap { blocker } => {
                // Fail closed: cancel the lease with a typed blocked outcome
                // rather than tunnelling or partially applying.
                let conflicting = match blocker {
                    BlockerKey::Entity { entity_id } => Some(entity_id),
                    BlockerKey::Terrain { .. } => None,
                };
                if let Some(term) = leases.terminate_blocked(lease.body_id, conflicting) {
                    lease_terminations.push(term);
                }
                summaries.insert(
                    lease.body_id,
                    format!(
                        "move=blocked:reason=illegal_overlap:blocker={}",
                        stable_blocker(blocker)
                    ),
                );
            }
        }
    }
    Ok(summaries)
}

fn stable_blocker(blocker: BlockerKey) -> String {
    match blocker {
        BlockerKey::Entity { entity_id } => format!("entity/{entity_id}"),
        BlockerKey::Terrain { cell_x, cell_z } => format!("terrain/{cell_x},{cell_z}"),
    }
}

struct ApplyContext<'a> {
    seed: &'a [u8; 32],
    heightfield: &'a Heightfield,
    tick: u64,
    canonical_index: u32,
}

/// Apply one canonically ordered command to the draft tick state.
fn apply_effect(
    context: ApplyContext<'_>,
    command: &QueuedCommand,
    leases: &mut LeaseTable,
    entities: &mut EntityStore,
    aigent_bodies: &mut BTreeMap<Vec<u8>, u64>,
    world_value: &mut i64,
    lease_terminations: &mut Vec<LeaseTermination>,
) -> Result<(String, Option<crate::rng::DrawResult>), WorldError> {
    match &command.effect {
        CommandEffect::UpsertLease { body_id, ttl_ms } => {
            let applied = leases.upsert_move(
                *body_id,
                command.aigent_id.clone(),
                command.sequence,
                context.tick,
                MoveIntent {
                    target_x_mm: 0,
                    target_z_mm: 0,
                    speed_mm_per_s: 1,
                },
                *ttl_ms,
            );
            Ok((
                format!("upsert_lease:body={body_id}:applied={applied}"),
                None,
            ))
        }
        CommandEffect::UpsertMoveLease {
            body_id,
            intent,
            ttl_ms,
        } => {
            let resolved = body_id.or_else(|| aigent_bodies.get(&command.aigent_id).copied());
            let Some(body_id) = resolved else {
                return Ok(("upsert_move_lease:rejected=unbound_aigent".into(), None));
            };
            if entities.get(body_id).is_none() {
                return Ok((
                    format!("upsert_move_lease:body={body_id}:rejected=unknown_entity"),
                    None,
                ));
            }
            if entities
                .get(body_id)
                .is_some_and(|entity| entity.shape.is_none())
            {
                return Ok((
                    format!("upsert_move_lease:body={body_id}:rejected=missing_shape"),
                    None,
                ));
            }
            let applied = leases.upsert_move(
                body_id,
                command.aigent_id.clone(),
                command.sequence,
                context.tick,
                *intent,
                *ttl_ms,
            );
            Ok((
                format!(
                    "upsert_move_lease:body={body_id}:applied={applied}:seq={}:tx={}:tz={}:speed={}",
                    command.sequence,
                    intent.target_x_mm,
                    intent.target_z_mm,
                    intent.speed_mm_per_s
                ),
                None,
            ))
        }
        CommandEffect::CancelLease { body_id } => {
            let resolved = body_id.or_else(|| aigent_bodies.get(&command.aigent_id).copied());
            let Some(body_id) = resolved else {
                return Ok(("cancel_lease:removed=false:unbound".into(), None));
            };
            let removed = if let Some(existing) = leases.get(body_id) {
                let aigent_id = existing.aigent_id.clone();
                let removed = leases.cancel(body_id);
                if removed {
                    lease_terminations.push(LeaseTermination {
                        body_id,
                        aigent_id,
                        reason: LeaseTerminationReason::Cancelled,
                        conflicting_entity_id: None,
                    });
                }
                removed
            } else {
                false
            };
            Ok((
                format!("cancel_lease:body={body_id}:removed={removed}"),
                None,
            ))
        }
        CommandEffect::CreateAndBindDemoBody {
            aigent_id,
            position,
            shape,
        } => {
            if let Some(existing) = aigent_bodies.get(aigent_id) {
                return Ok((
                    format!("create_and_bind_demo_body:noop:body={existing}"),
                    None,
                ));
            }
            let tree = match ShapeTree::decode(shape.as_bytes()) {
                Ok(tree) => tree,
                Err(_) => {
                    return Ok((
                        "create_and_bind_demo_body:rejected=shape_decode".into(),
                        None,
                    ));
                }
            };
            let grounded = match crate::movement::ground_horizontal(
                context.heightfield,
                &tree,
                position.x * 1_000.0,
                position.z * 1_000.0,
                position.y * 1_000.0,
            ) {
                Ok(value) => PositionRequest::new(value.x(), value.y(), value.z()),
                Err(_) => {
                    return Ok(("create_and_bind_demo_body:rejected=grounding".into(), None));
                }
            };
            match entities.create(grounded, Some(shape.clone())) {
                Ok(created) => {
                    aigent_bodies.insert(aigent_id.clone(), created.entity_id);
                    Ok((
                        format!(
                            "create_and_bind_demo_body:accepted:id={}:rev={}",
                            created.entity_id, created.revision
                        ),
                        None,
                    ))
                }
                Err(error) => Ok((
                    format!("create_and_bind_demo_body:rejected={}", error.reason()),
                    None,
                )),
            }
        }
        CommandEffect::BindAigentBody { aigent_id, body_id } => {
            if entities.get(*body_id).is_none() {
                return Ok((
                    format!("bind_aigent_body:rejected=unknown_entity:{body_id}"),
                    None,
                ));
            }
            if aigent_bodies
                .iter()
                .any(|(owner, bound)| owner != aigent_id && bound == body_id)
            {
                return Ok((
                    format!("bind_aigent_body:rejected=body_already_bound:{body_id}"),
                    None,
                ));
            }
            aigent_bodies.insert(aigent_id.clone(), *body_id);
            Ok((
                format!(
                    "bind_aigent_body:aigent_len={}:body={body_id}",
                    aigent_id.len()
                ),
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
                scope: DrawScope::Generation(context.tick),
                canonical_command_index: context.canonical_index,
                entity_id: *entity_id,
                draw_index: *draw_index,
            };
            let draw = deterministic_draw_u128(context.seed, &input, *bound)?;
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

#[cfg(test)]
mod tests {
    use super::*;
    use crate::entity::REVISION_EXHAUSTION_THRESHOLD;
    use aigent_protocol::{
        shape_node::Primitive, BoxPrimitive, LocalTransform, Quaternion, ShapeNode,
        Vector3Millimeters,
    };
    use std::time::Duration;

    fn test_box_shape() -> ShapeSlot {
        test_box_shape_with_size(100, 100, 100)
    }

    fn test_box_shape_with_size(size_x_mm: i64, size_y_mm: i64, size_z_mm: i64) -> ShapeSlot {
        ShapeSlot::from_encoded(
            ShapeTree {
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
                        size_x_mm,
                        size_y_mm,
                        size_z_mm,
                    })),
                }],
            }
            .encode_to_vec(),
        )
    }

    #[test]
    fn blocker_summary_format_is_stable_and_explicit() {
        assert_eq!(
            stable_blocker(BlockerKey::Entity { entity_id: 42 }),
            "entity/42"
        );
        assert_eq!(
            stable_blocker(BlockerKey::Terrain {
                cell_x: -3,
                cell_z: 8,
            }),
            "terrain/-3,8"
        );
    }

    #[test]
    fn demo_spawn_slots_include_queued_same_tick_bodies() {
        let mut world = World::new(WorldConfig::default());
        let shape = test_box_shape();
        let first = world.next_demo_spawn_position(&shape).unwrap();
        assert_eq!((first.x, first.z), (0.0, 0.0));
        assert!(first.y.is_finite());
        world
            .enqueue(QueuedCommand {
                arrival_tick: 1,
                aigent_id: b"\0demo-a".to_vec(),
                sequence: 1,
                effect: CommandEffect::CreateAndBindDemoBody {
                    aigent_id: b"demo-a".to_vec(),
                    position: PositionRequest::new(0.0, 1.0, 0.0),
                    shape: shape.clone(),
                },
            })
            .unwrap();
        let second = world.next_demo_spawn_position(&shape).unwrap();
        assert_eq!((second.x, second.z), (2.0, 0.0));
        assert!(second.y.is_finite());
        assert!(world.has_body_or_pending_spawn(b"demo-a"));
    }

    #[test]
    fn in_flight_demo_body_reserves_its_spawn_slot() {
        let path = std::env::temp_dir().join(format!(
            "aigent-place-task-051-spawn-{}.sqlite",
            std::process::id()
        ));
        let _ = std::fs::remove_file(&path);
        let mut world = World::with_journal(
            WorldConfig::default(),
            DurableJournal::async_sqlite(&path).unwrap(),
        );
        world
            .journal_mut()
            .as_async_sqlite_mut()
            .unwrap()
            .inject_delay_next(Duration::from_millis(100));
        world
            .enqueue(QueuedCommand {
                arrival_tick: 1,
                aigent_id: b"\0demo-a".to_vec(),
                sequence: 1,
                effect: CommandEffect::CreateAndBindDemoBody {
                    aigent_id: b"demo-a".to_vec(),
                    position: PositionRequest::new(0.0, 1.0, 0.0),
                    shape: test_box_shape(),
                },
            })
            .unwrap();
        assert!(matches!(
            world.advance_tick_nonblocking().unwrap(),
            TickAdvance::Submitted { .. }
        ));
        assert!(world.has_body_or_pending_spawn(b"demo-a"));
        let second = world.next_demo_spawn_position(&test_box_shape()).unwrap();
        assert_eq!((second.x, second.z), (2.0, 0.0));
        assert!(second.y.is_finite());
        world.wait_durable().unwrap();
        drop(world);
        let _ = std::fs::remove_file(path);
    }

    #[test]
    fn demo_spawn_uses_derived_collider_not_entity_center_spacing() {
        let mut world = World::new(WorldConfig::default());
        let demo_shape = test_box_shape();
        let first = world.next_demo_spawn_position(&demo_shape).unwrap();
        let wide_shape = test_box_shape_with_size(4_000, 4_000, 4_000);
        world
            .entities
            .restore(
                BTreeMap::from([(
                    1,
                    EntitySnapshot {
                        entity_id: 1,
                        revision: 1,
                        position: first.validate().unwrap(),
                        shape: Some(wide_shape),
                    },
                )]),
                2,
            )
            .unwrap();
        let reserved = world.next_demo_spawn_position(&demo_shape).unwrap();
        assert!(reserved.x >= 4.0, "reserved={reserved:?}");
    }

    #[test]
    fn revision_exhaustion_invalidates_only_the_moving_lease() {
        let mut world = World::new(WorldConfig::default());
        world
            .enqueue(QueuedCommand {
                arrival_tick: 1,
                aigent_id: b"\0exhausted".to_vec(),
                sequence: 1,
                effect: CommandEffect::CreateAndBindDemoBody {
                    aigent_id: b"exhausted".to_vec(),
                    position: PositionRequest::new(0.25, 1.0, 0.25),
                    shape: test_box_shape(),
                },
            })
            .unwrap();
        world.advance_tick().unwrap();
        let body = world.body_for_aigent(b"exhausted").unwrap();
        let mut snapshots = world.entities.snapshots();
        snapshots.get_mut(&body).unwrap().revision = REVISION_EXHAUSTION_THRESHOLD;
        let next_entity_id = world.entities.next_entity_id();
        world.entities.restore(snapshots, next_entity_id).unwrap();
        world
            .enqueue(QueuedCommand {
                arrival_tick: 2,
                aigent_id: b"exhausted".to_vec(),
                sequence: 1,
                effect: CommandEffect::UpsertMoveLease {
                    body_id: Some(body),
                    intent: MoveIntent::new(500, 250, 1_000).unwrap(),
                    ttl_ms: Some(10_000),
                },
            })
            .unwrap();
        let generation = world.advance_tick().unwrap().clone();
        assert!(world.leases().get(body).is_none());
        assert!(generation.lease_terminations.iter().any(|termination| {
            termination.body_id == body && termination.reason == LeaseTerminationReason::Invalidated
        }));
    }
}
