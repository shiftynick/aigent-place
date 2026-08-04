//! Counter-based seeded randomness matching `replay/v1` section 9.

use hmac::{Hmac, Mac};
use sha2::Sha256;
use std::fmt;

type HmacSha256 = Hmac<Sha256>;

/// Errors produced while validating or deriving a draw.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum RngError {
    InvalidBound,
    InvalidInput(&'static str),
}

impl fmt::Display for RngError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::InvalidBound => write!(f, "invalid RNG bound"),
            Self::InvalidInput(reason) => write!(f, "invalid RNG input: {reason}"),
        }
    }
}

impl std::error::Error for RngError {}

/// Generation-scoped or spatially scoped draw address.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum DrawScope {
    Generation(u64),
    Spatial { x: i64, z: i64 },
}

/// Canonical draw address tuple (excluding rejection-block counter).
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct DrawInput {
    pub rng_contract_version: u16,
    pub subsystem: String,
    pub purpose: String,
    pub scope: DrawScope,
    pub canonical_command_index: u32,
    pub entity_id: u64,
    pub draw_index: u32,
}

/// One HMAC block produced while searching for an accepted candidate.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct DrawBlock {
    pub rejection_block: u32,
    pub hmac: [u8; 32],
    pub candidates: [u64; 4],
}

/// Accepted draw result, including audit evidence.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct DrawResult {
    pub hmac: [u8; 32],
    pub value: u64,
    pub raw: u64,
    pub candidate_index: usize,
    pub rejection_block: u32,
    pub blocks: Vec<DrawBlock>,
}

fn utf8_len_prefixed(out: &mut Vec<u8>, value: &str) {
    let bytes = value.as_bytes();
    out.extend_from_slice(&(bytes.len() as u32).to_be_bytes());
    out.extend_from_slice(bytes);
}

fn encode_rng_input(input: &DrawInput, rejection_block: u32) -> Result<Vec<u8>, RngError> {
    if input.rng_contract_version != 1 {
        return Err(RngError::InvalidInput("rng_contract_version"));
    }
    if input.subsystem.is_empty() || input.purpose.is_empty() {
        return Err(RngError::InvalidInput("subsystem/purpose"));
    }
    let mut parts = Vec::new();
    parts.extend_from_slice(&input.rng_contract_version.to_be_bytes());
    utf8_len_prefixed(&mut parts, &input.subsystem);
    utf8_len_prefixed(&mut parts, &input.purpose);
    match input.scope {
        DrawScope::Generation(generation) => {
            parts.push(0);
            parts.extend_from_slice(&generation.to_be_bytes());
        }
        DrawScope::Spatial { x, z } => {
            parts.push(1);
            parts.extend_from_slice(&x.to_be_bytes());
            parts.extend_from_slice(&z.to_be_bytes());
        }
    }
    parts.extend_from_slice(&input.canonical_command_index.to_be_bytes());
    parts.extend_from_slice(&input.entity_id.to_be_bytes());
    parts.extend_from_slice(&input.draw_index.to_be_bytes());
    if rejection_block > 0 {
        parts.extend_from_slice(&rejection_block.to_be_bytes());
    }
    Ok(parts)
}

/// Derive a bounded draw using HMAC-SHA-256 rejection sampling.
pub fn deterministic_draw(
    world_seed: &[u8; 32],
    input: &DrawInput,
    bound: u64,
) -> Result<DrawResult, RngError> {
    if bound == 0 {
        return Err(RngError::InvalidBound);
    }
    deterministic_draw_u128(world_seed, input, u128::from(bound))
}

/// Same as [`deterministic_draw`] but allows the inclusive upper bound `2^64`.
pub fn deterministic_draw_u128(
    world_seed: &[u8; 32],
    input: &DrawInput,
    bound: u128,
) -> Result<DrawResult, RngError> {
    if !(1..=(1u128 << 64)).contains(&bound) {
        return Err(RngError::InvalidBound);
    }
    // Validate the base tuple once before the rejection loop.
    encode_rng_input(input, 0)?;
    let limit = 1u128 << 64;
    let accepted = limit - (limit % bound);
    let mut blocks = Vec::new();
    let mut rejection_block: u32 = 0;
    loop {
        let material = encode_rng_input(input, rejection_block)?;
        let mut mac = HmacSha256::new_from_slice(world_seed).expect("HMAC accepts any key length");
        mac.update(&material);
        let bytes: [u8; 32] = mac.finalize().into_bytes().into();
        let mut candidates = [0u64; 4];
        for (index, slot) in candidates.iter_mut().enumerate() {
            let start = index * 8;
            *slot = u64::from_be_bytes(bytes[start..start + 8].try_into().expect("8 bytes"));
        }
        blocks.push(DrawBlock {
            rejection_block,
            hmac: bytes,
            candidates,
        });
        for (candidate_index, &raw) in candidates.iter().enumerate() {
            let raw_u128 = u128::from(raw);
            if raw_u128 < accepted {
                return Ok(DrawResult {
                    hmac: bytes,
                    value: (raw_u128 % bound) as u64,
                    raw,
                    candidate_index,
                    rejection_block,
                    blocks,
                });
            }
        }
        rejection_block = rejection_block
            .checked_add(1)
            .ok_or(RngError::InvalidInput("rejection block overflow"))?;
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn seed_from_hex(hex: &str) -> [u8; 32] {
        let bytes = hex::decode(hex).expect("hex");
        bytes.try_into().expect("32 bytes")
    }

    #[test]
    fn matches_replay_oracle_fixture_draw() {
        let seed =
            seed_from_hex("000102030405060708090a0b0c0d0e0f101112131415161718191a1b1c1d1e1f");
        let input = DrawInput {
            rng_contract_version: 1,
            subsystem: "world".into(),
            purpose: "spawn".into(),
            scope: DrawScope::Generation(7),
            canonical_command_index: 2,
            entity_id: 9,
            draw_index: 0,
        };
        let first = deterministic_draw(&seed, &input, 1000).expect("draw");
        let second = deterministic_draw(&seed, &input, 1000).expect("draw");
        assert_eq!(first, second);
        let other = deterministic_draw(
            &seed,
            &DrawInput {
                draw_index: 1,
                ..input.clone()
            },
            1000,
        )
        .expect("draw");
        assert_ne!(first.raw, other.raw);
    }

    #[test]
    fn matches_rejection_block_and_spatial_oracles() {
        let seed =
            seed_from_hex("000000000000000000000000000000000000000000000000000000000000001e");
        let input = DrawInput {
            rng_contract_version: 1,
            subsystem: "world".into(),
            purpose: "reject".into(),
            scope: DrawScope::Generation(1),
            canonical_command_index: 0,
            entity_id: 0,
            draw_index: 0,
        };
        let rejected =
            deterministic_draw_u128(&seed, &input, 9_223_372_036_854_775_809).expect("draw");
        assert_eq!(rejected.rejection_block, 1);
        assert_eq!(rejected.blocks.len(), 2);
        assert_eq!(
            hex::encode(rejected.blocks[0].hmac),
            "a97dd788ae6c9a85e9e76b3865f5abafc8054ea588cf56ecd2cf3ac2f4588d1e"
        );

        let spatial_seed =
            seed_from_hex("000102030405060708090a0b0c0d0e0f101112131415161718191a1b1c1d1e1f");
        let spatial = deterministic_draw_u128(
            &spatial_seed,
            &DrawInput {
                rng_contract_version: 1,
                subsystem: "world".into(),
                purpose: "spawn".into(),
                scope: DrawScope::Spatial { x: -2, z: 3 },
                canonical_command_index: 2,
                entity_id: 9,
                draw_index: 0,
            },
            1u128 << 64,
        )
        .expect("spatial");
        assert_eq!(
            hex::encode(spatial.hmac),
            "e5415d1a31dae57d44e39557cd43ee22d1d5972872a9e43a7acf9c779746c598"
        );
    }
}
