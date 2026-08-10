//! Typed movement leases: target, speed, progress, and blocked termination.

use crate::movement::MoveIntent;
use crate::tick::{ms_to_ticks, DEFAULT_LEASE_TTL_MS};
use std::collections::BTreeMap;

/// Why a lease left the active table this tick.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum LeaseTerminationReason {
    Blocked,
    Expired,
    Cancelled,
    Ruleset,
    Invalidated,
}

/// Frozen lease view published with an immutable generation.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct LeaseSnapshot {
    pub body_id: u64,
    pub aigent_id: Vec<u8>,
    pub sequence: u64,
    pub granted_tick: u64,
    pub expire_tick: u64,
    pub target_x_mm: i64,
    pub target_z_mm: i64,
    pub speed_mm_per_s: u32,
    pub consecutive_no_progress_ticks: u32,
}

/// Published lease termination for this generation (typed blocked/expiry/etc.).
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct LeaseTermination {
    pub body_id: u64,
    pub aigent_id: Vec<u8>,
    pub reason: LeaseTerminationReason,
    pub conflicting_entity_id: Option<u64>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
struct Lease {
    body_id: u64,
    aigent_id: Vec<u8>,
    sequence: u64,
    granted_tick: u64,
    expire_tick: u64,
    target_x_mm: i64,
    target_z_mm: i64,
    speed_mm_per_s: u32,
    consecutive_no_progress_ticks: u32,
}

/// Active leases keyed by body id. Iteration is by ascending body id.
#[derive(Debug, Default, Clone)]
pub struct LeaseTable {
    leases: BTreeMap<u64, Lease>,
    default_ttl_ms: u32,
}

impl LeaseTable {
    #[must_use]
    pub fn new(default_ttl_ms: u32) -> Self {
        Self {
            leases: BTreeMap::new(),
            default_ttl_ms: if default_ttl_ms == 0 {
                DEFAULT_LEASE_TTL_MS
            } else {
                default_ttl_ms
            },
        }
    }

    pub fn set_default_ttl_ms(&mut self, ttl_ms: u32) {
        self.default_ttl_ms = if ttl_ms == 0 {
            DEFAULT_LEASE_TTL_MS
        } else {
            ttl_ms
        };
    }

    /// Grant or replace a typed move-toward lease. A lower sequence from the
    /// same aigent is ignored.
    pub fn upsert_move(
        &mut self,
        body_id: u64,
        aigent_id: Vec<u8>,
        sequence: u64,
        now_tick: u64,
        intent: MoveIntent,
        ttl_ms: Option<u32>,
    ) -> bool {
        let ttl_ms = ttl_ms.unwrap_or(self.default_ttl_ms).max(1);
        let ttl_ticks = ms_to_ticks(ttl_ms).max(1);
        let expire_tick = now_tick.saturating_add(ttl_ticks);
        if let Some(existing) = self.leases.get(&body_id) {
            if existing.aigent_id == aigent_id && sequence < existing.sequence {
                return false;
            }
        }
        self.leases.insert(
            body_id,
            Lease {
                body_id,
                aigent_id,
                sequence,
                granted_tick: now_tick,
                expire_tick,
                target_x_mm: intent.target_x_mm,
                target_z_mm: intent.target_z_mm,
                speed_mm_per_s: intent.speed_mm_per_s,
                consecutive_no_progress_ticks: 0,
            },
        );
        true
    }

    pub fn cancel(&mut self, body_id: u64) -> bool {
        self.leases.remove(&body_id).is_some()
    }

    pub fn restore(&mut self, body_id: u64, lease: LeaseSnapshot) {
        self.leases.insert(
            body_id,
            Lease {
                body_id: lease.body_id,
                aigent_id: lease.aigent_id,
                sequence: lease.sequence,
                granted_tick: lease.granted_tick,
                expire_tick: lease.expire_tick,
                target_x_mm: lease.target_x_mm,
                target_z_mm: lease.target_z_mm,
                speed_mm_per_s: lease.speed_mm_per_s,
                consecutive_no_progress_ticks: lease.consecutive_no_progress_ticks,
            },
        );
    }

    /// Drop leases whose `expire_tick` is less than or equal to `now_tick`.
    pub fn expire_due(&mut self, now_tick: u64) -> Vec<LeaseTermination> {
        let expired: Vec<u64> = self
            .leases
            .iter()
            .filter(|(_, lease)| lease.expire_tick <= now_tick)
            .map(|(body_id, _)| *body_id)
            .collect();
        let mut out = Vec::with_capacity(expired.len());
        for body_id in expired {
            if let Some(lease) = self.leases.remove(&body_id) {
                out.push(LeaseTermination {
                    body_id,
                    aigent_id: lease.aigent_id,
                    reason: LeaseTerminationReason::Expired,
                    conflicting_entity_id: None,
                });
            }
        }
        out
    }

    /// Cancel live leases whose requested speed exceeds the newly active max.
    pub fn revalidate_for_ruleset(&mut self, max_speed_mm_per_s: u32) -> Vec<LeaseTermination> {
        let invalid: Vec<u64> = self
            .leases
            .iter()
            .filter(|(_, lease)| lease.speed_mm_per_s > max_speed_mm_per_s)
            .map(|(body_id, _)| *body_id)
            .collect();
        let mut cancelled = Vec::with_capacity(invalid.len());
        for body_id in invalid {
            if let Some(lease) = self.leases.remove(&body_id) {
                cancelled.push(LeaseTermination {
                    body_id,
                    aigent_id: lease.aigent_id,
                    reason: LeaseTerminationReason::Ruleset,
                    conflicting_entity_id: None,
                });
            }
        }
        cancelled
    }

    pub fn record_progress(&mut self, body_id: u64, made_progress: bool) {
        if let Some(lease) = self.leases.get_mut(&body_id) {
            if made_progress {
                lease.consecutive_no_progress_ticks = 0;
            } else {
                lease.consecutive_no_progress_ticks =
                    lease.consecutive_no_progress_ticks.saturating_add(1);
            }
        }
    }

    pub fn terminate_blocked(
        &mut self,
        body_id: u64,
        conflicting_entity_id: Option<u64>,
    ) -> Option<LeaseTermination> {
        let lease = self.leases.remove(&body_id)?;
        Some(LeaseTermination {
            body_id,
            aigent_id: lease.aigent_id,
            reason: LeaseTerminationReason::Blocked,
            conflicting_entity_id,
        })
    }

    pub fn terminate_invalidated(&mut self, body_id: u64) -> Option<LeaseTermination> {
        let lease = self.leases.remove(&body_id)?;
        Some(LeaseTermination {
            body_id,
            aigent_id: lease.aigent_id,
            reason: LeaseTerminationReason::Invalidated,
            conflicting_entity_id: None,
        })
    }

    #[must_use]
    pub fn get(&self, body_id: u64) -> Option<LeaseSnapshot> {
        self.leases.get(&body_id).map(Lease::snapshot)
    }

    #[must_use]
    pub fn snapshots(&self) -> BTreeMap<u64, LeaseSnapshot> {
        self.leases
            .iter()
            .map(|(id, lease)| (*id, lease.snapshot()))
            .collect()
    }

    /// Ascending body-id iteration for deterministic lease continuation.
    pub fn iter_snapshots(&self) -> impl Iterator<Item = LeaseSnapshot> + '_ {
        self.leases.values().map(Lease::snapshot)
    }

    #[must_use]
    pub fn len(&self) -> usize {
        self.leases.len()
    }

    #[must_use]
    pub fn is_empty(&self) -> bool {
        self.leases.is_empty()
    }

    pub fn intent_of(lease: &LeaseSnapshot) -> MoveIntent {
        MoveIntent {
            target_x_mm: lease.target_x_mm,
            target_z_mm: lease.target_z_mm,
            speed_mm_per_s: lease.speed_mm_per_s,
        }
    }
}

impl Lease {
    fn snapshot(&self) -> LeaseSnapshot {
        LeaseSnapshot {
            body_id: self.body_id,
            aigent_id: self.aigent_id.clone(),
            sequence: self.sequence,
            granted_tick: self.granted_tick,
            expire_tick: self.expire_tick,
            target_x_mm: self.target_x_mm,
            target_z_mm: self.target_z_mm,
            speed_mm_per_s: self.speed_mm_per_s,
            consecutive_no_progress_ticks: self.consecutive_no_progress_ticks,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn intent(speed: u32) -> MoveIntent {
        MoveIntent {
            target_x_mm: 1_000,
            target_z_mm: 0,
            speed_mm_per_s: speed,
        }
    }

    #[test]
    fn ttl_expiry_removes_lease() {
        let mut table = LeaseTable::new(150); // 3 ticks at 50 ms
        assert!(table.upsert_move(7, b"a".to_vec(), 1, 1, intent(100), None));
        let lease = table.get(7).expect("lease");
        assert_eq!(lease.expire_tick, 4);
        assert!(table.expire_due(3).is_empty());
        let expired = table.expire_due(4);
        assert_eq!(expired.len(), 1);
        assert_eq!(expired[0].reason, LeaseTerminationReason::Expired);
        assert!(table.is_empty());
    }

    #[test]
    fn lower_sequence_does_not_replace() {
        let mut table = LeaseTable::new(10_000);
        assert!(table.upsert_move(1, b"a".to_vec(), 5, 1, intent(100), None));
        assert!(!table.upsert_move(1, b"a".to_vec(), 4, 2, intent(200), None));
        assert_eq!(table.get(1).unwrap().sequence, 5);
        assert_eq!(table.get(1).unwrap().speed_mm_per_s, 100);
        assert!(table.upsert_move(1, b"a".to_vec(), 6, 2, intent(300), None));
        assert_eq!(table.get(1).unwrap().sequence, 6);
        assert_eq!(table.get(1).unwrap().speed_mm_per_s, 300);
    }

    #[test]
    fn blocked_threshold_terminates() {
        let mut table = LeaseTable::new(10_000);
        assert!(table.upsert_move(1, b"a".to_vec(), 1, 1, intent(100), None));
        table.record_progress(1, false);
        table.record_progress(1, false);
        assert_eq!(table.get(1).unwrap().consecutive_no_progress_ticks, 2);
        let term = table.terminate_blocked(1, Some(9)).unwrap();
        assert_eq!(term.reason, LeaseTerminationReason::Blocked);
        assert_eq!(term.conflicting_entity_id, Some(9));
        assert!(table.is_empty());
    }

    #[test]
    fn lowered_ruleset_max_cancels_only_excess_speed() {
        let mut table = LeaseTable::new(10_000);
        assert!(table.upsert_move(1, b"fast".to_vec(), 1, 1, intent(500), None));
        assert!(table.upsert_move(2, b"legal".to_vec(), 1, 1, intent(100), None));
        let terms = table.revalidate_for_ruleset(100);
        assert_eq!(terms.len(), 1);
        assert_eq!(terms[0].body_id, 1);
        assert_eq!(terms[0].reason, LeaseTerminationReason::Ruleset);
        assert!(table.get(1).is_none());
        assert_eq!(table.get(2).unwrap().speed_mm_per_s, 100);
    }
}
