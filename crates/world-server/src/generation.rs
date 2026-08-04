//! Immutable world generation published at each tick boundary.

use crate::lease::LeaseSnapshot;
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
    pub applied_commands: Vec<AppliedCommand>,
    pub expired_leases: Vec<u64>,
    pub rng_draws: Vec<(u32, DrawResult)>,
}

impl ImmutableGeneration {
    /// SHA-256 digest of a deterministic encoding of this generation.
    #[must_use]
    pub fn digest(&self) -> [u8; 32] {
        let mut hasher = Sha256::new();
        hasher.update(b"aigent.world.generation.v1\0");
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
        hasher.update((self.rng_draws.len() as u64).to_be_bytes());
        for (index, draw) in &self.rng_draws {
            hasher.update(index.to_be_bytes());
            hasher.update(draw.hmac);
            hasher.update(draw.value.to_be_bytes());
            hasher.update(draw.raw.to_be_bytes());
            hasher.update((draw.candidate_index as u64).to_be_bytes());
            hasher.update(u64::from(draw.rejection_block).to_be_bytes());
        }
        hasher.finalize().into()
    }
}
