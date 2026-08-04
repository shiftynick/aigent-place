#!/usr/bin/env node
/**
 * Scripted aigent move-lease demo (task-035).
 *
 * Expects a listening world-server (`cargo run -p world-server -- --listen`).
 * Default URL: ws://127.0.0.1:7600/ws
 *
 * Usage:
 *   npm run aigent:scripted-move -w @aigent-place/aigent-sdk
 *   AIGENT_WS_URL=ws://127.0.0.1:7600/ws npm run aigent:scripted-move -w @aigent-place/aigent-sdk
 */

import { create, fromBinary, toBinary } from "@bufbuild/protobuf";
import {
  ClientHelloSchema,
  CommandKind,
  CommandSchema,
  ConnectionRole,
  EnvelopeSchema,
  HandshakeFrameSchema,
  ServerHelloSchema,
} from "@aigent-place/protocol";

const url = process.env.AIGENT_WS_URL ?? "ws://127.0.0.1:7600/ws";
const aigentId = new TextEncoder().encode(process.env.AIGENT_ID ?? "scripted-demo");

function encodeClientHello() {
  const hello = create(ClientHelloSchema, {
    role: ConnectionRole.AIGENT,
    offeredProtocolMajors: [1],
    offeredFeatures: [],
    aigentId,
  });
  return toBinary(
    HandshakeFrameSchema,
    create(HandshakeFrameSchema, { body: { case: "clientHello", value: hello } }),
  );
}

function encodeMove(connectionId, sessionEpoch, messageId, sequence, idempotencyKey) {
  const command = create(CommandSchema, {
    metadata: {
      sessionEpoch,
      sequence: BigInt(sequence),
      idempotencyKey: new TextEncoder().encode(idempotencyKey),
    },
    kind: CommandKind.MOVE,
    payload: new Uint8Array(),
  });
  return toBinary(
    EnvelopeSchema,
    create(EnvelopeSchema, {
      protocolMajor: 1,
      connectionId,
      messageId: BigInt(messageId),
      metadata: {},
      body: { case: "command", value: command },
    }),
  );
}

function decodeHandshake(bytes) {
  const frame = fromBinary(HandshakeFrameSchema, bytes);
  if (frame.body.case !== "serverHello") {
    throw new Error(`expected ServerHello, got ${frame.body.case}`);
  }
  return frame.body.value;
}

function decodeEnvelope(bytes) {
  return fromBinary(EnvelopeSchema, bytes);
}

function summarizeResult(envelope) {
  if (envelope.body.case === "protocolError") {
    const err = envelope.body.value;
    return `ProtocolError code=${err.code} message=${err.message ?? ""}`;
  }
  if (envelope.body.case !== "commandResult") {
    return `other:${envelope.body.case ?? "empty"}`;
  }
  const result = envelope.body.value;
  const outcome = result.outcome?.case ?? "none";
  if (outcome === "rejected") {
    const rejected = result.outcome.value;
    return `CommandResult seq=${result.sequence} outcome=rejected code=${rejected.code} message=${rejected.message ?? ""}`;
  }
  return `CommandResult seq=${result.sequence} outcome=${outcome} msg=${result.commandMessageId}`;
}

async function readBinary(ws, label) {
  return await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`timeout waiting for ${label}`)), 5000);
    ws.addEventListener(
      "message",
      (event) => {
        clearTimeout(timer);
        const data = event.data;
        if (data instanceof ArrayBuffer) {
          resolve(new Uint8Array(data));
          return;
        }
        if (ArrayBuffer.isView(data)) {
          resolve(new Uint8Array(data.buffer, data.byteOffset, data.byteLength));
          return;
        }
        reject(new Error(`expected binary frame for ${label}`));
      },
      { once: true },
    );
    ws.addEventListener("error", () => {
      clearTimeout(timer);
      reject(new Error(`websocket error while waiting for ${label}`));
    }, { once: true });
  });
}

async function awaitCommandOutcome(ws, label) {
  for (let i = 0; i < 32; i += 1) {
    const bytes = await readBinary(ws, label);
    const envelope = decodeEnvelope(bytes);
    if (
      envelope.body.case === "commandResult" ||
      envelope.body.case === "protocolError"
    ) {
      return envelope;
    }
  }
  throw new Error(`no CommandResult/ProtocolError for ${label}`);
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function main() {
  console.log(`scripted-aigent: connecting to ${url}`);
  const ws = new WebSocket(url);
  ws.binaryType = "arraybuffer";
  await new Promise((resolve, reject) => {
    ws.addEventListener("open", resolve, { once: true });
    ws.addEventListener("error", () => reject(new Error(`failed to open ${url}`)), {
      once: true,
    });
  });

  ws.send(encodeClientHello());
  const helloBytes = await readBinary(ws, "ServerHello");
  const hello = decodeHandshake(helloBytes);
  console.log(
    `scripted-aigent: hello connection=${Buffer.from(hello.connectionId).toString("utf8")} epoch=${Buffer.from(hello.sessionEpoch).toString("utf8")}`,
  );

  ws.send(encodeMove(hello.connectionId, hello.sessionEpoch, 1, 1, "demo-move-1"));
  const first = await awaitCommandOutcome(ws, "first move");
  console.log(`scripted-aigent: ${summarizeResult(first)}`);
  if (first.body.case !== "commandResult" || first.body.value.outcome?.case !== "accepted") {
    throw new Error("first MOVE was not accepted");
  }

  // Same sequence + idempotency key → authoritative replay.
  ws.send(encodeMove(hello.connectionId, hello.sessionEpoch, 2, 1, "demo-move-1"));
  const replay = await awaitCommandOutcome(ws, "idempotent replay");
  console.log(`scripted-aigent: replay ${summarizeResult(replay)}`);
  if (replay.body.case !== "commandResult" || replay.body.value.outcome?.case !== "accepted") {
    throw new Error("idempotent MOVE replay was not accepted");
  }

  // Let the 20 Hz loop apply the first lease, then renew across a later tick.
  await sleep(120);
  ws.send(encodeMove(hello.connectionId, hello.sessionEpoch, 3, 2, "demo-move-2"));
  const renew = await awaitCommandOutcome(ws, "renew move");
  console.log(`scripted-aigent: renew ${summarizeResult(renew)}`);
  if (renew.body.case !== "commandResult" || renew.body.value.outcome?.case !== "accepted") {
    throw new Error("renew MOVE was not accepted");
  }
  await sleep(120);

  ws.close();
  console.log(
    "scripted-aigent: ok (move lease accepted, idempotent replay, renewed after tick advance)",
  );
}

main().catch((error) => {
  console.error(`scripted-aigent: ${error.message}`);
  process.exitCode = 1;
});
