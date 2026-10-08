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
