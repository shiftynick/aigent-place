import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const WORLD_LIMIT_MM = 100_000_000;
export const UINT64_MAX = 18_446_744_073_709_551_615n;

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const fixturePath = path.join(
  root,
  "world/v1/conformance/physics-shapes-v1.json",
);

function clone(value) {
  return structuredClone(value);
}

function compareEntityIds(left, right) {
  const a = BigInt(left);
  const b = BigInt(right);
  return a < b ? -1 : a > b ? 1 : 0;
}

function cleanNumber(value) {
  if (Object.is(value, -0)) return 0;
  if (Number.isInteger(value)) return value;
  return Number(value.toFixed(12));
}

function roundMillimeterTiesToEven(value) {
  const sign = value < 0 ? -1 : 1;
  const magnitude = Math.abs(value);
  const floor = Math.floor(magnitude);
  const fraction = magnitude - floor;
  let rounded = floor;
  if (fraction > 0.5) rounded += 1;
  if (fraction === 0.5 && floor % 2 === 1) rounded += 1;
  return rounded * sign || 0;
}

function decimalFraction(input) {
  const text = typeof input === "number" ? String(input) : input;
  if (typeof text !== "string") {
    throw new Error("coordinate must be a number or decimal string");
  }
  const match = text.match(
    /^([+-]?)(?:(\d+)(?:\.(\d*))?|\.(\d+))(?:[eE]([+-]?\d+))?$/,
  );
  if (!match) {
    throw new Error("coordinate is not a finite decimal");
  }
  const sign = match[1] === "-" ? -1n : 1n;
  const integer = match[2] ?? "0";
  const fraction = match[3] ?? match[4] ?? "";
  const exponent = Number(match[5] ?? 0);
  if (!Number.isSafeInteger(exponent) || Math.abs(exponent) > 1000) {
    throw new Error("coordinate exponent is unsupported");
  }
  let numerator = BigInt(`${integer}${fraction}` || "0") * sign;
  let denominator = 10n ** BigInt(fraction.length);
  if (exponent > 0) numerator *= 10n ** BigInt(exponent);
  if (exponent < 0) denominator *= 10n ** BigInt(-exponent);
  return { numerator, denominator };
}

function roundTiesToEven(numerator, denominator) {
  const sign = numerator < 0n ? -1n : 1n;
  const magnitude = numerator < 0n ? -numerator : numerator;
  const quotient = magnitude / denominator;
  const remainder = magnitude % denominator;
  const doubled = remainder * 2n;
  let rounded = quotient;
  if (doubled > denominator) rounded += 1n;
  if (doubled === denominator && quotient % 2n === 1n) rounded += 1n;
  return rounded * sign;
}

export function quantizeMeters(input) {
  if (typeof input === "number" && !Number.isFinite(input)) {
    return { ok: false, reason: "invalid_coordinate" };
  }
  let fraction;
  try {
    fraction = decimalFraction(input);
  } catch {
    return { ok: false, reason: "invalid_coordinate" };
  }
  const limit = 100_000n * fraction.denominator;
  const magnitude =
    fraction.numerator < 0n ? -fraction.numerator : fraction.numerator;
  if (magnitude > limit) {
    return { ok: false, reason: "out_of_world_bounds" };
  }
  const millimeters = roundTiesToEven(
    fraction.numerator * 1000n,
    fraction.denominator,
  );
  if (
    millimeters < -BigInt(WORLD_LIMIT_MM) ||
    millimeters > BigInt(WORLD_LIMIT_MM)
  ) {
    return { ok: false, reason: "out_of_world_bounds" };
  }
  return { ok: true, millimeters };
}

function finiteInteger(value, { positive = false, nonNegative = false } = {}) {
  if (!Number.isSafeInteger(value)) return false;
  if (positive && value <= 0) return false;
  if (nonNegative && value < 0) return false;
  return true;
}

function validIdentifier(value) {
  return typeof value === "string" && /^[a-z][a-z0-9_.-]{0,63}$/.test(value);
}

function normalizeQuaternion(rotation) {
  if (
    !rotation ||
    !["x", "y", "z", "w"].every((key) =>
      Number.isFinite(rotation[key]),
    )
  ) {
    throw new Error("invalid quaternion");
  }
  const magnitudeSquared =
    rotation.x ** 2 + rotation.y ** 2 + rotation.z ** 2 + rotation.w ** 2;
  if (Math.abs(magnitudeSquared - 1) > 1e-6) {
    throw new Error("invalid quaternion");
  }
  const magnitude = Math.sqrt(magnitudeSquared);
  const normalized = {
    x: rotation.x / magnitude,
    y: rotation.y / magnitude,
    z: rotation.z / magnitude,
    w: rotation.w / magnitude,
  };
  const first = [
    normalized.w,
    normalized.x,
    normalized.y,
    normalized.z,
  ].find((value) => value !== 0);
  if (first < 0) {
    for (const key of ["x", "y", "z", "w"]) normalized[key] *= -1;
  }
  return normalized;
}

function multiplyQuaternion(a, b) {
  return normalizeQuaternion({
    x: a.w * b.x + a.x * b.w + a.y * b.z - a.z * b.y,
    y: a.w * b.y - a.x * b.z + a.y * b.w + a.z * b.x,
    z: a.w * b.z + a.x * b.y - a.y * b.x + a.z * b.w,
    w: a.w * b.w - a.x * b.x - a.y * b.y - a.z * b.z,
  });
}

function rotationMatrix(q) {
  return [
    [
      1 - 2 * (q.y ** 2 + q.z ** 2),
      2 * (q.x * q.y - q.z * q.w),
      2 * (q.x * q.z + q.y * q.w),
    ],
    [
      2 * (q.x * q.y + q.z * q.w),
      1 - 2 * (q.x ** 2 + q.z ** 2),
      2 * (q.y * q.z - q.x * q.w),
    ],
    [
      2 * (q.x * q.z - q.y * q.w),
      2 * (q.y * q.z + q.x * q.w),
      1 - 2 * (q.x ** 2 + q.y ** 2),
    ],
  ];
}

function rotateVector(q, vector) {
  const matrix = rotationMatrix(q);
  return {
    x:
      matrix[0][0] * vector.x +
      matrix[0][1] * vector.y +
      matrix[0][2] * vector.z,
    y:
      matrix[1][0] * vector.x +
      matrix[1][1] * vector.y +
      matrix[1][2] * vector.z,
    z:
      matrix[2][0] * vector.x +
      matrix[2][1] * vector.y +
      matrix[2][2] * vector.z,
  };
}

function primitiveHalfExtents(primitive) {
  switch (primitive?.kind) {
    case "box":
      if (
        !finiteInteger(primitive.size_x_mm, { positive: true }) ||
        !finiteInteger(primitive.size_y_mm, { positive: true }) ||
        !finiteInteger(primitive.size_z_mm, { positive: true })
      ) {
        throw new Error("invalid box");
      }
      return {
        x: primitive.size_x_mm / 2,
        y: primitive.size_y_mm / 2,
        z: primitive.size_z_mm / 2,
      };
    case "sphere":
      if (!finiteInteger(primitive.radius_mm, { positive: true })) {
        throw new Error("invalid sphere");
      }
      return {
        x: primitive.radius_mm,
        y: primitive.radius_mm,
        z: primitive.radius_mm,
      };
    case "capsule":
      if (
        !finiteInteger(primitive.radius_mm, { positive: true }) ||
        !finiteInteger(primitive.segment_length_mm, { nonNegative: true })
      ) {
        throw new Error("invalid capsule");
      }
      return {
        x: primitive.radius_mm,
        y: primitive.segment_length_mm / 2 + primitive.radius_mm,
        z: primitive.radius_mm,
      };
    case "cylinder":
    case "cone":
      if (
        !finiteInteger(primitive.radius_mm, { positive: true }) ||
        !finiteInteger(primitive.height_mm, { positive: true })
      ) {
        throw new Error(`invalid ${primitive.kind}`);
      }
      return {
        x: primitive.radius_mm,
        y: primitive.height_mm / 2,
        z: primitive.radius_mm,
      };
    case "panel":
      if (
        !finiteInteger(primitive.width_mm, { positive: true }) ||
        !finiteInteger(primitive.height_mm, { positive: true }) ||
        !finiteInteger(primitive.thickness_mm, { positive: true })
      ) {
        throw new Error("invalid panel");
      }
      return {
        x: primitive.width_mm / 2,
        y: primitive.height_mm / 2,
        z: primitive.thickness_mm / 2,
      };
    default:
      throw new Error("unknown primitive");
  }
}

export function validateShape(shape) {
  if (!shape || !Array.isArray(shape.nodes) || shape.nodes.length === 0) {
    return { ok: false, reason: "invalid_shape" };
  }
  const byId = new Map();
  const joints = new Set();
  for (const node of shape.nodes) {
    if (
      !Number.isInteger(node.id) ||
      node.id <= 0 ||
      node.id > 0xffff_ffff ||
      byId.has(node.id)
    ) {
      return { ok: false, reason: "invalid_shape" };
    }
    if (
      !node.translation ||
      !["x", "y", "z"].every((key) =>
        finiteInteger(node.translation[key]),
      )
    ) {
      return { ok: false, reason: "invalid_shape" };
    }
    try {
      normalizeQuaternion(node.rotation);
      primitiveHalfExtents(node.primitive);
    } catch {
      return { ok: false, reason: "invalid_shape" };
    }
    if (node.joint_name !== undefined) {
      if (!validIdentifier(node.joint_name) || joints.has(node.joint_name)) {
        return { ok: false, reason: "invalid_shape" };
      }
      joints.add(node.joint_name);
    }
    if (
      node.material_tags !== undefined &&
      (!Array.isArray(node.material_tags) ||
        node.material_tags.some((tag) => !validIdentifier(tag)) ||
        new Set(node.material_tags).size !== node.material_tags.length)
    ) {
      return { ok: false, reason: "invalid_shape" };
    }
    if (
      node.color !== undefined &&
      !["red", "green", "blue", "alpha"].every(
        (key) =>
          Number.isInteger(node.color[key]) &&
          node.color[key] >= 0 &&
          node.color[key] <= 255,
      )
    ) {
      return { ok: false, reason: "invalid_shape" };
    }
    byId.set(node.id, node);
  }
  const roots = shape.nodes.filter((node) => node.parent_id === 0);
  if (roots.length !== 1) return { ok: false, reason: "invalid_shape" };
  for (const node of shape.nodes) {
    if (node.parent_id !== 0 && !byId.has(node.parent_id)) {
      return { ok: false, reason: "invalid_shape" };
    }
    const seen = new Set();
    let cursor = node;
    while (cursor.parent_id !== 0) {
      if (seen.has(cursor.id)) {
        return { ok: false, reason: "invalid_shape" };
      }
      seen.add(cursor.id);
      cursor = byId.get(cursor.parent_id);
    }
  }
  return { ok: true };
}

function canonicalShape(shape) {
  const validation = validateShape(shape);
  if (!validation.ok) throw new Error(validation.reason);
  return {
    nodes: shape.nodes
      .map((node) => ({
        ...clone(node),
        rotation: normalizeQuaternion(node.rotation),
        ...(node.material_tags === undefined
          ? {}
          : { material_tags: [...node.material_tags].sort() }),
      }))
      .sort((a, b) => a.id - b.id),
  };
}

function composedNodes(shape) {
  const validation = validateShape(shape);
  if (!validation.ok) throw new Error(validation.reason);
  const byId = new Map(shape.nodes.map((node) => [node.id, node]));
  const cache = new Map();
  const compose = (node) => {
    if (cache.has(node.id)) return cache.get(node.id);
    const localRotation = normalizeQuaternion(node.rotation);
    let result;
    if (node.parent_id === 0) {
      result = {
        center: { ...node.translation },
        rotation: localRotation,
      };
    } else {
      const parent = compose(byId.get(node.parent_id));
      const translated = rotateVector(parent.rotation, node.translation);
      result = {
        center: {
          x: parent.center.x + translated.x,
          y: parent.center.y + translated.y,
          z: parent.center.z + translated.z,
        },
        rotation: multiplyQuaternion(parent.rotation, localRotation),
      };
    }
    cache.set(node.id, result);
    return result;
  };
  return [...shape.nodes]
    .sort((a, b) => a.id - b.id)
    .map((node) => ({ node, ...compose(node) }));
}

export function entityAabbs(entity, position = entity.position) {
  return composedNodes(entity.shape).map(({ node, center, rotation }) => {
    const local = primitiveHalfExtents(node.primitive);
    const matrix = rotationMatrix(rotation);
    const half = {
      x:
        Math.abs(matrix[0][0]) * local.x +
        Math.abs(matrix[0][1]) * local.y +
        Math.abs(matrix[0][2]) * local.z,
      y:
        Math.abs(matrix[1][0]) * local.x +
        Math.abs(matrix[1][1]) * local.y +
        Math.abs(matrix[1][2]) * local.z,
      z:
        Math.abs(matrix[2][0]) * local.x +
        Math.abs(matrix[2][1]) * local.y +
        Math.abs(matrix[2][2]) * local.z,
    };
    const world = {
      x: position.x + center.x,
      y: position.y + center.y,
      z: position.z + center.z,
    };
    return {
      node_id: node.id,
      min: {
        x: world.x - half.x,
        y: world.y - half.y,
        z: world.z - half.z,
      },
      max: {
        x: world.x + half.x,
        y: world.y + half.y,
        z: world.z + half.z,
      },
    };
  });
}

function aggregateAabb(aabbs) {
  return {
    min: {
      x: Math.min(...aabbs.map(({ min }) => min.x)),
      y: Math.min(...aabbs.map(({ min }) => min.y)),
      z: Math.min(...aabbs.map(({ min }) => min.z)),
    },
    max: {
      x: Math.max(...aabbs.map(({ max }) => max.x)),
      y: Math.max(...aabbs.map(({ max }) => max.y)),
      z: Math.max(...aabbs.map(({ max }) => max.z)),
    },
  };
}

export function aabbsOverlap(a, b) {
  return ["x", "y", "z"].every(
    (axis) => a.max[axis] > b.min[axis] && a.min[axis] < b.max[axis],
  );
}

function strictlyContains(container, contained) {
  return (
    container.min.x < contained.min.x &&
    container.max.x > contained.max.x &&
    container.min.z < contained.min.z &&
    container.max.z > contained.max.z &&
    container.min.y <= contained.min.y &&
    container.max.y >= contained.max.y
  );
}

function withinWorld(aabbs) {
  return aabbs.every(({ min, max }) =>
    ["x", "y", "z"].every(
      (axis) =>
        min[axis] >= -WORLD_LIMIT_MM && max[axis] <= WORLD_LIMIT_MM,
    ),
  );
}

function activeEntities(state, excludeId) {
  return state.entities
    .filter(
      (entity) =>
        entity.lifecycle === "active" && entity.id !== String(excludeId),
    )
    .sort((a, b) => compareEntityIds(a.id, b.id));
}

function firstOverlap(state, candidate, excludeId) {
  const candidateBoxes = entityAabbs(candidate);
  for (const entity of activeEntities(state, excludeId)) {
    const boxes = entityAabbs(entity);
    if (
      candidateBoxes.some((left) =>
        boxes.some((right) => aabbsOverlap(left, right)),
      )
    ) {
      return entity.id;
    }
  }
  return undefined;
}

function firstEnclosedAigent(state, candidate, excludeId) {
  const candidateAggregate = aggregateAabb(entityAabbs(candidate));
  for (const entity of activeEntities(state, excludeId)) {
    if (
      entity.kind === "aigent" &&
      strictlyContains(
        candidateAggregate,
        aggregateAabb(entityAabbs(entity)),
      )
    ) {
      return entity.id;
    }
  }
  return undefined;
}

function groundPosition(state, entity, x, z) {
  const height = state.rules.heightfield_y_mm ?? 0;
  const atZero = entityAabbs(entity, { x, y: 0, z });
  const minY = Math.min(...atZero.map(({ min }) => min.y));
  return { x, y: cleanNumber(height - minY), z };
}

function incrementRevision(entity) {
  if (BigInt(entity.revision) >= UINT64_MAX) {
    throw new Error("revision exhausted");
  }
  entity.revision = (BigInt(entity.revision) + 1n).toString();
}

function revisionAvailable(entity) {
  return BigInt(entity.revision) < UINT64_MAX;
}

function inspectState(state, inspect = {}) {
  const wanted = new Set(
    inspect.entity_ids ?? state.entities.map(({ id }) => id),
  );
  const result = {
    entities: state.entities
      .filter(({ id }) => wanted.has(id))
      .sort((a, b) => compareEntityIds(a.id, b.id))
      .map((entity) => ({
        id: entity.id,
        kind: entity.kind,
        lifecycle: entity.lifecycle,
        revision: entity.revision,
        position: Object.fromEntries(
          Object.entries(entity.position).map(([key, value]) => [
            key,
            cleanNumber(value),
          ]),
        ),
        shape_node_ids: entity.shape.nodes
          .map(({ id }) => id)
          .sort((a, b) => a - b),
        ...(entity.blocked_ticks === undefined
          ? {}
          : { blocked_ticks: entity.blocked_ticks }),
      })),
  };
  if (inspect.include_next_entity_id) {
    result.next_entity_id = state.next_entity_id;
  }
  return result;
}

function applyCoordinateStep(step) {
  if (step.op === "quantize") {
    const result = quantizeMeters(step.value);
    return result.ok
      ? {
          type: "coordinate",
          outcome: "accepted",
          millimeters: result.millimeters.toString(),
        }
      : { type: "coordinate", outcome: "rejected", reason: result.reason };
  }
  const axes = {};
  for (const axis of ["x", "y", "z"]) {
    const result = quantizeMeters(step.position[axis]);
    if (!result.ok) {
      return {
        type: "position",
        outcome: "rejected",
        reason: result.reason,
        axis,
      };
    }
    axes[axis] = result.millimeters.toString();
  }
  return { type: "position", outcome: "accepted", position: axes };
}

function applyPlace(state, step) {
  const validation = validateShape(step.shape);
  if (!validation.ok) {
    return { type: "place_object", outcome: "rejected", reason: "invalid_shape" };
  }
  if (
    !finiteInteger(step.x_mm) ||
    !finiteInteger(step.z_mm) ||
    Math.abs(step.x_mm) > WORLD_LIMIT_MM ||
    Math.abs(step.z_mm) > WORLD_LIMIT_MM
  ) {
    return {
      type: "place_object",
      outcome: "rejected",
      reason: "out_of_world_bounds",
    };
  }
  if (BigInt(state.next_entity_id) > UINT64_MAX) {
    return {
      type: "place_object",
      outcome: "rejected",
      reason: "entity_id_exhausted",
    };
  }
  const entity = {
    id: state.next_entity_id,
    kind: "object",
    lifecycle: "active",
    revision: "1",
    position: { x: step.x_mm, y: 0, z: step.z_mm },
    shape: canonicalShape(step.shape),
  };
  entity.position = groundPosition(state, entity, step.x_mm, step.z_mm);
  if (!withinWorld(entityAabbs(entity))) {
    return {
      type: "place_object",
      outcome: "rejected",
      reason: "out_of_world_bounds",
    };
  }
  const overlap = firstOverlap(state, entity);
  if (overlap !== undefined) {
    return {
      type: "place_object",
      outcome: "rejected",
      reason: "overlap",
      conflicting_entity_id: overlap,
    };
  }
  const enclosed = firstEnclosedAigent(state, entity);
  if (enclosed !== undefined) {
    return {
      type: "place_object",
      outcome: "rejected",
      reason: "encloses_aigent",
      conflicting_entity_id: enclosed,
    };
  }
  state.entities.push(entity);
  state.next_entity_id = (BigInt(state.next_entity_id) + 1n).toString();
  return {
    type: "place_object",
    outcome: "accepted",
    entity_id: entity.id,
    revision: entity.revision,
    position: entity.position,
  };
}

function findEntity(state, id) {
  const entity = state.entities.find((candidate) => candidate.id === String(id));
  if (!entity) throw new Error(`unknown entity ${id}`);
  return entity;
}

function applySetShape(state, step) {
  const entity = findEntity(state, step.entity_id);
  const validation = validateShape(step.shape);
  if (!validation.ok) {
    return {
      type: "set_shape",
      entity_id: entity.id,
      outcome: "rejected",
      reason: "invalid_shape",
    };
  }
  const candidate = { ...entity, shape: canonicalShape(step.shape) };
  if (!withinWorld(entityAabbs(candidate))) {
    return {
      type: "set_shape",
      entity_id: entity.id,
      outcome: "rejected",
      reason: "out_of_world_bounds",
    };
  }
  const overlap = firstOverlap(state, candidate, entity.id);
  if (overlap !== undefined) {
    return {
      type: "set_shape",
      entity_id: entity.id,
      outcome: "rejected",
      reason: "overlap",
      conflicting_entity_id: overlap,
    };
  }
  const enclosed = firstEnclosedAigent(state, candidate, entity.id);
  if (enclosed !== undefined) {
    return {
      type: "set_shape",
      entity_id: entity.id,
      outcome: "rejected",
      reason: "encloses_aigent",
      conflicting_entity_id: enclosed,
    };
  }
  if (!revisionAvailable(entity)) {
    return {
      type: "set_shape",
      entity_id: entity.id,
      outcome: "rejected",
      reason: "revision_exhausted",
    };
  }
  entity.shape = canonicalShape(step.shape);
  incrementRevision(entity);
  return {
    type: "set_shape",
    outcome: "accepted",
    entity_id: entity.id,
    revision: entity.revision,
  };
}

function sweepPair(moving, delta, obstacle) {
  let entry = -Infinity;
  let exit = Infinity;
  for (const axis of ["x", "y", "z"]) {
    const velocity = delta[axis];
    if (velocity === 0) {
      if (
        moving.max[axis] <= obstacle.min[axis] ||
        moving.min[axis] >= obstacle.max[axis]
      ) {
        return undefined;
      }
      continue;
    }
    if (moving.max[axis] <= obstacle.min[axis] && velocity <= 0) {
      return undefined;
    }
    if (moving.min[axis] >= obstacle.max[axis] && velocity >= 0) {
      return undefined;
    }
    const first =
      velocity > 0
        ? (obstacle.min[axis] - moving.max[axis]) / velocity
        : (obstacle.max[axis] - moving.min[axis]) / velocity;
    const last =
      velocity > 0
        ? (obstacle.max[axis] - moving.min[axis]) / velocity
        : (obstacle.min[axis] - moving.max[axis]) / velocity;
    entry = Math.max(entry, first);
    exit = Math.min(exit, last);
  }
  if (entry > exit || exit < 0 || entry > 1) return undefined;
  return Math.max(0, entry);
}

export function sweepFirstContact(state, entity, target) {
  const delta = {
    x: target.x - entity.position.x,
    y: target.y - entity.position.y,
    z: target.z - entity.position.z,
  };
  if (delta.x === 0 && delta.y === 0 && delta.z === 0) {
    return undefined;
  }
  let best;
  for (const obstacle of activeEntities(state, entity.id)) {
    for (const movingBox of entityAabbs(entity)) {
      for (const obstacleBox of entityAabbs(obstacle)) {
        const time = sweepPair(movingBox, delta, obstacleBox);
        if (
          time !== undefined &&
          (best === undefined ||
            time < best.time ||
            (time === best.time &&
              compareEntityIds(obstacle.id, best.entity_id) < 0))
        ) {
          best = { time, entity_id: obstacle.id };
        }
      }
    }
  }
  return best;
}

function applyMoves(state, step) {
  const outputs = [];
  const moves = [...step.moves].sort((a, b) =>
    compareEntityIds(String(a.entity_id), String(b.entity_id)),
  );
  for (const move of moves) {
    const entity = findEntity(state, move.entity_id);
    if (entity.lifecycle !== "active") {
      outputs.push({
        type: "move",
        entity_id: entity.id,
        outcome: "rejected",
        reason: "sleeping",
      });
      continue;
    }
    const target = { ...move.target };
    if (
      !["x", "y", "z"].every(
        (axis) =>
          Number.isFinite(target[axis]) &&
          Math.abs(target[axis]) <= WORLD_LIMIT_MM,
      ) ||
      !withinWorld(entityAabbs(entity, target))
    ) {
      outputs.push({
        type: "move",
        entity_id: entity.id,
        outcome: "rejected",
        reason: "out_of_world_bounds",
      });
      continue;
    }
    if (!revisionAvailable(entity)) {
      outputs.push({
        type: "move",
        entity_id: entity.id,
        outcome: "rejected",
        reason: "revision_exhausted",
      });
      continue;
    }
    const contact = sweepFirstContact(state, entity, target);
    if (!contact) {
      entity.position = target;
      incrementRevision(entity);
      outputs.push({
        type: "move",
        entity_id: entity.id,
        outcome: "reached",
        position: clone(entity.position),
      });
      continue;
    }
    const start = entity.position;
    entity.position = {
      x: cleanNumber(start.x + (target.x - start.x) * contact.time),
      y: cleanNumber(start.y + (target.y - start.y) * contact.time),
      z: cleanNumber(start.z + (target.z - start.z) * contact.time),
    };
    entity.blocked_ticks = (entity.blocked_ticks ?? 0) + 1;
    incrementRevision(entity);
    outputs.push({
      type: "move",
      entity_id: entity.id,
      outcome: "blocked",
      blocker_entity_id: contact.entity_id,
      position: clone(entity.position),
    });
  }
  return outputs;
}

function nearestCandidate(state, entity, { excludeOrigin = false } = {}) {
  const step = state.rules.displacement_step_mm;
  const radius = state.rules.max_displacement_radius_mm;
  if (
    !finiteInteger(step, { positive: true }) ||
    !finiteInteger(radius, { nonNegative: true })
  ) {
    throw new Error("invalid displacement rules");
  }
  const origin = entity.position;
  const anchor = {
    x: roundMillimeterTiesToEven(origin.x),
    y: roundMillimeterTiesToEven(origin.y),
    z: roundMillimeterTiesToEven(origin.z),
  };
  const candidates = [];
  const reach = Math.floor(radius / step);
  for (let kx = -reach; kx <= reach; kx += 1) {
    for (let kz = -reach; kz <= reach; kz += 1) {
      if (excludeOrigin && kx === 0 && kz === 0) continue;
      const dx = kx * step;
      const dz = kz * step;
      if (dx ** 2 + dz ** 2 > radius ** 2) continue;
      const candidate = clone(entity);
      candidate.lifecycle = "active";
      candidate.position = groundPosition(
        state,
        candidate,
        anchor.x + dx,
        anchor.z + dz,
      );
      const boxes = entityAabbs(candidate);
      if (!withinWorld(boxes)) continue;
      if (firstOverlap(state, candidate, entity.id) !== undefined) continue;
      const projectedY = roundMillimeterTiesToEven(candidate.position.y);
      const dy = projectedY - anchor.y;
      candidates.push({
        position: candidate.position,
        distance: dx ** 2 + dy ** 2 + dz ** 2,
        tie: {
          x: candidate.position.x,
          y: projectedY,
          z: candidate.position.z,
        },
      });
    }
  }
  candidates.sort(
    (a, b) =>
      a.distance - b.distance ||
      a.tie.x - b.tie.x ||
      a.tie.y - b.tie.y ||
      a.tie.z - b.tie.z,
  );
  return candidates[0]?.position;
}

export function nearestFree(state, entityId, options) {
  return nearestCandidate(state, findEntity(state, entityId), options);
}

function applyLifecycle(state, step) {
  const entity = findEntity(state, step.entity_id);
  if (step.op === "sleep") {
    if (!revisionAvailable(entity)) {
      return {
        type: "sleep",
        entity_id: entity.id,
        outcome: "rejected",
        reason: "revision_exhausted",
      };
    }
    entity.lifecycle = "sleeping";
    entity.blocked_ticks = 0;
    incrementRevision(entity);
    return {
      type: "sleep",
      entity_id: entity.id,
      outcome: "accepted",
      revision: entity.revision,
    };
  }
  const isUnstick = step.op === "unstick";
  if (isUnstick) {
    if (
      entity.lifecycle !== "active" ||
      (entity.blocked_ticks ?? 0) < state.rules.unstick_blocked_ticks
    ) {
      return {
        type: "unstick",
        entity_id: entity.id,
        outcome: "rejected",
        reason: "unstick_not_eligible",
      };
    }
  } else if (entity.lifecycle !== "sleeping") {
    throw new Error(`${step.op} requires a sleeping entity`);
  }
  let position;
  if (!isUnstick) {
    const storedCandidate = { ...clone(entity), lifecycle: "active" };
    const storedBoxes = entityAabbs(storedCandidate);
    if (
      withinWorld(storedBoxes) &&
      firstOverlap(state, storedCandidate, entity.id) === undefined
    ) {
      position = clone(entity.position);
    }
  }
  position ??= nearestCandidate(state, entity, {
    excludeOrigin: isUnstick,
  });
  if (!position) {
    return {
      type: step.op,
      entity_id: entity.id,
      outcome: "rejected",
      reason: "no_free_position",
    };
  }
  const displaced =
    position.x !== entity.position.x ||
    position.y !== entity.position.y ||
    position.z !== entity.position.z;
  if (
    (step.op === "wake" || step.op === "unstick" || displaced) &&
    !revisionAvailable(entity)
  ) {
    return {
      type: step.op,
      entity_id: entity.id,
      outcome: "rejected",
      reason: "revision_exhausted",
    };
  }
  entity.position = position;
  if (step.op === "wake") {
    entity.lifecycle = "active";
    incrementRevision(entity);
  } else if (step.op === "restore") {
    entity.lifecycle = "active";
    if (displaced) incrementRevision(entity);
  } else {
    entity.blocked_ticks = 0;
    incrementRevision(entity);
  }
  return {
    type: step.op,
    entity_id: entity.id,
    outcome: "accepted",
    displaced,
    position: clone(entity.position),
    revision: entity.revision,
  };
}

function assertState(state) {
  const ids = state.entities.map(({ id }) => id);
  if (
    new Set(ids).size !== ids.length ||
    ids.some((id) => BigInt(id) <= 0n || BigInt(id) > UINT64_MAX) ||
    state.entities.some(
      ({ revision }) =>
        BigInt(revision) <= 0n || BigInt(revision) > UINT64_MAX,
    )
  ) {
    throw new Error("invalid state entity IDs");
  }
  const active = activeEntities(state);
  for (let index = 0; index < active.length; index += 1) {
    const left = active[index];
    if (!withinWorld(entityAabbs(left))) {
      throw new Error(`active entity ${left.id} is out of bounds`);
    }
    for (const right of active.slice(index + 1)) {
      if (
        entityAabbs(left).some((a) =>
          entityAabbs(right).some((b) => aabbsOverlap(a, b)),
        )
      ) {
        throw new Error(`active entities ${left.id} and ${right.id} overlap`);
      }
    }
  }
}

export function evaluateScenario(initial, steps, inspect) {
  const state = clone(initial);
  const catalog = state.shape_catalog ?? {};
  for (const entity of state.entities) {
    if (typeof entity.shape === "string") {
      if (!catalog[entity.shape]) {
        throw new Error(`unknown shape template: ${entity.shape}`);
      }
      entity.shape = clone(catalog[entity.shape]);
      entity.shape = canonicalShape(entity.shape);
    }
  }
  const materializedSteps = steps.map((step) => {
    const next = clone(step);
    if (typeof next.shape === "string") {
      if (!catalog[next.shape]) {
        throw new Error(`unknown shape template: ${next.shape}`);
      }
      next.shape = clone(catalog[next.shape]);
    }
    return next;
  });
  const trace = [];
  for (const step of materializedSteps) {
    let output;
    switch (step.op) {
      case "quantize":
      case "validate_position":
        output = applyCoordinateStep(step);
        break;
      case "place":
        output = applyPlace(state, step);
        break;
      case "set_shape":
        output = applySetShape(state, step);
        break;
      case "resolve_moves":
        output = applyMoves(state, step);
        break;
      case "sleep":
      case "wake":
      case "restore":
      case "unstick":
        output = applyLifecycle(state, step);
        break;
      default:
        throw new Error(`unknown world-contract operation: ${step.op}`);
    }
    if (Array.isArray(output)) trace.push(...output);
    else trace.push(output);
    assertState(state);
  }
  return canonicalize({
    trace,
    final_state: inspectState(state, inspect),
  });
}

export function evaluateFixtureCase(fixture, scenario) {
  return evaluateScenario(
    { ...clone(scenario.initial), shape_catalog: clone(fixture.shape_catalog) },
    scenario.steps,
    scenario.inspect,
  );
}

export function canonicalize(value) {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value)
        .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0))
        .map(([key, child]) => [key, canonicalize(child)]),
    );
  }
  return value;
}

export function validateFixture(fixture) {
  if (
    fixture?.fixture_format !== "aigent.world.semantic-fixtures" ||
    fixture.fixture_version !== 1 ||
    !fixture.shape_catalog ||
    !Array.isArray(fixture.cases)
  ) {
    throw new Error("invalid world fixture header");
  }
  const ids = new Set();
  for (const scenario of fixture.cases) {
    if (
      typeof scenario.id !== "string" ||
      !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(scenario.id) ||
      ids.has(scenario.id)
    ) {
      throw new Error(`invalid or duplicate fixture id: ${scenario.id}`);
    }
    ids.add(scenario.id);
    if (
      !scenario.initial ||
      !Array.isArray(scenario.initial.entities) ||
      !Array.isArray(scenario.steps) ||
      !scenario.expect
    ) {
      throw new Error(`invalid fixture case: ${scenario.id}`);
    }
  }
}

export function loadFixture() {
  return JSON.parse(fs.readFileSync(fixturePath, "utf8"));
}
