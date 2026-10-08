import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { createServer } from 'node:http';
import { fileURLToPath } from 'node:url';
import { create, fromBinary, toBinary } from '@bufbuild/protobuf';
import {
  CommandKind, ConnectionMode, ConnectionRole, EnvelopeSchema, HandshakeFrameSchema,
  MovePayloadSchema, WorldSnapshotBodyProtoSchema, WorldSnapshotDeltaProtoSchema,
} from '@aigent-place/protocol';

export const body = (entityId, xMm = 0n, zMm = 0n, revision = 1n) => ({ entityId, revision, positionMm: { xMm, yMm: 0n, zMm } });
function frame(payload, opcode = 2) {
  const bytes = Buffer.from(payload);
  const prefix = bytes.length < 126 ? Buffer.from([0x80 | opcode, bytes.length]) : Buffer.from([0x80 | opcode, 126, bytes.length >> 8, bytes.length & 255]);
  return Buffer.concat([prefix, bytes]);
}

/** Small owned mock peer. The actual CLI and generated wire codec stay real. */
export async function mockWorld(options = {}) {
  const state = { commands: [], hellos: [], connections: [], errors: [], closed: 0, resyncs: 0 };
  const sockets = new Set();
  const server = createServer();
  server.on('upgrade', (request, socket, head) => {
    sockets.add(socket);
    socket.on('error', error => state.errors.push(error));
    const accept = createHash('sha1').update(request.headers['sec-websocket-key'] + '258EAFA5-E914-47DA-95CA-C5AB0DC85B11').digest('base64');
    socket.write(`HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: ${accept}\r\n\r\n`);
    const index = state.connections.length;
    const conn = {
      index, connectionId: new Uint8Array([10, index + 1]), sessionEpoch: new Uint8Array([30, index + 1]),
      selfBodyId: 2n, bodies: [body(1n, 5_000n), body(2n)], baselineId: 1n,
      handshaken: false, serverMessageId: 1n, seen: new Set(), closed: false,
    };
    state.connections.push(conn);
    const timers = new Set();
    socket.on('close', () => {
      conn.closed = true;
      sockets.delete(socket);
      for (const timer of timers) clearTimeout(timer);
    });
    const send = (bodyValue, overrides = {}) => {
      if (!socket.destroyed) socket.write(frame(toBinary(EnvelopeSchema, create(EnvelopeSchema, {
        protocolMajor: 1, connectionId: conn.connectionId, messageId: conn.serverMessageId++, metadata: {}, body: bodyValue, ...overrides,
      }))));
    };
    const full = (overrides = {}) => send({ case: 'fullSnapshot', value: {
      baselineId: conn.baselineId,
      payload: toBinary(WorldSnapshotBodyProtoSchema, create(WorldSnapshotBodyProtoSchema, {
        version: 1, tick: 1n, generationDigest: new Uint8Array(32), bodies: conn.bodies, selfBodyId: conn.selfBodyId, ...overrides,
      })),
    } });
    const delta = (overrides = {}) => send({ case: 'snapshotDelta', value: {
      baselineId: conn.baselineId,
      payload: toBinary(WorldSnapshotDeltaProtoSchema, create(WorldSnapshotDeltaProtoSchema, {
        version: 1, generationDigest: new Uint8Array(32), selfBodyId: conn.selfBodyId, ...overrides,
      })),
    } });
    const later = (callback, ms) => {
      const timer = setTimeout(() => { timers.delete(timer); if (!socket.destroyed) callback(); }, ms);
      timers.add(timer);
    };
    const api = { conn, state, send, full, delta, later, disconnect: () => socket.end(), raw: bytes => socket.write(frame(bytes)) };
    conn.api = api;
    const handle = (opcode, payload) => {
      if (opcode === 8) {
        state.closed += 1;
        socket.end(frame(payload, 8));
        return;
      }
      assert.equal(opcode, 2, 'client must use binary frames');
      if (!conn.handshaken) {
        const hello = fromBinary(HandshakeFrameSchema, payload);
        assert.equal(hello.body.case, 'clientHello');
        assert.equal(hello.body.value.role, ConnectionRole.AIGENT);
        assert.deepEqual(hello.body.value.offeredProtocolMajors, [1]);
        state.hellos.push(hello.body.value);
        conn.handshaken = true;
        socket.write(frame(toBinary(HandshakeFrameSchema, create(HandshakeFrameSchema, { body: { case: 'serverHello', value: {
          connectionId: conn.connectionId, sessionEpoch: conn.sessionEpoch, selectedProtocolMajor: 1,
          role: ConnectionRole.AIGENT, mode: ConnectionMode.COMMAND_CAPABLE, selectedFeatures: [], ...options.hello,
        } } }))));
        if (options.onHello) options.onHello(api);
        else full();
        return;
      }
      const envelope = fromBinary(EnvelopeSchema, payload);
      assert.ok(envelope.metadata);
      assert.equal(envelope.protocolMajor, 1);
      assert.deepEqual(Buffer.from(envelope.connectionId), Buffer.from(conn.connectionId));
      assert.ok(envelope.messageId > 0n && !conn.seen.has(envelope.messageId));
      conn.seen.add(envelope.messageId);
      if (envelope.body.case === 'snapshotResyncRequest') {
        state.resyncs += 1;
        conn.baselineId += 1n;
        if (options.onResync) options.onResync(api);
        else full();
        return;
      }
      assert.equal(envelope.body.case, 'command');
      const command = envelope.body.value;
      assert.deepEqual(Buffer.from(command.metadata.sessionEpoch), Buffer.from(conn.sessionEpoch));
      assert.ok(command.metadata.sequence > 0n && command.metadata.idempotencyKey.length > 0);
      assert.ok([CommandKind.MOVE, CommandKind.STOP].includes(command.kind));
      if (command.kind === CommandKind.STOP) assert.equal(command.payload.length, 0);
      const move = command.kind === CommandKind.MOVE ? fromBinary(MovePayloadSchema, command.payload) : undefined;
      const result = (outcome = { case: 'accepted', value: {} }, overrides = {}) => send({ case: 'commandResult', value: {
        commandMessageId: envelope.messageId, sequence: command.metadata.sequence,
        idempotencyKey: command.metadata.idempotencyKey, outcome, ...overrides,
      } });
      const item = { index, envelope, command, move, receivedAt: performance.now(), result, ...api };
      state.commands.push(item);
      if (options.onCommand) options.onCommand(item);
      else result();
    };
    let buffered = head;
    socket.on('data', chunk => {
      buffered = Buffer.concat([buffered, chunk]);
      try {
        while (buffered.length >= 2) {
          const opcode = buffered[0] & 15;
          assert.ok(buffered[1] & 128, 'client frames must be masked');
          let length = buffered[1] & 127;
          let offset = 2;
          if (length === 126) {
            if (buffered.length < 4) return;
            length = buffered.readUInt16BE(2);
            offset = 4;
          }
          assert.notEqual(length, 127, 'fixture does not need giant frames');
          if (buffered.length < offset + 4 + length) return;
          const mask = buffered.subarray(offset, offset + 4);
          offset += 4;
          const payload = Buffer.from(buffered.subarray(offset, offset + length));
          for (let i = 0; i < length; i++) payload[i] ^= mask[i % 4];
          buffered = buffered.subarray(offset + length);
          handle(opcode, payload);
        }
      } catch (error) {
        state.errors.push(error);
        socket.destroy();
      }
    });
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  return {
    url: `ws://127.0.0.1:${server.address().port}/ws`, state,
    async close() {
      for (const socket of sockets) socket.destroy();
      await new Promise(resolve => server.close(resolve));
    },
  };
}

export function startDemo(url, { role = 'runner', duration = 0.7, args = [], id = `mock-${role}`, env = {}, rootCommand = false } = {}) {
  const entry = fileURLToPath(new URL('../scripts/demo.mjs', import.meta.url));
  const flags = ['--role', role, '--fresh-two-body', '--ws', url, '--id', id, '--duration', String(duration), ...args];
  const child = rootCommand ? spawn('npm', ['run', 'aigent:demo', '--', ...flags], {
    cwd: fileURLToPath(new URL('../../../', import.meta.url)), env: { ...process.env, ...env },
  }) : spawn(process.execPath, [entry, ...flags], { env: { ...process.env, ...env } });
  let output = '';
  child.stdout.on('data', bytes => { output += bytes; });
  child.stderr.on('data', bytes => { output += bytes; });
  const guard = setTimeout(() => child.kill('SIGKILL'), 9_000);
  const result = new Promise((resolve, reject) => {
    child.on('error', reject);
    child.on('close', (code, signal) => {
      clearTimeout(guard);
      resolve({ code, signal, output, events: output.trim().split('\n').filter(line => line.startsWith('{')).map(line => JSON.parse(line)) });
    });
  });
  return { child, result };
}
