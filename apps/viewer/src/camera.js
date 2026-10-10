import * as THREE from "three";

// Shape bounds already compose every local part transform. Keep fitting
// independent of tessellation, interpolation and the entity's origin choice.
export function observedBounds(shapeBounds) {
  const bounds = new THREE.Box3();
  for (const shape of shapeBounds) bounds.union(shape);
  return bounds.isEmpty() ? null : bounds;
}

export function fitObservedBounds(camera, controls, bounds) {
  const { target: center, radius, distance } = planObservedFit({ fovDeg: camera.fov, aspect: camera.aspect }, bounds);
  controls.target.copy(center);
  // A 60-degree elevation exposes horizontal separation between close bodies
  // that the shallow diagonal view can hide. Manual navigation remains free.
  camera.position.copy(center).addScaledVector(new THREE.Vector3(1, Math.sqrt(6), 1).normalize(), distance);
  camera.near = Math.max(0.01, distance / 10_000);
  camera.far = Math.max(1000, distance + radius * 4);
  camera.updateProjectionMatrix();
  camera.lookAt(center);
  controls.update();
}

/** @typedef {{target: THREE.Vector3, distance: number, radius: number}} FitGoal */
/** @typedef {{target: THREE.Vector3, distance: number}} FitState */
/** @typedef {{fovDeg: number, aspect: number}} Projection */
/** @typedef {{paddingMetres: number, minimumGrowthMetres: number}} GrowthTuning */
/** @typedef {{timeConstantSeconds: number, maxStepSeconds: number, margin: number,
 * minDistance: number, nearMinimum: number, depthFloor: number}} CameraTuning */

// Fixed Y-up lookAt basis. Presentation bounds may exceed canonical world
// coordinates during shape replacement at an interpolating display root.
const direction = [1 / Math.sqrt(8), Math.sqrt(3) / 2, 1 / Math.sqrt(8)];
const right = [Math.SQRT1_2, 0, -Math.SQRT1_2];
const up = [-Math.sqrt(3 / 8), 0.5, -Math.sqrt(3 / 8)];
const axes = ["x", "y", "z"];

function invalid(reason) { throw new RangeError(`invalid automatic fit: ${reason}`); }
function finite(value, name) {
  if (!Number.isFinite(value)) invalid(name);
  return value;
}
function positive(value, name) {
  if (finite(value, name) <= 0) invalid(name);
  return value;
}
function vector(value, name) {
  if (!(value instanceof THREE.Vector3)) invalid(name);
  for (const axis of axes) finite(value[axis], name);
}
function box(value, name) {
  if (!(value instanceof THREE.Box3)) invalid(name);
  vector(value.min, name);
  vector(value.max, name);
  if (axes.some(axis => value.min[axis] > value.max[axis])) invalid(name);
}
function projectionTangents(projection) {
  if (!projection) invalid("projection");
  const fov = positive(projection.fovDeg, "fov");
  if (fov >= 180) invalid("fov");
  const vertical = positive(Math.tan(THREE.MathUtils.degToRad(fov / 2)), "vertical tangent");
  const horizontal = positive(vertical * positive(projection.aspect, "aspect"), "horizontal tangent");
  return { vertical, horizontal };
}
function guardTuning(tuning) {
  if (!tuning) invalid("guard tuning");
  const margin = positive(tuning.margin, "margin");
  if (margin >= 1) invalid("margin");
  positive(tuning.depthFloor, "depth floor");
  positive(tuning.minDistance, "minimum distance");
}
function pose(value, name, goal = false) {
  if (!value) invalid(name);
  vector(value.target, `${name} target`);
  positive(value.distance, `${name} distance`);
  if (goal) positive(value.radius, "goal radius");
}
function displayBoxes(values) {
  if (!Array.isArray(values)) invalid("displayed boxes");
  for (const value of values) box(value, "displayed box");
}
function eachCorner(boxes, target, visit) {
  for (const bounds of boxes) {
    for (const x of [bounds.min.x, bounds.max.x]) {
      for (const y of [bounds.min.y, bounds.max.y]) {
        for (const z of [bounds.min.z, bounds.max.z]) {
          const v = [finite(x - target.x, "corner offset"), finite(y - target.y, "corner offset"), finite(z - target.z, "corner offset")];
          const dot = basis => finite(v[0] * basis[0] + v[1] * basis[1] + v[2] * basis[2], "corner projection");
          visit(dot(direction), dot(right), dot(up));
        }
      }
    }
  }
}

/**
 * Admit once-padded applied history against the last admitted envelope.
 * Null applied bounds represent no shaped geometry, never identity points.
 * @param {THREE.Box3|null} history
 * @param {THREE.Box3|null} envelope
 * @param {THREE.Box3|null} appliedBounds
 * @param {GrowthTuning} tuning
 */
export function admitObservedBounds(history, envelope, appliedBounds, tuning) {
  if (!tuning) invalid("growth tuning");
  const padding = positive(tuning.paddingMetres, "padding");
  const growth = positive(tuning.minimumGrowthMetres, "growth threshold");
  if (padding < growth) invalid("padding below growth threshold");
  for (const [value, name] of [[history, "history"], [envelope, "envelope"], [appliedBounds, "applied bounds"]]) {
    if (value !== null) box(value, name);
  }
  const nextHistory = history?.clone() ?? null;
  const nextEnvelope = envelope?.clone() ?? null;
  if (appliedBounds === null) return { history: nextHistory, envelope: nextEnvelope, admitted: false };
  const grown = nextHistory ? nextHistory.union(appliedBounds) : appliedBounds.clone();
  const candidate = grown.clone().expandByScalar(padding);
  box(candidate, "padded history");
  const admitted = nextEnvelope === null || axes.some(axis => {
    const lower = finite(nextEnvelope.min[axis] - candidate.min[axis], "envelope growth");
    const upper = finite(candidate.max[axis] - nextEnvelope.max[axis], "envelope growth");
    return lower >= growth || upper >= growth;
  });
  return { history: grown, envelope: admitted ? (nextEnvelope ? nextEnvelope.union(candidate) : candidate) : nextEnvelope, admitted };
}

/** @param {Projection} projection @param {THREE.Box3} envelope @returns {FitGoal} */
export function planObservedFit(projection, envelope) {
  const { vertical, horizontal } = projectionTangents(projection);
  box(envelope, "envelope");
  const target = envelope.getCenter(new THREE.Vector3());
  vector(target, "goal target");
  const radius = positive(Math.max(3, envelope.getBoundingSphere(new THREE.Sphere()).radius), "goal radius");
  const halfAngle = Math.min(Math.atan(vertical), Math.atan(horizontal));
  const distance = positive(1.15 * radius / positive(Math.sin(halfAngle), "fit angle"), "goal distance");
  return { target, distance, radius };
}

/**
 * Pure fixed-basis containment; empty display input returns minDistance.
 * @param {Projection} projection @param {THREE.Vector3} target
 * @param {readonly THREE.Box3[]} displayedBoxes
 * @param {{margin:number, depthFloor:number, minDistance:number}} tuning
 */
export function minimumContainingDistance(projection, target, displayedBoxes, tuning) {
  const { vertical, horizontal } = projectionTangents(projection);
  vector(target, "target");
  displayBoxes(displayedBoxes);
  guardTuning(tuning);
  const horizontalMargin = positive(tuning.margin * horizontal, "horizontal margin");
  const verticalMargin = positive(tuning.margin * vertical, "vertical margin");
  let distance = tuning.minDistance;
  eachCorner(displayedBoxes, target, (axial, lateral, height) => {
    const required = finite(axial + Math.max(tuning.depthFloor, Math.abs(lateral) / horizontalMargin, Math.abs(height) / verticalMargin), "required distance");
    // Preserve positive depth when axial addition/subtraction loses a few ulps.
    // This is outward numerical safety, not an admission or world-coordinate cap.
    const rounding = 32 * Number.EPSILON * Math.max(1, Math.abs(axial), Math.abs(required));
    distance = Math.max(distance, finite(required + rounding, "guarded distance"));
  });
  return distance;
}

function clipPlanes(state, goal, displayedBoxes, nearMinimum) {
  let minimumDepth = Infinity;
  let maximumDepth = -Infinity;
  eachCorner(displayedBoxes, state.target, axial => {
    const depth = positive(state.distance - axial, "displayed depth");
    minimumDepth = Math.min(minimumDepth, depth);
    maximumDepth = Math.max(maximumDepth, depth);
  });
  if (displayedBoxes.length === 0) {
    const offset = positiveOrZero(Math.hypot(
      finite(goal.target.x - state.target.x, "goal offset"),
      finite(goal.target.y - state.target.y, "goal offset"),
      finite(goal.target.z - state.target.z, "goal offset"),
    ), "goal offset");
    maximumDepth = finite(state.distance + offset + goal.radius, "fallback depth");
  }
  const near = displayedBoxes.length === 0 ? nearMinimum
    : Math.max(nearMinimum, Math.min(state.distance / 10_000, minimumDepth / 2));
  const far = positive(Math.max(1000, maximumDepth + Math.max(1, maximumDepth * 0.05), near + 1), "far plane");
  positive(near, "near plane");
  if (near < nearMinimum || near >= minimumDepth || far <= maximumDepth || far <= near) invalid("clip planes");
  return { near, far };
}
function positiveOrZero(value, name) {
  if (finite(value, name) < 0) invalid(name);
  return value;
}

/**
 * Main owns freshness, clocks and mode authority. Snap precedes freshness;
 * stale easing can stop while the displayed-shape guard remains active.
 * @param {{state:FitState|null, goal:FitGoal, projection:Projection,
 * displayedBoxes:readonly THREE.Box3[], elapsedSeconds:number,
 * snap:boolean, ease:boolean, tuning:CameraTuning}} input
 * @returns {{state:FitState, near:number, far:number}}
 */
export function stepAutomaticFit(input) {
  if (!input) invalid("step input");
  const { state, goal, projection, displayedBoxes, elapsedSeconds, snap, ease, tuning } = input;
  pose(goal, "goal", true);
  if (state !== null) pose(state, "state");
  projectionTangents(projection);
  displayBoxes(displayedBoxes);
  guardTuning(tuning);
  positive(tuning.timeConstantSeconds, "time constant");
  positive(tuning.maxStepSeconds, "maximum step");
  positive(tuning.nearMinimum, "near minimum");
  if (finite(2 * tuning.nearMinimum, "near safety floor") > tuning.depthFloor) invalid("depth floor below near safety floor");
  positiveOrZero(elapsedSeconds, "elapsed time");
  if (typeof snap !== "boolean" || typeof ease !== "boolean") invalid("step policy");
  const next = snap || state === null
    ? { target: goal.target.clone(), distance: goal.distance }
    : { target: state.target.clone(), distance: state.distance };
  if (!snap && state !== null && ease) {
    const ratio = finite(Math.min(elapsedSeconds, tuning.maxStepSeconds) / tuning.timeConstantSeconds, "elapsed ratio");
    const alpha = finite(-Math.expm1(-ratio), "easing alpha");
    next.target.lerp(goal.target, alpha);
    next.distance += (goal.distance - next.distance) * alpha;
    pose(next, "eased state");
  }
  next.distance = Math.max(next.distance, minimumContainingDistance(projection, next.target, displayedBoxes, tuning));
  return { state: next, ...clipPlanes(next, goal, displayedBoxes, tuning.nearMinimum) };
}

export function bodyColor(entityId) {
  // Hash the stable ID, independent of arrival order and session reconnection.
  let hash = 2166136261;
  for (const digit of entityId.toString()) hash = Math.imul(hash ^ digit.charCodeAt(0), 16777619);
  return new THREE.Color().setHSL(((hash >>> 0) % 12) / 12, 0.65, 0.62);
}
