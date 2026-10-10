// Generated message inputs used by decoder and actual viewer-path tests.
export function shape() {
  const primitives = [
    ["box", { sizeXMm: 1200n, sizeYMm: 800n, sizeZMm: 600n }],
    ["sphere", { radiusMm: 200n }],
    ["capsule", { radiusMm: 100n, segmentLengthMm: 500n }],
    ["cylinder", { radiusMm: 100n, heightMm: 400n }],
    ["cone", { radiusMm: 120n, heightMm: 300n }],
    ["panel", { widthMm: 300n, heightMm: 200n, thicknessMm: 20n }],
  ];
  return { nodes: primitives.map(([kind, value], index) => ({
    nodeId: index + 1,
    parentNodeId: index === 0 ? 0 : 1,
    transform: {
      translation: { xMm: BigInt(index * 10), yMm: 20n, zMm: -30n },
      rotation: { x: 0, y: 0, z: 0, w: 1 },
    },
    jointName: `joint_${index}`,
    color: { red: 10, green: 20, blue: 30, alpha: 255 },
    materialTags: ["metal", `part_${index}`],
    primitive: { case: kind, value },
  })) };
}

export function entity(entityId, overrides = {}) {
  return { entityId, revision: 1n, positionMm: { xMm: 1500n, yMm: 0n, zMm: -2250n }, shape: shape(), ...overrides };
}

// Typed complete replacement state; no body poses are fabricated by activity.
export function activity(overrides = {}) {
  return {
    version: 1, runId: new Uint8Array(16).fill(9), resetId: 0n,
    observedTick: 42n, phase: 3, phaseStartedTick: 20n, completedRounds: 0n,
    participants: [-2750n, 2750n].map((xMm, index) => ({
      bodyId: BigInt(index + 1), availability: 4,
      phaseStartPositionMm: { xMm, yMm: 0n, zMm: 0n },
      travelMm: 0, contributionMm: 0,
    })),
    rules: { innerMinMm: 1800, innerMaxMm: 2200, separateMm: 5500,
      minTravelMm: 1000, minContributionMm: 1000, dwellTicks: 8,
      completeHoldTicks: 20, recoveryHoldTicks: 20, phaseTimeoutTicks: 400 },
    transitionId: 1n,
    recentTransitions: [{ id: 1n, tick: 20n, from: 2, to: 3, completedRounds: 0n, reason: 1, resetId: 0n }],
    formationCenterMm: { xMm: 0n, yMm: 0n, zMm: 0n },
    formationAxisMm: { xMm: 1000n, yMm: 0n, zMm: 0n },
    creditStartedTick: 20n, dwellTicks: 0, reason: 1,
    ...overrides,
  };
}

export function completedActivity(overrides = {}) {
  const state = activity();
  return activity({ phase: 4, phaseStartedTick: 42n, completedRounds: 1n,
    participants: state.participants.map(participant => ({ ...participant, travelMm: 1000, contributionMm: 1000, earnedTick: 35n })),
    dwellTicks: 8, transitionId: 2n,
    recentTransitions: [...state.recentTransitions, { id: 2n, tick: 42n, from: 3, to: 4, completedRounds: 1n, reason: 1, resetId: 0n }],
    ...overrides,
  });
}
