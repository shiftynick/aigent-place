import { isMessage, toBinary } from '@bufbuild/protobuf';
import {
  DemoActivityParticipantSchema, DemoActivityPhase as Phase, DemoActivityReason as Reason,
  DemoActivityRulesSchema, DemoActivitySnapshotSchema, DemoActivityTransitionSchema,
  DemoParticipantAvailability as Availability, Vector3MillimetersSchema,
} from './gen/aigent_pb.js';

const U64_MAX = 0xffffffffffffffffn;
const WORLD_BOUND_MM = 100_000_000n;
const RULES = Object.freeze({
  innerMinMm: 1800, innerMaxMm: 2200, separateMm: 5500,
  minTravelMm: 1000, minContributionMm: 1000, dwellTicks: 8,
  completeHoldTicks: 20, recoveryHoldTicks: 20, phaseTimeoutTicks: 400,
});
const phases = new Set([Phase.READY, Phase.SEPARATE, Phase.REGROUP, Phase.COMPLETE, Phase.SUSPENDED]);
const reasons = new Set(Object.values(Reason).filter(value => typeof value === 'number' && value > 0));
const availability = new Set([Availability.UNBOUND, Availability.MISSING_BODY, Availability.DISCONNECTED, Availability.AVAILABLE]);
const edges = new Map([
  [Phase.READY, new Set([Phase.SEPARATE, Phase.SUSPENDED])],
  [Phase.SEPARATE, new Set([Phase.REGROUP, Phase.SUSPENDED])],
  [Phase.REGROUP, new Set([Phase.COMPLETE, Phase.SUSPENDED])],
  [Phase.COMPLETE, new Set([Phase.SEPARATE, Phase.READY, Phase.SUSPENDED])],
  [Phase.SUSPENDED, new Set([Phase.READY])],
]);
const bad = message => { throw new TypeError(`invalid demo activity: ${message}`); };
const uint64 = value => typeof value === 'bigint' && value >= 0n && value <= U64_MAX;
const integer = (value, min, max) => Number.isInteger(value) && value >= min && value <= max;

function message(value, schema) {
  if (!isMessage(value, schema)) bad(`expected ${schema.name}`);
  const keys = new Set(['$typeName', '$unknown', ...schema.fields.map(field => field.localName)]);
  if (Object.keys(value).some(key => !keys.has(key)) || value.$unknown !== undefined && !Array.isArray(value.$unknown)) bad('unknown/private JavaScript fields');
}
function vector(value, formation = false) {
  message(value, Vector3MillimetersSchema);
  if (![value.xMm, value.yMm, value.zMm].every(axis => typeof axis === 'bigint' && axis >= -WORLD_BOUND_MM && axis <= WORLD_BOUND_MM)) bad('coordinate bound');
  if (formation && (value.xMm < -8000n || value.xMm > 8000n || value.zMm < -8000n || value.zMm > 8000n)) bad('plaza anchor bound');
}
function rules(value) {
  message(value, DemoActivityRulesSchema);
  if (Object.entries(RULES).some(([key, expected]) => value[key] !== expected)) bad('unsupported v1 rules');
}
function history(value) {
  if (!Array.isArray(value.recentTransitions) || value.recentTransitions.length > 8) bad('history bound');
  let prior;
  for (const transition of value.recentTransitions) {
    message(transition, DemoActivityTransitionSchema);
    if (![transition.id, transition.tick, transition.completedRounds, transition.resetId].every(uint64)
      || transition.id === 0n || transition.id > value.transitionId || transition.tick > value.observedTick
      || transition.completedRounds > value.completedRounds || transition.resetId > value.resetId) bad('transition counters');
    if (!phases.has(transition.from) || !phases.has(transition.to) || !edges.get(transition.from).has(transition.to)
      || !reasons.has(transition.reason) || (transition.to === Phase.SUSPENDED) === (transition.reason === Reason.NORMAL)) bad('transition phase/reason');
    if (prior && (transition.id !== prior.id + 1n || transition.tick < prior.tick || transition.from !== prior.to
      || transition.resetId !== prior.resetId + (transition.to === Phase.SUSPENDED ? 1n : 0n)
      || transition.completedRounds !== prior.completedRounds + (transition.to === Phase.COMPLETE ? 1n : 0n))) bad('history ordering');
    prior = transition;
  }
  if (!prior) {
    if (value.transitionId !== 0n || value.resetId !== 0n || value.completedRounds !== 0n || value.phase !== Phase.READY || value.phaseStartedTick !== 0n) bad('missing transition history');
  } else {
    const exhausted = value.phase === Phase.SUSPENDED && value.reason === Reason.COUNTER_EXHAUSTED
      && [value.transitionId, value.resetId, value.completedRounds].includes(U64_MAX);
    if (prior.id !== value.transitionId || prior.completedRounds !== value.completedRounds || prior.resetId !== value.resetId
      || !exhausted && (prior.to !== value.phase || prior.tick !== value.phaseStartedTick || prior.reason !== value.reason)) bad('latest transition mismatch');
  }
}

/** Validate complete optional activity replacement before observation commits. */
export function validateDemoActivity(value) {
  if (value === undefined) return undefined;
  try {
    if (!isMessage(value, DemoActivitySnapshotSchema)) bad('generated snapshot required');
    // Charge the artifact consumers retain, including protobuf unknown bytes.
    if (toBinary(DemoActivitySnapshotSchema, value).length > 2048) bad('encoded size exceeds 2048 bytes');
    message(value, DemoActivitySnapshotSchema);
    if (value.version !== 1 || !(value.runId instanceof Uint8Array) || value.runId.length !== 16 || !value.runId.some(byte => byte !== 0)) bad('version/run token');
    if (![value.resetId, value.observedTick, value.phaseStartedTick, value.completedRounds, value.transitionId].every(uint64)
      || value.phaseStartedTick > value.observedTick) bad('snapshot counters');
    if (!phases.has(value.phase) || !reasons.has(value.reason)
      || (value.phase === Phase.SUSPENDED) === (value.reason === Reason.NORMAL)) bad('phase/reason');
    if (value.reason === Reason.COUNTER_EXHAUSTED && ![value.transitionId, value.resetId, value.completedRounds].includes(U64_MAX)) bad('counter exhaustion without exhausted counter');
    rules(value.rules);
    if (!Array.isArray(value.participants) || value.participants.length !== 2) bad('two ordered participant slots required');
    if (value.participants[0].bodyId === undefined && value.participants[1].bodyId !== undefined) bad('unbound slots must follow bound slots');
    const hasCredit = [Phase.SEPARATE, Phase.REGROUP, Phase.COMPLETE].includes(value.phase);
    if (hasCredit) {
      if (!uint64(value.creditStartedTick) || value.creditStartedTick > value.phaseStartedTick
        || value.phase !== Phase.COMPLETE && value.creditStartedTick !== value.phaseStartedTick) bad('credit origin');
    } else if (value.creditStartedTick !== undefined) bad('credit outside movement phase');
    if ((value.formationCenterMm === undefined) !== (value.formationAxisMm === undefined)
      || hasCredit && value.formationCenterMm === undefined || value.phase === Phase.SUSPENDED && value.formationCenterMm !== undefined) bad('formation presence');
    if (value.formationCenterMm !== undefined) {
      vector(value.formationCenterMm, true);
      vector(value.formationAxisMm);
      const axis = value.formationAxisMm;
      if (axis.yMm !== 0n || Math.abs(Math.hypot(Number(axis.xMm), Number(axis.zMm)) - 1000) > 2) bad('horizontal formation axis');
    }
    const ids = new Set();
    for (const participant of value.participants) {
      message(participant, DemoActivityParticipantSchema);
      if (!availability.has(participant.availability) || participant.availability === Availability.UNBOUND && participant.bodyId !== undefined
        || participant.availability !== Availability.UNBOUND && (!uint64(participant.bodyId) || participant.bodyId === 0n)) bad('participant binding/availability');
      if (participant.bodyId !== undefined) {
        if ([...ids].some(id => participant.bodyId <= id)) bad('participant body ID ordering');
        ids.add(participant.bodyId);
      }
      if (!integer(participant.travelMm, 0, value.rules.minTravelMm) || !integer(participant.contributionMm, -32000, 32000)) bad('participant progress bound');
      if (hasCredit) {
        if (participant.availability !== Availability.AVAILABLE || participant.phaseStartPositionMm === undefined) bad('credit participant unavailable');
        vector(participant.phaseStartPositionMm, true);
        const qualifies = participant.travelMm >= value.rules.minTravelMm && participant.contributionMm >= value.rules.minContributionMm;
        if (participant.earnedTick !== undefined && (!uint64(participant.earnedTick) || participant.earnedTick < value.creditStartedTick
          || participant.earnedTick > value.observedTick || !qualifies) || qualifies && participant.earnedTick === undefined) bad('phase proof');
        if (value.phase === Phase.COMPLETE && participant.earnedTick === undefined) bad('completion without both proofs');
      } else if (participant.phaseStartPositionMm !== undefined || participant.earnedTick !== undefined || participant.travelMm !== 0 || participant.contributionMm !== 0) bad('credit outside movement phase');
    }
    if (!integer(value.dwellTicks, 0, value.rules.dwellTicks) || ![Phase.REGROUP, Phase.COMPLETE].includes(value.phase) && value.dwellTicks !== 0
      || value.phase === Phase.COMPLETE && value.dwellTicks !== value.rules.dwellTicks
      || value.dwellTicks > 0 && value.participants.some(participant => participant.earnedTick === undefined)) bad('dwell/proof combination');
    history(value);
    return value;
  } catch (error) {
    if (error instanceof TypeError && error.message.startsWith('invalid demo activity:')) throw error;
    bad(`malformed generated data (${error.message})`);
  }
}
