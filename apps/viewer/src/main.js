import * as THREE from "three";
import { create, toBinary } from "@bufbuild/protobuf";
import {
  ClientHelloSchema,
  ConnectionMode,
  ConnectionRole,
  EnvelopeSchema,
  HandshakeFrameSchema,
  SnapshotResyncRequestSchema,
} from "@aigent-place/protocol";
import {
  decodeSnapshotBinary,
  decodeWorldSnapshotBody,
  decodeWorldSnapshotDelta,
} from "./wire/real-snapshot.js";

const status = document.querySelector("#status");
const canvas = document.querySelector("#viewport");
const MAX_MESSAGE_IDS = 65_536;
const SERVER_BODIES = new Set([
  "commandResult", "protocolError", "percept", "fullSnapshot", "snapshotDelta",
  "snapshotResyncRequired", "orderedEvent", "eventResyncRequired", "eventStreamReset",
  "connectionDisplaced",
]);

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
  const { renderer, scene, camera, cube } = createSmokeScene(targetCanvas);
  scene.remove(cube);
  cube.geometry.dispose();
  cube.material.dispose();

  /** @type {Map<string, { mesh: THREE.Mesh, target: THREE.Vector3, record: import("@aigent-place/protocol").RealEntityRecord }>} */
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
  /** @type {Set<bigint>} */
  const seenMessageIds = new Set();

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

  function upsertBody(record) {
    const key = record.entityId.toString();
    seen.add(key);
    const { xMm, yMm, zMm } = record.positionMm;
    const target = new THREE.Vector3(mmToMeters(xMm), mmToMeters(yMm), mmToMeters(zMm));
    let entry = bodies.get(key);
    if (!entry) {
      const mesh = new THREE.Mesh(
        new THREE.BoxGeometry(1, 1, 1),
        new THREE.MeshStandardMaterial({ color: 0x4f8cff }),
      );
      mesh.position.copy(target);
      scene.add(mesh);
      entry = { mesh, target, record };
      bodies.set(key, entry);
    }
    entry.target.copy(target);
    entry.record = record;
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
    const envelope = decodeSnapshotBinary(EnvelopeSchema, bytes);
    if (envelope.protocolMajor !== 1) {
      requestResync(`invalid envelope: unsupported protocol major ${envelope.protocolMajor}`);
      return;
    }
    if (connectionId === null || envelope.connectionId.length === 0 ||
        envelope.connectionId.length !== connectionId.length ||
        !envelope.connectionId.every((value, index) => value === connectionId[index])) {
      requestResync("invalid envelope: connection identity mismatch");
      return;
    }
    if (envelope.messageId === 0n || seenMessageIds.has(envelope.messageId)) {
      requestResync("invalid envelope: zero or duplicate message ID");
      return;
    }
    if (!envelope.metadata || envelope.metadata.requiredFeatures.length !== 0) {
      // This viewer offers no optional features in ClientHello.
      requestResync("invalid envelope: missing metadata or unselected feature");
      return;
    }
    if (!SERVER_BODIES.has(envelope.body.case)) {
      requestResync("invalid envelope: missing or direction-forbidden body");
      return;
    }
    // Keep duplicate protection complete for this identity. A fresh session
    // resets the history without allowing old IDs on the same connection.
    if (seenMessageIds.size >= MAX_MESSAGE_IDS) {
      setStatus("viewer: message history limit reached — reconnecting");
      socket.close();
      return;
    }
    seenMessageIds.add(envelope.messageId);
    const body = envelope.body;
    if (body.case === "fullSnapshot") {
      const decoded = decodeWorldSnapshotBody(body.value.payload);
      if (!decoded) {
        // Unknown version or malformed payload: do not trust the
        // baseline_id and ask for a resync instead.
        requestResync("invalid full snapshot payload");
        return;
      }
      baselineId = body.value.baselineId;
      waitingForFull = false;
      lastTick = decoded.tick;
      seen.clear();
      for (const record of decoded.bodies) {
        upsertBody(record);
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
      if (!decoded) {
        // Unknown version or malformed payload: do not trust the
        // diff and ask for a resync, otherwise a missed transition
        // would silently keep the prior state.
        requestResync("invalid snapshot delta payload");
        return;
      }
      // Validate the complete transition before changing the visible scene.
      // The ordered socket stream cannot modify/leave an unknown body or
      // enter a body already present in the current baseline.
      if (decoded.entered.some(record => bodies.has(record.entityId.toString())) ||
          decoded.modified.some(record => !bodies.has(record.entityId.toString())) ||
          decoded.leftIds.some(id => !bodies.has(id.toString()))) {
        requestResync("delta entity mismatch");
        return;
      }
      for (const record of decoded.entered) {
        upsertBody(record);
      }
      for (const record of decoded.modified) {
        upsertBody(record);
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
    seenMessageIds.clear();
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
    const currentSocket = new WebSocket(wsUrl);
    socket = currentSocket;
    currentSocket.binaryType = "arraybuffer";
    currentSocket.addEventListener("open", () => {
      if (socket !== currentSocket) return;
      const hello = create(ClientHelloSchema, {
        role: ConnectionRole.VIEWER,
        offeredProtocolMajors: [1],
        offeredFeatures: [],
        aigentId: new Uint8Array(),
      });
      currentSocket.send(
        toBinary(
          HandshakeFrameSchema,
          create(HandshakeFrameSchema, {
            body: { case: "clientHello", value: hello },
          }),
        ),
      );
    });
    currentSocket.addEventListener("message", (event) => {
      if (socket !== currentSocket) return;
      const data = event.data;
      const bytes =
        data instanceof ArrayBuffer
          ? new Uint8Array(data)
          : new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
      if (!handshakeDone) {
        try {
          const frame = decodeSnapshotBinary(HandshakeFrameSchema, bytes);
          if (frame.body.case === "serverHello") {
            const hello = frame.body.value;
            if (hello.selectedProtocolMajor !== 1 || hello.connectionId.length === 0 ||
                hello.selectedFeatures.length !== 0 || hello.mode !== ConnectionMode.SPECTATE_ONLY ||
                hello.role !== ConnectionRole.VIEWER || hello.sessionEpoch.length !== 0) {
              setStatus("viewer: invalid ServerHello — reconnecting");
              currentSocket.close();
              return;
            }
            handshakeDone = true;
            connectionId = hello.connectionId;
            setStatus(
              `viewer: handshake ok major=${frame.body.value.selectedProtocolMajor} — waiting for snapshots`,
            );
            return;
          }
          if (frame.body.case === "handshakeReject") {
            setStatus(`viewer: handshake rejected: ${frame.body.value.message}`);
            closed = true;
            socket?.close();
            return;
          }
          setStatus("viewer: invalid handshake frame — reconnecting");
          currentSocket.close();
        } catch {
          setStatus("viewer: malformed handshake frame");
          currentSocket.close();
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
    currentSocket.addEventListener("close", () => {
      if (socket !== currentSocket) return;
      if (closed) return;
      setStatus("viewer: socket closed — reconnecting");
      setTimeout(connect, 1000);
    });
    currentSocket.addEventListener("error", () => {
      if (socket !== currentSocket) return;
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
