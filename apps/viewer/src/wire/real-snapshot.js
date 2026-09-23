// Real-body snapshot/delta decoder (task-054).
//
// The server emits `FullSnapshot.payload` and `SnapshotDelta.payload` as
// `WorldSnapshotBodyProto` / `WorldSnapshotDeltaProto` (defined in
// `protocol/v1/aigent.proto`, generated bindings in `@aigent-place/protocol`).
// This file is the hand-rolled decoder used by the viewer until the auto-
// generated bindings land in the viewer build.
//
// The wire format is `prost` (the Rust encoder), so we read the protobuf wire
// types directly: varints, length-delimited submessages, and zig-zag sint64.

const BODY_VERSION = 1;
const DELTA_VERSION = 1;

const WIRE_VARINT = 0;
const WIRE_FIXED64 = 1;
const WIRE_BYTES = 2;
const WIRE_FIXED32 = 5;

class Reader {
  constructor(bytes) {
    this.bytes = bytes;
    this.view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    this.cursor = 0;
  }
  remaining() {
    return this.bytes.length - this.cursor;
  }
  readVarint() {
    let result = 0n;
    let shift = 0n;
    while (this.cursor < this.bytes.length) {
      const b = this.bytes[this.cursor++];
      result |= BigInt(b & 0x7f) << shift;
      if ((b & 0x80) === 0) return result;
      shift += 7n;
      if (shift > 64n) throw new Error("varint overflow");
    }
    throw new Error("truncated varint");
  }
  readTag() {
    const v = this.readVarint();
    return { field: Number(v >> 3n), wire: Number(v & 7n) };
  }
  readFixed32() {
    const v = this.view.getUint32(this.cursor, true);
    this.cursor += 4;
    return v;
  }
  readFixed64() {
    const v = this.view.getBigUint64(this.cursor, true);
    this.cursor += 8;
    return v;
  }
  readSint64() {
    const v = this.readVarint();
    // zig-zag decode
    return (v >> 1n) ^ -(v & 1n);
  }
  readBytes() {
    const len = Number(this.readVarint());
    const start = this.cursor;
    this.cursor += len;
    return this.bytes.subarray(start, start + len);
  }
  skip(wire) {
    switch (wire) {
      case WIRE_VARINT:
        this.readVarint();
        return;
      case WIRE_FIXED64:
        this.cursor += 8;
        return;
      case WIRE_BYTES:
        this.readBytes();
        return;
      case WIRE_FIXED32:
        this.cursor += 4;
        return;
      default:
        throw new Error(`unknown wire type ${wire}`);
    }
  }
  // Read a single field value by wire type. The caller knows which it is.
  skipField(wire) {
    this.skip(wire);
  }
}

function readVector3Millimeters(reader) {
  // Vector3Millimeters { x_mm, y_mm, z_mm } — three sint64 fields, each
  // tagged. The encoder omits default values (proto3), so 0-valued axes
  // are not present on the wire and stay at 0 in the output.
  let x = 0n;
  let y = 0n;
  let z = 0n;
  while (reader.remaining() > 0) {
    const tag = reader.readTag();
    if (tag.wire !== WIRE_VARINT) {
      reader.skipField(tag.wire);
      continue;
    }
    const value = reader.readSint64();
    switch (tag.field) {
      case 1:
        x = value;
        break;
      case 2:
        y = value;
        break;
      case 3:
        z = value;
        break;
      default:
        break;
    }
  }
  return { x, y, z };
}

function readShapeTree(reader) {
  // ShapeTree { nodes: [ShapeNode] } — only the entity_id and presence of
  // a primitive matter for the viewer smoke; a full decoder is task-055.
  const nodes = [];
  while (reader.remaining() > 0) {
    const tag = reader.readTag();
    if (tag.wire !== WIRE_BYTES || tag.field !== 1) {
      reader.skipField(tag.wire);
      continue;
    }
    const nodeBytes = reader.readBytes();
    const nodeReader = new Reader(nodeBytes);
    let nodeId = 0n;
    let hasPrimitive = false;
    while (nodeReader.remaining() > 0) {
      const t = nodeReader.readTag();
      switch (t.field) {
        case 1:
          nodeId = t.wire === WIRE_VARINT ? nodeReader.readVarint() : 0n;
          break;
        case 3:
          // LocalTransform — read past it, no value needed.
          nodeReader.readBytes();
          break;
        case 4:
          // joint_name.
          nodeReader.readBytes();
          break;
        case 5:
          // color.
          nodeReader.readBytes();
          break;
        case 6:
          // material_tags (repeated string).
          nodeReader.readBytes();
          break;
        case 10:
        case 11:
        case 12:
        case 13:
        case 14:
        case 15:
          // primitive (oneof): Box, Sphere, Capsule, Cylinder, Cone, Panel.
          nodeReader.readBytes();
          hasPrimitive = true;
          break;
        default:
          nodeReader.skipField(t.wire);
          break;
      }
    }
    nodes.push({ nodeId, hasPrimitive });
  }
  return { nodes };
}

function readRealEntityRecord(reader) {
  let entityId = 0n;
  let revision = 0n;
  let positionMm = { x: 0n, y: 0n, z: 0n };
  let shape = null;
  while (reader.remaining() > 0) {
    const tag = reader.readTag();
    switch (tag.field) {
      case 1:
        entityId = tag.wire === WIRE_VARINT ? reader.readVarint() : 0n;
        break;
      case 2:
        revision = tag.wire === WIRE_VARINT ? reader.readVarint() : 0n;
        break;
      case 3:
        positionMm = readVector3Millimeters(new Reader(reader.readBytes()));
        break;
      case 4:
        shape = readShapeTree(new Reader(reader.readBytes()));
        break;
      default:
        reader.skipField(tag.wire);
        break;
    }
  }
  return { entityId, revision, positionMm, shape };
}

/**
 * @param {Uint8Array} bytes the FullSnapshot.payload bytes
 * @returns {{
 *   version: number,
 *   tick: bigint,
 *   generationDigest: Uint8Array,
 *   bodies: Array<{
 *     entityId: bigint,
 *     revision: bigint,
 *     positionMm: { x: bigint, y: bigint, z: bigint },
 *     shape: { nodes: Array<{ nodeId: bigint, hasPrimitive: boolean }> } | null,
 *   }>,
 * } | null}
 */
export function decodeWorldSnapshotBody(bytes) {
  const reader = new Reader(bytes);
  let version = 0;
  let tick = 0n;
  let generationDigest = new Uint8Array(0);
  const bodies = [];
  while (reader.remaining() > 0) {
    const tag = reader.readTag();
    switch (tag.field) {
      case 1:
        version = tag.wire === WIRE_VARINT ? Number(reader.readVarint()) : 0;
        break;
      case 2:
        tick = tag.wire === WIRE_VARINT ? reader.readVarint() : 0n;
        break;
      case 3:
        generationDigest = reader.readBytes();
        break;
      case 4:
        bodies.push(readRealEntityRecord(new Reader(reader.readBytes())));
        break;
      default:
        reader.skipField(tag.wire);
        break;
    }
  }
  if (version !== BODY_VERSION) return null;
  return { version, tick, generationDigest, bodies };
}

/**
 * @param {Uint8Array} bytes the SnapshotDelta.payload bytes
 * @returns {{
 *   version: number,
 *   generationDigest: Uint8Array,
 *   entered: Array<...>,
 *   modified: Array<...>,
 *   leftIds: bigint[],
 * } | null}
 */
export function decodeWorldSnapshotDelta(bytes) {
  const reader = new Reader(bytes);
  let version = 0;
  let generationDigest = new Uint8Array(0);
  const entered = [];
  const modified = [];
  const leftIds = [];
  while (reader.remaining() > 0) {
    const tag = reader.readTag();
    switch (tag.field) {
      case 1:
        version = tag.wire === WIRE_VARINT ? Number(reader.readVarint()) : 0;
        break;
      case 2:
        generationDigest = reader.readBytes();
        break;
      case 3:
        entered.push(readRealEntityRecord(new Reader(reader.readBytes())));
        break;
      case 4:
        modified.push(readRealEntityRecord(new Reader(reader.readBytes())));
        break;
      case 5:
        // Proto3 packs `repeated uint64` into one length-delimited field
        // whose body is a sequence of varints. The decoder accepts both
        // the packed form and a series of single varints.
        if (tag.wire === WIRE_BYTES) {
          const packed = new Reader(reader.readBytes());
          while (packed.remaining() > 0) {
            leftIds.push(packed.readVarint());
          }
        } else if (tag.wire === WIRE_VARINT) {
          leftIds.push(reader.readVarint());
        } else {
          reader.skipField(tag.wire);
        }
        break;
      default:
        reader.skipField(tag.wire);
        break;
    }
  }
  if (version !== DELTA_VERSION) return null;
  return { version, generationDigest, entered, modified, leftIds };
}
