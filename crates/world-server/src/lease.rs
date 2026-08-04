//! Internal movement-lease harness (not wire MOVE).

use crate::tick::{ms_to_ticks, DEFAULT_LEASE_TTL_MS};
use std::collections::BTreeMap;

/// Frozen lease view published with an immutable generation.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct LeaseSnapshot {
    pub body_id: u64,
    pub aigent_id: Vec<u8>,
    pub sequence: u64,
    pub granted_tick: u64,
    pub expire_tick: u64,
}

#[derive(Debug, Clone, PartialEq, Eq)]
struct Lease {
    body_id: u64,
    aigent_id: Vec<u8>,
    sequence: u64,
    granted_tick: u64,
    expire_tick: u64,
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

    /// Grant or replace a lease. A lower sequence from the same aigent is ignored.
    pub fn upsert(
        &mut self,
        body_id: u64,
        aigent_id: Vec<u8>,
        sequence: u64,
        now_tick: u64,
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
            },
        );
    }

    /// Drop leases whose `expire_tick` is less than or equal to `now_tick`.
    pub fn expire_due(&mut self, now_tick: u64) -> Vec<u64> {
        let expired: Vec<u64> = self
            .leases
            .iter()
            .filter(|(_, lease)| lease.expire_tick <= now_tick)
            .map(|(body_id, _)| *body_id)
            .collect();
        for body_id in &expired {
            self.leases.remove(body_id);
        }
        expired
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

    #[must_use]
    pub fn len(&self) -> usize {
        self.leases.len()
    }

    #[must_use]
    pub fn is_empty(&self) -> bool {
        self.leases.is_empty()
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
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn ttl_expiry_removes_lease() {
        let mut table = LeaseTable::new(150); // 3 ticks at 50 ms
        assert!(table.upsert(7, b"a".to_vec(), 1, 1, None));
        let lease = table.get(7).expect("lease");
        assert_eq!(lease.expire_tick, 4);
        assert!(table.expire_due(3).is_empty());
        assert_eq!(table.expire_due(4), vec![7]);
        assert!(table.is_empty());
    }

    #[test]
    fn lower_sequence_does_not_replace() {
        let mut table = LeaseTable::new(10_000);
        assert!(table.upsert(1, b"a".to_vec(), 5, 1, None));
        assert!(!table.upsert(1, b"a".to_vec(), 4, 2, None));
        assert_eq!(table.get(1).unwrap().sequence, 5);
        assert!(table.upsert(1, b"a".to_vec(), 6, 2, None));
        assert_eq!(table.get(1).unwrap().sequence, 6);
    }
}
