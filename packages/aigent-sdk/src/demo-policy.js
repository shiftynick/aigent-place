/** Bounded local demo policy. Positions, never accepted results, drive progress. */
export const PLAZA_BOUND_MM = 8_000;
export const RUNNER_WAYPOINTS = Object.freeze([
  Object.freeze([2_200, -1_200]), Object.freeze([2_200, 1_200]),
  Object.freeze([-200, 1_200]), Object.freeze([-200, -1_200]),
]);
const RUNNER_ARRIVAL_MM = 150;
const MEET_MM = 1_500;
const REARM_MM = 1_800;
const MEET_TRAVEL_MM = 300;
const RETREAT_TRAVEL_MM = 400;
const CLEAR_AXIS_MM = 1_100;
const PEER_CHANGE_MM = 700;
const PROGRESS_MM = 100;
const WATCHDOG_MS = 7_000;
const DWELL_MS = 1_200;
const MEET_DWELL_MS = 500;

const pose = body => [Number(body.positionMm.xMm), Number(body.positionMm.zMm)];
const distance = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]);
const axisGap = (a, b) => Math.max(Math.abs(a[0] - b[0]), Math.abs(a[1] - b[1]));
const bounded = point => point.map(axis => Math.round(Math.max(-PLAZA_BOUND_MM, Math.min(PLAZA_BOUND_MM, axis))));

/**
 * This is local policy state, not a public goal/lifecycle representation.
 * decide({selfBodyId, bodies}, monotonicMs, optionalTerminationHint) returns
 * the current desired command plus one-shot events. Transport may defer it.
 */
export function createPolicy(role) {
  if (!['runner', 'seeker'].includes(role)) throw new TypeError('unknown demo role');
  const state = {
    phase: 'waiting', target: undefined, waypoint: 0, completions: 0, meetings: 0,
    goalKind: undefined, goalStartPose: undefined, maxSeparationMm: 0,
    lastProgressAt: undefined, progressPose: undefined, dwellUntil: undefined,
    targetPeerPose: undefined,
  };
  const desired = () => state.phase === 'moving' ? {
    kind: 'move', targetXMm: BigInt(state.target[0]), targetZMm: BigInt(state.target[1]),
    speedMmPerS: role === 'runner' ? 500 : 900,
  } : { kind: 'stop' };

  return {
    state,
    decide(observation, nowMs, terminationHint) {
      const events = [];
      const own = observation.selfBodyId === undefined ? undefined : observation.bodies.get(observation.selfBodyId);
      if (!own) return { command: { kind: 'hold' }, events };
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
      const ownTravel = () => state.goalStartPose ? distance(ownPose, state.goalStartPose) : 0;
      const evidence = () => ({ selfBodyId: own.entityId.toString(), ownRevision: own.revision.toString(), own: ownPose, peerBodyId: others[0].entityId.toString(), peerRevision: others[0].revision.toString(), peer: peerPose });
      const event = (type, extra = {}) => events.push({ type, role, ...evidence(), goalKind: state.goalKind, ownTravelMm: ownTravel(), maxSeparationMm: state.maxSeparationMm, ...extra });
      const start = (target, reason, goalKind = state.goalKind) => {
        const keepOwnProgress = reason === 'peer-moved' && ['moving', 'dwell'].includes(state.phase);
        const continuingMeet = goalKind === 'meet' && state.goalKind === 'meet' && (keepOwnProgress || reason === 'peer-left-meet');
        state.phase = 'moving';
        state.target = bounded(target);
        if (!continuingMeet) {
          state.lastProgressAt = nowMs;
          state.progressPose = ownPose;
          state.goalStartPose = ownPose;
          state.maxSeparationMm = separation;
        }
        state.goalKind = goalKind;
        state.targetPeerPose = peerPose;
        event('goal', { reason, target: state.target });
      };
      const retreat = reason => {
        // Only fixed inset anchors; select using current observed positions.
        const candidates = RUNNER_WAYPOINTS.filter(point => distance(point, ownPose) >= 800 && (reason !== 'stuck-retreat' || distance(point, state.target) > 1));
        const target = [...candidates].sort((a, b) => distance(b, peerPose) - distance(a, peerPose))[0] ?? RUNNER_WAYPOINTS[0];
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
      if (role === 'seeker') {
        if (axisGap(ownPose, peerPose) < CLEAR_AXIS_MM) return yieldForPeer();
        if (state.phase === 'yield') retreat('peer-cleared');
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
          }
          const stalledMs = nowMs - state.lastProgressAt;
          const blocked = terminationHint === 'BLOCKED' && stalledMs >= 1_000;
          if (stalledMs >= WATCHDOG_MS || blocked) {
            event('replan', { reason: blocked ? 'typed-blocked' : 'position-watchdog', stalledMs, target: state.target });
            if (role === 'runner') {
              state.waypoint = (state.waypoint + 1) % RUNNER_WAYPOINTS.length;
              start(RUNNER_WAYPOINTS[state.waypoint], 'stuck-route', 'waypoint');
            } else retreat(state.goalKind === 'retreat' ? 'stuck-retreat' : 'stuck-approach');
          }
        }
      }
      return { command: desired(), events };
    },
  };
}
