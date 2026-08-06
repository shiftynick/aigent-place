//! Persistence journals: in-memory (tests) and SQLite WAL (durable default).

mod async_writer;
mod codec;
mod memory;
mod sqlite;

pub use async_writer::{AsyncSqliteWriter, ASYNC_WRITER_QUEUE_CAP};
pub use memory::InMemoryJournal;
pub use sqlite::SqliteJournal;

use crate::entity::EntitySnapshot;
use crate::lease::LeaseSnapshot;
use crate::ruleset::{PendingRuleset, RulesetGeneration, RulesetParameters};
use std::collections::BTreeMap;
use std::path::Path;

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
    pub active_leases: BTreeMap<u64, LeaseSnapshot>,
    /// Authoritative entity table at commit time, ordered by unsigned ID.
    pub entities: BTreeMap<u64, EntitySnapshot>,
    /// Entity ID allocator state at commit time (ADR-0005 records allocator
    /// changes in the same transaction as the mutations that caused them).
    pub next_entity_id: u64,
    /// Integrity digest over the sealed packet fields.
    pub integrity_hex: String,
}

impl CommittedGeneration {
    /// Compute the integrity digest for the authoritative fields.
    #[must_use]
    pub fn compute_integrity_hex(&self) -> String {
        use sha2::{Digest, Sha256};
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
        hasher.update((self.entities.len() as u64).to_be_bytes());
        for (entity_id, entity) in &self.entities {
            hasher.update(entity_id.to_be_bytes());
            hasher.update(entity.entity_id.to_be_bytes());
            hasher.update(entity.revision.to_be_bytes());
            for bits in entity.position.to_bits() {
                hasher.update(bits.to_be_bytes());
            }
            match &entity.shape {
                Some(shape) => {
                    hasher.update([1]);
                    hasher.update((shape.len() as u64).to_be_bytes());
                    hasher.update(shape.as_bytes());
                }
                None => hasher.update([0]),
            }
        }
        hasher.update(self.next_entity_id.to_be_bytes());
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
    Storage(String),
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
            Self::Storage(message) => write!(f, "storage error: {message}"),
        }
    }
}

impl std::error::Error for JournalError {}

/// Durable journal backend used by the world core.
#[derive(Debug)]
pub enum DurableJournal {
    Memory(InMemoryJournal),
    Sqlite(SqliteJournal),
    /// SQLite owned by a dedicated writer thread (tick never awaits storage).
    AsyncSqlite(AsyncSqliteWriter),
}

impl DurableJournal {
    #[must_use]
    pub fn memory() -> Self {
        Self::Memory(InMemoryJournal::new())
    }

    /// Open or create a SQLite WAL journal at `path` (sync commits on the caller).
    pub fn sqlite(path: impl AsRef<Path>) -> Result<Self, JournalError> {
        Ok(Self::Sqlite(SqliteJournal::open(path)?))
    }

    /// Open SQLite and move commits onto the bounded async writer thread.
    pub fn async_sqlite(path: impl AsRef<Path>) -> Result<Self, JournalError> {
        Ok(Self::AsyncSqlite(AsyncSqliteWriter::spawn(path)?))
    }

    pub fn begin(&mut self, draft: CommittedGeneration) -> Result<(), JournalError> {
        match self {
            Self::Memory(journal) => journal.begin(draft),
            Self::Sqlite(journal) => journal.begin(draft),
            Self::AsyncSqlite(_) => Err(JournalError::Storage(
                "async sqlite uses try_submit, not begin/commit".into(),
            )),
        }
    }

    pub fn commit(&mut self) -> Result<&CommittedGeneration, JournalError> {
        match self {
            Self::Memory(journal) => journal.commit(),
            Self::Sqlite(journal) => journal.commit(),
            Self::AsyncSqlite(_) => Err(JournalError::Storage(
                "async sqlite uses try_submit, not begin/commit".into(),
            )),
        }
    }

    pub fn discard_pending(&mut self) {
        match self {
            Self::Memory(journal) => journal.discard_pending(),
            Self::Sqlite(journal) => journal.discard_pending(),
            Self::AsyncSqlite(_) => {}
        }
    }

    #[must_use]
    pub fn pending(&self) -> Option<&CommittedGeneration> {
        match self {
            Self::Memory(journal) => journal.pending(),
            Self::Sqlite(journal) => journal.pending(),
            Self::AsyncSqlite(_) => None,
        }
    }

    #[must_use]
    pub fn last_committed(&self) -> Option<&CommittedGeneration> {
        match self {
            Self::Memory(journal) => journal.last_committed(),
            Self::Sqlite(journal) => journal.last_committed(),
            Self::AsyncSqlite(writer) => writer.last_committed(),
        }
    }

    pub fn verify_committed(&self) -> Result<(), JournalError> {
        match self {
            Self::Memory(journal) => journal.verify_committed(),
            Self::Sqlite(journal) => journal.verify_committed(),
            Self::AsyncSqlite(writer) => {
                // Writer thread owns the live connection; reopen read-only via WAL.
                SqliteJournal::open(writer.path())?.verify_committed()
            }
        }
    }

    pub fn recover(&self) -> Result<RecoveredState, JournalError> {
        match self {
            Self::Memory(journal) => journal.recover(),
            Self::Sqlite(journal) => journal.recover(),
            Self::AsyncSqlite(writer) => SqliteJournal::open(writer.path())?.recover(),
        }
    }

    #[must_use]
    pub fn as_memory(&self) -> Option<&InMemoryJournal> {
        match self {
            Self::Memory(journal) => Some(journal),
            Self::Sqlite(_) | Self::AsyncSqlite(_) => None,
        }
    }

    pub fn as_memory_mut(&mut self) -> Option<&mut InMemoryJournal> {
        match self {
            Self::Memory(journal) => Some(journal),
            Self::Sqlite(_) | Self::AsyncSqlite(_) => None,
        }
    }

    #[must_use]
    pub fn as_async_sqlite_mut(&mut self) -> Option<&mut AsyncSqliteWriter> {
        match self {
            Self::AsyncSqlite(writer) => Some(writer),
            Self::Memory(_) | Self::Sqlite(_) => None,
        }
    }

    #[must_use]
    pub fn is_async(&self) -> bool {
        matches!(self, Self::AsyncSqlite(_))
    }
}

pub(crate) fn parameters_from_pairs(pairs: Vec<(String, i64)>) -> RulesetParameters {
    RulesetParameters::from_sorted_pairs(pairs)
}
