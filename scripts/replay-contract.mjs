import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  decodeCommandOutcomeHex,
  encodeCommandOutcomeHex,
  wireSemanticProjection,
} from "./replay-command-outcome.mjs";

export const MAX_COMMANDS_PER_GENERATION = 4096;
export const MAX_DURABLE_BYTES_PER_GENERATION = 16 * 1024 * 1024;
export const IDEMPOTENCY_RETENTION_HOURS = 24;
export const EVENT_RETENTION_HOURS = 24;
export const EVENT_STREAM_BYTE_CAP = 4 * 1024 * 1024;
export const EVENT_GLOBAL_BYTE_CAP = 512 * 1024 * 1024;

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const fixturePath = path.join(root, "replay/v1/conformance/replay-v1.json");
const crcTable = Array.from({ length: 256 }, (_, index) => {
  let value = index;
  for (let bit = 0; bit < 8; bit += 1) {
    value = value & 1 ? (value >>> 1) ^ 0x82f63b78 : value >>> 1;
  }
  return value >>> 0;
});

function clone(value) {
  return structuredClone(value);
}

function compareUnsigned(left, right) {
  const a = BigInt(left);
  const b = BigInt(right);
  return a < b ? -1 : a > b ? 1 : 0;
}

function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value)
        .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
        .map(([key, child]) => [key, canonical(child)]),
    );
  }
  return value;
}

function canonicalJson(value) {
  return JSON.stringify(canonical(value));
}

function sha256(value) {
  return crypto.createHash("sha256").update(value).digest("hex");
}

function u16(value) {
  const buffer = Buffer.alloc(2);
  buffer.writeUInt16BE(value);
  return buffer;
}

function u32(value) {
  const buffer = Buffer.alloc(4);
  buffer.writeUInt32BE(value);
  return buffer;
}

function u64(value) {
  const buffer = Buffer.alloc(8);
  buffer.writeBigUInt64BE(BigInt(value));
  return buffer;
}

function utf8(value) {
  const bytes = Buffer.from(value, "utf8");
  return [u32(bytes.length), bytes];
}

function protocolBytes(value) {
  if (typeof value !== "string" || value.length === 0) throw new Error("invalid byte literal");
  if (value.startsWith("hex:")) {
    const hex = value.slice(4);
    if (hex.length === 0 || hex.length % 2 !== 0 || !/^[0-9a-f]+$/i.test(hex)) throw new Error("invalid hex byte literal");
    return Buffer.from(hex, "hex");
  }
  return Buffer.from(value, "utf8");
}

function byteIdentity(value) {
  const bytes = protocolBytes(value);
  return `${bytes.length}:${bytes.toString("hex")}`;
}

function validByteLiteral(value) {
  try {
    protocolBytes(value);
    return true;
  } catch {
    return false;
  }
}

function encodedRecordBytes(command) {
  return command.encoded_frame_bytes;
}

function inferredPayloadMode(command) {
  return command.available === false ? 1 : 0;
}

function digestMaterial(command) {
  const features = [...(command.required_features ?? [])].sort((a, b) => Buffer.compare(Buffer.from(a.feature_id, "utf8"), Buffer.from(b.feature_id, "utf8")));
  const payloadMode = command.payload_mode ?? inferredPayloadMode(command);
  const payload = command.canonical_payload_hex !== undefined
    ? Buffer.from(command.canonical_payload_hex, "hex")
    : Buffer.from(command.payload_bytes ?? (Object.keys(command.payload ?? {}).length === 0 ? "" : canonicalJson(command.payload)), "utf8");
  return { features, payloadMode, payload };
}

function digest(command) {
  const major = command.protocol_major ?? 1;
  const { features, payloadMode, payload } = digestMaterial(command);
  const parts = [
    Buffer.from("aigent.command.semantic.v1\0", "utf8"),
    u32(1),
    u32(major),
    u32(command.kind),
    u32(features.length),
    ...features.flatMap((feature) => [...utf8(feature.feature_id), u32(feature.version)]),
    Buffer.from([payloadMode]),
    u64(payload.length),
    payload,
  ];
  return crypto.createHash("sha256").update(Buffer.concat(parts)).digest("hex");
}

function crc32c(bytes) {
  let value = 0xffffffff;
  for (const byte of bytes) {
    value = crcTable[(value ^ byte) & 0xff] ^ (value >>> 8);
  }
  return ((value ^ 0xffffffff) >>> 0).toString(16).padStart(8, "0");
}

export function crc32cHex(bytes) {
  return crc32c(Buffer.from(bytes));
}

function framePayload(record) {
  if (typeof record.payload_hex !== "string" || record.payload_hex.length % 2 !== 0 || !/^[0-9a-f]*$/.test(record.payload_hex)) {
    throw new Error("invalid frame payload hex");
  }
  return Buffer.from(record.payload_hex, "hex");
}

function frameChecksum(record) {
  const payload = framePayload(record);
  return crc32c(Buffer.concat([
    Buffer.from(record.magic ?? "AIGR", "ascii"),
    u16(record.version ?? 1),
    u16(record.type ?? 1),
    u64(record.generation),
    u32(record.ordinal),
    u64(record.declared_length ?? payload.length),
    payload,
  ]));
}

function encodedFrame(record) {
  const payload = framePayload(record);
  return Buffer.concat([
    Buffer.from(record.magic ?? "AIGR", "ascii"),
    u16(record.version ?? 1),
    u16(record.type ?? 1),
    u64(record.generation),
    u32(record.ordinal),
    u64(record.declared_length ?? payload.length),
    payload,
    Buffer.from(record.checksum, "hex"),
  ]);
}

export function recoveryFrame({ payload, generation, ordinal = 0, prior_generation, ...overrides }) {
  const priorGeneration = prior_generation ?? decrementJsonU64(generation);
  let payloadHex = overrides.payload_hex;
  if (payloadHex === undefined) {
    try {
      payloadHex = encodeCommandOutcomeHex(payload ?? {});
    } catch {
      // Leave an undecodable body so recovery fails closed on bad projections.
      payloadHex = "00";
    }
  }
  const frame = {
    magic: "AIGR",
    version: 1,
    type: 1,
    generation,
    prior_generation: priorGeneration,
    ordinal,
    payload,
    encoded_frame_bytes: overrides.encoded_frame_bytes ?? payload?.encoded_frame_bytes,
    payload_hex: payloadHex,
    declared_length: Buffer.from(payloadHex, "hex").length,
    ...overrides,
  };
  const rawPayload = framePayload(frame);
  return {
    ...frame,
    payload_sha256: overrides.payload_sha256 ?? sha256(rawPayload),
    projection_sha256: overrides.projection_sha256 ?? sha256(Buffer.from(canonicalJson(frame.payload), "utf8")),
    checksum: overrides.checksum ?? frameChecksum(frame),
  };
}

export function semanticCommandDigest(command) {
  return digest(command);
}

function commandOrder(left, right) {
  const tick = compareUnsigned(left.arrival_tick, right.arrival_tick);
  if (tick !== 0) return tick;
  const aigent = Buffer.compare(protocolBytes(left.aigent_id), protocolBytes(right.aigent_id));
  if (aigent !== 0) return aigent;
  return compareUnsigned(left.sequence, right.sequence);
}

function isU64(value, nonzero = false) {
  return typeof value === "string" && /^(0|[1-9]\d*)$/.test(value) && BigInt(value) <= 0xffffffffffffffffn && (!nonzero || value !== "0");
}

function u64Value(value) {
  if (typeof value === "number" && Number.isSafeInteger(value) && value >= 0) return BigInt(value);
  if (isU64(value)) return BigInt(value);
  throw new Error("invalid uint64");
}

const MAX_U64 = 0xffffffffffffffffn;

function u64String(value, nonzero = false) {
  const normalized = u64Value(value);
  if (nonzero && normalized === 0n) throw new Error("invalid zero uint64");
  return normalized.toString();
}

function cursorString(value, nonzero = false) {
  if (!isU64(value, nonzero)) throw new Error("event cursor must be a canonical uint64 string");
  return value;
}

function jsonU64(value) {
  const normalized = typeof value === "bigint" ? value : u64Value(value);
  if (normalized < 0n || normalized > MAX_U64) throw new Error("invalid uint64");
  return normalized <= BigInt(Number.MAX_SAFE_INTEGER) ? Number(normalized) : normalized.toString();
}

function compareU64(left, right) {
  const a = u64Value(left);
  const b = u64Value(right);
  return a < b ? -1 : a > b ? 1 : 0;
}

function incrementU64(value, exhaustionMessage) {
  const current = u64Value(value);
  if (current === MAX_U64) throw new Error(exhaustionMessage);
  return (current + 1n).toString();
}

function incrementJsonU64(value, exhaustionMessage) {
  return jsonU64(incrementU64(value, exhaustionMessage));
}

function decrementJsonU64(value) {
  const current = u64Value(value);
  if (current === 0n) throw new Error("uint64 underflow");
  return jsonU64(current - 1n);
}

function nextSequence(sequence) {
  return sequence === MAX_U64.toString() ? null : incrementU64(sequence, "session sequence exhausted");
}

function sequenceCursor(cursors, key) {
  return cursors.has(key) ? cursors.get(key) : "1";
}

function validCommandMetadata(command, allowPersistedPayloadMode = false) {
  const protocolMajor = command?.protocol_major ?? 1;
  const payloadMode = command?.payload_mode ?? inferredPayloadMode(command ?? {});
  const payloadModeMatchesClassification = allowPersistedPayloadMode ||
    command?.payload_mode === undefined ||
    command.payload_mode === inferredPayloadMode(command);
  const validCanonicalPayload = command?.canonical_payload_hex === undefined ||
    typeof command.canonical_payload_hex === "string" &&
    command.canonical_payload_hex.length % 2 === 0 &&
    /^[0-9a-f]*$/.test(command.canonical_payload_hex);
  return command &&
    isU64(command.arrival_tick) &&
    validByteLiteral(command.aigent_id) &&
    isU64(command.sequence, true) &&
    validByteLiteral(command.session_epoch) &&
    validByteLiteral(command.idempotency_key) &&
    Number.isSafeInteger(protocolMajor) && protocolMajor > 0 && protocolMajor <= 0xffffffff &&
    Number.isSafeInteger(command.kind) && command.kind > 0 && command.kind <= 0xffffffff &&
    Number.isSafeInteger(payloadMode) && payloadMode >= 0 && payloadMode <= 1 &&
    payloadModeMatchesClassification &&
    command.invalid !== true &&
    validCanonicalPayload &&
    Array.isArray(command.required_features ?? []) && (command.required_features ?? []).every((feature) => feature && typeof feature.feature_id === "string" && feature.feature_id.length > 0 && Number.isSafeInteger(feature.version) && feature.version >= 0 && feature.version <= 0xffffffff) &&
    new Set((command.required_features ?? []).map((feature) => feature.feature_id)).size === (command.required_features ?? []).length;
}

function validCommand(command) {
  return validCommandMetadata(command) &&
    Number.isSafeInteger(encodedRecordBytes(command)) && encodedRecordBytes(command) > 0 && BigInt(encodedRecordBytes(command)) <= 0xffffffffffffffffn &&
    (command.mutation_delta === undefined || Number.isSafeInteger(command.mutation_delta)) &&
    Array.isArray(command.events ?? []) && (command.events ?? []).every((event) =>
      event && isU64(event.stream_id, true) && Number.isSafeInteger(event.bytes) && event.bytes > 0
    );
}

function validByteIdentity(identity) {
  if (typeof identity !== "string") return false;
  const match = /^([1-9]\d*):([0-9a-f]+)$/.exec(identity);
  return match !== null && match[2].length % 2 === 0 && BigInt(match[1]) === BigInt(match[2].length / 2);
}

function parsedKey(key, length) {
  try {
    const parsed = JSON.parse(key);
    return Array.isArray(parsed) && parsed.length === length ? parsed : undefined;
  } catch {
    return undefined;
  }
}

function validSessionStateKey(key) {
  const parsed = parsedKey(key, 2);
  return parsed !== undefined && parsed.every(validByteIdentity);
}

function validIdempotencyStateKey(key) {
  const parsed = parsedKey(key, 3);
  return parsed !== undefined && validByteIdentity(parsed[0]) &&
    Number.isSafeInteger(parsed[1]) && parsed[1] > 0 && parsed[1] <= 0xffffffff &&
    validByteIdentity(parsed[2]);
}

function validDurableResultStateKey(key) {
  const parsed = parsedKey(key, 3);
  return parsed !== undefined && validByteIdentity(parsed[0]) && validByteIdentity(parsed[1]) && isU64(parsed[2], true);
}

function validStoredResult(result) {
  return result && (
    result.outcome === "accepted" && Number.isSafeInteger(result.mutation_delta ?? 0) ||
    result.outcome === "rejected" && typeof result.reason === "string" && result.reason.length > 0
  );
}

function validDigestDivergentResult(result) {
  return result?.outcome === "rejected" &&
    ["IDEMPOTENCY_CONFLICT", "UNSUPPORTED_MESSAGE"].includes(result.reason);
}

function validatedDurableMaps(initial) {
  const expectedSequences = new Map(Object.entries(initial.expected_sequences ?? {}));
  for (const [key, value] of expectedSequences) {
    if (!validSessionStateKey(key) || value !== null && !isU64(value, true)) throw new Error("invalid checkpoint session cursor");
  }
  const idempotency = new Map(Object.entries(initial.idempotency ?? {}));
  for (const [key, record] of idempotency) {
    if (!validIdempotencyStateKey(key) || !record || !/^[0-9a-f]{64}$/.test(record.digest ?? "") ||
      !validStoredResult(record.result) || !Number.isSafeInteger(record.committed_at) || record.committed_at < 0 ||
      !Array.isArray(record.live_epochs) || new Set(record.live_epochs).size !== record.live_epochs.length ||
      record.live_epochs.some((epoch) => !validSessionStateKey(epoch))) {
      throw new Error("invalid checkpoint idempotency state");
    }
  }
  const durableResults = new Map(Object.entries(initial.durable_results ?? {}));
  for (const [key, record] of durableResults) {
    const retained = record && idempotency.get(record.key);
    if (!validDurableResultStateKey(key) || !record || !validIdempotencyStateKey(record.key) ||
      !/^[0-9a-f]{64}$/.test(record.digest ?? "") || !validStoredResult(record.result) ||
      !Number.isSafeInteger(record.committed_at) || record.committed_at < 0 || typeof record.live_epoch !== "boolean" ||
      retained && retained.digest !== record.digest &&
        !validDigestDivergentResult(record.result)) {
      throw new Error("invalid checkpoint durable result state");
    }
  }
  return { expectedSequences, idempotency, durableResults };
}

function createState(initial = {}) {
  const durableMaps = validatedDurableMaps(initial);
  const generatedStreams = Object.fromEntries(Array.from(
    { length: initial.stream_series?.count ?? 0 },
    (_, index) => {
      const id = String((initial.stream_series.stream_id_start ?? 1) + index);
      return [id, {
        epoch: String(index + 1),
        next_sequence: "2",
        acknowledged: "0",
        events: [{
          sequence: "1",
          bytes: initial.stream_series.event_bytes,
          committed_at: initial.stream_series.committed_at,
          ordinal: String((initial.stream_series.ordinal_start ?? 1) + index),
          payload: "",
        }],
        evicted: [],
      }];
    },
  ));
  const streamEntries = Object.entries({ ...generatedStreams, ...(initial.streams ?? {}) }).sort(([a], [b]) => compareUnsigned(a, b));
  const explicitEpochs = streamEntries.map(([, target]) => target.epoch).filter((epoch) => epoch !== undefined).map((epoch) => cursorString(epoch, true));
  const usedEpochs = new Set(explicitEpochs);
  if (usedEpochs.size !== explicitEpochs.length) throw new Error("invalid or reused stream epoch");
  const highestUsedEpoch = explicitEpochs.reduce((highest, epoch) => compareU64(epoch, highest) > 0 ? epoch : highest, "0");
  let nextStreamEpoch;
  if (initial.next_stream_epoch === null) {
    nextStreamEpoch = null;
  } else if (initial.next_stream_epoch !== undefined) {
    nextStreamEpoch = cursorString(initial.next_stream_epoch, true);
    if (compareU64(nextStreamEpoch, highestUsedEpoch) <= 0) throw new Error("invalid stream epoch allocator");
  } else {
    nextStreamEpoch = highestUsedEpoch === MAX_U64.toString()
      ? null
      : incrementU64(highestUsedEpoch, "stream epoch allocator exhausted");
  }
  const allocateEpoch = () => {
    if (nextStreamEpoch === null) throw new Error("stream epoch allocator exhausted");
    const allocated = nextStreamEpoch;
    nextStreamEpoch = allocated === MAX_U64.toString() ? null : incrementU64(allocated, "stream epoch allocator exhausted");
    return allocated;
  };
  const streams = new Map(streamEntries.map(([id, source]) => {
    const epoch = source.epoch === undefined ? allocateEpoch() : cursorString(source.epoch, true);
    usedEpochs.add(epoch);
    return [id, {
      epoch,
      next_sequence: source.next_sequence === null ? null : cursorString(source.next_sequence ?? "1", true),
      acknowledged: cursorString(source.acknowledged ?? "0"),
      events: (source.events ?? []).map((event) => ({
        ...event,
        sequence: cursorString(event.sequence, true),
        stream_epoch: cursorString(event.stream_epoch ?? epoch, true),
        ordinal: cursorString(event.ordinal, true),
      })),
      evicted: (source.evicted ?? []).map((event) => ({ ...event, sequence: cursorString(event.sequence, true) })),
    }];
  }));
  for (const [id, target] of streams) validateStream(id, target);
  const retainedOrdinals = [...streams.values()].flatMap(({ events }) => events.map(({ ordinal }) => ordinal));
  if (new Set(retainedOrdinals).size !== retainedOrdinals.length) throw new Error("invalid or reused event ordinal");
  const highestRetainedOrdinal = retainedOrdinals.reduce((highest, ordinal) => compareU64(ordinal, highest) > 0 ? ordinal : highest, "0");
  const nextOrdinal = initial.next_ordinal === null
    ? null
    : initial.next_ordinal !== undefined
      ? cursorString(initial.next_ordinal, true)
      : highestRetainedOrdinal === MAX_U64.toString()
        ? null
        : incrementU64(highestRetainedOrdinal, "event ordinal allocator exhausted");
  if (nextOrdinal !== null && compareU64(nextOrdinal, highestRetainedOrdinal) <= 0) throw new Error("invalid event ordinal allocator");
  const generation = jsonU64(initial.generation ?? 0);
  const installedGeneration = jsonU64(initial.installed_generation ?? initial.generation ?? 0);
  const publishedGeneration = jsonU64(initial.published_generation ?? initial.installed_generation ?? initial.generation ?? 0);
  if (compareU64(installedGeneration, generation) > 0 || compareU64(publishedGeneration, installedGeneration) > 0) {
    throw new Error("invalid installed generation state");
  }
  const retainedCommitHours = [
    ...[...durableMaps.idempotency.values(), ...durableMaps.durableResults.values()].map(({ committed_at }) => committed_at),
    ...[...streams.values()].flatMap(({ events }) => events.map(({ committed_at }) => committed_at)),
  ];
  const lastCommitHour = initial.last_commit_hour ?? Math.max(0, ...retainedCommitHours);
  if (!Number.isSafeInteger(lastCommitHour) || lastCommitHour < 0) throw new Error("invalid commit clock");
  for (const record of [...durableMaps.idempotency.values(), ...durableMaps.durableResults.values()]) {
    if (record.committed_at > lastCommitHour) throw new Error("checkpoint record exceeds commit clock");
  }
  for (const target of streams.values()) {
    for (const event of target.events) {
      if (!Number.isSafeInteger(event.committed_at) || event.committed_at < 0 || event.committed_at > lastCommitHour) {
        throw new Error("checkpoint event exceeds commit clock");
      }
    }
  }
  const worldSeed = initial.world_seed ?? "00".repeat(32);
  if (!/^[0-9a-f]{64}$/i.test(worldSeed)) throw new Error("invalid world seed");
  const rngAudit = clone(initial.rng_audit ?? []);
  for (const audit of rngAudit) {
    if (!audit || canonicalJson(deterministicDraw(worldSeed, audit.input, audit.bound)) !== canonicalJson(audit.output)) {
      throw new Error("invalid checkpoint RNG audit");
    }
  }
  const worldValue = initial.world_value ?? 0;
  if (!Number.isSafeInteger(worldValue)) throw new Error("invalid world value");
  return {
    generation,
    installed_generation: installedGeneration,
    published_generation: publishedGeneration,
    world_value: worldValue,
    writer_occupied: initial.writer_occupied ?? false,
    writer_unavailable: initial.writer_unavailable ?? false,
    pending: undefined,
    expected_sequences: durableMaps.expectedSequences,
    idempotency: durableMaps.idempotency,
    durable_results: durableMaps.durableResults,
    streams,
    next_stream_epoch: nextStreamEpoch,
    next_ordinal: nextOrdinal,
    committed_frames: initial.committed_frames ?? [],
    build_id: initial.build_id ?? "same-build",
    replay_version: initial.replay_version ?? 1,
    rng_audit: rngAudit,
    world_seed: worldSeed,
    digest_contract_version: initial.digest_contract_version ?? 1,
    rng_contract_version: initial.rng_contract_version ?? 1,
    last_commit_hour: lastCommitHour,
    inspect_stream_ids: initial.inspect_stream_ids,
  };
}

function idempotencyKey(command) {
  return JSON.stringify([byteIdentity(command.aigent_id), command.protocol_major ?? 1, byteIdentity(command.idempotency_key)]);
}

function sessionKey(command) {
  return JSON.stringify([byteIdentity(command.aigent_id), byteIdentity(command.session_epoch)]);
}

function resultKey(command) {
  return JSON.stringify([byteIdentity(command.aigent_id), byteIdentity(command.session_epoch), command.sequence]);
}

function isRetained(record, nowHour) {
  return nowHour - record.committed_at < IDEMPOTENCY_RETENTION_HOURS ||
    record.live_epoch === true ||
    (record.live_epochs?.length ?? 0) > 0;
}

function purgeExpiredIdempotency(state, nowHour) {
  for (const [key, record] of state.idempotency) {
    if (!isRetained(record, nowHour)) state.idempotency.delete(key);
  }
  for (const [key, record] of state.durable_results) {
    if (!isRetained(record, nowHour)) state.durable_results.delete(key);
  }
}

function operationalHour(state, suppliedHour) {
  const candidate = suppliedHour ?? state.last_commit_hour;
  if (!Number.isSafeInteger(candidate) || candidate < 0) throw new Error("invalid operational clock");
  const hour = Math.max(candidate, state.last_commit_hour);
  state.last_commit_hour = hour;
  return hour;
}

function stream(state, streamId) {
  if (!state.streams.has(streamId)) {
    if (state.next_stream_epoch === null) throw new Error("stream epoch allocator exhausted");
    const epoch = state.next_stream_epoch;
    state.next_stream_epoch = epoch === MAX_U64.toString() ? null : incrementU64(epoch, "stream epoch allocator exhausted");
    state.streams.set(streamId, { epoch, next_sequence: "1", acknowledged: "0", events: [], evicted: [] });
  }
  return state.streams.get(streamId);
}

function validateStream(streamId, target) {
  try {
    cursorString(target.epoch, true);
    if (target.next_sequence !== null) cursorString(target.next_sequence, true);
    cursorString(target.acknowledged);
  } catch {
    throw new Error(`invalid stream cursor for ${streamId}`);
  }
  const seen = new Set();
  for (const event of target.events) {
    if (!isU64(event.sequence, true) || event.stream_epoch !== target.epoch || seen.has(event.sequence)) {
      throw new Error(`invalid stream event sequence for ${streamId}`);
    }
    seen.add(event.sequence);
  }
  for (const event of target.evicted) {
    if (!isU64(event.sequence, true) || seen.has(event.sequence)) {
      throw new Error(`invalid stream event sequence for ${streamId}`);
    }
    seen.add(event.sequence);
  }
  const greatestSent = target.next_sequence === null ? MAX_U64 : u64Value(target.next_sequence) - 1n;
  const acknowledged = u64Value(target.acknowledged);
  if (acknowledged > greatestSent) throw new Error(`invalid acknowledged cursor for ${streamId}`);
  const visible = [...seen].filter((sequence) => compareU64(sequence, target.acknowledged) > 0).sort(compareU64);
  if (BigInt(visible.length) !== greatestSent - acknowledged ||
    visible.some((sequence, index) => u64Value(sequence) !== acknowledged + BigInt(index) + 1n)) {
    throw new Error(`non-contiguous stream history for ${streamId}`);
  }
}

function allocateEventSequence(target) {
  if (target.next_sequence === null) throw new Error("event sequence allocator exhausted");
  const sequence = target.next_sequence;
  target.next_sequence = sequence === MAX_U64.toString() ? null : incrementU64(sequence, "event sequence allocator exhausted");
  return sequence;
}

function allocateEventOrdinal(state) {
  if (state.next_ordinal === null) throw new Error("event ordinal allocator exhausted");
  const ordinal = state.next_ordinal;
  state.next_ordinal = ordinal === MAX_U64.toString() ? null : incrementU64(ordinal, "event ordinal allocator exhausted");
  return ordinal;
}

function transient(command, code) {
  return {
    type: "protocol_error",
    command_id: command.command_id,
    code,
    ...(code === "PERSISTENCE_BACKPRESSURE" ? { retry_after_ticks: 1 } : {}),
  };
}

function acceptIntoPending(state, command, nowHour, outputs) {
  const key = idempotencyKey(command);
  const semanticDigest = digest(command);
  const prior = state.pending.tentative_idempotency.get(key);
  const expected = sequenceCursor(state.pending.tentative_sequences, sessionKey(command));
  const classification = expected === null ? "below" : BigInt(command.sequence) < BigInt(expected) ? "below" : BigInt(command.sequence) > BigInt(expected) ? "gap" : "exact";
  if (classification === "below") {
    const durable = state.durable_results.get(resultKey(command));
    if (durable && durable.key === key && durable.digest === semanticDigest && isRetained(durable, nowHour)) {
      outputs.push({ type: "command_result_replayed", command_id: command.command_id, result: clone(durable.result) });
      return false;
    }
  }
  if (classification !== "exact") {
    outputs.push({
      type: "command_result",
      command_id: command.command_id,
      outcome: "rejected",
      reason: classification === "below" ? "SEQUENCE_CONTENT_CONFLICT" : "SEQUENCE_GAP",
    });
    return false;
  }
  if (prior && isRetained(prior, nowHour) && prior.digest === semanticDigest) {
    const result = clone(prior.result);
    state.pending.commands.push({ command: clone(command), digest: semanticDigest, result, key, preserve_idempotency: true, alias: true, ordinal: state.pending.commands.length });
    state.pending.tentative_sequences.set(sessionKey(command), nextSequence(command.sequence));
    return true;
  }
  const result = command.available === false
    ? { outcome: "rejected", reason: "UNSUPPORTED_MESSAGE" }
    : prior && isRetained(prior, nowHour) && prior.digest !== semanticDigest
          ? { outcome: "rejected", reason: "IDEMPOTENCY_CONFLICT" }
        : command.domain === "rejected"
    ? { outcome: "rejected", reason: command.reason ?? "DOMAIN_REJECTED" }
    : { outcome: "accepted", mutation_delta: command.mutation_delta ?? 0 };
  const preserveIdempotency = Boolean(prior && isRetained(prior, nowHour));
  state.pending.commands.push({ command: clone(command), digest: semanticDigest, result, key, preserve_idempotency: preserveIdempotency, ordinal: state.pending.commands.length });
  if (!preserveIdempotency) {
    state.pending.tentative_idempotency.set(key, {
      digest: semanticDigest,
      result: clone(result),
      committed_at: nowHour,
      live_epochs: [sessionKey(command)],
    });
  }
  state.pending.tentative_sequences.set(sessionKey(command), nextSequence(command.sequence));
  return true;
}

function committedPrecedence(state, command, nowHour) {
  const expected = sequenceCursor(state.expected_sequences, sessionKey(command));
  if (expected !== null && BigInt(command.sequence) >= BigInt(expected)) return undefined;
  const result = state.durable_results.get(resultKey(command));
  if (result && result.key === idempotencyKey(command) && result.digest === digest(command) && isRetained(result, nowHour)) {
    return { type: "command_result_replayed", command_id: command.command_id, result: clone(result.result) };
  }
  return { type: "command_result", command_id: command.command_id, outcome: "rejected", reason: "SEQUENCE_CONTENT_CONFLICT" };
}

function admit(state, step) {
  const commands = [...step.commands];
  if (step.now_hour !== undefined && (!Number.isSafeInteger(step.now_hour) || step.now_hour < 0)) {
    return [{ type: "admission_rejected", reason: "invalid_commit_clock" }];
  }
  if (commands.some((command) => !validCommand(command))) {
    return [{ type: "admission_rejected", reason: "invalid_command_metadata" }];
  }
  const tuples = new Set();
  for (const command of commands) {
    const tuple = JSON.stringify([command.arrival_tick, byteIdentity(command.aigent_id), command.sequence]);
    if (tuples.has(tuple)) return [{ type: "admission_rejected", reason: "duplicate_order_tuple" }];
    tuples.add(tuple);
  }
  const ordered = commands.sort(commandOrder);
  const nowHour = Math.max(step.now_hour ?? state.last_commit_hour, state.last_commit_hour);
  const preclassified = ordered.map((command) => ({ command, output: committedPrecedence(state, command, nowHour) }));
  const candidates = preclassified.filter(({ output }) => output === undefined).map(({ command }) => command);
  const outputs = preclassified.filter(({ output }) => output !== undefined).map(({ output }) => output);
  const projected = new Map(state.expected_sequences);
  const tentativeBatchResults = new Map();
  const retriesByOriginal = new Map();
  const exact = [];
  for (const command of candidates) {
    const key = sessionKey(command);
    const expected = sequenceCursor(projected, key);
    if (expected === null || BigInt(command.sequence) !== BigInt(expected)) {
      const tentative = tentativeBatchResults.get(resultKey(command));
      if (tentative && tentative.key === idempotencyKey(command) && tentative.digest === digest(command)) {
        const retries = retriesByOriginal.get(tentative.command) ?? [];
        retries.push(command);
        retriesByOriginal.set(tentative.command, retries);
        continue;
      }
      outputs.push({ type: "command_result", command_id: command.command_id, outcome: "rejected", reason: expected === null || BigInt(command.sequence) < BigInt(expected) ? "SEQUENCE_CONTENT_CONFLICT" : "SEQUENCE_GAP" });
      continue;
    }
    exact.push(command);
    tentativeBatchResults.set(resultKey(command), {
      command,
      key: idempotencyKey(command),
      digest: digest(command),
    });
    projected.set(key, nextSequence(expected));
  }
  if (exact.length === 0) return outputs;
  if (state.writer_unavailable) {
    return [...outputs, ...exact.flatMap((command) => [command, ...(retriesByOriginal.get(command) ?? [])].map((candidate) => ({
      ...transient(candidate, "PERSISTENCE_UNAVAILABLE"),
      connection_closed: true,
    })))];
  }
  if (state.writer_occupied || state.pending) {
    return [...outputs, ...exact.flatMap((command) => [command, ...(retriesByOriginal.get(command) ?? [])].map((candidate) =>
      transient(candidate, "PERSISTENCE_BACKPRESSURE")
    ))];
  }
  let bytes = 0;
  const prefix = [];
  let cut = exact.length;
  for (let index = 0; index < exact.length; index += 1) {
    const command = exact[index];
    const encodedBytes = encodedRecordBytes(command);
    if (prefix.length >= MAX_COMMANDS_PER_GENERATION || bytes + encodedBytes > MAX_DURABLE_BYTES_PER_GENERATION) {
      cut = index;
      break;
    }
    prefix.push(command);
    bytes += encodedBytes;
  }
  for (const command of exact.slice(cut)) {
    for (const candidate of [command, ...(retriesByOriginal.get(command) ?? [])]) {
      outputs.push(encodedRecordBytes(command) > MAX_DURABLE_BYTES_PER_GENERATION
        ? { ...transient(candidate, "PERSISTENCE_RECORD_TOO_LARGE"), connection_closed: true }
        : transient(candidate, "PERSISTENCE_BACKPRESSURE"));
    }
  }
  if (prefix.length === 0) return outputs;
  const nextGeneration = incrementJsonU64(state.generation, "generation allocator exhausted");
  state.pending = {
    generation: nextGeneration,
    commands: [],
    bytes,
    now_hour: nowHour,
    tentative_sequences: new Map(state.expected_sequences),
    tentative_idempotency: new Map(state.idempotency),
  };
  const stagedIds = [];
  for (const command of prefix) {
    if (acceptIntoPending(state, command, state.pending.now_hour, outputs)) {
      stagedIds.push(command.command_id);
      state.pending.commands.at(-1).replay_commands = clone(retriesByOriginal.get(command) ?? []);
    }
  }
  if (state.pending.commands.length === 0) state.pending = undefined;
  else {
    state.writer_occupied = true;
    outputs.unshift({ type: "generation_admitted", generation: nextGeneration, command_ids: stagedIds, bytes });
  }
  return outputs;
}

function deriveCommitAudits(state, pending) {
  const derivedByItem = new Map();
  const newEventStreams = new Set();
  const eventCounts = new Map();
  let totalEvents = 0n;
  let projectedWorldValue = state.world_value;
  for (const item of pending.commands) {
    if (!validStoredResult(item.result)) throw new Error("invalid authoritative command result");
    if (!item.alias && item.result.outcome === "accepted") {
      projectedWorldValue += item.result.mutation_delta;
      if (!Number.isSafeInteger(projectedWorldValue)) throw new Error("world value exceeds safe semantic range");
    }
    const suppliedAudits = item.command.rng_audit ?? [];
    if (!Array.isArray(suppliedAudits) || (item.alias && suppliedAudits.length > 0)) {
      throw new Error("invalid RNG audit evidence");
    }
    const derivedAudits = suppliedAudits.map((audit) => {
      if (!audit || audit.output === undefined) throw new Error("invalid RNG audit evidence");
      if (audit.input?.canonical_command_index !== item.ordinal ||
        audit.input.generation !== undefined && compareU64(audit.input.generation, pending.generation) !== 0) {
        throw new Error("RNG audit does not belong to committed command");
      }
      const output = deterministicDraw(state.world_seed, audit.input, audit.bound);
      if (canonicalJson(audit.output) !== canonicalJson(output)) throw new Error("invalid RNG audit evidence");
      return { input: clone(audit.input), bound: String(audit.bound), output };
    });
    derivedByItem.set(item, derivedAudits);
    for (const event of item.alias ? [] : item.command.events ?? []) {
      const id = String(event.stream_id);
      totalEvents += 1n;
      eventCounts.set(id, (eventCounts.get(id) ?? 0n) + 1n);
      if (!state.streams.has(id)) newEventStreams.add(id);
    }
  }
  for (const [id, count] of eventCounts) {
    const target = state.streams.get(id);
    if (target) {
      const available = target.next_sequence === null ? 0n : MAX_U64 - u64Value(target.next_sequence) + 1n;
      if (count > available) throw new Error("event sequence allocator exhausted");
    }
  }
  if (newEventStreams.size > 0) {
    const availableEpochs = state.next_stream_epoch === null ? 0n : MAX_U64 - u64Value(state.next_stream_epoch) + 1n;
    if (BigInt(newEventStreams.size) > availableEpochs) throw new Error("stream epoch allocator exhausted");
  }
  const availableOrdinals = state.next_ordinal === null ? 0n : MAX_U64 - u64Value(state.next_ordinal) + 1n;
  if (totalEvents > availableOrdinals) throw new Error("event ordinal allocator exhausted");
  return derivedByItem;
}

function commit(state, step) {
  if (!state.pending || state.pending.committed) return [{ type: "commit_ignored" }];
  if (step.outcome === "writer_error") {
    const outputs = state.pending.commands.map(({ command }) => ({ type: "protocol_error", command_id: command.command_id, code: "PERSISTENCE_UNAVAILABLE" }));
    state.pending = undefined;
    state.writer_occupied = false;
    state.writer_unavailable = true;
    return [
      ...outputs,
      { type: "writer_error", code: "PERSISTENCE_UNAVAILABLE" },
      { type: "command_capability_closed", code: "PERSISTENCE_UNAVAILABLE" },
    ];
  }
  const pending = state.pending;
  pending.now_hour = Math.max(pending.now_hour, state.last_commit_hour);
  const derivedAudits = deriveCommitAudits(state, pending);
  for (const item of pending.commands) {
    const { command, result, key, digest: semanticDigest, ordinal, preserve_idempotency } = item;
    const activeSession = sessionKey(command);
    state.expected_sequences.set(sessionKey(command), nextSequence(command.sequence));
    if (!preserve_idempotency) {
      state.idempotency.set(key, {
        digest: semanticDigest,
        result: clone(result),
        committed_at: pending.now_hour,
        live_epochs: [activeSession],
      });
    } else {
      const retained = state.idempotency.get(key);
      if (retained && !retained.live_epochs?.includes(activeSession)) {
        retained.live_epochs = [...(retained.live_epochs ?? []), activeSession];
      }
    }
    state.durable_results.set(resultKey(command), {
      key,
      digest: semanticDigest,
      result: clone(result),
      committed_at: pending.now_hour,
      live_epoch: true,
    });
    for (const event of item.alias ? [] : command.events ?? []) {
      const target = stream(state, String(event.stream_id));
      const durableEvent = {
        sequence: allocateEventSequence(target), bytes: event.bytes, committed_at: pending.now_hour,
        ordinal: allocateEventOrdinal(state), payload: event.payload ?? "", stream_epoch: target.epoch,
      };
      target.events.push(durableEvent);
      (item.emitted_events ??= []).push({ stream_id: String(event.stream_id), ...durableEvent });
    }
    const payload = {
      build_id: state.build_id,
      replay_version: state.replay_version,
      prior_generation: decrementJsonU64(pending.generation),
      command: {
        command_id: command.command_id,
        arrival_tick: command.arrival_tick,
        aigent_id: command.aigent_id,
        session_epoch: command.session_epoch,
        sequence: command.sequence,
        idempotency_key: command.idempotency_key,
        protocol_major: command.protocol_major ?? 1,
        kind: command.kind,
        required_features: clone(digestMaterial(command).features),
        payload_mode: digestMaterial(command).payloadMode,
        canonical_payload_hex: digestMaterial(command).payload.toString("hex"),
      },
      digest: semanticDigest,
      result: clone(result),
      encoded_frame_bytes: encodedRecordBytes(command),
      generation_record_count: pending.commands.length,
      alias: item.alias === true,
      preserve_idempotency: preserve_idempotency === true,
      committed_at: pending.now_hour,
      events: item.alias ? [] : clone(item.emitted_events ?? []),
      rng_audit: item.alias ? [] : clone(derivedAudits.get(item)),
    };
    const payloadBytes = Buffer.from(encodeCommandOutcomeHex(payload), "hex");
    const payloadHex = payloadBytes.toString("hex");
    const frame = {
      magic: "AIGR",
      version: 1,
      type: 1,
      generation: pending.generation,
      prior_generation: decrementJsonU64(pending.generation),
      ordinal,
      payload,
      payload_hex: payloadHex,
      payload_sha256: sha256(payloadBytes),
      projection_sha256: sha256(Buffer.from(canonicalJson(payload), "utf8")),
      declared_length: payloadBytes.length,
    };
    state.committed_frames.push({ ...frame, encoded_frame_bytes: encodedRecordBytes(command), checksum: frameChecksum(frame) });
  }
  state.generation = pending.generation;
  state.last_commit_hour = Math.max(state.last_commit_hour, pending.now_hour);
  state.pending = { ...pending, committed: true };
  return [{ type: "generation_committed", generation: state.generation, command_count: pending.commands.length }];
}

function applyInstalledWorld(state) {
  if (state.pending.applied) return;
  for (const { result, alias } of state.pending.commands) if (!alias && result.outcome === "accepted") state.world_value += result.mutation_delta;
  state.pending.applied = true;
}

function install(state) {
  if (!state.pending?.committed) return [{ type: "install_ignored" }];
  applyInstalledWorld(state);
  state.installed_generation = state.pending.generation;
  state.published_generation = state.pending.generation;
  return [{ type: "generation_installed", generation: state.pending.generation }];
}

function deliverResults(state) {
  if (!state.pending?.committed || state.installed_generation !== state.pending.generation || state.pending.results_delivered) return [{ type: "delivery_ignored" }];
  const outputs = state.pending.commands
    .flatMap(({ command, result, replay_commands = [] }) => [
      { command, output: { type: "command_result", command_id: command.command_id, ...clone(result) } },
      ...replay_commands.map((retry) => ({
        command: retry,
        output: {
          type: "command_result_replayed",
          command_id: retry.command_id,
          result: clone(result),
        },
      })),
    ])
    .sort((left, right) => commandOrder(left.command, right.command))
    .map(({ output }) => output);
  state.pending.results_delivered = true;
  return outputs;
}

function deliverEvents(state) {
  if (!state.pending?.committed || state.installed_generation !== state.pending.generation || !state.pending.results_delivered) return [{ type: "delivery_ignored" }];
  const events = state.pending.commands.flatMap(({ emitted_events = [] }) => emitted_events.map((event) => ({ type: "ordered_event", ...clone(event) }))).sort((a, b) => compareU64(a.ordinal, b.ordinal));
  state.pending = undefined;
  state.writer_occupied = false;
  return events;
}

function deliver(state) {
  const results = deliverResults(state);
  if (results[0]?.type === "delivery_ignored") return results;
  return [...results, ...deliverEvents(state)];
}

function crash(state, step) {
  const phase = step.phase;
  if (phase === "pre_commit" || phase === "uncommitted_tail") {
    state.pending = undefined;
    state.writer_occupied = false;
    return [{ type: "recovered", outcome: "pre_commit_no_effect", generation: state.generation }];
  }
  if (phase === "post_commit") {
    if (!state.pending?.committed) throw new Error("post_commit crash requires committed generation");
    applyInstalledWorld(state);
    state.installed_generation = state.pending.generation;
    state.published_generation = state.pending.generation;
    return [{ type: "recovered", outcome: "installed_committed_generation", generation: state.pending.generation }];
  }
  if (phase === "post_delivery") {
    return [{ type: "recovered", outcome: "durable_output_replayable", generation: state.installed_generation }];
  }
  if (phase === "post_result") {
    if (!state.pending?.committed || !state.pending.results_delivered) throw new Error("post_result crash requires delivered results");
    state.pending = undefined;
    state.writer_occupied = false;
    return [{ type: "crashed", phase: "post_result", generation: state.generation }];
  }
  if (phase === "post_install") {
    if (!state.pending?.committed) throw new Error("post_install crash requires committed generation");
    return [{ type: "recovered", outcome: "durable_output_replayable", generation: state.pending.generation }];
  }
  throw new Error(`unknown crash phase: ${phase}`);
}

function evictEvents(state, nowHour) {
  nowHour = operationalHour(state, nowHour);
  const evicted = [];
  const remove = (id, event, reason) => {
    const target = stream(state, id);
    target.events.splice(target.events.indexOf(event), 1);
    target.evicted.push({ sequence: event.sequence, reason });
    evicted.push({ type: "event_evicted", stream_id: id, sequence: event.sequence, reason });
  };
  const order = (candidates) => candidates.sort((a, b) => compareU64(a.event.ordinal, b.event.ordinal) || compareUnsigned(a.id, b.id) || compareU64(a.event.sequence, b.event.sequence));
  for (const { id, event } of order([...state.streams.entries()].flatMap(([id, target]) => target.events.filter((event) => nowHour - event.committed_at >= EVENT_RETENTION_HOURS).map((event) => ({ id, event }))))) {
    remove(id, event, "age");
  }
  for (const [id, target] of state.streams) {
    while (target.events.reduce((sum, event) => sum + event.bytes, 0) > EVENT_STREAM_BYTE_CAP) {
      remove(id, [...target.events].sort((a, b) => compareU64(a.ordinal, b.ordinal) || compareU64(a.sequence, b.sequence))[0], "stream_cap");
    }
  }
  const total = () => [...state.streams.values()].flatMap(({ events }) => events).reduce((sum, event) => sum + event.bytes, 0);
  while (total() > EVENT_GLOBAL_BYTE_CAP) {
    const candidates = order([...state.streams.entries()].flatMap(([id, target]) => target.events.map((event) => ({ id, event }))));
    remove(candidates[0].id, candidates[0].event, "global_cap");
  }
  return evicted;
}

function acknowledge(state, step) {
  if (step.stream_epoch === undefined) return [{ type: "event_cursor_invalid", stream_id: String(step.stream_id), reason: "MISSING_EPOCH" }];
  let epoch;
  let sequence;
  try {
    epoch = cursorString(step.stream_epoch, true);
    sequence = cursorString(step.sequence);
  } catch {
    return [{ type: "event_cursor_invalid", stream_id: String(step.stream_id), reason: "INVALID_UINT64" }];
  }
  const target = state.streams.get(String(step.stream_id));
  if (!target) return [{ type: "event_cursor_invalid", stream_id: String(step.stream_id), reason: "UNKNOWN_STREAM" }];
  if (epoch !== target.epoch) return [{ type: "event_cursor_resync", stream_id: String(step.stream_id), epoch: target.epoch }];
  const sent = target.next_sequence === null ? MAX_U64.toString() : (u64Value(target.next_sequence) - 1n).toString();
  if (compareU64(sequence, sent) > 0) {
    return [{ type: "event_ack_rejected", stream_id: String(step.stream_id), sequence, reason: "ACK_AHEAD" }];
  }
  if (compareU64(sequence, target.acknowledged) <= 0) {
    return [{ type: "event_acknowledged", stream_id: String(step.stream_id), sequence: target.acknowledged }];
  }
  target.acknowledged = sequence;
  target.events = target.events.filter((event) => compareU64(event.sequence, target.acknowledged) > 0);
  return [{ type: "event_acknowledged", stream_id: String(step.stream_id), sequence: target.acknowledged }];
}

function resume(state, step) {
  if (step.stream_epoch === undefined) return [{ type: "event_cursor_invalid", stream_id: String(step.stream_id), reason: "MISSING_EPOCH" }];
  let epoch;
  let requestedAfter;
  try {
    epoch = cursorString(step.stream_epoch, true);
    requestedAfter = cursorString(step.last_acknowledged ?? "0");
  } catch {
    return [{ type: "event_cursor_invalid", stream_id: String(step.stream_id), reason: "INVALID_UINT64" }];
  }
  const target = state.streams.get(String(step.stream_id));
  if (!target) return [{ type: "event_cursor_invalid", stream_id: String(step.stream_id), reason: "UNKNOWN_STREAM" }];
  if (epoch !== target.epoch) {
    return [{ type: "event_cursor_resync", stream_id: String(step.stream_id), epoch: target.epoch }];
  }
  const after = compareU64(requestedAfter, target.acknowledged) > 0 ? requestedAfter : target.acknowledged;
  const greatestSent = target.next_sequence === null ? MAX_U64.toString() : (u64Value(target.next_sequence) - 1n).toString();
  if (compareU64(after, greatestSent) > 0) {
    return [{ type: "event_resume_rejected", stream_id: String(step.stream_id), sequence: after, reason: "CURSOR_AHEAD" }];
  }
  const missing = target.evicted.filter((event) => compareU64(event.sequence, after) > 0).map(({ sequence }) => sequence);
  if (missing.length > 0) {
    const greatest = missing.reduce((value, candidate) => compareU64(candidate, value) > 0 ? candidate : value, greatestSent);
    if (state.next_stream_epoch === null) throw new Error("stream epoch allocator exhausted");
    target.epoch = state.next_stream_epoch;
    state.next_stream_epoch = target.epoch === MAX_U64.toString() ? null : incrementU64(target.epoch, "stream epoch allocator exhausted");
    target.next_sequence = "1";
    target.acknowledged = "0";
    target.events = [];
    target.evicted = [];
    const unavailableFrom = missing.reduce((value, candidate) => compareU64(candidate, value) < 0 ? candidate : value);
    return [{ type: "event_stream_reset", stream_id: String(step.stream_id), unavailable_from: unavailableFrom, unavailable_through: greatest, epoch: target.epoch }];
  }
  return [{ type: "events_replayed", stream_id: String(step.stream_id), sequences: target.events.filter((event) => compareU64(event.sequence, after) > 0).map(({ sequence }) => sequence) }];
}

function releaseSession(state, step) {
  const nowHour = operationalHour(state, step.now_hour);
  const released = sessionKey({ aigent_id: step.aigent_id, session_epoch: step.session_epoch });
  const releasedAigent = byteIdentity(step.aigent_id);
  const releasedEpoch = byteIdentity(step.session_epoch);
  for (const record of state.idempotency.values()) {
    record.live_epochs = (record.live_epochs ?? []).filter((candidate) => candidate !== released);
  }
  for (const [identity, record] of state.durable_results) {
    const [aigentId, epoch] = JSON.parse(identity);
    if (aigentId === releasedAigent && epoch === releasedEpoch) record.live_epoch = false;
  }
  purgeExpiredIdempotency(state, nowHour);
  return [{ type: "session_released", aigent_id: step.aigent_id, session_epoch: step.session_epoch }];
}

function recoveryFailure(record, reason = "committed_record_corruption") {
  return [{ type: "recovery_failed", reason, ...(record?.ordinal === undefined ? {} : { ordinal: record.ordinal }) }];
}

function validateRecoveryFrames(records, checkpointGeneration) {
  let generation = u64Value(checkpointGeneration);
  let ordinal = -1;
  const generationCounts = new Map();
  for (let index = 0; index < records.length; index += 1) {
    const record = records[index];
    let recordGeneration;
    try {
      recordGeneration = u64Value(record.generation);
    } catch {
      return recoveryFailure(record);
    }
    let payload;
    try {
      payload = framePayload(record);
    } catch {
      return recoveryFailure(record);
    }
    const projectedPayload = Buffer.from(canonicalJson(record.payload ?? {}), "utf8");
    let decodedProjection;
    try {
      decodedProjection = decodeCommandOutcomeHex(record.payload_hex);
    } catch {
      return recoveryFailure(record);
    }
    let expectedWire;
    let encodedFromPayload;
    let reboundDecodedHex;
    try {
      expectedWire = wireSemanticProjection(record.payload ?? {});
      encodedFromPayload = encodeCommandOutcomeHex(record.payload ?? {});
      reboundDecodedHex = encodeCommandOutcomeHex(decodedProjection);
    } catch {
      return recoveryFailure(record);
    }
    if (record.magic !== "AIGR" || record.version !== 1 || record.type !== 1 ||
      !Number.isSafeInteger(record.ordinal) || record.declared_length !== payload.length ||
      record.payload_sha256 !== sha256(payload) ||
      record.projection_sha256 !== sha256(projectedPayload) ||
      record.payload_hex !== encodedFromPayload ||
      record.payload_hex !== reboundDecodedHex ||
      canonicalJson(decodedProjection) !== canonicalJson(expectedWire) ||
      record.checksum !== frameChecksum(record)) return recoveryFailure(record);
    let priorGeneration;
    try {
      priorGeneration = u64Value(record.payload?.prior_generation);
    } catch {
      return recoveryFailure(record);
    }
    if (index === 0 || recordGeneration !== generation) {
      if (recordGeneration !== generation + 1n || priorGeneration !== generation || record.ordinal !== 0) return recoveryFailure(record);
      generation = recordGeneration;
      ordinal = 0;
    } else {
      ordinal += 1;
      if (record.ordinal !== ordinal || priorGeneration !== generation - 1n) return recoveryFailure(record);
    }
    const expectedCount = record.payload?.generation_record_count;
    if (!Number.isSafeInteger(expectedCount) || expectedCount < 1 || expectedCount > MAX_COMMANDS_PER_GENERATION) {
      return recoveryFailure(record);
    }
    const generationKey = recordGeneration.toString();
    const priorCount = generationCounts.get(generationKey);
    if (priorCount && priorCount.expected !== expectedCount) return recoveryFailure(record);
    generationCounts.set(generationKey, {
      expected: expectedCount,
      actual: (priorCount?.actual ?? 0) + 1,
      record,
    });
  }
  for (const { expected, actual, record } of generationCounts.values()) {
    if (actual !== expected) return recoveryFailure(record);
  }
  return { generation: records.at(-1)?.generation ?? checkpointGeneration };
}

function stateFromCheckpoint(checkpoint) {
  const state = createState({
    generation: checkpoint.generation,
    installed_generation: checkpoint.generation,
    published_generation: checkpoint.generation,
    world_value: checkpoint.world_value ?? 0,
    expected_sequences: checkpoint.expected_sequences ?? {},
    idempotency: checkpoint.idempotency ?? {},
    durable_results: checkpoint.durable_results ?? {},
    streams: checkpoint.streams ?? {},
    next_stream_epoch: checkpoint.next_stream_epoch,
    next_ordinal: checkpoint.next_ordinal,
    build_id: checkpoint.build_id,
    replay_version: checkpoint.replay_version,
    rng_audit: checkpoint.rng_audit ?? [],
    world_seed: checkpoint.world_seed,
    digest_contract_version: checkpoint.digest_contract_version,
    rng_contract_version: checkpoint.rng_contract_version,
    last_commit_hour: checkpoint.last_commit_hour ?? 0,
  });
  // A cold restart disconnects every historical command session. Retention
  // decisions already made before the crash are carried by committed outcomes,
  // but recovered rows cannot keep a session live after process death.
  for (const record of state.idempotency.values()) record.live_epochs = [];
  for (const record of state.durable_results.values()) record.live_epoch = false;
  return state;
}

function applyRecoveredOutcome(state, record) {
  const payload = record.payload;
  if (!payload?.command || payload.build_id !== state.build_id ||
    payload.replay_version !== state.replay_version ||
    compareU64(payload.prior_generation, decrementJsonU64(record.generation)) !== 0) throw new Error("recovery payload mismatch");
  const command = payload.command;
  if (!validCommandMetadata(command, true) || !validStoredResult(payload.result) ||
    typeof payload.alias !== "boolean" || typeof payload.preserve_idempotency !== "boolean" ||
    !Number.isSafeInteger(payload.encoded_frame_bytes) || payload.encoded_frame_bytes <= 0 ||
    payload.encoded_frame_bytes > MAX_DURABLE_BYTES_PER_GENERATION ||
    record.encoded_frame_bytes !== payload.encoded_frame_bytes ||
    !Number.isSafeInteger(payload.committed_at) || payload.committed_at < state.last_commit_hour ||
    !Array.isArray(payload.events) || !Array.isArray(payload.rng_audit) ||
    payload.alias && (payload.events.length > 0 || payload.rng_audit.length > 0)) {
    throw new Error("invalid recovered outcome");
  }
  if (digest(command) !== payload.digest) throw new Error("recovered digest mismatch");
  const expected = sequenceCursor(state.expected_sequences, sessionKey(command));
  if (expected === null || command.sequence !== expected) throw new Error("recovered sequence gap");
  const derivedAudits = payload.rng_audit.map((audit) => {
    if (!audit || audit.output === undefined ||
      audit.input?.canonical_command_index !== record.ordinal ||
      audit.input.generation !== undefined && compareU64(audit.input.generation, record.generation) !== 0) {
      throw new Error("recovered RNG ownership mismatch");
    }
    const derived = deterministicDraw(state.world_seed, audit.input, audit.bound);
    if (canonicalJson(derived) !== canonicalJson(audit.output)) throw new Error("recovered RNG mismatch");
    return { input: clone(audit.input), bound: String(audit.bound), output: derived };
  });
  const key = idempotencyKey(command);
  const prior = state.idempotency.get(key);
  const retainedPrior = prior && isRetained(prior, payload.committed_at) ? prior : undefined;
  if (payload.preserve_idempotency && !prior) {
    throw new Error("missing preserved idempotency row");
  }
  if (payload.preserve_idempotency && prior.digest === payload.digest) {
    if (!payload.alias || !payload.preserve_idempotency ||
      canonicalJson(payload.result) !== canonicalJson(prior.result)) {
      throw new Error("invalid recovered idempotency alias");
    }
  } else if (command.payload_mode === 1) {
    const expectedResult = { outcome: "rejected", reason: "UNSUPPORTED_MESSAGE" };
    if (payload.alias ||
      (!payload.preserve_idempotency && retainedPrior) ||
      canonicalJson(payload.result) !== canonicalJson(expectedResult)) {
      throw new Error("invalid recovered availability result");
    }
  } else if (payload.preserve_idempotency) {
    if (payload.alias || !payload.preserve_idempotency ||
      canonicalJson(payload.result) !== canonicalJson({ outcome: "rejected", reason: "IDEMPOTENCY_CONFLICT" })) {
      throw new Error("invalid recovered idempotency conflict");
    }
  } else if (payload.alias || retainedPrior) {
    throw new Error("invalid recovered idempotency transition");
  }
  if (!payload.alias && payload.result.outcome === "accepted" &&
    !Number.isSafeInteger(state.world_value + payload.result.mutation_delta)) {
    throw new Error("recovered world value exceeds safe semantic range");
  }
  state.expected_sequences.set(sessionKey(command), nextSequence(command.sequence));
  state.durable_results.set(resultKey(command), {
    key,
    digest: payload.digest,
    result: clone(payload.result),
    committed_at: payload.committed_at,
    live_epoch: false,
  });
  if (!payload.preserve_idempotency) {
    state.idempotency.set(key, {
      digest: payload.digest,
      result: clone(payload.result),
      committed_at: payload.committed_at,
      live_epochs: [],
    });
  }
  if (!payload.alias && payload.result?.outcome === "accepted") state.world_value += payload.result.mutation_delta ?? 0;
  for (const event of payload.events) {
    if (!event || !isU64(event.stream_id, true) || !isU64(event.stream_epoch, true) ||
      !isU64(event.sequence, true) || !isU64(event.ordinal, true) ||
      !Number.isSafeInteger(event.bytes) || event.bytes <= 0 ||
      event.committed_at !== payload.committed_at) {
      throw new Error("invalid recovered durable event");
    }
    const target = stream(state, event.stream_id);
    const sequence = allocateEventSequence(target);
    const ordinal = allocateEventOrdinal(state);
    if (event.stream_epoch !== target.epoch || event.sequence !== sequence || event.ordinal !== ordinal) {
      throw new Error("recovered durable event cursor mismatch");
    }
    target.events.push(clone(event));
  }
  state.rng_audit.push(...derivedAudits);
  state.last_commit_hour = payload.committed_at;
  state.generation = record.generation;
  state.installed_generation = record.generation;
  state.published_generation = record.generation;
}

function classifyTail(tail) {
  if (tail === undefined) return undefined;
  if (typeof tail.bytes_hex !== "string" || tail.bytes_hex.length % 2 !== 0 || !/^[0-9a-f]*$/i.test(tail.bytes_hex)) return { failed: true };
  const bytes = Buffer.from(tail.bytes_hex, "hex");
  if (tail.transaction_committed !== true) return { outcome: "uncommitted_tail_rolled_back" };
  if (bytes.length < 32) return { failed: true };
  const declared = bytes.readBigUInt64BE(20);
  if (declared > BigInt(Number.MAX_SAFE_INTEGER) || bytes.length !== 32 + Number(declared)) return { failed: true };
  if (bytes.subarray(0, 4).toString("ascii") !== "AIGR" || bytes.readUInt16BE(4) !== 1 ||
    bytes.readUInt16BE(6) !== 1 ||
    crc32c(bytes.subarray(0, -4)) !== bytes.subarray(-4).toString("hex")) {
    return { failed: true };
  }
  return { outcome: "committed_tail_complete", bytes };
}

function recover(state, step) {
  const checkpoint = step.checkpoint;
  const checkpointGeneration = checkpoint?.generation ?? step.checkpoint_generation ?? 0;
  const componentGenerations = checkpoint?.component_generations ?? step.component_generations ?? {};
  let checkpointGenerationValue;
  try {
    checkpointGenerationValue = u64Value(checkpointGeneration);
  } catch {
    return recoveryFailure(undefined, "generation_mismatch");
  }
  const requiredComponents = ["world", "allocator", "ruleset", "sessions", "idempotency", "events", "rng"];
  if (!checkpoint && Object.values(componentGenerations).some((value) => {
    try { return u64Value(value) !== checkpointGenerationValue; } catch { return true; }
  })) return [{ type: "recovery_failed", reason: "generation_mismatch" }];
  if (checkpoint && (requiredComponents.some((name) => !(name in componentGenerations)) ||
    Object.values(componentGenerations).some((value) => {
      try { return u64Value(value) !== checkpointGenerationValue; } catch { return true; }
    }))) {
    return [{ type: "recovery_failed", reason: "generation_mismatch" }];
  }
  if (checkpoint && (!step.running_build_id || checkpoint.build_id !== step.running_build_id ||
    checkpoint.replay_version !== 1 || checkpoint.digest_contract_version !== 1 ||
    checkpoint.rng_contract_version !== 1 || !/^[0-9a-f]{64}$/i.test(checkpoint.world_seed ?? "") ||
    !Object.hasOwn(checkpoint, "next_stream_epoch") ||
    (checkpoint.next_stream_epoch !== null && !isU64(checkpoint.next_stream_epoch, true)) ||
    !Object.hasOwn(checkpoint, "next_ordinal") ||
    (checkpoint.next_ordinal !== null && !isU64(checkpoint.next_ordinal, true)) ||
    !Number.isSafeInteger(checkpoint.last_commit_hour) || checkpoint.last_commit_hour < 0)) {
    return recoveryFailure(undefined, "checkpoint_incompatible");
  }
  const tail = classifyTail(step.tail);
  if (tail?.failed) return recoveryFailure(undefined);
  const records = step.records ?? state.committed_frames;
  const verified = validateRecoveryFrames(records, checkpointGeneration);
  if (Array.isArray(verified)) return verified;
  if (tail?.outcome === "committed_tail_complete") {
    try {
      if (records.length === 0 || !encodedFrame(records.at(-1)).equals(tail.bytes)) {
        return recoveryFailure(undefined);
      }
    } catch {
      return recoveryFailure(undefined);
    }
  }
  if (checkpoint) {
    let scratch;
    try {
      scratch = stateFromCheckpoint(checkpoint);
      for (const record of records) applyRecoveredOutcome(scratch, record);
      scratch.committed_frames = clone(records);
      scratch.inspect_stream_ids = state.inspect_stream_ids;
    } catch {
      return recoveryFailure(undefined);
    }
    Object.assign(state, scratch);
    return [{
      type: "recovery_reconstructed",
      generation: state.generation,
      world_value: state.world_value,
      session_cursors: Object.fromEntries([...state.expected_sequences].sort()),
      idempotency_count: state.idempotency.size,
      durable_result_count: state.durable_results.size,
      event_count: [...state.streams.values()].reduce((sum, target) => sum + target.events.length, 0),
      rng_audit_count: state.rng_audit.length,
      ...(tail?.outcome ? { tail_outcome: tail.outcome } : {}),
    }];
  }
  return [{ type: "recovery_verified", generation: verified.generation }];
}

function i64(value) {
  const buffer = Buffer.alloc(8);
  buffer.writeBigInt64BE(BigInt(value));
  return buffer;
}

function encodeRngInput(input, rejectionBlock) {
  const spatial = input.stable_spatial_coordinates;
  const location = spatial === undefined
    ? [Buffer.from([0]), u64(input.generation)]
    : [Buffer.from([1]), i64(spatial.x), i64(spatial.z)];
  const parts = [
    u16(input.rng_contract_version),
    ...utf8(input.subsystem),
    ...utf8(input.purpose),
    ...location,
    u32(input.canonical_command_index),
    u64(input.entity_id),
    u32(input.draw_index),
  ];
  if (rejectionBlock > 0) parts.push(u32(rejectionBlock));
  return Buffer.concat(parts);
}

export function deterministicDraw(worldSeedHex, input, bound) {
  if (!/^[0-9a-f]{64}$/i.test(worldSeedHex)) throw new Error("world seed must be 256-bit hex");
  let normalizedBound;
  try {
    normalizedBound = typeof bound === "bigint" ? bound : BigInt(bound);
  } catch {
    throw new Error("invalid RNG bound or input");
  }
  const hasGeneration = input?.generation !== undefined;
  const hasSpatial = input?.stable_spatial_coordinates !== undefined;
  const spatial = input?.stable_spatial_coordinates;
  const validU32 = (value) => Number.isSafeInteger(value) && value >= 0 && value <= 0xffffffff;
  const validI64 = (value) => {
    if (typeof value === "number" && !Number.isSafeInteger(value)) return false;
    if (typeof value !== "number" && (typeof value !== "string" || !/^(0|-?[1-9]\d*)$/.test(value))) return false;
    try {
      const parsed = BigInt(value);
      return parsed >= -(1n << 63n) && parsed <= (1n << 63n) - 1n;
    } catch {
      return false;
    }
  };
  let validUnsignedInputs = true;
  try {
    u64String(input?.entity_id);
    if (hasGeneration) u64String(input.generation);
  } catch {
    validUnsignedInputs = false;
  }
  if (normalizedBound < 1n || normalizedBound > (1n << 64n) ||
    input?.rng_contract_version !== 1 || !input.subsystem || !input.purpose ||
    hasGeneration === hasSpatial || !validUnsignedInputs ||
    !validU32(input.canonical_command_index) || !validU32(input.draw_index) ||
    (hasSpatial && (!spatial || !validI64(spatial.x) || !validI64(spatial.z)))) {
    throw new Error("invalid RNG bound or input");
  }
  const limit = 1n << 64n;
  const accepted = limit - (limit % normalizedBound);
  const blocks = [];
  for (let rejectionBlock = 0; ; rejectionBlock += 1) {
    const material = encodeRngInput(input, rejectionBlock);
    const bytes = crypto.createHmac("sha256", Buffer.from(worldSeedHex, "hex")).update(material).digest();
    const candidates = Array.from({ length: 4 }, (_, index) => bytes.readBigUInt64BE(index * 8));
    blocks.push({ rejection_block: rejectionBlock, hmac: bytes.toString("hex"), candidates: candidates.map(String) });
    for (let candidateIndex = 0; candidateIndex < 4; candidateIndex += 1) {
      const raw = candidates[candidateIndex];
      if (raw < accepted) return {
        hmac: bytes.toString("hex"),
        value: (raw % normalizedBound).toString(),
        raw: raw.toString(),
        candidate_index: candidateIndex,
        rejection_block: rejectionBlock,
        blocks,
      };
    }
  }
}

function rng(step) {
  const derived = deterministicDraw(step.world_seed, step.input, step.bound);
  if (step.stored === undefined) return [{ type: "rng_draw", ...derived }];
  const verified = step.stored.hmac === derived.hmac && step.stored.raw === derived.raw &&
    step.stored.value === derived.value &&
    step.stored.candidate_index === derived.candidate_index &&
    step.stored.rejection_block === derived.rejection_block &&
    canonicalJson(step.stored.blocks ?? []) === canonicalJson(derived.blocks ?? []);
  return [{ type: "rng_draw_verified", verified, ...derived }];
}

export function evaluateScenario(initial, steps) {
  const state = createState(initial);
  const trace = [];
  for (const step of steps) {
    let outputs;
    switch (step.op) {
      case "admit": outputs = admit(state, step); break;
      case "commit": outputs = commit(state, step); break;
      case "install": outputs = install(state); break;
      case "deliver": outputs = deliver(state); break;
      case "deliver_results": outputs = deliverResults(state); break;
      case "deliver_events": outputs = deliverEvents(state); break;
      case "crash": outputs = crash(state, step); break;
      case "evict_events": outputs = evictEvents(state, step.now_hour); break;
      case "ack": outputs = acknowledge(state, step); break;
      case "resume": outputs = resume(state, step); break;
      case "release_session": outputs = releaseSession(state, step); break;
      case "recover": outputs = recover(state, step); break;
      case "cold_restart": outputs = recover(state, { ...step, op: "recover", records: clone(state.committed_frames) }); break;
      case "rng": outputs = rng(step); break;
      case "inspect_retention": outputs = [{ type: "retention_state", idempotency_count: state.idempotency.size, durable_result_count: state.durable_results.size }]; break;
      case "expire_retention": {
        const nowHour = operationalHour(state, step.now_hour);
        purgeExpiredIdempotency(state, nowHour);
        outputs = [{ type: "retention_expired", now_hour: nowHour }];
        break;
      }
      case "inspect_clock": outputs = [{ type: "commit_clock", hour: state.last_commit_hour }]; break;
      default: throw new Error(`unknown replay operation: ${step.op}`);
    }
    trace.push(...outputs);
  }
  return canonical({
    trace,
    final_state: {
      generation: state.generation,
      installed_generation: state.installed_generation,
      published_generation: state.published_generation,
      world_value: state.world_value,
      writer_occupied: state.writer_occupied,
      writer_unavailable: state.writer_unavailable,
      streams: Object.fromEntries([...state.streams.entries()].filter(([id]) =>
        !state.inspect_stream_ids || state.inspect_stream_ids.includes(id),
      ).sort(([a], [b]) => compareUnsigned(a, b)).map(([id, target]) => [id, {
        epoch: target.epoch,
        acknowledged: target.acknowledged,
        retained_sequences: target.events.map(({ sequence }) => sequence),
        evicted_sequences: target.evicted.map(({ sequence }) => sequence),
      }])),
    },
  });
}

export function validateFixture(fixture) {
  if (fixture?.fixture_format !== "aigent.replay.semantic-fixtures" || fixture.fixture_version !== 1 || !Array.isArray(fixture.cases)) {
    throw new Error("invalid replay fixture header");
  }
  const ids = new Set();
  for (const scenario of fixture.cases) {
    if (typeof scenario.id !== "string" || ids.has(scenario.id) || !scenario.initial || !Array.isArray(scenario.steps) || !scenario.expect) {
      throw new Error("invalid replay fixture case");
    }
    ids.add(scenario.id);
  }
}

export function loadFixture() {
  return JSON.parse(fs.readFileSync(fixturePath, "utf8"));
}

export function evaluateFixtureCase(fixture, scenario) {
  validateFixture(fixture);
  return evaluateScenario(scenario.initial, scenario.steps);
}
