//! Fixed-tick world core: order, apply, execute leases, publish generation.

use crate::demo_activity::{DemoActivity, DemoLeaseMotion, DemoPresence};
use crate::entity::{EntityError, EntitySnapshot, EntityStore, PositionRequest, ShapeSlot};
use crate::generation::{AppliedCommand, ImmutableGeneration};
use crate::heightfield::{Heightfield, HeightfieldProfile, DEFAULT_HEIGHTFIELD_CELL_SIZE_MM};
use crate::lease::{LeaseTable, LeaseTermination, LeaseTerminationReason};
use crate::movement::{
    collider_at, ground_horizontal, step_move_toward, BlockerKey, DraftCollisionView, MoveIntent,
    MoveStepResult, MovementError,
};
use crate::order::{canonical_command_order, CommandKey};
use crate::persist::{CommittedGeneration, DurableJournal, InMemoryJournal, JournalError};
use crate::rng::{deterministic_draw_u128, DrawInput, DrawScope, RngError};
use crate::ruleset::{RulesetParameters, RulesetStore, RulesetValidationError};
use crate::shape::{validate_shape_tree, ShapeClass};
use crate::tick::{TickClock, DEFAULT_LEASE_TTL_MS};
use aigent_protocol::ShapeTree;
use prost::Message;
use std::collections::BTreeMap;
use std::collections::BTreeSet;
use std::fmt;

const DEMO_PLAZA_BINDING_CAPACITY: usize = 2;

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
    JournalProfileMismatch {
        world_is_demo_plaza: bool,
        journal_is_demo_plaza: bool,
    },
    DemoBindingCapacityExceeded,
    DuplicateCommandTuple,
    /// A sealed terminal tick has no unstarted successor for new commands.
    TickExhausted,
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
            Self::JournalProfileMismatch {
                world_is_demo_plaza,
                journal_is_demo_plaza,
            } => write!(
                f,
                "world/journal profile mismatch: temporary plaza world={world_is_demo_plaza}, journal={journal_is_demo_plaza}"
            ),
            Self::DemoBindingCapacityExceeded => {
                write!(f, "temporary demo plaza supports two concurrent demo bindings")
            }
            Self::DuplicateCommandTuple => write!(f, "duplicate canonical command tuple"),
            Self::TickExhausted => write!(f, "no unstarted command tick remains"),
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
    demo_activity: Option<DemoActivity>,
    demo_presence: DemoPresence,
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
    demo_activity: Option<DemoActivity>,
    /// Commands removed from `pending` for this tick; restored on writer failure.
    restored_pending: Vec<QueuedCommand>,
    remaining_pending: Vec<QueuedCommand>,
}

impl World {
    /// Fresh ADR-0013 world: fixed optional terrain plus marked memory ownership.
    /// State resets on restart; generic recovery intentionally refuses it.
    #[must_use]
    pub fn ephemeral_demo_plaza(config: WorldConfig) -> Self {
        let heightfield = Heightfield::ephemeral_demo_plaza(config.world_seed);
        let mut world = Self::with_journal(
            config,
            DurableJournal::Memory(InMemoryJournal::ephemeral_demo_plaza()),
        );
        world.heightfield = heightfield;
        world
    }

    /// Optional world-defined cooperative demo, never journal-recovered.
    #[must_use]
    pub fn ephemeral_demo_activity(config: WorldConfig, run_id: [u8; 16]) -> Self {
        let mut world = Self::ephemeral_demo_plaza(config);
        world.demo_activity = Some(DemoActivity::new(run_id));
        world
    }

    /// Private narrow presence input. Transport validates the exact active
    /// command session while holding the hub lock before it calls this seam.
    pub fn attach_demo_participant(
        &mut self,
        owner: Vec<u8>,
        connection_id: Vec<u8>,
        command_epoch: Vec<u8>,
    ) -> bool {
        self.demo_activity.is_some()
            && self.has_body_or_pending_spawn(&owner)
            && self
                .demo_presence
                .attach(owner, connection_id, command_epoch)
    }

    pub fn detach_demo_participant(
        &mut self,
        owner: &[u8],
        connection_id: &[u8],
        command_epoch: &[u8],
    ) -> bool {
        self.demo_activity.is_some()
            && self
                .demo_presence
                .detach(owner, connection_id, command_epoch)
    }

    #[must_use]
    pub fn demo_activity_state(&self) -> Option<&crate::demo_activity::DemoActivityState> {
        self.demo_activity.as_ref().map(|activity| &activity.state)
    }

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
            demo_activity: None,
            demo_presence: DemoPresence::default(),
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

    /// Choose by reserved spawn ordinal, never by identity content. A tentative
    /// binding and the command retained for writer recovery name the same slot.
    #[must_use]
    pub(crate) fn next_demo_body_variant(&self) -> usize {
        self.reserved_demo_identities().len() % 2
    }

    /// Count each binding once across installed, tentative and queued state.
    fn reserved_demo_identities(&self) -> BTreeSet<&[u8]> {
        self.aigent_bodies
            .keys()
            .map(Vec::as_slice)
            .chain(
                self.tentative
                    .iter()
                    .flat_map(|tick| tick.aigent_bodies.keys().map(Vec::as_slice)),
            )
            .chain(self.demo_spawn_commands())
            .collect()
    }

    #[must_use]
    pub(crate) fn demo_binding_capacity_available(&self, aigent_id: &[u8]) -> bool {
        if self.heightfield.profile() != HeightfieldProfile::EphemeralDemoPlazaV1 {
            return true;
        }
        let assigned = self.reserved_demo_identities();
        assigned.contains(aigent_id) || assigned.len() < DEMO_PLAZA_BINDING_CAPACITY
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
                CommandEffect::BindAigentBody { aigent_id, .. }
                    if self.heightfield.profile() == HeightfieldProfile::EphemeralDemoPlazaV1 =>
                {
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
    /// Panics on fixture misuse before mutation; production admission is typed.
    pub fn bind_aigent_body_for_test(&mut self, aigent_id: Vec<u8>, body_id: u64) {
        self.validate_journal_profile()
            .expect("fixture world/journal profiles must match");
        assert!(
            self.demo_binding_capacity_available(&aigent_id),
            "fixture exceeds temporary demo plaza binding capacity"
        );
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
        self.validate_journal_profile()?;
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
        if journal.is_ephemeral_demo_plaza() {
            return Err(WorldError::Persistence(
                JournalError::EphemeralRecoveryUnsupported,
            ));
        }
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

    /// Earliest tick whose input batch has not started. An async tentative
    /// generation has already sealed its commands, even before durable install.
    pub(crate) fn next_command_tick(&self) -> Result<u64, WorldError> {
        self.validate_journal_profile()?;
        match &self.tentative {
            Some(tentative) => tentative
                .generation
                .tick
                .checked_add(1)
                .ok_or(WorldError::TickExhausted),
            None if self
                .published
                .as_ref()
                .is_some_and(|generation| generation.tick == u64::MAX) =>
            {
                Err(WorldError::TickExhausted)
            }
            None => Ok(self.clock.next_tick()),
        }
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
    /// `arrival_tick` must be at least the earliest unstarted tick. A submitted
    /// async generation has already sealed its input batch.
    pub fn enqueue(&mut self, command: QueuedCommand) -> Result<(), WorldError> {
        self.enqueue_batch(vec![command])
    }

    /// Insert a complete local effect batch only after every command passes
    /// tick/key validation. This is queue admission, not durable installation.
    pub(crate) fn enqueue_batch(&mut self, commands: Vec<QueuedCommand>) -> Result<(), WorldError> {
        self.validate_journal_profile()?;
        if commands.is_empty() {
            return Ok(());
        }
        let next_tick = self.next_command_tick()?;
        let mut keys = BTreeSet::new();
        for command in &commands {
            if command.arrival_tick < next_tick {
                return Err(WorldError::StaleArrivalTick {
                    arrival_tick: command.arrival_tick,
                    next_tick,
                });
            }
            let key = command.key();
            let mut pending = self.pending.iter().chain(
                self.tentative
                    .iter()
                    .flat_map(|tick| tick.remaining_pending.iter()),
            );
            if pending.any(|existing| existing.key() == key) || !keys.insert(key) {
                return Err(WorldError::DuplicateCommandTuple);
            }
        }
        if self.heightfield.profile() == HeightfieldProfile::EphemeralDemoPlazaV1 {
            let mut assigned = self.reserved_demo_identities();
            for command in &commands {
                match &command.effect {
                    CommandEffect::CreateAndBindDemoBody { aigent_id, .. }
                    | CommandEffect::BindAigentBody { aigent_id, .. } => {
                        assigned.insert(aigent_id.as_slice());
                    }
                    _ => {}
                }
            }
            if assigned.len() > DEMO_PLAZA_BINDING_CAPACITY {
                return Err(WorldError::DemoBindingCapacityExceeded);
            }
        }
        self.pending.extend(commands);
        Ok(())
    }

    /// Check before draining commands, polling/committing storage or advancing
    /// the clock. `journal_mut` cannot silently reinterpret either profile.
    fn validate_journal_profile(&self) -> Result<(), WorldError> {
        let world_is_demo_plaza =
            self.heightfield.profile() == HeightfieldProfile::EphemeralDemoPlazaV1;
        let journal_is_demo_plaza = self.journal.is_ephemeral_demo_plaza();
        if world_is_demo_plaza != journal_is_demo_plaza {
            return Err(WorldError::JournalProfileMismatch {
                world_is_demo_plaza,
                journal_is_demo_plaza,
            });
        }
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
        self.validate_journal_profile()?;
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
        let mut demo_activity = self.demo_activity.clone();
        let mut demo_motions = BTreeMap::new();
        // Creation must satisfy the ruleset this generation will publish, even
        // when a candidate activates at its end boundary. Preview on a clone
        // so command/movement and actual ruleset activation retain their order.
        let mut demo_application_rulesets = rulesets.clone();
        demo_application_rulesets.try_activate_at_boundary(tick, self.soak_ok);
        let keys: Vec<CommandKey> = due.iter().map(QueuedCommand::key).collect();
        let order = canonical_command_order(&keys);

        let mut applied = Vec::new();
        let mut rng_draws = Vec::new();
        let mut lease_terminations: Vec<LeaseTermination> = Vec::new();
        let mut executed_move_bodies = BTreeSet::new();
        // Newly admitted bodies reserve collision space until their first
        // matched MOVE executes. This set belongs only to this draft tick;
        // established unleased bodies retain their sleeping semantics.
        let mut pending_demo_reservations = BTreeSet::new();
        let mut movement_state = None;
        for (canonical_index, &index) in order.iter().enumerate() {
            let command = &due[index];
            let new_demo_owner = match &command.effect {
                CommandEffect::CreateAndBindDemoBody { aigent_id, .. }
                    if !aigent_bodies.contains_key(aigent_id) =>
                {
                    Some(aigent_id)
                }
                _ => None,
            };
            let summary = match apply_effect(
                ApplyContext {
                    seed: &self.seed,
                    heightfield: &self.heightfield,
                    collision_parameters: &rulesets.live().parameters,
                    demo_shape_parameters: &demo_application_rulesets.live().parameters,
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
            if let Some(body_id) = new_demo_owner.and_then(|owner| aigent_bodies.get(owner)) {
                pending_demo_reservations.insert(*body_id);
            }
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
                        pending_demo_reservations.remove(&resolved);
                        let selected = BTreeSet::from([resolved]);
                        let movement = match execute_active_leases(
                            LeaseExecutionContext {
                                heightfield: &self.heightfield,
                                aigent_bodies: &aigent_bodies,
                                reserved_body_ids: &pending_demo_reservations,
                                parameters: rulesets.live().parameters.clone(),
                                selected_body_ids: &selected,
                            },
                            &mut leases,
                            &mut entities,
                            &mut lease_terminations,
                            &mut movement_state,
                            demo_activity.as_ref().map(|_| &mut demo_motions),
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
                reserved_body_ids: &pending_demo_reservations,
                parameters: rulesets.live().parameters.clone(),
                selected_body_ids: &continuing,
            },
            &mut leases,
            &mut entities,
            &mut lease_terminations,
            &mut movement_state,
            demo_activity.as_ref().map(|_| &mut demo_motions),
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

        let activity_state = demo_activity.as_mut().map(|activity| {
            activity.advance(
                tick,
                &aigent_bodies,
                (&entities.snapshots(), &rulesets.live().parameters),
                &self.demo_presence,
                &demo_motions,
                &lease_terminations,
            )
        });

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
            demo_activity: activity_state,
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
                        demo_activity,
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
                        demo_activity,
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
        self.validate_journal_profile()?;
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
        self.validate_journal_profile()?;
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
        self.demo_activity = tentative.demo_activity;
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
        reserved_body_ids: &BTreeSet<u64>,
        parameters: &RulesetParameters,
    ) -> Result<Self, MovementError> {
        let entity_snapshots = entities.snapshots();
        let mut active_body_ids = active_shaped_body_ids(leases, &entity_snapshots);
        active_body_ids.extend(reserved_body_ids.iter().copied());
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
        reserved_body_ids: &BTreeSet<u64>,
        parameters: &RulesetParameters,
    ) -> Result<(), MovementError> {
        let current = entities.snapshots();
        let mut active_body_ids = active_shaped_body_ids(leases, &current);
        active_body_ids.extend(reserved_body_ids.iter().copied());
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
    reserved_body_ids: &'a BTreeSet<u64>,
    parameters: RulesetParameters,
    selected_body_ids: &'a BTreeSet<u64>,
}

fn execute_active_leases(
    context: LeaseExecutionContext<'_>,
    leases: &mut LeaseTable,
    entities: &mut EntityStore,
    lease_terminations: &mut Vec<LeaseTermination>,
    movement_state: &mut Option<MovementExecutionState>,
    mut demo_motions: Option<&mut BTreeMap<u64, DemoLeaseMotion>>,
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
            context.reserved_body_ids,
            &context.parameters,
        )?);
    }
    let state = movement_state.as_mut().expect("initialized");
    state.sync(
        entities,
        leases,
        context.aigent_bodies,
        context.reserved_body_ids,
        &context.parameters,
    )?;
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
                let before = entities
                    .get(lease.body_id)
                    .expect("lease body exists")
                    .position;
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
                if let Some(motions) = demo_motions.as_deref_mut() {
                    motions.insert(
                        lease.body_id,
                        DemoLeaseMotion {
                            owner: lease.aigent_id.clone(),
                            before,
                            after: updated.position,
                        },
                    );
                }
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
    collision_parameters: &'a RulesetParameters,
    demo_shape_parameters: &'a RulesetParameters,
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
            if let Err(error) =
                validate_shape_tree(&tree, ShapeClass::Body, context.demo_shape_parameters)
            {
                return Ok((
                    format!("create_and_bind_demo_body:rejected=invalid_shape:{error:?}"),
                    None,
                ));
            }
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
            let collision_projection = (|| {
                let translation = crate::collider::WorldPointMm::new(
                    grounded.x * 1_000.0,
                    grounded.y * 1_000.0,
                    grounded.z * 1_000.0,
                )?;
                let candidate = crate::collider::derive_collider(&tree, translation)?;
                let bound_body_ids = aigent_bodies.values().copied().collect();
                // Match queue-time reservation conservatism, using the current
                // collision stage's parameters rather than the budget preview.
                let occupied = DraftCollisionView::rebuild(
                    &entities.snapshots(),
                    context.collision_parameters,
                    &bound_body_ids,
                    &BTreeSet::new(),
                )?;
                Ok::<_, MovementError>((candidate, occupied))
            })();
            match collision_projection {
                Ok((candidate, occupied)) if occupied.overlaps(&candidate) => {
                    return Ok(("create_and_bind_demo_body:rejected=overlap".into(), None));
                }
                Err(error) => {
                    return Ok((
                        format!(
                            "create_and_bind_demo_body:rejected=collision_projection:{error:?}"
                        ),
                        None,
                    ));
                }
                _ => {}
            }
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
#[path = "world/demo_activity_tests.rs"]
mod demo_activity_tests;

#[cfg(test)]
#[path = "world/demo_plaza_tests.rs"]
mod demo_plaza_tests;

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
    fn enqueue_rejects_arrival_when_sealed_tick_has_no_successor() {
        let mut world = World::new(WorldConfig::default());
        let mut generation = world.advance_tick().unwrap().clone();
        // A terminal sealed generation cannot reserve tick zero or MAX again.
        generation.tick = u64::MAX;
        world.tentative = Some(TentativeTick {
            leases: world.leases.clone(),
            entities: world.entities.clone(),
            aigent_bodies: world.aigent_bodies.clone(),
            world_value: world.world_value,
            rulesets: world.rulesets.clone(),
            generation,
            demo_activity: world.demo_activity.clone(),
            restored_pending: Vec::new(),
            remaining_pending: Vec::new(),
        });
        assert!(
            world
                .enqueue(QueuedCommand {
                    arrival_tick: u64::MAX,
                    aigent_id: b"terminal-arrival".to_vec(),
                    sequence: 1,
                    effect: CommandEffect::BumpWorldValue { delta: 1 },
                })
                .is_err(),
            "no eligible tick remains after a sealed MAX tick"
        );
        assert!(
            world.pending.is_empty(),
            "exhausted reservation cannot enqueue an effect"
        );
        // TickClock saturates: a terminal completed generation must remain
        // unavailable after tentative state is installed and removed.
        world.published = Some(world.tentative.take().unwrap().generation);
        assert_eq!(
            world.enqueue(QueuedCommand {
                arrival_tick: u64::MAX,
                aigent_id: b"completed-terminal-arrival".to_vec(),
                sequence: 1,
                effect: CommandEffect::BumpWorldValue { delta: 1 },
            }),
            Err(WorldError::TickExhausted)
        );
        assert!(world.pending.is_empty());
    }

    #[test]
    fn effect_batch_second_collision_leaves_pending_unchanged() {
        let mut world = World::new(WorldConfig::default());
        let original = QueuedCommand {
            arrival_tick: 1,
            aigent_id: b"existing".to_vec(),
            sequence: 1,
            effect: CommandEffect::BumpWorldValue { delta: 9 },
        };
        world.enqueue(original.clone()).unwrap();
        let before = world.pending.clone();
        let first = QueuedCommand {
            arrival_tick: 1,
            aigent_id: b"new".to_vec(),
            sequence: 1,
            effect: CommandEffect::BumpWorldValue { delta: 3 },
        };
        assert_eq!(
            world.enqueue_batch(vec![first, original]),
            Err(WorldError::DuplicateCommandTuple)
        );
        assert_eq!(world.pending, before);
        assert_eq!(world.advance_tick().unwrap().world_value, 9);
    }

    #[test]
    fn effect_batch_internal_duplicate_leaves_pending_unchanged() {
        let mut world = World::new(WorldConfig::default());
        let first = QueuedCommand {
            arrival_tick: 1,
            aigent_id: b"same".to_vec(),
            sequence: 1,
            effect: CommandEffect::BumpWorldValue { delta: 3 },
        };
        let mut second = first.clone();
        second.effect = CommandEffect::BumpWorldValue { delta: 4 };
        assert_eq!(
            world.enqueue_batch(vec![first, second]),
            Err(WorldError::DuplicateCommandTuple)
        );
        assert!(world.pending.is_empty());
        assert_eq!(world.advance_tick().unwrap().world_value, 0);
    }

    async fn assert_terminal_wire_classification(role: aigent_protocol::ConnectionRole) {
        use crate::{
            AuthoritativeResult, ClientHello, CommandOutcome, CommandSubmit, ConnectionRole,
            HandshakeOutcome, IdentityBinding, SessionHub, TransportState,
        };
        use aigent_protocol::{
            command_result, envelope, handshake_frame, Command, CommandKind, CommandMetadata,
            Envelope, HandshakeFrame,
        };
        use futures_util::{SinkExt, StreamExt};
        use sha2::{Digest, Sha256};
        use std::sync::Arc;
        use tokio_tungstenite::tungstenite::Message as WsMessage;
        let mut hub = SessionHub::new_v1();
        let epoch = match hub.handshake(ClientHello {
            role: ConnectionRole::Aigent,
            offered_majors: vec![1],
            offered_features: vec![],
            aigent_id: Some(b"terminal-a".to_vec()),
            connection_id: b"prior".to_vec(),
            identity: IdentityBinding::TestTrustedInject {
                aigent_id: b"terminal-a".to_vec(),
            },
        }) {
            HandshakeOutcome::Accepted {
                session_epoch: Some(epoch),
                ..
            } => epoch,
            other => panic!("{other:?}"),
        };
        assert!(matches!(
            hub.submit_command(CommandSubmit {
                connection_id: b"prior".to_vec(),
                protocol_major: 1,
                message_id: 1,
                session_epoch: epoch,
                sequence: 1,
                idempotency_key: b"cached-stop".to_vec(),
                kind: CommandKind::Stop,
                content_digest: Sha256::digest([]).to_vec(),
                payload_bytes: vec![],
                required_features: vec![],
            }),
            CommandOutcome::Result {
                result: AuthoritativeResult::Accepted { .. },
                ..
            }
        ));
        let mut world = World::new(WorldConfig::default());
        let mut generation = world.advance_tick().unwrap().clone();
        generation.tick = u64::MAX;
        world.published = Some(generation);
        let state = TransportState::new_with_world(hub, false, world);
        let (addr, server) = crate::serve_ephemeral(Arc::clone(&state)).await.unwrap();
        let server_task = tokio::spawn(async move {
            let _ = server.await;
        });
        let (mut ws, _) = tokio_tungstenite::connect_async(format!("ws://{addr}/ws"))
            .await
            .unwrap();
        ws.send(WsMessage::Binary(
            HandshakeFrame {
                body: Some(handshake_frame::Body::ClientHello(
                    aigent_protocol::ClientHello {
                        role: role as i32,
                        offered_protocol_majors: vec![1],
                        offered_features: vec![],
                        aigent_id: if role == aigent_protocol::ConnectionRole::Aigent {
                            b"terminal-a".to_vec()
                        } else {
                            vec![]
                        },
                    },
                )),
            }
            .encode_to_vec()
            .into(),
        ))
        .await
        .unwrap();
        let WsMessage::Binary(bytes) = ws.next().await.unwrap().unwrap() else {
            panic!("hello must succeed");
        };
        let Some(handshake_frame::Body::ServerHello(hello)) =
            HandshakeFrame::decode(bytes.as_ref()).unwrap().body
        else {
            panic!("expected ServerHello");
        };
        ws.send(WsMessage::Binary(
            Envelope {
                protocol_major: 1,
                connection_id: hello.connection_id.clone(),
                message_id: 1,
                metadata: Some(aigent_protocol::EnvelopeMetadata {
                    required_features: vec![],
                }),
                body: Some(envelope::Body::Command(Command {
                    metadata: Some(CommandMetadata {
                        session_epoch: hello.session_epoch.clone(),
                        sequence: 1,
                        idempotency_key: b"cached-stop".to_vec(),
                    }),
                    kind: CommandKind::Stop as i32,
                    payload: vec![],
                })),
            }
            .encode_to_vec()
            .into(),
        ))
        .await
        .unwrap();
        let response = tokio::time::timeout(Duration::from_secs(1), ws.next())
            .await
            .unwrap()
            .unwrap()
            .unwrap();
        let WsMessage::Binary(bytes) = response else {
            panic!("terminal state must retain role/replay classification: {response:?}");
        };
        let envelope = Envelope::decode(bytes.as_ref()).unwrap();
        let Some(envelope::Body::CommandResult(result)) = envelope.body else {
            panic!("must be role/replay result rather than storage error");
        };
        if role == aigent_protocol::ConnectionRole::Viewer {
            assert!(
                matches!(result.outcome, Some(command_result::Outcome::Rejected(ref rejection)) if rejection.code == aigent_protocol::CommandRejectionCode::SpectateOnly as i32)
            );
        } else {
            assert!(
                matches!(result.outcome, Some(command_result::Outcome::Accepted(_))),
                "cached command must replay at terminal world"
            );
            ws.send(WsMessage::Binary(
                Envelope {
                    protocol_major: 1,
                    connection_id: hello.connection_id.clone(),
                    message_id: 2,
                    metadata: Some(aigent_protocol::EnvelopeMetadata {
                        required_features: vec![],
                    }),
                    body: Some(envelope::Body::Command(Command {
                        metadata: Some(CommandMetadata {
                            session_epoch: hello.session_epoch.clone(),
                            sequence: 2,
                            idempotency_key: b"fatal-stop".to_vec(),
                        }),
                        kind: CommandKind::Stop as i32,
                        payload: vec![],
                    })),
                }
                .encode_to_vec()
                .into(),
            ))
            .await
            .unwrap();
            let closed = tokio::time::timeout(Duration::from_secs(1), ws.next())
                .await
                .unwrap()
                .transpose()
                .unwrap();
            assert!(
                closed.is_none() || matches!(closed, Some(WsMessage::Close(_))),
                "terminal novel mutation closes without publishing a storage error: {closed:?}"
            );
            assert!(state.stamped_arrivals.lock().await.is_empty());
            // Restore an admissible test state. Fatal admission must not have
            // consumed sequence or inserted its key into either result cache.
            state.world.lock().await.published = None;
            let retried = state.sessions.lock().await.submit_command(CommandSubmit {
                connection_id: hello.connection_id.clone(),
                protocol_major: 1,
                message_id: 3,
                session_epoch: hello.session_epoch.clone(),
                sequence: 2,
                idempotency_key: b"fatal-stop".to_vec(),
                kind: CommandKind::Stop,
                content_digest: Sha256::digest([]).to_vec(),
                payload_bytes: vec![],
                required_features: vec![],
            });
            assert!(
                matches!(
                    retried,
                    CommandOutcome::Result {
                        result: AuthoritativeResult::Accepted { .. },
                        replayed: false,
                        ..
                    }
                ),
                "fatal admission must leave the same sequence/key novel and retryable: {retried:?}"
            );
        }
        drop(ws);
        server_task.abort();
        let _ = server_task.await;
    }

    #[tokio::test]
    async fn terminal_world_preserves_spectate_only_wire_rejection() {
        assert_terminal_wire_classification(aigent_protocol::ConnectionRole::Viewer).await;
    }

    #[tokio::test]
    async fn terminal_world_preserves_cached_cross_epoch_wire_replay() {
        assert_terminal_wire_classification(aigent_protocol::ConnectionRole::Aigent).await;
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
    fn demo_variant_counts_committed_tentative_and_pending_assignments_once() {
        let path = std::env::temp_dir().join(format!(
            "aigent-place-task-068-ordinal-{}.sqlite",
            std::process::id()
        ));
        let _ = std::fs::remove_file(&path);
        let mut world = World::with_journal(
            WorldConfig::default(),
            DurableJournal::async_sqlite(&path).unwrap(),
        );
        let spawn = |id: &[u8], tick, sequence, x| QueuedCommand {
            arrival_tick: tick,
            aigent_id: id.to_vec(),
            sequence,
            effect: CommandEffect::CreateAndBindDemoBody {
                aigent_id: id.to_vec(),
                position: PositionRequest::new(x, 1.0, 0.0),
                shape: test_box_shape(),
            },
        };
        assert_eq!(world.next_demo_body_variant(), 0);
        world.enqueue(spawn(b"committed", 1, 1, 0.0)).unwrap();
        world.advance_tick().unwrap();
        assert_eq!(world.next_demo_body_variant(), 1);
        world.enqueue(spawn(b"tentative", 2, 1, 2.0)).unwrap();
        world.enqueue(spawn(b"future", 4, 1, 4.0)).unwrap();
        assert_eq!(world.next_demo_body_variant(), 1);
        assert!(matches!(
            world.advance_tick_nonblocking().unwrap(),
            TickAdvance::Submitted { .. }
        ));
        // committed is present in both maps, tentative in the draft binding and
        // restored commands, future in remaining_pending: three assigned slots.
        assert_eq!(world.next_demo_body_variant(), 1);
        world.enqueue(spawn(b"future", 4, 2, 4.0)).unwrap();
        assert_eq!(world.next_demo_body_variant(), 1);
        world.enqueue(spawn(b"fourth", 4, 1, 6.0)).unwrap();
        assert_eq!(world.next_demo_body_variant(), 0);
        world.wait_durable().unwrap();
        assert_eq!(world.next_demo_body_variant(), 0);
        world.advance_ticks(2).unwrap();
        assert_eq!(world.aigent_bodies.len(), 4);
        assert_eq!(world.entities.next_entity_id(), 5);
        assert_eq!(world.next_demo_body_variant(), 0);
        drop(world);
        let _ = std::fs::remove_file(path);
    }

    #[test]
    fn demo_variant_includes_tentative_bindings_without_spawn_commands() {
        let path = std::env::temp_dir().join(format!(
            "aigent-place-task-068-binding-ordinal-{}.sqlite",
            std::process::id()
        ));
        let _ = std::fs::remove_file(&path);
        let mut world = World::with_journal(
            WorldConfig::default(),
            DurableJournal::async_sqlite(&path).unwrap(),
        );
        world
            .enqueue(QueuedCommand {
                arrival_tick: 1,
                aigent_id: b"creator".to_vec(),
                sequence: 1,
                effect: CommandEffect::CreateEntity {
                    position: PositionRequest::new(0.0, 1.0, 0.0),
                    shape: Some(test_box_shape()),
                },
            })
            .unwrap();
        world.advance_tick().unwrap();
        assert_eq!(
            world.next_demo_body_variant(),
            0,
            "unbound objects do not consume a body slot"
        );
        world
            .enqueue(QueuedCommand {
                arrival_tick: 2,
                aigent_id: b"binder".to_vec(),
                sequence: 1,
                effect: CommandEffect::BindAigentBody {
                    aigent_id: b"new-binding".to_vec(),
                    body_id: 1,
                },
            })
            .unwrap();
        assert_eq!(world.next_demo_body_variant(), 0);
        assert!(matches!(
            world.advance_tick_nonblocking().unwrap(),
            TickAdvance::Submitted { .. }
        ));
        assert_eq!(
            world.next_demo_body_variant(),
            1,
            "tentative bound body counts before writer installation"
        );
        world.wait_durable().unwrap();
        assert_eq!(world.next_demo_body_variant(), 1);
        drop(world);
        let _ = std::fs::remove_file(path);
    }

    fn spawn_review_world(existing_owner: &[u8]) -> (World, u64, ShapeSlot) {
        let mut world = World::new(WorldConfig::default());
        let mut rounded = ShapeTree::decode(test_box_shape().as_bytes()).unwrap();
        rounded.nodes[0].primitive = Some(Primitive::Capsule(aigent_protocol::CapsulePrimitive {
            radius_mm: 350,
            segment_length_mm: 1100,
        }));
        let mut sphere = rounded.nodes[0].clone();
        sphere.node_id = 2;
        sphere.parent_node_id = 1;
        sphere.primitive = Some(Primitive::Sphere(aigent_protocol::SpherePrimitive {
            radius_mm: 500,
        }));
        rounded.nodes.push(sphere);
        let mut pointed = rounded.clone();
        pointed.nodes[0].primitive =
            Some(Primitive::Cylinder(aigent_protocol::CylinderPrimitive {
                radius_mm: 500,
                height_mm: 1400,
            }));
        pointed.nodes[0]
            .transform
            .as_mut()
            .unwrap()
            .translation
            .as_mut()
            .unwrap()
            .y_mm = -200;
        pointed.nodes[1].primitive = Some(Primitive::Cone(aigent_protocol::ConePrimitive {
            radius_mm: 500,
            height_mm: 400,
        }));
        pointed.nodes[1]
            .transform
            .as_mut()
            .unwrap()
            .translation
            .as_mut()
            .unwrap()
            .y_mm = 900;
        let rounded = ShapeSlot::from_encoded(rounded.encode_to_vec());
        let pointed = ShapeSlot::from_encoded(pointed.encode_to_vec());
        let first_slot = world.next_demo_spawn_position(&rounded).unwrap();
        let mut existing_controller = vec![0];
        existing_controller.extend_from_slice(existing_owner);
        world
            .enqueue(QueuedCommand {
                arrival_tick: world.next_tick(),
                aigent_id: existing_controller,
                sequence: 1,
                effect: CommandEffect::CreateAndBindDemoBody {
                    aigent_id: existing_owner.to_vec(),
                    position: first_slot,
                    shape: rounded,
                },
            })
            .unwrap();
        world.advance_tick().unwrap();
        let existing_body = world.body_for_aigent(existing_owner).unwrap();
        world
            .enqueue(QueuedCommand {
                arrival_tick: world.next_tick(),
                aigent_id: existing_owner.to_vec(),
                sequence: 1,
                effect: CommandEffect::UpsertMoveLease {
                    body_id: None,
                    intent: MoveIntent::new(1000, 0, 500).unwrap(),
                    ttl_ms: None,
                },
            })
            .unwrap();
        world.advance_ticks(40).unwrap();
        assert_eq!(world.entities.get(existing_body).unwrap().position.x(), 1.0);
        (world, existing_body, pointed)
    }

    fn queue_review_move(world: &mut World, owner: &[u8]) {
        world
            .enqueue(QueuedCommand {
                arrival_tick: world.next_tick(),
                aigent_id: owner.to_vec(),
                sequence: 2,
                effect: CommandEffect::UpsertMoveLease {
                    body_id: None,
                    intent: MoveIntent::new(0, 0, 500).unwrap(),
                    ttl_ms: None,
                },
            })
            .unwrap();
    }

    fn queue_review_newcomer(world: &mut World, shape: ShapeSlot, initial_move: bool) {
        let reserved = world.next_demo_spawn_position(&shape).unwrap();
        assert_eq!((reserved.x, reserved.z), (0.0, 0.0));
        let arrival_tick = world.next_tick();
        // These are exactly the keys/effects emitted by queue_world_effect.
        let mut commands = vec![QueuedCommand {
            arrival_tick,
            aigent_id: b"\0z".to_vec(),
            sequence: 1,
            effect: CommandEffect::CreateAndBindDemoBody {
                aigent_id: b"z".to_vec(),
                position: reserved,
                shape,
            },
        }];
        if initial_move {
            commands.push(QueuedCommand {
                arrival_tick,
                aigent_id: b"z".to_vec(),
                sequence: 1,
                effect: CommandEffect::UpsertMoveLease {
                    body_id: None,
                    intent: MoveIntent::new(0, 0, 500).unwrap(),
                    ttl_ms: None,
                },
            });
        }
        world.enqueue_batch(commands).unwrap();
    }

    #[test]
    fn demo_spawn_rechecks_a_slot_after_an_earlier_opaque_owner_moves() {
        let (mut world, existing_body, shape) = spawn_review_world(b"\0a");
        queue_review_move(&mut world, b"\0a");
        queue_review_newcomer(&mut world, shape, true);
        let generation = world.advance_tick().unwrap();
        assert!(generation.entities[&existing_body].position.x() < 1.0);
        assert!(
            !generation.aigent_bodies.contains_key(b"z".as_slice()),
            "occupied reserved slot must reject before binding: {:?}",
            generation.applied_commands
        );
        assert_eq!(generation.next_entity_id, 2);
        assert_eq!(generation.entities.len(), 1);
        assert!(generation.applied_commands.iter().any(|command| command
            .summary
            .contains("create_and_bind_demo_body:rejected=overlap")));
        assert!(generation.applied_commands.iter().any(|command| command
            .summary
            .contains("upsert_move_lease:rejected=unbound_aigent")));
    }

    #[test]
    fn demo_spawn_reservation_blocks_a_later_ordinary_owner_before_first_move() {
        let (mut world, existing_body, shape) = spawn_review_world(b"a");
        queue_review_move(&mut world, b"a");
        queue_review_newcomer(&mut world, shape, true);
        let generation = world.advance_tick().unwrap();
        assert_eq!(generation.entities[&existing_body].position.x(), 1.0);
        let newcomer = generation.aigent_bodies[b"z".as_slice()];
        assert_eq!(generation.entities[&newcomer].position.x(), 0.0);
        assert_eq!(generation.next_entity_id, 3);
        assert!(generation.active_leases.contains_key(&newcomer));
        assert!(generation.applied_commands.iter().any(|command| command
            .summary
            .contains("move=no_progress:blocker=entity/2")));
        assert!(!generation
            .applied_commands
            .iter()
            .any(|command| command.summary.contains("illegal_overlap")));
    }

    #[test]
    fn demo_spawn_application_accepts_exact_face_contact() {
        let (mut world, _, shape) = spawn_review_world(b"a");
        queue_review_newcomer(&mut world, shape, true);
        let generation = world.advance_tick().unwrap();
        let newcomer = generation.aigent_bodies[b"z".as_slice()];
        assert_eq!(generation.entities[&newcomer].position.x(), 0.0);
        assert_eq!(generation.next_entity_id, 3);
        assert!(generation.active_leases.contains_key(&newcomer));
        assert!(generation.applied_commands[0]
            .summary
            .contains("accepted:id=2"));
    }

    #[test]
    fn demo_spawn_reservation_ends_with_generation_without_a_hidden_lease() {
        let (mut world, existing_body, shape) = spawn_review_world(b"a");
        queue_review_move(&mut world, b"a");
        queue_review_newcomer(&mut world, shape, false);
        let generation = world.advance_tick().unwrap();
        let newcomer = generation.aigent_bodies[b"z".as_slice()];
        assert_eq!(generation.entities[&existing_body].position.x(), 1.0);
        assert!(!generation.active_leases.contains_key(&newcomer));
        // At the next generation it is an established sleeping body. The
        // continuing lease can enter that space; no local reservation leaks.
        let next = world.advance_tick().unwrap();
        assert!(next.entities[&existing_body].position.x() < 1.0);
        assert!(!next.active_leases.contains_key(&newcomer));
        assert_eq!(next.entities[&newcomer].position.x(), 0.0);
    }

    #[test]
    fn demo_spawn_reservation_updates_an_already_initialized_movement_draft() {
        let (mut world, existing_body, shape) = spawn_review_world(b"a");
        world
            .enqueue(QueuedCommand {
                arrival_tick: world.next_tick(),
                aigent_id: b"\0\0a".to_vec(),
                sequence: 1,
                effect: CommandEffect::CreateAndBindDemoBody {
                    aigent_id: b"\0a".to_vec(),
                    position: PositionRequest::new(4.0, 1.0, 0.0),
                    shape: test_box_shape(),
                },
            })
            .unwrap();
        world.advance_tick().unwrap();
        world
            .enqueue(QueuedCommand {
                arrival_tick: world.next_tick(),
                aigent_id: b"\0a".to_vec(),
                sequence: 1,
                effect: CommandEffect::UpsertMoveLease {
                    body_id: None,
                    intent: MoveIntent::new(4025, 0, 500).unwrap(),
                    ttl_ms: None,
                },
            })
            .unwrap();
        queue_review_move(&mut world, b"a");
        queue_review_newcomer(&mut world, shape, true);
        let generation = world.advance_tick().unwrap();
        let earlier_body = generation.aigent_bodies[b"\0a".as_slice()];
        assert_eq!(generation.entities[&earlier_body].position.x(), 4.025);
        assert_eq!(generation.entities[&existing_body].position.x(), 1.0);
        let newcomer = generation.aigent_bodies[b"z".as_slice()];
        assert_eq!(newcomer, 3);
        assert_eq!(generation.entities[&newcomer].position.x(), 0.0);
        assert!(generation.applied_commands[2]
            .summary
            .contains("move=no_progress:blocker=entity/3"));
    }

    #[test]
    fn demo_spawn_noop_does_not_reserve_an_established_sleeping_body() {
        let (mut world, existing_body, shape) = spawn_review_world(b"a");
        queue_review_newcomer(&mut world, shape.clone(), false);
        let newcomer = world.advance_tick().unwrap().aigent_bodies[b"z".as_slice()];
        world
            .enqueue(QueuedCommand {
                arrival_tick: world.next_tick(),
                aigent_id: b"\0z".to_vec(),
                sequence: 2,
                effect: CommandEffect::CreateAndBindDemoBody {
                    aigent_id: b"z".to_vec(),
                    position: PositionRequest::new(0.0, 1.0, 0.0),
                    shape,
                },
            })
            .unwrap();
        queue_review_move(&mut world, b"a");
        let generation = world.advance_tick().unwrap();
        assert!(generation.applied_commands[0].summary.contains(":noop:"));
        assert_eq!(generation.entities[&existing_body].position.x(), 0.975);
        assert_eq!(generation.aigent_bodies[b"z".as_slice()], newcomer);
        assert!(!generation.active_leases.contains_key(&newcomer));
        assert_eq!(generation.next_entity_id, 3);
    }

    #[test]
    fn demo_spawn_application_reserves_a_body_whose_move_just_completed() {
        let (mut world, existing_body, shape) = spawn_review_world(b"\0a");
        world
            .enqueue(QueuedCommand {
                arrival_tick: world.next_tick(),
                aigent_id: b"\0a".to_vec(),
                sequence: 2,
                effect: CommandEffect::UpsertMoveLease {
                    body_id: None,
                    intent: MoveIntent::new(975, 0, 500).unwrap(),
                    ttl_ms: None,
                },
            })
            .unwrap();
        queue_review_newcomer(&mut world, shape, true);
        let generation = world.advance_tick().unwrap();
        assert_eq!(generation.entities[&existing_body].position.x(), 0.975);
        assert!(!generation.active_leases.contains_key(&existing_body));
        assert!(!generation.aigent_bodies.contains_key(b"z".as_slice()));
        assert_eq!(generation.next_entity_id, 2);
        assert!(generation.applied_commands[1]
            .summary
            .contains("rejected=overlap"));
    }

    #[test]
    fn demo_spawn_collision_projects_current_budget_not_activation_preview() {
        let (mut world, _, shape) = spawn_review_world(b"a");
        let mut candidate = ShapeTree::decode(shape.as_bytes()).unwrap();
        candidate.nodes.truncate(1);
        candidate.nodes[0].primitive = Some(Primitive::Sphere(aigent_protocol::SpherePrimitive {
            radius_mm: 500,
        }));
        candidate.nodes[0]
            .transform
            .as_mut()
            .unwrap()
            .translation
            .as_mut()
            .unwrap()
            .y_mm = 0;
        let mut parameters = RulesetParameters::catalog_defaults();
        parameters.set("shape.body_max_parts", 1);
        parameters.set("shape.body_max_joints", 0);
        let candidate_id = world.schedule_ruleset(parameters).unwrap();
        let activation_tick = world.rulesets().pending().unwrap().activate_at_tick;
        if activation_tick > world.next_tick() {
            world
                .advance_ticks(activation_tick - world.next_tick())
                .unwrap();
        }
        queue_review_newcomer(
            &mut world,
            ShapeSlot::from_encoded(candidate.encode_to_vec()),
            true,
        );
        let generation = world.advance_tick().unwrap();
        assert_eq!(generation.ruleset_generation_id, candidate_id);
        assert!(generation.aigent_bodies.contains_key(b"z".as_slice()));
        assert_eq!(generation.next_entity_id, 3);
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
