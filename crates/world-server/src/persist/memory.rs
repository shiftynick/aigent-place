//! In-memory single-writer persistence journal.

use super::{CommittedGeneration, JournalError, RecoveredState};

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
    pub fn recover(&self) -> Result<RecoveredState, JournalError> {
        self.verify_committed()?;
        Ok(RecoveredState {
            last_committed: self.committed.last().cloned(),
        })
    }
}
