import assert from 'node:assert/strict';
import test from 'node:test';
import { create, toBinary } from '@bufbuild/protobuf';
import { CommandKind, LeaseTerminatedPayloadSchema, LeaseTerminationReason, PerceptKind } from '@aigent-place/protocol';
import { parseOptions } from '../scripts/demo.mjs';
import { mockWorld, startDemo } from './demo-fixture.mjs';

const blocked = (api, conflictingEntityId) => api.send({ case: 'percept', value: { kind: PerceptKind.LEASE_TERMINATED,
  payload: toBinary(LeaseTerminatedPayloadSchema, create(LeaseTerminatedPayloadSchema, { bodyId: 2n, reason: LeaseTerminationReason.BLOCKED, conflictingEntityId })) } });

test('wide CLI flag is explicit boolean, duplicate checked and keeps compact options unchanged', () => {
  const ordinary = ['--role', 'runner', '--fresh-two-body'];
  assert.equal(parseOptions(ordinary, {}).preset, undefined);
  assert.equal(parseOptions([...ordinary, '--wide-plaza'], {}).preset, 'wide-plaza');
  assert.throws(() => parseOptions([...ordinary, '--wide-plaza', '--wide-plaza'], {}), /duplicate/);
  assert.throws(() => parseOptions([...ordinary, '--wide-plaza', 'false'], {}), /unknown/);
});

test('actual wide CLI forwards the profile through the root command and independently STOPs', async () => {
  const peer = await mockWorld();
  try {
    const result = await startDemo(peer.url, { rootCommand: true, args: ['--wide-plaza'] }).result;
    assert.equal(result.code, 0, result.output);
    assert.equal(result.signal, null);
    assert.deepEqual(peer.state.errors, []);
    assert.equal(peer.state.commands[1].move.targetXMm, 6_000n);
    assert.equal(peer.state.commands[1].move.targetZMm, -4_000n);
    assert.equal(peer.state.commands.at(-1).command.kind, CommandKind.STOP);
  } finally { await peer.close(); }
});

test('actual wide CLI second terrain failure exits loudly nonretryably and closes its owned socket', async () => {
  const peer = await mockWorld({ onCommand(item) {
    item.result();
    if (item.move && item.command.metadata.sequence > 1n) item.later(() => blocked(item), 20);
  } });
  try {
    const result = await startDemo(peer.url, { duration: 3, args: ['--wide-plaza'] }).result;
    assert.equal(result.signal, null, result.output);
    assert.equal(result.code, 1, result.output);
    const error = result.events.find(event => event.type === 'failure');
    assert.equal(error.code, 'WIDE_MOVEMENT_FAILED');
    assert.match(error.message, /--demo-plaza.*--wide-plaza/);
    assert.match(error.message, /target.*2 qualifying/);
    assert.doesNotMatch(error.message, /server (is|advertised)|profile mismatch/);
    assert.equal(peer.state.hellos.length, 1);
    assert.equal(peer.state.commands.length, 3, 'bootstrap plus exactly two failed goal commands');
    assert.equal(result.events.filter(event => event.type === 'reconnect').length, 0);
    assert.ok(peer.state.closed > 0);
    assert.deepEqual(peer.state.errors, []);
  } finally { await peer.close(); }
});

test('actual wide CLI keeps entity BLOCKED percepts out of its terrain failure budget', async () => {
  const peer = await mockWorld({ onCommand(item) {
    item.result();
    if (item.move && item.command.metadata.sequence > 1n) item.later(() => blocked(item,
      item.command.metadata.sequence <= 3n ? 1n : undefined), 20);
  } });
  try {
    const result = await startDemo(peer.url, { duration: 3, args: ['--wide-plaza'] }).result;
    assert.equal(result.code, 1, result.output);
    assert.equal(result.signal, null);
    assert.equal(peer.state.commands.length, 5, 'two entity avoidances precede the two distinct non-entity failures');
    assert.equal(result.events.filter(event => event.type === 'replan' && event.reason === 'entity-blocked').length, 2);
    assert.equal(result.events.filter(event => event.type === 'wide-movement-failure').length, 1);
    assert.ok(result.events.some(event => event.type === 'failure' && event.code === 'WIDE_MOVEMENT_FAILED'));
    assert.equal(peer.state.hellos.length, 1);
    assert.ok(peer.state.closed > 0);
    assert.deepEqual(peer.state.errors, []);
  } finally { await peer.close(); }
});

test('actual wide CLI renews long-leg leases with fresh sequence and key while keeping the physical target', async () => {
  const peer = await mockWorld();
  try {
    const result = await startDemo(peer.url, { duration: 4.1, args: ['--wide-plaza'] }).result;
    assert.equal(result.code, 0, result.output);
    const moves = peer.state.commands.filter(item => item.move?.targetXMm === 6_000n);
    assert.equal(moves.length, 2, result.output);
    assert.deepEqual(moves[0].move, moves[1].move);
    assert.ok(moves[1].receivedAt - moves[0].receivedAt >= 2_900);
    assert.equal(moves[1].command.metadata.sequence, moves[0].command.metadata.sequence + 1n);
    assert.notDeepEqual(moves[1].command.metadata.idempotencyKey, moves[0].command.metadata.idempotencyKey);
    assert.equal(peer.state.commands.at(-1).command.kind, CommandKind.STOP);
    assert.deepEqual(peer.state.errors, []);
  } finally { await peer.close(); }
});

test('wide failure budget survives in-band resync but resets for a fresh connection epoch', async () => {
  for (const reconnect of [false, true]) {
    let recoveryTriggered = false;
    const peer = await mockWorld({
      onCommand(item) {
        item.result();
        if (item.index === 0 && item.command.metadata.sequence === 2n) item.later(() => blocked(item), 20);
        else if (item.index === 0 && item.command.metadata.sequence === 3n && !recoveryTriggered) {
          recoveryTriggered = true;
          if (reconnect) item.later(item.disconnect, 20);
          else item.send({ case: 'snapshotResyncRequired', value: { reason: 5 } });
        } else if (item.index === 1 && item.move && item.command.metadata.sequence === 1n) item.later(() => blocked(item), 20);
      },
      onResync(api) { api.full(); api.later(() => blocked(api), 20); },
    });
    try {
      const result = await startDemo(peer.url, { duration: 1.2, args: ['--wide-plaza'] }).result;
      assert.equal(result.signal, null, result.output);
      assert.equal(recoveryTriggered, true);
      assert.equal(result.code, reconnect ? 0 : 1, result.output);
      assert.equal(peer.state.hellos.length, reconnect ? 2 : 1);
      assert.deepEqual(peer.state.errors, []);
      if (reconnect) assert.equal(result.events.filter(event => event.type === 'failure').length, 0);
      else assert.ok(result.events.some(event => event.code === 'WIDE_MOVEMENT_FAILED'));
    } finally { await peer.close(); }
  }
});
