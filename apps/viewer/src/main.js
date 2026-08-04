import * as THREE from "three";

const status = document.querySelector("#status");
const canvas = document.querySelector("#viewport");

export function createSmokeScene(targetCanvas) {
  const renderer = new THREE.WebGLRenderer({
    canvas: targetCanvas,
    antialias: true,
  });
  renderer.setPixelRatio(window.devicePixelRatio || 1);
  renderer.setSize(targetCanvas.clientWidth, targetCanvas.clientHeight, false);

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x0b1220);

  const camera = new THREE.PerspectiveCamera(
    60,
    targetCanvas.clientWidth / Math.max(targetCanvas.clientHeight, 1),
    0.1,
    100,
  );
  camera.position.set(2.5, 2, 3);
  camera.lookAt(0, 0.5, 0);

  const light = new THREE.DirectionalLight(0xffffff, 1.1);
  light.position.set(3, 5, 2);
  scene.add(light);
  scene.add(new THREE.AmbientLight(0x6688aa, 0.35));

  const mesh = new THREE.Mesh(
    new THREE.BoxGeometry(1, 1, 1),
    new THREE.MeshStandardMaterial({ color: 0x4f8cff }),
  );
  mesh.position.y = 0.5;
  scene.add(mesh);

  renderer.render(scene, camera);
  return { renderer, scene, camera, mesh };
}

if (canvas instanceof HTMLCanvasElement) {
  createSmokeScene(canvas);
  if (status) {
    status.textContent = "viewer: smoke ok";
  }
}
