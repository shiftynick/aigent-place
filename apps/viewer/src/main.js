import * as THREE from "three";
import { create, fromBinary, toBinary } from "@bufbuild/protobuf";
import {
  ClientHelloSchema,
  ConnectionRole,
  EnvelopeSchema,
  HandshakeFrameSchema,
  SnapshotResyncRequestSchema,
} from "@aigent-place/protocol";

const status = document.querySelector("#status");
const canvas = document.querySelector("#viewport");

const PLACEHOLDER_MAGIC = "AIGB";

/**
 * @param {Uint8Array} bytes
 * @returns {{ tick: bigint, bodies: Array<{ bodyId: bigint, sequence: bigint, xMm: bigint, yMm: bigint, zMm: bigint }> } | null}
 */
export function decodePlaceholderPayload(bytes) {
  if (bytes.length < 4 + 1 + 8 + 32 + 4) {
    return null;
  }
  const magic = String.fromCharCode(...bytes.subarray(0, 4));
  if (magic !== PLACEHOLDER_MAGIC || bytes[4] !== 1) {
    return null;
  }
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const tick = view.getBigUint64(5, false);
  const count = view.getUint32(45, false);
  let cursor = 49;
  const bodies = [];
  for (let i = 0; i < count; i += 1) {
    if (bytes.length < cursor + 40) {
      return null;
    }
    bodies.push({
      bodyId: view.getBigUint64(cursor, false),
      sequence: view.getBigUint64(cursor + 8, false),
      xMm: view.getBigInt64(cursor + 16, false),
      yMm: view.getBigInt64(cursor + 24, false),
      zMm: view.getBigInt64(cursor + 32, false),
    });
    cursor += 40;
  }
  return { tick, bodies };
}

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
    200,
  );
  camera.position.set(8, 6, 10);
  camera.lookAt(0, 0.5, 0);

  const light = new THREE.DirectionalLight(0xffffff, 1.1);
  light.position.set(3, 5, 2);
  scene.add(light);
  scene.add(new THREE.AmbientLight(0x6688aa, 0.35));
  scene.add(new THREE.GridHelper(40, 40, 0x1f2a44, 0x152033));

  const mesh = new THREE.Mesh(
    new THREE.BoxGeometry(1, 1, 1),
    new THREE.MeshStandardMaterial({ color: 0x4f8cff }),
  );
  mesh.position.y = 0.5;
  scene.add(mesh);

  renderer.render(scene, camera);
  return { renderer, scene, camera, mesh };
}

function mmToMeters(mm) {
  return Number(mm) / 1000;
}

function setStatus(text) {
  if (status) {
    status.textContent = text;
  }
}

/**
 * Live spectator that renders placeholder bodies from stub snapshot payloads.
 */
export function startLiveViewer(targetCanvas, wsUrl) {
  const { renderer, scene, camera } = createSmokeScene(targetCanvas);
  // Remove the static smoke cube; live bodies replace it.
  const smoke = scene.children.find((child) => child.isMesh);
  if (smoke) {
    scene.remove(smoke);
  }

  /** @type {Map<string, { mesh: THREE.Mesh, target: THREE.Vector3 }>} */
  const bodies = new Map();
  let baselineId = null;
  let waitingForFull = true;
  let handshakeDone = false;
  let lastTick = 0n;
  let socket = null;
  let closed = false;
  /** @type {Uint8Array | null} */
  let connectionId = null;
  let nextMessageId = 1n;

  function upsertBodies(list) {
    const seen = new Set();
    for (const body of list) {
      const key = body.bodyId.toString();
      seen.add(key);
      const target = new THREE.Vector3(
        mmToMeters(body.xMm),
        mmToMeters(body.yMm),
        mmToMeters(body.zMm),
      );
      let entry = bodies.get(key);
      if (!entry) {
        const mesh = new THREE.Mesh(
          new THREE.BoxGeometry(1, 1, 1),
          new THREE.MeshStandardMaterial({ color: 0x4f8cff }),
        );
        mesh.position.copy(target);
        scene.add(mesh);
        entry = { mesh, target };
        bodies.set(key, entry);
      }
      entry.target.copy(target);
    }
    for (const [key, entry] of bodies) {
      if (!seen.has(key)) {
        scene.remove(entry.mesh);
        entry.mesh.geometry.dispose();
        entry.mesh.material.dispose();
        bodies.delete(key);
      }
    }
  }

  function requestResync(reason) {
    waitingForFull = true;
    baselineId = null;
    if (!socket || socket.readyState !== WebSocket.OPEN || !connectionId) {
      setStatus(`viewer: ${reason} — reconnecting for full snapshot`);
      socket?.close();
      return;
    }
    setStatus(`viewer: ${reason} — requesting full snapshot`);
    const messageId = nextMessageId;
    nextMessageId += 1n;
    socket.send(
      toBinary(
        EnvelopeSchema,
        create(EnvelopeSchema, {
          protocolMajor: 1,
          connectionId,
          messageId,
          metadata: {},
          body: {
            case: "snapshotResyncRequest",
            value: create(SnapshotResyncRequestSchema, {}),
          },
        }),
      ),
    );
  }

  function handleEnvelope(bytes) {
    const envelope = fromBinary(EnvelopeSchema, bytes);
    if (envelope.protocolMajor !== 1) {
      setStatus(`viewer: unsupported protocol major ${envelope.protocolMajor}`);
      return;
    }
    const body = envelope.body;
    if (body.case === "fullSnapshot") {
      baselineId = body.value.baselineId;
      waitingForFull = false;
      const decoded = decodePlaceholderPayload(body.value.payload);
      if (decoded) {
        lastTick = decoded.tick;
        upsertBodies(decoded.bodies);
        setStatus(`viewer: live tick=${decoded.tick} bodies=${decoded.bodies.length}`);
      }
      return;
    }
    if (body.case === "snapshotDelta") {
      if (waitingForFull || baselineId === null) {
        return;
      }
      if (body.value.baselineId !== baselineId) {
        requestResync("baseline mismatch");
        return;
      }
      const decoded = decodePlaceholderPayload(body.value.payload);
      if (decoded) {
        lastTick = decoded.tick;
        upsertBodies(decoded.bodies);
        setStatus(`viewer: delta tick=${decoded.tick} bodies=${decoded.bodies.length}`);
      }
      return;
    }
    if (body.case === "snapshotResyncRequired") {
      requestResync("server resync required");
    }
  }

  function connect() {
    if (closed) {
      return;
    }
    handshakeDone = false;
    waitingForFull = true;
    baselineId = null;
    connectionId = null;
    setStatus(`viewer: connecting ${wsUrl}`);
    socket = new WebSocket(wsUrl);
    socket.binaryType = "arraybuffer";
    socket.addEventListener("open", () => {
      const hello = create(ClientHelloSchema, {
        role: ConnectionRole.VIEWER,
        offeredProtocolMajors: [1],
        offeredFeatures: [],
        aigentId: new Uint8Array(),
      });
      socket.send(
        toBinary(
          HandshakeFrameSchema,
          create(HandshakeFrameSchema, {
            body: { case: "clientHello", value: hello },
          }),
        ),
      );
    });
    socket.addEventListener("message", (event) => {
      const data = event.data;
      const bytes =
        data instanceof ArrayBuffer
          ? new Uint8Array(data)
          : new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
      if (!handshakeDone) {
        try {
          const frame = fromBinary(HandshakeFrameSchema, bytes);
          if (frame.body.case === "serverHello") {
            handshakeDone = true;
            connectionId = frame.body.value.connectionId;
            setStatus(
              `viewer: handshake ok major=${frame.body.value.selectedProtocolMajor} — waiting for snapshots`,
            );
            return;
          }
          if (frame.body.case === "handshakeReject") {
            setStatus(`viewer: handshake rejected code=${frame.body.value.code}`);
            return;
          }
        } catch {
          // Fall through to envelope decode only after handshake.
        }
        return;
      }
      try {
        handleEnvelope(bytes);
      } catch (error) {
        setStatus(`viewer: envelope error ${error.message ?? error}`);
      }
    });
    socket.addEventListener("close", () => {
      setStatus("viewer: disconnected — retrying");
      baselineId = null;
      waitingForFull = true;
      handshakeDone = false;
      if (!closed) {
        setTimeout(connect, 1000);
      }
    });
    socket.addEventListener("error", () => {
      setStatus("viewer: socket error");
    });
  }

  function animate() {
    if (closed) {
      return;
    }
    requestAnimationFrame(animate);
    for (const entry of bodies.values()) {
      entry.mesh.position.lerp(entry.target, 0.2);
    }
    renderer.render(scene, camera);
  }

  connect();
  animate();

  return {
    stop() {
      closed = true;
      socket?.close();
    },
    getLastTick: () => lastTick,
    getBodyCount: () => bodies.size,
  };
}

if (canvas instanceof HTMLCanvasElement) {
  const params = new URLSearchParams(window.location.search);
  const wsUrl = params.get("ws");
  if (wsUrl) {
    startLiveViewer(canvas, wsUrl);
  } else {
    createSmokeScene(canvas);
    setStatus("viewer: smoke ok (add ?ws=ws://127.0.0.1:7600/ws for live)");
  }
}
