import * as THREE from "three";
import "./style.css";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { admitObservedBounds, planObservedFit, stepAutomaticFit, observedBounds, bodyColor } from "./camera.js";
import { createResidentVisual } from "./resident-visuals.js";
import { prepareShapeTree } from "./shape-visuals.js";
import { activityPresentation, createActivityCueTracker } from "./activity-presentation.js";
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
const sceneState = document.querySelector("#scene-state");
const resetButton = document.querySelector("#reset-view");
const followButton = document.querySelector("#follow-body");
const residentList = document.querySelector("#resident-list");
const bodyLabels = document.querySelector("#body-labels");
const selectedTitle = document.querySelector("#selected-title");
const selectedAim = document.querySelector("#selected-aim");
const selectedPosition = document.querySelector("#selected-position");
const observationStatus = document.querySelector("#observation-status");
const residentCount = document.querySelector("#resident-count");
const activityStrip = document.querySelector("#activity-strip");
const activityPhase = document.querySelector("#activity-phase");
const activityCount = document.querySelector("#activity-count");
const activityStatus = document.querySelector("#activity-status");
const activityGoal = document.querySelector("#activity-goal");
const activityRules = document.querySelector("#activity-rules");
const activityDwell = document.querySelector("#activity-dwell");
const activityParticipants = document.querySelector("#activity-participants");
const activityHistory = document.querySelector("#activity-history");
const activityGap = document.querySelector("#activity-gap");
const activityCue = document.querySelector("#activity-cue");
const MAX_MESSAGE_IDS = 65_536;
const FRAMING_TUNING = Object.freeze({
  paddingMetres: 1, minimumGrowthMetres: 0.25,
  timeConstantSeconds: 0.25, maxStepSeconds: 0.1,
  margin: 0.95, minDistance: 0.5, nearMinimum: 0.01, depthFloor: 0.02,
});
const AUTOMATIC_DIRECTION = new THREE.Vector3(1, Math.sqrt(6), 1).normalize();
const EMPTY_SCENE_MESSAGE = "Connected. No bodies in the current observation. Start the scripted aigent or plaza demo to see movement.";
const SHAPELESS_SCENE_MESSAGE = "Connected. The observed bodies have no shapes to frame. Select a body to inspect its position.";
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

function setSceneState(text) {
  if (sceneState) {
    sceneState.textContent = text;
    sceneState.hidden = text.length === 0;
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
 * shape tree per entity (ADR-0012). Terrain and far-world rebasing remain
 * separate work. The returned handle resets local framing or releases
 * the socket, camera controls, render loop and graphics resources.
 */
export function startLiveViewer(targetCanvas, wsUrl) {
  const { renderer, scene, camera, cube } = createSmokeScene(targetCanvas);
  scene.remove(cube);
  cube.geometry.dispose();
  cube.material.dispose();
  const controls = new OrbitControls(camera, targetCanvas);
  controls.minDistance = 0.5;
  const grid = new THREE.GridHelper(20, 20, 0x7c8da8, 0x35445b);
  grid.visible = false;
  scene.add(grid);

  // Entries own their graphics and DOM; records/targets are authoritative,
  // while mesh positions are display interpolation only.
  const bodies = new Map();
  const activityCueTracker = createActivityCueTracker();
  let demoActivity;
  let activityFeedback = { cue: null, historyGap: null };
  let selectedId = null;
  let following = false;
  let observationFresh = false;
  let baselineId = null;
  let waitingForFull = true;
  let handshakeDone = false;
  let lastTick = 0n;
  let socket = null;
  let closed = false;
  let disposed = false;
  let initialFitPending = true;
  let automaticView = true;
  let historyBounds = null;
  let envelopeBounds = null;
  let fitGoal = null;
  let fitState = null;
  let pendingSnap = false;
  let automaticFrameTime = null;
  let framingFailure = null;
  let reconnectTimer = null;
  let animationFrame = null;
  let shapeRecoveryAttempts = 0;
  /** @type {Uint8Array | null} */
  let connectionId = null;
  let nextMessageId = 1n;
  /** @type {Set<string>} */
  const seen = new Set();
  /** @type {Set<bigint>} */
  const seenMessageIds = new Set();

  function shapeCenter(entry) {
    return entry.visual.localBounds.getCenter(new THREE.Vector3()).add(entry.mesh.position);
  }

  function currentShapeBounds() {
    return observedBounds(Array.from(bodies.values())
      .filter(entry => entry.record.shape !== undefined)
      .map(entry => entry.visual.localBounds.clone().translate(entry.target)));
  }

  function displayedShapeBoxes() {
    // A replacement shape can temporarily extend beyond the world bound at
    // its interpolated root. Only applied authoritative bounds are world-capped.
    return Array.from(bodies.values())
      .filter(entry => entry.record.shape !== undefined)
      .map(entry => entry.visual.localBounds.clone().translate(entry.mesh.position));
  }

  function projection() {
    return { fovDeg: camera.fov, aspect: camera.aspect };
  }

  function reportFramingFailure(error) {
    if (!(error instanceof RangeError)) throw error;
    framingFailure = `Automatic framing unavailable: ${error.message}`;
    automaticFrameTime = null;
    setStatus(`viewer: ${framingFailure}`);
    setSceneState(`${framingFailure}. The camera retains its last finite pose.`);
  }

  function setObservationStatus(message) {
    setStatus(framingFailure ? `${message} · ${framingFailure}` : message);
  }

  function admitShapes(bounds, reset = false) {
    try {
      const next = admitObservedBounds(reset ? null : historyBounds,
        reset ? null : envelopeBounds, bounds, FRAMING_TUNING);
      const goal = next.envelope && (reset || next.admitted)
        ? planObservedFit(projection(), next.envelope) : (reset ? null : fitGoal);
      // Both pure computations must succeed before any admission is committed.
      historyBounds = next.history;
      envelopeBounds = next.envelope;
      fitGoal = goal;
      return true;
    } catch (error) {
      reportFramingFailure(error);
      return false;
    }
  }

  function placeGrid(bounds) {
    const center = bounds.getCenter(new THREE.Vector3());
    grid.position.set(center.x, bounds.min.y - 0.05, center.z);
    grid.visible = true;
  }

  // Validate a complete transition before baseline changes, departures or
  // allocations. A bounded retry can recover a damaged frame; a permanently
  // unsupported shape must not generate an endless full/resync exchange.
  function canRenderRecords(records) {
    try {
      for (const record of records) {
        const plan = prepareShapeTree(record.shape);
        const position = record.positionMm;
        const bounds = plan.localBounds.clone().translate(new THREE.Vector3(
          mmToMeters(position.xMm), mmToMeters(position.yMm), mmToMeters(position.zMm),
        ));
        if ([...bounds.min.toArray(), ...bounds.max.toArray()].some(value => Math.abs(value) > 100_000)) {
          throw new Error("composed shape is outside the world bound");
        }
      }
      return true;
    } catch (error) {
      shapeRecoveryAttempts += 1;
      if (shapeRecoveryAttempts === 1) {
        requestResync(`shape presentation unavailable: ${error.message}`);
      } else {
        markObservation(false, "Shape presentation unavailable · last observation");
        setStatus(`viewer: shape presentation unavailable: ${error.message}`);
        setSceneState("This observation contains a shape the viewer cannot render. Visible bodies are the last observation. Reload to retry.");
        closed = true;
        socket?.close();
      }
      return false;
    }
  }

  function refreshInspector() {
    const entry = bodies.get(selectedId);
    if (selectedTitle) selectedTitle.textContent = entry ? `Body ${selectedId}` : "Choose a body";
    if (selectedPosition) selectedPosition.textContent = entry
      ? `Observed position: x ${entry.target.x.toFixed(2)} m · z ${entry.target.z.toFixed(2)} m` : "Select a body to inspect its movement.";
    if (selectedAim) {
      const aim = entry?.record.aim;
      if (aim) {
        const x = mmToMeters(aim.targetXMm), z = mmToMeters(aim.targetZMm);
        const distance = Math.hypot(x - entry.target.x, z - entry.target.z);
        selectedAim.textContent = `${observationFresh ? "Current" : "Last observed"} movement target: x ${x.toFixed(2)} m · z ${z.toFixed(2)} m · ${distance.toFixed(2)} m away · ${aim.speedMmPerS / 1000} m/s`;
        const nearby = [...bodies].filter(([id]) => id !== selectedId)
          .map(([id, other]) => ({ id, distance: Math.hypot(x - other.target.x, z - other.target.z) }))
          .filter(other => other.distance <= 1.5)
          .sort((a, b) => a.distance - b.distance || (BigInt(a.id) < BigInt(b.id) ? -1 : 1))[0];
        if (nearby) selectedAim.textContent += ` · Target ${nearby.distance.toFixed(2)} m horizontally from Body ${nearby.id}`;
      } else selectedAim.textContent = entry
        ? (observationFresh ? "No active movement aim" : "Last observation: no active movement aim") : "";
    }
    if (followButton) {
      followButton.disabled = !entry || !observationFresh;
      followButton.textContent = following ? "Stop following" : "Follow body";
      followButton.setAttribute("aria-pressed", String(following));
    }
    if (residentCount) residentCount.textContent = `${bodies.size} observed`;
    for (const [id, item] of bodies) {
      item.button?.setAttribute("aria-pressed", String(id === selectedId));
      item.label?.classList.toggle("selected", id === selectedId);
    }
  }

  function selectBody(id) {
    if (!bodies.has(id)) return;
    selectedId = id;
    following = false;
    refreshInspector();
  }

  function toggleFollow() {
    const entry = bodies.get(selectedId);
    if (!entry || !observationFresh) return;
    following = !following;
    if (following) {
      automaticView = false;
      automaticFrameTime = null;
    }
    refreshInspector();
  }

  function markObservation(fresh, message) {
    if (fresh !== observationFresh) automaticFrameTime = null;
    observationFresh = fresh;
    if (observationStatus) observationStatus.textContent = message;
    if (!fresh) activityFeedback = activityCueTracker.stale();
    refreshActivity();
    refreshInspector();
  }

  function refreshActivity() {
    if (!activityStrip) return;
    const presentation = activityPresentation(demoActivity, bodies, {
      fresh: observationFresh, historyGap: activityFeedback.historyGap,
    });
    activityStrip.hidden = presentation === null;
    if (!presentation) return;
    activityStrip.classList.toggle("last-observed", !observationFresh);
    activityPhase.textContent = presentation.phase;
    activityCount.textContent = presentation.count;
    activityStatus.textContent = presentation.status;
    activityGoal.textContent = presentation.goal;
    activityRules.textContent = presentation.rules;
    activityDwell.textContent = presentation.dwell;
    activityParticipants.replaceChildren(...presentation.participants.map(participant => {
      const row = document.createElement("p");
      const identity = document.createElement("strong");
      identity.textContent = `${participant.identity} · ${participant.availability}`;
      const progress = document.createElement("span");
      progress.textContent = [participant.observation, participant.progress, participant.proof].filter(Boolean).join(" · ");
      row.append(identity, progress);
      return row;
    }));
    activityHistory.replaceChildren(...presentation.history.map(text => {
      const item = document.createElement("li");
      item.textContent = text;
      return item;
    }));
    activityGap.textContent = presentation.historyGap ?? "";
    activityGap.hidden = !presentation.historyGap;
    const cue = observationFresh ? activityFeedback.cue : null;
    if (activityCue.textContent !== (cue ?? "")) {
      activityCue.textContent = cue ?? "";
      activityCue.classList.toggle("earned", cue !== null);
    }
    activityCue.hidden = cue === null;
  }

  function adoptActivity(activity, kind) {
    const feedback = activityCueTracker.observe(activity, { kind, fresh: true });
    // Keep the earned-round notice visible during its COMPLETE hold, rather
    // than erase it on the next 20 Hz replacement. Every FULL stays silent.
    const keepCue = kind === "delta" && activity?.phase === demoActivity?.phase &&
      activity?.completedRounds === demoActivity?.completedRounds &&
      activity?.resetId === demoActivity?.resetId && activity !== undefined &&
      demoActivity !== undefined && activity.runId.every((byte, index) => byte === demoActivity.runId[index]);
    activityFeedback = { ...feedback, cue: feedback.cue ?? (keepCue ? activityFeedback.cue : null) };
    demoActivity = activity;
  }

  function resetView() {
    automaticView = true;
    following = false;
    automaticFrameTime = null;
    refreshInspector();
    const bounds = currentShapeBounds();
    if (!admitShapes(bounds, true)) return;
    fitState = null;
    pendingSnap = bounds !== null;
    initialFitPending = bounds === null;
    if (bounds) placeGrid(bounds);
    else grid.visible = false;
  }

  function updateSceneState() {
    const bounds = currentShapeBounds();
    const admitted = admitShapes(bounds);
    if (bodies.size === 0) {
      grid.visible = false;
      setSceneState(EMPTY_SCENE_MESSAGE);
    } else if (!bounds) {
      grid.visible = false;
      setSceneState(SHAPELESS_SCENE_MESSAGE);
    } else {
      if (admitted && initialFitPending && automaticView && !following) {
        pendingSnap = true;
        automaticFrameTime = null;
        initialFitPending = false;
      }
      if (!grid.visible) placeGrid(bounds);
      if (!framingFailure) setSceneState("");
    }
    if (resetButton) resetButton.disabled = false;
    markObservation(true, bodies.size ? `Observing ${bodies.size} ${bodies.size === 1 ? "body" : "bodies"}` : "Connected · empty observation");
  }

  function manualView() {
    automaticView = false;
    following = false;
    automaticFrameTime = null;
    refreshInspector();
  }
  controls.addEventListener("start", manualView);
  resetButton?.addEventListener("click", resetView);
  followButton?.addEventListener("click", toggleFollow);

  function resize() {
    const width = Math.max(1, targetCanvas.clientWidth);
    const height = Math.max(1, targetCanvas.clientHeight);
    renderer.setSize(width, height, false);
    camera.aspect = width / height;
    camera.updateProjectionMatrix();
    if (automaticView && !following && envelopeBounds) {
      try {
        const goal = planObservedFit(projection(), envelopeBounds);
        fitGoal = goal;
        pendingSnap = true;
        automaticFrameTime = null;
      } catch (error) { reportFramingFailure(error); }
    }
  }
  const resizeObserver = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(resize);
  resizeObserver?.observe(targetCanvas);
  if (!resizeObserver) window.addEventListener?.("resize", resize);

  function removeBody(key) {
    const entry = bodies.get(key);
    if (!entry) return;
    entry.visual.dispose();
    entry.button?.removeEventListener("click", entry.onSelect);
    entry.button?.remove();
    entry.label?.remove();
    bodies.delete(key);
    if (selectedId === key) { selectedId = null; following = false; }
  }

  function removeMissing() {
    for (const key of bodies.keys()) {
      if (!seen.has(key)) {
        removeBody(key);
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
      const visual = createResidentVisual(scene, record.entityId, record.shape);
      const mesh = visual.mesh;
      mesh.position.copy(target);
      const button = residentList ? document.createElement("button") : null;
      const label = bodyLabels ? document.createElement("span") : null;
      const onSelect = () => selectBody(key);
      if (button) {
        button.type = "button";
        button.className = "resident-button";
        button.dataset.bodyId = key;
        button.style.setProperty("--body-color", `#${bodyColor(record.entityId).getHexString()}`);
        button.addEventListener("click", onSelect);
        residentList.append(button);
      }
      if (label) {
        label.textContent = `Body ${key}`;
        label.className = "body-label";
        label.style.setProperty("--body-color", `#${bodyColor(record.entityId).getHexString()}`);
        bodyLabels.append(label);
      }
      entry = { mesh, target, record, visual, button, label, onSelect };
      bodies.set(key, entry);
    }
    entry.visual.update(record, target);
    entry.target.copy(target);
    entry.record = record;
    if (entry.button) entry.button.textContent = `Body ${key}${record.shape ? "" : " · no shape"}${record.aim ? " · target" : ""}`;
  }

  function requestResync(reason) {
    waitingForFull = true;
    baselineId = null;
    markObservation(false, "Refreshing · last observed positions");
    setSceneState("Refreshing observation. Visible bodies and targets are the last observation.");
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
      if (!canRenderRecords(decoded.bodies)) return;
      baselineId = body.value.baselineId;
      waitingForFull = false;
      lastTick = decoded.tick;
      seen.clear();
      for (const record of decoded.bodies) seen.add(record.entityId.toString());
      // Release departures before allocations, including an entire AOI
      // replacement, so even transient graphics ownership stays <=100 bodies.
      removeMissing();
      for (const record of decoded.bodies) {
        upsertBody(record);
      }
      adoptActivity(decoded.demoActivity, "full");
      shapeRecoveryAttempts = 0;
      updateSceneState();
      setObservationStatus(
        `viewer: full baseline tick=${decoded.tick} bodies=${decoded.bodies.length} (real bodies)`,
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
          decoded.leftIds.some(id => !bodies.has(id.toString())) ||
          bodies.size + decoded.entered.length - decoded.leftIds.length > 100) {
        requestResync("delta entity mismatch");
        return;
      }
      if (!canRenderRecords([...decoded.entered, ...decoded.modified])) return;
      for (const leftId of decoded.leftIds) removeBody(leftId.toString());
      for (const record of decoded.entered) {
        upsertBody(record);
      }
      for (const record of decoded.modified) {
        upsertBody(record);
      }
      adoptActivity(decoded.demoActivity, "delta");
      shapeRecoveryAttempts = 0;
      updateSceneState();
      setObservationStatus(
        `viewer: delta baseline tick=${lastTick} bodies=${bodies.size} (real bodies, +${decoded.entered.length}/~${decoded.modified.length}/-${decoded.leftIds.length})`,
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
    initialFitPending = true;
    historyBounds = null;
    envelopeBounds = null;
    fitGoal = null;
    fitState = null;
    pendingSnap = false;
    automaticFrameTime = null;
    framingFailure = null;
    shapeRecoveryAttempts = 0;
    grid.visible = false;
    // Drop any bodies carried over from a prior connection: a new
    // connection_id is a new session, the prior bodies are no longer
    // authoritative.
    for (const key of bodies.keys()) removeBody(key);
    seen.clear();
    if (resetButton) resetButton.disabled = true;
    markObservation(false, "Connecting to the world");
    setStatus(`viewer: connecting ${wsUrl}`);
    setSceneState("Connecting to the world server. Camera controls are local and read-only.");
    const currentSocket = new WebSocket(wsUrl);
    socket = currentSocket;
    currentSocket.binaryType = "arraybuffer";
    currentSocket.addEventListener("open", () => {
      if (closed || socket !== currentSocket) return;
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
      if (closed || socket !== currentSocket) return;
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
            setSceneState("Connected. Waiting for the first full observation.");
            markObservation(false, "Connected · waiting for observation");
            return;
          }
          if (frame.body.case === "handshakeReject") {
            setStatus(`viewer: handshake rejected: ${frame.body.value.message}`);
            setSceneState("Connection rejected. Check the server address and reload to retry.");
            markObservation(false, "Connection rejected");
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
      markObservation(false, "Disconnected · last observed positions");
      setSceneState("Disconnected. Any visible bodies are the last observation. Retrying in 1 second.");
      reconnectTimer = setTimeout(connect, 1000);
    });
    currentSocket.addEventListener("error", () => {
      if (closed || socket !== currentSocket) return;
      setStatus("viewer: socket error");
      markObservation(false, "Connection error · last observed positions");
      setSceneState("Cannot reach the world server. Check that it is running and the WebSocket address is correct.");
    });
  }

  connect();

  function tick(timestamp) {
    if (closed) return;
    for (const entry of bodies.values()) {
      entry.mesh.position.lerp(entry.target, 0.2);
    }
    const followed = following && observationFresh ? bodies.get(selectedId) : null;
    if (followed) {
      const center = shapeCenter(followed);
      camera.position.add(new THREE.Vector3().subVectors(center, controls.target));
      controls.target.copy(center);
    }
    controls.update();
    if (automaticView && !following && fitGoal) {
      try {
        const snap = pendingSnap || fitState === null;
        const elapsedSeconds = snap || !observationFresh || automaticFrameTime === null
          ? 0 : Math.max(0, (timestamp - automaticFrameTime) / 1000);
        const frame = stepAutomaticFit({
          state: fitState, goal: fitGoal, projection: projection(),
          displayedBoxes: displayedShapeBoxes(), elapsedSeconds,
          snap, ease: observationFresh, tuning: FRAMING_TUNING,
        });
        // This is the sole automatic pose write, after display interpolation
        // and OrbitControls.update, before projection of labels and rendering.
        fitState = frame.state;
        controls.target.copy(frame.state.target);
        camera.position.copy(frame.state.target).addScaledVector(AUTOMATIC_DIRECTION, frame.state.distance);
        camera.lookAt(frame.state.target);
        camera.near = frame.near;
        camera.far = frame.far;
        camera.updateProjectionMatrix();
        camera.updateMatrixWorld();
        pendingSnap = false;
        automaticFrameTime = observationFresh ? timestamp : null;
        if (framingFailure) {
          framingFailure = null;
          if (observationFresh) {
            setSceneState(currentShapeBounds() ? "" : bodies.size ? SHAPELESS_SCENE_MESSAGE : EMPTY_SCENE_MESSAGE);
            setStatus("viewer: automatic framing resumed");
          }
        }
      } catch (error) { reportFramingFailure(error); }
    } else automaticFrameTime = null;
    if (bodyLabels) {
      camera.updateMatrixWorld();
      for (const entry of bodies.values()) {
        const point = entry.visual.localBounds.getCenter(new THREE.Vector3());
        point.y = entry.visual.localBounds.max.y + 0.15;
        point.add(entry.mesh.position).project(camera);
        entry.label.hidden = Math.abs(point.x) > 1 || Math.abs(point.y) > 1 || point.z < -1 || point.z > 1;
        entry.label.style.left = `${(point.x + 1) * targetCanvas.clientWidth / 2}px`;
        entry.label.style.top = `${(1 - point.y) * targetCanvas.clientHeight / 2}px`;
      }
    }
    renderer.render(scene, camera);
    animationFrame = requestAnimationFrame(tick);
  }
  animationFrame = requestAnimationFrame(tick);

  function dispose() {
    if (disposed) return;
    disposed = true;
    closed = true;
    if (reconnectTimer !== null) clearTimeout(reconnectTimer);
    if (animationFrame !== null) cancelAnimationFrame(animationFrame);
    socket?.close();
    resizeObserver?.disconnect();
    window.removeEventListener?.("resize", resize);
    resetButton?.removeEventListener("click", resetView);
    followButton?.removeEventListener("click", toggleFollow);
    controls.removeEventListener("start", manualView);
    controls.dispose();
    for (const key of bodies.keys()) removeBody(key);
    scene.remove(grid);
    grid.geometry.dispose();
    for (const material of Array.isArray(grid.material) ? grid.material : [grid.material]) material.dispose();
    renderer.dispose();
  }
  return { resetView, dispose };
}

if (canvas instanceof HTMLCanvasElement) {
  const params = new URLSearchParams(location.search);
  const ws = params.get("ws") ?? "ws://127.0.0.1:7600/ws";
  startLiveViewer(canvas, ws);
}
