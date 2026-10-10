import { DemoActivityPhase as Phase, DemoParticipantAvailability as Availability } from '@aigent-place/protocol';
import { DemoError } from './demo-observation.js';

const SETUP_TIMEOUT_MS = 5000;
const PLAZA_BOUND_MM = 8000;
const ARRIVAL_MM = 50;
const WATCHDOG_MS = 8000;
const pose = body => [Number(body.positionMm.xMm), Number(body.positionMm.zMm)];
const distance = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]);

/** Local intent selection; only the observed world state advances the activity. */
export function createActivityPolicy(role) {
  if (!['runner', 'seeker'].includes(role)) throw new TypeError('unknown demo role');
  const state = { target: undefined, routeKey: undefined, retryId: 0, failures: 0,
    progressPose: undefined, lastProgressAt: undefined, unavailableSince: undefined };
  return {
    state,
    beginSession() {
      state.target = state.routeKey = state.progressPose = state.lastProgressAt = state.unavailableSince = undefined;
      state.retryId = state.failures = 0;
    },
    decide(observation, nowMs, terminationHint) {
      const events = [];
      const activity = observation.demoActivity;
      const own = observation.selfBodyId === undefined ? undefined : observation.bodies.get(observation.selfBodyId);
      const slot = activity?.participants.findIndex(participant => participant.bodyId === observation.selfBodyId) ?? -1;
      if (!activity || own && slot < 0) {
        state.progressPose = state.lastProgressAt = undefined;
        state.unavailableSince ??= nowMs;
        if (nowMs - state.unavailableSince >= SETUP_TIMEOUT_MS) throw new DemoError('ACTIVITY_UNAVAILABLE',
          activity ? 'self body is not a participant in this demo activity' : 'demo activity did not arrive within 5 seconds; use server --demo-activity with --demo-plaza');
        return { command: { kind: 'hold' }, events };
      }
      state.unavailableSince = undefined;
      if (!own) { state.progressPose = state.lastProgressAt = undefined; return { command: { kind: 'hold' }, events }; }
      if ([Phase.COMPLETE, Phase.SUSPENDED].includes(activity.phase) || !activity.formationCenterMm
        || activity.participants.some(participant => participant.availability !== Availability.AVAILABLE
          || !observation.bodies.has(participant.bodyId))) {
        state.target = state.routeKey = state.progressPose = state.lastProgressAt = undefined;
        return { command: { kind: 'stop' }, events };
      }
      const center = activity.formationCenterMm;
      const axis = activity.formationAxisMm;
      const radius = activity.phase === Phase.SEPARATE ? 3250 : 1000;
      const side = slot === 0 ? -1 : 1;
      const target = [center.xMm, center.zMm].map((coordinate, index) => Math.round(Number(coordinate)
        + side * radius * Number(index === 0 ? axis.xMm : axis.zMm) / 1000));
      if (target.some(coordinate => Math.abs(coordinate) > PLAZA_BOUND_MM)) throw new DemoError('ACTIVITY_TARGET_UNSAFE', 'public formation cannot fit activity targets within the 8m plaza');
      const routeKey = `${Array.from(activity.runId).join('.')}:${activity.resetId}:${activity.transitionId}:${target.join(',')}`;
      const ownPose = pose(own);
      if (routeKey !== state.routeKey) {
        state.routeKey = routeKey;
        state.target = target;
        state.retryId = state.failures = 0;
        state.progressPose = ownPose;
        state.lastProgressAt = nowMs;
        events.push({ type: 'activity-target', phase: activity.phase, resetId: activity.resetId.toString(),
          selfBodyId: own.entityId.toString(), target });
      }
      if (distance(ownPose, target) <= ARRIVAL_MM) {
        // Arrival and intentional stillness need no renewed lease or jiggle.
        state.progressPose = ownPose;
        state.lastProgressAt = nowMs;
        return { command: { kind: 'stop' }, events };
      }
      if (state.progressPose === undefined || distance(ownPose, state.progressPose) >= ARRIVAL_MM) {
        state.progressPose = ownPose;
        state.lastProgressAt = nowMs;
        state.failures = 0;
      }
      const blocked = terminationHint === 'BLOCKED' || terminationHint?.reason === 'BLOCKED';
      if (blocked || nowMs - state.lastProgressAt >= WATCHDOG_MS) {
        if (++state.failures >= 2) throw new DemoError('ACTIVITY_MOVEMENT_FAILED', 'activity target failed twice without sufficient observed movement');
        state.retryId++;
        state.lastProgressAt = nowMs;
        events.push({ type: 'activity-retry', reason: blocked ? 'typed-blocked' : 'position-watchdog', target });
      }
      return { command: { kind: 'move', targetXMm: BigInt(target[0]), targetZMm: BigInt(target[1]),
        speedMmPerS: role === 'runner' ? 500 : 900, retryId: state.retryId }, events };
    },
  };
}
