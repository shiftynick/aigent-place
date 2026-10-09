import assert from 'node:assert/strict';
import test from 'node:test';
import { createPolicy } from '../src/demo-policy.js';
import { DemoError } from '../src/demo-observation.js';

const body = (entityId, point) => ({ entityId, revision: 1n, positionMm: { xMm: BigInt(point[0]), yMm: 0n, zMm: BigInt(point[1]) } });
const observe = (own = [0, 0], peer = [6_000, 0]) => ({ selfBodyId: 2n, bodies: new Map([[2n, body(2n, own)], [1n, body(1n, peer)]]) });
const terrain = () => ({ reason: 'BLOCKED' });
const entity = () => ({ reason: 'BLOCKED', conflictingEntityId: 1n });
const wide = role => createPolicy(role, 'wide-plaza');
const fatal = error => error instanceof DemoError && error.code === 'WIDE_MOVEMENT_FAILED' && error.retryable === false
  && /--demo-plaza/.test(error.message) && /--wide-plaza/.test(error.message) && /target/.test(error.message);

test('wide profile chooses all four long rectangle legs from actual arrival and dwell', () => {
  const policy = wide('runner');
  let own = [0, 0], now = 0;
  const corners = [[6_000, -4_000], [6_000, 4_000], [-6_000, 4_000], [-6_000, -4_000]];
  for (const corner of corners) {
    const command = policy.decide(observe(own, [-8_000, 8_000]), now).command;
    assert.deepEqual([Number(command.targetXMm), Number(command.targetZMm)], corner);
    assert.equal(command.speedMmPerS, 500);
    assert.equal(policy.decide(observe(own, [-8_000, 8_000]), now + 500).events.some(event => event.type === 'goal-complete'), false);
    own = corner;
    assert.equal(policy.decide(observe(own, [-8_000, 8_000]), now + 1_000).command.kind, 'stop');
    assert.equal(policy.decide(observe(own, [-8_000, 8_000]), now + 1_599).events.some(event => event.type === 'goal-complete'), false);
    assert.equal(policy.decide(observe(own, [-8_000, 8_000]), now + 1_600).events.some(event => event.type === 'goal-complete'), true);
    now += 1_700;
  }
  assert.equal(policy.state.completions, 4);
  assert.throws(() => createPolicy('runner', 'guessed-world'), /preset/);
});

test('wide meeting needs far separation, own travel and the currently observed peer', () => {
  const policy = wide('seeker');
  assert.equal(policy.decide(observe(), 0).command.targetXMm, 6_000n);
  assert.equal(policy.decide(observe([4_500, 0]), 5_000).command.kind, 'stop');
  assert.equal(policy.decide(observe([4_500, 0]), 5_399).events.some(event => event.type === 'goal-complete'), false);
  const met = policy.decide(observe([4_500, 0]), 5_400).events.find(event => event.type === 'goal-complete');
  assert.ok(met, 'current-peer arrival and 400ms dwell must produce a meeting completion');
  assert.equal(met.goalKind, 'meet');
  assert.equal(met.distanceMm, 1_500);
  assert.equal(met.ownTravelMm, 4_500);
  assert.equal(met.maxSeparationMm, 6_000);
  assert.equal(policy.state.goalKind, 'retreat');

  const nearby = wide('seeker');
  assert.equal(nearby.decide(observe([0, 0], [4_000, 0]), 0).events[0].goalKind, 'retreat');
  const fixed = wide('seeker');
  fixed.decide(observe(), 0);
  fixed.decide(observe([0, 0], [1_500, 0]), 1_000);
  assert.equal(fixed.decide(observe([0, 0], [1_500, 0]), 2_000).events.some(event => event.type === 'goal-complete'), false);
  const shortOwn = wide('seeker');
  shortOwn.decide(observe(), 0);
  shortOwn.decide(observe([500, 0], [2_000, 0]), 1_000);
  assert.equal(shortOwn.state.goalKind, 'retreat', '500mm own travel cannot qualify the wide meeting');
});

test('wide runner diverts around a stationary peer instead of crossing an unleased body', () => {
  const policy = wide('runner');
  const peer = [3_000, -2_000]; // Lies exactly on the initial 6m/-4m route.
  let own = [0, 0], travel = 0, closest = Infinity;
  const first = policy.decide(observe(own, peer), 0);
  assert.deepEqual([Number(first.command.targetXMm), Number(first.command.targetZMm)], [6_000, 4_000]);
  assert.equal(first.events.some(event => event.type === 'goal-complete'), false);
  // This peer is 3000/sqrt(13) = 832.05mm from the original route.
  // It does not intersect the centre line, but is inside the1500mm margin.
  const nearRoute = wide('runner').decide(observe([0, 0], [3_000, -1_000]), 0).command;
  assert.deepEqual([Number(nearRoute.targetXMm), Number(nearRoute.targetZMm)], [6_000, 4_000]);
  for (let now = 100; now <= 20_000; now += 100) {
    const decision = policy.decide(observe(own.map(Math.round), peer), now);
    if (decision.command.kind === 'move') {
      const target = [Number(decision.command.targetXMm), Number(decision.command.targetZMm)];
      const remaining = Math.hypot(target[0] - own[0], target[1] - own[1]);
      const step = Math.min(50, remaining);
      own = own.map((axis, index) => axis + (target[index] - axis) * step / remaining);
      travel += step;
    }
    closest = Math.min(closest, Math.hypot(own[0] - peer[0], own[1] - peer[1]));
  }
  assert.ok(travel >= 8_000, `owned observed test poses cover ${travel}mm`);
  assert.ok(closest >= 1_500, `commanded route clearance was ${closest}mm`);
  assert.deepEqual([Number(createPolicy('runner').decide(observe([0, 0], peer), 0).command.targetXMm),
    Number(createPolicy('runner').decide(observe([0, 0], peer), 0).command.targetZMm)], [2_200, -1_200]);
});

test('wide runner escapes a peer closing all inset legs without false waypoint completion', () => {
  const policy = wide('runner');
  const own = [6_000, 4_000], peer = [5_000, 3_000];
  const escaped = policy.decide(observe(own, peer), 0);
  const target = [Number(escaped.command.targetXMm), Number(escaped.command.targetZMm)];
  assert.equal(policy.state.goalKind, 'avoid-peer');
  assert.ok(target[0] > own[0] && target[1] > own[1]);
  assert.ok(target.every(axis => Math.abs(axis) <= 8_000));
  const resumed = policy.decide(observe(target, peer), 6_000);
  assert.equal(resumed.command.kind, 'move');
  assert.equal(policy.state.goalKind, 'waypoint');
  assert.equal(resumed.events.some(event => event.type === 'goal-complete'), false);
  assert.equal(policy.state.completions, 0);
});

test('wide runner rechecks its ongoing leg when the observed peer enters that route', () => {
  const policy = wide('runner');
  policy.decide(observe([0, 0], [-8_000, 8_000]), 0);
  const changed = policy.decide(observe([1_000, -667], [3_000, -2_000]), 2_000);
  assert.ok(changed.events.some(event => event.reason === 'observed-peer-on-route'));
  assert.deepEqual([Number(changed.command.targetXMm), Number(changed.command.targetZMm)], [6_000, 4_000]);
  assert.equal(changed.events.some(event => event.type === 'goal-complete'), false);
});

test('wide runner does not claim a clipped or peer-reentered escape is cleared', () => {
  const clipped = wide('runner');
  const corner = observe([8_000, 8_000], [7_000, 7_000]);
  assert.equal(clipped.decide(corner, 0).command.kind, 'stop');
  const waiting = clipped.decide(corner, 8_000);
  assert.equal(waiting.command.kind, 'stop');
  assert.equal(waiting.events.length, 0, 'unchanged blocked geometry does not thrash the goal log');
  assert.equal(clipped.state.completions, 0);
  assert.equal(clipped.decide(observe([8_000, 8_000], [0, 0]), 8_100).command.kind, 'move');

  const approached = wide('runner');
  const command = approached.decide(observe([6_000, 4_000], [5_000, 3_000]), 0).command;
  const arrival = [Number(command.targetXMm) - 50, Number(command.targetZMm) - 50];
  const stillClose = approached.decide(observe(arrival, arrival.map(axis => axis - 1_000)), 6_000);
  assert.equal(stillClose.events.some(event => event.type === 'avoidance-cleared'), false);
  assert.equal(stillClose.events.some(event => event.type === 'goal-complete'), false);
});

test('wide meeting cannot count penetration or a peer entering the too-close band', () => {
  for (const peer of [[900, 0], [1_100, 0]]) {
    const policy = wide('seeker');
    policy.decide(observe(), 0);
    policy.decide(observe([4_500, 0]), 5_000);
    const close = observe([4_500, 0], [4_500 + peer[0], peer[1]]);
    const decision = policy.decide(close, 5_500);
    assert.equal(decision.events.some(event => event.type === 'goal-complete'), false);
    assert.equal(policy.state.meetings, 0);
    assert.ok(['yield', 'retreat'].includes(policy.state.phase) || policy.state.goalKind === 'retreat');
  }
});

test('wide peer retargeting uses calmer observed displacement and preserves own pursuit progress', () => {
  const policy = wide('seeker');
  policy.decide(observe(), 0);
  assert.equal(policy.decide(observe([1_000, 0], [5_000, 1_000]), 1_000).events.some(event => event.reason === 'peer-moved'), false);
  const changed = policy.decide(observe([3_000, 0], [4_500, 2_000]), 3_000);
  assert.deepEqual([Number(changed.command.targetXMm), Number(changed.command.targetZMm)], [4_500, 2_000]);
  assert.equal(changed.events.find(event => event.reason === 'peer-moved').ownTravelMm, 3_000);
  assert.deepEqual(policy.state.goalStartPose, [0, 0]);
  const clamp = wide('seeker').decide(observe([0, 0], [9_000, -11_000]), 0).command;
  assert.deepEqual([Number(clamp.targetXMm), Number(clamp.targetZMm)], [8_000, -8_000]);
});

test('wide retreat rearms only after authoritative own travel and far separation', () => {
  const policy = wide('seeker');
  policy.decide(observe([1_400, 0], [0, 0]), 0);
  assert.equal(policy.state.goalKind, 'retreat');
  const target = [...policy.state.target];
  assert.ok(Math.abs(target[0]) <= 8_000 && Math.abs(target[1]) <= 8_000);
  assert.equal(policy.decide(observe([1_400, 0], [0, 0]), 6_000).events.some(event => event.type === 'goal-complete'), false);
  policy.decide(observe(target, [0, 0]), 7_000);
  const rearmed = policy.decide(observe(target, [0, 0]), 7_600);
  assert.ok(rearmed.events.some(event => event.type === 'goal-complete' && event.goalKind === 'retreat' && event.ownTravelMm >= 1_000));
  assert.equal(policy.state.goalKind, 'meet');
  assert.deepEqual([Number(rearmed.command.targetXMm), Number(rearmed.command.targetZMm)], [0, 0]);
});

test('wide seeker retreat chooses a clear segment around a stationary or newly observed peer', () => {
  const policy = wide('seeker');
  const escaped = policy.decide(observe([6_000, 4_000], [4_500, 4_000]), 0);
  // The geometrically farthest corner (-6000,-4000) passes832.05mm from
  // the peer. The safe vertical leg has a constant1500mm horizontal gap.
  assert.deepEqual([Number(escaped.command.targetXMm), Number(escaped.command.targetZMm)], [6_000, -4_000]);
  assert.equal(escaped.events.some(event => event.type === 'goal-complete'), false);
  const changed = policy.decide(observe([6_000, 0], [6_000, -2_000]), 4_500);
  assert.ok(changed.events.some(event => event.reason === 'observed-peer-on-retreat'));
  assert.deepEqual([Number(changed.command.targetXMm), Number(changed.command.targetZMm)], [-6_000, 4_000]);
  assert.equal(changed.events.some(event => event.type === 'goal-complete'), false);
  const outward = wide('seeker').decide(observe([6_000, 4_000], [4_900, 2_900]), 0).command;
  assert.ok(outward.targetXMm > 6_000n && outward.targetZMm > 4_000n);
  assert.ok(outward.targetXMm <= 8_000n && outward.targetZMm <= 8_000n);
  const clipped = wide('seeker');
  const corner = observe([8_000, 8_000], [6_900, 6_900]);
  assert.equal(clipped.decide(corner, 0).command.kind, 'stop');
  assert.equal(clipped.decide(corner, 8_000).events.length, 0);
  assert.equal(clipped.decide(observe([8_000, 8_000], [0, 0]), 8_100).command.kind, 'move');
});

test('wide retreat never chooses an anchor whose arrival cannot meet its own-travel requirement', () => {
  const policy = wide('seeker');
  assert.equal(policy.decide(observe([5_100, -4_000], [5_100, -3_000]), 0).command.kind, 'stop');
  const clear = policy.decide(observe([5_100, -4_000], [-6_000, 4_000]), 100);
  assert.deepEqual([Number(clear.command.targetXMm), Number(clear.command.targetZMm)], [6_000, 4_000],
    'the 900mm-distant corner would strand retreat below its 1000mm own-travel requirement');
});

test('wide terrain BLOCKED is consumed promptly once, then the second failure is typed fatal', () => {
  const policy = wide('runner');
  policy.decide(observe(), 0);
  const first = policy.decide(observe(), 100, terrain());
  assert.ok(first.events.some(event => event.type === 'wide-movement-failure' && event.failures === 1));
  assert.notEqual(first.command.targetZMm, -4_000n);
  assert.equal(policy.decide(observe(), 200).events.some(event => event.type === 'wide-movement-failure'), false);
  assert.throws(() => policy.decide(observe(), 300, terrain()), fatal);
});

test('wide observed stalls and mixed typed stalls exhaust the same two-failure budget', () => {
  for (const typedFirst of [false, true]) {
    const policy = wide('runner');
    policy.decide(observe(), 0);
    const firstAt = typedFirst ? 100 : 8_000;
    const first = policy.decide(observe(), firstAt, typedFirst ? terrain() : undefined);
    assert.ok(first.events.some(event => event.type === 'wide-movement-failure' && event.failures === 1));
    assert.throws(() => policy.decide(observe(), firstAt + 8_000), fatal);
  }
});

test('wide own observed progress resets the watchdog, peer retargets do not', () => {
  const runner = wide('runner');
  runner.decide(observe(), 0);
  runner.decide(observe([100, 0]), 7_000);
  assert.equal(runner.decide(observe([100, 0]), 14_999).events.some(event => event.type === 'wide-movement-failure'), false);
  assert.equal(runner.decide(observe([100, 0]), 15_000).events.find(event => event.type === 'wide-movement-failure').failures, 1);
  const seeker = wide('seeker');
  seeker.decide(observe(), 0);
  let failed;
  for (let now = 1_000; now <= 8_000; now += 1_000) {
    const result = seeker.decide(observe([0, 0], [6_000, now % 2_000 ? 3_000 : -3_000]), now);
    failed ??= result.events.find(event => event.type === 'wide-movement-failure');
  }
  assert.equal(failed?.failures, 1);
  const avoidingRunner = wide('runner');
  avoidingRunner.decide(observe([0, 0], [-8_000, 8_000]), 0);
  let avoidanceFailure;
  for (let now = 1_000; now <= 8_000; now += 1_000) {
    const result = avoidingRunner.decide(observe([0, 0], [3_000, now % 2_000 ? -2_000 : 2_000]), now);
    avoidanceFailure ??= result.events.find(event => event.type === 'wide-movement-failure');
  }
  assert.equal(avoidanceFailure?.failures, 1, 'peer-induced route changes cannot hide a stationary runner');
  const retreatingSeeker = wide('seeker');
  let retreatCommand = retreatingSeeker.decide(observe([0, 0], [-1_500, 0]), 0).command;
  let retreatFailure;
  for (let now = 1_000; now <= 8_000; now += 1_000) {
    const peerOnRoute = [Number(retreatCommand.targetXMm) / 2, Number(retreatCommand.targetZMm) / 2];
    const result = retreatingSeeker.decide(observe([0, 0], peerOnRoute), now);
    retreatCommand = result.command;
    retreatFailure ??= result.events.find(event => event.type === 'wide-movement-failure');
  }
  assert.equal(retreatFailure?.failures, 1, 'peer-induced retreat changes cannot hide a stationary seeker');
});

test('wide entity obstruction retains avoidance without being charged as terrain or watchdog failure', () => {
  const policy = wide('runner');
  const close = observe([0, 0], [1_500, 0]);
  policy.decide(close, 0);
  const blocked = policy.decide(close, 100, entity());
  assert.ok(blocked.events.some(event => event.type === 'replan' && event.reason === 'entity-blocked'));
  assert.equal(blocked.events.some(event => event.type === 'wide-movement-failure'), false);
  assert.equal(policy.decide(close, 8_100).events.some(event => event.type === 'wide-movement-failure'), false);
  policy.decide(observe(), 8_200); // Observed blocker leaves the physical contact neighborhood.
  const unknownStall = policy.decide(observe(), 16_200);
  assert.equal(unknownStall.events.find(event => event.type === 'wide-movement-failure')?.failures, 1);
  for (const movedPeer of [false, true]) {
    const knownOther = wide('runner');
    const original = observe([0, 0], [3_000, 2_000]);
    knownOther.decide(original, 0);
    knownOther.decide(original, 100, { reason: 'BLOCKED', conflictingEntityId: 99n });
    const current = movedPeer ? observe([0, 0], [-3_000, 2_000]) : original;
    if (movedPeer) knownOther.decide(current, 200);
    const retained = knownOther.decide(current, 8_100);
    assert.equal(retained.events.some(event => event.type === 'wide-movement-failure'), false,
      'geometric target changes cannot erase an explicit unobserved entity blocker');
  }
});

test('wide missing observations suspend stall timing without clearing failures; a new session resets them', () => {
  const policy = wide('runner');
  policy.decide(observe(), 0);
  policy.decide(observe(), 100, terrain());
  policy.decide({ selfBodyId: undefined, bodies: new Map() }, 200);
  let restored;
  assert.doesNotThrow(() => { restored = policy.decide(observe(), 100_000); },
    'restored observations must not turn an unobserved gap into a movement failure');
  assert.equal(restored.events.some(event => event.type === 'wide-movement-failure'), false);
  assert.throws(() => policy.decide(observe(), 100_100, terrain()), fatal);
  policy.beginSession();
  assert.equal(policy.decide(observe(), 100_200, terrain()).events.find(event => event.type === 'wide-movement-failure')?.failures, 1);
});
