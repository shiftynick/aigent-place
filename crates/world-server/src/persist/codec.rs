//! Length-prefixed binary codec for committed generation packets.

use super::{parameters_from_pairs, CommittedGeneration, JournalError};
use crate::lease::LeaseSnapshot;
use crate::ruleset::{PendingRuleset, RulesetGeneration};
use std::collections::BTreeMap;

const CODEC_MAGIC: &[u8] = b"AJG1";
const CODEC_VERSION: u32 = 1;

pub fn encode_generation(packet: &CommittedGeneration) -> Result<Vec<u8>, JournalError> {
    let mut out = Vec::new();
    out.extend_from_slice(CODEC_MAGIC);
    out.extend_from_slice(&CODEC_VERSION.to_be_bytes());
    write_u64(&mut out, packet.generation);
    write_i64(&mut out, packet.world_value);
    write_ruleset(&mut out, &packet.ruleset);
    match &packet.pending_ruleset {
        Some(pending) => {
            out.push(1);
            write_u64(&mut out, pending.generation_id);
            write_u64(&mut out, pending.activate_at_tick);
            write_parameters(&mut out, pending.parameters.values_for_digest());
        }
        None => out.push(0),
    }
    write_u64(&mut out, packet.command_summaries.len() as u64);
    for summary in &packet.command_summaries {
        write_bytes(&mut out, summary.as_bytes());
    }
    write_u64(&mut out, packet.active_leases.len() as u64);
    for (body_id, lease) in &packet.active_leases {
        write_u64(&mut out, *body_id);
        write_u64(&mut out, lease.body_id);
        write_bytes(&mut out, &lease.aigent_id);
        write_u64(&mut out, lease.sequence);
        write_u64(&mut out, lease.granted_tick);
        write_u64(&mut out, lease.expire_tick);
    }
    write_bytes(&mut out, packet.integrity_hex.as_bytes());
    Ok(out)
}

pub fn decode_generation(bytes: &[u8]) -> Result<CommittedGeneration, JournalError> {
    let mut cursor = 0usize;
    let magic = read_exact(bytes, &mut cursor, 4)?;
    if magic != CODEC_MAGIC {
        return Err(JournalError::Storage(
            "committed generation codec magic mismatch".into(),
        ));
    }
    let version = read_u32(bytes, &mut cursor)?;
    if version != CODEC_VERSION {
        return Err(JournalError::Storage(format!(
            "unsupported generation codec version {version}"
        )));
    }
    let generation = read_u64(bytes, &mut cursor)?;
    let world_value = read_i64(bytes, &mut cursor)?;
    let ruleset = read_ruleset(bytes, &mut cursor)?;
    let pending_flag = read_u8(bytes, &mut cursor)?;
    let pending_ruleset = if pending_flag == 1 {
        Some(PendingRuleset {
            generation_id: read_u64(bytes, &mut cursor)?,
            activate_at_tick: read_u64(bytes, &mut cursor)?,
            parameters: parameters_from_pairs(read_parameters(bytes, &mut cursor)?),
        })
    } else if pending_flag == 0 {
        None
    } else {
        return Err(JournalError::Storage("invalid pending ruleset flag".into()));
    };
    let summary_len = read_u64(bytes, &mut cursor)? as usize;
    ensure_count_fits(bytes, &cursor, summary_len, 1)?;
    let mut command_summaries = Vec::with_capacity(summary_len);
    for _ in 0..summary_len {
        let raw = read_bytes(bytes, &mut cursor)?;
        let summary = String::from_utf8(raw).map_err(|error| {
            JournalError::Storage(format!("command summary utf8 error: {error}"))
        })?;
        command_summaries.push(summary);
    }
    let lease_len = read_u64(bytes, &mut cursor)? as usize;
    ensure_count_fits(bytes, &cursor, lease_len, 8)?;
    let mut active_leases = BTreeMap::new();
    for _ in 0..lease_len {
        let key = read_u64(bytes, &mut cursor)?;
        let lease = LeaseSnapshot {
            body_id: read_u64(bytes, &mut cursor)?,
            aigent_id: read_bytes(bytes, &mut cursor)?,
            sequence: read_u64(bytes, &mut cursor)?,
            granted_tick: read_u64(bytes, &mut cursor)?,
            expire_tick: read_u64(bytes, &mut cursor)?,
        };
        active_leases.insert(key, lease);
    }
    let integrity_raw = read_bytes(bytes, &mut cursor)?;
    let integrity_hex = String::from_utf8(integrity_raw)
        .map_err(|error| JournalError::Storage(format!("integrity utf8 error: {error}")))?;
    if cursor != bytes.len() {
        return Err(JournalError::Storage(
            "trailing bytes after committed generation".into(),
        ));
    }
    Ok(CommittedGeneration {
        generation,
        world_value,
        ruleset,
        pending_ruleset,
        command_summaries,
        active_leases,
        integrity_hex,
    })
}

fn write_ruleset(out: &mut Vec<u8>, ruleset: &RulesetGeneration) {
    write_u64(out, ruleset.generation_id);
    write_u64(out, ruleset.activated_tick);
    write_parameters(out, ruleset.parameters.values_for_digest());
}

fn read_ruleset(bytes: &[u8], cursor: &mut usize) -> Result<RulesetGeneration, JournalError> {
    Ok(RulesetGeneration {
        generation_id: read_u64(bytes, cursor)?,
        activated_tick: read_u64(bytes, cursor)?,
        parameters: parameters_from_pairs(read_parameters(bytes, cursor)?),
    })
}

fn write_parameters(out: &mut Vec<u8>, values: &BTreeMap<String, i64>) {
    write_u64(out, values.len() as u64);
    for (path, value) in values {
        write_bytes(out, path.as_bytes());
        write_i64(out, *value);
    }
}

fn read_parameters(bytes: &[u8], cursor: &mut usize) -> Result<Vec<(String, i64)>, JournalError> {
    let len = read_u64(bytes, cursor)? as usize;
    ensure_count_fits(bytes, cursor, len, 8 + 8)?;
    let mut pairs = Vec::with_capacity(len);
    for _ in 0..len {
        let path_raw = read_bytes(bytes, cursor)?;
        let path = String::from_utf8(path_raw).map_err(|error| {
            JournalError::Storage(format!("parameter path utf8 error: {error}"))
        })?;
        let value = read_i64(bytes, cursor)?;
        pairs.push((path, value));
    }
    Ok(pairs)
}

fn ensure_count_fits(
    bytes: &[u8],
    cursor: &usize,
    count: usize,
    min_bytes_per_item: usize,
) -> Result<(), JournalError> {
    let remaining = bytes.len().saturating_sub(*cursor);
    let min_needed = count.saturating_mul(min_bytes_per_item);
    if min_needed > remaining {
        return Err(JournalError::Storage(
            "committed generation collection count exceeds remaining bytes".into(),
        ));
    }
    Ok(())
}

fn write_u64(out: &mut Vec<u8>, value: u64) {
    out.extend_from_slice(&value.to_be_bytes());
}

fn write_i64(out: &mut Vec<u8>, value: i64) {
    out.extend_from_slice(&value.to_be_bytes());
}

fn write_bytes(out: &mut Vec<u8>, value: &[u8]) {
    write_u64(out, value.len() as u64);
    out.extend_from_slice(value);
}

fn read_exact<'a>(
    bytes: &'a [u8],
    cursor: &mut usize,
    len: usize,
) -> Result<&'a [u8], JournalError> {
    let end = cursor
        .checked_add(len)
        .ok_or_else(|| JournalError::Storage("codec overflow".into()))?;
    if end > bytes.len() {
        return Err(JournalError::Storage("codec truncated".into()));
    }
    let slice = &bytes[*cursor..end];
    *cursor = end;
    Ok(slice)
}

fn read_u8(bytes: &[u8], cursor: &mut usize) -> Result<u8, JournalError> {
    Ok(read_exact(bytes, cursor, 1)?[0])
}

fn read_u32(bytes: &[u8], cursor: &mut usize) -> Result<u32, JournalError> {
    let raw = read_exact(bytes, cursor, 4)?;
    Ok(u32::from_be_bytes([raw[0], raw[1], raw[2], raw[3]]))
}

fn read_u64(bytes: &[u8], cursor: &mut usize) -> Result<u64, JournalError> {
    let raw = read_exact(bytes, cursor, 8)?;
    Ok(u64::from_be_bytes([
        raw[0], raw[1], raw[2], raw[3], raw[4], raw[5], raw[6], raw[7],
    ]))
}

fn read_i64(bytes: &[u8], cursor: &mut usize) -> Result<i64, JournalError> {
    Ok(read_u64(bytes, cursor)? as i64)
}

fn read_bytes(bytes: &[u8], cursor: &mut usize) -> Result<Vec<u8>, JournalError> {
    let len = read_u64(bytes, cursor)? as usize;
    Ok(read_exact(bytes, cursor, len)?.to_vec())
}
