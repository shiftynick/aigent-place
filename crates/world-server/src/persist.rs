//! In-memory single-writer persistence journal (skeleton; not SQLite).

use crate::ruleset::{PendingRuleset, RulesetGeneration};

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
    pub active_leases: std::collections::BTreeMap<u64, crate::lease::LeaseSnapshot>,
}

/// Recovered durable state after restart.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct RecoveredState {
    pub last_committed: Option<CommittedGeneration>,
}

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
    pub fn begin(&mut self, draft: CommittedGeneration) -> Result<(), &'static str> {
        if self.pending.is_some() {
            return Err("writer already has an uncommitted generation");
        }
        self.pending = Some(draft);
        Ok(())
    }

    /// Atomically commit the pending packet.
    pub fn commit(&mut self) -> Result<&CommittedGeneration, &'static str> {
        let packet = self.pending.take().ok_or("no pending generation")?;
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

    /// Restart reconstruction: last committed generation only (pending discarded).
    #[must_use]
    pub fn recover(&self) -> RecoveredState {
        RecoveredState {
            last_committed: self.committed.last().cloned(),
        }
    }
}
