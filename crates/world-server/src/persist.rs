//! In-memory single-writer persistence journal (skeleton; not SQLite).

use crate::ruleset::{PendingRuleset, RulesetGeneration};
use sha2::{Digest, Sha256};
use std::collections::BTreeMap;

/// One committed generation packet in canonical command order.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct CommittedGeneration {
    pub generation: u64,
    pub world_value: i64,
    pub ruleset: RulesetGeneration,
    pub pending_ruleset: Option<PendingRuleset>,
    /// Applied command summaries in canonical order.
    pub command_summaries: Vec<String>,
    /// Active leases at commit time.
    pub active_leases: BTreeMap<u64, crate::lease::LeaseSnapshot>,
    /// Integrity digest over the sealed packet fields.
    pub integrity_hex: String,
}

impl CommittedGeneration {
    /// Compute the integrity digest for the authoritative fields.
    #[must_use]
    pub fn compute_integrity_hex(&self) -> String {
        let mut hasher = Sha256::new();
        hasher.update(b"aigent.journal.generation.v1\0");
        hasher.update(self.generation.to_be_bytes());
        hasher.update(self.world_value.to_be_bytes());
        hasher.update(self.ruleset.generation_id.to_be_bytes());
        hasher.update(self.ruleset.activated_tick.to_be_bytes());
        for (path, value) in self.ruleset.parameters.values_for_digest() {
            hasher.update((path.len() as u32).to_be_bytes());
            hasher.update(path.as_bytes());
            hasher.update(value.to_be_bytes());
        }
        if let Some(pending) = &self.pending_ruleset {
            hasher.update([1]);
            hasher.update(pending.generation_id.to_be_bytes());
            hasher.update(pending.activate_at_tick.to_be_bytes());
            for (path, value) in pending.parameters.values_for_digest() {
                hasher.update((path.len() as u32).to_be_bytes());
                hasher.update(path.as_bytes());
                hasher.update(value.to_be_bytes());
            }
        } else {
            hasher.update([0]);
        }
        hasher.update((self.command_summaries.len() as u64).to_be_bytes());
        for summary in &self.command_summaries {
            hasher.update((summary.len() as u32).to_be_bytes());
            hasher.update(summary.as_bytes());
        }
        hasher.update((self.active_leases.len() as u64).to_be_bytes());
        for (body_id, lease) in &self.active_leases {
            hasher.update(body_id.to_be_bytes());
            hasher.update(lease.body_id.to_be_bytes());
            hasher.update((lease.aigent_id.len() as u32).to_be_bytes());
            hasher.update(lease.aigent_id.as_slice());
            hasher.update(lease.sequence.to_be_bytes());
            hasher.update(lease.granted_tick.to_be_bytes());
            hasher.update(lease.expire_tick.to_be_bytes());
        }
        hex::encode(hasher.finalize())
    }

    /// Seal the packet by filling `integrity_hex`.
    pub fn seal(&mut self) {
        self.integrity_hex = self.compute_integrity_hex();
    }

    #[must_use]
    pub fn integrity_ok(&self) -> bool {
        !self.integrity_hex.is_empty() && self.integrity_hex == self.compute_integrity_hex()
    }
}

/// Recovered durable state after restart.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct RecoveredState {
    pub last_committed: Option<CommittedGeneration>,
}

/// Journal integrity / recovery failures.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum JournalError {
    WriterBusy,
    NoPending,
    CorruptCommitted { generation: u64 },
    GenerationGap { expected: u64, found: u64 },
}

impl std::fmt::Display for JournalError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::WriterBusy => write!(f, "writer already has an uncommitted generation"),
            Self::NoPending => write!(f, "no pending generation"),
            Self::CorruptCommitted { generation } => {
                write!(f, "corrupt committed generation {generation}")
            }
            Self::GenerationGap { expected, found } => {
                write!(f, "generation gap: expected {expected}, found {found}")
            }
        }
    }
}

impl std::error::Error for JournalError {}

/// Single-writer in-memory journal.
#[derive(Debug, Default, Clone)]
pub struct InMemoryJournal {
    committed: Vec<CommittedGeneration>,
    /// At most one uncommitted pending packet.
    pending: Option<CommittedGeneration>,
}

impl InMemoryJournal {
    #[must_use]
    pub fn new() -> Self {
        Self::default()
    }

    /// Begin a generation packet. Fails if another is already uncommitted.
    pub fn begin(&mut self, mut draft: CommittedGeneration) -> Result<(), JournalError> {
        if self.pending.is_some() {
            return Err(JournalError::WriterBusy);
        }
        draft.seal();
        self.pending = Some(draft);
        Ok(())
    }

    /// Atomically commit the pending packet.
    pub fn commit(&mut self) -> Result<&CommittedGeneration, JournalError> {
        let packet = self.pending.take().ok_or(JournalError::NoPending)?;
        if !packet.integrity_ok() {
            return Err(JournalError::CorruptCommitted {
                generation: packet.generation,
            });
        }
        self.committed.push(packet);
        Ok(self.committed.last().expect("just pushed"))
    }

    /// Discard the uncommitted tail (crash before commit).
    pub fn discard_pending(&mut self) {
        self.pending = None;
    }

    #[must_use]
    pub fn pending(&self) -> Option<&CommittedGeneration> {
        self.pending.as_ref()
    }

    #[must_use]
    pub fn last_committed(&self) -> Option<&CommittedGeneration> {
        self.committed.last()
    }

    /// Test helper: append a sealed committed record.
    pub fn push_committed_for_test(&mut self, mut packet: CommittedGeneration) {
        packet.seal();
        self.committed.push(packet);
    }

    /// Test helper: corrupt the last committed integrity digest in place.
    pub fn corrupt_last_committed_integrity_for_test(&mut self) -> bool {
        if let Some(last) = self.committed.last_mut() {
            last.integrity_hex = "00".repeat(32);
            true
        } else {
            false
        }
    }

    /// Test helper: insert a generation gap after the last commit.
    pub fn push_gapped_committed_for_test(&mut self, mut packet: CommittedGeneration) {
        packet.seal();
        self.committed.push(packet);
    }

    /// Test helper: append an incomplete committed record (never sealed).
    /// Models a truncated/partial write that never finished the integrity seal.
    pub fn push_incomplete_committed_for_test(&mut self, mut packet: CommittedGeneration) {
        packet.integrity_hex.clear();
        self.committed.push(packet);
    }

    /// Test helper: truncate the last committed integrity digest mid-string.
    pub fn truncate_last_committed_integrity_for_test(&mut self) -> bool {
        if let Some(last) = self.committed.last_mut() {
            if last.integrity_hex.len() > 8 {
                last.integrity_hex.truncate(8);
                return true;
            }
        }
        false
    }

    /// Verify contiguous sealed commits starting at generation 1.
    pub fn verify_committed(&self) -> Result<(), JournalError> {
        let mut expected = 1u64;
        for packet in &self.committed {
            if packet.generation != expected {
                return Err(JournalError::GenerationGap {
                    expected,
                    found: packet.generation,
                });
            }
            if !packet.integrity_ok() {
                return Err(JournalError::CorruptCommitted {
                    generation: packet.generation,
                });
            }
            expected = expected.saturating_add(1);
        }
        Ok(())
    }

    /// Restart reconstruction: last committed generation only (pending discarded).
    /// Fails closed on corrupt or gapped committed history.
    pub fn recover(&self) -> Result<RecoveredState, JournalError> {
        self.verify_committed()?;
        Ok(RecoveredState {
            last_committed: self.committed.last().cloned(),
        })
    }
}
