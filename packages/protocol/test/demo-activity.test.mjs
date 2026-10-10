import assert from 'node:assert/strict';
import test from 'node:test';
import { create, fromBinary, toBinary } from '@bufbuild/protobuf';
import { BinaryWriter, WireType } from '@bufbuild/protobuf/wire';
import {
  DemoActivityPhase as Phase, DemoActivityReason as Reason, DemoActivitySnapshotSchema,
  DemoParticipantAvailability as Availability, validateDemoActivity,
} from '../src/index.js';

const MAX = 0xffffffffffffffffn;
const rules = { innerMinMm: 1800, innerMaxMm: 2200, separateMm: 5500, minTravelMm: 1000,
  minContributionMm: 1000, dwellTicks: 8, completeHoldTicks: 20, recoveryHoldTicks: 20, phaseTimeoutTicks: 400 };
const vector = (xMm, zMm = 0n) => ({ xMm, yMm: 0n, zMm });
const slots = () => [1n, 2n].map(bodyId => ({ bodyId, availability: Availability.AVAILABLE }));
const initial = overrides => create(DemoActivitySnapshotSchema, {
  version: 1, runId: new Uint8Array(16).fill(1), phase: Phase.READY, reason: Reason.NORMAL,
  participants: slots(), rules, ...overrides,
});
function moving(phase = Phase.REGROUP) {
  const recentTransitions = [
    { id: 1n, tick: 1n, from: Phase.READY, to: Phase.SEPARATE, reason: Reason.NORMAL },
    ...(phase === Phase.SEPARATE ? [] : [{ id: 2n, tick: 2n, from: Phase.SEPARATE, to: Phase.REGROUP, reason: Reason.NORMAL }]),
    ...(phase !== Phase.COMPLETE ? [] : [{ id: 3n, tick: 10n, from: Phase.REGROUP, to: Phase.COMPLETE, reason: Reason.NORMAL, completedRounds: 1n }]),
  ];
  return initial({ phase, observedTick: 12n, phaseStartedTick: phase === Phase.SEPARATE ? 1n : phase === Phase.COMPLETE ? 10n : 2n,
    transitionId: BigInt(recentTransitions.length), recentTransitions, completedRounds: phase === Phase.COMPLETE ? 1n : 0n,
    creditStartedTick: phase === Phase.SEPARATE ? 1n : 2n, formationCenterMm: vector(0n), formationAxisMm: vector(1000n),
    participants: slots().map((participant, index) => ({ ...participant, phaseStartPositionMm: vector(index ? 3250n : -3250n),
      travelMm: 1000, contributionMm: 2250, earnedTick: 8n })), dwellTicks: phase === Phase.COMPLETE ? 8 : 0 });
}

test('absence and generated values preserve identity; ordinary and credited phases validate', () => {
  assert.equal(validateDemoActivity(undefined), undefined);
  for (const value of [initial(), initial({ formationCenterMm: vector(0n), formationAxisMm: vector(1000n) }),
    moving(Phase.SEPARATE), moving(), moving(Phase.COMPLETE)]) {
    assert.equal(validateDemoActivity(value), value);
    const decoded = fromBinary(DemoActivitySnapshotSchema, toBinary(DemoActivitySnapshotSchema, value));
    assert.equal(validateDemoActivity(decoded), decoded);
  }
  assert.ok(moving(Phase.COMPLETE).participants[0].earnedTick < moving(Phase.COMPLETE).phaseStartedTick,
    'COMPLETE retains REGROUP proof origin instead of requiring fresh completion-entry movement');
});

test('unsupported, private and oversized data fails; additive protobuf fields remain compatible', () => {
  const cases = [null, {}, initial({ version: 2 }), initial({ phase: 99 }), initial({ reason: 0 }),
    initial({ runId: new Uint8Array(16) }), initial({ runId: new Uint8Array(15) }), initial({ rules: { ...rules, separateMm: 6500 } })];
  const privateState = initial(); privateState.participants[0].sessionEpoch = new Uint8Array([1]); cases.push(privateState);
  for (const value of cases) assert.throws(() => validateDemoActivity(value), TypeError);
  const wire = toBinary(DemoActivitySnapshotSchema, initial());
  const unknown = fromBinary(DemoActivitySnapshotSchema, new Uint8Array([...wire, 0xa0, 0x06, 0x01]));
  assert.equal(validateDemoActivity(unknown), unknown);
  assert.deepEqual(toBinary(DemoActivitySnapshotSchema, unknown), new Uint8Array([...wire, 0xa0, 0x06, 0x01]));
  const extra = new BinaryWriter().tag(100, WireType.LengthDelimited).bytes(new Uint8Array(2049)).finish();
  const large = fromBinary(DemoActivitySnapshotSchema, new Uint8Array([...wire, ...extra]));
  assert.throws(() => validateDemoActivity(large), /encoded size/);
});

test('counter, coordinate, slot, phase and proof counterexamples fail', () => {
  const edits = [
    value => { value.observedTick = MAX + 1n; },
    value => { value.phaseStartedTick = 13n; },
    value => { value.resetId = -1n; },
    value => { value.participants.reverse(); },
    value => { value.participants.pop(); },
    value => { value.participants[1].bodyId = 1n; },
    value => { value.participants[0].bodyId = 0n; },
    value => { value.participants[0].availability = Availability.DISCONNECTED; },
    value => { value.participants[0].travelMm = 1001; },
    value => { value.participants[0].contributionMm = -32001; },
    value => { value.participants[0].phaseStartPositionMm.xMm = 8001n; },
    value => { value.formationCenterMm.yMm = 100_000_001n; },
    value => { value.formationAxisMm.yMm = 1n; },
    value => { value.formationAxisMm.xMm = 997n; },
    value => { value.formationAxisMm = undefined; },
    value => { value.participants[0].earnedTick = 1n; },
    value => { value.participants[0].earnedTick = 13n; },
    value => { value.participants[0].earnedTick = undefined; },
    value => { value.participants[0].travelMm = 999; },
    value => { value.participants[0].contributionMm = 999; },
    value => { value.creditStartedTick = undefined; },
    value => { value.creditStartedTick = 1n; },
    value => { value.dwellTicks = 9; },
    value => { value.reason = Reason.NO_PROGRESS; },
  ];
  for (const edit of edits) { const value = moving(); edit(value); assert.throws(() => validateDemoActivity(value), TypeError, edit.toString()); }
  const ready = initial(); ready.participants[0].travelMm = 1;
  assert.throws(() => validateDemoActivity(ready), /credit outside/);
  const incomplete = moving(Phase.COMPLETE); incomplete.dwellTicks = 7;
  assert.throws(() => validateDemoActivity(incomplete), /dwell/);
  const negative = moving(); negative.participants[0].contributionMm = -32000; negative.participants[0].earnedTick = undefined;
  assert.equal(validateDemoActivity(negative), negative);
});

test('retained history is ordered and agrees with the latest complete replacement', () => {
  const edits = [
    value => { value.recentTransitions.push(value.recentTransitions[1]); },
    value => { value.recentTransitions[1].id = 3n; },
    value => { value.recentTransitions[1].tick = 0n; },
    value => { value.recentTransitions[1].from = Phase.READY; },
    value => { value.recentTransitions[1].resetId = 1n; },
    value => { value.recentTransitions[1].completedRounds = 1n; },
    value => { value.recentTransitions[1].reason = Reason.NO_PROGRESS; },
    value => { value.transitionId = 3n; },
    value => { value.recentTransitions = []; },
    value => { value.recentTransitions[0].to = Phase.COMPLETE; },
    value => { value.recentTransitions = new Array(9).fill(value.recentTransitions[0]); },
  ];
  for (const edit of edits) { const value = moving(); edit(value); assert.throws(() => validateDemoActivity(value), TypeError, edit.toString()); }
});

test('suspension clears failed-attempt credit, unbound slots omit identity, exhaustion fails closed', () => {
  const oneBound = initial({ participants: [{ bodyId: 1n, availability: Availability.AVAILABLE }, { availability: Availability.UNBOUND }] });
  assert.equal(validateDemoActivity(oneBound), oneBound);
  oneBound.participants.reverse();
  assert.throws(() => validateDemoActivity(oneBound), /unbound slots/);
  const suspended = initial({ phase: Phase.SUSPENDED, reason: Reason.PARTICIPANT_UNAVAILABLE, resetId: 1n,
    observedTick: 1n, phaseStartedTick: 1n, transitionId: 1n,
    participants: [{ availability: Availability.UNBOUND }, { availability: Availability.UNBOUND }],
    recentTransitions: [{ id: 1n, tick: 1n, from: Phase.READY, to: Phase.SUSPENDED, resetId: 1n, reason: Reason.PARTICIPANT_UNAVAILABLE }] });
  assert.equal(validateDemoActivity(suspended), suspended);
  suspended.participants[0].bodyId = 1n;
  assert.throws(() => validateDemoActivity(suspended), /binding/);
  const exhausted = initial({ phase: Phase.SUSPENDED, reason: Reason.COUNTER_EXHAUSTED, observedTick: 2n,
    phaseStartedTick: 2n, transitionId: MAX,
    recentTransitions: [{ id: MAX, tick: 1n, from: Phase.COMPLETE, to: Phase.READY, reason: Reason.NORMAL }] });
  assert.equal(validateDemoActivity(exhausted), exhausted);
  exhausted.formationCenterMm = initial({ formationCenterMm: vector(0n) }).formationCenterMm;
  assert.throws(() => validateDemoActivity(exhausted), TypeError);
});

test('maximal valid retained activity uses the generated serialized artifact and fits 2048 bytes', context => {
  const sequence = [Phase.SEPARATE, Phase.REGROUP, Phase.COMPLETE, Phase.SEPARATE, Phase.REGROUP, Phase.COMPLETE, Phase.SEPARATE, Phase.REGROUP];
  let from = Phase.READY; let rounds = MAX - 2n;
  const recentTransitions = sequence.map((to, index) => {
    if (to === Phase.COMPLETE) rounds++;
    const transition = { id: MAX - 7n + BigInt(index), tick: MAX - 7n + BigInt(index), from, to, completedRounds: rounds, resetId: MAX, reason: Reason.NORMAL };
    from = to; return transition;
  });
  const value = moving(); Object.assign(value, { observedTick: MAX, phaseStartedTick: MAX, creditStartedTick: MAX,
    transitionId: MAX, resetId: MAX, completedRounds: MAX, dwellTicks: 8,
    recentTransitions: create(DemoActivitySnapshotSchema, { recentTransitions }).recentTransitions });
  Object.assign(value.formationCenterMm, { xMm: 8000n, yMm: 100_000_000n, zMm: 8000n });
  Object.assign(value.formationAxisMm, { xMm: 708n, zMm: 708n });
  value.participants.forEach((participant, index) => {
    participant.bodyId = MAX - 1n + BigInt(index); participant.earnedTick = MAX; participant.contributionMm = 32000;
    Object.assign(participant.phaseStartPositionMm, { xMm: 8000n, yMm: 100_000_000n, zMm: 8000n });
  });
  assert.equal(validateDemoActivity(value), value);
  const encodedBytes = toBinary(DemoActivitySnapshotSchema, value).length;
  context.diagnostic(`maximal valid activity: ${encodedBytes} encoded bytes`);
  assert.ok(encodedBytes <= 2048);
});
