import assert from "node:assert/strict";
import test from "node:test";
import * as THREE from "three";
import { create } from "@bufbuild/protobuf";
import { ShapeNodeSchema, ShapeTreeSchema } from "@aigent-place/protocol";
import { prepareShapeTree, createShapeVisual } from "../src/shape-visuals.js";

const node = (nodeId = 1, primitive = { case: "box", value: { sizeXMm: 1000n, sizeYMm: 1000n, sizeZMm: 1000n } }, overrides = {}) =>
  create(ShapeNodeSchema, {
    nodeId, parentNodeId: 0, primitive, ...overrides,
    transform: {
      translation: { xMm: 0n, yMm: 0n, zMm: 0n },
      rotation: { x: 0, y: 0, z: 0, w: 1 },
      ...overrides.transform,
    },
  });
const tree = (...nodes) => create(ShapeTreeSchema, { nodes });
const tinyBox = { case: "box", value: { sizeXMm: 1n, sizeYMm: 1n, sizeZMm: 1n } };
const close = (actual, expected, message, tolerance = 1e-6) =>
  assert.ok(Math.abs(actual - expected) <= tolerance, `${message}: ${actual} != ${expected}`);
const vectorClose = (actual, expected, message, tolerance = 1e-6) => {
  actual.toArray().forEach((value, index) => close(value, expected[index], `${message}[${index}]`, tolerance));
};
const boundsClose = (bounds, min, max, message) => {
  assert.ok(bounds instanceof THREE.Box3, `${message}: public bounds must be a real Box3`);
  vectorClose(bounds.min, min, `${message} min`);
  vectorClose(bounds.max, max, `${message} max`);
};
function meshes(visual) {
  const result = [];
  visual.root.traverse(object => { if (object.isMesh) result.push(object); });
  return result;
}
function invalid(shape, reason) {
  assert.throws(() => prepareShapeTree(shape), error =>
    error.constructor.name === "ShapePresentationError" && error.code === "INVALID_SHAPE" && typeof error.message === "string" && error.message.length > 0, reason);
}
function rendered(source, check) {
  const plan = prepareShapeTree(source);
  const visual = createShapeVisual(plan);
  try {
    assert.ok(visual.root instanceof THREE.Object3D);
    check(visual, plan);
  } finally { visual.dispose(); }
}

const primitives = [
  ["box", { sizeXMm: 1200n, sizeYMm: 1800n, sizeZMm: 800n }, THREE.BoxGeometry, [1.2, 1.8, 0.8]],
  ["sphere", { radiusMm: 350n }, THREE.SphereGeometry, [0.7, 0.7, 0.7]],
  ["capsule", { radiusMm: 250n, segmentLengthMm: 1500n }, THREE.CapsuleGeometry, [0.5, 2, 0.5]],
  ["cylinder", { radiusMm: 300n, heightMm: 1250n }, THREE.CylinderGeometry, [0.6, 1.25, 0.6]],
  ["cone", { radiusMm: 400n, heightMm: 1600n }, THREE.ConeGeometry, [0.8, 1.6, 0.8]],
  ["panel", { widthMm: 2000n, heightMm: 1000n, thicknessMm: 40n }, THREE.BoxGeometry, [2, 1, 0.04]],
];
for (const [kind, value, Geometry, fullSize] of primitives) {
  test(`real ${kind} geometry uses full millimetre dimensions and a geometric-centre origin`, () => {
    rendered(tree(node(1, { case: kind, value })), (visual, plan) => {
      const [mesh] = meshes(visual);
      assert.equal(meshes(visual).length, 1);
      assert.ok(mesh.geometry instanceof Geometry, `must render ${kind}, not a placeholder`);
      mesh.geometry.computeBoundingBox();
      const half = fullSize.map(axis => axis / 2);
      boundsClose(mesh.geometry.boundingBox, half.map(axis => -axis), half, "actual vertex bounds");
      boundsClose(plan.localBounds, half.map(axis => -axis), half, "canonical plan bounds");
      boundsClose(visual.localBounds, half.map(axis => -axis), half, "public visual bounds");
      vectorClose(mesh.position, [0, 0, 0], "mesh geometric centre");
      const positions = mesh.geometry.getAttribute("position");
      assert.ok(positions instanceof THREE.BufferAttribute && positions.count > 0);
      for (let index = 0; index < positions.count; index += 1) {
        for (const coordinate of [positions.getX(index), positions.getY(index), positions.getZ(index)]) assert.ok(Number.isFinite(coordinate));
      }
      if (kind === "sphere") {
        for (let index = 0; index < positions.count; index += 1) {
          close(Math.hypot(positions.getX(index), positions.getY(index), positions.getZ(index)), 0.35, "sphere surface radius");
        }
      }
      if (kind === "cone") {
        const top = Array.from({ length: positions.count }, (_, index) => index).filter(index => Math.abs(positions.getY(index) - 0.8) < 1e-6);
        assert.ok(top.length > 0, "cone needs an apex at the positive-Y end");
        for (const index of top) close(Math.hypot(positions.getX(index), positions.getZ(index)), 0, "cone apex radial position");
      }
      if (kind === "panel") assert.ok(mesh.geometry.boundingBox.getSize(new THREE.Vector3()).z > 0, "panel is a solid, not a zero-thickness plane");
      if (kind === "cylinder" || kind === "cone") {
        assert.equal(mesh.geometry.parameters.radiusBottom, kind === "cylinder" ? 0.3 : undefined);
        if (kind === "cylinder") assert.equal(mesh.geometry.parameters.radiusTop, 0.3);
        assert.equal(mesh.geometry.parameters.openEnded, false);
        const indices = mesh.geometry.getIndex();
        let bottomCap = false;
        for (let index = 0; index < indices.count; index += 3) {
          const points = [0, 1, 2].map(offset => new THREE.Vector3().fromBufferAttribute(positions, indices.getX(index + offset)));
          if (points.every(point => Math.abs(point.y + half[1]) < 1e-6) && points[1].clone().sub(points[0]).cross(points[2].clone().sub(points[0])).lengthSq() > 0) bottomCap = true;
        }
        assert.ok(bottomCap, "solid cylinder/cone base has actual triangles");
      }
    });
  });
}

test("capsule zero segment is a centred sphere and a positive segment excludes both hemispheres", () => {
  rendered(tree(node(1, { case: "capsule", value: { radiusMm: 400n, segmentLengthMm: 0n } })), visual => {
    const [mesh] = meshes(visual);
    assert.ok(mesh.geometry instanceof THREE.SphereGeometry);
    mesh.geometry.computeBoundingBox();
    boundsClose(mesh.geometry.boundingBox, [-0.4, -0.4, -0.4], [0.4, 0.4, 0.4], "zero segment sphere");
  });
  rendered(tree(node(1, { case: "capsule", value: { radiusMm: 250n, segmentLengthMm: 1500n } })), visual => {
    const [mesh] = meshes(visual);
    const positions = mesh.geometry.getAttribute("position");
    const equator = Array.from({ length: positions.count }, (_, index) => index).filter(index =>
      Math.abs(Math.abs(positions.getY(index)) - 0.75) < 1e-6 && Math.abs(Math.hypot(positions.getX(index), positions.getZ(index)) - 0.25) < 1e-6);
    assert.ok(equator.length > 0, "hemisphere equators are at half the supplied segment length");
    mesh.geometry.computeBoundingBox();
    close(mesh.geometry.boundingBox.getSize(new THREE.Vector3()).y, 2, "full capsule height is segment plus two radii");
  });
});

function transformedTree() {
  // Arithmetic oracle: root Rz(90), child Rx(90), grandchild Ry(90).
  // Each near-unit quaternion is within the canonical tolerance, so normalize
  // before composing rather than letting floating-point scale enter the pose.
  const h = Math.SQRT1_2 * (1 + 2e-7);
  return tree(
    node(7, { case: "box", value: { sizeXMm: 1000n, sizeYMm: 2000n, sizeZMm: 3000n } }, {
      parentNodeId: 3, transform: { translation: { xMm: 0n, yMm: 2000n, zMm: 0n }, rotation: { x: 0, y: h, z: 0, w: h } },
    }),
    node(10, undefined, { transform: { translation: { xMm: 1000n, yMm: 2000n, zMm: 3000n }, rotation: { x: 0, y: 0, z: h, w: h } } }),
    node(3, { case: "box", value: { sizeXMm: 2000n, sizeYMm: 4000n, sizeZMm: 6000n } }, {
      parentNodeId: 10, transform: { translation: { xMm: 1000n, yMm: 0n, zMm: 0n }, rotation: { x: h, y: 0, z: 0, w: h } },
    }),
  );
}

test("root and noncommuting parent rotations compose before child poses independent of input order", () => {
  const source = transformedTree();
  const permutations = [source.nodes, [...source.nodes].reverse(), [source.nodes[1], source.nodes[2], source.nodes[0]]];
  let key;
  for (const nodes of permutations) rendered(create(ShapeTreeSchema, { nodes }), (visual, plan) => {
    assert.equal(typeof plan.key, "string");
    assert.ok(plan.key.length > 0);
    if (key !== undefined) assert.equal(plan.key, key, "node permutation preserves stable content identity");
    key = plan.key;
    assert.deepEqual(visual.root.children.map(mesh => mesh.userData.nodeId), [3, 7, 10], "meshes are flat in canonical ID order");
    const byId = new Map(meshes(visual).map(mesh => [mesh.userData.nodeId, mesh]));
    const expected = new Map([
      [10, { centre: [1, 2, 3], basis: [[0, 1, 0], [-1, 0, 0], [0, 0, 1]] }],
      [3, { centre: [1, 3, 3], basis: [[0, 1, 0], [0, 0, 1], [1, 0, 0]] }],
      [7, { centre: [1, 3, 5], basis: [[-1, 0, 0], [0, 0, 1], [0, 1, 0]] }],
    ]);
    for (const [id, oracle] of expected) {
      const mesh = byId.get(id);
      vectorClose(mesh.position, oracle.centre, `node${id} composed centre`);
      close(mesh.quaternion.length(), 1, `node${id} unit quaternion`, 1e-12);
      for (const [axis, basis] of [[new THREE.Vector3(1, 0, 0), oracle.basis[0]], [new THREE.Vector3(0, 1, 0), oracle.basis[1]], [new THREE.Vector3(0, 0, 1), oracle.basis[2]]]) {
        vectorClose(axis.applyQuaternion(mesh.quaternion), basis, `node${id} independently known rotated basis`);
      }
    }
    boundsClose(plan.localBounds, [-2, 1.5, 1], [4, 4.5, 6], "composed canonical bounds");
    boundsClose(visual.localBounds, [-2, 1.5, 1], [4, 4.5, 6], "composed public bounds");
    boundsClose(new THREE.Box3().setFromObject(visual.root), [-2, 1.5, 1], [4, 4.5, 6], "actual composed geometry bounds");
    // Entity position belongs outside this local shape and must be applied once.
    visual.root.position.set(11, -2, 4);
    visual.root.updateMatrixWorld(true);
    vectorClose(byId.get(7).getWorldPosition(new THREE.Vector3()), [12, 1, 9], "one external entity translation");
  });
});

test("canonical bounds stay conservative for curved primitives under rotation", () => {
  const half = Math.SQRT1_2;
  rendered(tree(node(1, { case: "sphere", value: { radiusMm: 1000n } }, {
    transform: { rotation: { x: 0, y: 0, z: Math.sin(Math.PI / 8), w: Math.cos(Math.PI / 8) } },
  })), (visual, plan) => {
    // Canonical collision bounds rotate the primitive's local AABB, although
    // the descriptive sphere mesh itself remains a sphere.
    boundsClose(plan.localBounds, [-2 * half, -2 * half, -1], [2 * half, 2 * half, 1], "conservative rotated sphere");
    visual.root.updateMatrixWorld(true);
    const vertices = meshes(visual)[0].geometry.getAttribute("position");
    for (let index = 0; index < vertices.count; index += 1) {
      const world = new THREE.Vector3().fromBufferAttribute(vertices, index).applyMatrix4(meshes(visual)[0].matrixWorld);
      assert.ok(plan.localBounds.clone().expandByScalar(1e-6).containsPoint(world), "every actual vertex is contained by canonical bounds");
    }
  });
});

const srgbToLinear = byte => {
  const channel = byte / 255;
  return channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
};
test("supplied RGB bytes are sRGB and alpha including omitted zero stays authoritative", () => {
  for (const alpha of [0, 128, 255, undefined]) rendered(tree(node(1, undefined, {
    color: { red: 128, green: 64, blue: 32, ...(alpha === undefined ? {} : { alpha }) },
  })), visual => {
    const material = meshes(visual)[0].material;
    // Three's sRGB conversion constants are rounded; a1e-9 tolerance keeps
    // this independent IEC transfer-function oracle stricter than pixel bytes.
    close(material.color.r, srgbToLinear(128), "red working-space conversion", 1e-9);
    close(material.color.g, srgbToLinear(64), "green working-space conversion", 1e-9);
    close(material.color.b, srgbToLinear(32), "blue working-space conversion", 1e-9);
    assert.equal(material.color.getHex(), 0x804020);
    assert.equal(material.opacity, (alpha ?? 0) / 255);
    assert.equal(material.transparent, (alpha ?? 0) < 255);
  });
});

test("absent colour is neutral sRGB grey and material/joint metadata remains opaque", () => {
  rendered(tree(node(12, undefined, { jointName: "left_arm", materialTags: ["metal", "transparent"] })), visual => {
    const [mesh] = meshes(visual);
    assert.equal(mesh.material.color.getHex(), 0x808080);
    close(mesh.material.color.r, srgbToLinear(128), "neutral grey working space", 1e-9);
    assert.equal(mesh.material.opacity, 1);
    assert.equal(mesh.material.transparent, false, "a material tag does not override absent-colour opacity");
    assert.equal(mesh.material.map, null, "tags do not select external texture assets");
    assert.equal(mesh.userData.nodeId, 12);
    assert.equal(mesh.userData.parentNodeId, 0);
    assert.equal(mesh.userData.jointName, "left_arm");
    assert.deepEqual(mesh.userData.materialTags, ["metal", "transparent"]);
  });
  rendered(tree(node()), visual => {
    assert.equal(meshes(visual)[0].userData.jointName, undefined, "absent joint name is not fabricated");
  });
});

test("optional absent shape has an explicit empty visual while a present empty graph rejects", () => {
  const plan = prepareShapeTree(undefined);
  assert.equal(typeof plan.key, "string");
  assert.ok(plan.key.length > 0);
  assert.equal(prepareShapeTree(undefined).key, plan.key);
  boundsClose(plan.localBounds, [0, 0, 0], [0, 0, 0], "absent shape plan");
  const visual = createShapeVisual(plan);
  try {
    assert.ok(visual.root instanceof THREE.Group);
    assert.equal(visual.root.children.length, 0);
    assert.equal(meshes(visual).length, 0, "no fabricated placeholder graphics");
    boundsClose(visual.localBounds, [0, 0, 0], [0, 0, 0], "absent shape visual");
  } finally { visual.dispose(); visual.dispose(); }
  invalid(tree(), "present empty graph remains malformed");
});

test("stable content key changes for geometry, transforms, RGBA and opaque metadata", () => {
  const original = tree(node());
  const key = prepareShapeTree(original).key;
  const changes = [
    shape => { shape.nodes[0].primitive.value.sizeYMm = 1800n; },
    shape => { shape.nodes[0].transform.translation.xMm = 1n; },
    shape => { shape.nodes[0].color = { red: 128, green: 0, blue: 0, alpha: 0 }; },
    shape => { shape.nodes[0].jointName = "root_joint"; },
    shape => { shape.nodes[0].materialTags = ["wood"]; },
  ];
  for (const change of changes) {
    const changed = tree(node());
    change(changed);
    assert.notEqual(prepareShapeTree(changed).key, key, "visual/metadata replacement must not reuse an unchanged-shape identity");
  }
});

test("equivalent quaternion signs and material-tag order preserve stable shape identity without mutating input", () => {
  const source = transformedTree();
  source.nodes[1].materialTags = ["wood", "metal"];
  const before = structuredClone(source);
  const key = prepareShapeTree(source).key;
  assert.deepEqual(source, before, "preparation must not sort or normalize the source messages in place");
  const equivalent = structuredClone(source);
  equivalent.nodes.reverse();
  for (const part of equivalent.nodes) {
    for (const component of ["x", "y", "z", "w"]) part.transform.rotation[component] *= -1;
    part.materialTags.reverse();
  }
  assert.equal(prepareShapeTree(equivalent).key, key, "equivalent local orientations and opaque-tag sets must not rebuild geometry");
});

test("all six primitive boundaries use full extents and capsule segment alone may be zero", () => {
  const valid = [
    ["box", { sizeXMm: 100000n, sizeYMm: 1n, sizeZMm: 1n }],
    ["sphere", { radiusMm: 50000n }],
    ["capsule", { radiusMm: 1n, segmentLengthMm: 99998n }],
    ["cylinder", { radiusMm: 50000n, heightMm: 100000n }],
    ["cone", { radiusMm: 50000n, heightMm: 100000n }],
    ["panel", { widthMm: 100000n, heightMm: 1n, thicknessMm: 1n }],
  ];
  for (const [kind, value] of valid) assert.ok(prepareShapeTree(tree(node(1, { case: kind, value }))), `${kind}: inclusive full-extent boundary`);
  for (const [kind, value] of primitives) {
    for (const field of Object.keys(value)) {
      for (const dimension of [-1n, 100001n]) invalid(tree(node(1, { case: kind, value: { ...value, [field]: dimension } })), `${kind}.${field}: invalid ${dimension}`);
      if (field !== "segmentLengthMm") invalid(tree(node(1, { case: kind, value: { ...value, [field]: 0n } })), `${kind}.${field}: zero dimension`);
      const malformed = tree(node(1, { case: kind, value }));
      malformed.nodes[0].primitive.value[field] = 1.5;
      invalid(malformed, `${kind}.${field}: non-integer protocol dimension`);
    }
  }
  for (const kind of ["sphere", "capsule", "cylinder", "cone"]) {
    const value = primitives.find(entry => entry[0] === kind)[1];
    invalid(tree(node(1, { case: kind, value: { ...value, radiusMm: 50001n } })), `${kind}: diameter exceeds100m even though radius does not`);
  }
  invalid(tree(node(1, { case: "capsule", value: { radiusMm: 1n, segmentLengthMm: 99999n } })), "capsule radius plus segment full height exceeds100m");
});

function invalidGraphs() {
  const mutate = edit => { const source = tree(node()); edit(source); return source; };
  return [
    [null, "malformed null shape"], [{}, "missing nodes"], [{ nodes: {} }, "non-array nodes"], [tree(), "empty graph"],
    [tree(node(0)), "zero ID"], [tree(node(1), node(1)), "duplicate ID"],
    [tree(node(1), node(2, undefined, { parentNodeId: 1 }), node(2, undefined, { parentNodeId: 1 })), "duplicate children with exactly one root"],
    [tree(node(1), node(2)), "multiple roots"],
    [tree(node(1, undefined, { parentNodeId: 2 }), node(2, undefined, { parentNodeId: 1 })), "cycle without a root"],
    [tree(node(1), node(2, undefined, { parentNodeId: 99 })), "missing parent"],
    [tree(node(1), node(2, undefined, { parentNodeId: 2 })), "self parent"],
    [tree(node(1), node(2, undefined, { parentNodeId: 3 }), node(3, undefined, { parentNodeId: 2 })), "disconnected cycle"],
    ...[-1, 1.5, 0x1_0000_0000].map(value => [mutate(shape => { shape.nodes[0].nodeId = value; }), "invalid uint32 ID"]),
    [mutate(shape => { shape.nodes[0].parentNodeId = -1; }), "negative parent ID"],
    [mutate(shape => { shape.nodes[0].primitive = { case: undefined }; }), "missing primitive"],
    [mutate(shape => { shape.nodes[0].primitive = { case: "unknown", value: {} }; }), "unknown primitive"],
    [mutate(shape => { shape.nodes[0].primitive.value = null; }), "missing primitive body"],
    [mutate(shape => { shape.nodes[0].transform = undefined; }), "missing transform"],
    [mutate(shape => { shape.nodes[0].transform.rotation = undefined; }), "missing rotation"],
  ];
}

test("invalid complete graphs reject before any geometry or material allocation", t => {
  const geometryMethod = THREE.BufferGeometry.prototype.setAttribute;
  const materialMethod = THREE.MeshStandardMaterial.prototype.setValues;
  const geometryAllocations = t.mock.method(THREE.BufferGeometry.prototype, "setAttribute", function (...args) { return geometryMethod.apply(this, args); });
  const materialAllocations = t.mock.method(THREE.MeshStandardMaterial.prototype, "setValues", function (...args) { return materialMethod.apply(this, args); });
  rendered(tree(node()), () => {});
  assert.ok(geometryAllocations.mock.calls.length > 0, "real geometry allocation detector positive control");
  assert.ok(materialAllocations.mock.calls.length > 0, "real material allocation detector positive control");
  geometryAllocations.mock.resetCalls();
  materialAllocations.mock.resetCalls();
  for (const [shape, reason] of invalidGraphs()) assert.throws(() => createShapeVisual(prepareShapeTree(shape)), error => error.code === "INVALID_SHAPE", reason);
  assert.equal(geometryAllocations.mock.calls.length, 0, "whole-tree preflight precedes geometry allocation");
  assert.equal(materialAllocations.mock.calls.length, 0, "whole-tree preflight precedes material allocation");
});

test("transform, colour and identifier boundaries reject malformed complete shapes", () => {
  for (const axis of ["xMm", "yMm", "zMm"]) {
    for (const endpoint of [-99999999n, 99999999n]) {
      assert.ok(prepareShapeTree(tree(node(1, tinyBox, { transform: { translation: { [axis]: endpoint } } }))), `${axis}: legal part within translation and complete-bound limits`);
    }
    for (const value of [-100000001n, 100000001n]) invalid(tree(node(1, tinyBox, { transform: { translation: { [axis]: value } } })), `${axis}: outside translation bound`);
  }
  for (const rotation of [{ x: 0, y: 0, z: 0, w: 0 }, { x: NaN, y: 0, z: 0, w: 1 }, { x: 0, y: Infinity, z: 0, w: 1 }, { x: 0, y: 0, z: 1, w: 1 }]) {
    invalid(tree(node(1, tinyBox, { transform: { rotation } })), "zero or non-finite quaternion");
  }
  for (const channel of ["red", "green", "blue", "alpha"]) {
    for (const value of [-1, 256, 1.5, NaN, Infinity]) {
      const source = tree(node(1, tinyBox, { color: { red: 0, green: 0, blue: 0, alpha: 255 } }));
      source.nodes[0].color[channel] = value;
      invalid(source, `${channel}: invalid colour byte`);
    }
  }
  invalid(tree(node(1, tinyBox, { jointName: "same_joint" }), node(2, tinyBox, { parentNodeId: 1, jointName: "same_joint" })), "duplicate joint name");
  for (const name of ["", "Uppercase", "name with space", "a".repeat(65)]) {
    invalid(tree(node(1, tinyBox, { jointName: name })), "invalid joint identifier");
    invalid(tree(node(1, tinyBox, { materialTags: [name] })), "invalid material identifier");
  }
  invalid(tree(node(1, tinyBox, { materialTags: ["metal", "metal"] })), "duplicate per-node material tag");
});

function expectPermutationReason(nodes, message, code = "INVALID_SHAPE") {
  const permutations = values => values.length === 0 ? [[]] : values.flatMap((value, index) =>
    permutations(values.filter((_, candidate) => candidate !== index)).map(tail => [value, ...tail]));
  for (const order of permutations(nodes)) {
    const source = { nodes: order };
    const before = structuredClone(source);
    assert.throws(() => createShapeVisual(prepareShapeTree(source)), error => {
      assert.equal(error.constructor.name, "ShapePresentationError");
      assert.equal(error.code, code, "non-semantic node order cannot change error classification");
      assert.equal(error.message, message, "ascending node-ID precedence preserves the specific cause");
      return true;
    });
    assert.deepEqual(source, before, "diagnostic canonicalization does not mutate input nodes or metadata");
  }
}

test("permuted simultaneous field defects report the lowest node-ID cause", () => {
  const low = node(1);
  low.primitive = { case: undefined };
  const high = node(2, tinyBox, { parentNodeId: 1, color: { red: 256, green: 0, blue: 0, alpha: 255 } });
  expectPermutationReason([low, high, node(3, tinyBox, { parentNodeId: 1 })], "missing primitive");
});

test("identity validity globally precedes simultaneous malformed poses", () => {
  const badPose = node(1);
  badPose.transform.rotation = undefined;
  expectPermutationReason([badPose, node(0), node(3, tinyBox, { parentNodeId: 99 })], "invalid node or parent ID");
  expectPermutationReason([badPose, node(2, tinyBox, { parentNodeId: -1 }), node(3, tinyBox, { parentNodeId: 1 })], "invalid node or parent ID");
});

test("duplicate identity globally precedes simultaneous per-node defects", () => {
  const badPose = node(1);
  badPose.transform.rotation = undefined;
  const duplicate = node(2, tinyBox, { parentNodeId: 1, color: { red: 0, green: 256, blue: 0, alpha: 255 } });
  expectPermutationReason([badPose, node(2, tinyBox, { parentNodeId: 1 }), duplicate], "duplicate node ID");
});

test("permuted metadata support excess and malformed geometry preserve typed specific cause", () => {
  const oversized = node(1, tinyBox, {
    materialTags: Array.from({ length: 20000 }, (_, index) => `tag${String(index).padStart(5, "0")}${"a".repeat(55)}`),
  });
  const missing = node(2, tinyBox, { parentNodeId: 1 });
  missing.primitive = { case: undefined };
  expectPermutationReason([oversized, missing], "shape metadata and canonical key exceed the 1 MiB presentation limit", "UNSUPPORTED_SHAPE_PRESENTATION");
});

test("aggregate extents include translated and rotated nodes rather than only primitive dimensions", () => {
  const at = xMm => ({ parentNodeId: 1, transform: { translation: { xMm } } });
  const accepted = tree(node(), node(2, undefined, at(99000n)));
  boundsClose(prepareShapeTree(accepted).localBounds, [-0.5, -0.5, -0.5], [99.5, 0.5, 0.5], "inclusive100m aggregate");
  invalid(tree(node(), node(2, undefined, at(99001n))), "individual legal parts have oversized aggregate extent");
  invalid(tree(node(1, { case: "box", value: { sizeXMm: 100000n, sizeYMm: 100000n, sizeZMm: 1n } }, {
    transform: { rotation: { x: 0, y: 0, z: Math.sin(Math.PI / 8), w: Math.cos(Math.PI / 8) } },
  })), "rotation makes canonical aggregate exceed100m");
});

test("composed parents and complete part bounds stay inside the local world bound", () => {
  invalid(tree(node(1, tinyBox, {
    transform: { translation: { xMm: 99999800n, yMm: 0n, zMm: 0n } },
  }), node(2, tinyBox, { parentNodeId: 1, transform: { translation: { xMm: 150n, yMm: 0n, zMm: 0n } } }),
  node(3, tinyBox, { parentNodeId: 2, transform: { translation: { xMm: 150n, yMm: 0n, zMm: 0n } } })), "individually bounded offsets compose beyond the100km world bound with a small aggregate extent");
  for (const axis of ["xMm", "yMm", "zMm"]) {
    for (const endpoint of [-100000000n, 100000000n]) invalid(tree(node(1, tinyBox, { transform: { translation: { [axis]: endpoint } } })), "the complete part, not only its centre, stays within world bounds");
  }
});

test("the full256-node tree renders without truncation and257 rejects before allocation", () => {
  const source = tree(...Array.from({ length: 256 }, (_, index) => node(index + 1, tinyBox, { parentNodeId: index === 0 ? 0 : 1 })));
  rendered(source, visual => {
    assert.equal(meshes(visual).length, 256);
    assert.deepEqual(visual.root.children.map(mesh => mesh.userData.nodeId), Array.from({ length: 256 }, (_, index) => index + 1));
    boundsClose(visual.localBounds, [-0.0005, -0.0005, -0.0005], [0.0005, 0.0005, 0.0005], "all parts retained");
  });
  source.nodes.push(node(257, tinyBox, { parentNodeId: 1 }));
  invalid(source, "constitutional256-part cap");
});

test("shape visual disposal releases every owned real geometry and material exactly once", () => {
  const source = tree(...primitives.map(([kind, value], index) => node(index + 1, { case: kind, value }, { parentNodeId: index === 0 ? 0 : 1 })));
  const visual = createShapeVisual(prepareShapeTree(source));
  const resources = new Set(meshes(visual).flatMap(mesh => [mesh.geometry, ...(Array.isArray(mesh.material) ? mesh.material : [mesh.material])]));
  const counts = new Map([...resources].map(resource => [resource, 0]));
  for (const resource of resources) resource.addEventListener("dispose", () => counts.set(resource, counts.get(resource) + 1));
  visual.dispose();
  visual.dispose();
  assert.ok(resources.size >= 6, "resources came from the actual six-primitive visual");
  for (const count of counts.values()) assert.equal(count, 1, "one release per owned resource despite repeated disposal");
});

test("oversized valid opaque metadata rejects explicitly before graphics allocation without truncation", t => {
  const source = tree(node(1, tinyBox, {
    materialTags: Array.from({ length: 20000 }, (_, index) => `tag${String(index).padStart(5, "0")}${"a".repeat(55)}`),
  }));
  const geometryMethod = THREE.BufferGeometry.prototype.setAttribute;
  const geometryAllocations = t.mock.method(THREE.BufferGeometry.prototype, "setAttribute", function (...args) { return geometryMethod.apply(this, args); });
  assert.throws(() => createShapeVisual(prepareShapeTree(source)), error => error.code === "UNSUPPORTED_SHAPE_PRESENTATION", "legal identifiers exceed the approved1MiB presentation metadata/key budget");
  assert.equal(geometryAllocations.mock.calls.length, 0);
  assert.equal(source.nodes[0].materialTags.length, 20000, "input is rejected, never silently truncated");
});

test("presentation budget bounds actual UTF-8 metadata plus the released key at the boundary", () => {
  const encoder = new TextEncoder();
  const limit = 1_048_576; // Accepted renderer contract, independent of the production guard.
  const cost = plan => encoder.encode(plan.key).byteLength + plan.parts.reduce((sum, part) =>
    sum + (part.jointName === undefined ? 0 : encoder.encode(part.jointName).byteLength)
      + part.materialTags.reduce((bytes, tag) => bytes + encoder.encode(tag).byteLength, 0), 0);
  const tag = index => `material_${String(index).padStart(6, "0")}`.padEnd(64, "a");
  const h = Math.SQRT1_2;
  const fixtures = [
    tags => tree(node(0xffffffff, { case: "box", value: { sizeXMm: 1n, sizeYMm: 12345n, sizeZMm: 99999n } }, {
      jointName: "origin_joint.x-0", materialTags: tags, color: { red: 255, green: 1, blue: 128, alpha: 0 },
      transform: { translation: { xMm: -98765432n, yMm: 12345n, zMm: -6789n }, rotation: { x: -0, y: h, z: 0, w: h } },
    })),
    tags => tree(node(99, { case: "sphere", value: { radiusMm: 2222n } }, {
      jointName: "rounded_joint.2", materialTags: tags,
      transform: { translation: { xMm: -12345n, yMm: 3333n, zMm: -2005n }, rotation: { x: 0, y: 0, z: 0, w: 1 } },
    }), node(7, { case: "capsule", value: { radiusMm: 350n, segmentLengthMm: 0n } }, {
      parentNodeId: 99, jointName: "child_7", color: { red: 0, green: 255, blue: 2, alpha: 255 },
      transform: { translation: { xMm: 1234n, yMm: -5678n, zMm: 9001n }, rotation: { x: h, y: 0, z: 0, w: -h } },
    })),
  ];
  const acceptedCosts = [];
  for (const fixture of fixtures) {
    const one = cost(prepareShapeTree(fixture([tag(0)])));
    const marginal = cost(prepareShapeTree(fixture([tag(0), tag(1)]))) - one;
    // Measure released-key growth rather than duplicating its encoding formula.
    const count = 1 + Math.floor((limit - one) / marginal);
    const tags = Array.from({ length: count }, (_, index) => tag(index));
    const near = cost(prepareShapeTree(fixture(tags)));
    let filler;
    for (let length = 7; length <= 64; length++) {
      const candidate = "filler_".padEnd(length, "b");
      const increment = cost(prepareShapeTree(fixture([tag(0), candidate]))) - one;
      if (near + increment <= limit) filler = candidate;
    }
    assert.ok(filler, "fixture can fill the artifact budget without invalid identifiers");
    const source = fixture([...tags, filler]);
    const actual = cost(prepareShapeTree(source));
    acceptedCosts.push(actual);
    assert.ok(actual <= limit && limit - actual <= 1, "released key plus metadata fits at the one-byte boundary");
    const metadata = source.nodes.find(part => part.materialTags.includes(filler)).materialTags;
    metadata[metadata.indexOf(filler)] += "b";
    assert.throws(() => prepareShapeTree(source), error => error.code === "UNSUPPORTED_SHAPE_PRESENTATION",
      "one extra valid identifier byte must reject the over-budget artifact");
  }
  assert.ok(acceptedCosts.includes(limit), "positive control reaches the exact 1 MiB supported boundary");
});

test("failure during staged shape attachment releases every allocated surface", t => {
  const originalAdd = THREE.Group.prototype.add;
  const originalGeometryDispose = THREE.BufferGeometry.prototype.dispose;
  const originalMaterialDispose = THREE.MeshStandardMaterial.prototype.dispose;
  const geometries = t.mock.method(THREE.BufferGeometry.prototype, "dispose", function () { return originalGeometryDispose.call(this); });
  const materials = t.mock.method(THREE.MeshStandardMaterial.prototype, "dispose", function () { return originalMaterialDispose.call(this); });
  t.mock.method(THREE.Group.prototype, "add", function (...objects) {
    originalAdd.apply(this, objects);
    if (objects[0].userData.nodeId === 2) throw new Error("staged surface attachment failure");
    return this;
  });
  const source = tree(node(1), node(2, undefined, { parentNodeId: 1 }), node(3, undefined, { parentNodeId: 1 }));
  assert.throws(() => createShapeVisual(prepareShapeTree(source)), /staged surface attachment/);
  assert.equal(geometries.mock.calls.length, 2, "both allocated geometries released before rethrow");
  assert.equal(materials.mock.calls.length, 2, "both allocated materials released before rethrow");
  assert.equal(new Set(geometries.mock.calls.map(call => call.this)).size, 2);
  assert.equal(new Set(materials.mock.calls.map(call => call.this)).size, 2);
});
