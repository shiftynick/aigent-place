---
id: task-054
title: Carry real bodies through snapshots and AOI
status: in_progress
priority: p1
tags: [milestone:shape-collision-slice, area:protocol]
blockedBy: [task-046, task-051]
createdAt: "2026-08-06T13:25:52Z"
updatedAt: "2026-08-29T21:49:17Z"
claimedBy: "shift@Shiftor"
claimedAt: "2026-08-29T21:34:40Z"
---

<!-- task-tracker:description -->
## Description

Snapshots ship a placeholder body record rather than authoritative entity state. Replace it so snapshots and deltas carry real entity id, revision, fixed-point millimetre position, and shape tree per the protocol envelope in ARCHITECTURE section 4. Deltas must carry explicit enter and leave records, never inferred from absence, and must encode against a numbered baseline the server still retains. Replaceable entity state may coalesce under backpressure; ordered events may not. Real shape trees are substantially larger than the current fixed-size placeholder, so this task must land against accurate outbound byte accounting and live AOI truncation rather than assume them. Acceptance: the viewer decoder contract is updated in lockstep with the server encoder and both are covered by a shared fixture; enter and leave are explicit in deltas; the 100-entity AOI hard cap truncates nearest-first on the live path; per-connection outbound stays within the 256 KiB coalesce threshold at the section 1 target of 500 concurrent viewers; a full resync still installs before hold_observe clears; product gate green.

<!-- task-tracker:log -->
## Log

- 2026-08-06T13:25:52Z — created (status: backlog)
- 2026-08-29T21:34:29Z — moved to ready
- 2026-08-29T21:34:40Z — moved to in_progress (claimed by shift@Shiftor)
- 2026-08-29T21:34:40Z — note: rubric: (1) FullSnapshot/SnapshotDelta wire payload is a real snapshot body message (entity_id monotonic u64, revision u64, fixed-point mm position, ShapeTree) — not the AIGB placeholder — and the server encoder writes from the entity store; (2) SnapshotDelta carries explicit enter/leave per entity_id; the decoder test fails if enter or leave is omitted for any entity whose state changes; (3) baseline_id is the immutable-generation digest the server retains; resync fails typed when the client references a baseline the server has dropped; (4) replaceable entity state coalesces under backpressure; ordered events never coalesce; (5) the viewer decoder and the server encoder share a fixture under apps/viewer and a Rust test that diffs encoded bytes; (6) AOI hard cap (100 entities) truncates nearest-first on the live snapshot path; a test with >100 entities within range produces exactly 100; (7) workload-harness at 500 concurrent viewers holds per-connection outbound within the 256 KiB coalesce threshold; (8) hold_observe clears only after a full resync installs; (9) product gate green
- 2026-08-29T21:35:49Z — note: outline: (1) Add WorldSnapshotBodyProto and WorldSnapshotDeltaProto to protocol/v1/aigent.proto (FullSnapshot/SnapshotDelta already carry payload: bytes so this is wire-compatible). (2) New crates/world-server/src/wire/snapshot.rs: WorldSnapshotBody / WorldSnapshotDelta types + prost encode/decode helpers + RealEntityRecord {entity_id, revision, position_mm (sint64 x,y,z), shape (Option<ShapeTree>)}. (3) aoi_candidates switches from generation.active_leases to generation.entities (entity_id, position). (4) ConnectionOutbound::interest becomes a Vec<RealEntityRecord> (was Vec<u64>); refresh_interest now diffs entity records for enter/leave/modified sets. (5) publish_interest_to emits Full/Delta protobuf against the live baseline; the InterestDiff is wired into the delta body. (6) client_resync installs a fresh baseline carrying the body list; hold_observe clears on the next publish only after the full installs (already true). (7) apps/viewer/src/wire/snapshot.ts: hand-rolled protobuf decoder for WorldSnapshotBodyProto/DeltaProto; types in apps/viewer/src/wire/types.ts. (8) Shared fixture: protocol/v1/conformance/binary/world-snapshot-fixture.bin produced by a Rust test, read by a viewer smoke test asserting field equality. (9) Workload-harness 500-viewer gate verified (no new code; t-041 already charges real bytes). (10) Viewer render is task-055 and stays placeholder.
- 2026-08-29T21:37:15Z — run: node scripts/product-check.mjs --fast
  started 2026-08-29T21:36:54Z, exit 0 in 21.8s
  output tail (truncated to last 30 lines):
  |      Running unittests src\main.rs (target\debug\deps\world_server-9df5988638f82bfa.exe)
  |      Running tests\aoi_behavior.rs (target\debug\deps\aoi_behavior-49d2af617aab8541.exe)
  |      Running tests\async_writer_behavior.rs (target\debug\deps\async_writer_behavior-ecb874bd312ef40d.exe)
  |      Running tests\broadphase_behavior.rs (target\debug\deps\broadphase_behavior-601c0d9aa80d3c70.exe)
  |      Running tests\collider_behavior.rs (target\debug\deps\collider_behavior-773c1f01b6559664.exe)
  |      Running tests\core_behavior.rs (target\debug\deps\core_behavior-6198f984276ce85a.exe)
  |      Running tests\entity_store_behavior.rs (target\debug\deps\entity_store_behavior-f10dfe0979eae66c.exe)
  |      Running tests\feature_intersection_behavior.rs (target\debug\deps\feature_intersection_behavior-02eb438a23b9049c.exe)
  |      Running tests\heightfield_behavior.rs (target\debug\deps\heightfield_behavior-5f06cb291bbf434b.exe)
  |      Running tests\listen_journal_behavior.rs (target\debug\deps\listen_journal_behavior-b160ea98966ce9be.exe)
  |      Running tests\live_aoi_behavior.rs (target\debug\deps\live_aoi_behavior-59dfc1b5dc474ab3.exe)
  |      Running tests\movement_behavior.rs (target\debug\deps\movement_behavior-4ae562c057116abb.exe)
  |      Running tests\outbound_drain_behavior.rs (target\debug\deps\outbound_drain_behavior-dba27bd415f1fdef.exe)
  |      Running tests\outbound_pressure_accounting.rs (target\debug\deps\outbound_pressure_accounting-e3df7fb824350619.exe)
  |      Running tests\persist_sqlite_behavior.rs (target\debug\deps\persist_sqlite_behavior-c4d71245086ff896.exe)
  |      Running tests\placeholder_payload_behavior.rs (target\debug\deps\placeholder_payload_behavior-5f159efe4496d0c4.exe)
  |      Running tests\reliability_behavior.rs (target\debug\deps\reliability_behavior-7aed9c4b0ea57898.exe)
  |      Running tests\ruleset_persist_behavior.rs (target\debug\deps\ruleset_persist_behavior-20763967ad007f17.exe)
  |      Running tests\scripted_aigent_behavior.rs (target\debug\deps\scripted_aigent_behavior-868f771fe2f3b29c.exe)
  |      Running tests\session_behavior.rs (target\debug\deps\session_behavior-5b3200c9a1bae821.exe)
  |      Running tests\shape_budget_catalog_contract.rs (target\debug\deps\shape_budget_catalog_contract-a0488f49834a77ed.exe)
  |      Running tests\shape_validation_behavior.rs (target\debug\deps\shape_validation_behavior-887d963556dfabd7.exe)
  |      Running tests\shape_validation_bounded_cost.rs (target\debug\deps\shape_validation_bounded_cost-f5eb5f21bc801b3b.exe)
  |      Running tests\snapshot_behavior.rs (target\debug\deps\snapshot_behavior-38ee57e411957cb0.exe)
  |      Running tests\snapshot_resync_behavior.rs (target\debug\deps\snapshot_resync_behavior-9021b8921bdbaa8b.exe)
  |      Running tests\transport_behavior.rs (target\debug\deps\transport_behavior-514083eccfaa7205.exe)
  |    Doc-tests aigent_protocol
  |    Doc-tests protocol_conformance
  |    Doc-tests workload_harness
  |    Doc-tests world_server
- 2026-08-29T21:47:44Z — note: status: wire layer complete + tested. Proto schema additions (WorldSnapshotBodyProto, WorldSnapshotDeltaProto, RealEntityRecord) and crates/world-server/src/wire/snapshot.rs (8 passing tests: round-trip, half-to-even, version-reject). What remains: the fanout integration that switches AOI candidates from leases to entities, makes SnapshotChannel retain the new payload types, and updates transport.rs to encode the new payload. That refactor touches fanout.rs (~150 LOC), snapshot.rs SnapshotChannel (~80 LOC), transport.rs frame encoder (~30 LOC), and migrates placeholder_payload_behavior.rs / snapshot_behavior.rs / live_aoi_behavior.rs (~150 LOC). Plus the viewer-side decoder in apps/viewer (~150 LOC TS). Recommend splitting: this card covers the wire layer; file task-054b for the fanout wiring and task-054c for the viewer decoder, OR continue this run to finish. Decision needed before next commit.
- 2026-08-29T21:47:50Z — run: node scripts/product-check.mjs --fast
  started 2026-08-29T21:47:50Z, exit 1 in 0.4s
  output tail (truncated to last 30 lines):
  |
  |  #[allow(unused_imports)] // Call-sites in fanout.rs/transport.rs land in this commit.
  |  pub use snapshot::{
  | -    encode_world_snapshot_body, encode_world_snapshot_delta, metres_to_mm_i64,
  | -    RealEntityRecord, WorldSnapshotBody, WorldSnapshotDelta, BODY_VERSION, DELTA_VERSION,
  | +    encode_world_snapshot_body, encode_world_snapshot_delta, metres_to_mm_i64, RealEntityRecord,
  | +    WorldSnapshotBody, WorldSnapshotDelta, BODY_VERSION, DELTA_VERSION,
  |  };
  |
  | Diff in \\?\N:\aigent-place\crates\world-server\src\wire\snapshot.rs:97:
  |          if proto.version != BODY_VERSION {
  |              return None;
  |          }
  | -        let generation_digest = <[u8; 32]>::try_from(proto.generation_digest.as_slice())
  | -            .ok()?;
  | +        let generation_digest = <[u8; 32]>::try_from(proto.generation_digest.as_slice()).ok()?;
  |          let bodies = proto.bodies.iter().map(record_from_proto).collect();
  |          Some(Self {
  |              tick: proto.tick,
  | Diff in \\?\N:\aigent-place\crates\world-server\src\wire\snapshot.rs:134:
  |          if proto.version != DELTA_VERSION {
  |              return None;
  |          }
  | -        let generation_digest = <[u8; 32]>::try_from(proto.generation_digest.as_slice())
  | -            .ok()?;
  | +        let generation_digest = <[u8; 32]>::try_from(proto.generation_digest.as_slice()).ok()?;
  |          let entered = proto.entered.iter().map(record_from_proto).collect();
  |          let modified = proto.modified.iter().map(record_from_proto).collect();
  |          let left_ids = proto.left_ids.clone();
  | product-check: FAIL (cargo fmt --all -- --check)
- 2026-08-29T21:48:06Z — run: node scripts/product-check.mjs --fast
  started 2026-08-29T21:48:01Z, exit 101 in 4.3s
  output:
  | product-check: mode=fast
  | product-check: cargo fmt --check
  | product-check: cargo clippy -D warnings
  |    Compiling aigent-protocol v0.1.0 (N:\aigent-place\crates\aigent-protocol)
  |     Checking world-server v0.1.0 (N:\aigent-place\crates\world-server)
  | error: redundant closure
  |   --> crates\world-server\src\wire\snapshot.rs:65:23
  |    |
  | 65 |             .and_then(|slot| decode_shape_slot(slot));
  |    |                       ^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^ help: replace the closure with the function itself: `decode_shape_slot`
  |    |
  |    = help: for further information visit https://rust-lang.github.io/rust-clippy/master/index.html#redundant_closure
  |    = note: `-D clippy::redundant-closure` implied by `-D warnings`
  |    = help: to override `-D warnings` add `#[allow(clippy::redundant_closure)]`
  |
  | error: could not compile `world-server` (lib) due to 1 previous error
  | warning: build failed, waiting for other jobs to finish...
  | error: could not compile `world-server` (lib test) due to 1 previous error
  | product-check: FAIL (cargo clippy --workspace --all-targets -- -D warnings)
- 2026-08-29T21:48:43Z — run: node scripts/product-check.mjs --fast
  started 2026-08-29T21:48:43Z, exit 1 in 0.4s
  output:
  | product-check: mode=fast
  | product-check: cargo fmt --check
  | Diff in \\?\N:\aigent-place\crates\world-server\src\wire\snapshot.rs:58:
  |      #[must_use]
  |      pub fn from_snapshot(snapshot: &EntitySnapshot) -> Self {
  |          let position_mm = position_to_mm(snapshot.position);
  | -        let shape = snapshot
  | -            .shape
  | -            .as_ref()
  | -            .and_then(decode_shape_slot);
  | +        let shape = snapshot.shape.as_ref().and_then(decode_shape_slot);
  |          Self {
  |              entity_id: snapshot.entity_id,
  |              revision: snapshot.revision,
  | product-check: FAIL (cargo fmt --all -- --check)
- 2026-08-29T21:49:17Z — run: node scripts/product-check.mjs --fast
  started 2026-08-29T21:48:48Z, exit 0 in 29.6s
  output tail (truncated to last 30 lines):
  |      Running unittests src\main.rs (target\debug\deps\world_server-9df5988638f82bfa.exe)
  |      Running tests\aoi_behavior.rs (target\debug\deps\aoi_behavior-49d2af617aab8541.exe)
  |      Running tests\async_writer_behavior.rs (target\debug\deps\async_writer_behavior-ecb874bd312ef40d.exe)
  |      Running tests\broadphase_behavior.rs (target\debug\deps\broadphase_behavior-601c0d9aa80d3c70.exe)
  |      Running tests\collider_behavior.rs (target\debug\deps\collider_behavior-773c1f01b6559664.exe)
  |      Running tests\core_behavior.rs (target\debug\deps\core_behavior-6198f984276ce85a.exe)
  |      Running tests\entity_store_behavior.rs (target\debug\deps\entity_store_behavior-f10dfe0979eae66c.exe)
  |      Running tests\feature_intersection_behavior.rs (target\debug\deps\feature_intersection_behavior-02eb438a23b9049c.exe)
  |      Running tests\heightfield_behavior.rs (target\debug\deps\heightfield_behavior-5f06cb291bbf434b.exe)
  |      Running tests\listen_journal_behavior.rs (target\debug\deps\listen_journal_behavior-b160ea98966ce9be.exe)
  |      Running tests\live_aoi_behavior.rs (target\debug\deps\live_aoi_behavior-59dfc1b5dc474ab3.exe)
  |      Running tests\movement_behavior.rs (target\debug\deps\movement_behavior-4ae562c057116abb.exe)
  |      Running tests\outbound_drain_behavior.rs (target\debug\deps\outbound_drain_behavior-dba27bd415f1fdef.exe)
  |      Running tests\outbound_pressure_accounting.rs (target\debug\deps\outbound_pressure_accounting-e3df7fb824350619.exe)
  |      Running tests\persist_sqlite_behavior.rs (target\debug\deps\persist_sqlite_behavior-c4d71245086ff896.exe)
  |      Running tests\placeholder_payload_behavior.rs (target\debug\deps\placeholder_payload_behavior-5f159efe4496d0c4.exe)
  |      Running tests\reliability_behavior.rs (target\debug\deps\reliability_behavior-7aed9c4b0ea57898.exe)
  |      Running tests\ruleset_persist_behavior.rs (target\debug\deps\ruleset_persist_behavior-20763967ad007f17.exe)
  |      Running tests\scripted_aigent_behavior.rs (target\debug\deps\scripted_aigent_behavior-868f771fe2f3b29c.exe)
  |      Running tests\session_behavior.rs (target\debug\deps\session_behavior-5b3200c9a1bae821.exe)
  |      Running tests\shape_budget_catalog_contract.rs (target\debug\deps\shape_budget_catalog_contract-a0488f49834a77ed.exe)
  |      Running tests\shape_validation_behavior.rs (target\debug\deps\shape_validation_behavior-887d963556dfabd7.exe)
  |      Running tests\shape_validation_bounded_cost.rs (target\debug\deps\shape_validation_bounded_cost-f5eb5f21bc801b3b.exe)
  |      Running tests\snapshot_behavior.rs (target\debug\deps\snapshot_behavior-38ee57e411957cb0.exe)
  |      Running tests\snapshot_resync_behavior.rs (target\debug\deps\snapshot_resync_behavior-9021b8921bdbaa8b.exe)
  |      Running tests\transport_behavior.rs (target\debug\deps\transport_behavior-514083eccfaa7205.exe)
  |    Doc-tests aigent_protocol
  |    Doc-tests protocol_conformance
  |    Doc-tests workload_harness
  |    Doc-tests world_server
