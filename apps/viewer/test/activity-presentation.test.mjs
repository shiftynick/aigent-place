import assert from "node:assert/strict";
import test from "node:test";
import { create } from "@bufbuild/protobuf";
import { DemoActivitySnapshotSchema, validateDemoActivity } from "@aigent-place/protocol";
import { activityPresentation, createActivityCueTracker } from "../src/activity-presentation.js";
import { activity, completedActivity } from "./snapshot-fixtures.mjs";
const validated = state => validateDemoActivity(create(DemoActivitySnapshotSchema,
  Object.fromEntries(Object.entries(state).filter(([key]) => key !== "$typeName"))));

test("public activity exposes server phase, rules, own contribution, proof and earned total without selection", () => {
  const state = validated(activity({ participants: [
    { ...activity().participants[0], travelMm: 1000, contributionMm: 1250, earnedTick: 30n },
    { ...activity().participants[1], travelMm: 500, contributionMm: -200 },
  ] }));
  const rows = activityPresentation(state, new Map([["1", {}], ["2", {}]]), { fresh: true });
  assert.equal(rows.phase, "REGROUP · Return together");
  assert.equal(rows.count, "0 rounds earned");
  assert.match(rows.rules, /5\.50 m → return 1\.80–2\.20 m/);
  assert.match(rows.rules, /own travel ≥ 1\.00 m \+ net ≥ 1\.00 m/);
  assert.equal(rows.dwell, "Together hold: 0/8 ticks (0.40 s)");
  assert.equal(rows.participants[0].identity, "Body 1");
  assert.match(rows.participants[0].progress, /Own travel 1\.00\/1\.00 m · inward net 1\.25\/1\.00 m/);
  assert.equal(rows.participants[0].proof, "Proof earned at tick 30");
  assert.match(rows.participants[1].progress, /inward net -0\.20\/1\.00 m/);
  assert.equal(rows.participants[1].proof, "Proof pending");
  assert.equal(rows.history.length, state.recentTransitions.length);
});

test("AOI omission, absence, stale state and unavailable participants remain explicit", () => {
  assert.equal(activityPresentation(undefined, new Map(), { fresh: false }), null);
  const state = validated(activity({ phase: 5, phaseStartedTick: 42n, resetId: 1n, reason: 2,
    creditStartedTick: undefined, formationCenterMm: undefined, formationAxisMm: undefined,
    participants: activity().participants.map((participant, index) => ({ ...participant, phaseStartPositionMm: undefined, availability: index === 0 ? 4 : 3 })),
    transitionId: 2n, recentTransitions: [...activity().recentTransitions, { id: 2n, tick: 42n, from: 3, to: 5, completedRounds: 0n, resetId: 1n, reason: 2 }],
  }));
  const rows = activityPresentation(state, new Map([["1", {}]]), { fresh: false, historyGap: "History gap" });
  assert.match(rows.status, /^Last observed tick 42 · live activity unavailable$/);
  assert.equal(rows.participants[0].observation, "");
  assert.equal(rows.participants[1].availability, "disconnected");
  assert.equal(rows.participants[1].observation, "body not in this observation");
  assert.equal(rows.historyGap, "History gap");
  const suspended = activityPresentation(validated({ ...state, reason: 7, recentTransitions: [
    state.recentTransitions[0], { ...state.recentTransitions[1], reason: 7 },
  ] }), new Map(), { fresh: true });
  assert.match(suspended.goal, /unsafe or unsupported/);
  assert.equal(suspended.participants[0].progress, "No movement credit in this phase");
});

test("initial and recovery FULL restore earned count/history silently; only later unseen DELTA cues once", () => {
  const tracker = createActivityCueTracker();
  const state = validated(completedActivity());
  assert.equal(tracker.observe(state, { kind: "full", fresh: true }).cue, null);
  assert.equal(tracker.observe(state, { kind: "delta", fresh: true }).cue, null);
  tracker.stale();
  assert.equal(tracker.observe(state, { kind: "full", fresh: true }).cue, null);
  const later = validated(completedActivity({ observedTick: 102n, phaseStartedTick: 102n, creditStartedTick: 82n,
    participants: state.participants.map(participant => ({ ...participant, earnedTick: 96n })), completedRounds: 2n, transitionId: 5n, recentTransitions: [
    ...state.recentTransitions,
    { id: 3n, tick: 62n, from: 4, to: 2, completedRounds: 1n, reason: 1, resetId: 0n },
    { id: 4n, tick: 82n, from: 2, to: 3, completedRounds: 1n, reason: 1, resetId: 0n },
    { id: 5n, tick: 102n, from: 3, to: 4, completedRounds: 2n, reason: 1, resetId: 0n },
  ] }));
  assert.match(tracker.observe(later, { kind: "delta", fresh: true }).cue, /^Round 2 earned/);
  assert.equal(tracker.observe(later, { kind: "delta", fresh: true }).cue, null);
  assert.equal(tracker.stale().cue, null);
});

test("FULL jump, new run, reset and stale delta cannot replay retained completions", () => {
  const tracker = createActivityCueTracker();
  tracker.observe(validated(activity()), { kind: "full", fresh: true });
  assert.equal(tracker.observe(validated(completedActivity()), { kind: "full", fresh: true }).cue, null);
  assert.equal(tracker.observe(validated(completedActivity()), { kind: "delta", fresh: true }).cue, null);
  const newRun = validated(completedActivity({ runId: new Uint8Array(16).fill(10) }));
  assert.equal(tracker.observe(newRun, { kind: "delta", fresh: true }).cue, null);
  const reset = validated({ ...newRun, phase: 5, phaseStartedTick: 43n, observedTick: 43n, reason: 2,
    resetId: 1n, transitionId: 3n, creditStartedTick: undefined, dwellTicks: 0,
    formationCenterMm: undefined, formationAxisMm: undefined,
    participants: newRun.participants.map(participant => ({ ...participant, phaseStartPositionMm: undefined, travelMm: 0, contributionMm: 0, earnedTick: undefined })),
    recentTransitions: [...newRun.recentTransitions, { id: 3n, tick: 43n, from: 4, to: 5, completedRounds: 1n, reason: 2, resetId: 1n }],
  });
  assert.equal(tracker.observe(reset, { kind: "delta", fresh: true }).cue, null);
  const noLive = validated(completedActivity({ ...newRun, resetId: 1n, observedTick: 122n, phaseStartedTick: 122n,
    creditStartedTick: 100n, completedRounds: 2n, transitionId: 7n,
    participants: newRun.participants.map(participant => ({ ...participant, earnedTick: 116n })),
    recentTransitions: [...reset.recentTransitions,
      { id: 4n, tick: 63n, from: 5, to: 1, completedRounds: 1n, reason: 1, resetId: 1n },
      { id: 5n, tick: 64n, from: 1, to: 2, completedRounds: 1n, reason: 1, resetId: 1n },
      { id: 6n, tick: 100n, from: 2, to: 3, completedRounds: 1n, reason: 1, resetId: 1n },
      { id: 7n, tick: 122n, from: 3, to: 4, completedRounds: 2n, reason: 1, resetId: 1n },
    ],
  }));
  assert.equal(tracker.observe(noLive, { kind: "delta", fresh: false }).cue, null);
  assert.equal(tracker.observe(noLive, { kind: "delta", fresh: true }).cue, null);
  assert.equal(createActivityCueTracker().observe(noLive, { kind: "full", fresh: true }).cue, null,
    "browser reload adopts current history without a cross-reload effect claim");
});

test("retention gaps are disclosed for initial history and for missed fresh IDs", () => {
  const state = validated(completedActivity({ transitionId: 10n, recentTransitions: [
    { ...completedActivity().recentTransitions.at(-1), id: 10n },
  ] }));
  const initial = createActivityCueTracker().observe(state, { kind: "full", fresh: true });
  assert.equal(initial.cue, null);
  assert.equal(initial.historyGap, "History gap: transitions 1–9 are no longer retained.");
  const tracker = createActivityCueTracker();
  tracker.observe(validated(activity()), { kind: "full", fresh: true });
  const fresh = tracker.observe(state, { kind: "delta", fresh: true });
  assert.match(fresh.cue, /^Round 1 earned/);
  assert.equal(fresh.historyGap, "History gap: transitions 2–9 are no longer retained.");
  assert.equal(tracker.stale().historyGap, fresh.historyGap);
});

test("progress loss does not claim timeout and counter exhaustion does not promise recovery", () => {
  const complete = completedActivity();
  const stopped = { ...complete, phase: 5, phaseStartedTick: 43n, observedTick: 43n,
    resetId: 1n, transitionId: 3n, reason: 6, creditStartedTick: undefined, dwellTicks: 0,
    formationCenterMm: undefined, formationAxisMm: undefined,
    participants: complete.participants.map(participant => ({ ...participant, phaseStartPositionMm: undefined, travelMm: 0, contributionMm: 0, earnedTick: undefined })),
    recentTransitions: [...complete.recentTransitions, { id: 3n, tick: 43n, from: 4, to: 5, completedRounds: 1n, reason: 6, resetId: 1n }],
  };
  const progressLost = activityPresentation(validated(stopped), new Map(), { fresh: true });
  assert.match(progressLost.goal, /Progress no longer qualifies or the phase timed out/);
  assert.equal(progressLost.count, "1 round earned");
  const max = 0xffffffffffffffffn;
  const exhausted = activityPresentation(validated({ ...stopped, reason: 8, transitionId: max,
    recentTransitions: [{ ...stopped.recentTransitions.at(-1), id: max, reason: 8 }],
  }), new Map(), { fresh: true });
  assert.match(exhausted.goal, /Restart the temporary demo to begin a new run/);
  assert.doesNotMatch(exhausted.goal, /Recovery/);
  assert.equal(exhausted.count, "1 round earned");
});
