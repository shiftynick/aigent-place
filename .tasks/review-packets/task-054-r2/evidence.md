## Recorded validation evidence (via task.mjs run)

- task-054 fast subset (rust fmt + clippy + test + server smoke +
  protocol-conformance + workload-harness): PASS, 12.8s.
  `task.mjs run task-054 -- node scripts/product-check.mjs --fast`
- task-054 full gate (npm ci + protocol generate --check + protocol
  TS conformance + viewer build + viewer smoke + viewer real-snapshot
  test): PASS, 15.0s.
  `task.mjs run task-054 -- node scripts/product-check.mjs`

## Recorded per-rubric evidence

### Rubric 1 — Real-body wire payload

- `crates/world-server/src/wire/snapshot.rs::RealEntityRecord` carries
  entity_id, revision, position_mm (sint64 x/y/z), and `shape: Option<ShapeTree>`
  decoded from the entity's `ShapeSlot`.
- `crates/world-server/src/fanout.rs::publish_real_interest_to`
  (line ~830) builds the body from `generation.entities` (the entity
  store snapshot), not from `active_leases`.
- 8 wire-module unit tests in `crates/world-server/src/wire/snapshot.rs`:
  round-trip body, round-trip delta, half-to-even mm, position projection,
  shape decode, empty-slot, version-reject (body and delta). All pass.

### Rubric 2 — Explicit enter/leave

- `WorldSnapshotDeltaProto` (protocol/v1/aigent.proto) has
  `repeated RealEntityRecord entered = 3`, `repeated RealEntityRecord
  modified = 4`, `repeated uint64 left_ids = 5` — explicit, not derived.
- `ConnectionOutbound::refresh_real_interest`
  (crates/world-server/src/fanout.rs:703) builds the diff with three
  disjoint sets; the wire encoder writes all three.
- The viewer decoder test asserts entered and left_ids against the
  fixture (apps/viewer/test/real-snapshot.test.mjs).

### Rubric 3 — Numbered baseline

- `SnapshotChannel` retains the baseline id from the
  `WorldSnapshotBodyProto.generation_digest` field via
  `install_real_full` (the field is set from
  `generation.digest()` — the SHA-256 over the immutable generation).
- `deliver_real_delta` rejects a delta whose baseline_id does not
  match via `delta_rejection`, returning `SnapshotResyncRequired` with
  a typed reason. The live transport path converts that into a
  `SnapshotResyncRequired` envelope (transport.rs:1175).

### Rubric 4 — Replaceable vs ordered coalesce

- The new `publish_real_interest_to` uses
  `OutboundQueue::enqueue_state(..., StateKind::Delta|StateKind::Full)`
  which is the replaceable path. The same `OutboundQueue` keeps
  ordered-event frames separate (`enqueue_event`).
- Workload-harness output shows `aoi_max_delivered=100` and
  `queue_isolated=true` after the ladder profile; the
  outbound_pressure_accounting tests prove coalescing at the
  256 KiB threshold.

### Rubric 5 — Viewer/server shared fixture

- Fixture bytes:
  protocol/v1/conformance/binary/world-snapshot-body.hex (200 hex chars)
  protocol/v1/conformance/binary/world-snapshot-delta.hex (140 hex chars)
- Producer: crates/world-server/src/wire/snapshot.rs::write_conformance_fixtures
  encodes the same `RealEntityRecord`s the live path uses, then writes
  hex. Run on every `cargo test`.
- Consumer: apps/viewer/test/real-snapshot.test.mjs decodes the same
  bytes with a hand-rolled protobuf reader and asserts field-by-field
  equality.
- 3 viewer tests pass; full test suite green.

### Rubric 6 — AOI 100-entity nearest-first

- crates/world-server/src/fanout.rs::aoi_candidates_from_entities reads
  every entity in `generation.entities` and passes the list to
  `truncate_nearest` (the same AOI helper the stub path uses).
- Test: crates/world-server/tests/live_aoi_behavior.rs has 6 tests that
  exercise the live AOI path with a crowd of 150+ bodies; all pass
  after the entity-store migration.

### Rubric 7 — Workload 500 viewers / 256 KiB

- The workload-harness already runs 500 concurrent viewers and reports
  the overflow / coalesce behavior; it is not modified by task-054
  but its output is part of the recorded fast-gate evidence.
- Per-connection byte accounting: `OutboundQueue::enqueue_state` with
  the real frame's measured size; `state_frame_encoded_len_real` is
  the caller-supplied measure used by `transport.rs:303`.
- 7 outbound-pressure tests cover coalescing, sustained overflow,
  resync-notice size accounting, and the 256 KiB threshold.

### Rubric 8 — hold_observe after full resync

- `SnapshotFanout::client_resync_real` (crates/world-server/src/fanout.rs)
  sets `connection.hold_observe = true` after installing a fresh
  baseline; the next publish (which sees the new baseline) takes the
  normal path; the resync handler clears hold_observe after the frame
  is delivered (transport.rs:217).
- Tested in `live_aoi_behavior.rs::socket_resync_request_delivers_the_truncated_set`
  (passes) and `outbound_drain_behavior.rs::drain_delivers_full_snapshot_to_viewer_and_aigent`
  (passes).

### Rubric 9 — Product gate green

- Fast subset PASS (rust fmt + clippy + test + server smoke +
  protocol-conformance + workload-harness) — 12.8s.
- Full gate PASS (npm ci + protocol generate --check + protocol TS
  conformance + viewer build + viewer smoke + viewer real-snapshot
  test) — 15.0s.
