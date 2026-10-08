import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import test from "node:test";
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
import { entity } from "./snapshot-fixtures.mjs";

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
  append(child) { child.parent = this; this.children.push(child); }
  remove() { if (this.parent) this.parent.children = this.parent.children.filter(value => value !== this); }
  click() { if (!this.disabled) this.listeners.click?.(); }
}
const ui = Object.fromEntries(["follow-body", "resident-list", "body-labels", "selected-title", "selected-aim", "selected-position", "observation-status", "resident-count"].map(id => [`#${id}`, new Element()]));
globalThis.document = {
  querySelector: selector => ({ "#status": status, "#scene-state": sceneState, "#reset-view": resetButton, ...ui })[selector],
  createElement: () => new Element(),
};
globalThis.HTMLCanvasElement = class {};
const { startLiveViewer } = await import("../src/main.js");
hooks.deregister();

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

function harness(t) {
  const globals = ["WebSocket", "window", "requestAnimationFrame", "cancelAnimationFrame", "setTimeout", "clearTimeout", "ResizeObserver"];
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
  const canvas = { clientWidth: 800, clientHeight: 600 };
  viewer = startLiveViewer(canvas, "ws://viewer.test/ws");
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
    meshes: () => scene.children.filter(child => child.isGroup).map(child => { graphicsResources(child); return child; }),
    lines: () => scene.children.filter(child => child.isLine),
    choose: id => ui["#resident-list"].children.find(button => button.dataset.bodyId === String(id)).click(),
    frame: () => animations.shift()(),
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
  assertVectorClose(h.controls.target.toArray(), [4.5, 4, -4.25]);
  h.choose(1n); ui["#follow-body"].click(); h.frame();
  assertVectorClose(h.controls.target.toArray(), [4.5, 4, -4.25]);
  const label = ui["#body-labels"].children[0];
  const expected = h.controls.target.clone().set(4.5, 9.15, -4.25).project(h.camera);
  assert.ok(Math.abs(parseFloat(label.style.left) - (expected.x + 1) * h.canvas.clientWidth / 2) < 1e-9);
  assert.ok(Math.abs(parseFloat(label.style.top) - (1 - expected.y) * h.canvas.clientHeight / 2) < 1e-9);
  resetButton.listeners.click();
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
  assert.equal(resetButton.disabled, true);
  socket.receive(envelope("snapshotDelta", deltaPayload({ entered: [
    entity(1n, { positionMm: { xMm: 3000n, yMm: 8905n, zMm: -4000n } }),
  ] })));
  assertVectorClose(h.controls.target.toArray(), [3, 8.925, -4.03]);
  assert.equal(sceneState.hidden, true);
  const distance = h.camera.position.distanceTo(h.controls.target);
  h.canvas.clientWidth = 150;
  h.observers[0].callback();
  assert.equal(h.camera.aspect, 0.25);
  assert.ok(h.camera.position.distanceTo(h.controls.target) > distance, "narrow aspect needs greater distance");
  socket.receive(envelope("snapshotDelta", deltaPayload({ leftIds: [1n] })));
  assert.match(sceneState.textContent, /No bodies/);
  assert.equal(resetButton.disabled, true);
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
