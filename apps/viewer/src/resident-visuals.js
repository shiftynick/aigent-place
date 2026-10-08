import * as THREE from "three";
import { bodyColor } from "./camera.js";

export const TRAIL_CAP = 64;
const TRAIL_STEP_METRES = 0.002;

// Only accepted authoritative observations enter history. Render-frame
// interpolation and unchanged/aim-only records must never manufacture a trail.
export function sampleAuthoritativePosition(trail, position) {
  if (trail.length && trail.at(-1).distanceTo(position) < TRAIL_STEP_METRES) return false;
  trail.push(position.clone());
  if (trail.length > TRAIL_CAP) trail.shift();
  return true;
}

function lineGeometry(capacity) {
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.BufferAttribute(new Float32Array(capacity * 3), 3));
  geometry.setDrawRange(0, 0);
  return geometry;
}

function writePoints(geometry, points) {
  const attribute = geometry.getAttribute("position");
  points.forEach((point, index) => attribute.setXYZ(index, point.x, point.y, point.z));
  attribute.needsUpdate = true;
  geometry.setDrawRange(0, points.length);
}

/** One body's reusable graphics, owned and disposed by its observation entry. */
export function createResidentVisual(scene, entityId) {
  const color = bodyColor(entityId);
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshStandardMaterial({ color }));
  const aimLine = new THREE.Line(lineGeometry(2), new THREE.LineBasicMaterial({ color, transparent: true, opacity: 0.9 }));
  const marker = new THREE.LineLoop(lineGeometry(32), new THREE.LineBasicMaterial({ color, transparent: true, opacity: 0.95 }));
  const trailLine = new THREE.Line(lineGeometry(TRAIL_CAP), new THREE.LineBasicMaterial({ color, transparent: true, opacity: 0.5 }));
  const graphics = [mesh, aimLine, marker, trailLine];
  for (const graphic of graphics) {
    graphic.frustumCulled = false;
    scene.add(graphic);
  }
  aimLine.visible = marker.visible = false;
  const trail = [];
  let disposed = false;

  function update(record, position) {
    if (sampleAuthoritativePosition(trail, position)) writePoints(trailLine.geometry, trail);
    const aim = record.aim;
    aimLine.visible = marker.visible = aim !== undefined;
    if (!aim) return;
    // The wire specifies a horizontal goal, not terrain height. The marker
    // uses this body's observed height; the legend names this projection.
    const goal = new THREE.Vector3(Number(aim.targetXMm) / 1000, position.y, Number(aim.targetZMm) / 1000);
    writePoints(aimLine.geometry, [position, goal]);
    const ring = Array.from({ length: 32 }, (_, index) => {
      const angle = index * Math.PI * 2 / 32;
      return new THREE.Vector3(goal.x + Math.cos(angle) * 0.28, goal.y, goal.z + Math.sin(angle) * 0.28);
    });
    writePoints(marker.geometry, ring);
  }

  function dispose() {
    if (disposed) return;
    disposed = true;
    for (const graphic of graphics) {
      scene.remove(graphic);
      graphic.geometry.dispose();
      graphic.material.dispose();
    }
    trail.length = 0;
  }
  return { mesh, aimLine, marker, trailLine, trail, update, dispose };
}
