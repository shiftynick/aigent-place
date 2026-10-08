// Renderer boundary only. Tests load the real main.js state/socket handlers.
export const scenes = [];
export class Vector3 {
  constructor(x = 0, y = 0, z = 0) { this.set(x, y, z); }
  set(x, y, z) { Object.assign(this, { x, y, z }); return this; }
  copy(value) { return this.set(value.x, value.y, value.z); }
  lerp(value, amount) {
    this.x += (value.x - this.x) * amount;
    this.y += (value.y - this.y) * amount;
    this.z += (value.z - this.z) * amount;
    return this;
  }
}
export class Scene {
  constructor() { this.children = []; scenes.push(this); }
  add(child) { this.children.push(child); }
  remove(child) { this.children = this.children.filter(value => value !== child); }
}
export class BoxGeometry {
  constructor() { this.disposals = 0; }
  dispose() { this.disposals += 1; }
}
export class MeshStandardMaterial extends BoxGeometry {}
export class Mesh {
  constructor(geometry, material) {
    Object.assign(this, { geometry, material, isMesh: true, position: new Vector3() });
  }
}
export class PerspectiveCamera {
  constructor() { this.position = new Vector3(); }
  lookAt() {}
}
export class DirectionalLight extends PerspectiveCamera {}
export class AmbientLight {}
export class Color {}
export class WebGLRenderer {
  setPixelRatio() {}
  setSize() {}
  render() {}
}
