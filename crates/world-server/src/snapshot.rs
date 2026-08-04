//! Per-connection snapshot baselines and full-resync recovery.
//!
//! Snapshot recovery must not mutate ordered-event stream cursors (protocol v1).

use crate::generation::ImmutableGeneration;
use aigent_protocol::SnapshotResyncReason;
use std::collections::BTreeSet;

/// Live vs waiting for a full snapshot.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum SnapshotStatus {
    Live,
    ResyncRequired,
}

/// Stub full-snapshot payload derived from an immutable world generation.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct StubSnapshotPayload {
    pub generation: u64,
    pub tick: u64,
    pub digest: [u8; 32],
}

impl StubSnapshotPayload {
    #[must_use]
    pub fn from_generation(generation: &ImmutableGeneration) -> Self {
        Self {
            generation: generation.generation,
            tick: generation.tick,
            digest: generation.digest(),
        }
    }

    /// Deterministic logical encoded size for queue tests (not wire protobuf).
    #[must_use]
    pub fn encoded_bytes(&self) -> usize {
        64 + self.digest.len()
    }
}

/// Outcome when a delta cannot be applied against the installed baseline.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct SnapshotResyncRequired {
    pub reason: SnapshotResyncReason,
    pub requested_baseline_id: Option<u64>,
}

/// Per-connection snapshot baseline channel.
#[derive(Debug, Clone)]
pub struct SnapshotChannel {
    baseline_id: Option<u64>,
    retained_baselines: BTreeSet<u64>,
    status: SnapshotStatus,
    last_payload: Option<StubSnapshotPayload>,
}

impl Default for SnapshotChannel {
    fn default() -> Self {
        Self::new()
    }
}

impl SnapshotChannel {
    #[must_use]
    pub fn new() -> Self {
        Self {
            baseline_id: None,
            retained_baselines: BTreeSet::new(),
            status: SnapshotStatus::Live,
            last_payload: None,
        }
    }

    #[must_use]
    pub fn status(&self) -> SnapshotStatus {
        self.status
    }

    #[must_use]
    pub fn baseline_id(&self) -> Option<u64> {
        self.baseline_id
    }

    #[must_use]
    pub fn last_payload(&self) -> Option<&StubSnapshotPayload> {
        self.last_payload.as_ref()
    }

    /// Install a full snapshot and a new baseline id.
    pub fn install_full(
        &mut self,
        new_baseline_id: u64,
        payload: StubSnapshotPayload,
    ) -> StubSnapshotPayload {
        self.baseline_id = Some(new_baseline_id);
        self.retained_baselines = BTreeSet::from([new_baseline_id]);
        self.status = SnapshotStatus::Live;
        self.last_payload = Some(payload.clone());
        payload
    }

    /// Drop a retained baseline (models client/server baseline loss).
    pub fn expire_baseline(&mut self, baseline_id: u64) {
        self.retained_baselines.remove(&baseline_id);
    }

    /// Attempt to deliver a delta against `baseline_id`, updating the last payload.
    pub fn deliver_delta(
        &mut self,
        baseline_id: Option<u64>,
        payload: StubSnapshotPayload,
    ) -> Result<(), SnapshotResyncRequired> {
        let retained_ok = baseline_id.is_some_and(|id| self.retained_baselines.contains(&id));
        if self.baseline_id != baseline_id || !retained_ok {
            let reason = match baseline_id {
                None => SnapshotResyncReason::BaselineMissing,
                Some(id) if self.baseline_id != Some(id) => {
                    SnapshotResyncReason::BaselineMismatched
                }
                Some(_) => SnapshotResyncReason::BaselineExpired,
            };
            self.status = SnapshotStatus::ResyncRequired;
            return Err(SnapshotResyncRequired {
                reason,
                requested_baseline_id: baseline_id,
            });
        }
        self.last_payload = Some(payload);
        Ok(())
    }

    /// Client- or server-initiated full resync after baseline failure.
    pub fn request_resync(
        &mut self,
        new_baseline_id: u64,
        generation: &ImmutableGeneration,
    ) -> StubSnapshotPayload {
        self.install_full(
            new_baseline_id,
            StubSnapshotPayload::from_generation(generation),
        )
    }
}
