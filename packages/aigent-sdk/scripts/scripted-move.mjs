#!/usr/bin/env node
/**
 * Bounded local tracer for a fresh world with only one aigent (task-064).
 * Run with Node from .nvmrc against world-server --listen and a fresh journal.
 * AIGENT_WS_URL overrides ws://127.0.0.1:7600/ws; AIGENT_ID overrides scripted-demo.
 * The sole observed body is a demo precondition, not a protocol identity binding.
 */
import { create, fromBinary, toBinary } from "@bufbuild/protobuf";
import {
  ClientHelloSchema,
  CommandKind,
  CommandSchema,
  ConnectionRole,
  EnvelopeSchema,
  HandshakeFrameSchema,
  MovePayloadSchema,
  WorldSnapshotBodyProtoSchema,
  WorldSnapshotDeltaProtoSchema,
} from "@aigent-place/protocol";

const url = process.env.AIGENT_WS_URL ?? "ws://127.0.0.1:7600/ws";
const text = new TextEncoder();
const DEADLINE_MS = 8_000;
const MIN_DISPLACEMENT_MM = 1_000;
const MIN_MOVEMENT_MS = 2_000;

function encodeClientHello() {
  const hello = create(ClientHelloSchema, {
    role: ConnectionRole.AIGENT,
    offeredProtocolMajors: [1],
    aigentId: text.encode(process.env.AIGENT_ID ?? "scripted-demo"),
  });
  return toBinary(
    HandshakeFrameSchema,
    create(HandshakeFrameSchema, { body: { case: "clientHello", value: hello } }),
  );
}

function encodeMove(hello, messageId, sequence, idempotencyKey) {
  // Measured short route for the default-terrain first spawn in a fresh demo.
  const payload = toBinary(MovePayloadSchema, create(MovePayloadSchema, {
    targetXMm: 1_500n,
    targetZMm: 0n,
    speedMmPerS: 500,
  }));
  const command = create(CommandSchema, {
    metadata: {
      sessionEpoch: hello.sessionEpoch,
      sequence,
      idempotencyKey: text.encode(idempotencyKey),
    },
    kind: CommandKind.MOVE,
    payload,
  });
  return toBinary(EnvelopeSchema, create(EnvelopeSchema, {
    protocolMajor: 1,
    connectionId: hello.connectionId,
    messageId,
    metadata: {},
    body: { case: "command", value: command },
  }));
}

async function closeSocket(ws) {
  if (ws.readyState === WebSocket.CLOSED) return;
  await new Promise((resolve) => {
    const finish = () => {
      clearTimeout(timer);
      ws.removeEventListener("close", finish);
      resolve();
    };
    // Native WebSocket has no terminate(). The entry point exits after this
    // grace period so a peer that ignores CLOSE cannot extend the CLI deadline.
    const timer = setTimeout(finish, 250);
    ws.addEventListener("close", finish, { once: true });
    ws.close(1000, "demo complete");
  });
}

async function main() {
  console.log(`scripted-aigent: connecting to ${url} (fresh single-aigent demo)`);
  const ws = new WebSocket(url);
  ws.binaryType = "arraybuffer";
  const listeners = new AbortController();
  let deadline;
  let renewal;
  try {
    await new Promise((resolve, reject) => {
      let hello;
      let pending;
      let resultsComplete = false;
      let baselineId;
      const bodies = new Map();
      let trackedId;
      let origin;
      let previous;
      let firstMovementAt;
      let movementMs = 0;
      let displacementMm = 0;
      let lastPrintedAt = 0;

      const completeIfObserved = () => {
        if (
          resultsComplete &&
          displacementMm >= MIN_DISPLACEMENT_MM &&
          movementMs >= MIN_MOVEMENT_MS
        ) {
          console.log(`scripted-aigent: SUCCESS body=${trackedId} observed displacement=${(displacementMm / 1000).toFixed(3)}m movement=${(movementMs / 1000).toFixed(3)}s (accepted, idempotent replay, renewed)`);
          resolve();
        }
      };
      const send = (bytes) => {
        try {
          ws.send(bytes);
        } catch (error) {
          reject(error);
        }
      };
      const sendMove = (messageId, sequence, idempotencyKey, label) => {
        pending = { messageId, sequence, idempotencyKey, label };
        send(encodeMove(hello, messageId, sequence, idempotencyKey));
      };
      const observeBodies = (records, full, leftIds = []) => {
        if (full) bodies.clear();
        for (const id of leftIds) bodies.delete(id);
        for (const body of records) bodies.set(body.entityId, body);
        if (bodies.size > 1) throw new Error("demo requires a fresh world with only one aigent body");
        if (bodies.size === 0) {
          if (trackedId !== undefined) throw new Error("observed demo body left the snapshot");
          return;
        }
        const body = bodies.values().next().value;
        if (!body.positionMm) throw new Error("observed body has no authoritative position");
        if (trackedId !== undefined && trackedId !== body.entityId) throw new Error("observed demo body changed identity");
        trackedId = body.entityId;
        const position = [Number(body.positionMm.xMm), Number(body.positionMm.zMm)];
        origin ??= position;
        const now = performance.now();
        displacementMm = Math.hypot(position[0] - origin[0], position[1] - origin[1]);
        if (previous && (position[0] !== previous[0] || position[1] !== previous[1])) {
          firstMovementAt ??= now;
          movementMs = now - firstMovementAt;
          if (now - lastPrintedAt >= 250) {
            console.log(`scripted-aigent: observe body=${trackedId} x=${body.positionMm.xMm}mm y=${body.positionMm.yMm}mm z=${body.positionMm.zMm}mm displacement=${(displacementMm / 1000).toFixed(3)}m movement=${(movementMs / 1000).toFixed(3)}s`);
            lastPrintedAt = now;
          }
        }
        previous = position;
        completeIfObserved();
      };
      deadline = setTimeout(() => reject(new Error("timeout: no complete accepted/replayed/renewed MOVE and >=1m observed movement over >=2s within 8s")), DEADLINE_MS);
      ws.addEventListener("open", () => send(encodeClientHello()), { signal: listeners.signal });
      ws.addEventListener("error", () => reject(new Error(`websocket error at ${url}`)), { signal: listeners.signal });
      ws.addEventListener("close", () => reject(new Error("websocket closed before demo completed")), { signal: listeners.signal });
      ws.addEventListener("message", (event) => {
        try {
          if (!(event.data instanceof ArrayBuffer)) throw new Error("expected binary WebSocket frame");
          const bytes = new Uint8Array(event.data);
          if (!hello) {
            const frame = fromBinary(HandshakeFrameSchema, bytes);
            if (frame.body.case !== "serverHello") throw new Error(`handshake failed: ${frame.body.case} ${frame.body.value?.message ?? ""}`);
            hello = frame.body.value;
            if (hello.selectedProtocolMajor !== 1 || hello.role !== ConnectionRole.AIGENT) throw new Error("server did not select protocol v1 aigent role");
            console.log("scripted-aigent: hello protocol=1 role=aigent");
            sendMove(1n, 1n, "demo-move-1", "first MOVE");
            return;
          }
          const envelope = fromBinary(EnvelopeSchema, bytes);
          if (envelope.protocolMajor !== 1 || !Buffer.from(envelope.connectionId).equals(Buffer.from(hello.connectionId))) throw new Error("envelope does not match the selected connection");
          const { body } = envelope;
          if (body.case === "protocolError") throw new Error(`ProtocolError code=${body.value.code} message=${body.value.message}`);
          if (body.case === "connectionDisplaced") throw new Error("aigent session displaced by another connection");
          if (body.case === "snapshotResyncRequired") throw new Error("snapshot baseline lost; restart this fresh demo");
          if (body.case === "commandResult") {
            const result = body.value;
            if (
              !pending ||
              result.commandMessageId !== pending.messageId ||
              result.sequence !== pending.sequence ||
              !Buffer.from(result.idempotencyKey).equals(Buffer.from(text.encode(pending.idempotencyKey)))
            ) throw new Error("uncorrelated command result");
            if (result.outcome.case !== "accepted") throw new Error(`${pending.label} rejected code=${result.outcome.value?.code ?? "missing"} message=${result.outcome.value?.message ?? ""}`);
            console.log(`scripted-aigent: ${pending.label} seq=${result.sequence} message=${result.commandMessageId} outcome=accepted`);
            const label = pending.label;
            pending = undefined;
            // Default leases last 10s; one renewal covers this bounded 8s tracer.
            if (label === "first MOVE") sendMove(2n, 1n, "demo-move-1", "idempotent replay");
            else if (label === "idempotent replay") renewal = setTimeout(() => sendMove(3n, 2n, "demo-move-2", "renew MOVE"), 150);
            else {
              resultsComplete = true;
              completeIfObserved();
            }
          } else if (body.case === "fullSnapshot") {
            const snapshot = fromBinary(WorldSnapshotBodyProtoSchema, body.value.payload);
            if (snapshot.version !== 1) throw new Error("unsupported snapshot version");
            baselineId = body.value.baselineId;
            console.log(`scripted-aigent: baseline=${baselineId} authoritative tick=${snapshot.tick}`);
            observeBodies(snapshot.bodies, true);
          } else if (body.case === "snapshotDelta") {
            if (baselineId === undefined || body.value.baselineId !== baselineId) throw new Error("snapshot delta has no matching baseline");
            const delta = fromBinary(WorldSnapshotDeltaProtoSchema, body.value.payload);
            if (delta.version !== 1) throw new Error("unsupported snapshot delta version");
            observeBodies([...delta.entered, ...delta.modified], false, delta.leftIds);
          }
        } catch (error) {
          reject(error);
        }
      }, { signal: listeners.signal });
    });
  } finally {
    clearTimeout(deadline);
    clearTimeout(renewal);
    listeners.abort();
    await closeSocket(ws);
  }
}

main().then(
  () => process.exit(0),
  (error) => {
    console.error(`scripted-aigent: FAILURE ${error.message}`);
    process.exit(1);
  },
);
