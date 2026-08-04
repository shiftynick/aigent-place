//! SQLite WAL durable journal (single-writer generation packets).

use super::codec::{decode_generation, encode_generation};
use super::{CommittedGeneration, JournalError, RecoveredState};
use rusqlite::{params, Connection};
use std::path::{Path, PathBuf};

/// SQLite-backed journal. Pending generations stay in memory until `commit`
/// writes them in one WAL transaction (crash before commit has no durable effect).
#[derive(Debug)]
pub struct SqliteJournal {
    path: PathBuf,
    conn: Connection,
    pending: Option<CommittedGeneration>,
    /// Cached last committed packet for cheap accessors after commit.
    last: Option<CommittedGeneration>,
}

impl SqliteJournal {
    pub fn open(path: impl AsRef<Path>) -> Result<Self, JournalError> {
        let path = path.as_ref().to_path_buf();
        if let Some(parent) = path.parent() {
            if !parent.as_os_str().is_empty() {
                std::fs::create_dir_all(parent).map_err(|error| {
                    JournalError::Storage(format!("create journal dir: {error}"))
                })?;
            }
        }
        let conn = Connection::open(&path)
            .map_err(|error| JournalError::Storage(format!("open sqlite: {error}")))?;
        conn.pragma_update(None, "journal_mode", "WAL")
            .map_err(|error| JournalError::Storage(format!("wal pragma: {error}")))?;
        conn.pragma_update(None, "synchronous", "NORMAL")
            .map_err(|error| JournalError::Storage(format!("sync pragma: {error}")))?;
        conn.execute_batch(
            "CREATE TABLE IF NOT EXISTS generations (
                generation INTEGER PRIMARY KEY NOT NULL,
                payload BLOB NOT NULL,
                integrity_hex TEXT NOT NULL
            );",
        )
        .map_err(|error| JournalError::Storage(format!("create schema: {error}")))?;

        let mut journal = Self {
            path,
            conn,
            pending: None,
            last: None,
        };
        journal.reload_last()?;
        journal.verify_committed()?;
        Ok(journal)
    }

    #[must_use]
    pub fn path(&self) -> &Path {
        &self.path
    }

    pub fn begin(&mut self, mut draft: CommittedGeneration) -> Result<(), JournalError> {
        if self.pending.is_some() {
            return Err(JournalError::WriterBusy);
        }
        draft.seal();
        self.pending = Some(draft);
        Ok(())
    }

    pub fn commit(&mut self) -> Result<&CommittedGeneration, JournalError> {
        let packet = self.pending.take().ok_or(JournalError::NoPending)?;
        if !packet.integrity_ok() {
            return Err(JournalError::CorruptCommitted {
                generation: packet.generation,
            });
        }
        let payload = encode_generation(&packet)?;
        let expected = self
            .last
            .as_ref()
            .map(|last| last.generation.saturating_add(1))
            .unwrap_or(1);
        if packet.generation != expected {
            return Err(JournalError::GenerationGap {
                expected,
                found: packet.generation,
            });
        }
        let tx = self
            .conn
            .unchecked_transaction()
            .map_err(|error| JournalError::Storage(format!("begin tx: {error}")))?;
        tx.execute(
            "INSERT INTO generations (generation, payload, integrity_hex) VALUES (?1, ?2, ?3)",
            params![packet.generation as i64, payload, packet.integrity_hex],
        )
        .map_err(|error| JournalError::Storage(format!("insert generation: {error}")))?;
        tx.commit()
            .map_err(|error| JournalError::Storage(format!("commit tx: {error}")))?;
        self.last = Some(packet);
        Ok(self.last.as_ref().expect("just stored"))
    }

    pub fn discard_pending(&mut self) {
        self.pending = None;
    }

    #[must_use]
    pub fn pending(&self) -> Option<&CommittedGeneration> {
        self.pending.as_ref()
    }

    #[must_use]
    pub fn last_committed(&self) -> Option<&CommittedGeneration> {
        self.last.as_ref()
    }

    pub fn verify_committed(&self) -> Result<(), JournalError> {
        let packets = self.load_all()?;
        let mut expected = 1u64;
        for packet in &packets {
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

    pub fn recover(&self) -> Result<RecoveredState, JournalError> {
        self.verify_committed()?;
        Ok(RecoveredState {
            last_committed: self.load_all()?.into_iter().next_back(),
        })
    }

    /// Test helper: overwrite the last row's integrity_hex without changing payload.
    pub fn corrupt_last_integrity_for_test(&self) -> Result<bool, JournalError> {
        let changed = self
            .conn
            .execute(
                "UPDATE generations SET integrity_hex = ?1
                 WHERE generation = (SELECT MAX(generation) FROM generations)",
                params!["00".repeat(32)],
            )
            .map_err(|error| JournalError::Storage(format!("corrupt integrity: {error}")))?;
        Ok(changed > 0)
    }

    /// Test helper: rewrite last payload with a sealed packet whose digest does
    /// not match the mutated fields (semantic corruption with matching columns).
    pub fn corrupt_last_semantics_for_test(&self) -> Result<bool, JournalError> {
        let mut packets = self.load_all_unchecked_for_test()?;
        let Some(last) = packets.last_mut() else {
            return Ok(false);
        };
        last.world_value = last.world_value.saturating_add(1);
        // Keep integrity_hex stale so integrity_ok fails.
        let generation = last.generation;
        let integrity_hex = last.integrity_hex.clone();
        let payload = encode_generation(last)?;
        self.conn
            .execute(
                "UPDATE generations SET payload = ?1, integrity_hex = ?2 WHERE generation = ?3",
                params![payload, integrity_hex, generation as i64],
            )
            .map_err(|error| JournalError::Storage(format!("write semantic corrupt: {error}")))?;
        Ok(true)
    }

    /// Test helper: insert a gapped generation row after the last commit.
    pub fn push_gapped_committed_for_test(
        &self,
        mut packet: CommittedGeneration,
    ) -> Result<(), JournalError> {
        packet.seal();
        let payload = encode_generation(&packet)?;
        self.conn
            .execute(
                "INSERT INTO generations (generation, payload, integrity_hex) VALUES (?1, ?2, ?3)",
                params![packet.generation as i64, payload, packet.integrity_hex],
            )
            .map_err(|error| JournalError::Storage(format!("insert gapped: {error}")))?;
        Ok(())
    }

    fn load_all_unchecked_for_test(&self) -> Result<Vec<CommittedGeneration>, JournalError> {
        let mut stmt = self
            .conn
            .prepare(
                "SELECT generation, payload, integrity_hex FROM generations ORDER BY generation ASC",
            )
            .map_err(|error| JournalError::Storage(format!("prepare load: {error}")))?;
        let rows = stmt
            .query_map([], |row| {
                Ok((
                    row.get::<_, i64>(0)?,
                    row.get::<_, Vec<u8>>(1)?,
                    row.get::<_, String>(2)?,
                ))
            })
            .map_err(|error| JournalError::Storage(format!("query generations: {error}")))?;
        let mut packets = Vec::new();
        for row in rows {
            let (_generation, payload, _integrity_hex) =
                row.map_err(|error| JournalError::Storage(format!("row: {error}")))?;
            packets.push(decode_generation(&payload)?);
        }
        Ok(packets)
    }

    /// Test helper: flip one payload byte so decode or integrity fails closed.
    pub fn corrupt_last_payload_for_test(&self) -> Result<bool, JournalError> {
        let mut stmt = self
            .conn
            .prepare(
                "SELECT generation, payload FROM generations
                 ORDER BY generation DESC LIMIT 1",
            )
            .map_err(|error| JournalError::Storage(format!("prepare corrupt: {error}")))?;
        let row = stmt
            .query_row([], |row| {
                Ok((row.get::<_, i64>(0)?, row.get::<_, Vec<u8>>(1)?))
            })
            .optional_storage()?;
        let Some((generation, mut payload)) = row else {
            return Ok(false);
        };
        if payload.is_empty() {
            return Ok(false);
        }
        let last = payload.len() - 1;
        payload[last] ^= 0xff;
        self.conn
            .execute(
                "UPDATE generations SET payload = ?1 WHERE generation = ?2",
                params![payload, generation],
            )
            .map_err(|error| JournalError::Storage(format!("write corrupt payload: {error}")))?;
        Ok(true)
    }

    fn reload_last(&mut self) -> Result<(), JournalError> {
        self.last = self.load_all()?.into_iter().next_back();
        Ok(())
    }

    fn load_all(&self) -> Result<Vec<CommittedGeneration>, JournalError> {
        let mut stmt = self
            .conn
            .prepare(
                "SELECT generation, payload, integrity_hex FROM generations ORDER BY generation ASC",
            )
            .map_err(|error| JournalError::Storage(format!("prepare load: {error}")))?;
        let rows = stmt
            .query_map([], |row| {
                Ok((
                    row.get::<_, i64>(0)?,
                    row.get::<_, Vec<u8>>(1)?,
                    row.get::<_, String>(2)?,
                ))
            })
            .map_err(|error| JournalError::Storage(format!("query generations: {error}")))?;

        let mut packets = Vec::new();
        for row in rows {
            let (generation, payload, integrity_hex) =
                row.map_err(|error| JournalError::Storage(format!("row: {error}")))?;
            let packet = match decode_generation(&payload) {
                Ok(decoded) => {
                    if decoded.generation != generation as u64
                        || decoded.integrity_hex != integrity_hex
                        || !decoded.integrity_ok()
                    {
                        return Err(JournalError::CorruptCommitted {
                            generation: generation as u64,
                        });
                    }
                    decoded
                }
                Err(_) => {
                    return Err(JournalError::CorruptCommitted {
                        generation: generation as u64,
                    });
                }
            };
            packets.push(packet);
        }
        Ok(packets)
    }
}

trait OptionalStorage<T> {
    fn optional_storage(self) -> Result<Option<T>, JournalError>;
}

impl<T> OptionalStorage<T> for Result<T, rusqlite::Error> {
    fn optional_storage(self) -> Result<Option<T>, JournalError> {
        match self {
            Ok(value) => Ok(Some(value)),
            Err(rusqlite::Error::QueryReturnedNoRows) => Ok(None),
            Err(error) => Err(JournalError::Storage(format!("query: {error}"))),
        }
    }
}
