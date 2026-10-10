import assert from 'node:assert/strict';
import test from 'node:test';
import { create, toBinary } from '@bufbuild/protobuf';
import {
  CommandKind, DemoActivityPhase as Phase, DemoActivityReason as Reason, DemoActivitySnapshotSchema,
  DemoParticipantAvailability as Availability, WorldSnapshotBodyProtoSchema, WorldSnapshotDeltaProtoSchema,
} from '@aigent-place/protocol';
import { createActivityPolicy } from '../src/activity-policy.js';
import { SnapshotView } from '../src/demo-observation.js';
import { parseOptions } from '../scripts/demo.mjs';
import { body, mockWorld, startDemo } from './demo-fixture.mjs';

const rules = { innerMinMm: 1800, innerMaxMm: 2200, separateMm: 5500, minTravelMm: 1000,
  minContributionMm: 1000, dwellTicks: 8, completeHoldTicks: 20, recoveryHoldTicks: 20, phaseTimeoutTicks: 400 };
const vector = (xMm, zMm = 0n) => ({ xMm, yMm: 0n, zMm });
function activity(phase = Phase.READY, overrides = {}) {
  const movement = [Phase.SEPARATE, Phase.REGROUP, Phase.COMPLETE].includes(phase);
  const suspended = phase === Phase.SUSPENDED;
  const recentTransitions = suspended ? [{ id: 1n, tick: 1n, from: Phase.READY, to: phase, reason: Reason.NO_PROGRESS, resetId: 1n }]
    : [Phase.SEPARATE, Phase.REGROUP, Phase.COMPLETE].slice(0, movement ? phase - 1 : 0).map((to, index) => ({
      id: BigInt(index + 1), tick: BigInt(index + 1), from: index ? to - 1 : Phase.READY, to, reason: Reason.NORMAL,
      completedRounds: to === Phase.COMPLETE ? 1n : 0n,
    }));
  const phaseStartedTick = recentTransitions.at(-1)?.tick ?? 0n;
  return create(DemoActivitySnapshotSchema, {
    version: 1, runId: new Uint8Array(16).fill(1), phase, observedTick: 20n, phaseStartedTick,
    resetId: suspended ? 1n : 0n, completedRounds: phase === Phase.COMPLETE ? 1n : 0n,
    transitionId: BigInt(recentTransitions.length), recentTransitions, reason: suspended ? Reason.NO_PROGRESS : Reason.NORMAL,
    rules, ...(suspended ? {} : { formationCenterMm: vector(0n), formationAxisMm: vector(1000n) }),
    ...(movement ? { creditStartedTick: phase === Phase.COMPLETE ? 2n : phaseStartedTick } : {}),
    dwellTicks: phase === Phase.COMPLETE ? 8 : 0,
    participants: [1n, 2n].map((bodyId, index) => ({ bodyId, availability: Availability.AVAILABLE,
      ...(movement ? { phaseStartPositionMm: vector(index ? 3250n : -3250n) } : {}),
      ...(phase === Phase.COMPLETE ? { travelMm: 1000, contributionMm: 2250, earnedTick: 2n } : {}),
    })), ...overrides,
  });
}
const observation = (phase, ownX = 1000n, selfBodyId = 2n, overrides = {}) => ({ selfBodyId,
  bodies: new Map([[1n, body(1n, -1000n)], [2n, body(2n, ownX)]]), demoActivity: activity(phase, overrides) });
const full = (demoActivity, bodies = [body(1n, -1000n), body(2n, 1000n)], baselineId = 1n) => ({ baselineId,
  payload: toBinary(WorldSnapshotBodyProtoSchema, create(WorldSnapshotBodyProtoSchema, { version: 1, tick: 20n,
    generationDigest: new Uint8Array(32), bodies, selfBodyId: 2n, demoActivity })) });
const delta = overrides => ({ baselineId: 1n, payload: toBinary(WorldSnapshotDeltaProtoSchema, create(WorldSnapshotDeltaProtoSchema,
  { version: 1, generationDigest: new Uint8Array(32), selfBodyId: 2n, ...overrides })) });

test('activity CLI is optional, requires fresh two-body assertion and excludes wide mode', () => {
  const ordinary = ['--role', 'runner', '--fresh-two-body'];
  assert.equal(parseOptions(ordinary, {}).activity, undefined);
  assert.equal(parseOptions([...ordinary, '--activity'], {}).activity, true);
  for (const args of [['--role', 'runner', '--activity'], [...ordinary, '--wide-plaza', '--activity'],
    [...ordinary, '--activity', '--activity'], [...ordinary, '--activity', 'true']]) assert.throws(() => parseOptions(args, {}), error => error.code === 'INVALID_OPTIONS');
});

test('one public state controls both roles; slot selects side and role selects speed only', () => {
  for (const role of ['runner', 'seeker']) {
    const policy = createActivityPolicy(role);
    const view = observation(Phase.SEPARATE);
    const decision = policy.decide(view, 0);
    assert.equal(decision.command.targetXMm, 3250n);
    assert.equal(decision.command.targetZMm, 0n);
    assert.equal(decision.command.speedMmPerS, role === 'runner' ? 500 : 900);
    view.selfBodyId = 1n;
    assert.equal(createActivityPolicy(role).decide(view, 0).command.targetXMm, -3250n);
  }
});

test('fixed center drives READY, unequal-speed phases and subsequent rounds without private promotion', () => {
  const policy = createActivityPolicy('runner');
  assert.equal(policy.decide(observation(Phase.READY, 3000n), 0).command.targetXMm, 1000n);
  const separate = observation(Phase.SEPARATE, 1000n, 2n, { formationCenterMm: vector(500n) });
  assert.equal(policy.decide(separate, 100).command.targetXMm, 3750n);
  separate.bodies.set(1n, body(1n, -900n));
  assert.equal(policy.decide(separate, 1000).command.targetXMm, 3750n, 'unequal peer movement cannot shift frozen center');
  const regroup = observation(Phase.REGROUP, 3750n, 2n, { formationCenterMm: vector(500n) });
  assert.equal(policy.decide(regroup, 2000).command.targetXMm, 1500n);
  assert.equal(policy.decide(observation(Phase.COMPLETE, 3000n), 3000).command.kind, 'stop');
  assert.equal(policy.decide(separate, 4000).command.targetXMm, 3750n);
  assert.equal(Object.hasOwn(policy.state, 'phase'), false);
  assert.equal(Object.hasOwn(policy.state, 'completions'), false);
});

test('arrived credited body waits five seconds with STOP and no renewed target or private completion', () => {
  const policy = createActivityPolicy('seeker');
  const view = observation(Phase.REGROUP);
  Object.assign(view.demoActivity.participants[1], { travelMm: 1000, contributionMm: 2250, earnedTick: 4n });
  assert.equal(policy.decide(view, 0).command.kind, 'stop');
  for (const now of [1000, 5000, 9000]) {
    const result = policy.decide(view, now);
    assert.deepEqual(result.command, { kind: 'stop' });
    assert.deepEqual(result.events, []);
    assert.equal(view.demoActivity.phase, Phase.REGROUP);
  }
});

test('SUSPENDED STOPs then READY recovers; gaps hold; absent and foreign state fail within five seconds', () => {
  const policy = createActivityPolicy('runner');
  assert.equal(policy.decide(observation(Phase.SUSPENDED), 0).command.kind, 'stop');
  assert.equal(policy.decide(observation(Phase.READY, 3000n), 1000).command.kind, 'move');
  const gap = observation(Phase.READY); gap.selfBodyId = undefined;
  assert.equal(policy.decide(gap, 2000).command.kind, 'hold');
  for (const foreign of [false, true]) {
    const missing = observation(Phase.READY);
    if (foreign) missing.demoActivity.participants.forEach(participant => { participant.bodyId += 10n; });
    else missing.demoActivity = undefined;
    policy.beginSession();
    assert.equal(policy.decide(missing, 0).command.kind, 'hold');
    assert.equal(policy.decide(missing, 4999).command.kind, 'hold');
    assert.throws(() => policy.decide(missing, 5000), error => error.code === 'ACTIVITY_UNAVAILABLE');
  }
});

test('bounded targets fail instead of silently clamping; typed block retries only the public target', () => {
  const policy = createActivityPolicy('runner');
  assert.throws(() => policy.decide(observation(Phase.SEPARATE, 1000n, 2n, { formationCenterMm: vector(5000n) }), 0), error => error.code === 'ACTIVITY_TARGET_UNSAFE');
  const view = observation(Phase.SEPARATE);
  const first = policy.decide(view, 0).command;
  const retried = policy.decide(view, 100, { reason: 'BLOCKED', conflictingEntityId: 1n });
  assert.equal(retried.command.targetXMm, first.targetXMm);
  assert.equal(retried.command.retryId, first.retryId + 1);
  assert.equal(retried.events[0].type, 'activity-retry');
  assert.throws(() => policy.decide(view, 200, 'BLOCKED'), error => error.code === 'ACTIVITY_MOVEMENT_FAILED');
});

test('observed own movement resets activity stall timing; stationary retry exhaustion is bounded', () => {
  const policy = createActivityPolicy('runner');
  const view = observation(Phase.SEPARATE);
  assert.equal(policy.decide(view, 0).command.retryId, 0);
  assert.equal(policy.decide(view, 7999).command.retryId, 0);
  assert.equal(policy.decide(view, 8000).command.retryId, 1);
  view.bodies.set(2n, body(2n, 1050n));
  assert.equal(policy.decide(view, 9000).command.retryId, 1);
  assert.equal(policy.decide(view, 17000).command.retryId, 2, 'new real progress clears the prior failure');
  assert.throws(() => policy.decide(view, 25000), error => error.code === 'ACTIVITY_MOVEMENT_FAILED');
});

test('body and activity observation replacement commits atomically and absence/reset clears activity', () => {
  const view = new SnapshotView();
  view.applyFull(full(activity()));
  const before = view.bodies; const beforeActivity = view.demoActivity;
  const invalid = activity(Phase.SEPARATE); invalid.phase = 99;
  assert.throws(() => view.applyDelta(delta({ demoActivity: invalid, modified: [body(2n, 2000n, 0n, 2n)] })), error => error.code === 'INVALID_OBSERVATION');
  assert.equal(view.bodies, before);
  assert.equal(view.demoActivity, beforeActivity);
  assert.throws(() => view.applyFull(full(invalid, [body(2n, 2000n, 0n, 2n)], 2n)), error => error.code === 'INVALID_OBSERVATION');
  assert.equal(view.baselineId, 1n); assert.equal(view.bodies, before);
  assert.throws(() => view.applyFull(full(activity(Phase.SEPARATE, { observedTick: 21n }), [body(2n)], 2n)), /activity tick/);
  view.applyDelta(delta({ demoActivity: activity(Phase.SEPARATE), modified: [body(2n, 2000n, 0n, 2n)] }));
  assert.equal(view.demoActivity.phase, Phase.SEPARATE); assert.equal(view.bodies.get(2n).positionMm.xMm, 2000n);
  view.applyDelta(delta({})); assert.equal(view.demoActivity, undefined);
  view.applyFull(full(activity(), [body(2n)], 2n));
  assert.equal(view.demoActivity.participants[0].bodyId, 1n, 'global activity does not fabricate omitted AOI body');
  view.reset(); assert.equal(view.demoActivity, undefined); assert.equal(view.bodies.size, 0);
});

test('actual activity CLI follows world phases, fixed slot targets, STOP and READY recovery', async () => {
  const peer = await mockWorld({ onHello(api) {
    api.conn.bodies = [body(1n, -1000n), body(2n, 1000n)];
    api.full({ tick: 20n, demoActivity: activity(Phase.SEPARATE) });
    api.later(() => api.delta({ demoActivity: activity(Phase.COMPLETE) }), 180);
    api.later(() => api.delta({ demoActivity: activity(Phase.SUSPENDED) }), 350);
    api.later(() => api.delta({ demoActivity: activity(Phase.READY), modified: [body(2n, 3000n, 0n, 2n)] }), 500);
  } });
  try {
    const result = await startDemo(peer.url, { args: ['--activity'], duration: 0.9 }).result;
    assert.equal(result.code, 0, result.output); assert.deepEqual(peer.state.errors, []);
    assert.ok(peer.state.commands.some(command => command.move?.targetXMm === 3250n));
    assert.ok(peer.state.commands.some(command => command.move?.targetXMm === 1000n));
    assert.ok(peer.state.commands.filter(command => command.command.kind === CommandKind.STOP).length >= 2);
    assert.equal(result.events.some(event => event.type === 'goal-complete'), false);
  } finally { await peer.close(); }
});

test('actual activity CLI absent and foreign activity fail clearly by the five-second setup bound', async () => {
  await Promise.all([false, true].map(async foreign => {
    const state = foreign ? activity(Phase.READY) : undefined;
    if (state) state.participants.forEach(participant => { participant.bodyId += 10n; });
    const peer = await mockWorld({ onHello(api) {
      api.full({ tick: 20n, demoActivity: state });
      for (const ms of [1000, 2000, 3000, 4000]) api.later(() => api.delta({ demoActivity: state }), ms);
    } });
    try {
      const result = await startDemo(peer.url, { args: ['--activity'], duration: 6 }).result;
      assert.equal(result.code, 1, result.output);
      const failure = result.events.find(event => event.type === 'failure');
      assert.equal(failure.code, 'ACTIVITY_UNAVAILABLE', result.output);
      assert.match(failure.message, foreign ? /self body is not a participant/ : /server --demo-activity/);
      assert.equal(peer.state.hellos.length, 1); assert.deepEqual(peer.state.errors, []);
    } finally { await peer.close(); }
  }));
});

test('actual activity CLI leaves a valid stopped arrival unleased for five seconds', async () => {
  const earned = activity(Phase.REGROUP);
  earned.participants.forEach(participant => Object.assign(participant, { travelMm: 1000, contributionMm: 2250, earnedTick: 2n }));
  const peer = await mockWorld({ onHello(api) {
    api.conn.bodies = [body(1n, -1000n), body(2n, 1000n)];
    api.full({ tick: 20n, demoActivity: earned });
    for (const ms of [1000, 2000, 3000, 4000, 5000]) api.later(() => api.delta({ demoActivity: earned }), ms);
  } });
  try {
    const result = await startDemo(peer.url, { args: ['--activity'], duration: 5.3 }).result;
    assert.equal(result.code, 0, result.output);
    const commands = peer.state.commands;
    assert.equal(commands.filter(command => command.move).length, 1, 'only initial body bootstrap can MOVE');
    const stops = commands.filter(command => command.command.kind === CommandKind.STOP);
    assert.equal(stops.length, 2, 'arrival STOP plus independent shutdown STOP; no renewal');
    assert.ok(stops[1].receivedAt - stops[0].receivedAt >= 5000, 'arrival holds more than five seconds');
    assert.deepEqual(peer.state.errors, []);
  } finally { await peer.close(); }
});
