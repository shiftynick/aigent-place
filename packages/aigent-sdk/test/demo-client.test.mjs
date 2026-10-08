import assert from 'node:assert/strict';
import test from 'node:test';
import { CommandKind, CommandRejectionCode, ConnectionMode, PerceptKind, ProtocolErrorCode } from '@aigent-place/protocol';
import { parseOptions } from '../scripts/demo.mjs';
import { body, mockWorld, startDemo } from './demo-fixture.mjs';

async function scenario(options, runOptions, check) {
  const peer = await mockWorld(options);
  try {
    const result = await startDemo(peer.url, runOptions).result;
    assert.equal(result.signal, null, result.output);
    assert.deepEqual(peer.state.errors, [], result.output);
    await check(result, peer.state);
  } finally { await peer.close(); }
}

test('CLI requires an explicit fresh two-body cast and parses bounded role/URL/ID/duration', () => {
  assert.throws(() => parseOptions(['--role', 'runner']), /fresh journal/);
  assert.throws(() => parseOptions(['--role', 'runner', '--fresh-two-body', '--duration', 'Infinity']), /duration/);
  assert.throws(() => parseOptions(['--role', 'runner', '--fresh-two-body', '--role', 'seeker']), /duplicate/);
  const options = parseOptions(['--role', 'seeker', '--fresh-two-body', '--duration', '90'], { AIGENT_ID: 'explicit-peer', AIGENT_WS_URL: 'ws://127.0.0.1:9999/ws' });
  assert.deepEqual(options, { role: 'seeker', aigentId: 'explicit-peer', url: 'ws://127.0.0.1:9999/ws', durationMs: 90_000 });
});

test('actual CLI uses typed bounded MOVE and safely sequenced STOP on duration cleanup', async () => {
  await scenario({}, {}, (result, state) => {
    assert.equal(result.code, 0, result.output);
    assert.ok(state.closed > 0, result.output);
    assert.equal(state.commands[0].move.targetXMm, 0n, 'only bootstrap is identity-free');
    assert.ok(state.commands.some(item => item.move?.targetXMm === 2_200n));
    assert.equal(state.commands.at(-1).command.kind, CommandKind.STOP);
    assert.deepEqual(state.commands.map(item => item.command.metadata.sequence), [1n, 2n, 3n]);
    const goal = result.events.find(event => event.type === 'goal');
    assert.equal(goal.selfBodyId, '2');
    assert.deepEqual(goal.own, [0, 0]);
    assert.deepEqual(goal.peer, [5_000, 0]);
    assert.match(goal.wallTime, /^\d{4}-\d\d-\d\dT/);
    assert.ok(goal.elapsedMs >= 0);
    const adopted = result.events.findIndex(event => event.type === 'binding-adopted');
    assert.ok(adopted >= 0 && adopted < result.events.findIndex(event => event.type === 'goal'));
    assert.equal(result.events[adopted].selfBodyId, '2');
  });
});

test('actual root npm command forwards role, fresh-cast, URL, ID and duration flags into the CLI', async () => {
  await scenario({}, { rootCommand: true, id: 'root-flags-demo', env: { AIGENT_WS_URL: 'ws://127.0.0.1:1/unreachable', AIGENT_ID: 'wrong-env-id' } }, (result, state) => {
    assert.equal(result.code, 0, result.output);
    assert.equal(state.hellos.length, 1);
    assert.equal(new TextDecoder().decode(state.hellos[0].aigentId), 'root-flags-demo');
    assert.ok(result.events.some(event => event.role === 'runner' && event.type === 'goal'));
    assert.equal(state.commands.at(-1).command.kind, CommandKind.STOP);
  });
});

test('actual CLI holds through missing binding and uses field-provided self instead of first body', async () => {
  let beforeBindingCommands;
  await scenario({
    onHello(api) {
      api.conn.selfBodyId = undefined;
      api.conn.bodies = [body(1n), body(2n, 4_000n)];
      api.full();
      api.later(() => {
        beforeBindingCommands = api.state.commands.length;
        api.conn.selfBodyId = 2n;
        api.delta();
      }, 200);
    },
  }, { role: 'seeker' }, (result, state) => {
    assert.equal(result.code, 0, result.output);
    assert.equal(beforeBindingCommands, 1, 'unbound state may only bootstrap');
    const goal = result.events.find(event => event.type === 'goal');
    assert.equal(goal.selfBodyId, '2');
    assert.deepEqual(goal.own, [4_000, 0]);
    assert.deepEqual(goal.peer, [0, 0]);
    assert.equal(state.commands[1].move.targetXMm, 0n);
  });
});

test('actual CLI stops its spawned body while the peer has not spawned yet', async () => {
  await scenario({ onHello(api) { api.conn.bodies = [body(2n)]; api.full(); } }, {}, (result, state) => {
    assert.equal(result.code, 0, result.output);
    assert.ok(state.commands.slice(1).every(item => item.command.kind === CommandKind.STOP));
    assert.equal(result.events.filter(event => event.type === 'goal').length, 0);
  });
});

test('actual CLI rejects ambiguous cast and mismatched negotiated mode, then closes', async () => {
  await scenario({ onHello(api) { api.conn.bodies.push(body(3n)); api.full(); } }, {}, (result, state) => {
    assert.equal(result.code, 1, result.output);
    assert.ok(result.events.some(event => event.code === 'AMBIGUOUS_CAST'));
    assert.ok(state.closed > 0);
  });
  await scenario({ hello: { mode: ConnectionMode.SPECTATE_ONLY } }, {}, (result, state) => {
    assert.equal(result.code, 1, result.output);
    assert.ok(result.events.some(event => event.code === 'NEGOTIATION_FAILED'));
    assert.equal(state.commands.length, 0);
    assert.ok(state.closed > 0);
  });
});

test('malformed full and invalid delta recover in-band without installing data or guessing binding', async () => {
  let commandsWhileUnbound;
  await scenario({
    onHello(api) { api.full({ version: 9 }); },
    onResync(api) {
      if (api.state.resyncs === 1) {
        api.conn.selfBodyId = undefined;
        api.full();
        api.later(() => {
          commandsWhileUnbound = api.state.commands.length;
          api.conn.selfBodyId = 2n;
          api.delta();
          api.later(() => api.delta({ modified: [body(2n, 100_000_001n)] }), 100);
        }, 100);
      } else api.full();
    },
  }, { duration: 1 }, (result, state) => {
    assert.equal(result.code, 0, result.output);
    assert.equal(commandsWhileUnbound, 1, 'recovery holds all self-dependent decisions');
    assert.equal(state.resyncs, 2);
    assert.equal(result.events.filter(event => event.type === 'resync').length, 2);
    assert.ok(result.events.filter(event => event.type === 'goal').every(event => event.selfBodyId === '2' && event.own[0] === 0));
  });
});

test('server resync clears binding, requests full and resumes the exact known body', async () => {
  await scenario({
    onCommand(item) {
      item.result();
      if (item.command.metadata.sequence === 2n) item.send({ case: 'snapshotResyncRequired', value: { reason: 5 } });
    },
    onResync(api) { api.full(); },
  }, {}, (result, state) => {
    assert.equal(result.code, 0, result.output);
    assert.equal(state.resyncs, 1);
    assert.ok(result.events.some(event => event.type === 'resync'));
    assert.ok(result.events.filter(event => event.type === 'goal').every(event => event.selfBodyId === '2'));
  });
});

test('bounded timeout and backpressure retries preserve sequence/key/payload but use fresh message IDs', async () => {
  for (const mode of ['timeout', 'backpressure']) {
    await scenario({
      onCommand(item) {
        if (item.state.commands.length === 1) {
          if (mode === 'backpressure') item.send({ case: 'protocolError', value: { relatedMessageId: item.envelope.messageId, code: ProtocolErrorCode.PERSISTENCE_BACKPRESSURE, retryAfterTicks: 1 } });
        } else item.result();
      },
    }, { duration: mode === 'timeout' ? 2 : 0.7 }, (result, state) => {
      assert.equal(result.code, 0, result.output);
      const [first, replay] = state.commands;
      assert.deepEqual(first.command, replay.command);
      assert.notEqual(first.envelope.messageId, replay.envelope.messageId);
      assert.equal(state.commands[2].command.metadata.sequence, 2n);
      assert.ok(result.events.some(event => event.type === 'retry'));
    });
  }
});

test('actual CLI reconnect retries an unadmitted bootstrap in a fresh epoch before explicit binding', async () => {
  let run;
  let signalSent = false;
  const selfId = 9_007_199_254_740_993n;
  const unboundFulls = [];
  const peer = await mockWorld({
    onHello(api) {
      api.conn.selfBodyId = undefined;
      api.conn.bodies = [body(1n, 5_000n)];
      const publishUnbound = () => {
        if (api.conn.selfBodyId !== undefined) return;
        api.full();
        api.conn.baselineId += 1n;
        unboundFulls[api.conn.index] = (unboundFulls[api.conn.index] ?? 0) + 1;
      };
      publishUnbound();
      publishUnbound();
      const observe = () => { publishUnbound(); if (api.conn.selfBodyId === undefined) api.later(observe, 100); };
      api.later(observe, 100);
    },
    onCommand(item) {
      if (item.index === 0) {
        // Drop the first MOVE before admission; no body or binding is assigned.
        item.disconnect();
        return;
      }
      item.result();
      if (item.command.kind === CommandKind.MOVE && item.command.metadata.sequence === 1n) {
        item.conn.selfBodyId = selfId;
        item.conn.bodies.push(body(selfId, 1_000n));
        item.full();
      } else if (item.command.kind === CommandKind.MOVE && item.command.metadata.sequence === 2n) {
        item.later(() => { signalSent = true; run.child.kill('SIGTERM'); }, 20);
      }
    },
  });
  try {
    run = startDemo(peer.url, { duration: 8 });
    const result = await run.result;
    assert.equal(result.signal, null, result.output);
    assert.equal(result.code, 0, result.output);
    assert.deepEqual(peer.state.errors, [], result.output);
    const initial = peer.state.commands.find(item => item.index === 0);
    const resumed = peer.state.commands.filter(item => item.index === 1);
    assert.ok(resumed[0]?.move, `healthy reconnect never received a fresh bootstrap: ${result.output}`);
    assert.equal(peer.state.hellos.length, 2, result.output);
    assert.equal(signalSent, true, 'shutdown follows admission, binding and a real policy command');
    assert.ok(unboundFulls[1] >= 2, 'the new session starts with genuine unbound observations');
    for (const command of [initial, resumed[0]]) {
      assert.equal(command.command.metadata.sequence, 1n);
      assert.equal(command.move.targetXMm, 0n);
      assert.equal(command.move.targetZMm, 0n);
      assert.equal(command.move.speedMmPerS, 500);
    }
    assert.notDeepEqual(resumed[0].command.metadata.sessionEpoch, initial.command.metadata.sessionEpoch);
    assert.notDeepEqual(resumed[0].command.metadata.idempotencyKey, initial.command.metadata.idempotencyKey);
    assert.deepEqual(resumed.map(item => item.command.metadata.sequence), [1n, 2n, 3n]);
    assert.equal(resumed[1].move.targetXMm, 2_200n, 'self-dependent goal follows explicit binding');
    assert.equal(resumed[2].command.kind, CommandKind.STOP);
    const adopted = result.events.findIndex(event => event.type === 'binding-adopted');
    const goal = result.events.findIndex(event => event.type === 'goal');
    assert.ok(adopted >= 0 && adopted < goal);
    assert.equal(result.events[goal].selfBodyId, selfId.toString());
    assert.deepEqual(result.events[goal].own, [1_000, 0]);
    assert.ok(!result.events.some(event => event.code === 'BINDING_TIMEOUT'), result.output);
  } finally { await peer.close(); }
});

test('reconnect after adopted binding was cleared restores the same body without bootstrap, with sequence1 and new keys', async () => {
  await scenario({
    onCommand(item) {
      item.result();
      if (item.index === 0 && item.command.metadata.sequence === 2n) {
        item.conn.selfBodyId = undefined;
        item.conn.baselineId += 1n;
        item.full();
        item.later(item.disconnect, 20);
      }
    },
  }, { duration: 1.4 }, (result, state) => {
    assert.equal(result.code, 0, result.output);
    assert.equal(state.hellos.length, 2);
    const initial = state.commands.find(item => item.index === 0);
    const reconnected = state.commands.find(item => item.index === 1);
    assert.equal(reconnected.command.metadata.sequence, 1n);
    assert.equal(reconnected.move.targetXMm, 2_200n, 'an ever-adopted binding suppresses identity-free bootstrap');
    assert.equal(state.commands.filter(item => item.move?.targetXMm === 0n && item.move.targetZMm === 0n).length, 1);
    assert.notDeepEqual(reconnected.command.metadata.idempotencyKey, initial.command.metadata.idempotencyKey);
    assert.notDeepEqual(reconnected.command.metadata.sessionEpoch, initial.command.metadata.sessionEpoch);
    assert.ok(result.events.some(event => event.type === 'hello' && event.reconnectBinding === '2'));
    assert.equal(state.commands.at(-1).command.kind, CommandKind.STOP);
  });
});

test('reconnect refuses a changed self body instead of adopting a different cast member', async () => {
  await scenario({
    onHello(api) { if (api.conn.index > 0) api.conn.selfBodyId = 1n; api.full(); },
    onCommand(item) { item.result(); if (item.index === 0 && item.command.metadata.sequence === 2n) item.later(item.disconnect, 20); },
  }, { duration: 2 }, result => {
    assert.equal(result.code, 1, result.output);
    assert.ok(result.events.some(event => event.code === 'SELF_BODY_CHANGED'));
  });
});

test('correlated rejection and uncorrelated result are fatal and clean up the socket', async () => {
  for (const mode of ['rejection', 'wrong-correlation']) {
    await scenario({
      onCommand(item) {
        if (mode === 'rejection') item.result({ case: 'rejected', value: { code: CommandRejectionCode.INVALID_INTENT, message: 'seeded' } });
        else item.result(undefined, { sequence: 99n });
      },
    }, {}, (result, state) => {
      assert.equal(result.code, 1, result.output);
      assert.ok(result.events.some(event => event.code === (mode === 'rejection' ? 'COMMAND_REJECTED' : 'UNCORRELATED_RESULT')));
      assert.ok(state.closed > 0);
    });
  }
});

test('incoming envelope identity, direction and duplicate message IDs fail closed', async () => {
  for (const mode of ['identity', 'direction', 'duplicate']) {
    await scenario({
      onHello(api) {
        api.full();
        if (mode === 'direction') api.send({ case: 'snapshotResyncRequest', value: {} });
        else api.send({ case: 'percept', value: { kind: PerceptKind.RULESET_CHANGED, payload: new Uint8Array() } }, mode === 'identity' ? { connectionId: new Uint8Array([99]) } : { messageId: 1n });
      },
    }, {}, (result, state) => {
      assert.equal(result.code, 1, result.output);
      assert.ok(result.events.some(event => event.code === (mode === 'duplicate' ? 'DUPLICATE_MESSAGE' : 'INVALID_ENVELOPE')));
      assert.ok(state.closed > 0);
    });
  }
});

test('MOVE renewal waits three seconds and uses new sequence/key while preserving the target', async () => {
  await scenario({}, { duration: 4.1 }, (result, state) => {
    assert.equal(result.code, 0, result.output);
    const goalMoves = state.commands.filter(item => item.move?.targetXMm === 2_200n);
    assert.equal(goalMoves.length, 2, result.output);
    assert.ok(goalMoves[1].receivedAt - goalMoves[0].receivedAt >= 2_900, 'renewal must allow the one-second blocked window');
    assert.deepEqual(goalMoves[0].move, goalMoves[1].move);
    assert.equal(goalMoves[1].command.metadata.sequence, goalMoves[0].command.metadata.sequence + 1n);
    assert.notDeepEqual(goalMoves[1].command.metadata.idempotencyKey, goalMoves[0].command.metadata.idempotencyKey);
  });
});

test('shutdown with an unresolved command closes within its bound without skipping sequence', async () => {
  await scenario({ onCommand() {} }, {}, (result, state) => {
    assert.equal(result.code, 0, result.output);
    assert.equal(state.commands.length, 1, 'cannot issue STOP at an unconfirmed next sequence');
    assert.equal(state.commands[0].command.metadata.sequence, 1n);
    assert.ok(state.closed > 0);
  });
});

test('connection attempts stop after three reconnects on a closed port', async () => {
  const peer = await mockWorld();
  const url = peer.url;
  await peer.close();
  const result = await startDemo(url, { duration: 8 }).result;
  assert.equal(result.signal, null, result.output);
  assert.equal(result.code, 1, result.output);
  assert.equal(result.events.filter(event => event.type === 'reconnect').length, 3);
  assert.ok(result.events.some(event => event.type === 'failure' && event.code === 'SOCKET_ERROR'));
});

test('SIGTERM sends owned STOP and closes without waiting for the duration timer', async () => {
  let run;
  let signalSent = false;
  const peer = await mockWorld({ onCommand(item) {
    item.result();
    if (item.command.metadata.sequence === 2n) item.later(() => { signalSent = true; run.child.kill('SIGTERM'); }, 50);
  } });
  try {
    run = startDemo(peer.url, { duration: 8 });
    const result = await run.result;
    assert.equal(signalSent, true, 'signal follows a real negotiated goal command');
    assert.equal(result.signal, null, result.output);
    assert.equal(result.code, 0, result.output);
    assert.equal(peer.state.commands.at(-1).command.kind, CommandKind.STOP);
    assert.ok(peer.state.closed > 0);
    assert.deepEqual(peer.state.errors, []);
  } finally { await peer.close(); }
});

test('shutdown during cleared resync binding still sends STOP at the confirmed session sequence', async () => {
  let run;
  let signalSent = false;
  const peer = await mockWorld({
    onCommand(item) {
      item.result();
      if (item.command.metadata.sequence === 2n) item.send({ case: 'snapshotResyncRequired', value: { reason: 5 } });
    },
    onResync(api) {
      api.conn.selfBodyId = undefined;
      api.full();
      api.later(() => { signalSent = true; run.child.kill('SIGTERM'); }, 50);
    },
  });
  try {
    run = startDemo(peer.url, { duration: 8 });
    const result = await run.result;
    assert.equal(signalSent, true);
    assert.equal(result.signal, null, result.output);
    assert.equal(result.code, 0, result.output);
    assert.equal(peer.state.commands.at(-1).command.kind, CommandKind.STOP, 'cleanup must use known session sequence while goals stay unbound');
    assert.equal(peer.state.commands.at(-1).command.metadata.sequence, 3n);
    assert.deepEqual(peer.state.errors, []);
  } finally { await peer.close(); }
});
