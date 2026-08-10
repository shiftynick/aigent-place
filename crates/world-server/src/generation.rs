//! Immutable world generation published at each tick boundary.

use crate::entity::EntitySnapshot;
use crate::lease::{LeaseSnapshot, LeaseTermination, LeaseTerminationReason};
use crate::rng::DrawResult;
use sha2::{Digest, Sha256};
use std::collections::BTreeMap;

/// Command as applied inside a generation, in canonical order.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct AppliedCommand {
    pub arrival_tick: u64,
    pub aigent_id: Vec<u8>,
    pub sequence: u64,
    pub canonical_index: u32,
    pub summary: String,
}

/// Immutable snapshot handed to off-tick readers (snapshots, sockets).
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ImmutableGeneration {
    pub generation: u64,
    pub tick: u64,
    pub world_value: i64,
    pub ruleset_generation_id: u64,
    pub active_leases: BTreeMap<u64, LeaseSnapshot>,
    /// Durable aigent identity to body binding.
    pub aigent_bodies: BTreeMap<Vec<u8>, u64>,
    pub applied_commands: Vec<AppliedCommand>,
    pub expired_leases: Vec<u64>,
    /// Typed lease terminations this tick (blocked / expired / cancelled / ruleset).
    pub lease_terminations: Vec<LeaseTermination>,
    pub rng_draws: Vec<(u32, DrawResult)>,
    /// Authoritative entity table frozen at this tick, ordered by unsigned ID.
    pub entities: BTreeMap<u64, EntitySnapshot>,
    /// Global monotonic ID allocator state; `0` marks an exhausted space.
    pub next_entity_id: u64,
}

impl ImmutableGeneration {
    /// SHA-256 digest of a deterministic encoding of this generation.
    #[must_use]
    pub fn digest(&self) -> [u8; 32] {
        let mut hasher = Sha256::new();
        hasher.update(b"aigent.world.generation.v2\0");
        hasher.update(self.generation.to_be_bytes());
        hasher.update(self.tick.to_be_bytes());
        hasher.update(self.world_value.to_be_bytes());
        hasher.update(self.ruleset_generation_id.to_be_bytes());
        hasher.update((self.active_leases.len() as u64).to_be_bytes());
        for (body_id, lease) in &self.active_leases {
            hasher.update(body_id.to_be_bytes());
            hasher.update((lease.aigent_id.len() as u32).to_be_bytes());
            hasher.update(&lease.aigent_id);
            hasher.update(lease.sequence.to_be_bytes());
            hasher.update(lease.granted_tick.to_be_bytes());
            hasher.update(lease.expire_tick.to_be_bytes());
            hasher.update(lease.target_x_mm.to_be_bytes());
            hasher.update(lease.target_z_mm.to_be_bytes());
            hasher.update(u64::from(lease.speed_mm_per_s).to_be_bytes());
            hasher.update(u64::from(lease.consecutive_no_progress_ticks).to_be_bytes());
        }
        hasher.update((self.aigent_bodies.len() as u64).to_be_bytes());
        for (aigent_id, body_id) in &self.aigent_bodies {
            hasher.update((aigent_id.len() as u32).to_be_bytes());
            hasher.update(aigent_id);
            hasher.update(body_id.to_be_bytes());
        }
        hasher.update((self.applied_commands.len() as u64).to_be_bytes());
        for command in &self.applied_commands {
            hasher.update(command.arrival_tick.to_be_bytes());
            hasher.update((command.aigent_id.len() as u32).to_be_bytes());
            hasher.update(&command.aigent_id);
            hasher.update(command.sequence.to_be_bytes());
            hasher.update(command.canonical_index.to_be_bytes());
            hasher.update((command.summary.len() as u32).to_be_bytes());
            hasher.update(command.summary.as_bytes());
        }
        hasher.update((self.expired_leases.len() as u64).to_be_bytes());
        for body_id in &self.expired_leases {
            hasher.update(body_id.to_be_bytes());
        }
        hasher.update((self.lease_terminations.len() as u64).to_be_bytes());
        for term in &self.lease_terminations {
            hasher.update(term.body_id.to_be_bytes());
            hasher.update((term.aigent_id.len() as u32).to_be_bytes());
            hasher.update(&term.aigent_id);
            hasher.update([termination_reason_byte(term.reason)]);
            match term.conflicting_entity_id {
                Some(id) => {
                    hasher.update([1]);
                    hasher.update(id.to_be_bytes());
                }
                None => hasher.update([0]),
            }
        }
        hasher.update((self.rng_draws.len() as u64).to_be_bytes());
        for (index, draw) in &self.rng_draws {
            hasher.update(index.to_be_bytes());
            hasher.update(draw.hmac);
            hasher.update(draw.value.to_be_bytes());
            hasher.update(draw.raw.to_be_bytes());
            hasher.update((draw.candidate_index as u64).to_be_bytes());
            hasher.update(u64::from(draw.rejection_block).to_be_bytes());
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
        hasher.finalize().into()
    }
}

fn termination_reason_byte(reason: LeaseTerminationReason) -> u8 {
    match reason {
        LeaseTerminationReason::Blocked => 1,
        LeaseTerminationReason::Expired => 2,
        LeaseTerminationReason::Cancelled => 3,
        LeaseTerminationReason::Ruleset => 4,
        LeaseTerminationReason::Invalidated => 5,
    }
}
