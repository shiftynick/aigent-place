import assert from "node:assert/strict";
import test from "node:test";
import * as THREE from "three";
import { observedBounds, fitObservedBounds, bodyColor } from "../src/camera.js";

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

test("real Three camera fits elevated and separated one-metre placeholder bounds across aspects", () => {
  const positions = [new THREE.Vector3(-25, 8.905, -5), new THREE.Vector3(30, 17, 20)];
  const bounds = observedBounds(positions);
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
  const bounds = observedBounds([new THREE.Vector3(4, 8.905, 1)]);
  const camera = new THREE.PerspectiveCamera(60, 4 / 3, 0.1, 1000);
  const controls = { target: new THREE.Vector3(), update() {} };
  fitObservedBounds(camera, controls, bounds);
  assert.ok(camera.position.distanceTo(controls.target) >= 6, "bounded movement retains room around one body");
  assert.equal(controls.target.y, 8.905);
  assertBoundsVisible(camera, observedBounds([new THREE.Vector3(6, 8.905, 1)]));
});

test("body color stays tied to stable entity ID and differentiates the fixture bodies", () => {
  assert.equal(bodyColor(1n).getHex(), bodyColor("1").getHex());
  assert.notEqual(bodyColor(1n).getHex(), bodyColor(2n).getHex());
});
