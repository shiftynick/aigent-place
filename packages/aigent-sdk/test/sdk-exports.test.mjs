import assert from "node:assert/strict";
import test from "node:test";
import { create, fromBinary, toBinary } from "@bufbuild/protobuf";
import { EnvelopeSchema } from "@aigent-place/aigent-sdk";

test("SDK re-exports EnvelopeSchema usable for encode/decode", () => {
  assert.equal(EnvelopeSchema.typeName, "aigent.protocol.v1.Envelope");
  const message = create(EnvelopeSchema, {
    protocolMajor: 1,
    connectionId: new Uint8Array([1, 2, 3]),
    messageId: 9n,
  });
  const bytes = toBinary(EnvelopeSchema, message);
  const decoded = fromBinary(EnvelopeSchema, bytes);
  assert.equal(decoded.protocolMajor, 1);
  assert.equal(decoded.messageId, 9n);
});
