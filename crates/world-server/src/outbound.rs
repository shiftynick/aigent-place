//! Bounded outbound queue with coalescing and sustained-overflow disconnect.
//!
//! Matches `protocol/v1` outbound byte-pressure semantics (256 KiB limit,
//! coalesce replaceable state to newest, 40 consecutive over-limit ticks).

use aigent_protocol::ProtocolCloseReason;

/// Encoded WebSocket payload byte limit per connection.
pub const QUEUE_LIMIT_BYTES: usize = 256 * 1024;

/// Consecutive 20 Hz over-limit observations before disconnect (= 2 s).
pub const OVERFLOW_TICK_OBSERVATIONS: u32 = 40;

/// Whether a queued state blob is a self-contained full snapshot or a delta.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum StateKind {
    Full,
    Delta,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
struct StateItem {
    bytes: usize,
    kind: StateKind,
}

/// Result of enqueueing a replaceable state payload.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct EnqueueStateOutcome {
    pub coalesced: bool,
    pub queued_bytes: usize,
    pub over_limit: bool,
    pub kind: StateKind,
}

/// Result of one or more 20 Hz queue observations.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum ObserveOutcome {
    Observed {
        over_limit_ticks: u32,
    },
    Closed {
        reason: ProtocolCloseReason,
        over_limit_ticks: u32,
    },
}

/// Per-connection outbound queue accounting (logical encoded sizes).
#[derive(Debug, Clone, Default)]
pub struct OutboundQueue {
    state_items: Vec<StateItem>,
    event_bytes: usize,
    over_limit_ticks: u32,
    closed: bool,
    last_observed_tick: Option<u64>,
}

impl OutboundQueue {
    #[must_use]
    pub fn new() -> Self {
        Self::default()
    }

    #[must_use]
    pub fn is_closed(&self) -> bool {
        self.closed
    }

    #[must_use]
    pub fn over_limit_ticks(&self) -> u32 {
        self.over_limit_ticks
    }

    #[must_use]
    pub fn queued_bytes(&self) -> usize {
        self.state_bytes() + self.event_bytes
    }

    #[must_use]
    pub fn state_bytes(&self) -> usize {
        self.state_items.iter().map(|item| item.bytes).sum()
    }

    /// Enqueue replaceable state. When coalescing would drop a prior full snapshot
    /// and leave only a delta, the newest item is promoted to a full snapshot using
    /// `full_encoded_bytes` so the queue remains self-contained.
    pub fn enqueue_state(
        &mut self,
        encoded_bytes: usize,
        kind: StateKind,
        full_encoded_bytes: usize,
    ) -> Option<EnqueueStateOutcome> {
        if self.closed {
            return None;
        }
        let mut candidate_items = self.state_items.clone();
        candidate_items.push(StateItem {
            bytes: encoded_bytes,
            kind,
        });
        let candidate_bytes: usize =
            candidate_items.iter().map(|item| item.bytes).sum::<usize>() + self.event_bytes;
        let coalesced = candidate_bytes > QUEUE_LIMIT_BYTES && candidate_items.len() > 1;
        let mut newest = StateItem {
            bytes: encoded_bytes,
            kind,
        };
        if coalesced {
            let dropped_full = self
                .state_items
                .iter()
                .any(|item| item.kind == StateKind::Full);
            if dropped_full && newest.kind == StateKind::Delta {
                newest = StateItem {
                    bytes: full_encoded_bytes,
                    kind: StateKind::Full,
                };
            }
            self.state_items = vec![newest];
        } else {
            self.state_items = candidate_items;
        }
        let queued_bytes = self.queued_bytes();
        Some(EnqueueStateOutcome {
            coalesced,
            queued_bytes,
            over_limit: queued_bytes > QUEUE_LIMIT_BYTES,
            kind: self
                .state_items
                .last()
                .map(|item| item.kind)
                .unwrap_or(kind),
        })
    }

    /// Drain replaceable state (models a successful socket write).
    pub fn drain_state(&mut self) {
        if !self.closed {
            self.state_items.clear();
        }
    }

    /// Observe queue pressure for simulation tick `tick`.
    /// Duplicate observations for the same tick are ignored so disconnect
    /// timing tracks consecutive over-limit ticks, not call count.
    pub fn observe_at(&mut self, tick: u64) -> ObserveOutcome {
        if self.closed {
            return ObserveOutcome::Closed {
                reason: ProtocolCloseReason::SustainedOutboundOverflow,
                over_limit_ticks: self.over_limit_ticks,
            };
        }
        if self.last_observed_tick == Some(tick) {
            return ObserveOutcome::Observed {
                over_limit_ticks: self.over_limit_ticks,
            };
        }
        let previous = self.last_observed_tick;
        self.last_observed_tick = Some(tick);
        let queued = self.queued_bytes();
        let consecutive = match previous {
            Some(prev) if tick == prev.saturating_add(1) => true,
            None => true,
            Some(_) => false,
        };
        if queued > QUEUE_LIMIT_BYTES {
            self.over_limit_ticks = if consecutive {
                self.over_limit_ticks.saturating_add(1)
            } else {
                1
            };
        } else {
            self.over_limit_ticks = 0;
        }
        if self.over_limit_ticks >= OVERFLOW_TICK_OBSERVATIONS {
            self.closed = true;
            return ObserveOutcome::Closed {
                reason: ProtocolCloseReason::SustainedOutboundOverflow,
                over_limit_ticks: self.over_limit_ticks,
            };
        }
        ObserveOutcome::Observed {
            over_limit_ticks: self.over_limit_ticks,
        }
    }

    /// Observe consecutive ticks `[start_tick, start_tick + n)`.
    pub fn observe_ticks(&mut self, start_tick: u64, n: u32) -> ObserveOutcome {
        let mut last = ObserveOutcome::Observed {
            over_limit_ticks: self.over_limit_ticks,
        };
        for offset in 0..n {
            last = self.observe_at(start_tick.saturating_add(u64::from(offset)));
            if matches!(last, ObserveOutcome::Closed { .. }) {
                break;
            }
        }
        last
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn exactly_at_limit_is_not_over() {
        let mut queue = OutboundQueue::new();
        let outcome = queue
            .enqueue_state(QUEUE_LIMIT_BYTES, StateKind::Full, QUEUE_LIMIT_BYTES)
            .unwrap();
        assert!(!outcome.over_limit);
        assert!(!outcome.coalesced);
        assert!(matches!(
            queue.observe_at(1),
            ObserveOutcome::Observed {
                over_limit_ticks: 0
            }
        ));
    }

    #[test]
    fn coalesces_delta_to_full_when_dropping_prior_full() {
        let mut queue = OutboundQueue::new();
        queue
            .enqueue_state(QUEUE_LIMIT_BYTES, StateKind::Full, QUEUE_LIMIT_BYTES)
            .unwrap();
        let outcome = queue
            .enqueue_state(1024, StateKind::Delta, QUEUE_LIMIT_BYTES)
            .unwrap();
        assert!(outcome.coalesced);
        assert_eq!(outcome.kind, StateKind::Full);
        assert_eq!(outcome.queued_bytes, QUEUE_LIMIT_BYTES);
    }

    #[test]
    fn duplicate_observe_same_tick_does_not_double_count() {
        let mut queue = OutboundQueue::new();
        queue
            .enqueue_state(
                QUEUE_LIMIT_BYTES + 1,
                StateKind::Full,
                QUEUE_LIMIT_BYTES + 1,
            )
            .unwrap();
        assert!(matches!(
            queue.observe_at(7),
            ObserveOutcome::Observed {
                over_limit_ticks: 1
            }
        ));
        assert!(matches!(
            queue.observe_at(7),
            ObserveOutcome::Observed {
                over_limit_ticks: 1
            }
        ));
    }

    #[test]
    fn gap_in_observe_ticks_resets_overflow_streak() {
        let mut queue = OutboundQueue::new();
        queue
            .enqueue_state(
                QUEUE_LIMIT_BYTES + 1,
                StateKind::Full,
                QUEUE_LIMIT_BYTES + 1,
            )
            .unwrap();
        queue.observe_ticks(1, 10);
        assert_eq!(queue.over_limit_ticks(), 10);
        assert!(matches!(
            queue.observe_at(12),
            ObserveOutcome::Observed {
                over_limit_ticks: 1
            }
        ));
    }
}
