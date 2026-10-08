// Graphics and input boundaries. The viewer uses real Three camera/vector math;
// real Chromium supplies separate proof of rendering and camera interaction.
export const scenes = [];
import { Vector3, PerspectiveCamera as RealCamera, BufferGeometry as RealGeometry } from "three";
export { Vector3, Color, BufferAttribute } from "three";
export const cameras = [];
export const controls = [];
export const renderers = [];
export class Scene {
  constructor() { this.children = []; this.peakMeshes = 0; scenes.push(this); }
  add(child) { this.children.push(child); this.peakMeshes = Math.max(this.peakMeshes, this.children.filter(value => value.isMesh).length); }
  remove(child) { this.children = this.children.filter(value => value !== child); }
}
export class BoxGeometry {
  constructor() { this.disposals = 0; }
  dispose() { this.disposals += 1; }
}
export class MeshStandardMaterial extends BoxGeometry {
  constructor(options) { super(); Object.assign(this, options); }
}
export class LineBasicMaterial extends MeshStandardMaterial {}
export class BufferGeometry extends RealGeometry {
  constructor() { super(); this.disposals = 0; }
  dispose() { this.disposals += 1; }
}
export class Mesh {
  constructor(geometry, material) {
    Object.assign(this, { geometry, material, isMesh: true, position: new Vector3() });
  }
}
export class Line extends Mesh {
  constructor(...args) { super(...args); this.isMesh = false; this.isLine = true; }
}
export class LineLoop extends Line {}
export class PerspectiveCamera extends RealCamera {
  constructor(...args) { super(...args); cameras.push(this); }
}
export class DirectionalLight { constructor() { this.position = new Vector3(); } }
export class AmbientLight {}
export class GridHelper {
  constructor() {
    this.position = new Vector3();
    this.geometry = new BoxGeometry();
    this.material = new MeshStandardMaterial();
  }
}
export class WebGLRenderer {
  constructor() { this.disposals = 0; this.sizes = []; renderers.push(this); }
  setPixelRatio() {}
  setSize(width, height) { this.sizes.push([width, height]); }
  render() {}
  dispose() { this.disposals += 1; }
}
export class OrbitControls {
  constructor(camera) { this.object = camera; this.target = new Vector3(); this.listeners = {}; this.disposals = 0; controls.push(this); }
  addEventListener(name, callback) { this.listeners[name] = callback; }
  removeEventListener(name) { delete this.listeners[name]; }
  emit(name) { this.listeners[name]?.(); }
  update() { this.object.lookAt(this.target); }
  dispose() { this.disposals += 1; }
}
