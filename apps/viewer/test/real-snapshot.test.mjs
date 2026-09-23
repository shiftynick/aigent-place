// Real-body snapshot/delta decoder tests (task-054).
//
// These are the shared Rust+TypeScript conformance checks. The Rust side
// (in `crates/world-server/src/wire/snapshot.rs::tests`) produces a
// `WorldSnapshotBody` with two entities, encodes it, and the bytes are
// recorded as a hex fixture in `protocol/v1/conformance/binary/`.
// The TypeScript side reads the same bytes and asserts the decoded
// records match the Rust expectations.

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import {
  decodeWorldSnapshotBody,
  decodeWorldSnapshotDelta,
} from "../src/wire/real-snapshot.js";

const root = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../..",
);

function fixtureBytes(name) {
  const text = fs.readFileSync(
    path.join(root, "protocol/v1/conformance/binary", name),
    "utf8",
  );
  const hex = text.replace(/\s+/g, "");
  return new Uint8Array(Buffer.from(hex, "hex"));
}

test("real-body snapshot fixture decodes into two entity records with shape", () => {
  const bytes = fixtureBytes("world-snapshot-body.hex");
  const decoded = decodeWorldSnapshotBody(bytes);
  assert.ok(decoded, "decoder accepted the fixture");
  assert.equal(decoded.version, 1);
  assert.equal(decoded.tick, 42n);
  assert.equal(decoded.generationDigest.length, 32);
  // The fixture is a generation_digest of [0xAB; 32].
  for (const b of decoded.generationDigest) assert.equal(b, 0xab);
  assert.equal(decoded.bodies.length, 2);
  // Bodies are emitted in AOI rank order. With both fixture entities at
  // the same placeholder position, ties are broken by ascending entity_id,
  // so body 1 appears first.
  assert.equal(decoded.bodies[0].entityId, 1n);
  assert.equal(decoded.bodies[1].entityId, 2n);
  // Both fixture entities are at the same placeholder pose (1.5, 0, -2.25)
  // metres, which projects to (1500, 0, -2250) millimetres. The y axis is
  // omitted on the wire (proto3 default-value elision) and the decoder
  // restores it as 0.
  for (const body of decoded.bodies) {
    assert.deepEqual(body.positionMm, { x: 1500n, y: 0n, z: -2250n });
  }
  // Both entities carry the same one-node box shape; the decoder reads
  // the primitive presence flag for the smoke render.
  for (const body of decoded.bodies) {
    assert.ok(body.shape);
    assert.equal(body.shape.nodes.length, 1);
    assert.equal(body.shape.nodes[0].hasPrimitive, true);
    assert.equal(body.shape.nodes[0].nodeId, 1n);
  }
});

test("real-body delta fixture decodes into one entered and one left id", () => {
  const bytes = fixtureBytes("world-snapshot-delta.hex");
  const decoded = decodeWorldSnapshotDelta(bytes);
  assert.ok(decoded, "decoder accepted the fixture");
  assert.equal(decoded.version, 1);
  assert.equal(decoded.entered.length, 1);
  assert.equal(decoded.modified.length, 0);
  assert.deepEqual(decoded.leftIds, [13n]);
  assert.equal(decoded.entered[0].entityId, 10n);
  assert.equal(decoded.entered[0].revision, 1n);
});

test("unknown version is rejected", () => {
  // The version field is the first varint in either wire form; the decoder
  // should refuse to interpret a payload with a version it does not know.
  const bytes = new Uint8Array([0x7f]); // field 15, wire 7 — invalid wire type
  assert.throws(() => decodeWorldSnapshotBody(bytes));
});

test("version 2 is rejected as unknown", () => {
  // Hand-craft a minimal body with version = 2. The decoder must
  // observe the version mismatch and return null, not a structurally
  // valid object whose fields all default.
  const body = new Uint8Array([0x08, 0x02]); // field 1, varint, value 2
  assert.equal(decodeWorldSnapshotBody(body), null);
});

test("version 2 delta is rejected as unknown", () => {
  const delta = new Uint8Array([0x08, 0x02]); // field 1, varint, value 2
  assert.equal(decodeWorldSnapshotDelta(delta), null);
});

test("body with only version is accepted as empty state", () => {
  // A version-1 body containing only the version field is a real
  // (empty) snapshot: zero entities in the interest set. The viewer
  // must not interpret this as a failure.
  const body = new Uint8Array([0x08, 0x01]); // field 1, varint, value 1
  const decoded = decodeWorldSnapshotBody(body);
  assert.ok(decoded, "a body with only version is not a failure");
  assert.equal(decoded.version, 1);
  assert.equal(decoded.bodies.length, 0);
  assert.equal(decoded.tick, 0n);
  assert.equal(decoded.generationDigest.length, 0);
});

test("delta with only version is accepted as empty transition", () => {
  const delta = new Uint8Array([0x08, 0x01]);
  const decoded = decodeWorldSnapshotDelta(delta);
  assert.ok(decoded);
  assert.equal(decoded.entered.length, 0);
  assert.equal(decoded.modified.length, 0);
  assert.equal(decoded.leftIds.length, 0);
});


