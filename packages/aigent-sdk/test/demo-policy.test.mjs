import assert from 'node:assert/strict';
import test from 'node:test';
import { createPolicy } from '../src/demo-policy.js';

const body = (entityId, x, z) => ({ entityId, revision: 1n, positionMm: { xMm: BigInt(x), yMm: 0n, zMm: BigInt(z) } });
const observation = (own = [0, 0], peer = [5_000, 0], selfBodyId = 2n) => ({ selfBodyId, bodies: new Map([[2n, body(2n, ...own)], [1n, body(1n, ...peer)]]) });

test('stationary seeker never recounts nearby runner movement as fresh meetings', () => {
  const policy = createPolicy('seeker');
  const peerRoute = [[0, 0], [2_000, 0], [1_000, 1_000]];
  const events = [];
  for (let now = 0; now <= 90_000; now += 100) {
    events.push(...policy.decide(observation([1_457, 235], peerRoute[Math.floor(now / 3_000) % peerRoute.length]), now).events);
  }
  assert.equal(events.filter(event => event.type === 'goal-complete').length, 0,
    'a fixed authoritative own pose cannot complete a fresh pursuit or retreat');
  assert.ok(events.some(event => event.type === 'goal' && event.goalKind === 'retreat'), 'nearby cast must choose physical repositioning');
});

test('binding gates policy even with a sole or nearest apparent self', () => {
  const policy = createPolicy('runner');
  const view = observation();
  view.selfBodyId = undefined;
  assert.deepEqual(policy.decide(view, 0).command, { kind: 'hold' });
  assert.equal(policy.state.target, undefined);
  view.selfBodyId = 3n;
  assert.deepEqual(policy.decide(view, 1_000).command, { kind: 'hold' });
});

test('own spawn holds for the peer and restated binding chooses the correct own pose', () => {
  const policy = createPolicy('seeker');
  const view = observation([4_000, 0], [0, 0]);
  view.bodies.delete(1n);
  assert.equal(policy.decide(view, 0).command.kind, 'stop');
  view.bodies.set(1n, body(1n, 0, 0));
  const decision = policy.decide(view, 100);
  assert.equal(decision.command.kind, 'move');
  assert.deepEqual(decision.events[0].own, [4_000, 0]);
  assert.deepEqual(decision.events[0].peer, [0, 0]);
  assert.equal(decision.command.targetXMm, 0n);
});

test('runner transitions require authoritative arrival and dwell, never elapsed travel time', () => {
  const policy = createPolicy('runner');
  policy.decide(observation(), 0);
  const beforeArrival = policy.decide(observation([1_000, 0]), 6_000);
  assert.equal(policy.state.completions, 0);
  assert.equal(beforeArrival.command.kind, 'move');
  const arrival = policy.decide(observation([2_100, -1_200]), 6_100);
  assert.equal(arrival.command.kind, 'stop');
  assert.ok(arrival.events.some(event => event.type === 'arrive' && event.distanceMm === 100));
  assert.equal(policy.decide(observation([2_100, -1_200]), 7_200).events.length, 0);
  const afterDwell = policy.decide(observation([2_100, -1_200]), 7_300);
  const complete = afterDwell.events.find(event => event.type === 'goal-complete');
  assert.deepEqual(complete.own, [2_100, -1_200]);
  assert.equal(complete.completed, 1);
  assert.equal(afterDwell.command.targetZMm, 1_200n);
});

test('seeker replans from a changed peer position before any timer-driven completion', () => {
  const policy = createPolicy('seeker');
  const first = policy.decide(observation(), 0);
  assert.equal(first.command.targetXMm, 5_000n);
  const changed = policy.decide(observation([0, 0], [4_000, 2_000]), 200);
  assert.equal(changed.command.targetXMm, 4_000n);
  assert.equal(changed.command.targetZMm, 2_000n);
  assert.equal(changed.events[0].reason, 'peer-moved');
  assert.deepEqual(changed.events[0].peer, [4_000, 2_000]);
});

test('seeker meet tolerance requires fresh separation and own approach travel', () => {
  const policy = createPolicy('seeker');
  assert.equal(policy.decide(observation([0, 0], [2_000, 0]), 0).command.kind, 'move');
  const view = observation([500, 0], [2_000, 0]);
  assert.equal(policy.decide(view, 600).command.kind, 'stop');
  const complete = policy.decide(view, 1_800).events.find(event => event.type === 'goal-complete');
  assert.equal(complete.goalKind, 'meet');
  assert.equal(complete.ownTravelMm, 500);
  assert.equal(complete.maxSeparationMm, 2_000);
  assert.equal(complete.distanceMm, 1_500);
  assert.equal(policy.state.goalKind, 'retreat');
  const later = policy.decide(view, 60_000);
  assert.equal(later.events.some(event => event.type === 'goal-complete'), false);
  assert.equal(policy.state.meetings, 1);
});

test('runner approaching a stationary seeker cannot complete a fresh meeting', () => {
  const policy = createPolicy('seeker');
  policy.decide(observation([0, 0], [2_000, 0]), 0);
  const nearby = observation([0, 0], [1_500, 0]);
  policy.decide(nearby, 500);
  const later = policy.decide(nearby, 1_800);
  assert.equal(later.events.some(event => event.type === 'goal-complete'), false);
  assert.equal(policy.state.meetings, 0);
  assert.equal(policy.state.goalKind, 'retreat');
});

test('seeker retreat completes only observed travel and rearms a physically separate fresh pursuit', () => {
  const policy = createPolicy('seeker');
  const start = policy.decide(observation([1_400, 0], [0, 0]), 0);
  assert.equal(start.events[0].goalKind, 'retreat');
  assert.equal(start.command.targetXMm, 2_200n);
  assert.equal(start.command.targetZMm, -1_200n);
  assert.equal(policy.decide(observation([1_400, 0], [0, 0]), 1_300).events.some(event => event.type === 'goal-complete'), false);
  const arrived = observation([2_200, -1_100], [0, 0]);
  assert.equal(policy.decide(arrived, 1_400).command.kind, 'stop');
  const rearmed = policy.decide(arrived, 2_600);
  const retreat = rearmed.events.find(event => event.type === 'goal-complete');
  assert.equal(retreat.goalKind, 'retreat');
  assert.ok(retreat.ownTravelMm >= 400);
  assert.equal(policy.state.meetings, 0);
  assert.equal(policy.state.goalKind, 'meet');
  assert.equal(rearmed.command.targetXMm, 0n);
  const met = observation([1_400, -500], [0, 0]);
  assert.equal(policy.decide(met, 3_600).command.kind, 'stop');
  const complete = policy.decide(met, 4_800).events.find(event => event.type === 'goal-complete');
  assert.equal(complete.goalKind, 'meet');
  assert.ok(complete.ownTravelMm >= 300);
  assert.ok(complete.maxSeparationMm >= 1_800);
  assert.ok(complete.distanceMm <= 1_500);
  assert.equal(policy.state.meetings, 1);
});

test('close-peer yield resumes from observed separation instead of a timer', () => {
  const policy = createPolicy('seeker');
  assert.equal(policy.decide(observation([500, 0], [0, 0]), 0).command.kind, 'stop');
  assert.equal(policy.state.phase, 'yield');
  assert.equal(policy.decide(observation([500, 0], [0, 0]), 9_000).events.length, 0);
  const clear = policy.decide(observation([500, 0], [1_800, 0]), 9_100);
  assert.equal(clear.command.kind, 'move');
  assert.equal(clear.events[0].reason, 'peer-cleared');
});

test('position watchdog replans within ten seconds without any termination percept', () => {
  for (const role of ['runner', 'seeker']) {
    const policy = createPolicy(role);
    const first = policy.decide(observation(), 0);
    assert.equal(policy.decide(observation(), 6_999).events.length, 0);
    const stuck = policy.decide(observation(), 7_000);
    assert.ok(stuck.events.some(event => event.type === 'replan' && event.reason === 'position-watchdog' && event.stalledMs === 7_000));
    assert.notDeepEqual(stuck.command, first.command);
    assert.ok(Math.abs(Number(stuck.command.targetXMm)) <= 8_000 && Math.abs(Number(stuck.command.targetZMm)) <= 8_000);
  }
});

test('authoritative movement resets the watchdog and typed blockers can expedite recovery', () => {
  const policy = createPolicy('runner');
  policy.decide(observation(), 0);
  assert.equal(policy.decide(observation([100, 0]), 6_000).events.length, 0);
  assert.equal(policy.decide(observation([100, 0]), 6_999, 'BLOCKED').events.length, 0);
  const blocked = policy.decide(observation([100, 0]), 7_000, 'BLOCKED');
  assert.ok(blocked.events.some(event => event.type === 'replan' && event.reason === 'typed-blocked'));
});

test('moving peer retargets cannot hide a stationary own body from the position watchdog', () => {
  const policy = createPolicy('seeker');
  policy.decide(observation(), 0);
  const events = [];
  for (let now = 1_000; now <= 11_000; now += 1_000) {
    const decision = policy.decide(observation([0, 0], [now % 2_000 === 0 ? 5_000 : 6_000, 0]), now);
    events.push(...decision.events.map(event => ({ ...event, now })));
  }
  const replan = events.find(event => event.type === 'replan' && event.reason === 'position-watchdog');
  assert.ok(replan, 'peer movement must not reset authoritative own-position progress');
  assert.ok(replan.now <= 10_000);
});

test('seeker dwell cannot complete a meeting after the current peer leaves meet distance', () => {
  const policy = createPolicy('seeker');
  policy.decide(observation([0, 0], [2_000, 0]), 0);
  assert.equal(policy.decide(observation([500, 0], [2_000, 0]), 100).command.kind, 'stop');
  const moved = policy.decide(observation([500, 0], [2_400, 0]), 600);
  assert.equal(moved.command.kind, 'move', 'current peer distance must govern meeting dwell');
  const later = policy.decide(observation([500, 0], [2_400, 0]), 1_300);
  assert.equal(later.events.some(event => event.type === 'goal-complete'), false);
  assert.equal(policy.state.completions, 0);
});
