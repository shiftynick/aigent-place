//! Off-tick snapshot fan-out from immutable world generations.
//!
//! The simulation stage publishes into [`PublicationMailbox`] without waiting.
//! A separate serialization stage drains the mailbox into [`SnapshotFanout`].

use crate::aoi::{
    aoi_cap_for_role, interest_diff, truncate_nearest, AoiEntity, AoiError, FocusPoint,
    InterestDiff, AOI_HARD_CAP,
};
use crate::generation::ImmutableGeneration;
use crate::outbound::{EnqueueStateOutcome, ObserveOutcome, OutboundQueue, StateKind};
use crate::session::ConnectionRole;
use crate::snapshot::{
    placeholder_body_from_lease, SnapshotChannel, SnapshotResyncRequired, SnapshotStatus,
    StubSnapshotPayload,
};
use crate::wire::{
    encode_world_snapshot_body, encode_world_snapshot_delta, RealEntityRecord, SnapshotEncodeError,
    WorldSnapshotBody, WorldSnapshotDelta,
};
use std::collections::{BTreeMap, HashMap, HashSet};

/// Logical delta size charged by the non-socket sizing modes.
///
/// The harness and the conformance oracles never encode a wire frame, so they
/// model a delta as a small replaceable item. Socket traffic must not use this:
/// the stub delta carries the whole payload on the wire.
const LOGICAL_DELTA_BYTES: usize = 32;

/// Logical sizing for the retained placeholder conformance and pressure fixtures.
/// Live sockets use the real-body encoder and exact retained frame lengths.
#[derive(Clone, Copy)]
pub(crate) enum StateSizing {
    /// Charge the payload's own logical encoded size.
    Payload,
    /// Charge one fixed size for every state item (pressure fixtures).
    Fixed(usize),
}

impl std::fmt::Debug for StateSizing {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::Payload => f.write_str("StateSizing::Payload"),
            Self::Fixed(bytes) => write!(f, "StateSizing::Fixed({bytes})"),
        }
    }
}

impl StateSizing {
    /// The logical sizing an `Option<usize>` caller asks for: `None` measures
    /// the payload, `Some(n)` charges `n` for every state item.
    #[must_use]
    pub(crate) fn logical(encoded_bytes: Option<usize>) -> Self {
        match encoded_bytes {
            Some(bytes) => Self::Fixed(bytes),
            None => Self::Payload,
        }
    }

    fn full_bytes(&self, payload: &StubSnapshotPayload, _baseline_id: u64) -> usize {
        match self {
            Self::Payload => payload.encoded_bytes(),
            Self::Fixed(bytes) => *bytes,
        }
    }

    fn delta_bytes(
        &self,
        _payload: &StubSnapshotPayload,
        _baseline_id: u64,
        full_bytes: usize,
    ) -> usize {
        match self {
            Self::Payload => LOGICAL_DELTA_BYTES.min(full_bytes),
            Self::Fixed(bytes) => (*bytes).min(full_bytes),
        }
    }

    /// Bytes for a publish that will emit a resync notice instead of state.
    ///
    /// Placeholder fixtures retain their logical delta charge for this notice.
    fn resync_bytes(
        &self,
        _notice: &SnapshotResyncRequired,
        payload: &StubSnapshotPayload,
        baseline_id: u64,
    ) -> usize {
        match self {
            Self::Payload | Self::Fixed(_) => {
                let full_bytes = self.full_bytes(payload, baseline_id);
                self.delta_bytes(payload, baseline_id, full_bytes)
            }
        }
    }
}

/// AOI candidates for one generation: the placeholder body of every active lease.
///
/// `active_leases` is a `BTreeMap` keyed by `body_id`, so the candidate list is
/// deterministic and free of duplicate ids by construction.
fn aoi_candidates(generation: &ImmutableGeneration) -> Vec<AoiEntity> {
    generation
        .active_leases
        .values()
        .map(|lease| {
            let body = placeholder_body_from_lease(lease);
            let (x, y, z) = body.position_m();
            AoiEntity::new(body.body_id, x, y, z)
        })
        .collect()
}

/// Hand-off from tick thread to serialization stage.
///
/// Capacity-1 `sync_channel`: `try_send` never waits on fan-out. When the
/// mailbox is full, the undrained generation is dropped and replaced.
#[derive(Debug)]
pub struct PublicationMailbox {
    tx: std::sync::mpsc::SyncSender<ImmutableGeneration>,
    rx: std::sync::Mutex<std::sync::mpsc::Receiver<ImmutableGeneration>>,
    pending: std::sync::atomic::AtomicBool,
}

impl Default for PublicationMailbox {
    fn default() -> Self {
        let (tx, rx) = std::sync::mpsc::sync_channel(1);
        Self {
            tx,
            rx: std::sync::Mutex::new(rx),
            pending: std::sync::atomic::AtomicBool::new(false),
        }
    }
}

impl PublicationMailbox {
    #[must_use]
    pub fn new() -> Self {
        Self::default()
    }

    /// Called from the simulation stage after publishing an immutable generation.
    pub fn publish_from_tick(&self, generation: ImmutableGeneration) {
        match self.tx.try_send(generation) {
            Ok(()) => {
                self.pending
                    .store(true, std::sync::atomic::Ordering::Release);
            }
            Err(std::sync::mpsc::TrySendError::Full(generation)) => {
                let _ = self
                    .rx
                    .lock()
                    .unwrap_or_else(std::sync::PoisonError::into_inner)
                    .try_recv();
                if self.tx.try_send(generation).is_ok() {
                    self.pending
                        .store(true, std::sync::atomic::Ordering::Release);
                }
            }
            Err(std::sync::mpsc::TrySendError::Disconnected(_)) => {}
        }
    }

    /// Called from the serialization stage; returns the newest undrained generation.
    pub fn take(&self) -> Option<ImmutableGeneration> {
        match self
            .rx
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner)
            .try_recv()
        {
            Ok(generation) => {
                self.pending
                    .store(false, std::sync::atomic::Ordering::Release);
                Some(generation)
            }
            Err(
                std::sync::mpsc::TryRecvError::Empty | std::sync::mpsc::TryRecvError::Disconnected,
            ) => {
                self.pending
                    .store(false, std::sync::atomic::Ordering::Release);
                None
            }
        }
    }

    #[must_use]
    pub fn has_pending(&self) -> bool {
        self.pending.load(std::sync::atomic::Ordering::Acquire)
    }
}

/// Minimal ordered-event cursor retained only to prove snapshot resync
/// does not mutate the event stream.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct EventStreamCursor {
    pub epoch: u64,
    pub next_sequence: u64,
}

impl Default for EventStreamCursor {
    fn default() -> Self {
        Self {
            epoch: 1,
            next_sequence: 1,
        }
    }
}

/// Per-connection outbound + snapshot state.
#[derive(Debug, Clone)]
pub struct ConnectionOutbound {
    pub queue: OutboundQueue,
    pub snapshot: SnapshotChannel,
    pub events: EventStreamCursor,
    /// Interest focus for AOI truncation (viewer camera / aigent body origin).
    pub focus: FocusPoint,
    /// Body whose live pose drives [`Self::focus`] (an aigent's own body).
    ///
    /// `None` leaves the focus wherever it was last set. Protocol v1 carries no
    /// viewer camera, so spectators keep the default origin focus.
    pub focus_body_id: Option<u64>,
    pub role: ConnectionRole,
    /// Active viewer AOI policy cap (ignored for aigents).
    pub viewer_aoi_cap: u32,
    /// Last delivered ordered interest set.
    pub interest: Vec<u64>,
    /// When true, skip observe publish until the matching resync full is written.
    pub hold_observe: bool,
    /// Client→server message IDs already accepted on this connection.
    pub seen_client_message_ids: HashSet<u64>,
    /// Last delivered interest set keyed by entity id, with the wire records.
    ///
    /// The real-body publish path keeps a map so the next diff can be built
    /// without a second pass over the world. Two fields (the `Vec` and the
    /// `BTreeMap`) coexist because the stub path and the real path are run by
    /// separate callers; mixing them in one collection would force both to
    /// agree on a value type.
    pub interest_real: BTreeMap<u64, RealEntityRecord>,
    next_baseline: u64,
    latest_real_body: Option<WorldSnapshotBody>,
}

impl Default for ConnectionOutbound {
    fn default() -> Self {
        Self {
            queue: OutboundQueue::new(),
            snapshot: SnapshotChannel::new(),
            events: EventStreamCursor::default(),
            focus: FocusPoint::origin(),
            focus_body_id: None,
            role: ConnectionRole::Viewer,
            viewer_aoi_cap: AOI_HARD_CAP,
            interest: Vec::new(),
            interest_real: BTreeMap::new(),
            hold_observe: false,
            seen_client_message_ids: HashSet::new(),
            next_baseline: 1,
            latest_real_body: None,
        }
    }
}

impl ConnectionOutbound {
    /// Refresh interest from a candidate catalog; returns enter/leave vs prior set.
    pub fn refresh_interest(
        &mut self,
        entities: &[AoiEntity],
    ) -> Result<(Vec<u64>, InterestDiff), AoiError> {
        let cap = aoi_cap_for_role(self.role, self.viewer_aoi_cap);
        let next = if entities.len()
            > usize::try_from(AOI_HARD_CAP)
                .unwrap_or(100)
                .saturating_mul(2)
        {
            let mut hash = crate::aoi::SpatialHash::new(16.0);
            hash.insert_all(entities.iter().copied());
            hash.nearest(self.focus, cap)?
        } else {
            truncate_nearest(entities, self.focus, cap)?
        };
        let diff = interest_diff(&self.interest, &next);
        self.interest = next.clone();
        Ok((next, diff))
    }

    /// Move the focus onto the tracked body's pose in this generation.
    ///
    /// A tracked body with no live lease (not yet granted, or expired) leaves
    /// the previous focus in place rather than snapping the connection back to
    /// the world origin mid-session.
    fn track_focus(&mut self, generation: &ImmutableGeneration) {
        let Some(body_id) = self.focus_body_id else {
            return;
        };
        let Some(lease) = generation.active_leases.get(&body_id) else {
            return;
        };
        let (x, y, z) = placeholder_body_from_lease(lease).position_m();
        self.focus = FocusPoint::new(x, y, z);
    }

    /// Move the focus onto the tracked body's *entity* pose in this generation.
    ///
    /// A tracked body that has no entity record (rev zero, not yet created)
    /// leaves the previous focus in place rather than snapping the connection
    /// back to the world origin mid-session. This is the real-body counterpart
    /// to [`Self::track_focus`].
    fn track_focus_real(&mut self, generation: &ImmutableGeneration) {
        let Some(body_id) = self.focus_body_id else {
            return;
        };
        let Some(entity) = generation.entities.get(&body_id) else {
            return;
        };
        self.focus = FocusPoint::new(
            entity.position.x(),
            entity.position.y(),
            entity.position.z(),
        );
    }
}

/// Fan-out registry keyed by opaque connection id bytes.
#[derive(Debug, Default, Clone)]
pub struct SnapshotFanout {
    by_conn: HashMap<Vec<u8>, ConnectionOutbound>,
}

impl SnapshotFanout {
    #[must_use]
    pub fn new() -> Self {
        Self::default()
    }

    pub fn attach(&mut self, connection_id: Vec<u8>) {
        self.by_conn.entry(connection_id).or_default();
    }

    /// Remove a connection's outbound state (socket closed).
    pub fn detach(&mut self, connection_id: &[u8]) {
        self.by_conn.remove(connection_id);
    }

    #[must_use]
    pub fn connection_ids(&self) -> Vec<Vec<u8>> {
        self.by_conn.keys().cloned().collect()
    }

    #[must_use]
    pub fn get(&self, connection_id: &[u8]) -> Option<&ConnectionOutbound> {
        self.by_conn.get(connection_id)
    }

    pub fn get_mut(&mut self, connection_id: &[u8]) -> Option<&mut ConnectionOutbound> {
        self.by_conn.get_mut(connection_id)
    }

    /// Update one connection's AOI from a candidate catalog (serialization stage).
    pub fn refresh_interest(
        &mut self,
        connection_id: &[u8],
        entities: &[AoiEntity],
    ) -> Option<Result<(Vec<u64>, InterestDiff), AoiError>> {
        Some(self.get_mut(connection_id)?.refresh_interest(entities))
    }

    /// Drain a mailbox generation into every attached connection, AOI-truncated.
    ///
    /// Logical sizing only. A frame measurer is bound to one connection's
    /// envelope and message id, so it cannot size a fan-out across many
    /// connections; a caller that owns sockets drives
    /// [`Self::publish_real_interest_to`] per connection with a frame measurer.
    pub fn drain_mailbox(
        &mut self,
        mailbox: &PublicationMailbox,
        encoded_bytes: Option<usize>,
    ) -> Vec<(Vec<u8>, PublishOutcome)> {
        let Some(generation) = mailbox.take() else {
            return Vec::new();
        };
        let ids: Vec<Vec<u8>> = self.by_conn.keys().cloned().collect();
        let mut outcomes = Vec::new();
        let sizing = StateSizing::logical(encoded_bytes);
        for id in ids {
            if let Some(outcome) = self.publish_interest_to(&id, &generation, sizing) {
                outcomes.push((id, outcome));
            }
        }
        outcomes
    }

    /// Publish every active lease to one connection, without AOI truncation.
    ///
    /// Retained for the workload harness and the protocol conformance oracles,
    /// which drive interest from their own candidate catalog. Connection
    /// fan-out must use [`Self::publish_interest_to`] so the AOI hard cap
    /// applies to what actually reaches a socket.
    pub fn publish_to(
        &mut self,
        connection_id: &[u8],
        generation: &ImmutableGeneration,
        encoded_bytes: Option<usize>,
    ) -> Option<PublishOutcome> {
        let payload = StubSnapshotPayload::from_generation(generation);
        self.publish_payload_to(connection_id, payload, StateSizing::logical(encoded_bytes))
    }

    /// Fan-out publish: track the connection's focus body, truncate the
    /// candidate set nearest-first under the role's AOI cap, and publish only
    /// the surviving bodies in interest order.
    ///
    /// The refresh's [`InterestDiff`] is deliberately dropped here: the stub
    /// payload is a flat body list with nowhere to carry enter/leave records.
    /// Truncation therefore makes a body's absence ambiguous — it may have left
    /// the interest set or lost its lease — which ARCHITECTURE "Message
    /// families" forbids for delta percepts. Carrying those records needs a
    /// payload-format revision on both the Rust and viewer sides and is tracked
    /// as its own task; the cap is enforced here in the meantime because an
    /// unbounded fan-out breaks a hard workload limit.
    ///
    /// `sizing` retains logical payload or fixed fixture accounting. The live
    /// transport uses [`Self::publish_real_interest_to`] and measures each envelope.
    pub(crate) fn publish_interest_to(
        &mut self,
        connection_id: &[u8],
        generation: &ImmutableGeneration,
        sizing: StateSizing,
    ) -> Option<PublishOutcome> {
        let connection = self.by_conn.get_mut(connection_id)?;
        if connection.queue.is_closed() {
            return Some(PublishOutcome::ConnectionClosed);
        }
        // Checked before the refresh: a held connection delivers nothing, and
        // recording an interest set it never received would hide the later
        // enter diff for those bodies.
        if connection.hold_observe {
            return None;
        }
        connection.track_focus(generation);
        let interest = match connection.refresh_interest(&aoi_candidates(generation)) {
            Ok((interest, _diff)) => interest,
            Err(error) => return Some(PublishOutcome::InterestUnavailable { error }),
        };
        let payload = StubSnapshotPayload::from_generation_interest(generation, &interest);
        self.publish_payload_to(connection_id, payload, sizing)
    }

    /// Queue one already-built payload as a full snapshot, or as a delta against
    /// the connection's live baseline.
    ///
    /// Each item is sized against the baseline id the frame will actually carry,
    /// so a frame-sizing caller charges exactly the bytes it goes on to write.
    fn publish_payload_to(
        &mut self,
        connection_id: &[u8],
        payload: StubSnapshotPayload,
        sizing: StateSizing,
    ) -> Option<PublishOutcome> {
        let connection = self.by_conn.get_mut(connection_id)?;
        if connection.queue.is_closed() {
            return Some(PublishOutcome::ConnectionClosed);
        }
        if connection.hold_observe {
            return None;
        }

        let needs_full = connection.snapshot.baseline_id().is_none()
            || connection.snapshot.status() == SnapshotStatus::ResyncRequired;
        if needs_full {
            let baseline = connection.next_baseline;
            let full_size = sizing.full_bytes(&payload, baseline);
            let enqueue = connection
                .queue
                .enqueue_state(full_size, StateKind::Full, full_size)?;
            connection.next_baseline = connection.next_baseline.saturating_add(1);
            connection.snapshot.install_full(baseline, payload);
            return Some(PublishOutcome::FullSnapshot {
                baseline_id: baseline,
                enqueue,
            });
        }

        let baseline = connection.snapshot.baseline_id().expect("live baseline");
        // Decided before anything is charged: a delta this baseline cannot carry
        // puts a small resync notice on the wire, not a state payload, so the
        // queue must be charged the notice rather than the delta it replaces.
        //
        // This deliberately outranks the coalesce promotion below. An unusable
        // baseline previously reached that promotion first and could answer an
        // over-limit connection with a fresh full snapshot; answering with the
        // notice instead pushes far fewer bytes into a queue that is already at
        // its limit, at the cost of one tick of latency. The connection is left
        // in `ResyncRequired`, so the next publish takes the `needs_full`
        // branch. The two orderings differ only when adding a notice would
        // itself cross the limit, which takes a queue within a few bytes of it.
        if let Some(notice) = connection.snapshot.delta_rejection(Some(baseline)) {
            let notice_size = sizing.resync_bytes(&notice, &payload, baseline);
            // `StateKind::Delta` keeps the notice replaceable; the queue may
            // relabel it `Full` when coalescing drops a queued snapshot, which
            // charges the same bytes and cannot change what the socket receives.
            let enqueue =
                connection
                    .queue
                    .enqueue_state(notice_size, StateKind::Delta, notice_size)?;
            connection.snapshot.require_resync();
            return Some(PublishOutcome::ResyncRequired {
                required: notice,
                enqueue,
            });
        }

        // A coalesce that drops the queued full snapshot promotes this item to a
        // fresh baseline, so the promoted size is measured against the id that
        // promotion would assign rather than the delta's current baseline.
        let promoted_baseline = connection.next_baseline;
        let full_size = sizing.full_bytes(&payload, promoted_baseline);
        let delta_size = sizing.delta_bytes(&payload, baseline, full_size);
        let enqueue = connection
            .queue
            .enqueue_state(delta_size, StateKind::Delta, full_size)?;
        // If coalescing promoted the item to Full, install a fresh baseline.
        if enqueue.kind == StateKind::Full && enqueue.coalesced {
            connection.next_baseline = connection.next_baseline.saturating_add(1);
            connection.snapshot.install_full(promoted_baseline, payload);
            return Some(PublishOutcome::FullSnapshot {
                baseline_id: promoted_baseline,
                enqueue,
            });
        }
        match connection.snapshot.deliver_delta(Some(baseline), payload) {
            Ok(()) => Some(PublishOutcome::Delta {
                baseline_id: baseline,
                enqueue,
            }),
            Err(required) => Some(PublishOutcome::ResyncRequired { required, enqueue }),
        }
    }

    /// Client/server full resync; enqueues through the outbound queue.
    ///
    /// The fresh baseline carries the same interest-truncated body set a normal
    /// publish would deliver, so a resync cannot smuggle the whole world past
    /// the AOI cap. Returns `None` when the connection is gone, its queue is
    /// closed, or its AOI policy rejects the refresh; in every case no baseline
    /// is allocated and nothing is queued.
    pub fn client_resync(
        &mut self,
        connection_id: &[u8],
        generation: &ImmutableGeneration,
        encoded_bytes: Option<usize>,
    ) -> Option<(
        u64,
        StubSnapshotPayload,
        EventStreamCursor,
        EnqueueStateOutcome,
    )> {
        let connection = self.by_conn.get_mut(connection_id)?;
        if connection.queue.is_closed() {
            return None;
        }
        connection.track_focus(generation);
        let (interest, _diff) = connection
            .refresh_interest(&aoi_candidates(generation))
            .ok()?;
        let events_before = connection.events.clone();
        let payload = StubSnapshotPayload::from_generation_interest(generation, &interest);
        let full_size = encoded_bytes.unwrap_or_else(|| payload.encoded_bytes());
        let enqueue = connection
            .queue
            .enqueue_state(full_size, StateKind::Full, full_size)?;
        let baseline = connection.next_baseline;
        connection.next_baseline = connection.next_baseline.saturating_add(1);
        let payload = connection.snapshot.install_full(baseline, payload);
        assert_eq!(connection.events, events_before);
        Some((baseline, payload, connection.events.clone(), enqueue))
    }

    /// Observe every open connection for the given simulation tick.
    pub fn observe_all_at(&mut self, tick: u64) -> Vec<(Vec<u8>, ObserveOutcome)> {
        let mut outcomes = Vec::new();
        for (id, connection) in &mut self.by_conn {
            outcomes.push((id.clone(), connection.queue.observe_at(tick)));
        }
        outcomes
    }
}

/// Result of publishing generation state toward one connection.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum PublishOutcome {
    FullSnapshot {
        baseline_id: u64,
        enqueue: EnqueueStateOutcome,
    },
    Delta {
        baseline_id: u64,
        enqueue: EnqueueStateOutcome,
    },
    ResyncRequired {
        required: SnapshotResyncRequired,
        enqueue: EnqueueStateOutcome,
    },
    ConnectionClosed,
    /// AOI truncation could not run for this connection (typed policy error,
    /// such as a zero viewer cap). Nothing is queued and no bodies are
    /// delivered; publishing the untruncated payload instead would breach the
    /// hard cap.
    InterestUnavailable {
        error: AoiError,
    },
}

// ----------------------------------------------------------------------------
// Real-body path (task-054)
// ----------------------------------------------------------------------------
//
// task-054 replaces the `StubSnapshotPayload` (AIGB placeholder) on the live
// path. The new payloads are `WorldSnapshotBody` (full snapshot) and
// `WorldSnapshotDelta` (delta with explicit enter/leave). AOI candidates are
// taken from the entity store rather than from active leases: a body that is
// not in the entity table has no record to carry on the wire, so a payload
// that ranked from leases would emit bodies the receiver cannot resolve.
//
// The stub path above remains for the workload harness and the protocol
// conformance oracles, which drive interest from their own candidate catalog
// and never see the live wire format.

/// AOI candidates from the entity store: every authoritative body in the
/// generation, with its canonical `f64` metre position.
fn aoi_candidates_from_entities(generation: &ImmutableGeneration) -> Vec<AoiEntity> {
    generation
        .entities
        .values()
        .map(|entity| {
            AoiEntity::new(
                entity.entity_id,
                entity.position.x(),
                entity.position.y(),
                entity.position.z(),
            )
        })
        .collect()
}

/// Diff between two interest sets, in the terms the wire layer needs.
///
/// `entered` and `modified` carry the full `RealEntityRecord` so the wire can
/// emit either; `left_ids` carries the entity_id alone because the
/// leave record is deliberately stripped down (no shape tree re-emit, no
/// mm re-send). ARCHITECTURE §4 requires that leave is never inferred from
/// absence; this set is the explicit source.
#[derive(Debug, Clone, PartialEq)]
pub struct RealInterestDiff {
    pub entered: Vec<RealEntityRecord>,
    pub modified: Vec<RealEntityRecord>,
    pub left_ids: Vec<u64>,
}

#[derive(Debug)]
enum RealInterestError {
    Aoi(AoiError),
    Encoding(SnapshotEncodeError),
}

impl ConnectionOutbound {
    /// Construct the next interest and diff without changing delivered state.
    fn prepare_real_interest(
        &self,
        generation: &ImmutableGeneration,
    ) -> Result<
        (
            WorldSnapshotBody,
            BTreeMap<u64, RealEntityRecord>,
            RealInterestDiff,
        ),
        RealInterestError,
    > {
        let cap = aoi_cap_for_role(self.role, self.viewer_aoi_cap);
        let next = truncate_nearest(&aoi_candidates_from_entities(generation), self.focus, cap)
            .map_err(RealInterestError::Aoi)?;
        let mut records = BTreeMap::new();
        let mut bodies = Vec::with_capacity(next.len());
        let mut diff = RealInterestDiff {
            entered: Vec::new(),
            modified: Vec::new(),
            left_ids: Vec::new(),
        };
        for entity_id in next {
            let record = RealEntityRecord::from_snapshot(
                generation
                    .entities
                    .get(&entity_id)
                    .expect("ranked entity exists"),
            )
            .map_err(RealInterestError::Encoding)?;
            match self.interest_real.get(&entity_id) {
                None => diff.entered.push(record.clone()),
                Some(prior) if prior != &record => diff.modified.push(record.clone()),
                Some(_) => {}
            }
            bodies.push(record.clone());
            records.insert(entity_id, record);
        }
        diff.left_ids.extend(
            self.interest_real
                .keys()
                .filter(|id| !records.contains_key(id))
                .copied(),
        );
        Ok((
            WorldSnapshotBody {
                tick: generation.tick,
                generation_digest: generation.digest(),
                bodies,
            },
            records,
            diff,
        ))
    }

    fn queue_real_full(
        &mut self,
        body: WorldSnapshotBody,
        byte_measure: &(dyn Fn(&RealFrameShape<'_>) -> usize + Sync),
    ) -> Option<RealPublishOutcome> {
        let baseline_id = self.next_baseline;
        let full_size = byte_measure(&RealFrameShape::Full {
            baseline_id,
            body: &body,
        });
        self.queue
            .enqueue_state(full_size, StateKind::Full, full_size)?;
        self.next_baseline = self.next_baseline.saturating_add(1);
        self.snapshot.install_real_full(baseline_id, body.clone());
        Some(RealPublishOutcome::FullSnapshot {
            baseline_id,
            wire_bytes: encode_world_snapshot_body(&body),
            body,
        })
    }
}

/// Result of a real-path publish.
#[derive(Debug)]
pub enum RealPublishOutcome {
    /// A full snapshot carrying `WorldSnapshotBody` was queued.
    FullSnapshot {
        baseline_id: u64,
        body: WorldSnapshotBody,
        wire_bytes: Vec<u8>,
    },
    /// A delta carrying `WorldSnapshotDelta` was queued.
    Delta {
        baseline_id: u64,
        delta: WorldSnapshotDelta,
        wire_bytes: Vec<u8>,
    },
    /// A resync-required notice was queued; no state reached the wire.
    ResyncRequired {
        required: SnapshotResyncRequired,
    },
    ConnectionClosed,
    /// Authoritative state could not produce a complete snapshot.
    EncodingFailed {
        error: SnapshotEncodeError,
    },
    /// AOI truncation could not run for this connection.
    InterestUnavailable {
        error: AoiError,
    },
}

impl SnapshotFanout {
    /// Publish complete real-body state or an explicit failure. Incremental
    /// records remain ordered; replacing queued transitions requires a full body.
    pub fn publish_real_interest_to(
        &mut self,
        connection_id: &[u8],
        generation: &ImmutableGeneration,
        byte_measure: &(dyn Fn(&RealFrameShape<'_>) -> usize + Sync),
    ) -> Option<RealPublishOutcome> {
        let connection = self.by_conn.get_mut(connection_id)?;
        if connection.queue.is_closed() {
            return Some(RealPublishOutcome::ConnectionClosed);
        }
        if connection.hold_observe {
            return None;
        }
        connection.track_focus_real(generation);
        let (body, records, diff) = match connection.prepare_real_interest(generation) {
            Ok(prepared) => prepared,
            Err(RealInterestError::Aoi(error)) => {
                return Some(RealPublishOutcome::InterestUnavailable { error })
            }
            Err(RealInterestError::Encoding(error)) => {
                connection.snapshot.require_resync();
                return Some(RealPublishOutcome::EncodingFailed { error });
            }
        };
        if connection.snapshot.baseline_id().is_none()
            || connection.snapshot.status() == SnapshotStatus::ResyncRequired
        {
            let outcome = connection.queue_real_full(body.clone(), byte_measure)?;
            connection.interest_real = records;
            connection.latest_real_body = Some(body);
            return Some(outcome);
        }
        let baseline_id = connection.snapshot.baseline_id().expect("live baseline");
        if let Some(required) = connection.snapshot.delta_rejection(Some(baseline_id)) {
            let size = byte_measure(&RealFrameShape::ResyncRequired { notice: &required });
            connection
                .queue
                .enqueue_state(size, StateKind::Delta, size)?;
            connection.snapshot.require_resync();
            return Some(RealPublishOutcome::ResyncRequired { required });
        }
        let delta = WorldSnapshotDelta {
            generation_digest: generation.digest(),
            entered: diff.entered,
            modified: diff.modified,
            left_ids: diff.left_ids,
        };
        let delta_size = byte_measure(&RealFrameShape::Delta {
            baseline_id,
            delta: &delta,
        });
        let full_size = byte_measure(&RealFrameShape::Full {
            baseline_id: connection.next_baseline,
            body: &body,
        });
        let enqueue = connection
            .queue
            .enqueue_state(delta_size, StateKind::Delta, full_size)?;
        let outcome = if enqueue.coalesced {
            // Logical replacement and physical replacement use this same full
            // artifact, even if every prior queued state frame was a delta.
            let baseline_id = connection.next_baseline;
            connection.next_baseline = connection.next_baseline.saturating_add(1);
            connection
                .snapshot
                .install_real_full(baseline_id, body.clone());
            RealPublishOutcome::FullSnapshot {
                baseline_id,
                wire_bytes: encode_world_snapshot_body(&body),
                body: body.clone(),
            }
        } else {
            if let Err(required) = connection
                .snapshot
                .deliver_real_delta(Some(baseline_id), delta.clone())
            {
                return Some(RealPublishOutcome::ResyncRequired { required });
            }
            RealPublishOutcome::Delta {
                baseline_id,
                wire_bytes: encode_world_snapshot_delta(&delta),
                delta,
            }
        };
        connection.interest_real = records;
        connection.latest_real_body = Some(body);
        Some(outcome)
    }

    /// Promote pending state when ordered traffic causes byte pressure.
    pub(crate) fn coalesce_real_pending(
        &mut self,
        connection_id: &[u8],
        byte_measure: &(dyn Fn(&RealFrameShape<'_>) -> usize + Sync),
    ) -> Option<RealPublishOutcome> {
        let connection = self.by_conn.get_mut(connection_id)?;
        if connection.snapshot.status() != SnapshotStatus::Live {
            return None;
        }
        let body = connection.latest_real_body.clone()?;
        connection.queue_real_full(body, byte_measure)
    }

    /// Construct a fresh complete baseline. Failed encoding preserves the old
    /// baseline and interest, and exposes a typed recovery failure.
    pub fn client_resync_real(
        &mut self,
        connection_id: &[u8],
        generation: &ImmutableGeneration,
        byte_measure: &(dyn Fn(&RealFrameShape<'_>) -> usize + Sync),
    ) -> Result<
        Option<(
            u64,
            WorldSnapshotBody,
            EventStreamCursor,
            EnqueueStateOutcome,
        )>,
        SnapshotEncodeError,
    > {
        let Some(connection) = self.by_conn.get_mut(connection_id) else {
            return Ok(None);
        };
        if connection.queue.is_closed() {
            return Ok(None);
        }
        connection.track_focus_real(generation);
        let (body, records, _) = match connection.prepare_real_interest(generation) {
            Ok(prepared) => prepared,
            Err(RealInterestError::Aoi(_)) => return Ok(None),
            Err(RealInterestError::Encoding(error)) => {
                connection.snapshot.require_resync();
                return Err(error);
            }
        };
        let baseline = connection.next_baseline;
        let full_size = byte_measure(&RealFrameShape::Full {
            baseline_id: baseline,
            body: &body,
        });
        let Some(enqueue) = connection
            .queue
            .enqueue_state(full_size, StateKind::Full, full_size)
        else {
            return Ok(None);
        };
        connection.next_baseline = connection.next_baseline.saturating_add(1);
        connection
            .snapshot
            .install_real_full(baseline, body.clone());
        connection.interest_real = records;
        connection.latest_real_body = Some(body.clone());
        Ok(Some((baseline, body, connection.events.clone(), enqueue)))
    }
}

/// Wire frame shape the real-body publish must size against.
#[derive(Debug, Clone, Copy)]
pub enum RealFrameShape<'a> {
    /// A full snapshot under `baseline_id`.
    Full {
        baseline_id: u64,
        body: &'a WorldSnapshotBody,
    },
    /// A delta against `baseline_id`.
    Delta {
        baseline_id: u64,
        delta: &'a WorldSnapshotDelta,
    },
    /// A resync-required notice. No state reached the wire.
    ResyncRequired { notice: &'a SnapshotResyncRequired },
}
