import { fromBinary, ScalarType } from '@bufbuild/protobuf';
import { BinaryReader, WireType } from '@bufbuild/protobuf/wire';
import { WorldSnapshotBodyProtoSchema, WorldSnapshotDeltaProtoSchema } from '@aigent-place/protocol';

export class DemoError extends Error {
  constructor(code, message, retryable = false) {
    super(message);
    this.name = 'DemoError';
    this.code = code;
    this.retryable = retryable;
  }
}
const bad = message => { throw new DemoError('INVALID_OBSERVATION', message); };
const WORLD_BOUND_MM = 100_000_000n;

function scalarWireType(scalar) {
  if ([ScalarType.DOUBLE, ScalarType.FIXED64, ScalarType.SFIXED64].includes(scalar)) return WireType.Bit64;
  if ([ScalarType.FLOAT, ScalarType.FIXED32, ScalarType.SFIXED32].includes(scalar)) return WireType.Bit32;
  if ([ScalarType.STRING, ScalarType.BYTES].includes(scalar)) return WireType.LengthDelimited;
  return WireType.Varint;
}
function delimited(reader) {
  const start = reader.pos;
  const bytes = reader.bytes();
  const prefix = reader.pos - start - bytes.length;
  if (prefix > 5 || (prefix === 5 && reader.buf[start + 4] > 15)) bad('protobuf length overflow');
  return bytes;
}
function scalar(reader, type, scalarType) {
  if (type === WireType.Varint) {
    const start = reader.pos;
    const value = reader.uint64();
    if (reader.pos - start === 10 && reader.buf[reader.pos - 1] > 1) bad('protobuf uint64 overflow');
    if (scalarType === ScalarType.UINT32 && value > 0xffffffffn) bad('protobuf uint32 overflow');
  } else if (type === WireType.LengthDelimited) delimited(reader);
  else reader.skip(type);
}
function unknown(reader, number, type, depth) {
  if (type === WireType.EndGroup) bad('unexpected protobuf end group');
  if (type !== WireType.StartGroup) return scalar(reader, type);
  if (depth >= 100) bad('protobuf nesting limit');
  while (reader.pos < reader.len) {
    const [nested, wire] = reader.tag();
    if (wire === WireType.EndGroup) {
      if (nested !== number) bad('mismatched protobuf group');
      return;
    }
    unknown(reader, nested, wire, depth + 1);
  }
  bad('unterminated protobuf group');
}
function framing(schema, bytes, depth = 0) {
  if (depth > 100) bad('protobuf nesting limit');
  const reader = new BinaryReader(bytes);
  while (reader.pos < reader.len) {
    const [number, type] = reader.tag();
    const field = schema.fields.find(candidate => candidate.number === number);
    if (!field) { unknown(reader, number, type, depth); continue; }
    if (field.fieldKind === 'message' || field.listKind === 'message') {
      if (type !== WireType.LengthDelimited) bad('protobuf message wire type');
      framing(field.message, delimited(reader), depth + 1);
    } else {
      const expected = scalarWireType(field.scalar);
      if (field.fieldKind === 'list' && expected !== WireType.LengthDelimited && type === WireType.LengthDelimited) {
        const packed = new BinaryReader(delimited(reader));
        while (packed.pos < packed.len) scalar(packed, expected, field.scalar);
      } else {
        if (type !== expected) bad('protobuf scalar wire type');
        scalar(reader, type, field.scalar);
      }
    }
  }
}
/** Validate generated-descriptor framing; protobuf owns values and unknown fields. */
export function decodeDemoBinary(schema, bytes) {
  try {
    if (bytes.length > 262_144) bad('frame exceeds demo limit');
    framing(schema, bytes);
    return fromBinary(schema, bytes);
  } catch (error) {
    if (error instanceof DemoError) throw error;
    throw new DemoError('INVALID_OBSERVATION', `protobuf decode: ${error.message}`);
  }
}
function validId(id) { return typeof id === 'bigint' && id > 0n && id <= 0xffffffffffffffffn; }
function validCoordinate(axis) { return typeof axis === 'bigint' && axis >= -WORLD_BOUND_MM && axis <= WORLD_BOUND_MM; }
function validateRecord(body) {
  if (!validId(body.entityId) || !validId(body.revision) || !body.positionMm || ![body.positionMm.xMm, body.positionMm.yMm, body.positionMm.zMm].every(validCoordinate)) bad('invalid body ID/revision/position');
  if (body.aim && (!validCoordinate(body.aim.targetXMm) || !validCoordinate(body.aim.targetZMm) || !Number.isInteger(body.aim.speedMmPerS) || body.aim.speedMmPerS <= 0 || body.aim.speedMmPerS > 0xffffffff)) bad('invalid movement aim');
}
function unique(ids) {
  if (!ids.every(validId) || new Set(ids).size !== ids.length) bad('duplicate or zero entity IDs');
}

/** Atomic observation owner. No guesses; reset and field absence clear binding. */
export class SnapshotView {
  constructor() {
    this.expectedSelfBodyId = undefined;
    this.reset();
  }
  reset() {
    this.baselineId = undefined;
    this.bodies = new Map();
    this.selfBodyId = undefined;
  }
  commit(baselineId, bodies, selfBodyId) {
    if (selfBodyId !== undefined && !validId(selfBodyId)) bad('invalid self binding');
    if (selfBodyId !== undefined && this.expectedSelfBodyId !== undefined && selfBodyId !== this.expectedSelfBodyId) throw new DemoError('SELF_BODY_CHANGED', 'self binding changed across observation/recovery');
    if (bodies.size > 2) throw new DemoError('AMBIGUOUS_CAST', 'demo requires a fresh journal with exactly two aigent bodies');
    this.baselineId = baselineId;
    this.bodies = bodies;
    this.selfBodyId = selfBodyId;
    if (selfBodyId !== undefined) this.expectedSelfBodyId = selfBodyId;
  }
  applyFull(snapshot) {
    const body = decodeDemoBinary(WorldSnapshotBodyProtoSchema, snapshot.payload);
    if (!validId(snapshot.baselineId) || body.version !== 1 || body.generationDigest.length !== 32) bad('invalid full baseline/version/digest');
    if (this.baselineId !== undefined && snapshot.baselineId <= this.baselineId) bad('full baseline does not advance');
    if (body.bodies.length > 100) bad('snapshot exceeds AOI cap');
    body.bodies.forEach(validateRecord);
    unique(body.bodies.map(record => record.entityId));
    this.commit(snapshot.baselineId, new Map(body.bodies.map(record => [record.entityId, record])), body.selfBodyId);
  }
  applyDelta(snapshot) {
    if (this.baselineId === undefined || snapshot.baselineId !== this.baselineId) throw new DemoError('BASELINE_MISMATCH', 'delta requires the current baseline');
    const delta = decodeDemoBinary(WorldSnapshotDeltaProtoSchema, snapshot.payload);
    if (delta.version !== 1 || delta.generationDigest.length !== 32) bad('invalid delta version/digest');
    if (delta.entered.length + delta.modified.length + delta.leftIds.length > 200) bad('delta exceeds AOI cap');
    const records = [...delta.entered, ...delta.modified];
    records.forEach(validateRecord);
    unique([...records.map(record => record.entityId), ...delta.leftIds]);
    const next = new Map(this.bodies);
    for (const id of delta.leftIds) {
      if (!next.delete(id)) bad('delta leaves an unknown body');
    }
    for (const record of delta.entered) {
      if (next.has(record.entityId)) bad('delta enters an existing body');
      next.set(record.entityId, record);
    }
    for (const record of delta.modified) {
      const prior = next.get(record.entityId);
      if (!prior || record.revision < prior.revision) bad('delta modifies an unknown body or rolls back revision');
      if (record.revision === prior.revision && ['xMm', 'yMm', 'zMm'].some(axis => record.positionMm[axis] !== prior.positionMm[axis])) bad('position changed without revision');
      next.set(record.entityId, record);
    }
    this.commit(this.baselineId, next, delta.selfBodyId);
  }
}
