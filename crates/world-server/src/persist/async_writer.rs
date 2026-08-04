//! Bounded single-writer task for SQLite generation commits (ADR-0005).
//!
//! The simulation stage enqueues a sealed packet and continues; this thread
//! owns the SQLite connection and never runs on the tick path.

use super::sqlite::SqliteJournal;
use super::{CommittedGeneration, JournalError};
use std::path::{Path, PathBuf};
use std::sync::mpsc::{sync_channel, Receiver, SyncSender, TryRecvError, TrySendError};
use std::thread::{self, JoinHandle};
use std::time::Duration;

/// At most one uncommitted generation may be in flight (ADR-0005).
pub const ASYNC_WRITER_QUEUE_CAP: usize = 1;

struct CommitJob {
    packet: CommittedGeneration,
    fail: Option<JournalError>,
    delay: Option<Duration>,
}

enum WriterRequest {
    Commit(CommitJob),
    Shutdown,
}

enum WriterEvent {
    Committed(CommittedGeneration),
    Failed {
        generation: u64,
        error: JournalError,
    },
}

/// Client handle for the async SQLite writer thread.
#[derive(Debug)]
pub struct AsyncSqliteWriter {
    request_tx: SyncSender<WriterRequest>,
    event_rx: Receiver<WriterEvent>,
    join: Option<JoinHandle<()>>,
    last: Option<CommittedGeneration>,
    in_flight: Option<u64>,
    path: PathBuf,
    inject_fail: Option<JournalError>,
    inject_delay: Option<Duration>,
}

impl AsyncSqliteWriter {
    /// Open SQLite at `path` and spawn the dedicated writer thread.
    pub fn spawn(path: impl AsRef<Path>) -> Result<Self, JournalError> {
        let path = path.as_ref().to_path_buf();
        let journal = SqliteJournal::open(&path)?;
        let last = journal.last_committed().cloned();
        let (request_tx, request_rx) = sync_channel(ASYNC_WRITER_QUEUE_CAP);
        let (event_tx, event_rx) = sync_channel(ASYNC_WRITER_QUEUE_CAP);
        let join = thread::Builder::new()
            .name("aigent-durable-writer".into())
            .spawn(move || writer_loop(journal, request_rx, event_tx))
            .map_err(|error| JournalError::Storage(format!("spawn writer: {error}")))?;
        Ok(Self {
            request_tx,
            event_rx,
            join: Some(join),
            last,
            in_flight: None,
            path,
            inject_fail: None,
            inject_delay: None,
        })
    }

    #[must_use]
    pub fn path(&self) -> &Path {
        &self.path
    }

    #[must_use]
    pub fn in_flight(&self) -> bool {
        self.in_flight.is_some()
    }

    #[must_use]
    pub fn last_committed(&self) -> Option<&CommittedGeneration> {
        self.last.as_ref()
    }

    /// Non-blocking submit. Returns [`JournalError::WriterBusy`] when a
    /// generation is already in flight or the queue is full.
    pub fn try_submit(&mut self, packet: CommittedGeneration) -> Result<(), JournalError> {
        if self.in_flight.is_some() {
            return Err(JournalError::WriterBusy);
        }
        let generation = packet.generation;
        let job = CommitJob {
            packet,
            fail: self.inject_fail.take(),
            delay: self.inject_delay.take(),
        };
        match self.request_tx.try_send(WriterRequest::Commit(job)) {
            Ok(()) => {
                self.in_flight = Some(generation);
                Ok(())
            }
            Err(TrySendError::Full(_)) => Err(JournalError::WriterBusy),
            Err(TrySendError::Disconnected(_)) => {
                self.in_flight = None;
                Err(JournalError::Storage("durable writer disconnected".into()))
            }
        }
    }

    /// Poll for a completed commit without blocking.
    pub fn try_poll(&mut self) -> Result<Option<CommittedGeneration>, JournalError> {
        match self.event_rx.try_recv() {
            Ok(WriterEvent::Committed(packet)) => {
                self.in_flight = None;
                self.last = Some(packet.clone());
                Ok(Some(packet))
            }
            Ok(WriterEvent::Failed { generation, error }) => {
                self.in_flight = None;
                let _ = generation;
                Err(error)
            }
            Err(TryRecvError::Empty) => Ok(None),
            Err(TryRecvError::Disconnected) => {
                self.in_flight = None;
                Err(JournalError::Storage("durable writer disconnected".into()))
            }
        }
    }

    /// Test helper: next commit fails with `error`.
    pub fn inject_fail_next(&mut self, error: JournalError) {
        self.inject_fail = Some(error);
    }

    /// Test helper: delay the next commit (models locked/slow storage).
    pub fn inject_delay_next(&mut self, delay: Duration) {
        self.inject_delay = Some(delay);
    }
}

impl Drop for AsyncSqliteWriter {
    fn drop(&mut self) {
        let _ = self.request_tx.send(WriterRequest::Shutdown);
        if let Some(join) = self.join.take() {
            let _ = join.join();
        }
    }
}

fn writer_loop(
    mut journal: SqliteJournal,
    request_rx: Receiver<WriterRequest>,
    event_tx: SyncSender<WriterEvent>,
) {
    while let Ok(request) = request_rx.recv() {
        match request {
            WriterRequest::Shutdown => break,
            WriterRequest::Commit(job) => {
                let generation = job.packet.generation;
                if let Some(delay) = job.delay {
                    thread::sleep(delay);
                }
                if let Some(error) = job.fail {
                    let _ = event_tx.send(WriterEvent::Failed { generation, error });
                    continue;
                }
                match journal
                    .begin(job.packet)
                    .and_then(|_| journal.commit().map(|_| ()))
                {
                    Ok(()) => {
                        let committed =
                            journal.last_committed().cloned().expect("committed packet");
                        if event_tx.send(WriterEvent::Committed(committed)).is_err() {
                            break;
                        }
                    }
                    Err(error) => {
                        journal.discard_pending();
                        let _ = event_tx.send(WriterEvent::Failed { generation, error });
                    }
                }
            }
        }
    }
}
