import assert from "node:assert/strict";
import test from "node:test";
import * as THREE from "three";
import { createResidentVisual, TRAIL_CAP } from "../src/resident-visuals.js";

function boxShape(overrides = {}) {
  return { nodes: [{
    nodeId: 1, parentNodeId: 0,
    transform: { translation: { xMm: 0n, yMm: 0n, zMm: 0n }, rotation: { x: 0, y: 0, z: 0, w: 1 } },
    color: { red: 80, green: 160, blue: 220, alpha: 255 }, materialTags: [],
    primitive: { case: "box", value: { sizeXMm: 1000n, sizeYMm: 1800n, sizeZMm: 1000n } },
    ...overrides,
  }] };
}
const aim = { targetXMm: 9000n, targetZMm: -3000n, speedMmPerS: 500 };
function record(shape, activeAim) { return { shape, aim: arguments.length === 1 ? aim : activeAim }; }
function shapeMeshes(visual) { return visual.mesh.children[0].children; }
function watchResources(graphics) {
  const counts = new Map();
  for (const graphic of graphics) {
    for (const resource of [graphic.geometry, graphic.material]) {
      counts.set(resource, 0);
      resource.addEventListener("dispose", () => counts.set(resource, counts.get(resource) + 1));
    }
  }
  return counts;
}
function assertDisposed(counts, expected) { for (const count of counts.values()) assert.equal(count, expected); }
function linePoints(line) {
  const attribute = line.geometry.getAttribute("position");
  return Array.from({ length: line.geometry.drawRange.count }, (_, index) => [attribute.getX(index), attribute.getY(index), attribute.getZ(index)]);
}

test("absent shape stays an empty observed resident while a present empty tree rejects", () => {
  const scene = new THREE.Scene();
  const visual = createResidentVisual(scene, 1n, undefined);
  assert.equal(shapeMeshes(visual).length, 0, "no fabricated cube for shapeless records");
  assert.deepEqual(visual.localBounds.min.toArray(), [0, 0, 0]);
  assert.deepEqual(visual.localBounds.max.toArray(), [0, 0, 0]);
  visual.mesh.position.set(2, 8, 3);
  visual.update(record(undefined), new THREE.Vector3(2, 8, 3));
  assert.deepEqual(linePoints(visual.aimLine), [[2, 8, 3], [9, 8, -3]]);
  assert.equal(visual.trail.length, 1);
  assert.throws(() => visual.update(record({ nodes: [] }), new THREE.Vector3(4, 8, 3)), /1\.\.256/);
  assert.equal(visual.trail.length, 1, "invalid replacement cannot alter authoritative history");
  visual.dispose();
  assert.equal(scene.children.length, 0);
});

test("authoritative height and dimensions are used once beneath a stable caller-controlled root", () => {
  const visual = createResidentVisual(new THREE.Scene(), 2n, boxShape());
  assert.ok(visual.mesh.isGroup);
  const mesh = shapeMeshes(visual)[0];
  assert.deepEqual([mesh.geometry.parameters.width, mesh.geometry.parameters.height, mesh.geometry.parameters.depth], [1, 1.8, 1]);
  assert.equal(mesh.material.color.getHex(), 0x50a0dc, "public color replaces identity-derived body coloring");
  assert.deepEqual(visual.localBounds.min.toArray(), [-0.5, -0.9, -0.5]);
  assert.deepEqual(visual.localBounds.max.toArray(), [0.5, 0.9, 0.5]);
  visual.mesh.position.set(3, 8.9, 4);
  visual.update(record(boxShape()), new THREE.Vector3(3, 8.9, 4));
  assert.deepEqual(visual.mesh.position.toArray(), [3, 8.9, 4]);
  assert.deepEqual(mesh.position.toArray(), [0, 0, 0], "rendering must not ground or add half-height again");
  const leakedBounds = visual.localBounds;
  leakedBounds.min.set(99, 99, 99);
  assert.deepEqual(visual.localBounds.min.toArray(), [-0.5, -0.9, -0.5]);
  visual.dispose();
});

test("equal-pose shape and cosmetic replacements release old parts while preserving overlays and root identity", () => {
  const visual = createResidentVisual(new THREE.Scene(), 3n, boxShape());
  const root = visual.mesh;
  root.position.set(6, 10, -2);
  visual.update(record(boxShape()), root.position.clone());
  const overlays = [visual.aimLine, visual.marker, visual.trailLine];
  const overlayResources = watchResources(overlays);
  const oldResources = watchResources(shapeMeshes(visual));
  const changed = boxShape({ color: { red: 200, green: 10, blue: 30, alpha: 0 }, primitive: { case: "panel", value: { widthMm: 2000n, heightMm: 3000n, thicknessMm: 25n } } });
  visual.update(record(changed), root.position.clone());
  assert.equal(visual.mesh, root);
  assert.deepEqual(root.position.toArray(), [6, 10, -2]);
  assert.equal(root.children.length, 1, "no old shape retained after successful swap");
  const replacement = shapeMeshes(visual)[0];
  assert.deepEqual([replacement.geometry.parameters.width, replacement.geometry.parameters.height, replacement.geometry.parameters.depth], [2, 3, 0.025]);
  assert.equal(replacement.material.opacity, 0);
  assert.equal(replacement.material.color.getHex(), 0xc80a1e);
  assert.deepEqual(visual.localBounds.min.toArray(), [-1, -1.5, -0.0125]);
  assertDisposed(oldResources, 1);
  assertDisposed(overlayResources, 0);
  assert.deepEqual([visual.aimLine, visual.marker, visual.trailLine], overlays);
  assert.equal(visual.trail.length, 1);
  assert.deepEqual(linePoints(visual.aimLine), [[6, 10, -2], [9, 10, -3]]);
  const cosmeticResources = watchResources(shapeMeshes(visual));
  const recolored = structuredClone(changed);
  recolored.nodes[0].color = { red: 20, green: 100, blue: 220, alpha: 128 };
  visual.update(record(recolored), root.position.clone());
  assertDisposed(cosmeticResources, 1);
  assert.equal(shapeMeshes(visual)[0].material.opacity, 128 / 255);
  assert.equal(visual.trail.length, 1);
  visual.dispose();
});

test("aim-only, position and canonical unchanged shape observations reuse surface resources", () => {
  const shape = boxShape({ materialTags: ["wood", "blue"] });
  const visual = createResidentVisual(new THREE.Scene(), 4n, shape);
  const surface = shapeMeshes(visual)[0];
  const resources = watchResources([surface]);
  const canonical = structuredClone(shape);
  canonical.nodes[0].materialTags.reverse();
  canonical.nodes[0].transform.rotation.w = -1;
  visual.update(record(canonical), new THREE.Vector3(1, 5, 1));
  visual.update(record(structuredClone(shape), { targetXMm: -2000n, targetZMm: 4000n, speedMmPerS: 900 }), new THREE.Vector3(2, 5, 1));
  visual.update(record(shape, undefined), new THREE.Vector3(2, 5, 1));
  assert.equal(shapeMeshes(visual)[0], surface);
  assertDisposed(resources, 0);
  assert.equal(visual.aimLine.visible, false);
  assert.equal(visual.marker.visible, false);
  assert.equal(visual.trail.length, 2);
  visual.dispose();
  assertDisposed(resources, 1);
});

test("malformed replacement leaves shape, bounds, aim and history untouched before any partial effect", () => {
  const scene = new THREE.Scene();
  const visual = createResidentVisual(scene, 5n, boxShape());
  visual.update(record(boxShape()), new THREE.Vector3(1, 8, 2));
  const beforeShape = visual.mesh.children[0];
  const resources = watchResources(shapeMeshes(visual));
  const beforeAim = linePoints(visual.aimLine);
  const beforeBounds = visual.localBounds;
  const broken = boxShape();
  broken.nodes[0].primitive.value.sizeYMm = 0n;
  assert.throws(() => visual.update(record(broken, undefined), new THREE.Vector3(99, 0, 99)), /sizeYMm/);
  assert.equal(visual.mesh.children[0], beforeShape);
  assert.deepEqual(visual.localBounds, beforeBounds);
  assert.deepEqual(linePoints(visual.aimLine), beforeAim);
  assert.equal(visual.aimLine.visible, true);
  assert.deepEqual(visual.trail.map(point => point.toArray()), [[1, 8, 2]]);
  assertDisposed(resources, 0);
  assert.equal(scene.children.length, 4);
  visual.dispose();
});

test("attachment failure releases staged replacement and retains installed resident state", () => {
  const visual = createResidentVisual(new THREE.Scene(), 6n, boxShape());
  visual.update(record(boxShape()), new THREE.Vector3(1, 8, 2));
  const before = visual.mesh.children[0];
  const beforeAim = linePoints(visual.aimLine);
  const oldResources = watchResources(shapeMeshes(visual));
  let stagedResources;
  const originalAdd = visual.mesh.add;
  visual.mesh.add = function (replacement) {
    stagedResources = watchResources(replacement.children);
    originalAdd.call(this, replacement);
    throw new Error("injected attachment failure");
  };
  const changed = boxShape({ color: { red: 30, green: 40, blue: 50, alpha: 255 } });
  assert.throws(() => visual.update(record(changed), new THREE.Vector3(10, 8, 2)), /attachment failure/);
  visual.mesh.add = originalAdd;
  assert.equal(visual.mesh.children.length, 1);
  assert.equal(visual.mesh.children[0], before);
  assertDisposed(stagedResources, 1);
  assertDisposed(oldResources, 0);
  assert.deepEqual(linePoints(visual.aimLine), beforeAim);
  assert.equal(visual.trail.length, 1);
  visual.update(record(changed), new THREE.Vector3(10, 8, 2));
  assertDisposed(oldResources, 1);
  visual.dispose();
});

test("trails stay bounded authoritative observations and aims retain observed-height projection across replacement", () => {
  const visual = createResidentVisual(new THREE.Scene(), 7n, boxShape());
  const currentShape = boxShape();
  for (let index = 0; index < 100; index++) visual.update(record(currentShape), new THREE.Vector3(index / 10, 8, -2));
  assert.equal(visual.trail.length, TRAIL_CAP);
  assert.equal(visual.trailLine.geometry.getAttribute("position").count, 64);
  assert.deepEqual(visual.trail[0].toArray(), [3.6, 8, -2]);
  assert.deepEqual(visual.trail.at(-1).toArray(), [9.9, 8, -2]);
  for (let index = 0; index < 10; index++) visual.mesh.position.lerp(new THREE.Vector3(20, 20, 20), 0.2);
  assert.equal(visual.trail.length, 64, "render smoothing must not be sampled");
  visual.update(record(boxShape({ color: undefined })), new THREE.Vector3(9.901, 8, -2));
  assert.deepEqual(visual.trail.at(-1).toArray(), [9.9, 8, -2], "sub-2mm observations do not evict history");
  assert.deepEqual(linePoints(visual.aimLine)[1], [9, 8, -3]);
  assert.equal(visual.marker.geometry.drawRange.count, 32);
  const markerPositions = visual.marker.geometry.getAttribute("position");
  for (let index = 0; index < 32; index++) assert.equal(markerPositions.getY(index), 8);
  visual.dispose();
});

test("same-object shape changes are detected and repeated disposal releases every owned resource once", () => {
  const scene = new THREE.Scene();
  const shape = boxShape();
  const visual = createResidentVisual(scene, 8n, shape);
  const originalSurface = shapeMeshes(visual)[0];
  const originalResources = watchResources([originalSurface]);
  shape.nodes[0].primitive.value.sizeXMm = 2000n;
  visual.update(record(shape), new THREE.Vector3(0, 7, 0));
  assert.notEqual(shapeMeshes(visual)[0], originalSurface);
  assertDisposed(originalResources, 1);
  const finalResources = watchResources([...shapeMeshes(visual), visual.aimLine, visual.marker, visual.trailLine]);
  visual.dispose();
  visual.dispose();
  assertDisposed(finalResources, 1);
  assertDisposed(originalResources, 1);
  assert.equal(scene.children.length, 0);
  assert.equal(visual.trail.length, 0);
  assert.equal(visual.mesh.children.length, 0);
  visual.update(record(shape), new THREE.Vector3(10, 7, 0));
  assert.equal(scene.children.length, 0);
  assert.equal(visual.trail.length, 0);
});

test("failed initial scene attachment removes partial residents and releases created graphics", () => {
  const scene = new THREE.Scene();
  const originalAdd = scene.add;
  const resources = [];
  let additions = 0;
  scene.add = function (graphic) {
    graphic.traverse(object => { if (object.geometry) resources.push(watchResources([object])); });
    originalAdd.call(this, graphic);
    if (++additions === 2) throw new Error("initial scene attachment failure");
  };
  assert.throws(() => createResidentVisual(scene, 9n, boxShape()), /initial scene attachment/);
  assert.equal(scene.children.length, 0);
  assert.equal(resources.length, 2, "surface and first overlay were actually staged");
  resources.forEach(counts => assertDisposed(counts, 1));
});
