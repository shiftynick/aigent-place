/** Bounded local demo policy. Positions, never accepted results, drive progress. */
import { DemoError } from './demo-observation.js';

export const PLAZA_BOUND_MM = 8_000;
export const RUNNER_WAYPOINTS = Object.freeze([
  Object.freeze([2_200, -1_200]), Object.freeze([2_200, 1_200]),
  Object.freeze([-200, 1_200]), Object.freeze([-200, -1_200]),
]);
const COMPACT = Object.freeze({
  waypoints: RUNNER_WAYPOINTS, RUNNER_ARRIVAL_MM: 150, MEET_MM: 1_500,
  REARM_MM: 1_800, MEET_TRAVEL_MM: 300, RETREAT_TRAVEL_MM: 400,
  CLEAR_AXIS_MM: 1_100, PEER_CHANGE_MM: 700, PROGRESS_MM: 100,
  WATCHDOG_MS: 7_000, DWELL_MS: 1_200, MEET_DWELL_MS: 500,
});
const WIDE = Object.freeze({
  ...COMPACT,
  waypoints: Object.freeze([
    Object.freeze([6_000, -4_000]), Object.freeze([6_000, 4_000]),
    Object.freeze([-6_000, 4_000]), Object.freeze([-6_000, -4_000]),
  ]),
  REARM_MM: 4_500, MEET_TRAVEL_MM: 1_000, RETREAT_TRAVEL_MM: 1_000,
  PEER_CHANGE_MM: 1_500, WATCHDOG_MS: 8_000, DWELL_MS: 600, MEET_DWELL_MS: 400,
});
const PEER_OBSTRUCTION_MM = 2_000;
const WIDE_MEET_MIN_MM = 1_200;
const PEER_ROUTE_MARGIN_MM = 1_500;

const pose = body => [Number(body.positionMm.xMm), Number(body.positionMm.zMm)];
const distance = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]);
const axisGap = (a, b) => Math.max(Math.abs(a[0] - b[0]), Math.abs(a[1] - b[1]));
const bounded = point => point.map(axis => Math.round(Math.max(-PLAZA_BOUND_MM, Math.min(PLAZA_BOUND_MM, axis))));
const clearPeerRoute = (own, target, peer) => {
  const delta = target.map((axis, index) => axis - own[index]);
  const lengthSq = delta[0] ** 2 + delta[1] ** 2;
  if (!lengthSq) return distance(own, peer) >= PEER_ROUTE_MARGIN_MM;
  const toward = (peer[0] - own[0]) * delta[0] + (peer[1] - own[1]) * delta[1];
  // A peer may approach an already paused body. An outward escape is allowed
  // from inside the margin; it must immediately increase actual separation.
  if (distance(own, peer) < PEER_ROUTE_MARGIN_MM && toward <= 0) return true;
  const fraction = Math.max(0, Math.min(1, toward / lengthSq));
  return distance(own.map((axis, index) => axis + delta[index] * fraction), peer) >= PEER_ROUTE_MARGIN_MM;
};

/**
 * This is local policy state, not a public goal/lifecycle representation.
 * decide({selfBodyId, bodies}, monotonicMs, optionalTerminationHint) returns
 * the current desired command plus one-shot events. Transport may defer it.
 */
export function createPolicy(role, preset = 'compact') {
  if (!['runner', 'seeker'].includes(role)) throw new TypeError('unknown demo role');
  if (!['compact', 'wide-plaza'].includes(preset)) throw new TypeError('unknown demo preset');
  const wide = preset === 'wide-plaza';
  const {
    waypoints: RUNNER_WAYPOINTS, RUNNER_ARRIVAL_MM, MEET_MM, REARM_MM,
    MEET_TRAVEL_MM, RETREAT_TRAVEL_MM, CLEAR_AXIS_MM, PEER_CHANGE_MM,
    PROGRESS_MM, WATCHDOG_MS, DWELL_MS, MEET_DWELL_MS,
  } = wide ? WIDE : COMPACT;
  const state = {
    phase: 'waiting', target: undefined, waypoint: 0, completions: 0, meetings: 0,
    goalKind: undefined, goalStartPose: undefined, maxSeparationMm: 0,
    lastProgressAt: undefined, progressPose: undefined, dwellUntil: undefined,
    targetPeerPose: undefined, wideFailures: 0, entityBlockId: undefined,
  };
  const desired = () => state.phase === 'moving' ? {
    kind: 'move', targetXMm: BigInt(state.target[0]), targetZMm: BigInt(state.target[1]),
    speedMmPerS: role === 'runner' ? 500 : 900,
  } : { kind: 'stop' };

  return {
    state,
    beginSession() {
      if (!wide) return;
      state.wideFailures = 0;
      state.entityBlockId = undefined;
      state.lastProgressAt = state.progressPose = undefined;
    },
    decide(observation, nowMs, terminationHint) {
      const events = [];
      const own = observation.selfBodyId === undefined ? undefined : observation.bodies.get(observation.selfBodyId);
      if (!own) {
        if (wide) state.lastProgressAt = state.progressPose = undefined;
        return { command: { kind: 'hold' }, events };
      }
      const others = [...observation.bodies.values()].filter(body => body.entityId !== observation.selfBodyId);
      if (others.length !== 1) {
        state.phase = 'waiting';
        state.target = undefined;
        state.progressPose = undefined;
        return { command: { kind: 'stop' }, events };
      }
      const ownPose = pose(own);
      const peerPose = pose(others[0]);
      const separation = distance(ownPose, peerPose);
      if (wide && state.lastProgressAt === undefined) {
        state.lastProgressAt = nowMs;
        state.progressPose = ownPose;
      }
      // A known peer obstruction ends when current observations place that
      // peer well outside contact range. Missing/other blockers remain known
      // until real own progress or a non-entity termination supersedes them.
      if (wide && state.entityBlockId === others[0].entityId && separation > PEER_OBSTRUCTION_MM) {
        state.entityBlockId = undefined;
        state.lastProgressAt = nowMs;
        state.progressPose = ownPose;
      }
      const ownTravel = () => state.goalStartPose ? distance(ownPose, state.goalStartPose) : 0;
      const evidence = () => ({ selfBodyId: own.entityId.toString(), ownRevision: own.revision.toString(), own: ownPose, peerBodyId: others[0].entityId.toString(), peerRevision: others[0].revision.toString(), peer: peerPose });
      const event = (type, extra = {}) => events.push({ type, role, ...evidence(), goalKind: state.goalKind, ownTravelMm: ownTravel(), maxSeparationMm: state.maxSeparationMm, ...extra });
      const escapeTarget = () => {
        const gap = separation || 1;
        const away = separation ? ownPose.map((axis, index) => (axis - peerPose[index]) / gap) : [1, 0];
        return bounded(ownPose.map((axis, index) => axis + away[index] * 2_500));
      };
      const start = (target, reason, goalKind = state.goalKind) => {
        const entityReplan = reason === 'entity-blocked';
        const keepRunnerProgress = wide && role === 'runner' && reason === 'observed-peer-on-route'
          && ['moving', 'dwell'].includes(state.phase);
        const keepRetreatProgress = wide && role === 'seeker' && reason === 'observed-peer-on-retreat'
          && ['moving', 'dwell'].includes(state.phase);
        if (wide && role === 'runner' && goalKind === 'waypoint') {
          const next = RUNNER_WAYPOINTS.findIndex((_, offset) => clearPeerRoute(ownPose,
            RUNNER_WAYPOINTS[(state.waypoint + offset) % RUNNER_WAYPOINTS.length], peerPose));
          if (next >= 0) {
            state.waypoint = (state.waypoint + next) % RUNNER_WAYPOINTS.length;
            target = RUNNER_WAYPOINTS[state.waypoint];
            if (next) reason = 'observed-peer-on-route';
          } else {
            target = escapeTarget();
            if (distance(target, ownPose) <= RUNNER_ARRIVAL_MM) {
              const alreadyYielding = state.phase === 'yield';
              state.phase = 'yield';
              state.target = undefined;
              state.goalKind = 'avoid-peer';
              if (!alreadyYielding) event('yield', { reason: 'observed-peer-no-clear-route', separationMm: separation });
              return;
            }
            goalKind = 'avoid-peer';
            reason = 'observed-peer-escape';
          }
        }
        const keepOwnProgress = reason === 'peer-moved' && ['moving', 'dwell'].includes(state.phase);
        const continuingMeet = goalKind === 'meet' && state.goalKind === 'meet' && (keepOwnProgress || reason === 'peer-left-meet');
        state.phase = 'moving';
        state.target = bounded(target);
        if (!continuingMeet) {
          if (!keepRunnerProgress && !keepRetreatProgress) {
            state.lastProgressAt = nowMs;
            state.progressPose = ownPose;
          }
          state.goalStartPose = ownPose;
          state.maxSeparationMm = separation;
        }
        state.goalKind = goalKind;
        state.targetPeerPose = peerPose;
        if (!keepOwnProgress && !keepRunnerProgress && !keepRetreatProgress && !entityReplan) state.entityBlockId = undefined;
        event('goal', { reason, target: state.target });
      };
      const retreat = reason => {
        // Prefer fixed inset anchors using current observed positions. Wide
        // retreat must clear the peer along the whole segment, including an
        // unleased peer; an outward escape supplies travel if no anchor clears.
        // An arrival inside the tolerance must still supply the required own
        // retreat travel. The compact profile retains its existing 800mm inset.
        const retreatMinimum = Math.max(800, RETREAT_TRAVEL_MM + RUNNER_ARRIVAL_MM);
        const candidates = RUNNER_WAYPOINTS.filter(point => distance(point, ownPose) >= retreatMinimum
          && (reason !== 'stuck-retreat' || distance(point, state.target) > 1)
          && (!wide || clearPeerRoute(ownPose, point, peerPose)));
        const target = [...candidates].sort((a, b) => distance(b, peerPose) - distance(a, peerPose))[0]
          ?? (wide ? escapeTarget() : RUNNER_WAYPOINTS[0]);
        if (wide && distance(target, ownPose) < retreatMinimum) {
          const alreadyYielding = state.phase === 'yield';
          state.phase = 'yield';
          state.target = undefined;
          state.goalKind = 'retreat';
          if (!alreadyYielding) event('yield', { reason: 'observed-peer-no-clear-retreat', separationMm: separation });
          return;
        }
        start(target, reason, 'retreat');
      };
      const yieldForPeer = () => {
        if (state.phase !== 'yield') event('yield', { reason: 'observed-peer-too-close', separationMm: separation });
        state.phase = 'yield';
        return { command: { kind: 'stop' }, events };
      };

      if (state.phase === 'waiting') {
        if (role === 'runner') start(RUNNER_WAYPOINTS[state.waypoint], 'cast-ready', 'waypoint');
        else if (separation >= REARM_MM) start(peerPose, 'cast-separated', 'meet');
        else retreat('cast-nearby');
      }
      if (wide && role === 'runner' && state.phase === 'yield') {
        start(RUNNER_WAYPOINTS[state.waypoint], 'observed-peer-on-route', 'waypoint');
      }
      if (wide && role === 'runner' && ['moving', 'dwell'].includes(state.phase)
          && !clearPeerRoute(ownPose, state.target, peerPose)) {
        start(RUNNER_WAYPOINTS[state.waypoint], 'observed-peer-on-route', 'waypoint');
      }
      if (wide && role === 'runner' && state.goalKind === 'avoid-peer'
          && state.phase === 'moving' && distance(ownPose, state.target) <= RUNNER_ARRIVAL_MM) {
        const clear = separation >= PEER_ROUTE_MARGIN_MM;
        if (clear) event('avoidance-cleared');
        start(RUNNER_WAYPOINTS[state.waypoint], clear ? 'observed-escape-arrival' : 'observed-peer-on-route', 'waypoint');
      }
      if (wide && role === 'runner' && state.phase === 'yield') return { command: desired(), events };
      if (role === 'seeker') {
        if (axisGap(ownPose, peerPose) < CLEAR_AXIS_MM) return yieldForPeer();
        if (state.phase === 'yield') retreat('peer-cleared');
        if (wide && state.goalKind === 'meet' && separation < WIDE_MEET_MIN_MM) retreat('meeting-too-close');
        if (wide && state.goalKind === 'retreat' && ['moving', 'dwell'].includes(state.phase)
            && !clearPeerRoute(ownPose, state.target, peerPose)) retreat('observed-peer-on-retreat');
        state.maxSeparationMm = Math.max(state.maxSeparationMm, separation);
        if (state.goalKind === 'meet' && ['moving', 'dwell'].includes(state.phase) && distance(peerPose, state.targetPeerPose) >= PEER_CHANGE_MM) {
          start(peerPose, 'peer-moved');
        }
      }
      const meeting = role === 'seeker' && state.goalKind === 'meet';
      const freshMeet = () => state.maxSeparationMm >= REARM_MM && ownTravel() >= MEET_TRAVEL_MM;
      const enoughTravel = () => meeting ? freshMeet() : role === 'runner' || ownTravel() >= RETREAT_TRAVEL_MM;
      if (state.phase === 'dwell') {
        const stillArrived = distance(ownPose, meeting ? peerPose : state.target) <= (meeting ? MEET_MM : RUNNER_ARRIVAL_MM);
        if (!stillArrived) start(meeting ? peerPose : state.target, meeting ? 'peer-left-meet' : 'observed-displacement');
        else if (nowMs >= state.dwellUntil && enoughTravel()) {
          state.completions += 1;
          if (meeting) state.meetings += 1;
          event('goal-complete', { completed: state.completions, meetings: state.meetings, target: state.target, distanceMm: distance(ownPose, meeting ? peerPose : state.target) });
          if (role === 'runner') {
            state.waypoint = (state.waypoint + 1) % RUNNER_WAYPOINTS.length;
            start(RUNNER_WAYPOINTS[state.waypoint], 'observed-arrival-dwell', 'waypoint');
          } else if (meeting) retreat('meeting-complete');
          else if (separation >= REARM_MM) start(peerPose, 'retreat-separated', 'meet');
          else retreat('retreat-peer-still-nearby');
          return { command: desired(), events };
        }
      }
      if (state.phase === 'moving') {
        const tolerance = meeting ? MEET_MM : RUNNER_ARRIVAL_MM;
        const arrivalTarget = meeting ? peerPose : state.target;
        if (distance(ownPose, arrivalTarget) <= tolerance) {
          if (enoughTravel()) {
            state.phase = 'dwell';
            state.dwellUntil = nowMs + (meeting ? MEET_DWELL_MS : DWELL_MS);
            event('arrive', { target: state.target, distanceMm: distance(ownPose, arrivalTarget) });
          } else if (meeting) retreat('meeting-needs-own-travel');
        } else {
          if (distance(ownPose, state.progressPose) >= PROGRESS_MM) {
            state.lastProgressAt = nowMs;
            state.progressPose = ownPose;
            if (wide) state.entityBlockId = undefined;
          }
          const stalledMs = nowMs - state.lastProgressAt;
          const typedBlock = terminationHint === 'BLOCKED' || terminationHint?.reason === 'BLOCKED';
          const blocked = typedBlock && (wide || stalledMs >= 1_000);
          if (stalledMs >= WATCHDOG_MS || blocked) {
            const entityObstruction = wide && (terminationHint?.conflictingEntityId !== undefined
              || !blocked && (state.entityBlockId !== undefined || separation <= PEER_OBSTRUCTION_MM));
            const reason = entityObstruction ? 'entity-blocked' : blocked ? 'typed-blocked' : 'position-watchdog';
            event('replan', { reason, stalledMs, target: state.target });
            if (wide && !entityObstruction) {
              state.entityBlockId = undefined;
              state.wideFailures += 1;
              event('wide-movement-failure', { reason, failures: state.wideFailures, target: state.target });
              if (state.wideFailures >= 2) throw new DemoError('WIDE_MOVEMENT_FAILED',
                `${role} wide movement target (${state.target.join(',')}) mm failed after 2 qualifying failures (${reason}). Use server --demo-plaza with client --wide-plaza; observations do not identify the server terrain profile.`);
            }
            if (entityObstruction) state.entityBlockId = terminationHint?.conflictingEntityId ?? state.entityBlockId ?? others[0].entityId;
            if (role === 'runner') {
              state.waypoint = (state.waypoint + 1) % RUNNER_WAYPOINTS.length;
              start(RUNNER_WAYPOINTS[state.waypoint], entityObstruction ? 'entity-blocked' : 'stuck-route', 'waypoint');
            } else retreat(entityObstruction ? 'entity-blocked' : state.goalKind === 'retreat' ? 'stuck-retreat' : 'stuck-approach');
          }
        }
      }
      return { command: desired(), events };
    },
  };
}
