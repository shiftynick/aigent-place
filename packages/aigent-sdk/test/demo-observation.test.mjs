import assert from 'node:assert/strict';
import test from 'node:test';
import { create, toBinary } from '@bufbuild/protobuf';
import { WorldSnapshotBodyProtoSchema, WorldSnapshotDeltaProtoSchema } from '@aigent-place/protocol';
import { SnapshotView } from '../src/demo-observation.js';

const record = (entityId = 1n, revision = 1n, xMm = 0n, aim) => ({ entityId, revision, positionMm: { xMm, yMm: 0n, zMm: 0n }, aim });
const full = (bodies = [record()], selfBodyId = 1n, baselineId = 1n) => ({ baselineId, payload: toBinary(WorldSnapshotBodyProtoSchema, create(WorldSnapshotBodyProtoSchema, { version: 1, tick: 1n, generationDigest: new Uint8Array(32), bodies, selfBodyId })) });
const delta = (value, baselineId = 1n) => ({ baselineId, payload: toBinary(WorldSnapshotDeltaProtoSchema, create(WorldSnapshotDeltaProtoSchema, { version: 1, generationDigest: new Uint8Array(32), ...value })) });

test('binding is adopted only from successful full/delta; absence and recovery clear it', () => {
  const view = new SnapshotView();
  view.applyFull(full([record(1n), record(2n)], 2n));
  assert.equal(view.selfBodyId, 2n);
  view.applyDelta(delta({}));
  assert.equal(view.selfBodyId, undefined);
  assert.equal(view.bodies.size, 2);
  view.applyDelta(delta({ selfBodyId: 2n }));
  assert.equal(view.selfBodyId, 2n);
  view.reset();
  assert.equal(view.selfBodyId, undefined);
  assert.equal(view.baselineId, undefined);
  view.applyFull(full([record(2n)], 2n));
  assert.equal(view.selfBodyId, 2n);
  view.reset();
  assert.throws(() => view.applyFull(full([record(1n)], 1n)), error => error.code === 'SELF_BODY_CHANGED');
});

test('a larger cast fails closed with a typed ambiguity error', () => {
  const view = new SnapshotView();
  assert.throws(() => view.applyFull(full([record(1n), record(2n), record(3n)])), error => error.code === 'AMBIGUOUS_CAST');
  assert.equal(view.selfBodyId, undefined);
  assert.equal(view.bodies.size, 0);
});

test('delta changes are atomic through later invalid records and invalid binding', () => {
  const view = new SnapshotView();
  view.applyFull(full([record(1n), record(2n)]));
  const before = view.bodies;
  assert.throws(() => view.applyDelta(delta({ selfBodyId: 1n, leftIds: [2n], modified: [record(8n)] })), /unknown body/);
  assert.equal(view.bodies, before);
  assert.equal(view.bodies.size, 2);
  assert.throws(() => view.applyDelta(delta({ selfBodyId: 0n, modified: [record(1n, 2n, 10n)] })), /self binding/);
  assert.equal(view.bodies, before);
  assert.equal(view.selfBodyId, 1n);
});

test('record, baseline, ID, revision, coordinate and aim boundaries reject invalid data', () => {
  const invalid = [record(0n), record(1n, 0n), record(1n, 1n, 100_000_001n), record(1n, 1n, 0n, { targetXMm: 0n, targetZMm: 0n, speedMmPerS: 0 }), record(1n, 1n, 0n, { targetXMm: 100_000_001n, targetZMm: 0n, speedMmPerS: 1 })];
  for (const body of invalid) assert.throws(() => new SnapshotView().applyFull(full([body])), error => error.code === 'INVALID_OBSERVATION');
  const view = new SnapshotView();
  view.applyFull(full());
  assert.throws(() => view.applyDelta(delta({ selfBodyId: 1n }, 2n)), error => error.code === 'BASELINE_MISMATCH');
  assert.throws(() => view.applyDelta(delta({ modified: [record(1n, 1n, 10n)], selfBodyId: 1n })), /without revision/);
  assert.throws(() => view.applyDelta(delta({ modified: [record(1n, 2n)], leftIds: [1n], selfBodyId: 1n })), /duplicate/);
  view.applyDelta(delta({ modified: [record(1n, 2n, 10n)], selfBodyId: 1n }));
  assert.throws(() => view.applyDelta(delta({ modified: [record(1n, 1n)], selfBodyId: 1n })), /rolls back/);
});

test('metadata-only aims apply/removal at equal revision and unknown fields stay compatible', () => {
  const view = new SnapshotView();
  const snapshot = full();
  snapshot.payload = new Uint8Array([...snapshot.payload, 0xa0, 0x06, 0x01]);
  view.applyFull(snapshot);
  const aim = { targetXMm: 3_000n, targetZMm: 2_000n, speedMmPerS: 500 };
  view.applyDelta(delta({ modified: [record(1n, 1n, 0n, aim)], selfBodyId: 1n }));
  assert.equal(view.bodies.get(1n).aim.targetXMm, 3_000n);
  view.applyDelta(delta({ modified: [record()], selfBodyId: 1n }));
  assert.equal(view.bodies.get(1n).aim, undefined);
});

test('malformed known-field framing is rejected instead of partially decoded', () => {
  const view = new SnapshotView();
  assert.throws(() => view.applyFull({ baselineId: 1n, payload: new Uint8Array([0x0a, 1, 1]) }), /wire type/);
  assert.equal(view.bodies.size, 0);
});
