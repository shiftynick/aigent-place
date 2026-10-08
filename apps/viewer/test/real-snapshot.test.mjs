import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import { create, toBinary } from "@bufbuild/protobuf";
import {
  RealEntityRecordSchema,
  WorldSnapshotBodyProtoSchema,
  WorldSnapshotDeltaProtoSchema,
} from "@aigent-place/protocol";
import {
  decodeWorldSnapshotBody,
  decodeWorldSnapshotDelta,
} from "../src/wire/real-snapshot.js";
import { entity, shape } from "./snapshot-fixtures.mjs";

const digest = new Uint8Array(32).fill(0xab);
const bodyBytes = (overrides = {}) => toBinary(WorldSnapshotBodyProtoSchema,
  create(WorldSnapshotBodyProtoSchema, { version: 1, tick: 42n, generationDigest: digest, bodies: [], ...overrides }));
const deltaBytes = (overrides = {}) => toBinary(WorldSnapshotDeltaProtoSchema,
  create(WorldSnapshotDeltaProtoSchema, { version: 1, generationDigest: digest, ...overrides }));

function fixtureBytes(name) {
  const hex = fs.readFileSync(new URL(`../../../protocol/v1/conformance/binary/${name}`, import.meta.url), "utf8");
  return new Uint8Array(Buffer.from(hex.replace(/\s+/g, ""), "hex"));
}

test("Rust full fixture preserves bigint IDs, revisions, positions and complete generated shape", () => {
  const decoded = decodeWorldSnapshotBody(fixtureBytes("world-snapshot-body.hex"));
  assert.ok(decoded);
  assert.equal(decoded.tick, 42n);
  assert.deepEqual(decoded.generationDigest, digest);
  assert.deepEqual(decoded.bodies.map(record => record.entityId), [1n, 2n]);
  for (const record of decoded.bodies) {
    assert.equal(record.revision, 1n);
    assert.equal(record.positionMm.xMm, 1500n);
    assert.equal(record.positionMm.yMm, 0n);
    assert.equal(record.positionMm.zMm, -2250n);
    assert.equal(record.shape.nodes[0].nodeId, 1);
    assert.equal(record.shape.nodes[0].primitive.case, "box");
    assert.equal(record.shape.nodes[0].primitive.value.sizeXMm, 1000n);
  }
});

test("Rust delta fixture preserves explicit enter and leave records", () => {
  const decoded = decodeWorldSnapshotDelta(fixtureBytes("world-snapshot-delta.hex"));
  assert.ok(decoded);
  assert.deepEqual(decoded.generationDigest, new Uint8Array(32).fill(0xcd));
  assert.equal(decoded.entered[0].entityId, 10n);
  assert.equal(decoded.entered[0].revision, 1n);
  assert.deepEqual(decoded.modified, []);
  assert.deepEqual(decoded.leftIds, [13n]);
});

test("full and delta retain every entity field and every ShapeTree primitive", () => {
  const source = entity(9007199254740993n, { revision: 9007199254740995n, shape: shape() });
  const expected = create(RealEntityRecordSchema, source);
  assert.deepEqual(decodeWorldSnapshotBody(bodyBytes({ bodies: [source] })).bodies[0], expected);
  const delta = decodeWorldSnapshotDelta(deltaBytes({ entered: [source], modified: [entity(2n)] }));
  assert.deepEqual(delta.entered[0], expected);
  assert.deepEqual(delta.modified[0], create(RealEntityRecordSchema, entity(2n)));
});

test("unknown and omitted body/delta versions are rejected", () => {
  for (const version of [0, 2]) {
    assert.equal(decodeWorldSnapshotBody(bodyBytes({ version })), null);
    assert.equal(decodeWorldSnapshotDelta(deltaBytes({ version })), null);
  }
});

test("full and delta require an exact 32-byte generation digest", () => {
  for (const length of [0, 31, 33]) {
    const generationDigest = new Uint8Array(length);
    assert.equal(decodeWorldSnapshotBody(bodyBytes({ generationDigest })), null);
    assert.equal(decodeWorldSnapshotDelta(deltaBytes({ generationDigest })), null);
  }
});

test("valid empty full and delta remain accepted", () => {
  assert.deepEqual(decodeWorldSnapshotBody(bodyBytes()).bodies, []);
  const delta = decodeWorldSnapshotDelta(deltaBytes());
  assert.deepEqual([delta.entered, delta.modified, delta.leftIds], [[], [], []]);
});

test("entity ID, revision and position are required in full, entered and modified", () => {
  for (const invalid of [entity(0n), entity(1n, { revision: 0n }), entity(1n, { positionMm: undefined })]) {
    assert.equal(decodeWorldSnapshotBody(bodyBytes({ bodies: [invalid] })), null);
    assert.equal(decodeWorldSnapshotDelta(deltaBytes({ entered: [invalid] })), null);
    assert.equal(decodeWorldSnapshotDelta(deltaBytes({ modified: [invalid] })), null);
  }
  assert.equal(decodeWorldSnapshotDelta(deltaBytes({ leftIds: [0n] })), null);
});

test("all position axes enforce the inclusive 100 km world bound", () => {
  for (const axis of ["xMm", "yMm", "zMm"]) {
    for (const value of [-100000001n, 100000001n]) {
      const record = entity(1n, { positionMm: { [axis]: value } });
      assert.equal(decodeWorldSnapshotBody(bodyBytes({ bodies: [record] })), null);
      assert.equal(decodeWorldSnapshotDelta(deltaBytes({ modified: [record] })), null);
    }
    for (const value of [-100000000n, 100000000n]) {
      assert.ok(decodeWorldSnapshotBody(bodyBytes({ bodies: [entity(1n, { positionMm: { [axis]: value } })] })));
    }
  }
});

test("a missing optional shape remains a renderable generic body", () => {
  const record = entity(1n, { shape: undefined });
  assert.equal(decodeWorldSnapshotBody(bodyBytes({ bodies: [record] })).bodies[0].shape, undefined);
});

test("full IDs and the delta enter/modify/leave sets are unique and disjoint", () => {
  assert.equal(decodeWorldSnapshotBody(bodyBytes({ bodies: [entity(1n), entity(1n)] })), null);
  for (const overrides of [
    { entered: [entity(1n), entity(1n)] },
    { modified: [entity(1n), entity(1n)] },
    { leftIds: [1n, 1n] },
    { entered: [entity(1n)], modified: [entity(1n)] },
    { entered: [entity(1n)], leftIds: [1n] },
    { modified: [entity(1n)], leftIds: [1n] },
  ]) assert.equal(decodeWorldSnapshotDelta(deltaBytes(overrides)), null);
});

test("malformed tags, lengths, wire types and varints are rejected", () => {
  const malformed = [
    Uint8Array.of(0),
    Uint8Array.of(0x7f),
    Uint8Array.of(8, 0x80),
    Uint8Array.of(8, 1, 26, 32, 0xab),
    Uint8Array.of(13, 1, 26, 32, ...digest),
    Uint8Array.of(...bodyBytes(), 34, 1, 8, 1),
    Uint8Array.of(...bodyBytes(), 0xa1, 6, 1),
    Uint8Array.of(8, 1, 26, 0xa0, 0x80, 0x80, 0x80, 0x10, ...digest),
    Uint8Array.of(8, 0x81, 0x80, 0x80, 0x80, 0x10, 26, 32, ...digest),
    Uint8Array.of(...bodyBytes(), 0xa0, 6, ...new Array(9).fill(0x80), 2),
  ];
  for (const bytes of malformed) assert.throws(() => decodeWorldSnapshotBody(bytes), `body: ${Buffer.from(bytes).toString("hex")}`);
  assert.throws(() => decodeWorldSnapshotDelta(Uint8Array.of(...deltaBytes(), 42, 1, 0x80, 1)));
});

test("unknown protobuf fields remain compatible", () => {
  const decoded = decodeWorldSnapshotBody(Uint8Array.of(...bodyBytes(), 0xa0, 6, 7));
  assert.ok(decoded);
  assert.deepEqual(decoded.bodies, []);
});

test("legal unknown protobuf groups and nested groups remain preserved", () => {
  const bytes = Uint8Array.of(...bodyBytes(), 0xa3, 6, 8, 7, 0x13, 0x18, 1, 0x14, 0xa4, 6);
  const decoded = decodeWorldSnapshotBody(bytes);
  assert.ok(decoded);
  assert.deepEqual(toBinary(WorldSnapshotBodyProtoSchema, decoded), bytes);
});

test("malformed unknown groups reject oversized varints and invalid boundaries", () => {
  const malformed = [
    [0xa3, 6, 8, ...new Array(10).fill(0x80), 0, 0xa4, 6],
    [0xa3, 6, 8, ...new Array(9).fill(0x80), 2, 0xa4, 6],
    [0xa3, 6, 26, 0x81, 0x80, 0x80, 0x80, 0x10, 0, 0xa4, 6],
    [0xa3, 6, 8, 1, 0xac, 6],
    [0xa3, 6, 8, 1],
    [0xa4, 6],
  ];
  for (const suffix of malformed) {
    assert.throws(() => decodeWorldSnapshotBody(Uint8Array.of(...bodyBytes(), ...suffix)), Buffer.from(suffix).toString("hex"));
    assert.throws(() => decodeWorldSnapshotDelta(Uint8Array.of(...deltaBytes(), ...suffix)), Buffer.from(suffix).toString("hex"));
  }
});

test("unknown protobuf groups retain a bounded nesting depth", () => {
  const groups = [...new Array(101).fill([0xa3, 6]).flat(), ...new Array(101).fill([0xa4, 6]).flat()];
  assert.throws(() => decodeWorldSnapshotBody(Uint8Array.of(...bodyBytes(), ...groups)), /nesting|recursion/);
});
