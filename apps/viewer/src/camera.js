import * as THREE from "three";

// Bounds describe the current one-metre placeholders, not decoded shape trees.
export function observedBounds(positions) {
  const bounds = new THREE.Box3();
  const halfCube = new THREE.Vector3(0.5, 0.5, 0.5);
  for (const position of positions) {
    bounds.expandByPoint(new THREE.Vector3().copy(position).sub(halfCube));
    bounds.expandByPoint(new THREE.Vector3().copy(position).add(halfCube));
  }
  return bounds.isEmpty() ? null : bounds;
}

export function fitObservedBounds(camera, controls, bounds) {
  const center = bounds.getCenter(new THREE.Vector3());
  // Leave room for the bounded movement demo around a single body.
  const radius = Math.max(3, bounds.getBoundingSphere(new THREE.Sphere()).radius);
  const verticalHalf = THREE.MathUtils.degToRad(camera.fov / 2);
  const horizontalHalf = Math.atan(Math.tan(verticalHalf) * camera.aspect);
  const distance = 1.15 * radius / Math.sin(Math.min(verticalHalf, horizontalHalf));
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

export function bodyColor(entityId) {
  // Hash the stable ID, independent of arrival order and session reconnection.
  let hash = 2166136261;
  for (const digit of entityId.toString()) hash = Math.imul(hash ^ digit.charCodeAt(0), 16777619);
  return new THREE.Color().setHSL(((hash >>> 0) % 12) / 12, 0.65, 0.62);
}
