import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import test from "node:test";
import { Vector3 } from "three";
import { create, fromBinary, toBinary } from "@bufbuild/protobuf";
import { BinaryReader, BinaryWriter } from "@bufbuild/protobuf/wire";
import {
  ConnectionMode,
  ConnectionRole,
  EnvelopeSchema,
  FeatureSelectionSchema,
  HandshakeFrameSchema,
  PerceptKind,
  WorldSnapshotBodyProtoSchema,
  WorldSnapshotDeltaProtoSchema,
} from "@aigent-place/protocol";
import { scenes, cameras, controls, renderers, graphicsResources } from "./fake-three.mjs";
import { activity, completedActivity, entity } from "./snapshot-fixtures.mjs";

const hooks = registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier === "./style.css" && context.parentURL.endsWith("/src/main.js")) {
      return { url: "data:text/javascript,export%20{}", shortCircuit: true };
    }
    if ((specifier === "three" || specifier === "three/addons/controls/OrbitControls.js") &&
        ["/src/main.js", "/src/resident-visuals.js"].some(path => context.parentURL.endsWith(path))) {
      return { url: new URL("./fake-three.mjs", import.meta.url).href, shortCircuit: true };
    }
    return nextResolve(specifier, context);
  },
});
const status = { textContent: "" };
const sceneState = { textContent: "", hidden: false };
const resetButton = {
  disabled: true,
  listeners: {},
  addEventListener(name, callback) { this.listeners[name] = callback; },
  removeEventListener(name) { delete this.listeners[name]; },
};
class Element {
  constructor() {
    this.textContent = ""; this.children = []; this.listeners = {}; this.attributes = {}; this.dataset = {}; this.hidden = false;
    this.style = { setProperty(name, value) { this[name] = value; } };
    this.classList = { toggle() {} };
  }
  setAttribute(name, value) { this.attributes[name] = value; }
  addEventListener(name, callback) { this.listeners[name] = callback; }
  removeEventListener(name) { delete this.listeners[name]; }
  append(...children) { for (const child of children) { child.parent = this; this.children.push(child); } }
  replaceChildren(...children) { this.children = []; this.append(...children); }
  remove() { if (this.parent) this.parent.children = this.parent.children.filter(value => value !== this); }
  click() { if (!this.disabled) this.listeners.click?.(); }
}
const ui = Object.fromEntries(["follow-body", "resident-list", "body-labels", "selected-title", "selected-aim", "selected-position", "observation-status", "resident-count",
  "activity-strip", "activity-phase", "activity-count", "activity-status", "activity-goal", "activity-rules", "activity-dwell", "activity-participants", "activity-history", "activity-gap", "activity-cue",
].map(id => [`#${id}`, new Element()]));
globalThis.document = {
  querySelector: selector => ({ "#status": status, "#scene-state": sceneState, "#reset-view": resetButton, ...ui })[selector],
  createElement: () => new Element(),
};
globalThis.HTMLCanvasElement = class {};
const { startLiveViewer } = await import("../src/main.js");
hooks.deregister();

// Only the graphics boundary is faked here. This second viewer module uses
// installed OrbitControls and delegates every math call to the real helpers.
const realMainUrl = new URL("../src/main.js?installed-controls", import.meta.url).href;
const fakeThreeUrl = new URL("./fake-three.mjs", import.meta.url).href;
const cameraUrl = new URL("../src/camera.js", import.meta.url).href;
const controlsUrl = import.meta.resolve("three/addons/controls/OrbitControls.js");
const realControlsModule = `import { OrbitControls as Installed } from ${JSON.stringify(controlsUrl)};
import { controls } from ${JSON.stringify(fakeThreeUrl)};
export class OrbitControls extends Installed {
  constructor(camera, canvas) { super(camera, canvas); this.disposals = 0; controls.push(this); }
  emit(type) { this.dispatchEvent({ type }); }
  dispose() { this.disposals += 1; super.dispose(); }
}`;
const tracedCameraModule = `export * from ${JSON.stringify(cameraUrl)};
import { admitObservedBounds as admit, stepAutomaticFit as step } from ${JSON.stringify(cameraUrl)};
export function admitObservedBounds(...args) {
  const result = admit(...args);
  globalThis.__viewerCameraCalls?.push({ kind: "admit", history: args[0]?.clone() ?? null,
    applied: args[2]?.clone() ?? null, result });
  return result;
}
export function stepAutomaticFit(input) {
  const call = { kind: "step", input };
  globalThis.__viewerCameraCalls?.push(call);
  const result = step(input);
  call.result = result;
  return result;
}`;
const realHooks = registerHooks({
  resolve(specifier, context, nextResolve) {
    if (context.parentURL === realMainUrl) {
      if (specifier === "./style.css") return { url: "data:text/javascript,export%20{}", shortCircuit: true };
      if (specifier === "three") return { url: fakeThreeUrl, shortCircuit: true };
      if (specifier === "three/addons/controls/OrbitControls.js") {
        return { url: `data:text/javascript,${encodeURIComponent(realControlsModule)}`, shortCircuit: true };
      }
      if (specifier === "./camera.js") {
        return { url: `data:text/javascript,${encodeURIComponent(tracedCameraModule)}`, shortCircuit: true };
      }
    }
    return nextResolve(specifier, context);
  },
});
const { startLiveViewer: startInstalledControlsViewer } = await import(realMainUrl);
realHooks.deregister();

const digest = new Uint8Array(32).fill(0xab);
const connectionId = new Uint8Array(16).fill(7);
let incomingIdentity = connectionId;
let nextIncomingMessageId = 1n;
const fullPayload = (records = [], overrides = {}) => toBinary(WorldSnapshotBodyProtoSchema,
  create(WorldSnapshotBodyProtoSchema, { version: 1, tick: 42n, generationDigest: digest, bodies: records, ...overrides }));
const deltaPayload = (overrides = {}) => toBinary(WorldSnapshotDeltaProtoSchema,
  create(WorldSnapshotDeltaProtoSchema, { version: 1, generationDigest: digest, ...overrides }));
const aim = (targetXMm = 3500n, targetZMm = -250n, speedMmPerS = 500) => ({ targetXMm, targetZMm, speedMmPerS });
const serverEnvelope = (body, overrides = {}) => toBinary(EnvelopeSchema,
  create(EnvelopeSchema, { protocolMajor: 1, connectionId: incomingIdentity, messageId: nextIncomingMessageId++, metadata: {}, body, ...overrides }));
const envelope = (kind, payload, baselineId = 5n, overrides = {}) =>
  serverEnvelope({ case: kind, value: { baselineId, payload } }, overrides);

function shortenMessageBoundary(schema, bytes, name) {
  const field = schema.fields.find(candidate => candidate.localName === name);
  assert.ok(field, "malformation targets a generated message field");
  const reader = new BinaryReader(bytes);
  while (reader.pos < reader.len) {
    const [number, wire] = reader.tag();
    if (number !== field.number) { reader.skip(wire, number); continue; }
    const prefixStart = reader.pos;
    const length = reader.uint32();
    const prefix = new BinaryWriter().uint32(length - 1).finish();
    return Uint8Array.of(...bytes.subarray(0, prefixStart), ...prefix, ...bytes.subarray(reader.pos));
  }
  assert.fail("generated message field was not encoded");
}

function wrongNestedFieldWire(schema, bytes, names, wireType) {
  const malformed = bytes.slice();
  function change(descriptor, segment, offset, [name, ...rest]) {
    const field = descriptor.fields.find(candidate => candidate.localName === name);
    assert.ok(field, "malformation targets a generated field");
    const reader = new BinaryReader(segment);
    while (reader.pos < reader.len) {
      const tagStart = reader.pos;
      const [number, wire] = reader.tag();
      if (number !== field.number) { reader.skip(wire, number); continue; }
      if (rest.length === 0) {
        assert.equal(reader.pos - tagStart, 1, "fixture uses a one-byte tag");
        malformed[offset + tagStart] = (malformed[offset + tagStart] & ~7) | wireType;
        return;
      }
      const length = reader.uint32();
      change(field.message, segment.subarray(reader.pos, reader.pos + length), offset + reader.pos, rest);
      return;
    }
    assert.fail("generated nested field was not encoded");
  }
  change(schema, bytes, 0, names);
  return malformed;
}

function appendUnknownMessageField(schema, bytes, name, suffix) {
  const field = schema.fields.find(candidate => candidate.localName === name);
  const reader = new BinaryReader(bytes);
  while (reader.pos < reader.len) {
    const [number, wire] = reader.tag();
    if (number !== field.number) { reader.skip(wire, number); continue; }
    const prefixStart = reader.pos;
    const length = reader.uint32();
    const bodyEnd = reader.pos + length;
    const prefix = new BinaryWriter().uint32(length + suffix.length).finish();
    return Uint8Array.of(...bytes.subarray(0, prefixStart), ...prefix, ...bytes.subarray(reader.pos, bodyEnd), ...suffix, ...bytes.subarray(bodyEnd));
  }
  assert.fail("generated message field was not encoded");
}

function harness(t, startViewer = startLiveViewer) {
  const globals = ["WebSocket", "window", "requestAnimationFrame", "cancelAnimationFrame", "setTimeout", "clearTimeout", "ResizeObserver", "__viewerCameraCalls"];
  const previous = globals.map(name => [name, globalThis[name]]);
  let viewer;
  t.after(() => { viewer?.dispose(); for (const [name, value] of previous) globalThis[name] = value; });
  const sockets = [];
  const animations = [];
  const timers = [];
  const cancelledFrames = [];
  const clearedTimers = [];
  const observers = [];
  class FakeSocket {
    static OPEN = 1;
    constructor(url) { this.url = url; this.readyState = 0; this.listeners = {}; this.sent = []; this.closeCalls = 0; sockets.push(this); }
    addEventListener(name, callback) { this.listeners[name] = callback; }
    send(bytes) { this.sent.push(new Uint8Array(bytes)); }
    emit(name, value = {}) { this.listeners[name]?.(value); }
    receive(bytes) { this.emit("message", { data: bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) }); }
    close() { if (this.readyState === 3) return; this.closeCalls += 1; this.readyState = 3; this.emit("close"); }
  }
  globalThis.WebSocket = FakeSocket;
  globalThis.window = { devicePixelRatio: 1 };
  globalThis.__viewerCameraCalls = [];
  globalThis.requestAnimationFrame = callback => animations.push(callback);
  globalThis.cancelAnimationFrame = id => cancelledFrames.push(id);
  globalThis.setTimeout = (callback, delay) => { timers.push({ callback, delay }); return timers.length; };
  globalThis.clearTimeout = id => clearedTimers.push(id);
  globalThis.ResizeObserver = class {
    constructor(callback) { this.callback = callback; this.disconnections = 0; observers.push(this); }
    observe() {}
    disconnect() { this.disconnections += 1; }
  };
  scenes.length = 0;
  cameras.length = controls.length = renderers.length = 0;
  status.textContent = "";
  incomingIdentity = connectionId;
  nextIncomingMessageId = 1n;
  const canvas = new Element();
  Object.assign(canvas, {
    clientWidth: 800, clientHeight: 600,
    getRootNode: () => ({ addEventListener() {}, removeEventListener() {} }),
    setPointerCapture() {}, releasePointerCapture() {},
  });
  let frameTime = 0;
  viewer = startViewer(canvas, "ws://viewer.test/ws");
  const scene = scenes[0];
  function handshake(socket = sockets.at(-1), transform = bytes => bytes, identity = connectionId) {
    socket.readyState = FakeSocket.OPEN;
    socket.emit("open");
    const hello = fromBinary(HandshakeFrameSchema, socket.sent[0]);
    assert.equal(hello.body.case, "clientHello");
    assert.equal(hello.body.value.role, ConnectionRole.VIEWER);
    socket.receive(transform(toBinary(HandshakeFrameSchema, create(HandshakeFrameSchema, {
      body: { case: "serverHello", value: { selectedProtocolMajor: 1, connectionId: identity, role: ConnectionRole.VIEWER, mode: ConnectionMode.SPECTATE_ONLY } },
    }))));
    incomingIdentity = identity;
    nextIncomingMessageId = 1n;
    return socket;
  }
  return {
    sockets, timers, scene, handshake, viewer, canvas, camera: cameras[0], controls: controls[0], renderer: renderers[0], observers, cancelledFrames, clearedTimers,
    cameraCalls: globalThis.__viewerCameraCalls,
    meshes: () => scene.children.filter(child => child.isGroup).map(child => { graphicsResources(child); return child; }),
    lines: () => scene.children.filter(child => child.isLine),
    choose: id => ui["#resident-list"].children.find(button => button.dataset.bodyId === String(id)).click(),
    frame: (elapsedMs = 1000 / 60) => { frameTime += elapsedMs; animations.shift()(frameTime); },
    requests: (socket = sockets.at(-1)) => socket.sent.slice(1).map(bytes => fromBinary(EnvelopeSchema, bytes)),
  };
}

function assertDisposed(mesh) {
  for (const resource of graphicsResources(mesh)) assert.equal(resource.disposals, 1, "owned graphics disposed once");
}

function shapeParts(root) {
  const parts = [];
  root.traverse(value => { if (value.isMesh) parts.push(value); });
  return parts;
}

function assertVectorClose(actual, expected) {
  actual.forEach((value, index) => assert.ok(Math.abs(value - expected[index]) < 1e-10,
    `coordinate ${index}: expected ${expected[index]}, observed ${value}`));
}

test("initial public activity restores full history silently and discloses AOI body omission without selection", t => {
  const h = harness(t), socket = h.handshake();
  socket.receive(envelope("fullSnapshot", fullPayload([entity(1n)], { demoActivity: completedActivity() })));
  assert.equal(ui["#activity-strip"].hidden, false);
  assert.equal(ui["#activity-count"].textContent, "1 round earned");
  assert.equal(ui["#activity-phase"].textContent, "COMPLETE · Round earned");
  assert.equal(ui["#activity-history"].children.length, 2);
  assert.match(ui["#activity-participants"].children[1].children[1].textContent, /body not in this observation/);
  assert.equal(ui["#activity-cue"].hidden, true);
  assert.equal(ui["#selected-title"].textContent, "Choose a body");
  assert.equal(h.meshes().length, 1, "activity participant references cannot create an AOI body");
});

test("fresh completion cues hold visibly, reconnect FULL is silent, and stale activity cannot cue", t => {
  const h = harness(t), socket = h.handshake();
  socket.receive(envelope("fullSnapshot", fullPayload([entity(1n), entity(2n)], { demoActivity: activity() })));
  socket.receive(envelope("snapshotDelta", deltaPayload({ demoActivity: completedActivity() })));
  assert.match(ui["#activity-cue"].textContent, /^Round 1 earned/);
  socket.receive(envelope("snapshotDelta", deltaPayload({ demoActivity: completedActivity({ observedTick: 43n }) })));
  assert.equal(ui["#activity-cue"].hidden, false, "next 20 Hz replacement retains notice during COMPLETE hold");
  socket.close();
  assert.match(ui["#activity-status"].textContent, /^Last observed/);
  assert.equal(ui["#activity-cue"].hidden, true);
  h.timers.shift().callback();
  const next = h.handshake(h.sockets.at(-1), bytes => bytes, new Uint8Array(16).fill(10));
  next.receive(envelope("fullSnapshot", fullPayload([entity(1n), entity(2n)], { demoActivity: completedActivity() })));
  assert.equal(ui["#activity-count"].textContent, "1 round earned");
  assert.equal(ui["#activity-cue"].hidden, true, "reconnect does not celebrate old success");
  next.receive(envelope("snapshotDelta", deltaPayload({ demoActivity: completedActivity() })));
  assert.equal(ui["#activity-cue"].hidden, true, "watermark survives reconnect");
});

test("malformed activity rejects the entire body transition and recovery FULL restores a silent latest state", t => {
  const h = harness(t), socket = h.handshake();
  socket.receive(envelope("fullSnapshot", fullPayload([entity(1n)], { demoActivity: activity() })));
  const original = h.meshes()[0];
  socket.receive(envelope("snapshotDelta", deltaPayload({ entered: [entity(2n)], leftIds: [1n], demoActivity: completedActivity({ version: 2 }) })));
  assert.equal(h.meshes()[0], original);
  assert.equal(h.meshes().length, 1);
  assert.equal(ui["#activity-count"].textContent, "0 rounds earned");
  assert.match(ui["#activity-status"].textContent, /^Last observed/);
  assert.equal(h.requests().at(-1).body.case, "snapshotResyncRequest");
  socket.receive(envelope("fullSnapshot", fullPayload([entity(2n)], { demoActivity: completedActivity() }), 6n));
  assert.equal(ui["#activity-count"].textContent, "1 round earned");
  assert.equal(ui["#activity-cue"].hidden, true);
  assert.equal(h.meshes()[0].position.x, 1.5);
});

test("every accepted absent activity replacement clears the strip while malformed FULL retains the last strip", t => {
  const h = harness(t), socket = h.handshake();
  socket.receive(envelope("fullSnapshot", fullPayload([entity(1n)], { demoActivity: activity() })));
  socket.receive(envelope("fullSnapshot", fullPayload([entity(2n)], { demoActivity: activity({ phase: 99 }) }), 6n));
  assert.equal(ui["#activity-strip"].hidden, false);
  assert.equal(h.meshes().length, 1);
  assert.equal(ui["#resident-list"].children[0].dataset.bodyId, "1");
  socket.receive(envelope("fullSnapshot", fullPayload([entity(1n)]), 7n));
  assert.equal(ui["#activity-strip"].hidden, true);
  socket.receive(envelope("snapshotDelta", deltaPayload({ demoActivity: activity() }), 7n));
  assert.equal(ui["#activity-strip"].hidden, false);
  socket.receive(envelope("snapshotDelta", deltaPayload(), 7n));
  assert.equal(ui["#activity-strip"].hidden, true);
});

test("mismatched activity observed tick cannot partially install a full body's pose or earned count", t => {
  const h = harness(t), socket = h.handshake();
  socket.receive(envelope("fullSnapshot", fullPayload([entity(1n)], { demoActivity: activity() })));
  const previous = h.meshes()[0];
  socket.receive(envelope("fullSnapshot", fullPayload([entity(2n)], { tick: 43n, demoActivity: completedActivity() }), 6n));
  assert.equal(h.meshes()[0], previous);
  assert.equal(ui["#resident-list"].children[0].dataset.bodyId, "1");
  assert.equal(ui["#activity-count"].textContent, "0 rounds earned");
  assert.match(ui["#activity-status"].textContent, /^Last observed/);
  assert.equal(h.requests().at(-1).body.case, "snapshotResyncRequest");
});

test("live scene renders decoded primitive geometry and alpha instead of a local cube", t => {
  const h = harness(t), socket = h.handshake();
  const record = entity(1n);
  record.shape.nodes[0].color = { red: 240, green: 80, blue: 20, alpha: 0 };
  socket.receive(envelope("fullSnapshot", fullPayload([record])));
  const root = h.meshes()[0], parts = shapeParts(root);
  assert.equal(parts.length, 6);
  assert.deepEqual(parts.map(part => part.geometry.type).sort(),
    ["BoxGeometry", "BoxGeometry", "CapsuleGeometry", "ConeGeometry", "CylinderGeometry", "SphereGeometry"].sort());
  const box = parts.find(part => part.geometry.parameters.width === 1.2);
  assert.ok(box);
  assert.equal(box.geometry.parameters.height, 0.8);
  assert.equal(box.geometry.parameters.depth, 0.6);
  assert.equal(box.material.opacity, 0, "present zero alpha is not a missing colour");
  assert.deepEqual(root.position.toArray(), [1.5, 0, -2.25], "entity origin applied once");
});

test("shape-only cosmetic replacement releases old parts and keeps selected follow, aims and trails", t => {
  const h = harness(t), socket = h.handshake();
  socket.receive(envelope("fullSnapshot", fullPayload([entity(1n, { aim: aim() })])));
  const root = h.meshes()[0], oldParts = shapeParts(root), lines = h.lines();
  h.choose(1n); ui["#follow-body"].click();
  const replacement = entity(1n, { aim: aim() });
  replacement.shape.nodes[0].color = { red: 250, green: 10, blue: 20, alpha: 128 };
  replacement.shape.nodes[0].primitive.value.sizeYMm = 3200n;
  socket.receive(envelope("snapshotDelta", deltaPayload({ modified: [replacement] })));
  assert.equal(h.meshes()[0], root, "stable body handle survives geometry replacement");
  assert.equal(ui["#selected-title"].textContent, "Body 1");
  assert.equal(ui["#follow-body"].attributes["aria-pressed"], "true");
  assert.deepEqual(h.lines(), lines);
  assert.equal(lines[2].geometry.drawRange.count, 1, "stationary shape changes cannot extend history");
  oldParts.forEach(part => assertDisposed(part));
  const updated = shapeParts(root).find(part => part.geometry.parameters.width === 1.2);
  assert.equal(updated.geometry.parameters.height, 3.2);
  assert.equal(updated.material.opacity, 128 / 255);
  h.frame();
  assert.ok(Math.abs(h.controls.target.y - 0.02) < 1e-12, "follow uses shape centre");
});

test("complete malformed shape transition cannot remove or modify visible bodies before recovery", t => {
  const h = harness(t), socket = h.handshake();
  socket.receive(envelope("fullSnapshot", fullPayload([entity(1n), entity(2n)])));
  const roots = h.meshes(), oldParts = roots.map(shapeParts);
  const broken = entity(3n); broken.shape.nodes[0].parentNodeId = 2;
  socket.receive(envelope("snapshotDelta", deltaPayload({
    leftIds: [2n], entered: [broken], modified: [entity(1n, { positionMm: { xMm: 9999n, yMm: 0n, zMm: 0n } })],
  })));
  assert.deepEqual(h.meshes(), roots);
  assert.equal(roots[0].position.x, 1.5);
  oldParts.flat().forEach(part => graphicsResources(part).forEach(resource => assert.equal(resource.disposals, 0)));
  assert.equal(h.requests().length, 1);
  assert.equal(ui["#follow-body"].disabled, true);
  socket.receive(envelope("fullSnapshot", fullPayload([entity(1n)]), 9n));
  assert.equal(h.meshes().length, 1, "valid replacement full recovers");
  assert.equal(ui["#resident-count"].textContent, "1 observed");
});

test("unrenderable repeated fulls have bounded recovery and retain the complete last observation", t => {
  const h = harness(t), socket = h.handshake();
  socket.receive(envelope("fullSnapshot", fullPayload([entity(1n)])));
  const root = h.meshes()[0];
  const broken = entity(2n); broken.shape.nodes = [];
  socket.receive(envelope("fullSnapshot", fullPayload([broken]), 8n));
  assert.equal(h.meshes()[0], root);
  assert.equal(h.requests().length, 1);
  socket.receive(envelope("fullSnapshot", fullPayload([broken]), 9n));
  assert.equal(h.meshes()[0], root);
  assert.equal(h.requests().length, 1, "no unbounded resync request loop");
  assert.equal(socket.closeCalls, 1);
  assert.equal(h.timers.length, 0, "unsupported shape does not reconnect forever");
  assert.match(sceneState.textContent, /cannot render/);
});

test("valid shapeless records retain position, public aim and numeric label without a cube", t => {
  const h = harness(t), socket = h.handshake();
  socket.receive(envelope("fullSnapshot", fullPayload([entity(1n, { shape: undefined, aim: aim() })])));
  const root = h.meshes()[0];
  assert.equal(shapeParts(root).length, 0);
  assert.deepEqual(root.position.toArray(), [1.5, 0, -2.25]);
  assert.equal(h.lines()[0].visible, true);
  assert.match(ui["#resident-list"].children[0].textContent, /Body 1 · no shape · target/);
  assert.equal(h.requests().length, 0);
  h.choose(1n); ui["#follow-body"].click(); h.frame();
  assert.deepEqual(h.controls.target.toArray(), [1.5, 0, -2.25]);
});

test("individually valid entity coordinates cannot push a complete shape beyond the world bound", t => {
  const h = harness(t), socket = h.handshake();
  socket.receive(envelope("fullSnapshot", fullPayload([entity(1n)])));
  const root = h.meshes()[0];
  socket.receive(envelope("fullSnapshot", fullPayload([
    entity(2n, { positionMm: { xMm: 100000000n, yMm: 0n, zMm: 0n } }),
  ]), 8n));
  assert.equal(h.meshes()[0], root);
  assert.equal(ui["#resident-count"].textContent, "1 observed");
  assert.equal(h.requests().length, 1);
});

test("offset tall shape controls and label use the full observed geometry", t => {
  const h = harness(t), socket = h.handshake();
  const record = entity(1n);
  record.shape.nodes = [record.shape.nodes[0]];
  record.shape.nodes[0].transform.translation = { xMm: 3000n, yMm: 4000n, zMm: -2000n };
  record.shape.nodes[0].primitive.value = { sizeXMm: 2000n, sizeYMm: 10000n, sizeZMm: 1000n };
  socket.receive(envelope("fullSnapshot", fullPayload([record])));
  h.frame();
  assertVectorClose(h.controls.target.toArray(), [4.5, 4, -4.25]);
  h.choose(1n); ui["#follow-body"].click(); h.frame();
  assertVectorClose(h.controls.target.toArray(), [4.5, 4, -4.25]);
  const label = ui["#body-labels"].children[0];
  const expected = h.controls.target.clone().set(4.5, 9.15, -4.25).project(h.camera);
  assert.ok(Math.abs(parseFloat(label.style.left) - (expected.x + 1) * h.canvas.clientWidth / 2) < 1e-9);
  assert.ok(Math.abs(parseFloat(label.style.top) - (1 - expected.y) * h.canvas.clientHeight / 2) < 1e-9);
  resetButton.listeners.click();
  h.frame();
  assertVectorClose(h.controls.target.toArray(), [4.5, 4, -4.25]);
});

test("authoritative aim-only changes update reused targets and selected inspector without inventing movement", t => {
  const h = harness(t), socket = h.handshake();
  socket.receive(envelope("fullSnapshot", fullPayload([entity(1n, { aim: aim() })])));
  const [aimLine, marker, trail] = h.lines();
  const mesh = h.meshes()[0];
  const resources = h.lines().map(line => [line.geometry, line.material]);
  assert.equal(aimLine.visible, true);
  assert.equal(marker.visible, true);
  assert.deepEqual([...aimLine.geometry.getAttribute("position").array], [1.5, 0, -2.25, 3.5, 0, -0.25]);
  h.choose(1n);
  assert.equal(ui["#selected-title"].textContent, "Body 1");
  assert.match(ui["#selected-aim"].textContent, /Current movement target: x 3.50 m.*z -0.25 m.*2.83 m away/);
  socket.receive(envelope("snapshotDelta", deltaPayload({ modified: [entity(1n, { aim: aim(-4500n, 2000n) })] })));
  assert.equal(h.meshes()[0], mesh);
  assert.deepEqual([...aimLine.geometry.getAttribute("position").array], [1.5, 0, -2.25, -4.5, 0, 2]);
  assert.match(ui["#selected-aim"].textContent, /x -4.50 m.*z 2.00 m/);
  assert.equal(trail.geometry.drawRange.count, 1, "unchanged authoritative pose does not extend trail");
  for (let index = 0; index < 10; index++) h.frame();
  assert.equal(trail.geometry.drawRange.count, 1, "smoothed frames cannot extend authoritative history");
  assert.deepEqual(h.lines().map(line => [line.geometry, line.material]), resources);
  socket.receive(envelope("snapshotDelta", deltaPayload({ modified: [entity(1n)] })));
  assert.equal(aimLine.visible, false);
  assert.equal(marker.visible, false);
  assert.equal(ui["#selected-aim"].textContent, "No active movement aim");
  assert.doesNotMatch(ui["#selected-aim"].textContent, /arriv|block|sleep|expir|countdown/i);
  assert.equal(h.requests().length, 0, "inspection is read-only");
});

test("trail samples only authoritative movement, ignores two-mm jitter, and retains at most64 points", t => {
  const h = harness(t), socket = h.handshake();
  socket.receive(envelope("fullSnapshot", fullPayload([entity(1n)])));
  const trail = h.lines()[2];
  socket.receive(envelope("snapshotDelta", deltaPayload({ modified: [entity(1n, { positionMm: { xMm: 1501n, yMm: 0n, zMm: -2250n } })] })));
  assert.equal(trail.geometry.drawRange.count, 1);
  for (let index = 1; index <= 100; index++) {
    socket.receive(envelope("snapshotDelta", deltaPayload({ modified: [entity(1n, { positionMm: { xMm: 1500n + BigInt(index * 25), yMm: 0n, zMm: -2250n } })] })));
    h.frame();
  }
  assert.equal(trail.geometry.drawRange.count, 64);
  assert.equal(trail.geometry.getAttribute("position").count, 64, "fixed GPU buffer bounds history");
  assert.ok(Math.abs(trail.geometry.getAttribute("position").getX(0) - 2.425) < 1e-6);
  assert.equal(trail.geometry.getAttribute("position").getX(63), 4);
  for (let index = 0; index < 30; index++) socket.receive(envelope("snapshotDelta", deltaPayload({ modified: [entity(1n, { positionMm: { xMm: 4000n, yMm: 0n, zMm: -2250n } })] })));
  assert.equal(trail.geometry.drawRange.count, 64);
  assert.ok(Math.abs(trail.geometry.getAttribute("position").getX(0) - 2.425) < 1e-6, "duplicate upserts cannot evict useful history");
});

test("near-body target relationship is derived from installed horizontal poses and changes on peer-only updates", t => {
  const h = harness(t), socket = h.handshake();
  socket.receive(envelope("fullSnapshot", fullPayload([
    entity(1n, { aim: aim(4000n, 5000n) }),
    entity(2n, { positionMm: { xMm: 4000n, yMm: 9000n, zMm: 5000n } }),
  ])));
  h.choose(1n);
  assert.match(ui["#selected-aim"].textContent, /Target 0.00 m horizontally from Body 2/);
  socket.receive(envelope("snapshotDelta", deltaPayload({ modified: [entity(2n, { positionMm: { xMm: 7000n, yMm: 0n, zMm: 5000n } })] })));
  assert.doesNotMatch(ui["#selected-aim"].textContent, /from Body/);
  socket.receive(envelope("snapshotDelta", deltaPayload({ modified: [entity(2n, { positionMm: { xMm: 5000n, yMm: 0n, zMm: 5000n } })] })));
  assert.match(ui["#selected-aim"].textContent, /Target 1.00 m horizontally from Body 2/);
  assert.doesNotMatch(ui["#selected-aim"].textContent, /chasing|meeting|following|arriv|goal|sleep|block/i);
});

test("delta growth past100 observed bodies requests recovery before graphics or list allocations", t => {
  const h = harness(t), socket = h.handshake();
  const records = Array.from({ length: 100 }, (_, index) => entity(BigInt(index + 1)));
  socket.receive(envelope("fullSnapshot", fullPayload(records)));
  assert.equal(h.meshes().length, 100);
  socket.receive(envelope("snapshotDelta", deltaPayload({ entered: [entity(101n)] })));
  assert.equal(h.meshes().length, 100);
  assert.equal(ui["#resident-list"].children.length, 100);
  assert.equal(h.requests().at(-1).body.case, "snapshotResyncRequest");
});

test("valid full and delta AOI replacement never transiently allocates over100 bodies", t => {
  const h = harness(t), socket = h.handshake();
  const records = start => Array.from({ length: 100 }, (_, index) => entity(BigInt(start + index)));
  socket.receive(envelope("fullSnapshot", fullPayload(records(1))));
  socket.receive(envelope("fullSnapshot", fullPayload(records(101)), 6n));
  assert.equal(h.scene.peakMeshes, 100);
  socket.receive(envelope("snapshotDelta", deltaPayload({ leftIds: records(101).map(record => record.entityId), entered: records(201) }), 6n));
  assert.equal(h.scene.peakMeshes, 100);
  assert.equal(h.meshes().length, 100);
  assert.equal(h.requests().length, 0);
});

test("selection and follow retain exact ID through full/resync, stop on leave or manual camera, and reset fits bodies", t => {
  const h = harness(t), socket = h.handshake();
  const id = 9007199254740993n;
  socket.receive(envelope("fullSnapshot", fullPayload([entity(1n), entity(id, { positionMm: { xMm: 4000n, yMm: 3000n, zMm: 1000n }, aim: aim() })])));
  h.choose(id);
  assert.equal(ui["#selected-title"].textContent, `Body ${id}`);
  ui["#follow-body"].click();
  assert.equal(ui["#follow-body"].attributes["aria-pressed"], "true");
  h.frame();
  assertVectorClose(h.controls.target.toArray(), [4, 3.02, 0.97]);
  const offset = h.camera.position.clone().sub(h.controls.target);
  socket.receive(envelope("snapshotDelta", deltaPayload({ modified: [entity(id, { positionMm: { xMm: 6000n, yMm: 3000n, zMm: 2000n }, aim: aim() })] })));
  h.frame();
  assertVectorClose(h.controls.target.toArray(), [4.4, 3.02, 1.17]);
  assert.ok(h.camera.position.clone().sub(h.controls.target).distanceTo(offset) < 1e-10);
  socket.receive(serverEnvelope({ case: "snapshotResyncRequired", value: {} }));
  assert.equal(ui["#follow-body"].disabled, true);
  assert.match(ui["#selected-aim"].textContent, /^Last observed movement target/);
  const frozen = h.controls.target.clone();
  h.frame();
  assert.deepEqual(h.controls.target.toArray(), frozen.toArray(), "follow pauses while observation refreshes");
  socket.receive(envelope("fullSnapshot", fullPayload([entity(id, { positionMm: { xMm: 7000n, yMm: 3000n, zMm: 3000n }, aim: aim() }), entity(1n)]), 6n));
  assert.equal(ui["#selected-title"].textContent, `Body ${id}`);
  assert.equal(ui["#follow-body"].attributes["aria-pressed"], "true");
  h.frame();
  assert.ok(h.controls.target.x > frozen.x, "follow resumes on the same ID after full recovery");
  h.controls.emit("start");
  assert.equal(ui["#follow-body"].attributes["aria-pressed"], "false");
  const manual = h.controls.target.clone();
  h.frame();
  assert.deepEqual(h.controls.target.toArray(), manual.toArray());
  ui["#follow-body"].click();
  resetButton.listeners.click();
  assert.equal(ui["#follow-body"].attributes["aria-pressed"], "false");
  h.frame();
  assertVectorClose(h.controls.target.toArray(), [4.25, 1.52, 0.345]);
  ui["#follow-body"].click();
  const selectedGraphics = [h.meshes()[1], ...h.lines().slice(3)];
  socket.receive(envelope("snapshotDelta", deltaPayload({ leftIds: [id] }), 6n));
  assert.equal(ui["#selected-title"].textContent, "Choose a body");
  assert.equal(ui["#follow-body"].disabled, true);
  assert.equal(ui["#follow-body"].attributes["aria-pressed"], "false");
  selectedGraphics.forEach(assertDisposed);
  assert.equal(ui["#resident-list"].children.length, 1);
  assert.deepEqual(h.requests().map(request => request.body.case), ["snapshotResyncRequest"], "navigation adds no world commands");
});

test("invalid aim transition cannot partially change poses, targets, trails or selection, and disconnect labels stale state", t => {
  const h = harness(t), socket = h.handshake();
  socket.receive(envelope("fullSnapshot", fullPayload([entity(1n, { aim: aim() }), entity(2n)])));
  h.choose(1n);
  const aimLine = h.lines()[0], trail = h.lines()[2];
  const before = [...aimLine.geometry.getAttribute("position").array];
  socket.receive(envelope("snapshotDelta", deltaPayload({ modified: [
    entity(1n, { aim: aim(100000001n) }), entity(2n, { positionMm: { xMm: 7000n } }),
  ] })));
  assert.deepEqual([...aimLine.geometry.getAttribute("position").array], before);
  assert.equal(trail.geometry.drawRange.count, 1);
  assert.equal(ui["#selected-title"].textContent, "Body 1");
  assert.match(ui["#selected-aim"].textContent, /^Last observed/);
  assert.equal(h.requests().at(-1).body.case, "snapshotResyncRequest");
  socket.receive(envelope("fullSnapshot", fullPayload([entity(1n, { aim: aim() })]), 6n));
  socket.close();
  assert.match(ui["#selected-aim"].textContent, /^Last observed movement target/);
  assert.equal(ui["#follow-body"].disabled, true);
  h.timers[0].callback();
  assert.equal(ui["#resident-list"].children.length, 0);
  assert.equal(ui["#body-labels"].children.length, 0);
  assert.equal(ui["#selected-title"].textContent, "Choose a body");
  const recovered = h.handshake();
  recovered.receive(envelope("fullSnapshot", fullPayload([entity(2n)]), 7n));
  assert.equal(ui["#resident-list"].children[0].textContent, "Body 2");
  h.choose(2n);
  assert.equal(ui["#selected-aim"].textContent, "No active movement aim");
});

for (const kind of ["fullSnapshot", "snapshotDelta"]) {
  test(`present zero self-body binding in ${kind} requests read-only resync without partial observation effects`, t => {
    const h = harness(t), socket = h.handshake();
    socket.receive(envelope("fullSnapshot", fullPayload([entity(1n, { aim: aim() })])));
    h.choose(1n);
    const mesh = h.meshes()[0], [aimLine, , trail] = h.lines();
    const position = mesh.position.toArray();
    const target = [...aimLine.geometry.getAttribute("position").array];
    const changed = entity(1n, { positionMm: { xMm: 7000n, yMm: 2000n, zMm: 3000n }, aim: aim(9000n, 1000n) });
    const invalid = kind === "fullSnapshot"
      ? fullPayload([changed, entity(2n)], { selfBodyId: 0n })
      : deltaPayload({ selfBodyId: 0n, modified: [changed], entered: [entity(2n)] });
    socket.receive(envelope(kind, invalid));
    assert.equal(h.requests().length, 1);
    assert.equal(h.requests()[0].body.case, "snapshotResyncRequest");
    assert.equal(h.meshes().length, 1);
    assert.equal(h.meshes()[0], mesh);
    assert.deepEqual(mesh.position.toArray(), position);
    assert.deepEqual([...aimLine.geometry.getAttribute("position").array], target);
    assert.equal(trail.geometry.drawRange.count, 1);
    assert.equal(ui["#resident-list"].children.length, 1);
    assert.equal(ui["#selected-title"].textContent, "Body 1");
    assert.match(ui["#selected-aim"].textContent, /^Last observed movement target/);
    assert.match(status.textContent, /invalid.*payload.*requesting full snapshot/);
    socket.receive(envelope("snapshotDelta", deltaPayload({ leftIds: [1n] })));
    assert.equal(h.meshes()[0], mesh, "subsequent deltas wait for a full recovery");
    socket.receive(envelope("fullSnapshot", fullPayload([entity(1n, { aim: aim() })]), 6n));
    assert.match(ui["#selected-aim"].textContent, /^Current movement target/);
    assert.equal(ui["#selected-title"].textContent, "Body 1");
    assert.deepEqual(h.requests().map(request => request.body.case), ["snapshotResyncRequest"]);
  });
}

test("body graphics and local controls release once on leave, reconnect and disposal; reset reuses them", t => {
  const h = harness(t), socket = h.handshake();
  socket.receive(envelope("fullSnapshot", fullPayload([entity(1n, { aim: aim() })])));
  const graphics = [h.meshes()[0], ...h.lines()];
  const button = ui["#resident-list"].children[0];
  resetButton.listeners.click(); resetButton.listeners.click();
  graphics.forEach(graphic => graphicsResources(graphic).forEach(resource => assert.equal(resource.disposals, 0)));
  h.viewer.dispose(); h.viewer.dispose();
  graphics.forEach(assertDisposed);
  assert.equal(button.listeners.click, undefined);
  assert.equal(ui["#resident-list"].children.length, 0);
  assert.equal(ui["#body-labels"].children.length, 0);
  assert.equal(ui["#follow-body"].listeners.click, undefined);
});

test("first observed bounds frame elevated and separated bodies, deltas preserve manual framing, and reset fits current targets", t => {
  const h = harness(t);
  const socket = h.handshake();
  socket.receive(envelope("fullSnapshot", fullPayload([
    entity(1n, { positionMm: { xMm: -25000n, yMm: 8905n, zMm: 0n } }),
    entity(2n, { positionMm: { xMm: 30000n, yMm: 17000n, zMm: 20000n } }),
  ])));
  h.frame();
  assertVectorClose(h.controls.target.toArray(), [2.5, 12.9725, 9.97]);
  assert.equal(shapeParts(h.meshes()[0])[0].material.color.getHex(), 0x0a141e);
  assert.equal(shapeParts(h.meshes()[1])[0].material.color.getHex(), 0x0a141e,
    "equal authoritative colours stay equal despite different body IDs");
  assert.equal(resetButton.disabled, false);
  const grid = h.scene.children.find(child => child.constructor.name === "GridHelper");
  assert.equal(grid.visible, true);
  assert.ok(Math.abs(grid.position.y - 8.475) < 1e-10);
  h.controls.emit("start");
  h.camera.position.set(7, 30, 9);
  h.controls.target.set(2, 8, 5);
  socket.receive(envelope("snapshotDelta", deltaPayload({ modified: [
    entity(1n, { revision: 2n, positionMm: { xMm: 50000n, yMm: 20000n, zMm: -10000n } }),
  ] })));
  assert.deepEqual(h.camera.position.toArray(), [7, 30, 9]);
  assert.deepEqual(h.controls.target.toArray(), [2, 8, 5]);
  assert.match(status.textContent, /delta baseline tick=42/);
  h.canvas.clientWidth = 300;
  h.observers[0].callback();
  assert.equal(h.camera.aspect, 0.5);
  assert.deepEqual(h.camera.position.toArray(), [7, 30, 9], "manual resize does not jump");
  resetButton.listeners.click();
  h.frame();
  assertVectorClose(h.controls.target.toArray(), [40, 18.52, 4.97]);
  assert.notDeepEqual(h.camera.position.toArray(), [7, 30, 9]);
  assert.equal(h.requests().length, 0, "local navigation never sends a world command");
});

test("empty baseline waits for first discovery and automatic framing fits a narrow resize", t => {
  const h = harness(t);
  assert.match(sceneState.textContent, /Connecting/);
  const socket = h.handshake();
  assert.match(sceneState.textContent, /Waiting for the first/);
  socket.receive(envelope("fullSnapshot", fullPayload()));
  assert.match(sceneState.textContent, /No bodies.*scripted aigent/);
  assert.equal(resetButton.disabled, false, "empty Reset can restore automatic discovery");
  socket.receive(envelope("snapshotDelta", deltaPayload({ entered: [
    entity(1n, { positionMm: { xMm: 3000n, yMm: 8905n, zMm: -4000n } }),
  ] })));
  h.frame();
  assertVectorClose(h.controls.target.toArray(), [3, 8.925, -4.03]);
  assert.equal(sceneState.hidden, true);
  const distance = h.camera.position.distanceTo(h.controls.target);
  h.canvas.clientWidth = 150;
  h.observers[0].callback();
  assert.equal(h.camera.aspect, 0.25);
  h.frame();
  assert.ok(h.camera.position.distanceTo(h.controls.target) > distance, "narrow aspect needs greater distance");
  socket.receive(envelope("snapshotDelta", deltaPayload({ leftIds: [1n] })));
  assert.match(sceneState.textContent, /No bodies/);
  assert.equal(resetButton.disabled, false);
});

test("disconnect marks prior observation stale; disposal cancels recovery and releases resources once", t => {
  const h = harness(t);
  const socket = h.handshake();
  socket.receive(envelope("fullSnapshot", fullPayload([entity(1n)])));
  const mesh = h.meshes()[0];
  socket.close();
  assert.match(sceneState.textContent, /Disconnected.*last observation.*Retrying/);
  h.viewer.dispose();
  h.viewer.dispose();
  assertDisposed(mesh);
  assert.equal(h.controls.disposals, 1);
  assert.equal(h.renderer.disposals, 1);
  assert.equal(h.meshes().length, 0);
  assert.equal(h.observers[0].disconnections, 1);
  assert.equal(h.clearedTimers.length, 1);
  assert.equal(h.cancelledFrames.length, 1);
  assert.equal(resetButton.listeners.click, undefined);
  h.timers[0].callback();
  socket.receive(envelope("fullSnapshot", fullPayload([entity(2n)])));
  const disposedStatus = status.textContent;
  socket.emit("error");
  assert.equal(status.textContent, disposedStatus, "late socket errors cannot update a disposed viewer");
  assert.equal(h.sockets.length, 1, "disposed viewer cannot reconnect");
  assertDisposed(mesh);
});

test("actual viewer applies full replacement and entered/modified/left to rendered targets", t => {
  const h = harness(t);
  const socket = h.handshake();
  socket.receive(envelope("fullSnapshot", fullPayload([entity(1n), entity(2n), entity(4n)])));
  const [first, leaving, unchanged] = h.meshes();
  assert.deepEqual([first.position.x, first.position.y, first.position.z], [1.5, 0, -2.25]);
  socket.receive(envelope("snapshotDelta", deltaPayload({
    entered: [entity(3n, { positionMm: { xMm: -2500n, yMm: 500n, zMm: 3000n } })],
    modified: [entity(1n, { revision: 2n, positionMm: { xMm: 3500n, yMm: 1000n, zMm: -250n } })],
    leftIds: [2n],
  })));
  assert.equal(h.meshes().length, 3);
  assert.ok(h.meshes().includes(first));
  assert.ok(h.meshes().includes(unchanged), "absence from delta is not leave");
  assertDisposed(leaving);
  h.frame();
  assert.deepEqual([first.position.x, first.position.y, first.position.z], [1.9, 0.2, -1.85]);
  const entered = h.meshes()[2];
  assert.deepEqual([entered.position.x, entered.position.y, entered.position.z], [-2.5, 0.5, 3]);
  socket.receive(envelope("fullSnapshot", fullPayload([entity(3n)]), 6n));
  assert.equal(h.meshes().length, 1);
  assertDisposed(first);
  assertDisposed(unchanged);
  socket.receive(envelope("fullSnapshot", fullPayload(), 7n));
  assert.equal(h.meshes().length, 0);
  assertDisposed(entered);
  assert.equal(h.requests().length, 0);
});

test("reconnect disposes the prior session and ignores deltas until the new full baseline", t => {
  const h = harness(t);
  const firstSocket = h.handshake();
  firstSocket.receive(envelope("fullSnapshot", fullPayload([entity(1n)])));
  const oldMesh = h.meshes()[0];
  firstSocket.close();
  assert.equal(h.timers.length, 1);
  assert.equal(h.timers[0].delay, 1000);
  h.timers.shift().callback();
  assert.equal(h.meshes().length, 0);
  assertDisposed(oldMesh);
  const secondSocket = h.handshake();
  firstSocket.receive(envelope("fullSnapshot", fullPayload([entity(9n)])));
  firstSocket.emit("close");
  assert.equal(h.meshes().length, 0, "old socket cannot publish into the new session");
  assert.equal(h.timers.length, 0, "old close cannot start an extra reconnect");
  secondSocket.receive(envelope("snapshotDelta", deltaPayload({ entered: [entity(2n)] })));
  assert.equal(h.meshes().length, 0);
  secondSocket.receive(envelope("fullSnapshot", fullPayload([entity(3n)]), 8n, { messageId: 1n }));
  assert.equal(h.meshes().length, 1);
  assert.equal(h.requests(secondSocket).length, 0);
});

test("baseline mismatch sends a read-only resync envelope and blocks deltas until full recovery", t => {
  const h = harness(t);
  const socket = h.handshake();
  socket.receive(envelope("fullSnapshot", fullPayload([entity(1n)])));
  const mesh = h.meshes()[0];
  socket.receive(envelope("snapshotDelta", deltaPayload({ leftIds: [1n] }), 99n));
  assert.equal(h.meshes()[0], mesh);
  assert.match(status.textContent, /baseline mismatch.*requesting full snapshot/);
  assert.equal(h.requests().length, 1);
  const [request] = h.requests();
  assert.equal(request.protocolMajor, 1);
  assert.deepEqual(request.connectionId, connectionId);
  assert.equal(request.messageId, 1n);
  assert.equal(request.body.case, "snapshotResyncRequest");
  socket.receive(envelope("snapshotDelta", deltaPayload({ leftIds: [1n] })));
  assert.equal(h.meshes()[0], mesh);
  assert.equal(h.requests().length, 1);
  socket.receive(envelope("fullSnapshot", fullPayload([entity(2n)]), 6n));
  assertDisposed(mesh);
  socket.receive(envelope("snapshotDelta", deltaPayload({ entered: [entity(3n)] }), 6n));
  assert.equal(h.meshes().length, 2);
});

test("invalid full/delta payloads cannot apply partial updates and request observable recovery", t => {
  const h = harness(t);
  const socket = h.handshake();
  const invalidPayloads = [
    ["fullSnapshot", fullPayload([], { version: 2 })],
    ["fullSnapshot", fullPayload([], { generationDigest: new Uint8Array(31) })],
    ["fullSnapshot", fullPayload([entity(2n), entity(3n, { revision: 0n })])],
    ["snapshotDelta", deltaPayload({ version: 2 })],
    ["snapshotDelta", deltaPayload({ generationDigest: new Uint8Array(33) })],
    ["snapshotDelta", deltaPayload({ entered: [entity(2n)], modified: [entity(3n, { positionMm: { xMm: 100000001n } })], leftIds: [1n] })],
    ["snapshotDelta", Uint8Array.of(8, 1, 18, 32, 0xab)],
    ["fullSnapshot", Uint8Array.of(13, 1, 26, 32, ...digest)],
  ];
  invalidPayloads.forEach(([kind, payload], index) => {
    socket.receive(envelope("fullSnapshot", fullPayload([entity(1n)])));
    const mesh = h.meshes()[0];
    socket.receive(envelope(kind, payload));
    assert.equal(h.meshes().length, 1);
    assert.equal(h.meshes()[0], mesh);
    assert.match(status.textContent, /requesting full snapshot/);
    const request = h.requests().at(-1);
    assert.ok(request);
    assert.equal(request.body.case, "snapshotResyncRequest");
    assert.equal(request.messageId, BigInt(index + 1));
    socket.receive(envelope("snapshotDelta", deltaPayload({ leftIds: [1n] })));
    assert.equal(h.meshes()[0], mesh);
  });
  assert.equal(h.requests().length, invalidPayloads.length);
});

test("malformed envelopes, unsupported protocol majors and server resync signals request full recovery", t => {
  const h = harness(t);
  const socket = h.handshake();
  const messages = [
    Uint8Array.of(0x7f),
    envelope("snapshotDelta", deltaPayload(), 5n, { protocolMajor: 2 }),
    serverEnvelope({ case: "snapshotResyncRequired", value: {} }),
  ];
  messages.forEach((bytes, index) => {
    socket.receive(envelope("fullSnapshot", fullPayload([entity(1n)])));
    socket.receive(bytes);
    assert.match(status.textContent, /requesting full snapshot/);
    assert.equal(h.requests().length, index + 1);
    assert.equal(h.requests().at(-1).body.case, "snapshotResyncRequest");
  });
});

test("delta entity transitions must agree with the current baseline", t => {
  const h = harness(t);
  const socket = h.handshake();
  const invalidTransitions = [
    { entered: [entity(1n)] },
    { modified: [entity(2n)] },
    { leftIds: [2n] },
    { entered: [entity(3n)], modified: [entity(2n)], leftIds: [1n] },
    { entered: [entity(3n)], leftIds: [2n] },
  ];
  invalidTransitions.forEach((transition, index) => {
    socket.receive(envelope("fullSnapshot", fullPayload([entity(1n)])));
    const mesh = h.meshes()[0];
    socket.receive(envelope("snapshotDelta", deltaPayload(transition)));
    assert.equal(h.meshes().length, 1);
    assert.equal(h.meshes()[0], mesh);
    assert.match(status.textContent, /delta entity mismatch.*requesting full snapshot/);
    assert.equal(h.requests().length, index + 1);
  });
});

for (const kind of ["fullSnapshot", "snapshotDelta"]) {
  for (const damage of ["wrong known-field wire type", "nested message boundary overrun"]) {
    test(`malformed ${kind} outer envelope (${damage}) cannot publish valid inner state`, t => {
      const h = harness(t);
      const socket = h.handshake();
      socket.receive(envelope("fullSnapshot", fullPayload([entity(1n)])));
      const mesh = h.meshes()[0];
      const payload = kind === "fullSnapshot" ? fullPayload([entity(2n)]) : deltaPayload({ entered: [entity(2n)] });
      const bytes = envelope(kind, payload);
      let malformed;
      if (damage === "wrong known-field wire type") {
        malformed = bytes.slice();
        malformed[0] = (malformed[0] & ~7) | 5; // protocol_major tagged fixed32, bytes still varint
      } else {
        malformed = shortenMessageBoundary(EnvelopeSchema, bytes, kind);
      }
      socket.receive(malformed);
      assert.equal(h.meshes().length, 1, "malformed outer frame cannot publish inner state");
      assert.equal(h.meshes()[0], mesh);
      assert.match(status.textContent, /malformed frame.*requesting full snapshot/);
      assert.equal(h.requests().length, 1);
    });
  }
}

test("legal unknown metadata fields remain compatible with live snapshots", t => {
  const h = harness(t);
  const socket = h.handshake();
  const bytes = appendUnknownMessageField(EnvelopeSchema, envelope("fullSnapshot", fullPayload([entity(1n)])), "metadata", Uint8Array.of(0xa0, 6, 7));
  socket.receive(bytes);
  assert.equal(h.meshes().length, 1);
  assert.match(status.textContent, /full baseline tick=42 bodies=1/);
  assert.equal(h.requests().length, 0);
});

test("malformed nested metadata framing rejects before feature semantics or state changes", t => {
  const h = harness(t);
  const socket = h.handshake();
  socket.receive(envelope("fullSnapshot", fullPayload([entity(1n)])));
  const mesh = h.meshes()[0];
  const metadata = { requiredFeatures: [{ featureId: "observation 🧭", version: 1 }] };
  const bytes = envelope("fullSnapshot", fullPayload([entity(2n)]), 5n, { metadata });
  const parsed = fromBinary(EnvelopeSchema, bytes);
  assert.equal(parsed.metadata.requiredFeatures[0].featureId, metadata.requiredFeatures[0].featureId);
  assert.equal(parsed.metadata.requiredFeatures[0].version, 1);
  const next = envelope("fullSnapshot", fullPayload([entity(2n)]), 5n, { metadata });
  socket.receive(shortenMessageBoundary(EnvelopeSchema, next, "metadata"));
  assert.equal(h.meshes()[0], mesh, "malformed nested metadata cannot replace state");
  assert.match(status.textContent, /malformed frame.*requesting full snapshot/);
  assert.equal(h.requests().length, 1);
  socket.receive(envelope("fullSnapshot", fullPayload([entity(1n)])));
  socket.receive(wrongNestedFieldWire(EnvelopeSchema, next, ["metadata", "requiredFeatures", "version"], 5));
  assert.equal(h.meshes()[0], mesh, "wrong nested metadata scalar wire type cannot replace state");
  assert.match(status.textContent, /malformed frame.*requesting full snapshot/);
  assert.equal(h.requests().length, 2);
});

for (const [name, transform] of [
  ["wrong message wire type", bytes => { const malformed = bytes.slice(); malformed[0] &= ~7; return malformed; }],
  ["nested message boundary overrun", bytes => shortenMessageBoundary(HandshakeFrameSchema, bytes, "serverHello")],
]) {
  test(`malformed handshake (${name}) cannot establish a session and reconnects`, t => {
    const h = harness(t);
    const socket = h.handshake(undefined, transform);
    assert.equal(socket.readyState, 3, "malformed handshake closes the untrusted session");
    assert.equal(h.timers.length, 1);
    assert.match(status.textContent, /reconnecting/);
    h.timers.shift().callback();
    const recoveredIdentity = new Uint8Array(16).fill(9);
    const recovered = h.handshake(undefined, bytes => bytes, recoveredIdentity);
    recovered.receive(envelope("fullSnapshot", fullPayload([entity(2n)])));
    assert.equal(h.meshes().length, 1);
    assert.equal(h.requests(recovered).length, 0);
    socket.receive(toBinary(HandshakeFrameSchema, create(HandshakeFrameSchema, {
      body: { case: "serverHello", value: { selectedProtocolMajor: 1, connectionId, role: ConnectionRole.VIEWER, mode: ConnectionMode.SPECTATE_ONLY } },
    })));
    socket.emit("close");
    assert.equal(h.timers.length, 0, "corrupted old session cannot start another reconnect");
    recovered.receive(envelope("snapshotDelta", deltaPayload(), 99n));
    assert.deepEqual(h.requests(recovered)[0].connectionId, recoveredIdentity, "recovery uses the new connection identity");
  });
}

for (const kind of ["fullSnapshot", "snapshotDelta"]) {
  for (const [name, overrides] of [
    ["wrong nonempty identity", { connectionId: new Uint8Array(16).fill(9) }],
    ["empty identity", { connectionId: new Uint8Array() }],
    ["zero message ID", { messageId: 0n }],
    ["missing metadata", { metadata: undefined }],
    ["unavailable required feature", { metadata: { requiredFeatures: [{ featureId: "unoffered", version: 1 }] } }],
    ["forbidden client body", { body: { case: "snapshotResyncRequest", value: {} } }],
    ["missing body", { body: { case: undefined } }],
  ]) {
    test(`${kind} rejects semantic envelope defect: ${name}`, t => {
      const h = harness(t);
      const socket = h.handshake();
      socket.receive(envelope("fullSnapshot", fullPayload([entity(1n)])));
      const mesh = h.meshes()[0];
      const payload = kind === "fullSnapshot" ? fullPayload([entity(2n)]) : deltaPayload({ entered: [entity(2n)], leftIds: [1n] });
      socket.receive(envelope(kind, payload, 5n, overrides));
      assert.equal(h.meshes().length, 1);
      assert.equal(h.meshes()[0], mesh, "invalid envelope cannot change visible state");
      assert.match(status.textContent, /invalid envelope.*requesting full snapshot/);
      assert.equal(h.requests().length, 1);
      assert.equal(h.requests()[0].body.case, "snapshotResyncRequest");
    });
  }
  test(`${kind} rejects duplicate message ID before applying state`, t => {
    const h = harness(t);
    const socket = h.handshake();
    socket.receive(envelope("fullSnapshot", fullPayload([entity(1n)]), 5n, { messageId: 50n }));
    const mesh = h.meshes()[0];
    const payload = kind === "fullSnapshot" ? fullPayload([entity(2n)]) : deltaPayload({ entered: [entity(2n)], leftIds: [1n] });
    socket.receive(envelope(kind, payload, 5n, { messageId: 50n }));
    assert.equal(h.meshes().length, 1);
    assert.equal(h.meshes()[0], mesh);
    assert.match(status.textContent, /invalid envelope.*duplicate.*requesting full snapshot/);
    assert.equal(h.requests().length, 1);
  });
}

test("valid distinct message IDs need not be contiguous or increase", t => {
  const h = harness(t);
  const socket = h.handshake();
  socket.receive(envelope("fullSnapshot", fullPayload([entity(1n)]), 5n, { messageId: 50n }));
  socket.receive(envelope("snapshotDelta", deltaPayload({ entered: [entity(2n)] }), 5n, { messageId: 4n }));
  assert.equal(h.meshes().length, 2);
  assert.equal(h.requests().length, 0);
});

test("other legal server observation bodies have no snapshot effect", t => {
  const h = harness(t);
  const socket = h.handshake();
  socket.receive(envelope("fullSnapshot", fullPayload([entity(1n)])));
  const mesh = h.meshes()[0];
  for (const kind of ["protocolError", "percept", "orderedEvent", "eventStreamReset"]) {
    socket.receive(serverEnvelope({ case: kind, value: {} }));
    assert.equal(h.meshes()[0], mesh);
  }
  assert.equal(h.requests().length, 0);
});

for (const [name, invalid] of [
  ["unoffered major", { selectedProtocolMajor: 2 }],
  ["zero major", { selectedProtocolMajor: 0 }],
  ["empty identity", { connectionId: new Uint8Array() }],
  ["unoffered selected feature", { selectedFeatures: [create(FeatureSelectionSchema, { featureId: "unoffered", version: 1 })] }],
  ["command-capable mode", { mode: ConnectionMode.COMMAND_CAPABLE }],
  ["wrong role", { role: ConnectionRole.AIGENT }],
  ["viewer command epoch", { sessionEpoch: new Uint8Array([1]) }],
]) {
  test(`invalid ServerHello (${name}) closes and reconnects without accepting state`, t => {
    const h = harness(t);
    const socket = h.handshake(undefined, bytes => {
      const frame = fromBinary(HandshakeFrameSchema, bytes);
      Object.assign(frame.body.value, invalid);
      return toBinary(HandshakeFrameSchema, frame);
    });
    assert.equal(socket.readyState, 3);
    assert.equal(h.meshes().length, 0);
    assert.equal(h.timers.length, 1);
    h.timers.shift().callback();
    const recovered = h.handshake(undefined, bytes => bytes, new Uint8Array(16).fill(9));
    recovered.receive(envelope("fullSnapshot", fullPayload([entity(1n)])));
    assert.equal(h.meshes().length, 1);
    assert.equal(h.requests(recovered).length, 0);
  });
}

test("message history accepts 65536 IDs then reconnects once with a fresh baseline", t => {
  const h = harness(t);
  const socket = h.handshake();
  socket.receive(envelope("fullSnapshot", fullPayload([entity(1n, { shape: undefined })])));
  const oldMesh = h.meshes()[0];
  const observation = { case: "percept", value: { kind: PerceptKind.HEARD, payload: Uint8Array.of(65) } };
  for (let accepted = 1; accepted < 65536; accepted += 1) socket.receive(serverEnvelope(observation));
  assert.equal(socket.readyState, WebSocket.OPEN, "the 65536th ID remains valid");
  assert.equal(socket.closeCalls, 0);
  assert.equal(h.timers.length, 0);
  assert.equal(h.requests().length, 0);
  socket.receive(serverEnvelope(observation));
  assert.equal(socket.readyState, 3, "the next new ID closes the bounded session");
  assert.equal(socket.closeCalls, 1);
  assert.equal(h.timers.length, 1);
  assert.match(status.textContent, /reconnecting/);
  h.timers.shift().callback();
  assert.equal(h.sockets.length, 2);
  assert.equal(h.meshes().length, 0);
  assertDisposed(oldMesh);
  const recovered = h.handshake(undefined, bytes => bytes, new Uint8Array(16).fill(9));
  recovered.receive(envelope("fullSnapshot", fullPayload([entity(2n, { shape: undefined })]), 8n, { messageId: 1n }));
  assert.equal(h.meshes().length, 1, "new connection may accept IDs from the former session");
  assert.equal(h.requests(recovered).length, 0);
  const newMesh = h.meshes()[0];
  socket.receive(envelope("fullSnapshot", fullPayload([entity(3n)]), 9n));
  socket.emit("close");
  assert.equal(h.meshes()[0], newMesh, "old socket callbacks cannot modify the new baseline");
  assert.equal(h.timers.length, 0, "old close cannot cause another reconnect");
  assert.equal(socket.closeCalls, 1);
  assert.equal(recovered.closeCalls, 0);
});

function boxBody(id, position = [0, 0, 0], size = [2, 2, 2], offset = [0, 0, 0], overrides = {}) {
  const record = entity(id, { positionMm: Object.fromEntries(["xMm", "yMm", "zMm"]
    .map((axis, index) => [axis, BigInt(Math.round(position[index] * 1000))])), ...overrides });
  const root = record.shape.nodes[0];
  record.shape.nodes = [root];
  root.transform.translation = Object.fromEntries(["xMm", "yMm", "zMm"]
    .map((axis, index) => [axis, BigInt(Math.round(offset[index] * 1000))]));
  root.primitive.value = Object.fromEntries(["sizeXMm", "sizeYMm", "sizeZMm"]
    .map((axis, index) => [axis, BigInt(Math.round(size[index] * 1000))]));
  return record;
}

function assertMeshesContained(h) {
  h.camera.updateMatrixWorld(true);
  let vertices = 0;
  for (const root of h.meshes()) {
    root.updateMatrixWorld(true);
    for (const mesh of shapeParts(root)) {
      const position = mesh.geometry.getAttribute("position");
      for (let index = 0; index < position.count; index++) {
        const world = new Vector3().fromBufferAttribute(position, index).applyMatrix4(mesh.matrixWorld);
        const depth = -world.clone().applyMatrix4(h.camera.matrixWorldInverse).z;
        const point = world.project(h.camera);
        assert.ok(point.toArray().every(Number.isFinite), "rendered geometry projects to finite NDC");
        assert.ok(Math.abs(point.x) <= 0.95 + 1e-9 && Math.abs(point.y) <= 0.95 + 1e-9,
          `displayed vertex outside framing margin: ${point.toArray()}`);
        assert.ok(point.z > -1 && point.z < 1, "displayed geometry lies between the actual clip planes");
        assert.ok(h.camera.near < depth && depth < h.camera.far, "actual view depth is retained");
        vertices++;
      }
    }
  }
  assert.ok(vertices > 0, "oracle must inspect installed shape vertices");
}

function pose(h) {
  return { position: h.camera.position.toArray(), target: h.controls.target.toArray(), quaternion: h.camera.quaternion.toArray() };
}

function assertPoseClose(h, expected) {
  assertVectorClose(h.camera.position.toArray(), expected.position);
  assertVectorClose(h.controls.target.toArray(), expected.target);
  assertVectorClose(h.camera.quaternion.toArray(), expected.quaternion);
}

test("automatic camera handlers defer writes and elapsed easing applies the same capped alpha to pivot and distance", t => {
  const h = harness(t), socket = h.handshake(), startup = pose(h);
  socket.receive(envelope("fullSnapshot", fullPayload([boxBody(1n)])));
  assertPoseClose(h, startup);
  h.frame(0);
  assertVectorClose(h.controls.target.toArray(), [0, 0, 0]);
  const initialDistance = h.camera.position.distanceTo(h.controls.target);
  assert.ok(Math.abs(initialDistance - 2.3 * Math.sqrt(12)) < 1e-10);
  socket.receive(envelope("snapshotDelta", deltaPayload({ modified: [boxBody(1n, [20, 0, 0])] })));
  const alpha = -Math.expm1(-0.05 / 0.25), goalDistance = 2.3 * Math.sqrt(152);
  h.frame(50);
  assertVectorClose(h.controls.target.toArray(), [10 * alpha, 0, 0]);
  assert.ok(Math.abs(h.camera.position.distanceTo(h.controls.target)
    - (initialDistance + (goalDistance - initialDistance) * alpha)) < 1e-10, "distance and target share elapsed alpha");
  const before = h.controls.target.x;
  h.frame(5000);
  assert.ok(Math.abs(h.controls.target.x - (before + (10 - before) * -Math.expm1(-0.1 / 0.25))) < 1e-10,
    "a long fresh frame uses the maximum step, not a per-frame constant");
  assertMeshesContained(h);
});

test("manual use before first shapes survives discovery and reconnect; explicit Reset restores automatic discovery", t => {
  const h = harness(t), socket = h.handshake();
  h.controls.emit("start");
  h.camera.position.set(9, 15, 22); h.controls.target.set(3, 4, 5); h.frame(0);
  const manual = pose(h);
  socket.receive(envelope("fullSnapshot", fullPayload([boxBody(1n, [80, 12, -30])] )));
  h.frame(); assertPoseClose(h, manual);
  socket.close(); h.timers.shift().callback();
  const next = h.handshake(h.sockets.at(-1), bytes => bytes, new Uint8Array(16).fill(9));
  next.receive(envelope("fullSnapshot", fullPayload([boxBody(2n, [-90, 0, 30])] )));
  h.frame(); assertPoseClose(h, manual);
  resetButton.listeners.click();
  assertPoseClose(h, manual);
  h.frame(); assertVectorClose(h.controls.target.toArray(), [-90, 0, 30]);
  assertMeshesContained(h);
});

test("same-session resync and departures retain observed history; Reset discards departed history and trails", t => {
  const h = harness(t), socket = h.handshake();
  socket.receive(envelope("fullSnapshot", fullPayload([boxBody(1n, [-100, 0, 0]), boxBody(2n, [100, 0, 0])] )));
  h.frame(0);
  const distance = h.camera.position.distanceTo(h.controls.target);
  socket.receive(envelope("snapshotDelta", deltaPayload({ modified: [boxBody(1n, [0, 0, 0])], leftIds: [2n] })));
  h.frame(50);
  socket.receive(serverEnvelope({ case: "snapshotResyncRequired", value: {} }));
  socket.receive(envelope("fullSnapshot", fullPayload([boxBody(1n)]), 6n));
  for (let index = 0; index < 30; index++) h.frame(100);
  assertVectorClose(h.controls.target.toArray(), [0, 0, 0]);
  assert.ok(Math.abs(h.camera.position.distanceTo(h.controls.target) - distance) < 1e-10,
    "full/resync does not shrink departed or prior applied extents");
  assert.equal(h.lines()[2].geometry.drawRange.count, 2, "the body's trail still includes its old position");
  resetButton.listeners.click(); h.frame();
  assert.ok(Math.abs(h.camera.position.distanceTo(h.controls.target) - 2.3 * Math.sqrt(12)) < 1e-10,
    "Reset uses current shape bounds, excluding history and trail geometry");
  assertMeshesContained(h);
});

test("history grows during manual and follow modes from applied shapes, never aim targets or display roots", t => {
  const h = harness(t, startInstalledControlsViewer), socket = h.handshake();
  socket.receive(envelope("fullSnapshot", fullPayload([boxBody(1n)])));
  h.frame(0); h.controls.emit("start");
  socket.receive(envelope("snapshotDelta", deltaPayload({ modified: [boxBody(1n, [20, 0, 0], [2, 2, 2], [0, 0, 0], { aim: aim(90000000n, 0n) })] })));
  const manualAdmission = h.cameraCalls.filter(call => call.kind === "admit").at(-1);
  assert.deepEqual(manualAdmission.result.history.min.toArray(), [-1, -1, -1]);
  assert.deepEqual(manualAdmission.result.history.max.toArray(), [21, 1, 1]);
  assert.equal(h.meshes()[0].position.x, 0, "history admission precedes interpolation");
  h.choose(1n); ui["#follow-body"].click(); h.frame();
  socket.receive(envelope("snapshotDelta", deltaPayload({ modified: [boxBody(1n, [-30, 0, 0])] })));
  const followingAdmission = h.cameraCalls.filter(call => call.kind === "admit").at(-1);
  assert.deepEqual(followingAdmission.result.history.min.toArray(), [-31, -1, -1]);
  assert.deepEqual(followingAdmission.result.history.max.toArray(), [21, 1, 1]);
  socket.receive(envelope("snapshotDelta", deltaPayload({ leftIds: [1n] })));
  const departure = h.cameraCalls.filter(call => call.kind === "admit").at(-1);
  assert.deepEqual(departure.result.history.min.toArray(), [-31, -1, -1]);
  resetButton.listeners.click();
  assert.equal(h.cameraCalls.filter(call => call.kind === "admit").at(-1).result.history, null);
});

test("far shapeless observations do not frame; empty Reset enables later shaped discovery", t => {
  const h = harness(t, startInstalledControlsViewer), socket = h.handshake(), startup = pose(h);
  socket.receive(envelope("fullSnapshot", fullPayload([entity(1n, { shape: undefined,
    positionMm: { xMm: 90000000n, yMm: 0n, zMm: 0n }, aim: aim(-90000000n, 0n) })])));
  h.frame(0); assertPoseClose(h, startup);
  assert.match(sceneState.textContent, /no shapes to frame/i);
  assert.equal(h.cameraCalls.filter(call => call.kind === "admit").at(-1).result.history, null);
  h.choose(1n); ui["#follow-body"].click(); h.frame();
  assertVectorClose(h.controls.target.toArray(), [90000, 0, 0]);
  socket.receive(envelope("snapshotDelta", deltaPayload({ leftIds: [1n] })));
  const emptyPose = pose(h);
  resetButton.listeners.click();
  assert.equal(ui["#follow-body"].attributes["aria-pressed"], "false");
  h.frame(); assertPoseClose(h, emptyPose);
  socket.receive(envelope("snapshotDelta", deltaPayload({ entered: [boxBody(2n, [4, 2, -3])] })));
  h.frame(); assertVectorClose(h.controls.target.toArray(), [4, 2, -3]);
  assertMeshesContained(h);
  socket.receive(envelope("snapshotDelta", deltaPayload({ entered: [entity(3n, { shape: undefined,
    positionMm: { xMm: -90000000n, yMm: 0n, zMm: 0n } })] })));
  resetButton.listeners.click(); h.frame();
  assertVectorClose(h.controls.target.toArray(), [4, 2, -3]);
  assert.ok(h.camera.position.distanceTo(h.controls.target) < 9, "far identity labels cannot inflate fit");
});

test("stale frames pause easing, resume resets elapsed clock, and explicit stale Reset still snaps", t => {
  const h = harness(t), socket = h.handshake();
  socket.receive(envelope("fullSnapshot", fullPayload([boxBody(1n)]))); h.frame(0);
  socket.receive(envelope("snapshotDelta", deltaPayload({ modified: [boxBody(1n, [20, 0, 0])] })));
  h.frame(50);
  const frozen = h.controls.target.x;
  socket.receive(serverEnvelope({ case: "snapshotResyncRequired", value: {} }));
  h.frame(10000); h.frame(10000);
  assert.equal(h.controls.target.x, frozen);
  assertMeshesContained(h);
  socket.receive(envelope("fullSnapshot", fullPayload([boxBody(1n, [20, 0, 0])]), 6n));
  h.frame(10000);
  assert.equal(h.controls.target.x, frozen, "first resumed frame integrates no stale interval");
  h.frame(25);
  assert.ok(Math.abs(h.controls.target.x - (frozen + (10 - frozen) * -Math.expm1(-0.025 / 0.25))) < 1e-10);
  socket.receive(serverEnvelope({ case: "snapshotResyncRequired", value: {} }));
  resetButton.listeners.click(); h.frame(10000);
  assertVectorClose(h.controls.target.toArray(), [20, 0, 0]);
  h.frame(10000); assertVectorClose(h.controls.target.toArray(), [20, 0, 0]);
  assertMeshesContained(h);
});

for (const [width, height] of [[1600, 900], [800, 600], [300, 600], [150, 600]]) {
  test(`guard contains actual interpolated replacement meshes at aspect ${width}/${height} before labels/render`, t => {
    const h = harness(t), socket = h.handshake();
    h.canvas.clientWidth = width; h.canvas.clientHeight = height; h.observers[0].callback();
    socket.receive(envelope("fullSnapshot", fullPayload([boxBody(1n, [-100, 0, 0])] ))); h.frame(0);
    socket.receive(envelope("snapshotDelta", deltaPayload({ modified: [boxBody(1n, [100, 0, 0], [2, 2, 2], [-50, 0, 0])] })));
    resetButton.listeners.click();
    let renders = 0;
    h.renderer.render = () => { assertMeshesContained(h); renders++; };
    h.frame(0);
    assert.equal(h.meshes()[0].position.x, -60);
    assertVectorClose(h.controls.target.toArray(), [50, 0, 0]);
    assert.ok(h.camera.position.distanceTo(h.controls.target) > 100, "guard uses displayed roots rather than authoritative destinations");
    for (let index = 0; index < 20; index++) h.frame();
    assert.equal(renders, 21);
  });
}

test("replacement display bounds can cross world limits without rejecting valid applied geometry", t => {
  const h = harness(t), socket = h.handshake();
  socket.receive(envelope("fullSnapshot", fullPayload([boxBody(1n, [99998, 0, 0])] ))); h.frame(0);
  socket.receive(envelope("snapshotDelta", deltaPayload({ modified: [boxBody(1n, [99940, 0, 0], [2, 2, 2], [50, 0, 0])] })));
  resetButton.listeners.click(); h.frame();
  assert.ok(h.meshes()[0].position.x + 50 > 100000, "test reaches transient display coordinates outside canonical world limits");
  assert.equal(h.requests().length, 0);
  assert.doesNotMatch(status.textContent, /unavailable/);
  assertMeshesContained(h);
});

test("automatic resize snaps through the display guard even stale; manual and follow resize preserve camera authority", t => {
  const h = harness(t), socket = h.handshake();
  socket.receive(envelope("fullSnapshot", fullPayload([boxBody(1n)]))); h.frame(0);
  socket.receive(envelope("snapshotDelta", deltaPayload({ modified: [boxBody(1n, [100, 0, 0], [20, 40, 10])] })));
  h.frame(1);
  socket.receive(serverEnvelope({ case: "snapshotResyncRequired", value: {} }));
  const before = pose(h);
  h.canvas.clientWidth = 150; h.observers[0].callback(); assertPoseClose(h, before);
  h.frame(10000); assertVectorClose(h.controls.target.toArray(), [54.5, 0, 0]);
  assertMeshesContained(h);
  h.controls.emit("start"); const manual = pose(h);
  h.canvas.clientWidth = 800; h.observers[0].callback(); h.frame(); assertPoseClose(h, manual);
  socket.receive(envelope("fullSnapshot", fullPayload([boxBody(1n, [100, 0, 0], [20, 40, 10])]), 6n));
  for (let index = 0; index < 160; index++) h.frame();
  h.choose(1n); ui["#follow-body"].click(); h.frame(); const followed = pose(h);
  h.canvas.clientWidth = 1600; h.observers[0].callback(); h.frame(); assertPoseClose(h, followed);
});

test("new socket clears automatic history, eased state, pending goal and clock", t => {
  const h = harness(t), socket = h.handshake();
  socket.receive(envelope("fullSnapshot", fullPayload([boxBody(1n)]))); h.frame(0);
  socket.receive(envelope("snapshotDelta", deltaPayload({ modified: [boxBody(1n, [20, 0, 0])] })));
  h.frame(50); socket.close(); h.timers.shift().callback();
  const next = h.handshake(h.sockets.at(-1), bytes => bytes, new Uint8Array(16).fill(10));
  next.receive(envelope("fullSnapshot", fullPayload([boxBody(2n, [300, 0, -200])] )));
  h.frame(10000); assertVectorClose(h.controls.target.toArray(), [300, 0, -200]);
  assert.ok(Math.abs(h.camera.position.distanceTo(h.controls.target) - 2.3 * Math.sqrt(12)) < 1e-10);
  assertMeshesContained(h);
});

test("unexpected pure numerical failure retains pose and pending snap; failed admission cannot leak into later history", t => {
  const h = harness(t, startInstalledControlsViewer), socket = h.handshake();
  socket.receive(envelope("fullSnapshot", fullPayload([boxBody(1n)]))); h.frame(0);
  const previous = pose(h);
  h.camera.fov = NaN;
  socket.receive(envelope("snapshotDelta", deltaPayload({ modified: [boxBody(1n, [100, 0, 0])] })));
  h.frame(50); assertPoseClose(h, previous);
  const failedGoal = h.cameraCalls.filter(call => call.kind === "step").at(-1).input.goal;
  assertVectorClose(failedGoal.target.toArray(), [0, 0, 0]);
  assert.ok(Math.abs(failedGoal.distance - 2.3 * Math.sqrt(12)) < 1e-10,
    "failed admission cannot install a new goal behind the retained pose");
  assert.match(status.textContent, /Automatic framing unavailable/);
  assert.match(sceneState.textContent, /last finite pose/);
  h.camera.fov = 60;
  socket.receive(envelope("snapshotDelta", deltaPayload({ modified: [boxBody(1n)] })));
  h.frame(0); assertVectorClose(h.controls.target.toArray(), [0, 0, 0]);
  assert.deepEqual(h.cameraCalls.filter(call => call.kind === "admit").at(-1).result.history.max.toArray(), [1, 1, 1],
    "failed goal planning did not commit the enlarged history");
  socket.receive(envelope("snapshotDelta", deltaPayload({ modified: [boxBody(1n, [20, 0, 0])] })));
  resetButton.listeners.click(); const beforeSnap = pose(h);
  h.camera.fov = NaN; h.frame(); assertPoseClose(h, beforeSnap);
  assert.match(status.textContent, /unavailable/);
  h.camera.fov = 60; h.frame(0); assertVectorClose(h.controls.target.toArray(), [20, 0, 0]);
  assert.equal(h.cameraCalls.filter(call => call.kind === "step").at(-1).input.snap, true,
    "failed automatic computation leaves the explicit snap pending");
  socket.receive(envelope("snapshotDelta", deltaPayload({ modified: [boxBody(1n, [40, 0, 0])] })));
  h.frame(50);
  h.observers[0].callback();
  const beforeResizeSnap = pose(h);
  h.camera.fov = NaN; h.frame(); assertPoseClose(h, beforeResizeSnap);
  assert.equal(h.cameraCalls.filter(call => call.kind === "step").at(-1).input.snap, true);
  h.camera.fov = 60; h.frame(0);
  assertVectorClose(h.controls.target.toArray(), [30, 0, 0]);
  assert.equal(h.cameraCalls.filter(call => call.kind === "step").at(-1).input.snap, true,
    "failed resize computation retains the pending snap even with an existing eased state");
  assertMeshesContained(h);
});

test("installed OrbitControls observes the eased pivot, updates before the only automatic write, and preserves takeover offsets", t => {
  const h = harness(t, startInstalledControlsViewer), socket = h.handshake();
  assert.equal(h.controls.constructor.name, "OrbitControls");
  assert.equal(h.controls._domElementKeyEvents, null, "keyboard orbit remains inactive");
  const order = [];
  const update = h.controls.update.bind(h.controls), copy = h.controls.target.copy.bind(h.controls.target);
  h.controls.update = (...args) => { order.push("controls"); return update(...args); };
  h.controls.target.copy = value => { order.push("pivot"); return copy(value); };
  h.renderer.render = () => { order.push("render"); assertMeshesContained(h); };
  socket.receive(envelope("fullSnapshot", fullPayload([boxBody(1n)]))); h.frame(0);
  assert.deepEqual(order, ["controls", "pivot", "render"]);
  order.length = 0;
  socket.receive(envelope("snapshotDelta", deltaPayload({ modified: [boxBody(1n, [20, 0, 0])] })));
  h.frame(50);
  assert.deepEqual(order, ["controls", "pivot", "render"]);
  assertVectorClose(h.controls.target.toArray(), [10 * -Math.expm1(-0.05 / 0.25), 0, 0]);
  assertVectorClose(h.controls.target.toArray(), h.cameraCalls.filter(call => call.kind === "step").at(-1).result.state.target.toArray());
  const takeover = pose(h); h.controls.emit("start");
  h.frame(0); assertPoseClose(h, takeover);
  const offset = h.camera.position.clone().sub(h.controls.target), oldPivot = h.controls.target.clone();
  h.choose(1n); ui["#follow-body"].click(); assertPoseClose(h, takeover);
  h.renderer.render = () => {};
  h.frame(0);
  const displayCenter = h.meshes()[0].position.clone();
  const translation = displayCenter.clone().sub(oldPivot);
  assertVectorClose(h.controls.target.toArray(), displayCenter.toArray());
  assertVectorClose(h.camera.position.toArray(), new Vector3(...takeover.position).add(translation).toArray());
  assertVectorClose(h.camera.position.clone().sub(h.controls.target).toArray(), offset.toArray());
  assertVectorClose(h.camera.quaternion.toArray(), takeover.quaternion);
});

test("sub-threshold applied growth accumulates against the envelope without repeated padding or idle drift", t => {
  const h = harness(t, startInstalledControlsViewer), socket = h.handshake();
  socket.receive(envelope("fullSnapshot", fullPayload([boxBody(1n)]))); h.frame(0);
  const distance = h.camera.position.distanceTo(h.controls.target);
  for (const x of [0.1, 0.2]) {
    socket.receive(envelope("snapshotDelta", deltaPayload({ modified: [boxBody(1n, [x, 0, 0])] })));
    h.frame(50);
    assertVectorClose(h.controls.target.toArray(), [0, 0, 0]);
    assert.ok(Math.abs(h.camera.position.distanceTo(h.controls.target) - distance) < 1e-10);
  }
  const small = h.cameraCalls.filter(call => call.kind === "admit").at(-1);
  assert.equal(small.result.history.max.x, 1.2);
  assert.equal(small.result.envelope.max.x, 2);
  socket.receive(envelope("snapshotDelta", deltaPayload({ modified: [boxBody(1n, [0.3, 0, 0])] })));
  h.frame(50);
  assertVectorClose(h.controls.target.toArray(), [0.15 * -Math.expm1(-0.05 / 0.25), 0, 0]);
  const admitted = h.cameraCalls.filter(call => call.kind === "admit").at(-1);
  assert.equal(admitted.result.envelope.max.x, 2.3);
  for (let index = 0; index < 8; index++) {
    socket.receive(envelope("snapshotDelta", deltaPayload({ modified: [boxBody(1n, [0.3, 0, 0])] })));
    h.frame(50);
  }
  assert.equal(h.cameraCalls.filter(call => call.kind === "admit").at(-1).result.envelope.max.x, 2.3,
    "identical observations cannot repad admitted bounds");
});

test("empty display guard retains finite clip planes and shape-free wording after numerical recovery", t => {
  const h = harness(t), socket = h.handshake();
  socket.receive(envelope("fullSnapshot", fullPayload([boxBody(1n)]))); h.frame(0);
  h.camera.fov = NaN; h.frame();
  assert.match(status.textContent, /Automatic framing unavailable/);
  socket.receive(envelope("fullSnapshot", fullPayload([entity(2n, { shape: undefined })]), 6n));
  h.camera.fov = 60; h.frame(0);
  assert.match(sceneState.textContent, /no shapes to frame/i);
  assert.ok([h.camera.near, h.camera.far, ...h.camera.position.toArray()].every(Number.isFinite));
  assert.ok(h.camera.near >= 0.01 && h.camera.far > h.camera.near);
  socket.receive(envelope("fullSnapshot", fullPayload(), 7n)); h.frame();
  assert.match(sceneState.textContent, /No bodies/);
  assert.ok([h.camera.near, h.camera.far].every(Number.isFinite));
});

test("wide valid journey uses actual displayed depths for clip planes while Reset waits for its remote root", t => {
  const h = harness(t), socket = h.handshake();
  socket.receive(envelope("fullSnapshot", fullPayload([boxBody(1n, [-90000, 0, 0])] ))); h.frame(0);
  socket.receive(envelope("snapshotDelta", deltaPayload({ modified: [boxBody(1n, [90000, 0, 0])] })));
  resetButton.listeners.click(); h.frame(0);
  assertVectorClose(h.controls.target.toArray(), [90000, 0, 0]);
  assert.equal(h.meshes()[0].position.x, -54000);
  assert.ok(h.camera.far > 100000, "the clip planes enclose the interpolated root, not the new small goal sphere");
  assertMeshesContained(h);
});

for (const staleReason of ["resync", "disconnect"]) {
  test(`successful framing recovery preserves ${staleReason} status and last-observation wording`, t => {
    const h = harness(t), socket = h.handshake();
    socket.receive(envelope("fullSnapshot", fullPayload([boxBody(1n, [0, 0, 0], [2, 2, 2], [0, 0, 0], { aim: aim() })])));
    h.frame(0); h.choose(1n);
    h.camera.fov = NaN; h.frame();
    assert.match(status.textContent, /Automatic framing unavailable/);
    if (staleReason === "resync") socket.receive(serverEnvelope({ case: "snapshotResyncRequired", value: {} }));
    else socket.close();
    const staleScene = sceneState.textContent, staleStatus = status.textContent;
    h.camera.fov = 60; h.frame(10000);
    assert.equal(sceneState.textContent, staleScene, "valid camera math cannot clear the stale observation banner");
    assert.equal(status.textContent, staleStatus, "valid camera math cannot announce a resumed observation");
    assert.match(ui["#selected-aim"].textContent, /^Last observed movement target/);
    assert.equal(ui["#follow-body"].disabled, true);
    assertMeshesContained(h);
  });
}
