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
import { scenes, cameras, controls, renderers } from "./fake-three.mjs";
import { entity } from "./snapshot-fixtures.mjs";

const hooks = registerHooks({
  resolve(specifier, context, nextResolve) {
    if ((specifier === "three" || specifier === "three/addons/controls/OrbitControls.js") && context.parentURL.endsWith("/src/main.js")) {
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
globalThis.document = { querySelector: selector => ({ "#status": status, "#scene-state": sceneState, "#reset-view": resetButton })[selector] };
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
    meshes: () => scene.children.filter(child => child.isMesh),
    frame: () => animations.shift()(),
    requests: (socket = sockets.at(-1)) => socket.sent.slice(1).map(bytes => fromBinary(EnvelopeSchema, bytes)),
  };
}

function assertDisposed(mesh) {
  assert.equal(mesh.geometry.disposals, 1, "geometry disposed once");
  assert.equal(mesh.material.disposals, 1, "material disposed once");
}

test("first observed bounds frame elevated and separated bodies, deltas preserve manual framing, and reset fits current targets", t => {
  const h = harness(t);
  const socket = h.handshake();
  socket.receive(envelope("fullSnapshot", fullPayload([
    entity(1n, { positionMm: { xMm: -25000n, yMm: 8905n, zMm: 0n } }),
    entity(2n, { positionMm: { xMm: 30000n, yMm: 17000n, zMm: 20000n } }),
  ])));
  assert.deepEqual(h.controls.target.toArray(), [2.5, 12.9525, 10]);
  assert.notEqual(h.meshes()[0].material.color.getHex(), h.meshes()[1].material.color.getHex());
  assert.equal(resetButton.disabled, false);
  const grid = h.scene.children.find(child => child.constructor.name === "GridHelper");
  assert.equal(grid.visible, true);
  assert.ok(Math.abs(grid.position.y - 8.355) < 1e-10);
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
  assert.deepEqual(h.controls.target.toArray(), [40, 18.5, 5]);
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
  assert.deepEqual(h.controls.target.toArray(), [3, 8.905, -4]);
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
  assert.equal(mesh.geometry.disposals, 1, "late socket cannot resurrect disposed state");
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
  assert.match(status.textContent, /live tick=42 bodies=1/);
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
