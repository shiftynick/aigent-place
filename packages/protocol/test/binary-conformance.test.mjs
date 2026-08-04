import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { create, fromBinary, toBinary } from "@bufbuild/protobuf";
import {
  CommandOutcomeSchema,
  ConnectionMode,
  EnvelopeSchema,
  HandshakeFrameSchema,
  ProtocolErrorCode,
  Vector3MillimetersSchema,
} from "@aigent-place/protocol";

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
  return Buffer.from(hex, "hex");
}

test("envelope fixture round-trips with bigint message ids", () => {
  const bytes = fixtureBytes("envelope-protocol-error.hex");
  const decoded = fromBinary(EnvelopeSchema, bytes);
  assert.equal(decoded.protocolMajor, 1);
  assert.equal(decoded.messageId, 42n);
  assert.equal(
    decoded.body.case,
    "protocolError",
  );
  assert.equal(
    decoded.body.value.code,
    ProtocolErrorCode.UNSUPPORTED_PROTOCOL,
  );
  assert.deepEqual(Buffer.from(toBinary(EnvelopeSchema, decoded)), bytes);
});

test("handshake reject fixture round-trips", () => {
  const bytes = fixtureBytes("handshake-reject.hex");
  const decoded = fromBinary(HandshakeFrameSchema, bytes);
  assert.equal(decoded.body.case, "handshakeReject");
  assert.equal(
    decoded.body.value.code,
    ProtocolErrorCode.UNSUPPORTED_PROTOCOL,
  );
  assert.equal(
    decoded.body.value.compatibility[0].currentMode,
    ConnectionMode.SPECTATE_ONLY,
  );
  assert.deepEqual(Buffer.from(toBinary(HandshakeFrameSchema, decoded)), bytes);
});

test("command outcome fixture round-trips uint64 fields as bigint", () => {
  const bytes = fixtureBytes("command-outcome.hex");
  const decoded = fromBinary(CommandOutcomeSchema, bytes);
  assert.equal(decoded.buildId, "build-a");
  assert.equal(decoded.command.sequence, 1n);
  assert.equal(decoded.generationRecordCount, 1);
  assert.equal(
    decoded.result.outcome.value.affectedWorldEntities[0].entityId,
    9n,
  );
  assert.deepEqual(Buffer.from(toBinary(CommandOutcomeSchema, decoded)), bytes);
});

test("malformed envelope bytes fail deterministically", () => {
  assert.throws(
    () => fromBinary(EnvelopeSchema, Uint8Array.from([0x00, 0xff])),
    (error) => error instanceof Error && error.message.length > 0,
  );
});

test("unknown envelope fields are ignored", () => {
  const bytes = Buffer.concat([
    fixtureBytes("envelope-protocol-error.hex"),
    Buffer.from([0x9a, 0x06, 0x01, 0x78]),
  ]);
  const decoded = fromBinary(EnvelopeSchema, bytes);
  assert.equal(decoded.protocolMajor, 1);
  assert.equal(decoded.body.case, "protocolError");
});

test("sint64 coordinates preserve values outside number range via bigint", () => {
  const vector = create(Vector3MillimetersSchema, {
    xMm: -4_000_000_000_000_000_000n,
    yMm: 0n,
    zMm: 4_000_000_000_000_000_000n,
  });
  const roundTrip = fromBinary(
    Vector3MillimetersSchema,
    toBinary(Vector3MillimetersSchema, vector),
  );
  assert.equal(roundTrip.xMm, vector.xMm);
  assert.equal(roundTrip.zMm, vector.zMm);
});

test("owner SDK re-exports generated Envelope schema", async () => {
  const sdk = await import("@aigent-place/aigent-sdk");
  assert.equal(typeof sdk.EnvelopeSchema, "object");
  assert.equal(sdk.EnvelopeSchema.typeName, "aigent.protocol.v1.Envelope");
});
