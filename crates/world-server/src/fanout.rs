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
    SnapshotChannel, SnapshotResyncRequired, SnapshotStatus, StubSnapshotPayload,
};
use std::collections::HashMap;

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
    pub role: ConnectionRole,
    /// Active viewer AOI policy cap (ignored for aigents).
    pub viewer_aoi_cap: u32,
    /// Last delivered ordered interest set.
    pub interest: Vec<u64>,
    next_baseline: u64,
}

impl Default for ConnectionOutbound {
    fn default() -> Self {
        Self {
            queue: OutboundQueue::new(),
            snapshot: SnapshotChannel::new(),
            events: EventStreamCursor::default(),
            focus: FocusPoint::origin(),
            role: ConnectionRole::Viewer,
            viewer_aoi_cap: AOI_HARD_CAP,
            interest: Vec::new(),
            next_baseline: 1,
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

    /// Drain a mailbox generation into every attached connection.
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
        for id in ids {
            if let Some(outcome) = self.publish_to(&id, &generation, encoded_bytes) {
                outcomes.push((id, outcome));
            }
        }
        outcomes
    }

    /// Publish a stub full snapshot (or delta against live baseline) for one connection.
    pub fn publish_to(
        &mut self,
        connection_id: &[u8],
        generation: &ImmutableGeneration,
        encoded_bytes: Option<usize>,
    ) -> Option<PublishOutcome> {
        let connection = self.by_conn.get_mut(connection_id)?;
        if connection.queue.is_closed() {
            return Some(PublishOutcome::ConnectionClosed);
        }
        let payload = StubSnapshotPayload::from_generation(generation);
        let full_size = encoded_bytes.unwrap_or_else(|| payload.encoded_bytes());
        let delta_size = encoded_bytes.unwrap_or(32).min(full_size);

        let needs_full = connection.snapshot.baseline_id().is_none()
            || connection.snapshot.status() == SnapshotStatus::ResyncRequired;
        if needs_full {
            let enqueue = connection
                .queue
                .enqueue_state(full_size, StateKind::Full, full_size)?;
            let baseline = connection.next_baseline;
            connection.next_baseline = connection.next_baseline.saturating_add(1);
            connection.snapshot.install_full(baseline, payload);
            return Some(PublishOutcome::FullSnapshot {
                baseline_id: baseline,
                enqueue,
            });
        }

        let baseline = connection.snapshot.baseline_id().expect("live baseline");
        let enqueue = connection
            .queue
            .enqueue_state(delta_size, StateKind::Delta, full_size)?;
        // If coalescing promoted the item to Full, install a fresh baseline.
        if enqueue.kind == StateKind::Full && enqueue.coalesced {
            let new_baseline = connection.next_baseline;
            connection.next_baseline = connection.next_baseline.saturating_add(1);
            connection.snapshot.install_full(new_baseline, payload);
            return Some(PublishOutcome::FullSnapshot {
                baseline_id: new_baseline,
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
        let events_before = connection.events.clone();
        let payload = StubSnapshotPayload::from_generation(generation);
        let full_size = encoded_bytes.unwrap_or_else(|| payload.encoded_bytes());
        let enqueue = connection
            .queue
            .enqueue_state(full_size, StateKind::Full, full_size)?;
        let baseline = connection.next_baseline;
        connection.next_baseline = connection.next_baseline.saturating_add(1);
        let payload = connection.snapshot.request_resync(baseline, generation);
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
}
