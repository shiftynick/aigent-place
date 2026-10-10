import { randomUUID } from 'node:crypto';
import { create, toBinary } from '@bufbuild/protobuf';
import {
  ClientHelloSchema, CommandKind, CommandRejectionCode, CommandSchema, ConnectionMode, ConnectionRole,
  EnvelopeSchema, HandshakeFrameSchema, LeaseTerminatedPayloadSchema,
  LeaseTerminationReason, MovePayloadSchema, PerceptKind, ProtocolErrorCode,
} from '@aigent-place/protocol';
import { createPolicy } from './demo-policy.js';
import { createActivityPolicy } from './activity-policy.js';
import { decodeDemoBinary, DemoError, SnapshotView } from './demo-observation.js';

const TEXT = new TextEncoder();
const sameBytes = (a, b) => a?.length === b?.length && a.every((byte, index) => byte === b[index]);
const commandKey = command => command.kind === 'move' ? `move:${command.targetXMm}:${command.targetZMm}:${command.speedMmPerS}:${command.retryId ?? 0}` : command.kind;
const SERVER_BODIES = new Set(['commandResult', 'protocolError', 'percept', 'fullSnapshot', 'snapshotDelta', 'snapshotResyncRequired', 'orderedEvent', 'eventResyncRequired', 'eventStreamReset', 'connectionDisplaced']);
const enumValues = generatedEnum => new Set(Object.values(generatedEnum).filter(value => typeof value === 'number' && value > 0));
const REJECT_CODES = enumValues(CommandRejectionCode);
const TERMINATION_REASONS = enumValues(LeaseTerminationReason);
const PERCEPT_KINDS = enumValues(PerceptKind);

async function pause(ms, signal) {
  if (signal?.aborted) return;
  await new Promise(resolve => {
    const done = () => { clearTimeout(timer); signal?.removeEventListener('abort', done); resolve(); };
    const timer = setTimeout(done, ms);
    signal?.addEventListener('abort', done, { once: true });
  });
}
async function closeSocket(ws) {
  if (ws.readyState === WebSocket.CLOSED) return;
  await new Promise(resolve => {
    const done = () => { clearTimeout(timer); ws.removeEventListener('close', done); resolve(); };
    const timer = setTimeout(done, 250);
    ws.addEventListener('close', done, { once: true });
    ws.close(1000, 'demo stopped');
  });
}

/**
 * One owner connection and one pure policy. This is a fresh-two-body demo,
 * not authentication, a resident registry, or durable command-result recovery.
 */
export class DemoBrainClient {
  constructor({ url, aigentId, role, preset = 'compact', activity = false, log = () => {}, clock = () => performance.now(), durationMs = 0 }) {
    const parsed = new URL(url);
    if (!['ws:', 'wss:'].includes(parsed.protocol)) throw new DemoError('INVALID_OPTIONS', 'WS URL required');
    if (typeof aigentId !== 'string' || !TEXT.encode(aigentId).length || TEXT.encode(aigentId).length > 256) throw new DemoError('INVALID_OPTIONS', 'aigent ID must contain 1..256 UTF-8 bytes');
    if (!Number.isFinite(durationMs) || durationMs < 0 || durationMs > 3_600_000) throw new DemoError('INVALID_OPTIONS', 'duration exceeds demo bound');
    if (activity && preset !== 'compact') throw new DemoError('INVALID_OPTIONS', '--activity is incompatible with --wide-plaza');
    this.url = url;
    this.aigentId = TEXT.encode(aigentId);
    this.role = role;
    const startedAt = clock();
    // Receipt time is local observability, not an authoritative simulation tick.
    this.log = event => log({ source: 'aigent-demo', role, wallTime: new Date().toISOString(), elapsedMs: Math.round(clock() - startedAt), ...event });
    this.clock = clock;
    this.durationMs = durationMs;
    this.policy = activity ? createActivityPolicy(role) : createPolicy(role, preset);
    this.view = new SnapshotView();
    this.resyncs = 0;
  }

  async run(signal) {
    const lifecycle = new AbortController();
    const abort = () => lifecycle.abort();
    signal?.addEventListener('abort', abort, { once: true });
    if (signal?.aborted) lifecycle.abort();
    const deadline = this.durationMs ? setTimeout(abort, this.durationMs) : undefined;
    try {
      for (let reconnect = 0; !lifecycle.signal.aborted; reconnect++) {
        const error = await this.session(lifecycle.signal);
        if (!error || lifecycle.signal.aborted) return;
        if (!error.retryable || reconnect >= 3) throw error;
        this.log({ type: 'reconnect', code: error.code, attempt: reconnect + 1 });
        await pause(250 * (reconnect + 1), lifecycle.signal);
      }
    } finally {
      clearTimeout(deadline);
      signal?.removeEventListener('abort', abort);
    }
  }

  session(signal) {
    this.view.reset();
    this.policy.beginSession();
    return new Promise(resolve => {
      const ws = new WebSocket(this.url);
      ws.binaryType = 'arraybuffer';
      const listeners = new AbortController();
      let hello;
      let nextMessageId = 1n;
      let nextSequence = 1n;
      let nonce;
      let pending;
      let desired = { kind: 'hold' };
      let lastSent;
      let lastSentAt = 0;
      let lastObserveAt = this.clock();
      let boundDeadline = this.clock() + 5_000;
      let terminationHint;
      let stopping = false;
      let stopDeadline;
      let shutdownStopSent = false;
      let finished = false;
      let highestServerId = 0n;
      const seenServerIds = new Set();
      const recentResults = [];
      const finish = async error => {
        if (finished) return;
        finished = true;
        clearInterval(timer);
        listeners.abort();
        signal.removeEventListener('abort', stop);
        await closeSocket(ws);
        resolve(error);
      };
      const sendEnvelope = body => {
        const messageId = nextMessageId++;
        ws.send(toBinary(EnvelopeSchema, create(EnvelopeSchema, {
          protocolMajor: 1, connectionId: hello.connectionId, messageId, metadata: {}, body,
        })));
        return messageId;
      };
      const sendAttempt = () => {
        const messageId = sendEnvelope({ case: 'command', value: pending.command });
        pending.messageIds.push(messageId);
        pending.sentAt = this.clock();
        pending.retryAt = undefined;
        this.log({ type: pending.messageIds.length === 1 ? 'command' : 'retry', kind: pending.desired.kind, sequence: pending.command.metadata.sequence.toString(), messageId: messageId.toString() });
      };
      const sendCommand = command => {
        const kind = command.kind === 'move' ? CommandKind.MOVE : CommandKind.STOP;
        const payload = command.kind === 'move' ? toBinary(MovePayloadSchema, create(MovePayloadSchema, {
          targetXMm: command.targetXMm, targetZMm: command.targetZMm, speedMmPerS: command.speedMmPerS,
        })) : new Uint8Array();
        pending = {
          command: create(CommandSchema, { kind, payload, metadata: {
            sessionEpoch: hello.sessionEpoch, sequence: nextSequence,
            idempotencyKey: TEXT.encode(`${nonce}:${nextSequence}`),
          } }), desired: command, messageIds: [], sentAt: this.clock(), retryAt: undefined,
        };
        sendAttempt();
      };
      const resync = reason => {
        this.view.reset();
        // Suspend observation-based stall timing, retaining this session's
        // qualifying failures and the ever-adopted explicit self identity.
        this.policy.decide(this.view, this.clock());
        desired = { kind: 'hold' };
        terminationHint = undefined;
        boundDeadline = this.clock() + 5_000;
        if (++this.resyncs > 3) throw new DemoError('RESYNC_LIMIT', 'snapshot recovery limit exceeded');
        this.log({ type: 'resync', reason });
        sendEnvelope({ case: 'snapshotResyncRequest', value: {} });
      };
      const decide = () => {
        if (!hello || stopping || finished) return;
        const result = this.policy.decide(this.view, this.clock(), terminationHint);
        terminationHint = undefined;
        desired = result.command;
        for (const event of result.events) this.log(event);
      };
      const stop = () => {
        if (finished || stopping) return;
        stopping = true;
        stopDeadline = this.clock() + 1_000;
        this.log({ type: 'stopping', selfBodyId: this.view.selfBodyId?.toString() });
        tick();
      };
      const tick = () => {
        if (finished) return;
        try {
          const now = this.clock();
          if (stopping) {
            if (now >= stopDeadline || !hello) { void finish(); return; }
            // Cleanup STOP uses the confirmed session sequence. It does not
            // choose a goal or guess a body during a binding recovery gap.
            if (!pending && !shutdownStopSent) {
              shutdownStopSent = true;
              sendCommand({ kind: 'stop' });
            }
            return;
          }
          if (!hello) {
            if (now >= boundDeadline) throw new DemoError('HANDSHAKE_TIMEOUT', 'handshake timed out', true);
            return;
          }
          if (now - lastObserveAt > 5_000) throw new DemoError('OBSERVATION_TIMEOUT', 'authoritative observations stopped', true);
          if ((!this.view.selfBodyId || !this.view.bodies.has(this.view.selfBodyId)) && now >= boundDeadline) throw new DemoError('BINDING_TIMEOUT', 'explicit self binding and pose did not arrive', true);
          if (pending) {
            if (pending.retryAt !== undefined ? now >= pending.retryAt : now - pending.sentAt >= 1_500) {
              if (pending.messageIds.length >= 3) throw new DemoError('RESULT_TIMEOUT', 'correlated command result retry limit', true);
              sendAttempt();
            }
            return;
          }
          decide();
          if (desired.kind !== 'hold' && (commandKey(desired) !== lastSent || desired.kind === 'move' && now - lastSentAt >= 3_000)) sendCommand(desired);
        } catch (error) { void finish(error); }
      };
      const timer = setInterval(tick, 100);
      signal.addEventListener('abort', stop, { once: true });
      ws.addEventListener('open', () => {
        if (stopping || finished) return;
        ws.send(toBinary(HandshakeFrameSchema, create(HandshakeFrameSchema, { body: { case: 'clientHello', value: create(ClientHelloSchema, {
          role: ConnectionRole.AIGENT, offeredProtocolMajors: [1], aigentId: this.aigentId,
        }) } })));
      }, { signal: listeners.signal });
      ws.addEventListener('error', () => { void finish(new DemoError('SOCKET_ERROR', 'WebSocket connection failed', true)); }, { signal: listeners.signal });
      ws.addEventListener('close', () => { void finish(stopping ? undefined : new DemoError('SOCKET_CLOSED', 'WebSocket closed', true)); }, { signal: listeners.signal });
      ws.addEventListener('message', event => {
        if (finished) return;
        try {
          if (!(event.data instanceof ArrayBuffer)) throw new DemoError('INVALID_FRAME', 'binary WebSocket frame required');
          const bytes = new Uint8Array(event.data);
          if (!hello) {
            const frame = decodeDemoBinary(HandshakeFrameSchema, bytes);
            const value = frame.body.value;
            if (frame.body.case !== 'serverHello' || value.selectedProtocolMajor !== 1 || value.role !== ConnectionRole.AIGENT || value.mode !== ConnectionMode.COMMAND_CAPABLE || !value.connectionId.length || value.connectionId.length > 256 || !value.sessionEpoch.length || value.sessionEpoch.length > 256 || value.selectedFeatures.length || value.upgradeNotice) throw new DemoError('NEGOTIATION_FAILED', 'expected protocol v1 command-capable aigent hello');
            hello = value;
            nonce = randomUUID();
            this.view.reset();
            boundDeadline = this.clock() + 5_000;
            this.log({ type: 'hello', reconnectBinding: this.view.expectedSelfBodyId?.toString() });
            if (this.view.expectedSelfBodyId === undefined) {
              // A lost unadmitted bootstrap needs a fresh attempt in this
              // epoch. An ever-adopted binding suppresses spawning on recovery.
              sendCommand({ kind: 'move', targetXMm: 0n, targetZMm: 0n, speedMmPerS: 500 });
            }
            return;
          }
          const envelope = decodeDemoBinary(EnvelopeSchema, bytes);
          if (envelope.protocolMajor !== 1 || !sameBytes(envelope.connectionId, hello.connectionId) || envelope.messageId === 0n || !envelope.metadata || envelope.metadata.requiredFeatures.length || !SERVER_BODIES.has(envelope.body.case)) throw new DemoError('INVALID_ENVELOPE', 'envelope identity, metadata, ID or direction invalid');
          // Bounded replay window permits current transport's concurrent producers.
          // A far-old ID is rejected rather than forgotten and accepted again.
          if (seenServerIds.has(envelope.messageId) || envelope.messageId <= highestServerId - 1_024n) throw new DemoError('DUPLICATE_MESSAGE', 'duplicate or expired server message ID');
          highestServerId = envelope.messageId > highestServerId ? envelope.messageId : highestServerId;
          seenServerIds.add(envelope.messageId);
          for (const id of seenServerIds) if (id <= highestServerId - 1_024n) seenServerIds.delete(id);
          const body = envelope.body;
          if (body.case === 'fullSnapshot' || body.case === 'snapshotDelta') {
            const previousBinding = this.view.selfBodyId;
            try {
              if (body.case === 'fullSnapshot') this.view.applyFull(body.value);
              else this.view.applyDelta(body.value);
            } catch (error) {
              if (['BASELINE_MISMATCH', 'INVALID_OBSERVATION'].includes(error.code)) { resync(error.code); return; }
              this.view.reset();
              throw error;
            }
            lastObserveAt = this.clock();
            if (this.view.selfBodyId !== previousBinding) {
              const own = this.view.bodies.get(this.view.selfBodyId);
              this.log({ type: this.view.selfBodyId === undefined ? 'binding-cleared' : 'binding-adopted', selfBodyId: this.view.selfBodyId?.toString(), ownRevision: own?.revision.toString(), own: own ? [Number(own.positionMm.xMm), Number(own.positionMm.zMm)] : undefined, baselineId: this.view.baselineId.toString() });
            }
            if (this.view.selfBodyId && this.view.bodies.has(this.view.selfBodyId)) boundDeadline = this.clock() + 5_000;
            decide();
            tick();
          } else if (body.case === 'snapshotResyncRequired') resync(`server-${body.value.reason}`);
          else if (body.case === 'connectionDisplaced') throw new DemoError('SESSION_DISPLACED', 'another connection displaced this aigent');
          else if (body.case === 'commandResult') {
            const result = body.value;
            const correlation = item => item.messageIds.includes(result.commandMessageId) && item.command.metadata.sequence === result.sequence && sameBytes(item.command.metadata.idempotencyKey, result.idempotencyKey);
            if (!['accepted', 'rejected'].includes(result.outcome.case) || result.outcome.case === 'rejected' && !REJECT_CODES.has(result.outcome.value.code)) throw new DemoError('INVALID_RESULT', 'missing or invalid command outcome');
            if (!pending || !correlation(pending)) {
              const prior = recentResults.find(correlation);
              if (prior && prior.outcome === result.outcome.case && prior.code === (result.outcome.case === 'rejected' ? result.outcome.value.code : undefined)) return;
              throw new DemoError('UNCORRELATED_RESULT', 'command result does not match a bounded outstanding/replayed command');
            }
            recentResults.push({ ...pending, outcome: result.outcome.case, code: result.outcome.case === 'rejected' ? result.outcome.value.code : undefined });
            if (recentResults.length > 8) recentResults.shift();
            nextSequence += 1n;
            lastSent = commandKey(pending.desired);
            lastSentAt = this.clock();
            const wasStop = pending.desired.kind === 'stop';
            pending = undefined;
            this.log({ type: 'result', sequence: result.sequence.toString(), outcome: result.outcome.case });
            if (result.outcome.case === 'rejected') throw new DemoError('COMMAND_REJECTED', `command rejected code=${result.outcome.value.code}`);
            if (stopping && shutdownStopSent && wasStop) { void finish(); return; }
            tick();
          } else if (body.case === 'protocolError') {
            const error = body.value;
            if (!pending || !pending.messageIds.includes(error.relatedMessageId)) throw new DemoError('UNCORRELATED_ERROR', 'protocol error lacks current command correlation');
            if (error.code === ProtocolErrorCode.PERSISTENCE_BACKPRESSURE && Number.isInteger(error.retryAfterTicks) && error.retryAfterTicks > 0 && error.retryAfterTicks <= 200 && pending.messageIds.length < 3) {
              pending.retryAt = this.clock() + error.retryAfterTicks * 50;
              this.log({ type: 'backpressure', retryAfterTicks: error.retryAfterTicks });
            } else throw new DemoError('PROTOCOL_ERROR', `protocol error code=${error.code}`);
          } else if (body.case === 'percept') {
            if (body.value.kind === PerceptKind.LEASE_TERMINATED) {
              const termination = decodeDemoBinary(LeaseTerminatedPayloadSchema, body.value.payload);
              if (termination.bodyId === 0n || !TERMINATION_REASONS.has(termination.reason) || termination.conflictingEntityId === 0n) throw new DemoError('INVALID_PERCEPT', 'invalid lease termination');
              if (termination.bodyId === this.view.selfBodyId) {
                terminationHint = termination.reason === LeaseTerminationReason.BLOCKED
                  ? { reason: 'BLOCKED', conflictingEntityId: termination.conflictingEntityId } : undefined;
                this.log({ type: 'lease-terminated', selfBodyId: termination.bodyId.toString(), reason: termination.reason, conflictingEntityId: termination.conflictingEntityId?.toString() });
                decide();
                tick();
              }
            } else if (!PERCEPT_KINDS.has(body.value.kind)) throw new DemoError('INVALID_PERCEPT', 'invalid percept kind');
          }
        } catch (error) { void finish(error); }
      }, { signal: listeners.signal });
      if (signal.aborted) stop();
    });
  }
}
