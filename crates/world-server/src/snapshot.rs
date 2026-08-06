//! Per-connection snapshot baselines and full-resync recovery.
//!
//! Snapshot recovery must not mutate ordered-event stream cursors (protocol v1).

use crate::generation::ImmutableGeneration;
use crate::lease::LeaseSnapshot;
use aigent_protocol::SnapshotResyncReason;
use std::collections::BTreeSet;

/// Live vs waiting for a full snapshot.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum SnapshotStatus {
    Live,
    ResyncRequired,
}

/// Wire magic for the stub placeholder body list (`AIGB`).
pub const PLACEHOLDER_MAGIC: &[u8; 4] = b"AIGB";

/// Stub payload format version.
pub const PLACEHOLDER_VERSION: u8 = 1;

/// One placeholder body pose derived from an active lease (meters×1000 mm).
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct PlaceholderBody {
    pub body_id: u64,
    pub sequence: u64,
    pub x_mm: i64,
    pub y_mm: i64,
    pub z_mm: i64,
}

impl PlaceholderBody {
    /// Pose in canonical world metres (`f64`); the wire encoding is millimetres.
    #[must_use]
    pub fn position_m(&self) -> (f64, f64, f64) {
        (
            self.x_mm as f64 / 1000.0,
            self.y_mm as f64 / 1000.0,
            self.z_mm as f64 / 1000.0,
        )
    }
}

/// Stub full-snapshot payload derived from an immutable world generation.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct StubSnapshotPayload {
    pub generation: u64,
    pub tick: u64,
    pub digest: [u8; 32],
    pub bodies: Vec<PlaceholderBody>,
}

impl StubSnapshotPayload {
    /// Every active lease, in ascending `body_id` order, with no AOI truncation.
    ///
    /// Used by the workload harness and the protocol conformance oracles, which
    /// drive interest from their own candidate catalog. Live socket traffic uses
    /// [`Self::from_generation_interest`] so the AOI hard cap bounds delivered
    /// bytes.
    #[must_use]
    pub fn from_generation(generation: &ImmutableGeneration) -> Self {
        let bodies = generation
            .active_leases
            .values()
            .map(placeholder_body_from_lease)
            .collect();
        Self::with_bodies(generation, bodies)
    }

    /// Only the bodies named by `interest`, in that order (nearest focus first).
    ///
    /// `interest` is an ordered AOI survivor list. Ids without a live lease in
    /// this generation are skipped, so a stale interest set cannot resurrect a
    /// body whose lease has expired.
    #[must_use]
    pub fn from_generation_interest(generation: &ImmutableGeneration, interest: &[u64]) -> Self {
        let bodies = interest
            .iter()
            .filter_map(|body_id| generation.active_leases.get(body_id))
            .map(placeholder_body_from_lease)
            .collect();
        Self::with_bodies(generation, bodies)
    }

    fn with_bodies(generation: &ImmutableGeneration, bodies: Vec<PlaceholderBody>) -> Self {
        Self {
            generation: generation.generation,
            tick: generation.tick,
            digest: generation.digest(),
            bodies,
        }
    }

    /// Encode the viewer-facing stub payload (digest + placeholder bodies).
    #[must_use]
    pub fn encode_wire(&self) -> Vec<u8> {
        encode_placeholder_payload(self.tick, &self.digest, &self.bodies)
    }

    /// Deterministic logical encoded size for queue tests (not wire protobuf).
    #[must_use]
    pub fn encoded_bytes(&self) -> usize {
        self.encode_wire().len().max(64)
    }
}

/// Deterministic placeholder pose from a lease (sequence shifts X so MOVE is visible).
#[must_use]
pub fn placeholder_body_from_lease(lease: &LeaseSnapshot) -> PlaceholderBody {
    let x_mm = ((lease.body_id % 40) as i64 - 20) * 2_000 + (lease.sequence as i64) * 500;
    let z_mm = (((lease.body_id / 40) % 40) as i64 - 20) * 2_000;
    PlaceholderBody {
        body_id: lease.body_id,
        sequence: lease.sequence,
        x_mm,
        y_mm: 500,
        z_mm,
    }
}

/// Encode stub payload: magic, version, tick, digest, then body poses.
#[must_use]
pub fn encode_placeholder_payload(
    tick: u64,
    digest: &[u8; 32],
    bodies: &[PlaceholderBody],
) -> Vec<u8> {
    let mut out = Vec::with_capacity(4 + 1 + 8 + 32 + 4 + bodies.len() * 40);
    out.extend_from_slice(PLACEHOLDER_MAGIC);
    out.push(PLACEHOLDER_VERSION);
    out.extend_from_slice(&tick.to_be_bytes());
    out.extend_from_slice(digest);
    out.extend_from_slice(&(bodies.len() as u32).to_be_bytes());
    for body in bodies {
        out.extend_from_slice(&body.body_id.to_be_bytes());
        out.extend_from_slice(&body.sequence.to_be_bytes());
        out.extend_from_slice(&body.x_mm.to_be_bytes());
        out.extend_from_slice(&body.y_mm.to_be_bytes());
        out.extend_from_slice(&body.z_mm.to_be_bytes());
    }
    out
}

/// Decode a stub placeholder payload. Returns `None` when the bytes are not the stub format.
#[must_use]
pub fn decode_placeholder_payload(bytes: &[u8]) -> Option<(u64, [u8; 32], Vec<PlaceholderBody>)> {
    if bytes.len() < 4 + 1 + 8 + 32 + 4 {
        return None;
    }
    if &bytes[0..4] != PLACEHOLDER_MAGIC {
        return None;
    }
    if bytes[4] != PLACEHOLDER_VERSION {
        return None;
    }
    let tick = u64::from_be_bytes(bytes[5..13].try_into().ok()?);
    let mut digest = [0u8; 32];
    digest.copy_from_slice(&bytes[13..45]);
    let count = u32::from_be_bytes(bytes[45..49].try_into().ok()?) as usize;
    let mut cursor = 49;
    let mut bodies = Vec::with_capacity(count);
    for _ in 0..count {
        if bytes.len() < cursor + 40 {
            return None;
        }
        let body_id = u64::from_be_bytes(bytes[cursor..cursor + 8].try_into().ok()?);
        let sequence = u64::from_be_bytes(bytes[cursor + 8..cursor + 16].try_into().ok()?);
        let x_mm = i64::from_be_bytes(bytes[cursor + 16..cursor + 24].try_into().ok()?);
        let y_mm = i64::from_be_bytes(bytes[cursor + 24..cursor + 32].try_into().ok()?);
        let z_mm = i64::from_be_bytes(bytes[cursor + 32..cursor + 40].try_into().ok()?);
        cursor += 40;
        bodies.push(PlaceholderBody {
            body_id,
            sequence,
            x_mm,
            y_mm,
            z_mm,
        });
    }
    Some((tick, digest, bodies))
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

    /// Why a delta against `baseline_id` cannot be applied, if it cannot.
    ///
    /// Non-mutating, so a caller can learn which frame it is about to emit
    /// before charging outbound bytes for it. [`Self::deliver_delta`] answers
    /// the same question and records the outcome.
    #[must_use]
    pub(crate) fn delta_rejection(
        &self,
        baseline_id: Option<u64>,
    ) -> Option<SnapshotResyncRequired> {
        let retained_ok = baseline_id.is_some_and(|id| self.retained_baselines.contains(&id));
        if self.baseline_id == baseline_id && retained_ok {
            return None;
        }
        let reason = match baseline_id {
            None => SnapshotResyncReason::BaselineMissing,
            Some(id) if self.baseline_id != Some(id) => SnapshotResyncReason::BaselineMismatched,
            Some(_) => SnapshotResyncReason::BaselineExpired,
        };
        Some(SnapshotResyncRequired {
            reason,
            requested_baseline_id: baseline_id,
        })
    }

    /// Record that this channel needs a full snapshot before deltas resume.
    pub(crate) fn require_resync(&mut self) {
        self.status = SnapshotStatus::ResyncRequired;
    }

    /// Attempt to deliver a delta against `baseline_id`, updating the last payload.
    pub fn deliver_delta(
        &mut self,
        baseline_id: Option<u64>,
        payload: StubSnapshotPayload,
    ) -> Result<(), SnapshotResyncRequired> {
        if let Some(required) = self.delta_rejection(baseline_id) {
            self.require_resync();
            return Err(required);
        }
        self.last_payload = Some(payload);
        Ok(())
    }
}
