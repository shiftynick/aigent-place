//! The one optional, ephemeral two-body demo activity (ADR-0014).
//!
//! This owns no commands or generic lifecycle. Inputs are the exact private
//! presence and actual post-movement draft; only its Eq public state is frozen
//! into a generation. STOP and natural arrival do not discard earned proof.

use crate::entity::{EntitySnapshot, Position, ShapeSlot};
use crate::lease::{LeaseTermination, LeaseTerminationReason};
use crate::movement::collider_at;
use crate::ruleset::RulesetParameters;
use aigent_protocol::{DemoActivitySnapshot, Vector3Millimeters};
use prost::Message;
use std::collections::{BTreeMap, VecDeque};

pub const DEMO_ACTIVITY_MAX_BYTES: usize = 2048;
const PLAZA_BOUND_MM: i64 = 8000;
const ROUTE_RADIUS_MM: f64 = 3250.0;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
#[repr(i32)]
pub enum DemoPhase {
    Ready = 1,
    Separate = 2,
    Regroup = 3,
    Complete = 4,
    Suspended = 5,
}
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
#[repr(i32)]
pub enum DemoAvailability {
    Unbound = 1,
    MissingBody = 2,
    Disconnected = 3,
    Available = 4,
}
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
#[repr(i32)]
pub enum DemoReason {
    Normal = 1,
    ParticipantUnavailable = 2,
    SessionChanged = 3,
    BodyChanged = 4,
    LeaseInactive = 5,
    NoProgress = 6,
    UnsafeGeometry = 7,
    CounterExhausted = 8,
}
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct DemoPoint {
    pub x: i64,
    pub y: i64,
    pub z: i64,
}
impl DemoPoint {
    fn from_position(p: Position) -> Self {
        Self {
            x: (p.x() * 1000.0).round() as i64,
            y: (p.y() * 1000.0).round() as i64,
            z: (p.z() * 1000.0).round() as i64,
        }
    }
    fn to_proto(self) -> Vector3Millimeters {
        Vector3Millimeters {
            x_mm: self.x,
            y_mm: self.y,
            z_mm: self.z,
        }
    }
    fn from_proto(p: &Vector3Millimeters) -> Option<Self> {
        ((-PLAZA_BOUND_MM..=PLAZA_BOUND_MM).contains(&p.x_mm)
            && (-PLAZA_BOUND_MM..=PLAZA_BOUND_MM).contains(&p.z_mm)
            && (-100_000_000..=100_000_000).contains(&p.y_mm))
        .then_some(Self {
            x: p.x_mm,
            y: p.y_mm,
            z: p.z_mm,
        })
    }
}
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct DemoRules {
    pub inner_min_mm: u32,
    pub inner_max_mm: u32,
    pub separate_mm: u32,
    pub min_travel_mm: u32,
    pub min_contribution_mm: u32,
    pub dwell_ticks: u32,
    pub complete_hold_ticks: u32,
    pub recovery_hold_ticks: u32,
    pub phase_timeout_ticks: u32,
}
impl DemoRules {
    fn to_proto(&self) -> aigent_protocol::DemoActivityRules {
        aigent_protocol::DemoActivityRules {
            inner_min_mm: self.inner_min_mm,
            inner_max_mm: self.inner_max_mm,
            separate_mm: self.separate_mm,
            min_travel_mm: self.min_travel_mm,
            min_contribution_mm: self.min_contribution_mm,
            dwell_ticks: self.dwell_ticks,
            complete_hold_ticks: self.complete_hold_ticks,
            recovery_hold_ticks: self.recovery_hold_ticks,
            phase_timeout_ticks: self.phase_timeout_ticks,
        }
    }
}
impl Default for DemoRules {
    fn default() -> Self {
        Self {
            inner_min_mm: 1800,
            inner_max_mm: 2200,
            separate_mm: 5500,
            min_travel_mm: 1000,
            min_contribution_mm: 1000,
            dwell_ticks: 8,
            complete_hold_ticks: 20,
            recovery_hold_ticks: 20,
            phase_timeout_ticks: 400,
        }
    }
}
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct DemoParticipant {
    pub body_id: Option<u64>,
    pub availability: DemoAvailability,
    pub phase_start_position_mm: Option<DemoPoint>,
    pub travel_mm: u32,
    pub contribution_mm: i32,
    pub earned_tick: Option<u64>,
}
impl Default for DemoParticipant {
    fn default() -> Self {
        Self {
            body_id: None,
            availability: DemoAvailability::Unbound,
            phase_start_position_mm: None,
            travel_mm: 0,
            contribution_mm: 0,
            earned_tick: None,
        }
    }
}
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct DemoTransition {
    pub id: u64,
    pub tick: u64,
    pub from: DemoPhase,
    pub to: DemoPhase,
    pub completed_rounds: u64,
    pub reason: DemoReason,
    pub reset_id: u64,
}
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct DemoActivityState {
    pub run_id: [u8; 16],
    pub reset_id: u64,
    pub observed_tick: u64,
    pub phase: DemoPhase,
    pub phase_started_tick: u64,
    pub completed_rounds: u64,
    pub participants: [DemoParticipant; 2],
    pub rules: DemoRules,
    pub transition_id: u64,
    pub recent_transitions: VecDeque<DemoTransition>,
    pub formation_center_mm: Option<DemoPoint>,
    pub formation_axis_mm: Option<DemoPoint>,
    pub credit_started_tick: Option<u64>,
    pub dwell_ticks: u32,
    pub reason: DemoReason,
}
impl DemoActivityState {
    #[must_use]
    pub fn to_proto(&self) -> DemoActivitySnapshot {
        DemoActivitySnapshot {
            version: 1,
            run_id: self.run_id.to_vec(),
            reset_id: self.reset_id,
            observed_tick: self.observed_tick,
            phase: self.phase as i32,
            phase_started_tick: self.phase_started_tick,
            completed_rounds: self.completed_rounds,
            participants: self
                .participants
                .iter()
                .map(|p| aigent_protocol::DemoActivityParticipant {
                    body_id: p.body_id,
                    availability: p.availability as i32,
                    phase_start_position_mm: p.phase_start_position_mm.map(DemoPoint::to_proto),
                    travel_mm: p.travel_mm,
                    contribution_mm: p.contribution_mm,
                    earned_tick: p.earned_tick,
                })
                .collect(),
            rules: Some(self.rules.to_proto()),
            transition_id: self.transition_id,
            recent_transitions: self
                .recent_transitions
                .iter()
                .map(|t| aigent_protocol::DemoActivityTransition {
                    id: t.id,
                    tick: t.tick,
                    from: t.from as i32,
                    to: t.to as i32,
                    completed_rounds: t.completed_rounds,
                    reason: t.reason as i32,
                    reset_id: t.reset_id,
                })
                .collect(),
            formation_center_mm: self.formation_center_mm.map(DemoPoint::to_proto),
            formation_axis_mm: self.formation_axis_mm.map(DemoPoint::to_proto),
            credit_started_tick: self.credit_started_tick,
            dwell_ticks: self.dwell_ticks,
            reason: self.reason as i32,
        }
    }
    /// Strict adapter for Rust observation round-trips; unknown optional semantics
    /// fail the entire body transition rather than accepting only the entities.
    #[must_use]
    pub fn from_proto(p: &DemoActivitySnapshot) -> Option<Self> {
        let run_id: [u8; 16] = p.run_id.as_slice().try_into().ok()?;
        if p.version != 1
            || run_id == [0; 16]
            || p.encoded_len() > DEMO_ACTIVITY_MAX_BYTES
            || p.participants.len() != 2
            || p.recent_transitions.len() > 8
            || p.phase_started_tick > p.observed_tick
        {
            return None;
        }
        let phase = parse_phase(p.phase)?;
        let reason = parse_reason(p.reason)?;
        let rules = DemoRules::default();
        let rp = p.rules.as_ref()?;
        if rp != &rules.to_proto() {
            return None;
        }
        let point = |v: &Option<Vector3Millimeters>| match v {
            Some(p) => Some(Some(DemoPoint::from_proto(p)?)),
            None => Some(None),
        };
        let center = point(&p.formation_center_mm)?;
        let axis = point(&p.formation_axis_mm)?;
        if center.is_some() != axis.is_some() {
            return None;
        }
        if let Some(a) = axis {
            if a.y != 0 || ((a.x as f64).hypot(a.z as f64) - 1000.0).abs() > 2.0 {
                return None;
            }
        }
        let mut participants = [DemoParticipant::default(), DemoParticipant::default()];
        for (out, input) in participants.iter_mut().zip(&p.participants) {
            let availability = availability(input.availability)?;
            if input.body_id == Some(0)
                || (availability == DemoAvailability::Unbound) != input.body_id.is_none()
                || input.travel_mm > rules.min_travel_mm
                || !(-32000..=32000).contains(&input.contribution_mm)
            {
                return None;
            }
            let start = point(&input.phase_start_position_mm)?;
            if input.earned_tick.is_some_and(|t| {
                p.credit_started_tick.is_none_or(|origin| t < origin)
                    || t > p.observed_tick
                    || input.travel_mm < rules.min_travel_mm
                    || input.contribution_mm < rules.min_contribution_mm as i32
            }) {
                return None;
            }
            *out = DemoParticipant {
                body_id: input.body_id,
                availability,
                phase_start_position_mm: start,
                travel_mm: input.travel_mm,
                contribution_mm: input.contribution_mm,
                earned_tick: input.earned_tick,
            };
        }
        if participants[0]
            .body_id
            .zip(participants[1].body_id)
            .is_some_and(|(a, b)| a >= b)
            || (participants[0].body_id.is_none() && participants[1].body_id.is_some())
        {
            return None;
        }
        if participants.iter().any(|q| {
            q.earned_tick.is_some()
                != (q.travel_mm >= rules.min_travel_mm
                    && q.contribution_mm >= rules.min_contribution_mm as i32)
        }) {
            return None;
        }
        if p.dwell_ticks > 0 && participants.iter().any(|q| q.earned_tick.is_none()) {
            return None;
        }
        if (phase == DemoPhase::Suspended) == (reason == DemoReason::Normal) {
            return None;
        }
        if p.credit_started_tick
            .is_some_and(|origin| origin > p.observed_tick)
        {
            return None;
        }
        match phase {
            DemoPhase::Ready | DemoPhase::Suspended => {
                if p.credit_started_tick.is_some()
                    || p.dwell_ticks != 0
                    || participants.iter().any(|q| {
                        q.phase_start_position_mm.is_some()
                            || q.earned_tick.is_some()
                            || q.travel_mm != 0
                            || q.contribution_mm != 0
                    })
                    || (phase == DemoPhase::Suspended && center.is_some())
                {
                    return None;
                }
            }
            DemoPhase::Separate | DemoPhase::Regroup | DemoPhase::Complete => {
                let origin = p.credit_started_tick?;
                if center.is_none()
                    || origin > p.phase_started_tick
                    || participants.iter().any(|q| {
                        q.availability != DemoAvailability::Available
                            || q.phase_start_position_mm.is_none()
                    })
                    || p.dwell_ticks > rules.dwell_ticks
                    || (phase == DemoPhase::Separate && p.dwell_ticks != 0)
                    || (phase != DemoPhase::Complete && origin != p.phase_started_tick)
                    || (phase == DemoPhase::Complete
                        && (p.dwell_ticks != rules.dwell_ticks
                            || participants.iter().any(|q| q.earned_tick.is_none())))
                {
                    return None;
                }
            }
        }
        let mut history = VecDeque::new();
        for input in &p.recent_transitions {
            let t = DemoTransition {
                id: input.id,
                tick: input.tick,
                from: parse_phase(input.from)?,
                to: parse_phase(input.to)?,
                completed_rounds: input.completed_rounds,
                reason: parse_reason(input.reason)?,
                reset_id: input.reset_id,
            };
            if !legal_edge(t.from, t.to)
                || (t.to == DemoPhase::Suspended) == (t.reason == DemoReason::Normal)
                || t.id == 0
                || t.id > p.transition_id
                || t.tick > p.observed_tick
                || t.completed_rounds > p.completed_rounds
                || t.reset_id > p.reset_id
            {
                return None;
            }
            if let Some(prior) = history.back() {
                let prior: &DemoTransition = prior;
                if prior.id.checked_add(1) != Some(t.id)
                    || prior.tick > t.tick
                    || prior.to != t.from
                    || prior
                        .completed_rounds
                        .checked_add(u64::from(t.to == DemoPhase::Complete))
                        != Some(t.completed_rounds)
                    || prior
                        .reset_id
                        .checked_add(u64::from(t.to == DemoPhase::Suspended))
                        != Some(t.reset_id)
                {
                    return None;
                }
            }
            history.push_back(t);
        }
        let exhausted = phase == DemoPhase::Suspended
            && reason == DemoReason::CounterExhausted
            && [p.reset_id, p.transition_id, p.completed_rounds].contains(&u64::MAX);
        if reason == DemoReason::CounterExhausted && !exhausted {
            return None;
        }
        if let Some(last) = history.back() {
            if last.id != p.transition_id
                || last.reset_id != p.reset_id
                || last.completed_rounds != p.completed_rounds
                || (!exhausted
                    && (last.to != phase
                        || last.tick != p.phase_started_tick
                        || last.reason != reason))
            {
                return None;
            }
        } else if p.transition_id != 0
            || p.reset_id != 0
            || p.completed_rounds != 0
            || phase != DemoPhase::Ready
            || p.phase_started_tick != 0
            || reason != DemoReason::Normal
        {
            return None;
        }
        Some(Self {
            run_id,
            reset_id: p.reset_id,
            observed_tick: p.observed_tick,
            phase,
            phase_started_tick: p.phase_started_tick,
            completed_rounds: p.completed_rounds,
            participants,
            rules,
            transition_id: p.transition_id,
            recent_transitions: history,
            formation_center_mm: center,
            formation_axis_mm: axis,
            credit_started_tick: p.credit_started_tick,
            dwell_ticks: p.dwell_ticks,
            reason,
        })
    }
}
fn legal_edge(from: DemoPhase, to: DemoPhase) -> bool {
    matches!(
        (from, to),
        (DemoPhase::Ready, DemoPhase::Separate | DemoPhase::Suspended)
            | (
                DemoPhase::Separate,
                DemoPhase::Regroup | DemoPhase::Suspended
            )
            | (
                DemoPhase::Regroup,
                DemoPhase::Complete | DemoPhase::Suspended
            )
            | (
                DemoPhase::Complete,
                DemoPhase::Separate | DemoPhase::Ready | DemoPhase::Suspended
            )
            | (DemoPhase::Suspended, DemoPhase::Ready)
    )
}
fn parse_phase(v: i32) -> Option<DemoPhase> {
    Some(match v {
        1 => DemoPhase::Ready,
        2 => DemoPhase::Separate,
        3 => DemoPhase::Regroup,
        4 => DemoPhase::Complete,
        5 => DemoPhase::Suspended,
        _ => return None,
    })
}
fn availability(v: i32) -> Option<DemoAvailability> {
    Some(match v {
        1 => DemoAvailability::Unbound,
        2 => DemoAvailability::MissingBody,
        3 => DemoAvailability::Disconnected,
        4 => DemoAvailability::Available,
        _ => return None,
    })
}
fn parse_reason(v: i32) -> Option<DemoReason> {
    Some(match v {
        1 => DemoReason::Normal,
        2 => DemoReason::ParticipantUnavailable,
        3 => DemoReason::SessionChanged,
        4 => DemoReason::BodyChanged,
        5 => DemoReason::LeaseInactive,
        6 => DemoReason::NoProgress,
        7 => DemoReason::UnsafeGeometry,
        8 => DemoReason::CounterExhausted,
        _ => return None,
    })
}

/// Private, bounded exact connection/epoch state, never published.
#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct DemoSession {
    connection_id: Vec<u8>,
    command_epoch: Vec<u8>,
}
#[derive(Debug, Clone, Default)]
pub(crate) struct DemoPresence {
    owners: BTreeMap<Vec<u8>, (u64, Option<DemoSession>)>,
}
impl DemoPresence {
    pub(crate) fn attach(
        &mut self,
        owner: Vec<u8>,
        connection_id: Vec<u8>,
        command_epoch: Vec<u8>,
    ) -> bool {
        // Epochs are issued only by SessionHub as sess-N. Do not infer ordering
        // lexically (sess-10 precedes sess-9), or accept a stale delayed attach.
        let Some(serial) = std::str::from_utf8(&command_epoch)
            .ok()
            .and_then(|s| s.strip_prefix("sess-"))
            .and_then(|s| s.parse::<u64>().ok())
            .filter(|v| *v > 0)
        else {
            return false;
        };
        if connection_id.is_empty() || (!self.owners.contains_key(&owner) && self.owners.len() >= 2)
        {
            return false;
        }
        let session = DemoSession {
            connection_id,
            command_epoch,
        };
        if let Some((last, active)) = self.owners.get_mut(&owner) {
            if serial < *last {
                return false;
            }
            if serial == *last && active.as_ref() != Some(&session) {
                // If the issuing hub ever exhausts/reuses its epoch rank,
                // reject replacement and fail this presence closed. Keeping
                // the old socket marked present could grant invalid proof.
                *active = None;
                return false;
            }
        }
        self.owners.insert(owner, (serial, Some(session)));
        true
    }
    pub(crate) fn detach(
        &mut self,
        owner: &[u8],
        connection_id: &[u8],
        command_epoch: &[u8],
    ) -> bool {
        let Some((_, active)) = self.owners.get_mut(owner) else {
            return false;
        };
        if active
            .as_ref()
            .is_some_and(|s| s.connection_id == connection_id && s.command_epoch == command_epoch)
        {
            *active = None;
            true
        } else {
            false
        }
    }
    fn get(&self, owner: &[u8]) -> Option<&DemoSession> {
        self.owners.get(owner)?.1.as_ref()
    }
}
#[derive(Debug, Clone)]
pub(crate) struct DemoLeaseMotion {
    pub owner: Vec<u8>,
    pub before: Position,
    pub after: Position,
}
#[derive(Debug, Clone, PartialEq, Eq)]
struct Identity {
    owner: Vec<u8>,
    body_id: u64,
    session: DemoSession,
    shape: Option<ShapeSlot>,
}
#[derive(Debug, Clone)]
pub(crate) struct DemoActivity {
    pub(crate) state: DemoActivityState,
    identities: Option<[Identity; 2]>,
    last_positions: Option<[Position; 2]>,
    starts: Option<[Position; 2]>,
    path_mm: [f64; 2],
    recovery_safe_ticks: u32,
}
impl DemoActivity {
    pub(crate) fn new(run_id: [u8; 16]) -> Self {
        assert_ne!(run_id, [0; 16], "demo run token must be nonzero");
        Self {
            state: DemoActivityState {
                run_id,
                reset_id: 0,
                observed_tick: 0,
                phase: DemoPhase::Ready,
                phase_started_tick: 0,
                completed_rounds: 0,
                participants: Default::default(),
                rules: DemoRules::default(),
                transition_id: 0,
                recent_transitions: VecDeque::new(),
                formation_center_mm: None,
                formation_axis_mm: None,
                credit_started_tick: None,
                dwell_ticks: 0,
                reason: DemoReason::Normal,
            },
            identities: None,
            last_positions: None,
            starts: None,
            path_mm: [0.0; 2],
            recovery_safe_ticks: 0,
        }
    }
    pub(crate) fn advance(
        &mut self,
        tick: u64,
        bindings: &BTreeMap<Vec<u8>, u64>,
        geometry: (&BTreeMap<u64, EntitySnapshot>, &RulesetParameters),
        presence: &DemoPresence,
        motions: &BTreeMap<u64, DemoLeaseMotion>,
        terminations: &[LeaseTermination],
    ) -> DemoActivityState {
        let (entities, parameters) = geometry;
        self.state.observed_tick = tick;
        let mut pair = Vec::new();
        let mut ordered = bindings.iter().collect::<Vec<_>>();
        ordered.sort_by_key(|(_, id)| **id);
        for (slot, p) in self.state.participants.iter_mut().enumerate() {
            let binding = ordered.get(slot).copied();
            p.body_id = binding.map(|(_, id)| *id);
            p.availability = match binding {
                None => DemoAvailability::Unbound,
                Some((_, id)) if !entities.contains_key(id) => DemoAvailability::MissingBody,
                Some((owner, _)) if presence.get(owner).is_none() => DemoAvailability::Disconnected,
                Some((owner, id)) => {
                    let entity = &entities[id];
                    pair.push((
                        Identity {
                            owner: owner.clone(),
                            body_id: *id,
                            session: presence.get(owner).expect("present").clone(),
                            shape: entity.shape.clone(),
                        },
                        entity.position,
                    ));
                    DemoAvailability::Available
                }
            };
        }
        if self.state.reason == DemoReason::CounterExhausted {
            return self.state.clone();
        }
        if pair.len() != 2 {
            self.suspend(tick, DemoReason::ParticipantUnavailable);
            return self.state.clone();
        }
        let identities = [pair[0].0.clone(), pair[1].0.clone()];
        let positions = [pair[0].1, pair[1].1];
        if !safe_geometry(entities, &identities, parameters) {
            self.suspend(tick, DemoReason::UnsafeGeometry);
            return self.state.clone();
        }
        if self.state.phase == DemoPhase::Suspended {
            // Recovery needs presence and safe bodies, not an outstanding lease.
            if self.identities.as_ref() != Some(&identities) {
                self.recovery_safe_ticks = 0;
            }
            self.identities = Some(identities);
            self.last_positions = Some(positions);
            self.recovery_safe_ticks += 1;
            if self.recovery_safe_ticks >= self.state.rules.recovery_hold_ticks {
                self.transition(tick, DemoPhase::Ready, DemoReason::Normal);
                self.recovery_safe_ticks = 0;
            }
            return self.state.clone();
        }
        if let Some(previous) = &self.identities {
            if previous
                .iter()
                .zip(&identities)
                .any(|(a, b)| a.owner != b.owner || a.body_id != b.body_id || a.shape != b.shape)
            {
                self.suspend(tick, DemoReason::BodyChanged);
                return self.state.clone();
            }
            if previous
                .iter()
                .zip(&identities)
                .any(|(a, b)| a.session != b.session)
            {
                self.suspend(tick, DemoReason::SessionChanged);
                return self.state.clone();
            }
        }
        // Compare the actual draft pose with exactly the movement kernel's
        // before/after pair; revision changes alone cannot distinguish motion.
        if let Some(previous) = self.last_positions {
            for i in 0..2 {
                match motions.get(&identities[i].body_id) {
                    Some(m)
                        if m.owner == identities[i].owner
                            && m.before == previous[i]
                            && m.after == positions[i] => {}
                    None if previous[i] == positions[i] => {}
                    _ => {
                        self.suspend(tick, DemoReason::BodyChanged);
                        return self.state.clone();
                    }
                }
            }
        }
        self.identities = Some(identities.clone());
        self.last_positions = Some(positions);
        if terminations.iter().any(|t| {
            identities.iter().any(|i| i.body_id == t.body_id)
                && t.reason != LeaseTerminationReason::Cancelled
        }) {
            self.suspend(tick, DemoReason::LeaseInactive);
            return self.state.clone();
        }
        if self.state.formation_center_mm.is_none() && !self.freeze_formation(positions) {
            self.suspend(tick, DemoReason::UnsafeGeometry);
            return self.state.clone();
        }
        let spacing = horizontal_distance(positions[0], positions[1]);
        match self.state.phase {
            DemoPhase::Ready => {
                if self.inner(spacing) {
                    self.enter_motion(tick, DemoPhase::Separate, positions);
                } else if tick.saturating_sub(self.state.phase_started_tick)
                    >= u64::from(self.state.rules.phase_timeout_ticks)
                {
                    self.suspend(tick, DemoReason::NoProgress);
                }
            }
            DemoPhase::Separate | DemoPhase::Regroup => {
                self.update_credit(tick, positions, &identities, motions);
                if tick.saturating_sub(self.state.phase_started_tick)
                    >= u64::from(self.state.rules.phase_timeout_ticks)
                {
                    self.suspend(tick, DemoReason::NoProgress);
                } else if self.state.phase == DemoPhase::Separate {
                    // SEPARATE entered from the inner band. Reconstruct prior
                    // spacing from this tick's own authoritative movement.
                    let prior = [
                        motions
                            .get(&identities[0].body_id)
                            .map_or(positions[0], |m| m.before),
                        motions
                            .get(&identities[1].body_id)
                            .map_or(positions[1], |m| m.before),
                    ];
                    if horizontal_distance(prior[0], prior[1])
                        < f64::from(self.state.rules.separate_mm)
                        && spacing >= f64::from(self.state.rules.separate_mm)
                        && self.both_earned()
                    {
                        self.enter_motion(tick, DemoPhase::Regroup, positions);
                    }
                } else {
                    if self.inner(spacing) && self.both_earned() {
                        self.state.dwell_ticks += 1;
                    } else {
                        self.state.dwell_ticks = 0;
                    }
                    if self.state.dwell_ticks >= self.state.rules.dwell_ticks {
                        if let Some(next) = self.state.completed_rounds.checked_add(1) {
                            // Check transition capacity before awarding the count.
                            if self.state.transition_id == u64::MAX {
                                self.exhausted(tick);
                            } else {
                                self.state.completed_rounds = next;
                                self.transition(tick, DemoPhase::Complete, DemoReason::Normal);
                            }
                        } else {
                            self.exhausted(tick);
                        }
                    }
                }
            }
            DemoPhase::Complete => {
                // COMPLETE retains the regroup origin. Its public progress is
                // still current own displacement; withdrawing proof resets the
                // attempt but never removes the already earned round count.
                self.update_credit(tick, positions, &identities, motions);
                if !self.both_earned() {
                    self.suspend(tick, DemoReason::NoProgress);
                    return self.state.clone();
                }
                if tick.saturating_sub(self.state.phase_started_tick)
                    >= u64::from(self.state.rules.complete_hold_ticks)
                {
                    if self.inner(spacing) {
                        self.enter_motion(tick, DemoPhase::Separate, positions);
                    } else {
                        self.clear_credit();
                        self.transition(tick, DemoPhase::Ready, DemoReason::Normal);
                    }
                }
            }
            DemoPhase::Suspended => unreachable!("handled before contribution"),
        }
        self.state.clone()
    }
    fn inner(&self, distance: f64) -> bool {
        (f64::from(self.state.rules.inner_min_mm)..=f64::from(self.state.rules.inner_max_mm))
            .contains(&distance)
    }
    fn freeze_formation(&mut self, positions: [Position; 2]) -> bool {
        let dx = (positions[1].x() - positions[0].x()) * 1000.0;
        let dz = (positions[1].z() - positions[0].z()) * 1000.0;
        let length = dx.hypot(dz);
        if length < 1.0 {
            return false;
        }
        let center = DemoPoint {
            x: ((positions[0].x() + positions[1].x()) * 500.0).round() as i64,
            y: ((positions[0].y() + positions[1].y()) * 500.0).round() as i64,
            z: ((positions[0].z() + positions[1].z()) * 500.0).round() as i64,
        };
        let axis = DemoPoint {
            x: (dx / length * 1000.0).round() as i64,
            y: 0,
            z: (dz / length * 1000.0).round() as i64,
        };
        // Public owners derive ±3.25m routes. Promise them only with footprint
        // margin inside the flat bounded plaza, including rotated axes.
        for sign in [-1.0, 1.0] {
            if (center.x as f64 + sign * axis.x as f64 / 1000.0 * ROUTE_RADIUS_MM).abs() > 7500.0
                || (center.z as f64 + sign * axis.z as f64 / 1000.0 * ROUTE_RADIUS_MM).abs()
                    > 7500.0
            {
                return false;
            }
        }
        self.state.formation_center_mm = Some(center);
        self.state.formation_axis_mm = Some(axis);
        true
    }
    fn clear_credit(&mut self) {
        self.starts = None;
        self.path_mm = [0.0; 2];
        self.state.credit_started_tick = None;
        self.state.dwell_ticks = 0;
        for p in &mut self.state.participants {
            p.phase_start_position_mm = None;
            p.travel_mm = 0;
            p.contribution_mm = 0;
            p.earned_tick = None;
        }
    }
    fn enter_motion(&mut self, tick: u64, next: DemoPhase, positions: [Position; 2]) {
        self.clear_credit();
        if !self.transition(tick, next, DemoReason::Normal) {
            return;
        }
        self.starts = Some(positions);
        self.state.credit_started_tick = Some(tick);
        for (p, position) in self.state.participants.iter_mut().zip(positions) {
            p.phase_start_position_mm = Some(DemoPoint::from_position(position));
        }
    }
    fn update_credit(
        &mut self,
        tick: u64,
        positions: [Position; 2],
        identities: &[Identity; 2],
        motions: &BTreeMap<u64, DemoLeaseMotion>,
    ) {
        let starts = self.starts.expect("movement phase has origins");
        let axis = self
            .state
            .formation_axis_mm
            .expect("movement phase has axis");
        let axis_length = (axis.x as f64).hypot(axis.z as f64);
        for i in 0..2 {
            if let Some(m) = motions.get(&identities[i].body_id) {
                self.path_mm[i] = (self.path_mm[i] + horizontal_distance(m.before, m.after))
                    .min(f64::from(self.state.rules.min_travel_mm));
            }
            let sign = (if i == 0 { -1.0 } else { 1.0 })
                * (if self.state.phase == DemoPhase::Separate {
                    1.0
                } else {
                    -1.0
                });
            let net = ((positions[i].x() - starts[i].x()) * 1000.0 * axis.x as f64
                + (positions[i].z() - starts[i].z()) * 1000.0 * axis.z as f64)
                / axis_length
                * sign;
            let p = &mut self.state.participants[i];
            p.travel_mm = self.path_mm[i].floor() as u32;
            p.contribution_mm = net.floor().clamp(-32000.0, 32000.0) as i32;
            if p.travel_mm >= self.state.rules.min_travel_mm
                && p.contribution_mm >= self.state.rules.min_contribution_mm as i32
            {
                if p.earned_tick.is_none() {
                    p.earned_tick = Some(tick);
                }
            } else {
                p.earned_tick = None;
            }
        }
    }
    fn both_earned(&self) -> bool {
        self.state
            .participants
            .iter()
            .all(|p| p.earned_tick.is_some())
    }
    fn suspend(&mut self, tick: u64, why: DemoReason) {
        self.recovery_safe_ticks = 0;
        if self.state.phase != DemoPhase::Suspended {
            let Some(next) = self.state.reset_id.checked_add(1) else {
                self.exhausted(tick);
                return;
            };
            if self.state.transition_id == u64::MAX {
                self.exhausted(tick);
                return;
            }
            self.state.reset_id = next;
            self.clear_credit();
            self.state.formation_center_mm = None;
            self.state.formation_axis_mm = None;
            self.identities = None;
            self.last_positions = None;
            self.transition(tick, DemoPhase::Suspended, why);
        }
    }
    fn transition(&mut self, tick: u64, next: DemoPhase, why: DemoReason) -> bool {
        let Some(id) = self.state.transition_id.checked_add(1) else {
            self.exhausted(tick);
            return false;
        };
        let from = self.state.phase;
        self.state.transition_id = id;
        self.state.phase = next;
        self.state.phase_started_tick = tick;
        self.state.reason = why;
        self.state.recent_transitions.push_back(DemoTransition {
            id,
            tick,
            from,
            to: next,
            completed_rounds: self.state.completed_rounds,
            reason: why,
            reset_id: self.state.reset_id,
        });
        if self.state.recent_transitions.len() > 8 {
            self.state.recent_transitions.pop_front();
        }
        true
    }
    fn exhausted(&mut self, tick: u64) {
        self.clear_credit();
        self.identities = None;
        self.last_positions = None;
        self.state.formation_center_mm = None;
        self.state.formation_axis_mm = None;
        self.state.phase = DemoPhase::Suspended;
        self.state.phase_started_tick = tick;
        self.state.reason = DemoReason::CounterExhausted;
    }
}
fn horizontal_distance(a: Position, b: Position) -> f64 {
    ((a.x() - b.x()) * 1000.0).hypot((a.z() - b.z()) * 1000.0)
}
fn safe_geometry(
    entities: &BTreeMap<u64, EntitySnapshot>,
    identities: &[Identity; 2],
    parameters: &RulesetParameters,
) -> bool {
    let mut colliders = Vec::new();
    for i in identities {
        let entity = &entities[&i.body_id];
        let p = DemoPoint::from_position(entity.position);
        if p.x.abs() > PLAZA_BOUND_MM || p.z.abs() > PLAZA_BOUND_MM {
            return false;
        }
        let Ok((_, collider)) = collider_at(entity, parameters) else {
            return false;
        };
        let b = collider.aggregate();
        // The selected activity supports the existing centred square footprints.
        // A replaced/rotated/wider shape must not inherit a promise of safe aims.
        if (b.max().x() - b.min().x() - 1000.0).abs() > 0.001
            || (b.max().z() - b.min().z() - 1000.0).abs() > 0.001
            || ((b.max().x() + b.min().x()) / 2.0 - entity.position.x() * 1000.0).abs() > 0.001
            || ((b.max().z() + b.min().z()) / 2.0 - entity.position.z() * 1000.0).abs() > 0.001
        {
            return false;
        }
        colliders.push(collider);
    }
    !colliders[0].parts().iter().any(|a| {
        colliders[1]
            .parts()
            .iter()
            .any(|b| a.bounds().overlaps_positive_volume(b.bounds()))
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::entity::{EntityStore, PositionRequest};
    use aigent_protocol::{
        shape_node, BoxPrimitive, ColorRgba, LocalTransform, Quaternion, ShapeNode, ShapeTree,
    };

    fn shape(width: i64) -> ShapeSlot {
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
                    color: Some(ColorRgba {
                        red: 1,
                        green: 2,
                        blue: 3,
                        alpha: 255,
                    }),
                    joint_name: None,
                    material_tags: vec![],
                    primitive: Some(shape_node::Primitive::Box(BoxPrimitive {
                        size_x_mm: width,
                        size_y_mm: 1800,
                        size_z_mm: 1000,
                    })),
                }],
            }
            .encode_to_vec(),
        )
    }
    struct Fixture {
        activity: DemoActivity,
        bindings: BTreeMap<Vec<u8>, u64>,
        entities: BTreeMap<u64, EntitySnapshot>,
        presence: DemoPresence,
        tick: u64,
    }
    impl Fixture {
        fn new(a: f64, b: f64) -> Self {
            let mut store = EntityStore::new();
            store
                .create(PositionRequest::new(a, 0.9, 0.0), Some(shape(1000)))
                .unwrap();
            store
                .create(PositionRequest::new(b, 0.9, 0.0), Some(shape(1000)))
                .unwrap();
            let mut presence = DemoPresence::default();
            assert!(presence.attach(b"a".to_vec(), b"ca".to_vec(), b"sess-1".to_vec()));
            assert!(presence.attach(b"b".to_vec(), b"cb".to_vec(), b"sess-2".to_vec()));
            Self {
                activity: DemoActivity::new([1; 16]),
                bindings: BTreeMap::from([(b"a".to_vec(), 1), (b"b".to_vec(), 2)]),
                entities: store.snapshots(),
                presence,
                tick: 0,
            }
        }
        fn step(
            &mut self,
            a: Option<f64>,
            b: Option<f64>,
            terms: &[LeaseTermination],
        ) -> DemoActivityState {
            self.tick += 1;
            let mut motions = BTreeMap::new();
            for (id, owner, next) in [(1, b"a".as_slice(), a), (2, b"b".as_slice(), b)] {
                if let Some(x) = next {
                    let e = self.entities.get_mut(&id).unwrap();
                    let before = e.position;
                    e.position = PositionRequest::new(x, 0.9, 0.0).validate().unwrap();
                    e.revision += 1;
                    motions.insert(
                        id,
                        DemoLeaseMotion {
                            owner: owner.to_vec(),
                            before,
                            after: e.position,
                        },
                    );
                }
            }
            let state = self.activity.advance(
                self.tick,
                &self.bindings,
                (&self.entities, &RulesetParameters::catalog_defaults()),
                &self.presence,
                &motions,
                terms,
            );
            assert!(state.to_proto().encoded_len() <= DEMO_ACTIVITY_MAX_BYTES);
            assert_eq!(
                DemoActivityState::from_proto(&state.to_proto()),
                Some(state.clone()),
                "published state must satisfy semantic adapter"
            );
            state
        }
        fn armed() -> Self {
            let mut f = Self::new(-1.0, 1.0);
            assert_eq!(f.step(None, None, &[]).phase, DemoPhase::Separate);
            f
        }
        fn regroup() -> Self {
            let mut f = Self::armed();
            assert_eq!(
                f.step(Some(-3.25), Some(3.25), &[]).phase,
                DemoPhase::Regroup
            );
            f
        }
    }
    #[test]
    fn ready_far_positions_do_not_arm_or_award_pretravel() {
        let mut f = Fixture::new(-3.25, 3.25);
        let state = f.step(None, None, &[]);
        assert_eq!(state.phase, DemoPhase::Ready);
        assert_eq!(state.completed_rounds, 0);
        assert!(state.participants.iter().all(|p| p.earned_tick.is_none()));
        let state = f.step(Some(-1.0), Some(1.0), &[]);
        assert_eq!(state.phase, DemoPhase::Separate);
        assert!(state.participants.iter().all(|p| p.travel_mm == 0));
    }
    #[test]
    fn every_phase_requires_both_own_paths_and_net_contribution() {
        let mut f = Fixture::armed();
        let state = f.step(Some(-4.6), None, &[]);
        assert_eq!(state.phase, DemoPhase::Separate);
        assert!(state.participants[0].earned_tick.is_some());
        assert_eq!(state.participants[1].travel_mm, 0);
        // Peer motion alone crossed 5.5m. A later one-sided phase cannot claim it.
        assert_eq!(f.step(None, None, &[]).phase, DemoPhase::Separate);
        let mut f = Fixture::regroup();
        let state = f.step(Some(-1.0), None, &[]);
        assert_eq!(state.phase, DemoPhase::Regroup);
        assert!(state.participants[0].earned_tick.is_some());
        assert_eq!(state.participants[1].travel_mm, 0);
        assert_eq!(state.dwell_ticks, 0);
        for _ in 0..398 {
            f.step(None, None, &[]);
        }
        let state = f.step(None, None, &[]);
        assert_eq!(state.phase, DemoPhase::Suspended);
        assert_eq!(state.reason, DemoReason::NoProgress);
        assert_eq!(state.completed_rounds, 0);
    }
    #[test]
    fn oscillations_do_not_accumulate_positive_net_credit() {
        let mut f = Fixture::armed();
        f.step(Some(-1.8), Some(1.8), &[]);
        let state = f.step(Some(-1.0), Some(1.0), &[]);
        assert!(state
            .participants
            .iter()
            .all(|p| p.travel_mm == 1000 && p.contribution_mm == 0 && p.earned_tick.is_none()));
        assert_eq!(state.phase, DemoPhase::Separate);
    }
    #[test]
    fn regroup_resets_both_separation_proofs_and_cannot_reuse_old_motion() {
        let mut f = Fixture::regroup();
        let state = f.activity.state.clone();
        assert!(state
            .participants
            .iter()
            .all(|p| p.travel_mm == 0 && p.contribution_mm == 0 && p.earned_tick.is_none()));
        assert_eq!(state.credit_started_tick, Some(f.tick));
        for _ in 0..30 {
            assert_eq!(f.step(None, None, &[]).phase, DemoPhase::Regroup);
        }
        assert_eq!(f.activity.state.completed_rounds, 0);
    }
    #[test]
    fn five_second_unequal_arrival_keeps_stopped_earned_credit_and_completes_once() {
        let mut f = Fixture::regroup();
        let first = f.step(Some(-1.0), None, &[]);
        let earned = first.participants[0].earned_tick.unwrap();
        let stop = LeaseTermination {
            body_id: 1,
            aigent_id: b"a".to_vec(),
            reason: LeaseTerminationReason::Cancelled,
            conflicting_entity_id: None,
        };
        f.step(None, None, &[stop]);
        for _ in 0..98 {
            let state = f.step(None, None, &[]);
            assert_eq!(state.participants[0].earned_tick, Some(earned));
        }
        let arrived = f.step(None, Some(1.0), &[]);
        assert_eq!(arrived.phase, DemoPhase::Regroup);
        assert_eq!(arrived.dwell_ticks, 1);
        for _ in 0..6 {
            assert_eq!(f.step(None, None, &[]).phase, DemoPhase::Regroup);
        }
        let complete = f.step(None, None, &[]);
        assert_eq!(complete.phase, DemoPhase::Complete);
        assert_eq!(complete.completed_rounds, 1);
        assert_eq!(complete.dwell_ticks, 8);
        assert_eq!(complete.participants[0].earned_tick, Some(earned));
        assert!(complete.credit_started_tick.unwrap() < complete.phase_started_tick);
        let anchors = (complete.formation_center_mm, complete.formation_axis_mm);
        for _ in 0..20 {
            f.step(None, None, &[]);
        }
        assert_eq!(f.activity.state.phase, DemoPhase::Separate);
        assert_eq!(f.activity.state.completed_rounds, 1);
        assert_eq!(
            (
                f.activity.state.formation_center_mm,
                f.activity.state.formation_axis_mm
            ),
            anchors
        );
        assert!(f
            .activity
            .state
            .participants
            .iter()
            .all(|p| p.earned_tick.is_none()));
    }
    #[test]
    fn safe_dwell_is_consecutive_and_current_net_withdrawal_removes_proof() {
        let mut f = Fixture::regroup();
        f.step(Some(-1.0), Some(1.0), &[]);
        assert_eq!(f.step(None, None, &[]).dwell_ticks, 2);
        let withdrawn = f.step(Some(-2.5), None, &[]);
        assert_eq!(withdrawn.dwell_ticks, 0);
        assert!(withdrawn.participants[0].earned_tick.is_none());
        assert_eq!(withdrawn.phase, DemoPhase::Regroup);
        f.step(Some(-1.0), None, &[]);
        for _ in 0..6 {
            assert_eq!(f.step(None, None, &[]).phase, DemoPhase::Regroup);
        }
        assert_eq!(f.step(None, None, &[]).phase, DemoPhase::Complete);
        let count = f.activity.state.completed_rounds;
        let state = f.step(Some(-2.5), None, &[]);
        assert_eq!(state.phase, DemoPhase::Suspended);
        assert_eq!(state.completed_rounds, count);
        assert_eq!(state.reason, DemoReason::NoProgress);
    }
    #[test]
    fn external_pause_before_new_credit_times_out_without_completion() {
        let mut f = Fixture::regroup();
        f.step(None, Some(1.0), &[]);
        for _ in 0..399 {
            f.step(None, None, &[]);
        }
        assert_eq!(f.activity.state.phase, DemoPhase::Suspended);
        assert_eq!(f.activity.state.reason, DemoReason::NoProgress);
        assert_eq!(f.activity.state.completed_rounds, 0);
    }
    #[test]
    fn relocation_wrong_owner_and_lease_invalidation_suspend_before_completion() {
        for mode in 0..3 {
            let mut f = Fixture::regroup();
            let mut motions = BTreeMap::new();
            let before = f.entities[&1].position;
            f.entities.get_mut(&1).unwrap().position =
                PositionRequest::new(-1.0, 0.9, 0.0).validate().unwrap();
            if mode == 1 {
                motions.insert(
                    1,
                    DemoLeaseMotion {
                        owner: b"not-a".to_vec(),
                        before,
                        after: f.entities[&1].position,
                    },
                );
            }
            let terms = if mode == 2 {
                vec![LeaseTermination {
                    body_id: 2,
                    aigent_id: b"b".to_vec(),
                    reason: LeaseTerminationReason::Expired,
                    conflicting_entity_id: None,
                }]
            } else {
                vec![]
            };
            if mode == 2 {
                motions.insert(
                    1,
                    DemoLeaseMotion {
                        owner: b"a".to_vec(),
                        before,
                        after: f.entities[&1].position,
                    },
                );
            }
            let state = f.activity.advance(
                f.tick + 1,
                &f.bindings,
                (&f.entities, &RulesetParameters::catalog_defaults()),
                &f.presence,
                &motions,
                &terms,
            );
            assert_eq!(state.phase, DemoPhase::Suspended);
            assert_eq!(state.completed_rounds, 0);
            assert_eq!(
                state.reason,
                if mode == 2 {
                    DemoReason::LeaseInactive
                } else {
                    DemoReason::BodyChanged
                }
            );
        }
    }
    #[test]
    fn exact_epoch_guards_replacement_old_attach_and_stale_cleanup_and_recovers_without_leases() {
        let mut f = Fixture::regroup();
        f.step(Some(-1.0), None, &[]);
        assert!(f
            .presence
            .attach(b"a".to_vec(), b"new".to_vec(), b"sess-10".to_vec()));
        assert!(!f
            .presence
            .attach(b"a".to_vec(), b"old".to_vec(), b"sess-9".to_vec()));
        assert!(!f.presence.detach(b"a", b"ca", b"sess-1"));
        let state = f.step(None, None, &[]);
        assert_eq!(state.phase, DemoPhase::Suspended);
        assert_eq!(state.reason, DemoReason::SessionChanged);
        assert_eq!(state.reset_id, 1);
        assert!(state.formation_center_mm.is_none());
        for _ in 0..19 {
            assert_eq!(f.step(None, None, &[]).phase, DemoPhase::Suspended);
        }
        let state = f.step(None, None, &[]);
        assert_eq!(state.phase, DemoPhase::Ready);
        assert!(state.participants.iter().all(|p| p.earned_tick.is_none()));
        assert!(f.presence.detach(b"a", b"new", b"sess-10"));
        let state = f.step(None, None, &[]);
        assert_eq!(state.reason, DemoReason::ParticipantUnavailable);
        assert_eq!(state.reset_id, 2);
        let id = state.transition_id;
        for _ in 0..30 {
            let state = f.step(None, None, &[]);
            assert_eq!(state.reset_id, 2);
            assert_eq!(state.transition_id, id);
        }
    }
    #[test]
    fn reused_maximum_session_epoch_fails_presence_closed() {
        let mut f = Fixture::regroup();
        let epoch = format!("sess-{}", u64::MAX).into_bytes();
        assert!(f
            .presence
            .attach(b"a".to_vec(), b"max".to_vec(), epoch.clone()));
        assert!(!f
            .presence
            .attach(b"a".to_vec(), b"replacement".to_vec(), epoch));
        assert_eq!(
            f.step(None, None, &[]).reason,
            DemoReason::ParticipantUnavailable
        );
    }
    #[test]
    fn overlapping_unsupported_and_unreachable_anchors_fail_closed() {
        let mut f = Fixture::new(0.0, 0.5);
        assert_eq!(f.step(None, None, &[]).reason, DemoReason::UnsafeGeometry);
        let mut f = Fixture::new(-1.0, 1.0);
        f.entities.get_mut(&1).unwrap().shape = Some(shape(1500));
        assert_eq!(f.step(None, None, &[]).reason, DemoReason::UnsafeGeometry);
        let mut f = Fixture::new(6.0, 8.0);
        assert_eq!(f.step(None, None, &[]).reason, DemoReason::UnsafeGeometry);
    }
    #[test]
    fn checked_counter_exhaustion_has_no_duplicate_completion_or_transition() {
        let mut f = Fixture::regroup();
        f.activity.state.completed_rounds = u64::MAX;
        for t in &mut f.activity.state.recent_transitions {
            t.completed_rounds = u64::MAX;
        }
        f.step(Some(-1.0), Some(1.0), &[]);
        let transition = f.activity.state.transition_id;
        for _ in 0..7 {
            f.step(None, None, &[]);
        }
        assert_eq!(f.activity.state.reason, DemoReason::CounterExhausted);
        assert_eq!(f.activity.state.completed_rounds, u64::MAX);
        assert_eq!(f.activity.state.transition_id, transition);
        assert!(f.activity.state.credit_started_tick.is_none());
        for _ in 0..30 {
            f.step(None, None, &[]);
        }
        assert_eq!(f.activity.state.transition_id, transition);
    }
    #[test]
    fn transition_and_reset_exhaustion_clear_credit_without_reusing_keys() {
        let mut f = Fixture::armed();
        f.activity.state.transition_id = u64::MAX;
        f.activity.state.recent_transitions.back_mut().unwrap().id = u64::MAX;
        let state = f.step(Some(-3.25), Some(3.25), &[]);
        assert_eq!(state.reason, DemoReason::CounterExhausted);
        assert_eq!(state.transition_id, u64::MAX);
        assert_eq!(state.completed_rounds, 0);
        assert_eq!(state.recent_transitions.len(), 1);
        let mut f = Fixture::armed();
        f.activity.state.reset_id = u64::MAX;
        f.activity
            .state
            .recent_transitions
            .back_mut()
            .unwrap()
            .reset_id = u64::MAX;
        assert!(f.presence.detach(b"a", b"ca", b"sess-1"));
        let state = f.step(None, None, &[]);
        assert_eq!(state.reason, DemoReason::CounterExhausted);
        assert_eq!(state.reset_id, u64::MAX);
        assert_eq!(state.transition_id, 1);
        assert_eq!(state.recent_transitions.len(), 1);
        assert!(state.credit_started_tick.is_none());
    }
    #[test]
    fn malformed_activity_rejects_whole_rust_snapshot_adapter() {
        let mut f = Fixture::regroup();
        let valid = f.activity.state.to_proto();
        assert!(DemoActivityState::from_proto(&valid).is_some());
        let mut bad = valid.clone();
        bad.participants[0].travel_mm = 1000;
        bad.participants[0].contribution_mm = 1000;
        assert!(DemoActivityState::from_proto(&bad).is_none());
        let mut bad = valid.clone();
        bad.recent_transitions[1].completed_rounds = 1;
        assert!(DemoActivityState::from_proto(&bad).is_none());
        let mut bad = valid.clone();
        bad.participants.swap(0, 1);
        assert!(DemoActivityState::from_proto(&bad).is_none());
        let mut bad = valid.clone();
        bad.phase = 123;
        assert!(DemoActivityState::from_proto(&bad).is_none());
        f.step(Some(-1.0), Some(1.0), &[]);
        let mut bad = f.activity.state.to_proto();
        bad.participants[0].earned_tick = None;
        assert!(DemoActivityState::from_proto(&bad).is_none());
    }
    #[test]
    fn maximum_valid_state_history_fits_2048_encoded_bytes() {
        let mut f = Fixture::regroup();
        f.step(Some(-1.0), Some(1.0), &[]);
        for _ in 0..7 {
            f.step(None, None, &[]);
        }
        let mut state = f.activity.state.clone();
        state.observed_tick = u64::MAX;
        state.phase_started_tick = u64::MAX;
        state.credit_started_tick = Some(u64::MAX - 1);
        state.completed_rounds = u64::MAX;
        state.reset_id = u64::MAX;
        state.transition_id = u64::MAX;
        for (i, p) in state.participants.iter_mut().enumerate() {
            p.body_id = Some(u64::MAX - 1 + i as u64);
            p.phase_start_position_mm = Some(DemoPoint {
                x: 8000,
                y: 100_000_000,
                z: -8000,
            });
            p.earned_tick = Some(u64::MAX - 1);
            p.contribution_mm = 32000;
        }
        let edges = [
            (DemoPhase::Separate, DemoPhase::Regroup),
            (DemoPhase::Regroup, DemoPhase::Complete),
            (DemoPhase::Complete, DemoPhase::Separate),
            (DemoPhase::Separate, DemoPhase::Regroup),
            (DemoPhase::Regroup, DemoPhase::Complete),
            (DemoPhase::Complete, DemoPhase::Separate),
            (DemoPhase::Separate, DemoPhase::Regroup),
            (DemoPhase::Regroup, DemoPhase::Complete),
        ];
        state.recent_transitions.clear();
        let mut rounds = u64::MAX - 3;
        for (i, (from, to)) in edges.into_iter().enumerate() {
            if to == DemoPhase::Complete {
                rounds += 1;
            }
            state.recent_transitions.push_back(DemoTransition {
                id: u64::MAX - 7 + i as u64,
                tick: u64::MAX - 7 + i as u64,
                from,
                to,
                completed_rounds: rounds,
                reason: DemoReason::Normal,
                reset_id: u64::MAX,
            });
        }
        let proto = state.to_proto();
        assert!(proto.encoded_len() <= 2048, "{} bytes", proto.encoded_len());
        assert_eq!(DemoActivityState::from_proto(&proto), Some(state));
    }
}
