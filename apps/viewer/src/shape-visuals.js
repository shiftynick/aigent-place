import * as THREE from "three";

export const MAX_SHAPE_PARTS = 256;
export const MAX_PRESENTATION_BYTES = 1_048_576;
const WORLD_BOUND_MM = 100_000_000n;
const MAX_EXTENT_MM = 100_000;
const IDENTIFIER = /^[a-z][a-z0-9_.-]{0,63}$/;
const plans = new WeakSet();

/** Invalid world geometry and unsupported presentation size are distinct. */
export class ShapePresentationError extends Error {
  constructor(reason, code = "INVALID_SHAPE") {
    super(reason);
    this.name = "ShapePresentationError";
    this.code = code;
  }
}

function invalid(reason) { throw new ShapePresentationError(reason); }
function budgetExceeded() {
  throw new ShapePresentationError("shape metadata and canonical key exceed the 1 MiB presentation limit", "UNSUPPORTED_SHAPE_PRESENTATION");
}
function validId(id, allowZero = false) {
  return Number.isInteger(id) && id >= (allowZero ? 0 : 1) && id <= 0xffffffff;
}
function mm(value, name, minimum = -WORLD_BOUND_MM, maximum = WORLD_BOUND_MM) {
  if (typeof value !== "bigint" || value < minimum || value > maximum) invalid(`invalid ${name}`);
  return Number(value) / 1000;
}
function arrayBytes(sizes) { return 2 + sizes.reduce((sum, size) => sum + size, 0) + Math.max(0, sizes.length - 1); }
function numbersBytes(values) { return arrayBytes(values.map(value => String(value).length)); }

function primitivePlan(primitive) {
  if (!primitive || !primitive.value) invalid("missing primitive");
  const value = primitive.value;
  const dimension = (field, zero = false) => mm(value[field], field, zero ? 0n : 1n, BigInt(MAX_EXTENT_MM));
  let dimensions;
  let half;
  switch (primitive.case) {
    case "box":
      dimensions = [dimension("sizeXMm"), dimension("sizeYMm"), dimension("sizeZMm")];
      half = dimensions.map(value => value / 2);
      break;
    case "sphere":
      dimensions = [dimension("radiusMm")];
      half = [dimensions[0], dimensions[0], dimensions[0]];
      break;
    case "capsule":
      dimensions = [dimension("radiusMm"), dimension("segmentLengthMm", true)];
      half = [dimensions[0], dimensions[1] / 2 + dimensions[0], dimensions[0]];
      break;
    case "cylinder":
    case "cone":
      dimensions = [dimension("radiusMm"), dimension("heightMm")];
      half = [dimensions[0], dimensions[1] / 2, dimensions[0]];
      break;
    case "panel":
      dimensions = [dimension("widthMm"), dimension("heightMm"), dimension("thicknessMm")];
      half = dimensions.map(value => value / 2);
      break;
    default: invalid("unknown primitive");
  }
  if (half.some(value => value * 2000 > MAX_EXTENT_MM)) invalid("primitive exceeds the constitutional extent limit");
  return { kind: primitive.case, dimensions, half };
}

function localPose(node) {
  const transform = node.transform;
  const rotation = transform?.rotation;
  if (!rotation || ![rotation.x, rotation.y, rotation.z, rotation.w].every(Number.isFinite)) invalid("missing or non-finite rotation");
  const quaternion = new THREE.Quaternion(rotation.x, rotation.y, rotation.z, rotation.w);
  if (Math.abs(quaternion.lengthSq() - 1) > 1e-6) invalid("rotation is not a unit quaternion");
  quaternion.normalize();
  const first = [quaternion.w, quaternion.x, quaternion.y, quaternion.z].find(value => value !== 0);
  if (first < 0) quaternion.set(-quaternion.x, -quaternion.y, -quaternion.z, -quaternion.w);
  const translation = transform.translation;
  const position = translation ? new THREE.Vector3(
    mm(translation.xMm, "translation x"), mm(translation.yMm, "translation y"), mm(translation.zMm, "translation z"),
  ) : new THREE.Vector3();
  return { position, quaternion };
}

function colorBytes(color) {
  if (color === undefined) return null;
  if (!color || ![color.red, color.green, color.blue, color.alpha].every(value => Number.isInteger(value) && value >= 0 && value <= 255)) invalid("invalid RGBA color");
  return [color.red, color.green, color.blue, color.alpha];
}

function freezeVector(vector) { return Object.freeze(vector); }
function freezeBounds(bounds) {
  freezeVector(bounds.min);
  freezeVector(bounds.max);
  return Object.freeze(bounds);
}

/**
 * Validate the complete generated ShapeTree before allocating graphics.
 * The 1 MiB metadata/key limit is a renderer limit, not wire validity.
 * Canonical keys use normalized local poses and sorted IDs/tags; input array
 * order and quaternion sign cannot manufacture a visual replacement.
 */
export function prepareShapeTree(shape) {
  if (shape === undefined) {
    const plan = Object.freeze({ key: "no-shape", parts: Object.freeze([]), localBounds: freezeBounds(new THREE.Box3(new THREE.Vector3(), new THREE.Vector3())) });
    plans.add(plan);
    return plan;
  }
  const nodes = shape?.nodes;
  if (!Array.isArray(nodes) || nodes.length === 0 || nodes.length > MAX_SHAPE_PARTS) invalid("shape must contain 1..256 nodes");
  // Identity errors precede field errors globally. Only <=256 node references
  // are copied/sorted here; opaque metadata stays untouched until its budget
  // passes below. Non-semantic input order cannot choose the reported cause.
  for (const node of nodes) {
    if (!node || !validId(node.nodeId) || !validId(node.parentNodeId, true)) invalid("invalid node or parent ID");
  }
  const orderedNodes = [...nodes].sort((left, right) => left.nodeId - right.nodeId);
  for (let index = 1; index < orderedNodes.length; index++) {
    if (orderedNodes[index - 1].nodeId === orderedNodes[index].nodeId) invalid("duplicate node ID");
  }
  const rows = [];
  let keyBytes = 2 + nodes.length - 1;
  let metadataBytes = 0;
  for (const node of orderedNodes) {
    const { position, quaternion } = localPose(node);
    const primitive = primitivePlan(node.primitive);
    const color = colorBytes(node.color);
    const jointName = node.jointName;
    if (jointName !== undefined && (typeof jointName !== "string" || !IDENTIFIER.test(jointName))) invalid("invalid joint name");
    const tags = node.materialTags ?? [];
    if (!Array.isArray(tags)) invalid("invalid material tags");
    // Even one-byte identifiers cost metadata plus quoted/comma key bytes.
    if (tags.length * 5 > MAX_PRESENTATION_BYTES - keyBytes - metadataBytes) budgetExceeded();
    let tagsBytes = 2 + Math.max(0, tags.length - 1);
    for (const tag of tags) {
      if (typeof tag !== "string" || !IDENTIFIER.test(tag)) invalid("invalid material tag");
      metadataBytes += tag.length;
      tagsBytes += tag.length + 2;
      if (keyBytes + metadataBytes + tagsBytes > MAX_PRESENTATION_BYTES) budgetExceeded();
    }
    metadataBytes += jointName?.length ?? 0;
    keyBytes += arrayBytes([
      String(node.nodeId).length, String(node.parentNodeId).length, primitive.kind.length + 2,
      numbersBytes(primitive.dimensions), numbersBytes(position.toArray()), numbersBytes(quaternion.toArray()),
      color ? numbersBytes(color) : 4, jointName === undefined ? 4 : jointName.length + 2, tagsBytes,
    ]);
    if (keyBytes + metadataBytes > MAX_PRESENTATION_BYTES) budgetExceeded();
    rows.push({ nodeId: node.nodeId, parentNodeId: node.parentNodeId, localPosition: position, localQuaternion: quaternion, ...primitive, color, jointName, tags });
  }

  // The total budget is checked before copying/sorting metadata or building
  // the content key. Identifiers are ASCII, so their lengths are UTF-8 bytes.
  rows.sort((left, right) => left.nodeId - right.nodeId);
  const byId = new Map();
  const joints = new Set();
  let roots = 0;
  for (const row of rows) {
    if (byId.has(row.nodeId)) invalid("duplicate node ID");
    byId.set(row.nodeId, row);
    if (row.parentNodeId === 0) roots++;
    if (row.jointName !== undefined) {
      if (joints.has(row.jointName)) invalid("duplicate joint name");
      joints.add(row.jointName);
    }
    row.tags = [...row.tags].sort();
    if (row.tags.some((tag, index) => index > 0 && tag === row.tags[index - 1])) invalid("duplicate material tag");
  }
  if (roots !== 1) invalid("shape must have exactly one root");
  const visiting = new Set();
  function compose(row) {
    if (row.position) return;
    if (visiting.has(row.nodeId)) invalid("shape contains a cycle");
    visiting.add(row.nodeId);
    if (row.parentNodeId === 0) {
      row.position = row.localPosition.clone();
      row.quaternion = row.localQuaternion.clone();
    } else {
      const parent = byId.get(row.parentNodeId);
      if (!parent) invalid("missing parent node");
      compose(parent);
      row.position = row.localPosition.clone().applyQuaternion(parent.quaternion).add(parent.position);
      row.quaternion = parent.quaternion.clone().multiply(row.localQuaternion).normalize();
    }
    visiting.delete(row.nodeId);
  }

  const localBounds = new THREE.Box3();
  for (const row of rows) {
    compose(row);
    const elements = new THREE.Matrix4().makeRotationFromQuaternion(row.quaternion).elements;
    const half = new THREE.Vector3(
      Math.abs(elements[0]) * row.half[0] + Math.abs(elements[4]) * row.half[1] + Math.abs(elements[8]) * row.half[2],
      Math.abs(elements[1]) * row.half[0] + Math.abs(elements[5]) * row.half[1] + Math.abs(elements[9]) * row.half[2],
      Math.abs(elements[2]) * row.half[0] + Math.abs(elements[6]) * row.half[1] + Math.abs(elements[10]) * row.half[2],
    );
    localBounds.expandByPoint(row.position.clone().sub(half));
    localBounds.expandByPoint(row.position.clone().add(half));
  }
  if (![...localBounds.min.toArray(), ...localBounds.max.toArray()].every(Number.isFinite)) invalid("non-finite composed bounds");
  if ([...localBounds.min.toArray(), ...localBounds.max.toArray()].some(value => Math.abs(value) > Number(WORLD_BOUND_MM) / 1000)) invalid("composed shape bounds exceed the world bound");
  if (localBounds.getSize(new THREE.Vector3()).toArray().some(value => value * 1000 > MAX_EXTENT_MM)) invalid("aggregate exceeds the constitutional extent limit");
  const key = JSON.stringify(rows.map(row => [row.nodeId, row.parentNodeId, row.kind, row.dimensions, row.localPosition.toArray(), row.localQuaternion.toArray(), row.color, row.jointName ?? null, row.tags]));
  const parts = rows.map(row => Object.freeze({
    nodeId: row.nodeId, parentNodeId: row.parentNodeId, kind: row.kind,
    dimensions: Object.freeze(row.dimensions), position: freezeVector(row.position), quaternion: Object.freeze(row.quaternion),
    color: row.color && Object.freeze(row.color), jointName: row.jointName, materialTags: Object.freeze(row.tags),
  }));
  const plan = Object.freeze({ key, parts: Object.freeze(parts), localBounds: freezeBounds(localBounds) });
  plans.add(plan);
  return plan;
}

function geometryFor(part) {
  const [a, b, c] = part.dimensions;
  switch (part.kind) {
    case "box": return new THREE.BoxGeometry(a, b, c);
    case "sphere": return new THREE.SphereGeometry(a, 16, 12);
    case "capsule": return b === 0 ? new THREE.SphereGeometry(a, 16, 12) : new THREE.CapsuleGeometry(a, b, 6, 16, 1);
    case "cylinder": return new THREE.CylinderGeometry(a, a, b, 16, 1, false);
    case "cone": return new THREE.ConeGeometry(a, b, 16, 1, false);
    case "panel": return new THREE.BoxGeometry(a, b, c);
    default: invalid("unsupported prepared primitive");
  }
}

/** Owns one shape's staged graphics. Disposal is idempotent, including failure. */
export function createShapeVisual(plan) {
  if (!plans.has(plan)) invalid("shape visual requires a validated render plan");
  const root = new THREE.Group();
  const resources = [];
  let disposed = false;
  function dispose() {
    if (disposed) return;
    disposed = true;
    for (const resource of resources) resource.dispose();
    root.clear();
  }
  try {
    for (const part of plan.parts) {
      const geometry = geometryFor(part);
      resources.push(geometry);
      const color = part.color ? new THREE.Color().setRGB(part.color[0] / 255, part.color[1] / 255, part.color[2] / 255, THREE.SRGBColorSpace) : new THREE.Color(0x808080);
      const opacity = part.color ? part.color[3] / 255 : 1;
      const material = new THREE.MeshStandardMaterial({ color, opacity, transparent: opacity < 1, depthWrite: opacity === 1 });
      resources.push(material);
      const mesh = new THREE.Mesh(geometry, material);
      mesh.position.copy(part.position);
      mesh.quaternion.copy(part.quaternion);
      mesh.userData = { nodeId: part.nodeId, parentNodeId: part.parentNodeId, jointName: part.jointName, materialTags: [...part.materialTags] };
      root.add(mesh);
    }
  } catch (error) {
    dispose();
    throw error;
  }
  return { root, localBounds: plan.localBounds.clone(), dispose };
}
