import * as THREE from "three";
import { create, fromBinary, toBinary } from "@bufbuild/protobuf";
import {
  ClientHelloSchema,
  ConnectionRole,
  EnvelopeSchema,
  HandshakeFrameSchema,
  SnapshotResyncRequestSchema,
} from "@aigent-place/protocol";
import {
  decodeWorldSnapshotBody,
  decodeWorldSnapshotDelta,
} from "./wire/real-snapshot.js";

const status = document.querySelector("#status");
const canvas = document.querySelector("#viewport");

function mmToMeters(mm) {
  return Number(mm) / 1000;
}

function setStatus(text) {
  if (status) {
    status.textContent = text;
  }
}

function createSmokeScene(targetCanvas) {
  const renderer = new THREE.WebGLRenderer({ canvas: targetCanvas, antialias: true });
  renderer.setPixelRatio(window.devicePixelRatio);
  renderer.setSize(targetCanvas.clientWidth, targetCanvas.clientHeight, false);
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x0b0d12);
  const camera = new THREE.PerspectiveCamera(
    60,
    targetCanvas.clientWidth / Math.max(1, targetCanvas.clientHeight),
    0.1,
    1000,
  );
  camera.position.set(8, 6, 10);
  camera.lookAt(0, 0, 0);
  const ambient = new THREE.AmbientLight(0xffffff, 0.6);
  scene.add(ambient);
  const directional = new THREE.DirectionalLight(0xffffff, 0.4);
  directional.position.set(5, 10, 7);
  scene.add(directional);
  const cube = new THREE.Mesh(
    new THREE.BoxGeometry(1, 1, 1),
    new THREE.MeshStandardMaterial({ color: 0x4f8cff }),
  );
  scene.add(cube);
  return { renderer, scene, camera, cube };
}

/**
 * Live spectator that decodes `WorldSnapshotBodyProto` /
 * `WorldSnapshotDeltaProto` from the server and renders one Three.js
 * mesh per entity. Actual visual mesh selection from the shape tree
 * is task-055; this card wires the decoder in lockstep with the
 * server encoder.
 */
export function startLiveViewer(targetCanvas, wsUrl) {
  const { renderer, scene, camera } = createSmokeScene(targetCanvas);
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
  /** @type {Set<string>} */
  const seen = new Set();

  function removeMissing() {
    for (const [key, entry] of bodies) {
      if (!seen.has(key)) {
        scene.remove(entry.mesh);
        entry.mesh.geometry.dispose();
        entry.mesh.material.dispose();
        bodies.delete(key);
      }
    }
  }

  function upsertBody(entityId, xMm, yMm, zMm) {
    const key = entityId.toString();
    seen.add(key);
    const target = new THREE.Vector3(mmToMeters(xMm), mmToMeters(yMm), mmToMeters(zMm));
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

  function applyBody(record) {
    upsertBody(
      record.entityId,
      record.positionMm.x,
      record.positionMm.y,
      record.positionMm.z,
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
      const decoded = decodeWorldSnapshotBody(body.value.payload);
      if (!decoded) {
        // Unknown version or malformed payload: do not trust the
        // baseline_id and ask for a resync instead.
        setStatus("viewer: full snapshot version unknown or payload malformed — requesting resync");
        requestResync("snapshot version unknown");
        return;
      }
      lastTick = decoded.tick;
      seen.clear();
      for (const record of decoded.bodies) {
        applyBody(record);
      }
      removeMissing();
      setStatus(
        `viewer: live tick=${decoded.tick} bodies=${decoded.bodies.length} (real bodies)`,
      );
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
      const decoded = decodeWorldSnapshotDelta(body.value.payload);
      if (decoded) {
        for (const record of decoded.entered) {
          applyBody(record);
        }
        for (const record of decoded.modified) {
          applyBody(record);
        }
        for (const leftId of decoded.leftIds) {
          const key = leftId.toString();
          if (bodies.has(key)) {
            const entry = bodies.get(key);
            scene.remove(entry.mesh);
            entry.mesh.geometry.dispose();
            entry.mesh.material.dispose();
            bodies.delete(key);
          }
        }
        setStatus(
          `viewer: delta tick=${lastTick} bodies=${bodies.size} (real bodies, +${decoded.entered.length}/~${decoded.modified.length}/-${decoded.leftIds.length})`,
        );
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
    // Drop any bodies carried over from a prior connection: a new
    // connection_id is a new session, the prior bodies are no longer
    // authoritative.
    for (const entry of bodies.values()) {
      scene.remove(entry.mesh);
      entry.mesh.geometry.dispose();
      entry.mesh.material.dispose();
    }
    bodies.clear();
    seen.clear();
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
            setStatus(`viewer: handshake rejected: ${frame.body.value.reason}`);
            closed = true;
            socket?.close();
            return;
          }
        } catch {
          setStatus("viewer: malformed handshake frame");
          return;
        }
        return;
      }
      try {
        handleEnvelope(bytes);
      } catch (error) {
        setStatus(`viewer: envelope decode error: ${error?.message ?? error}`);
        // A malformed frame breaks the live delta chain. Treat it the
        // same as an unknown version: ask the server for a fresh full
        // snapshot.
        requestResync("malformed frame");
      }
    });
    socket.addEventListener("close", () => {
      if (closed) return;
      setStatus("viewer: socket closed — reconnecting");
      setTimeout(connect, 1000);
    });
    socket.addEventListener("error", () => {
      setStatus("viewer: socket error");
    });
  }

  connect();

  function tick() {
    for (const entry of bodies.values()) {
      entry.mesh.position.lerp(entry.target, 0.2);
    }
    renderer.render(scene, camera);
    requestAnimationFrame(tick);
  }
  requestAnimationFrame(tick);
}

if (canvas instanceof HTMLCanvasElement) {
  const params = new URLSearchParams(location.search);
  const ws = params.get("ws") ?? "ws://127.0.0.1:7600/ws";
  startLiveViewer(canvas, ws);
}
