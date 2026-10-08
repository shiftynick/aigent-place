import * as THREE from "three";
import { bodyColor } from "./camera.js";
import { prepareShapeTree, createShapeVisual } from "./shape-visuals.js";

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
export function createResidentVisual(scene, entityId, shape) {
  let plan = prepareShapeTree(shape);
  let shapeVisual = createShapeVisual(plan);
  const color = bodyColor(entityId);
  // A stable root keeps caller-controlled interpolation/follow position when
  // a complete shape is replaced. Public node colors belong to its children.
  const mesh = new THREE.Group();
  const graphics = [mesh];
  function makeLine(capacity, Constructor, opacity) {
    const geometry = lineGeometry(capacity);
    let material;
    try {
      material = new THREE.LineBasicMaterial({ color, transparent: true, opacity });
      const graphic = new Constructor(geometry, material);
      graphics.push(graphic);
      return graphic;
    } catch (error) {
      geometry.dispose();
      material?.dispose();
      throw error;
    }
  }
  let aimLine, marker, trailLine;
  try {
    mesh.add(shapeVisual.root);
    aimLine = makeLine(2, THREE.Line, 0.9);
    marker = makeLine(32, THREE.LineLoop, 0.95);
    trailLine = makeLine(TRAIL_CAP, THREE.Line, 0.5);
    for (const graphic of graphics) {
      graphic.frustumCulled = false;
      scene.add(graphic);
    }
  } catch (error) {
    shapeVisual.dispose();
    for (const graphic of graphics) {
      scene.remove(graphic);
      if (graphic !== mesh) {
        graphic.geometry.dispose();
        graphic.material.dispose();
      }
    }
    mesh.clear();
    throw error;
  }
  aimLine.visible = marker.visible = false;
  const trail = [];
  let disposed = false;

  function update(record, position) {
    if (disposed) return;
    const nextPlan = prepareShapeTree(record.shape);
    if (nextPlan.key !== plan.key) {
      const replacement = createShapeVisual(nextPlan);
      try {
        mesh.add(replacement.root);
      } catch (error) {
        mesh.remove(replacement.root);
        replacement.dispose();
        throw error;
      }
      mesh.remove(shapeVisual.root);
      shapeVisual.dispose();
      shapeVisual = replacement;
      plan = nextPlan;
    }
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
    shapeVisual.dispose();
    for (const graphic of graphics) {
      scene.remove(graphic);
      if (graphic !== mesh) {
        graphic.geometry.dispose();
        graphic.material.dispose();
      }
    }
    mesh.clear();
    trail.length = 0;
  }
  return { mesh, aimLine, marker, trailLine, trail, update, dispose, get localBounds() { return shapeVisual.localBounds.clone(); } };
}
