import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { createServer } from "node:http";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { create, fromBinary, toBinary } from "@bufbuild/protobuf";
import {
  CommandKind,
  CommandRejectionCode,
  ConnectionMode,
  ConnectionRole,
  EnvelopeSchema,
  HandshakeFrameSchema,
  MovePayloadSchema,
  ShapeTreeSchema,
  WorldSnapshotBodyProtoSchema,
  WorldSnapshotDeltaProtoSchema,
} from "@aigent-place/protocol";

const entry = fileURLToPath(new URL("../scripts/scripted-move.mjs", import.meta.url));
const connectionId = new Uint8Array([10, 20]);
const sessionEpoch = new Uint8Array([30, 40]);
const demoShape = create(ShapeTreeSchema, {
  nodes: [{
    nodeId: 1,
    parentNodeId: 0,
    transform: { translation: { xMm: 0n, yMm: 0n, zMm: 0n }, rotation: { x: 0, y: 0, z: 0, w: 1 } },
    color: { red: 80, green: 160, blue: 220, alpha: 255 },
    materialTags: [],
    primitive: { case: "box", value: { sizeXMm: 1000n, sizeYMm: 1800n, sizeZMm: 1000n } },
  }],
});

function frame(payload, opcode = 2) {
  const bytes = Buffer.from(payload);
  const header = bytes.length < 126 ? Buffer.from([0x80 | opcode, bytes.length]) : Buffer.from([0x80 | opcode, 126, bytes.length >> 8, bytes.length & 255]);
  return Buffer.concat([header, bytes]);
}

// A small loopback WebSocket peer, not a replacement for the actual CLI.
// Assertions decode the wire with generated schemas, independent of CLI logs.
async function fixture(mode = "motion") {
  const state = { commands: [], closed: false, errors: [] };
  const sockets = new Set();
  const timers = new Set();
  const server = createServer();
  server.on("upgrade", (request, socket, head) => {
    sockets.add(socket);
    socket.on("error", (error) => state.errors.push(error));
    socket.on("close", () => sockets.delete(socket));
    const accept = createHash("sha1").update(request.headers["sec-websocket-key"] + "258EAFA5-E914-47DA-95CA-C5AB0DC85B11").digest("base64");
    socket.write(`HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: ${accept}\r\n\r\n`);
    let buffered = head;
    let handshaken = false;
    let serverMessageId = 1n;
    let revision = 1n;
    let x = 0;
    const sendEnvelope = (body) => socket.write(frame(toBinary(EnvelopeSchema, create(EnvelopeSchema, {
      protocolMajor: 1, connectionId, messageId: serverMessageId++, metadata: {}, body,
    }))));
    const generationDigest = () => createHash("sha256").update(`${x}:${revision}`).digest();
    const record = () => ({ entityId: 1n, revision: revision++, positionMm: { xMm: BigInt(x), yMm: 8905n, zMm: 0n }, shape: demoShape });
    const sendDelta = () => sendEnvelope({ case: "snapshotDelta", value: {
      baselineId: 1n,
      payload: toBinary(WorldSnapshotDeltaProtoSchema, create(WorldSnapshotDeltaProtoSchema, { version: 1, generationDigest: generationDigest(), modified: [record()] })),
    } });
    const handle = (opcode, payload) => {
      if (opcode === 8) {
        state.closed = true;
        socket.end(frame(payload, 8));
        for (const timer of timers) clearInterval(timer);
        return;
      }
      if (opcode !== 2) throw new Error(`unexpected client opcode ${opcode}`);
      if (!handshaken) {
        const hello = fromBinary(HandshakeFrameSchema, payload);
        assert.equal(hello.body.case, "clientHello");
        assert.equal(hello.body.value.role, ConnectionRole.AIGENT);
        handshaken = true;
        socket.write(frame(toBinary(HandshakeFrameSchema, create(HandshakeFrameSchema, { body: { case: "serverHello", value: {
          connectionId, sessionEpoch, selectedProtocolMajor: 1, role: ConnectionRole.AIGENT,
          mode: ConnectionMode.COMMAND_CAPABLE, selectedFeatures: [],
        } } }))));
        if (mode !== "silent") sendEnvelope({ case: "fullSnapshot", value: {
          baselineId: 1n,
          payload: toBinary(WorldSnapshotBodyProtoSchema, create(WorldSnapshotBodyProtoSchema, { version: 1, tick: 123n, generationDigest: generationDigest(), bodies: [record()] })),
        } });
        return;
      }
      const envelope = fromBinary(EnvelopeSchema, payload);
      assert.equal(envelope.body.case, "command");
      assert.ok(envelope.metadata, "command envelope requires metadata");
      const command = envelope.body.value;
      state.commands.push({ envelope, command });
      const reject = mode === "reject" || (mode === "reject-replay" && state.commands.length === 2);
      sendEnvelope({ case: "commandResult", value: {
        commandMessageId: envelope.messageId,
        sequence: command.metadata.sequence,
        idempotencyKey: command.metadata.idempotencyKey,
        outcome: reject ? { case: "rejected", value: { code: CommandRejectionCode.INVALID_INTENT, message: "seeded rejection" } } : { case: "accepted", value: {} },
      } });
      if (state.commands.length === 1 && (mode === "motion" || mode === "instant" || mode === "insufficient")) {
        const timer = setInterval(() => {
          if (mode === "motion") x = Math.min(1500, x + 25);
          else if (mode === "insufficient") x = Math.min(300, x + 5);
          else x = 1500;
          sendDelta();
          if (x === 1500 || (mode === "insufficient" && x === 300)) clearInterval(timer);
        }, 50);
        timers.add(timer);
      }
    };
    socket.on("data", (chunk) => {
      buffered = Buffer.concat([buffered, chunk]);
      try {
        while (buffered.length >= 2) {
          const opcode = buffered[0] & 15;
          const masked = Boolean(buffered[1] & 128);
          let size = buffered[1] & 127;
          let offset = 2;
          if (size === 126) {
            if (buffered.length < 4) return;
            size = buffered.readUInt16BE(2);
            offset = 4;
          }
          if (size === 127) throw new Error("fixture frame too large");
          if (!masked) throw new Error("client frame is not masked");
          if (buffered.length < offset + 4 + size) return;
          const mask = buffered.subarray(offset, offset + 4);
          offset += 4;
          const payload = Buffer.from(buffered.subarray(offset, offset + size));
          for (let index = 0; index < size; index++) payload[index] ^= mask[index % 4];
          buffered = buffered.subarray(offset + size);
          handle(opcode, payload);
        }
      } catch (error) {
        state.errors.push(error);
        socket.destroy();
      }
    });
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  return {
    url: `ws://127.0.0.1:${server.address().port}/ws`, state,
    close: async () => {
      for (const timer of timers) clearInterval(timer);
      for (const socket of sockets) socket.destroy();
      await new Promise((resolve) => server.close(resolve));
    },
  };
}

async function run(url) {
  const started = performance.now();
  const child = spawn(process.execPath, [entry], { env: { ...process.env, AIGENT_WS_URL: url } });
  let output = "";
  child.stdout.on("data", (chunk) => { output += chunk; });
  child.stderr.on("data", (chunk) => { output += chunk; });
  const guard = setTimeout(() => child.kill("SIGKILL"), 11_000);
  const { code, signal } = await new Promise((resolve, reject) => {
    child.on("error", reject);
    child.on("close", (code, signal) => resolve({ code, signal }));
  });
  clearTimeout(guard);
  return { code, signal, output, elapsed: performance.now() - started };
}

async function runFixture(mode, check) {
  const peer = await fixture(mode);
  try {
    const result = await run(peer.url);
    assert.equal(result.signal, null, result.output);
    assert.ok(result.elapsed <= 10_000, result.output);
    assert.deepEqual(peer.state.errors, []);
    assert.equal(peer.state.closed, true, "actual CLI must send CLOSE on all outcomes");
    await check(result, peer.state);
  } finally {
    await peer.close();
  }
}

test("actual entry sends typed MOVE, replay and renewal, then succeeds only on observed motion", async () => {
  await runFixture("motion", (result, state) => {
    assert.equal(result.code, 0, result.output);
    assert.match(result.output, /authoritative tick=123/);
    assert.match(result.output, /idempotent replay .*outcome=accepted/);
    assert.match(result.output, /renew MOVE .*outcome=accepted/);
    const success = result.output.match(/SUCCESS body=1 observed displacement=([\d.]+)m movement=([\d.]+)s/);
    assert.ok(success, result.output);
    assert.ok(Number(success[1]) >= 1);
    assert.ok(Number(success[2]) >= 2);
    assert.equal(state.commands.length, 3);
    for (const { command, envelope } of state.commands) {
      assert.equal(command.kind, CommandKind.MOVE);
      assert.deepEqual(Buffer.from(envelope.connectionId), Buffer.from(connectionId));
      assert.deepEqual(Buffer.from(command.metadata.sessionEpoch), Buffer.from(sessionEpoch));
      const move = fromBinary(MovePayloadSchema, command.payload);
      assert.equal(move.targetXMm, 1500n);
      assert.equal(move.targetZMm, 0n);
      assert.equal(move.speedMmPerS, 500);
    }
    const [first, replay, renew] = state.commands;
    assert.deepEqual(first.command, replay.command, "replay keeps sequence, payload and idempotency key");
    assert.equal(replay.envelope.messageId, 2n);
    assert.equal(renew.command.metadata.sequence, 2n);
    assert.notDeepEqual(renew.command.metadata.idempotencyKey, first.command.metadata.idempotencyKey);
  });
});

test("actual entry fails and closes on first MOVE rejection", async () => {
  await runFixture("reject", (result, state) => {
    assert.equal(result.code, 1, result.output);
    assert.match(result.output, /FAILURE first MOVE rejected code=11 message=seeded rejection/);
    assert.doesNotMatch(result.output, /SUCCESS/);
    assert.equal(state.commands.length, 1);
  });
});

test("actual entry requires accepted replay and closes on replay rejection", async () => {
  await runFixture("reject-replay", (result, state) => {
    assert.equal(result.code, 1, result.output);
    assert.match(result.output, /FAILURE idempotent replay rejected/);
    assert.doesNotMatch(result.output, /SUCCESS/);
    assert.equal(state.commands.length, 2);
  });
});

test("accepted commands without observe data time out and close within ten seconds", async () => {
  await runFixture("silent", (result) => {
    assert.equal(result.code, 1, result.output);
    assert.match(result.output, /FAILURE timeout:/);
    assert.doesNotMatch(result.output, /SUCCESS/);
  });
});

test("a large immediate displacement cannot substitute for two seconds of changed poses", async () => {
  await runFixture("instant", (result) => {
    assert.equal(result.code, 1, result.output);
    assert.match(result.output, /FAILURE timeout:/);
    assert.doesNotMatch(result.output, /SUCCESS/);
  });
});

test("two seconds of small motion cannot substitute for one metre of displacement", async () => {
  await runFixture("insufficient", (result) => {
    assert.equal(result.code, 1, result.output);
    assert.match(result.output, /FAILURE timeout:/);
    assert.doesNotMatch(result.output, /SUCCESS/);
  });
});

test("actual entry fails and exits within ten seconds on a closed port", async () => {
  const peer = await fixture();
  const url = peer.url;
  await peer.close();
  const result = await run(url);
  assert.equal(result.signal, null, result.output);
  assert.equal(result.code, 1, result.output);
  assert.match(result.output, /FAILURE websocket error/);
  assert.doesNotMatch(result.output, /SUCCESS/);
  assert.ok(result.elapsed <= 10_000, result.output);
});
