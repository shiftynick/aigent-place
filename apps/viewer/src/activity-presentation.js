import { DemoActivityPhase as Phase, DemoActivityReason as Reason, DemoParticipantAvailability as Availability } from "@aigent-place/protocol";

const PHASE_NAMES = {
  [Phase.READY]: "READY · Form a safe pair",
  [Phase.SEPARATE]: "SEPARATE · Move apart",
  [Phase.REGROUP]: "REGROUP · Return together",
  [Phase.COMPLETE]: "COMPLETE · Round earned",
  [Phase.SUSPENDED]: "SUSPENDED · Attempt paused",
};
const REASONS = {
  [Reason.PARTICIPANT_UNAVAILABLE]: "A participant is unavailable",
  [Reason.SESSION_CHANGED]: "A participant connection changed",
  [Reason.BODY_CHANGED]: "A participant body changed",
  [Reason.LEASE_INACTIVE]: "A movement lease expired or became invalid",
  [Reason.NO_PROGRESS]: "Progress no longer qualifies or the phase timed out",
  [Reason.UNSAFE_GEOMETRY]: "The pair geometry is unsafe or unsupported",
  [Reason.COUNTER_EXHAUSTED]: "The activity reached its counter limit",
};
const AVAILABILITY_NAMES = {
  [Availability.UNBOUND]: "unbound",
  [Availability.MISSING_BODY]: "body unavailable",
  [Availability.DISCONNECTED]: "disconnected",
  [Availability.AVAILABLE]: "available",
};
const metres = mm => (mm / 1000).toFixed(2);
const roundCount = count => `${count} ${count === 1n ? "round" : "rounds"} earned`;
const phaseName = phase => PHASE_NAMES[phase].split(" · ")[0];

function transitionText(transition) {
  const result = transition.to === Phase.COMPLETE ? ` · ${roundCount(transition.completedRounds)}` : "";
  const reason = REASONS[transition.reason];
  return `#${transition.id} · tick ${transition.tick} · ${phaseName(transition.from)} → ${phaseName(transition.to)}${result}${reason ? ` · ${reason}` : ""}`;
}

/** Pure factual presentation of an already validated server observation. */
export function activityPresentation(activity, observedBodies, { fresh, historyGap = null }) {
  if (activity === undefined) return null;
  const rules = activity.rules;
  const direction = activity.phase === Phase.SEPARATE ? "outward" : "inward";
  const hasCredit = activity.creditStartedTick !== undefined;
  const goals = {
    [Phase.READY]: "Form the safe pair before either participant earns movement credit.",
    [Phase.SEPARATE]: "Both earn their own outward proof, then cross the apart distance.",
    [Phase.REGROUP]: "Both earn new inward proof, then hold the safe pair together.",
    [Phase.COMPLETE]: "Both participants proved this round. The next round follows the hold.",
    [Phase.SUSPENDED]: activity.reason === Reason.COUNTER_EXHAUSTED
      ? "Activity stopped at its counter limit. Restart the temporary demo to begin a new run."
      : `${REASONS[activity.reason]}. Recovery starts a new attempt with zero credit.`,
  };
  return {
    phase: PHASE_NAMES[activity.phase],
    count: roundCount(activity.completedRounds),
    status: fresh ? `Server observed tick ${activity.observedTick}` : `Last observed tick ${activity.observedTick} · live activity unavailable`,
    goal: goals[activity.phase],
    rules: `Apart ≥ ${metres(rules.separateMm)} m → return ${metres(rules.innerMinMm)}–${metres(rules.innerMaxMm)} m. Each movement phase: own travel ≥ ${metres(rules.minTravelMm)} m + net ≥ ${metres(rules.minContributionMm)} m.`,
    dwell: `Together hold: ${activity.dwellTicks}/${rules.dwellTicks} ticks (${(rules.dwellTicks / 20).toFixed(2)} s)`,
    participants: activity.participants.map((participant, index) => ({
      identity: participant.bodyId === undefined ? `Slot ${index + 1} · no body` : `Body ${participant.bodyId}`,
      availability: AVAILABILITY_NAMES[participant.availability],
      observation: participant.bodyId !== undefined && !observedBodies.has(String(participant.bodyId)) ? "body not in this observation" : "",
      progress: hasCredit
        ? `Own travel ${metres(participant.travelMm)}/${metres(rules.minTravelMm)} m · ${direction} net ${metres(participant.contributionMm)}/${metres(rules.minContributionMm)} m`
        : "No movement credit in this phase",
      proof: participant.earnedTick === undefined ? (hasCredit ? "Proof pending" : "") : `Proof earned at tick ${participant.earnedTick}`,
    })),
    history: activity.recentTransitions.map(transitionText),
    historyGap,
  };
}

/**
 * Browser-memory cue watermark. Reconnection retains it; reload creates a new
 * baseline. History renders independently and is never replayed as a FULL cue.
 */
export function createActivityCueTracker() {
  let run = null;
  let watermark = 0n;
  let reset = null;
  let gap = null;
  function retainedGap(activity, previous) {
    const first = activity.recentTransitions[0]?.id ?? activity.transitionId + 1n;
    if (first > previous + 1n) return `History gap: transitions ${previous + 1n}–${first - 1n} are no longer retained.`;
    return null;
  }
  return {
    stale() { return { cue: null, historyGap: gap }; },
    observe(activity, { kind, fresh }) {
      if (activity === undefined) return { cue: null, historyGap: null };
      const token = Array.from(activity.runId, byte => byte.toString(16).padStart(2, "0")).join("");
      const newRun = token !== run;
      const previous = newRun ? 0n : watermark;
      const changedReset = !newRun && reset !== activity.resetId;
      gap = retainedGap(activity, previous) ?? gap;
      if (newRun) gap = retainedGap(activity, 0n);
      const completions = kind === "delta" && fresh && !newRun && !changedReset
        ? activity.recentTransitions.filter(transition => transition.id > previous && transition.to === Phase.COMPLETE && transition.resetId === activity.resetId)
        : [];
      run = token;
      reset = activity.resetId;
      watermark = activity.transitionId > previous ? activity.transitionId : previous;
      const latest = completions.at(-1);
      return {
        cue: latest ? `Round ${latest.completedRounds} earned · both participants proved outward and inward movement` : null,
        historyGap: gap,
      };
    },
  };
}
