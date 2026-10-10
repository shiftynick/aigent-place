import assert from "node:assert/strict";
import test from "node:test";
import * as THREE from "three";
import { observedBounds, fitObservedBounds, bodyColor, admitObservedBounds, planObservedFit, minimumContainingDistance, stepAutomaticFit } from "../src/camera.js";

import { create } from "@bufbuild/protobuf";
import { ShapeNodeSchema, ShapeTreeSchema } from "@aigent-place/protocol";
import { prepareShapeTree, createShapeVisual } from "../src/shape-visuals.js";

const cubeBounds = position => new THREE.Box3().setFromCenterAndSize(position, new THREE.Vector3(1, 1, 1));

function assertBoundsVisible(camera, bounds) {
  camera.updateMatrixWorld();
  for (const x of [bounds.min.x, bounds.max.x]) {
    for (const y of [bounds.min.y, bounds.max.y]) {
      for (const z of [bounds.min.z, bounds.max.z]) {
        const projected = new THREE.Vector3(x, y, z).project(camera);
        assert.ok(Math.abs(projected.x) < 1 && Math.abs(projected.y) < 1 && Math.abs(projected.z) < 1,
          `corner outside view: ${projected.toArray()}`);
      }
    }
  }
}

function projectedCubeBounds(camera, center) {
  const bounds = new THREE.Box2();
  for (const x of [-0.5, 0.5]) {
    for (const y of [-0.5, 0.5]) {
      for (const z of [-0.5, 0.5]) {
        const point = center.clone().add(new THREE.Vector3(x, y, z)).project(camera);
        bounds.expandByPoint(new THREE.Vector2(point.x, point.y));
      }
    }
  }
  return bounds;
}

test("fitted view exposes disjoint same-height bodies along the viewing direction", () => {
  // 1.56 m along the horizontal diagonal leaves >0.1 m between the cube
  // extents on both axes; the old shallow view still hides the far center.
  const offset = 1.56 / (2 * Math.SQRT2);
  const far = new THREE.Vector3(-offset, 8.905, -offset);
  const near = new THREE.Vector3(offset, 8.905, offset);
  const bounds = observedBounds([far, near].map(cubeBounds));
  const nearCube = new THREE.Box3().setFromCenterAndSize(near, new THREE.Vector3(1, 1, 1));
  const farCube = new THREE.Box3().setFromCenterAndSize(far, new THREE.Vector3(1, 1, 1));
  assert.equal(nearCube.intersectsBox(farCube), false, "regression fixture cubes must be disjoint");
  for (const aspect of [0.25, 0.5, 1, 16 / 9, 3]) {
    const camera = new THREE.PerspectiveCamera(60, aspect, 0.1, 1000);
    const controls = { target: new THREE.Vector3(), update() {} };
    fitObservedBounds(camera, controls, bounds);
    assertBoundsVisible(camera, bounds);
    const centerRay = new THREE.Ray(camera.position.clone(), far.clone().sub(camera.position).normalize());
    assert.equal(centerRay.intersectsBox(nearCube), false, `near cube hides far center at aspect ${aspect}`);
    const projected = [far, near].map(center => projectedCubeBounds(camera, center));
    const overlap = projected[0].clone().intersect(projected[1]).getSize(new THREE.Vector2());
    const areas = projected.map(box => { const size = box.getSize(new THREE.Vector2()); return size.x * size.y; });
    const coveredFraction = overlap.x * overlap.y / Math.min(...areas);
    assert.ok(coveredFraction < 0.3, `projected cube bounds overlap by ${coveredFraction} at aspect ${aspect}`);
  }
});

test("real Three camera fits supplied elevated and separated shape bounds across aspects", () => {
  const positions = [new THREE.Vector3(-25, 8.905, -5), new THREE.Vector3(30, 17, 20)];
  const bounds = observedBounds(positions.map(cubeBounds));
  assert.deepEqual(bounds.min.toArray(), [-25.5, 8.405, -5.5]);
  assert.deepEqual(bounds.max.toArray(), [30.5, 17.5, 20.5]);
  for (const aspect of [2, 4 / 3, 0.25]) {
    const camera = new THREE.PerspectiveCamera(60, aspect, 0.1, 1000);
    const controls = { target: new THREE.Vector3(), update() {} };
    fitObservedBounds(camera, controls, bounds);
    assert.deepEqual(controls.target.toArray(), bounds.getCenter(new THREE.Vector3()).toArray());
    assertBoundsVisible(camera, bounds);
  }
});

test("single elevated body keeps movement space and empty observations have no bounds", () => {
  assert.equal(observedBounds([]), null);
  const bounds = observedBounds([cubeBounds(new THREE.Vector3(4, 8.905, 1))]);
  const camera = new THREE.PerspectiveCamera(60, 4 / 3, 0.1, 1000);
  const controls = { target: new THREE.Vector3(), update() {} };
  fitObservedBounds(camera, controls, bounds);
  assert.ok(camera.position.distanceTo(controls.target) >= 6, "bounded movement retains room around one body");
  assert.equal(controls.target.y, 8.905);
  assertBoundsVisible(camera, observedBounds([cubeBounds(new THREE.Vector3(6, 8.905, 1))]));
});

test("body color stays tied to stable entity ID and differentiates the fixture bodies", () => {
  assert.equal(bodyColor(1n).getHex(), bodyColor("1").getHex());
  assert.notEqual(bodyColor(1n).getHex(), bodyColor(2n).getHex());
});

test("shape bounds include offset roots, tall parts and asymmetry without placeholder padding", () => {
  const first = new THREE.Box3(new THREE.Vector3(-8, 3, 4), new THREE.Vector3(-2, 15, 6));
  const second = new THREE.Box3(new THREE.Vector3(10, -7, -20), new THREE.Vector3(11, -6, -19));
  const bounds = observedBounds([first, second]);
  assert.deepEqual(bounds.min.toArray(), [-8, -7, -20]);
  assert.deepEqual(bounds.max.toArray(), [11, 15, 6]);
  assert.deepEqual(first.min.toArray(), [-8, 3, 4], "fitting must not mutate shape bounds");
  for (const aspect of [0.25, 1, 3]) {
    const camera = new THREE.PerspectiveCamera(60, aspect, 0.1, 1000);
    fitObservedBounds(camera, { target: new THREE.Vector3(), update() {} }, bounds);
    assertBoundsVisible(camera, bounds);
  }
});

// These oracles use real camera matrices and released mesh vertices, not the
// implementation's dot products or its own reported containment classification.
const aspects = [16 / 9, 4 / 3, 0.5, 0.25];
const tuning = Object.freeze({ timeConstantSeconds: 0.25, maxStepSeconds: 0.1, margin: 0.95, minDistance: 0.5, nearMinimum: 0.01, depthFloor: 0.02 });
const growthTuning = Object.freeze({ paddingMetres: 1, minimumGrowthMetres: 0.25 });
const outward = new THREE.Vector3(1, Math.sqrt(6), 1).normalize();
const close = (actual, expected, tolerance = 1e-9) => assert.ok(Math.abs(actual - expected) <= tolerance, `${actual} != ${expected} within ${tolerance}`);
const pointBox = point => new THREE.Box3(point.clone(), point.clone());
function corners(bounds) {
  const points = [];
  for (const x of [bounds.min.x, bounds.max.x]) for (const y of [bounds.min.y, bounds.max.y]) for (const z of [bounds.min.z, bounds.max.z]) points.push(new THREE.Vector3(x, y, z));
  return points;
}
function cameraFor(state, aspect, near = 1e-6, far = 1e9) {
  const camera = new THREE.PerspectiveCamera(60, aspect, near, far);
  camera.position.copy(state.target).addScaledVector(outward, state.distance);
  camera.lookAt(state.target);
  camera.updateMatrixWorld(true);
  return camera;
}
function frameFor(input) {
  let frame;
  assert.doesNotThrow(() => { frame = stepAutomaticFit(input); }, "a valid complete automatic frame must not fail");
  return frame;
}
function visiblePoints(frame, aspect, points) {
  const camera = cameraFor(frame.state, aspect, frame.near, frame.far);
  assert.ok(Number.isFinite(frame.near) && frame.near >= tuning.nearMinimum && frame.far > frame.near);
  for (const point of points) {
    const view = point.clone().applyMatrix4(camera.matrixWorldInverse);
    assert.ok(-view.z > frame.near && -view.z < frame.far, `actual view depth ${-view.z} outside ${frame.near}..${frame.far}`);
    const projected = point.clone().project(camera);
    assert.ok(Math.abs(projected.x) <= tuning.margin + 1e-8 && Math.abs(projected.y) <= tuning.margin + 1e-8 && Math.abs(projected.z) < 1,
      `real NDC outside guarded cone/depth: ${projected.toArray()}`);
  }
  return camera;
}
function matrixContains(target, distance, aspect, points) {
  const camera = cameraFor({ target, distance }, aspect);
  return points.every(point => {
    const view = point.clone().applyMatrix4(camera.matrixWorldInverse);
    const projected = point.clone().project(camera);
    return -view.z >= tuning.depthFloor && Math.abs(projected.x) <= tuning.margin && Math.abs(projected.y) <= tuning.margin;
  });
}
function matrixMinimum(target, aspect, points) {
  let high = tuning.minDistance;
  while (!matrixContains(target, high, aspect, points)) {
    high *= 2;
    assert.ok(high < 1e9, "finite oracle fixture has a bounded visible solution");
  }
  let low = 0;
  for (let count = 0; count < 70; count++) {
    const middle = (low + high) / 2;
    if (matrixContains(target, middle, aspect, points)) high = middle; else low = middle;
  }
  return Math.max(tuning.minDistance, high);
}
const stepInput = (state, goal, displayedBoxes = [], aspect = 4 / 3, overrides = {}) => ({
  state, goal, displayedBoxes, projection: { fovDeg: 60, aspect }, elapsedSeconds: 1 / 60, snap: false, ease: true, tuning, ...overrides,
});
const stateSnapshot = state => ({ target: state.target.toArray(), distance: state.distance });
const goalSnapshot = goal => ({ ...stateSnapshot(goal), radius: goal.radius });
const boxSnapshot = box => box === null ? null : [box.min.toArray(), box.max.toArray()];

test("once-padded applied history admits accumulated growth against E without repeated padding", () => {
  const first = cubeBounds(new THREE.Vector3());
  const original = boxSnapshot(first);
  let result = admitObservedBounds(null, null, first, growthTuning);
  assert.equal(result.admitted, true);
  assert.deepEqual(boxSnapshot(result.history), original);
  assert.deepEqual(boxSnapshot(result.envelope), [[-1.5, -1.5, -1.5], [1.5, 1.5, 1.5]]);
  for (let index = 0; index < 10; index++) {
    result = admitObservedBounds(result.history, result.envelope, first, growthTuning);
    assert.equal(result.admitted, false, "identical applied bounds cannot re-pad or admit again");
    assert.deepEqual(boxSnapshot(result.envelope), [[-1.5, -1.5, -1.5], [1.5, 1.5, 1.5]]);
  }
  for (const offset of [0.1, 0.2, 0.3]) {
    const applied = cubeBounds(new THREE.Vector3(offset, 0, 0));
    result = admitObservedBounds(result.history, result.envelope, applied, growthTuning);
    assert.equal(result.admitted, offset === 0.3, "small increments accumulate against admitted E, not the previous update");
    assert.ok(result.envelope.containsBox(applied), "padding keeps unadmitted applied growth contained");
  }
  close(result.history.max.x, 0.8);
  close(result.envelope.max.x, 1.8);
  const before = [boxSnapshot(result.history), boxSnapshot(result.envelope)];
  const empty = admitObservedBounds(result.history, result.envelope, null, growthTuning);
  assert.equal(empty.admitted, false);
  assert.deepEqual([boxSnapshot(empty.history), boxSnapshot(empty.envelope)], before, "empty/departure update does not shrink");
  assert.notEqual(empty.history, result.history);
  assert.notEqual(empty.envelope, result.envelope);
  empty.history.min.x = -999;
  empty.envelope.max.x = 999;
  assert.deepEqual([boxSnapshot(result.history), boxSnapshot(result.envelope)], before, "returned clones cannot change previous H/E");
  assert.deepEqual(boxSnapshot(first), original);
  assert.deepEqual(admitObservedBounds(null, null, null, growthTuning), { history: null, envelope: null, admitted: false });
});

test("every outward face admits at the inclusive threshold and departure cannot erase older geometry", () => {
  for (const axis of ["x", "y", "z"]) for (const sign of [-1, 1]) {
    const initial = admitObservedBounds(null, null, cubeBounds(new THREE.Vector3()), growthTuning);
    const position = new THREE.Vector3(); position[axis] = sign * 0.25;
    const next = admitObservedBounds(initial.history, initial.envelope, cubeBounds(position), growthTuning);
    assert.equal(next.admitted, true, `${axis}/${sign} inclusive threshold`);
    assert.ok(next.history.containsBox(initial.history));
    assert.ok(next.envelope.containsBox(initial.envelope));
    const smaller = admitObservedBounds(next.history, next.envelope, pointBox(position), growthTuning);
    assert.equal(smaller.admitted, false);
    assert.deepEqual(boxSnapshot(smaller.history), boxSnapshot(next.history));
  }
});

test("matrix oracle verifies axial sign, product denominator and D_min geometric boundary across aspects", () => {
  const target = new THREE.Vector3(-7, 4, 11);
  const boxes = [cubeBounds(new THREE.Vector3(25, 17, -4)), cubeBounds(new THREE.Vector3(-19, -3, 21)), cubeBounds(target.clone().addScaledVector(outward, 13))];
  const upAxis = new THREE.Vector3(-Math.sqrt(3 / 8), 0.5, -Math.sqrt(3 / 8));
  // Separate fixtures force both lateral terms to bind; a global maximum can
  // conceal a broken vertical denominator behind a stronger horizontal corner.
  const scenes = [boxes, [cubeBounds(target.clone().addScaledVector(upAxis, 20).addScaledVector(outward, 8))]];
  for (const scene of scenes) for (const aspect of aspects) {
    const points = scene.flatMap(corners);
    const distance = minimumContainingDistance({ fovDeg: 60, aspect }, target, scene, tuning);
    const expected = matrixMinimum(target, aspect, points);
    close(distance, expected, 1e-7);
    assert.equal(matrixContains(target, distance + 1e-4, aspect, points), true);
    assert.equal(matrixContains(target, distance - 1e-4, aspect, points), false, "active geometric corner, not minDistance floor, binds");
  }
  assert.equal(minimumContainingDistance({ fovDeg: 60, aspect: 1 }, target, [], tuning), tuning.minDistance);
});

test("guard contains behind-camera and near-floor axial boxes with actual XYZ clipping and rounding", () => {
  const goal = planObservedFit({ fovDeg: 60, aspect: 1 }, cubeBounds(new THREE.Vector3()));
  for (const length of [10_000, 190_000]) {
    const axial = outward.clone().multiplyScalar(length);
    const box = new THREE.Box3().setFromCenterAndSize(axial, new THREE.Vector3(0.000002, 0.000002, 0.000002));
    for (const aspect of aspects) {
      const frame = frameFor(stepInput({ target: new THREE.Vector3(), distance: 0.5 }, goal, [box], aspect, { ease: false }));
      assert.ok(frame.state.distance > length, "body began behind the eye and guard increases distance");
      close(frame.near, 0.01, 1e-7);
      const camera = visiblePoints(frame, aspect, corners(box));
      const minimumDepth = Math.min(...corners(box).map(point => -point.applyMatrix4(camera.matrixWorldInverse).z));
      assert.ok(minimumDepth >= tuning.depthFloor, `outward rounding retains actual floor: ${minimumDepth}`);
      const next = frameFor(stepInput(frame.state, goal, [box], aspect, { ease: false }));
      close(next.state.distance, frame.state.distance, 1e-7);
    }
  }
  const rear = cubeBounds(outward.clone().multiplyScalar(-190_000));
  const rearFrame = frameFor(stepInput({ target: new THREE.Vector3(), distance: 1 }, goal, [rear], 0.25, { ease: false }));
  assert.ok(rearFrame.far > 190_000, "far follows actual depth, not the tiny unrelated goal radius");
  visiblePoints(rearFrame, 0.25, corners(rear));
});

function shapeNode(nodeId, primitive, parentNodeId, position, quaternion) {
  return create(ShapeNodeSchema, { nodeId, parentNodeId, primitive, transform: {
    translation: { xMm: BigInt(Math.round(position.x * 1000)), yMm: BigInt(Math.round(position.y * 1000)), zMm: BigInt(Math.round(position.z * 1000)) },
    rotation: { x: quaternion.x, y: quaternion.y, z: quaternion.z, w: quaternion.w },
  } });
}
function renderedFixture(nodes, rootPosition, check) {
  const visual = createShapeVisual(prepareShapeTree(create(ShapeTreeSchema, { nodes })));
  try {
    visual.root.position.copy(rootPosition);
    visual.root.updateMatrixWorld(true);
    const vertices = [];
    visual.root.traverse(mesh => {
      if (!mesh.isMesh) return;
      const position = mesh.geometry.getAttribute("position");
      for (let index = 0; index < position.count; index++) vertices.push(new THREE.Vector3().fromBufferAttribute(position, index).applyMatrix4(mesh.matrixWorld));
    });
    assert.ok(vertices.length > 100, "oracle uses actual released tessellated geometry");
    const bounds = visual.localBounds.clone().translate(rootPosition);
    const toleranceBounds = bounds.clone().expandByScalar(1e-6);
    for (const vertex of vertices) assert.ok(toleranceBounds.containsPoint(vertex), "analytical composed bounds conservatively cover real Float32 vertices within tolerance");
    check(bounds, vertices);
  } finally { visual.dispose(); }
}

test("actual millimetre shape vertices satisfy axial near-floor and far-depth planes at lagged roots", () => {
  const goal = planObservedFit({ fovDeg: 60, aspect: 1 }, cubeBounds(new THREE.Vector3()));
  for (const length of [10_000, 190_000, -190_000]) {
    // Both the old display root and the new local shape center are canonical.
    // The new applied root would be -half, placing the shape at the origin.
    const half = outward.clone().multiplyScalar(length / 2);
    half.set(...half.toArray().map(value => Math.round(value * 1000) / 1000));
    assert.ok(half.toArray().every(value => Math.abs(value) < 100_000));
    const nodes = [shapeNode(1, { case: "sphere", value: { radiusMm: 1n } }, 0, half, new THREE.Quaternion())];
    renderedFixture(nodes, half, (displayed, vertices) => {
      const applied = displayed.clone().translate(half.clone().multiplyScalar(-2));
      assert.ok(applied.min.toArray().every(value => value >= -100_000) && applied.max.toArray().every(value => value <= 100_000));
      for (const aspect of aspects) {
        const frame = frameFor(stepInput({ target: new THREE.Vector3(), distance: 1 }, goal, [displayed], aspect, { ease: false }));
        const camera = visiblePoints(frame, aspect, [...corners(displayed), ...vertices]);
        if (length > 0) {
          const minimumDepth = Math.min(...corners(displayed).map(point => -point.applyMatrix4(camera.matrixWorldInverse).z));
          assert.ok(minimumDepth >= tuning.depthFloor);
          close(frame.near, tuning.nearMinimum, 1e-7);
        } else assert.ok(frame.far > 190_000);
      }
    });
  }
});

test("actual six-primitive composed vertices and noncommuting rotations fit during eased transitions", () => {
  const primitives = [
    ["box", { sizeXMm: 1200n, sizeYMm: 1800n, sizeZMm: 800n }], ["sphere", { radiusMm: 350n }],
    ["capsule", { radiusMm: 250n, segmentLengthMm: 1500n }], ["cylinder", { radiusMm: 300n, heightMm: 1250n }],
    ["cone", { radiusMm: 400n, heightMm: 1600n }], ["panel", { widthMm: 2000n, heightMm: 1000n, thicknessMm: 40n }],
  ];
  const rootRotation = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), 0.71);
  const childRotation = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), -0.43);
  const nodes = primitives.map(([kind, value], index) => shapeNode(index + 1, { case: kind, value }, index === 0 ? 0 : 1,
    new THREE.Vector3(2 + index * 1.3, 1 + index * 0.4, -3 + index), index === 0 ? rootRotation : childRotation));
  renderedFixture(nodes, new THREE.Vector3(30, 9, -17), (box, vertices) => {
    for (const aspect of aspects) {
      const goal = planObservedFit({ fovDeg: 60, aspect }, box);
      let state = { target: new THREE.Vector3(-8, 2, 1), distance: 2 };
      for (let index = 0; index < 30; index++) {
        const frame = frameFor(stepInput(state, goal, [box], aspect));
        visiblePoints(frame, aspect, [...corners(box), ...vertices]);
        state = frame.state;
      }
    }
  });
});

test("valid applied replacement can display beyond canonical bounds without leaking its guard into goal", () => {
  const identity = new THREE.Quaternion();
  const nodes = [shapeNode(1, { case: "sphere", value: { radiusMm: 100n } }, 0, new THREE.Vector3(-99_999, 0, 0), identity)];
  renderedFixture(nodes, new THREE.Vector3(-99_999, 0, 0), (displayed, vertices) => {
    assert.ok(displayed.max.x < -100_000, "lagged replacement really exceeds canonical ±100km");
    const applied = displayed.clone().translate(new THREE.Vector3(199_998, 0, 0));
    assert.ok(applied.min.x >= -100_000 && applied.max.x <= 100_000, "same new shape at its applied root is canonical");
    for (const aspect of aspects) {
      const goal = planObservedFit({ fovDeg: 60, aspect }, applied);
      const before = goalSnapshot(goal);
      const frame = frameFor(stepInput(null, goal, [displayed], aspect, { snap: true, ease: false }));
      visiblePoints(frame, aspect, [...corners(displayed), ...vertices]);
      assert.ok(frame.state.distance > goal.distance, "display-only correction is written into state");
      assert.deepEqual(goalSnapshot(goal), before, "display lag cannot grow permanent applied goal");
      assert.deepEqual(boxSnapshot(applied), boxSnapshot(displayed.clone().translate(new THREE.Vector3(199_998, 0, 0))));
    }
  });
});

test("settled sphere-fit goal already contains its envelope without activating the guard", () => {
  for (const envelope of [cubeBounds(new THREE.Vector3()), new THREE.Box3(new THREE.Vector3(-100, 15, -2), new THREE.Vector3(40, 90, 18))]) {
    for (const aspect of aspects) {
      const goal = planObservedFit({ fovDeg: 60, aspect }, envelope);
      assert.ok(goal.radius >= 3);
      const minimum = minimumContainingDistance({ fovDeg: 60, aspect }, goal.target, [envelope], tuning);
      assert.ok(minimum <= goal.distance, "near-floor and .95 margin must not fight settled 1.15 sphere fit");
      const frame = frameFor(stepInput(null, goal, [envelope], aspect, { snap: true }));
      assert.equal(frame.state.distance, goal.distance);
      visiblePoints(frame, aspect, corners(envelope));
    }
  }
});

test("coupled endpoint easing contains fixed geometry through intermediate real camera matrices", () => {
  const fixed = cubeBounds(new THREE.Vector3(4, 6, -3));
  for (const aspect of aspects) {
    const goal = planObservedFit({ fovDeg: 60, aspect }, fixed.clone().expandByScalar(5));
    const start = { target: new THREE.Vector3(-10, 1, 10), distance: 500 };
    assert.equal(matrixContains(start.target, start.distance, aspect, corners(fixed)), true);
    // A test-only larger cap samples almost the whole endpoint segment; the
    // separate timing test retains and verifies the live candidate .1 s cap.
    for (const dt of [0, 0.005, 0.025, 0.125, 0.25, 0.5, 1]) {
      const frame = frameFor(stepInput(start, goal, [fixed], aspect, { elapsedSeconds: dt, tuning: { ...tuning, maxStepSeconds: 1 } }));
      const alpha = 1 - Math.exp(-dt / tuning.timeConstantSeconds);
      const expectedTarget = start.target.clone().lerp(goal.target, alpha);
      close(frame.state.target.distanceTo(expectedTarget), 0);
      close(frame.state.distance, start.distance + (goal.distance - start.distance) * alpha);
      visiblePoints(frame, aspect, corners(fixed));
    }
  }
});

test("elapsed easing is partition-equivalent in isolation, capped deliberately, and snap precedes stale pause", () => {
  const goal = { target: new THREE.Vector3(12, -4, 7), distance: 20, radius: 3 };
  const start = { target: new THREE.Vector3(-2, 8, 1), distance: 50 };
  const advance = hz => {
    let state = start;
    for (let index = 0; index < hz; index++) state = frameFor(stepInput(state, goal, [], 4 / 3, { elapsedSeconds: 1 / hz })).state;
    return state;
  };
  const slow = advance(60), fast = advance(120);
  close(slow.target.distanceTo(fast.target), 0, 1e-12); close(slow.distance, fast.distance, 1e-12);
  const capped = frameFor(stepInput(start, goal, [], 4 / 3, { elapsedSeconds: 1000 }));
  const explicit = frameFor(stepInput(start, goal, [], 4 / 3, { elapsedSeconds: 0.1 }));
  assert.deepEqual(stateSnapshot(capped.state), stateSnapshot(explicit.state));
  const paused = frameFor(stepInput(start, goal, [], 4 / 3, { ease: false }));
  assert.deepEqual(stateSnapshot(paused.state), stateSnapshot(start));
  const snap = frameFor(stepInput(start, goal, [], 4 / 3, { ease: false, snap: true }));
  assert.deepEqual(stateSnapshot(snap.state), stateSnapshot(goal));
  assert.notEqual(snap.state.target, goal.target);
  const initial = frameFor(stepInput(null, goal, [], 4 / 3, { ease: false }));
  assert.deepEqual(stateSnapshot(initial.state), stateSnapshot(goal));
  assert.ok(initial.far >= 1000 && initial.near === 0.01, "empty display fallback remains finite without fake bounds");
});

test("stale guard remains active and state write-back recovers from one fixed-goal decaying outlier", () => {
  const goal = planObservedFit({ fovDeg: 60, aspect: 4 / 3 }, cubeBounds(new THREE.Vector3()));
  const original = goalSnapshot(goal);
  let state = { target: goal.target.clone(), distance: goal.distance };
  const firstBox = cubeBounds(new THREE.Vector3(80, 0, 0));
  const stale = frameFor(stepInput(state, goal, [firstBox], 4 / 3, { ease: false }));
  assert.deepEqual(stale.state.target.toArray(), state.target.toArray());
  assert.ok(stale.state.distance > state.distance);
  visiblePoints(stale, 4 / 3, corners(firstBox));
  state = stale.state;
  for (let index = 1; index <= 600; index++) {
    const displayed = cubeBounds(new THREE.Vector3(80 * Math.exp(-index / 6), 0, 0));
    const previous = state.distance;
    const frame = frameFor(stepInput(state, goal, [displayed]));
    assert.ok(frame.state.distance <= previous + 1e-9, "controlled monotone outlier is not a general motion theorem");
    assert.ok(frame.state.distance >= previous - (previous - goal.distance) * (1 - Math.exp(-(1 / 60) / 0.25)) - 1e-8, "release follows eased state instead of snapping to goal");
    visiblePoints(frame, 4 / 3, corners(displayed));
    state = frame.state;
  }
  close(state.distance, goal.distance, 1e-9);
  assert.deepEqual(goalSnapshot(goal), original);
});

test("pure outputs are clones and every complete input remains unchanged", () => {
  const envelope = cubeBounds(new THREE.Vector3(2, 4, 6));
  const projection = Object.freeze({ fovDeg: 60, aspect: 4 / 3 });
  const goal = planObservedFit(projection, envelope);
  const state = { target: new THREE.Vector3(-10, 4, 1), distance: 2 };
  const displayed = [cubeBounds(new THREE.Vector3(90, 3, 2))];
  const before = { goal: goalSnapshot(goal), state: stateSnapshot(state), boxes: displayed.map(boxSnapshot), envelope: boxSnapshot(envelope) };
  Object.freeze(goal.target); Object.freeze(goal); Object.freeze(state.target); Object.freeze(state);
  Object.freeze(displayed[0].min); Object.freeze(displayed[0].max); Object.freeze(displayed[0]); Object.freeze(displayed);
  const frame = frameFor(stepInput(state, goal, displayed));
  frame.state.target.set(999, 999, 999); frame.state.distance = 999;
  assert.deepEqual({ goal: goalSnapshot(goal), state: stateSnapshot(state), boxes: displayed.map(boxSnapshot), envelope: boxSnapshot(envelope) }, before);
  const planned = planObservedFit(projection, envelope); planned.target.set(99, 99, 99);
  assert.deepEqual(boxSnapshot(envelope), before.envelope);
});

test("invalid inputs and unrepresentable computed results reject with RangeError without partial mutation", () => {
  const validBox = cubeBounds(new THREE.Vector3());
  const validProjection = { fovDeg: 60, aspect: 1 };
  const goal = planObservedFit(validProjection, validBox);
  const state = { target: new THREE.Vector3(), distance: 1 };
  const invalidBoxes = [new THREE.Box3(), new THREE.Box3(new THREE.Vector3(1, 0, 0), new THREE.Vector3(-1, 0, 0)),
    new THREE.Box3(new THREE.Vector3(NaN, 0, 0), new THREE.Vector3(1, 1, 1)), new THREE.Box3(new THREE.Vector3(), new THREE.Vector3(Infinity, 1, 1)), {}];
  for (const bad of invalidBoxes) {
    assert.throws(() => admitObservedBounds(null, null, bad, growthTuning), RangeError);
    assert.throws(() => planObservedFit(validProjection, bad), RangeError);
    assert.throws(() => minimumContainingDistance(validProjection, new THREE.Vector3(), [bad], tuning), RangeError);
    assert.throws(() => stepAutomaticFit(stepInput(state, goal, [bad])), RangeError);
  }
  for (const projection of [null, {}, { fovDeg: 0, aspect: 1 }, { fovDeg: 180, aspect: 1 }, { fovDeg: NaN, aspect: 1 },
    { fovDeg: 60, aspect: 0 }, { fovDeg: 60, aspect: Infinity }, { fovDeg: Number.MIN_VALUE, aspect: Number.MIN_VALUE }]) {
    assert.throws(() => planObservedFit(projection, validBox), RangeError);
    assert.throws(() => minimumContainingDistance(projection, new THREE.Vector3(), [], tuning), RangeError);
    assert.throws(() => stepAutomaticFit(stepInput(state, goal, [], 1, { projection })), RangeError);
  }
  for (const growth of [{ paddingMetres: 0, minimumGrowthMetres: 0.25 }, { paddingMetres: 0.1, minimumGrowthMetres: 0.25 },
    { paddingMetres: 1, minimumGrowthMetres: 0 }, { paddingMetres: Infinity, minimumGrowthMetres: 0.25 }]) assert.throws(() => admitObservedBounds(null, null, validBox, growth), RangeError);
  for (const [key, value] of [["margin", 0], ["margin", 1], ["depthFloor", 0], ["minDistance", 0], ["timeConstantSeconds", 0],
    ["maxStepSeconds", NaN], ["nearMinimum", 0], ["nearMinimum", 0.02], ["timeConstantSeconds", Number.MIN_VALUE]]) {
    assert.throws(() => stepAutomaticFit(stepInput(state, goal, [], 1, { tuning: { ...tuning, [key]: value } })), RangeError, key);
  }
  for (const elapsedSeconds of [-1, NaN, Infinity]) assert.throws(() => stepAutomaticFit(stepInput(state, goal, [], 1, { elapsedSeconds })), RangeError);
  for (const edit of [{ snap: 1 }, { ease: undefined }, { goal: null }, { state: undefined }, { displayedBoxes: null },
    { goal: { ...goal, radius: 0 } }, { state: { target: new THREE.Vector3(Infinity, 0, 0), distance: 1 } }]) assert.throws(() => stepAutomaticFit(stepInput(state, goal, [], 1, edit)), RangeError);
  const extreme = pointBox(new THREE.Vector3(Number.MAX_VALUE, 0, 0));
  assert.throws(() => planObservedFit(validProjection, extreme), RangeError, "finite corners can have unrepresentable center/sphere");
  assert.throws(() => admitObservedBounds(null, null, extreme, { paddingMetres: Number.MAX_VALUE, minimumGrowthMetres: 1 }), RangeError, "padding can overflow");
  assert.throws(() => minimumContainingDistance(validProjection, new THREE.Vector3(-Number.MAX_VALUE, 0, 0), [extreme], tuning), RangeError, "finite corner-target difference can overflow");
  assert.throws(() => minimumContainingDistance({ fovDeg: 60, aspect: Number.MIN_VALUE }, new THREE.Vector3(), [validBox], tuning), RangeError, "unrepresentable guarded distance");
  assert.throws(() => stepAutomaticFit(stepInput(state, { target: new THREE.Vector3(), radius: Number.MAX_VALUE, distance: Number.MAX_VALUE }, [], 1, { snap: true })), RangeError, "finite goal can overflow fallback far");
  assert.deepEqual(stateSnapshot(state), { target: [0, 0, 0], distance: 1 });
  assert.deepEqual(boxSnapshot(validBox), [[-0.5, -0.5, -0.5], [0.5, 0.5, 0.5]]);
});
