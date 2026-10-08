import { fromBinary, ScalarType } from "@bufbuild/protobuf";
import { BinaryReader, WireType } from "@bufbuild/protobuf/wire";
import {
  WorldSnapshotBodyProtoSchema,
  WorldSnapshotDeltaProtoSchema,
} from "@aigent-place/protocol";

const WORLD_BOUND_MM = 100_000_000n;

function scalarWireType(scalar) {
  switch (scalar) {
    case ScalarType.DOUBLE:
    case ScalarType.FIXED64:
    case ScalarType.SFIXED64:
      return WireType.Bit64;
    case ScalarType.FLOAT:
    case ScalarType.FIXED32:
    case ScalarType.SFIXED32:
      return WireType.Bit32;
    case ScalarType.STRING:
    case ScalarType.BYTES:
      return WireType.LengthDelimited;
    default:
      return WireType.Varint;
  }
}

function readScalarFraming(reader, wireType, scalar) {
  if (wireType === WireType.Varint) {
    const start = reader.pos;
    const value = reader.uint64();
    if (reader.pos - start === 10 && reader.buf[reader.pos - 1] > 1) {
      throw new Error("protobuf varint exceeds uint64");
    }
    if (scalar === ScalarType.UINT32 && value > 0xffffffffn) {
      throw new Error("protobuf varint exceeds uint32");
    }
  } else if (wireType === WireType.LengthDelimited) {
    readDelimited(reader);
  } else {
    reader.skip(wireType);
  }
}

function readDelimited(reader) {
  const start = reader.pos;
  const bytes = reader.bytes();
  const prefixLength = reader.pos - start - bytes.length;
  if (prefixLength > 5 || (prefixLength === 5 && reader.buf[start + 4] > 15)) {
    throw new Error("protobuf length exceeds uint32");
  }
  return bytes;
}

function skipUnknownFraming(reader, fieldNumber, wireType, depth) {
  if (wireType === WireType.EndGroup) throw new Error("unexpected protobuf end group");
  if (wireType !== WireType.StartGroup) {
    readScalarFraming(reader, wireType);
    return;
  }
  if (depth >= 100) throw new Error("protobuf nesting limit exceeded");
  while (reader.pos < reader.len) {
    const [nestedNumber, nestedWireType] = reader.tag();
    if (nestedWireType === WireType.EndGroup) {
      if (nestedNumber !== fieldNumber) throw new Error("mismatched protobuf end group");
      return;
    }
    skipUnknownFraming(reader, nestedNumber, nestedWireType, depth + 1);
  }
  throw new Error("unterminated protobuf group");
}

// The pinned protobuf runtime does not check known-field wire types or exact
// nested/packed message boundaries. Validate those boundaries from generated
// descriptors, then let fromBinary own all message values and unknown fields.
function validateFraming(schema, bytes, depth = 0) {
  if (depth > 100) throw new Error("protobuf nesting limit exceeded");
  const reader = new BinaryReader(bytes);
  while (reader.pos < reader.len) {
    const [fieldNumber, wireType] = reader.tag();
    const field = schema.fields.find(candidate => candidate.number === fieldNumber);
    if (!field) {
      skipUnknownFraming(reader, fieldNumber, wireType, depth);
      continue;
    }
    if (field.fieldKind === "message" || field.listKind === "message") {
      if (wireType !== WireType.LengthDelimited) throw new Error("invalid protobuf message wire type");
      validateFraming(field.message, readDelimited(reader), depth + 1);
      continue;
    }
    const expected = scalarWireType(field.scalar);
    if (field.fieldKind === "list" && expected !== WireType.LengthDelimited && wireType === WireType.LengthDelimited) {
      const packed = new BinaryReader(readDelimited(reader));
      while (packed.pos < packed.len) readScalarFraming(packed, expected, field.scalar);
      continue;
    }
    if (wireType !== expected) throw new Error("invalid protobuf scalar wire type");
    readScalarFraming(reader, wireType, field.scalar);
  }
}

// Shared incoming boundary for the viewer's handshake, envelope, and payloads.
export function decodeSnapshotBinary(schema, bytes) {
  validateFraming(schema, bytes);
  return fromBinary(schema, bytes);
}

function validEntity(record) {
  const position = record.positionMm;
  return record.entityId !== 0n && record.revision !== 0n && position !== undefined &&
    [position.xMm, position.yMm, position.zMm].every(validCoordinate) && validAim(record.aim);
}

function validCoordinate(value) {
  return typeof value === "bigint" && value >= -WORLD_BOUND_MM && value <= WORLD_BOUND_MM;
}

function validAim(aim) {
  return aim === undefined || (validCoordinate(aim.targetXMm) && validCoordinate(aim.targetZMm) &&
    Number.isInteger(aim.speedMmPerS) && aim.speedMmPerS > 0 && aim.speedMmPerS <= 0xffffffff);
}

function uniqueIds(ids) {
  return ids.every(id => id !== 0n) && new Set(ids).size === ids.length;
}

/**
 * Decode a generated WorldSnapshotBodyProto without projecting away fields.
 * Unknown versions or invalid required data return null; malformed bytes throw.
 * ShapeTree validation belongs to the server; shapeless entities are valid.
 * @param {Uint8Array} bytes
 * @returns {import("@aigent-place/protocol").WorldSnapshotBodyProto | null}
 */
export function decodeWorldSnapshotBody(bytes) {
  const body = decodeSnapshotBinary(WorldSnapshotBodyProtoSchema, bytes);
  if (body.version !== 1 || body.generationDigest.length !== 32 || body.selfBodyId === 0n ||
      body.bodies.length > 100 || !body.bodies.every(validEntity) || !uniqueIds(body.bodies.map(record => record.entityId))) return null;
  return body;
}

/**
 * @param {Uint8Array} bytes
 * @returns {import("@aigent-place/protocol").WorldSnapshotDeltaProto | null}
 */
export function decodeWorldSnapshotDelta(bytes) {
  const delta = decodeSnapshotBinary(WorldSnapshotDeltaProtoSchema, bytes);
  const records = [...delta.entered, ...delta.modified];
  if (delta.version !== 1 || delta.generationDigest.length !== 32 || delta.selfBodyId === 0n ||
      records.length > 100 || delta.leftIds.length > 100 ||
      !records.every(validEntity) || !uniqueIds([...records.map(record => record.entityId), ...delta.leftIds])) return null;
  return delta;
}
