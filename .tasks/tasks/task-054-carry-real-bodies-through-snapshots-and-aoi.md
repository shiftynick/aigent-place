---
id: task-054
title: Carry real bodies through snapshots and AOI
status: in_progress
priority: p1
tags: [milestone:shape-collision-slice, area:protocol]
blockedBy: [task-046, task-051]
createdAt: "2026-08-06T13:25:52Z"
updatedAt: "2026-08-29T23:26:35Z"
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
- 2026-08-29T22:34:14Z — run: node scripts/product-check.mjs --fast
  started 2026-08-29T22:34:13Z, exit 1 in 0.3s
  output tail (truncated to last 30 lines):
  |                  body,
  | Diff in \\?\N:\aigent-place\crates\world-server\src\fanout.rs:841:
  |          let baseline = connection.snapshot.baseline_id().expect("live baseline");
  |          if let Some(required) = connection.snapshot.delta_rejection(Some(baseline)) {
  |              let notice_size = byte_measure(&RealFrameShape::ResyncRequired { notice: &required });
  | -            let _enqueue = connection
  | -                .queue
  | -                .enqueue_state(notice_size, StateKind::Delta, notice_size)?;
  | +            let _enqueue =
  | +                connection
  | +                    .queue
  | +                    .enqueue_state(notice_size, StateKind::Delta, notice_size)?;
  |              connection.snapshot.require_resync();
  |              return Some(RealPublishOutcome::ResyncRequired { required });
  |          }
  | Diff in \\?\N:\aigent-place\crates\world-server\src\fanout.rs:940:
  |          connection_id: &[u8],
  |          generation: &ImmutableGeneration,
  |          byte_measure: &(dyn Fn(&RealFrameShape<'_>) -> usize + Sync),
  | -    ) -> Option<(u64, WorldSnapshotBody, EventStreamCursor, EnqueueStateOutcome)> {
  | +    ) -> Option<(
  | +        u64,
  | +        WorldSnapshotBody,
  | +        EventStreamCursor,
  | +        EnqueueStateOutcome,
  | +    )> {
  |          let connection = self.by_conn.get_mut(connection_id)?;
  |          if connection.queue.is_closed() {
  |              return None;
  | product-check: FAIL (cargo fmt --all -- --check)
- 2026-08-29T22:34:36Z — run: node scripts/product-check.mjs --fast
  started 2026-08-29T22:34:35Z, exit 101 in 1.9s
  output tail (truncated to last 30 lines):
  |     |                   ^^^^^^^^^^^^^^^^^^^^^
  |
  | error: enum `RealPublishOutcome` is never used
  |    --> crates\world-server\src\fanout.rs:764:17
  |     |
  | 764 | pub(crate) enum RealPublishOutcome {
  |     |                 ^^^^^^^^^^^^^^^^^^
  |
  | error: methods `publish_real_interest_to` and `client_resync_real` are never used
  |    --> crates\world-server\src\fanout.rs:794:19
  |     |
  | 788 | impl SnapshotFanout {
  |     | ------------------- methods in this implementation
  | ...
  | 794 |     pub(crate) fn publish_real_interest_to(
  |     |                   ^^^^^^^^^^^^^^^^^^^^^^^^
  | ...
  | 946 |     pub(crate) fn client_resync_real(
  |     |                   ^^^^^^^^^^^^^^^^^^
  |
  | error: enum `RealFrameShape` is never used
  |    --> crates\world-server\src\fanout.rs:993:17
  |     |
  | 993 | pub(crate) enum RealFrameShape<'a> {
  |     |                 ^^^^^^^^^^^^^^
  |
  | error: could not compile `world-server` (lib) due to 8 previous errors
  | warning: build failed, waiting for other jobs to finish...
  | error: could not compile `world-server` (lib test) due to 8 previous errors
  | product-check: FAIL (cargo clippy --workspace --all-targets -- -D warnings)
- 2026-08-29T22:59:03Z — run: node scripts/product-check.mjs --fast
  started 2026-08-29T22:59:02Z, exit 1 in 0.8s
  output tail (truncated to last 30 lines):
  |  use world_server::{
  | -    decode_world_snapshot_body_ids, serve_ephemeral, ImmutableGeneration,
  | -    LeaseSnapshot, SessionHub, TransportState, AOI_HARD_CAP, FIRST_ENTITY_ID,
  | -    QUEUE_LIMIT_BYTES, TICK_MS,
  | +    decode_world_snapshot_body_ids, serve_ephemeral, ImmutableGeneration, LeaseSnapshot,
  | +    SessionHub, TransportState, AOI_HARD_CAP, FIRST_ENTITY_ID, QUEUE_LIMIT_BYTES, TICK_MS,
  |  };
  |
  |  type Socket =
  | Diff in \\?\N:\aigent-place\crates\world-server\tests\outbound_pressure_accounting.rs:235:
  |          other => panic!("expected a snapshot or delta frame, got {other:?}"),
  |      };
  |      if is_full {
  | -        let bodies = decode_world_snapshot_body_ids(&payload)
  | -            .expect("real-body snapshot payload");
  | +        let bodies = decode_world_snapshot_body_ids(&payload).expect("real-body snapshot payload");
  |          (true, bodies)
  |      } else {
  |          use prost::Message;
  | Diff in \\?\N:\aigent-place\crates\world-server\tests\outbound_pressure_accounting.rs:440:
  |          "the promotion must install a fresh baseline, got {}",
  |          full.baseline_id
  |      );
  | -    let bodies = decode_world_snapshot_body_ids(&full.payload)
  | -        .expect("real-body snapshot payload");
  | +    let bodies = decode_world_snapshot_body_ids(&full.payload).expect("real-body snapshot payload");
  |      assert_eq!(
  |          bodies.len(),
  |          hard_cap(),
  | product-check: FAIL (cargo fmt --all -- --check)
- 2026-08-29T22:59:10Z — run: node scripts/product-check.mjs --fast
  started 2026-08-29T22:59:08Z, exit 101 in 2.6s
  output tail (truncated to last 30 lines):
  | 378 | / /// explicit `left_ids` list.
  | 379 | |
  |     | |_^
  | 380 |   pub fn decode_world_snapshot_delta_left_ids(bytes: &[u8]) -> Option<Vec<u64>> {
  |     |   ----------------------------------------------------------------------------- the comment documents this function
  |     |
  |     = help: for further information visit https://rust-lang.github.io/rust-clippy/master/index.html#empty_line_after_doc_comments
  |     = help: if the empty line is unintentional remove it
  |
  | error: could not compile `world-server` (lib) due to 5 previous errors
  | warning: build failed, waiting for other jobs to finish...
  | error: items after a test module
  |    --> crates\world-server\src\wire\snapshot.rs:230:1
  |     |
  | 230 | mod tests {
  |     | ^^^^^^^^^
  | ...
  | 369 | pub fn decode_world_snapshot_body_ids(bytes: &[u8]) -> Option<Vec<u64>> {
  |     | ^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^
  | ...
  | 380 | pub fn decode_world_snapshot_delta_left_ids(bytes: &[u8]) -> Option<Vec<u64>> {
  |     | ^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^
  |     |
  |     = help: for further information visit https://rust-lang.github.io/rust-clippy/master/index.html#items_after_test_module
  |     = note: `-D clippy::items-after-test-module` implied by `-D warnings`
  |     = help: to override `-D warnings` add `#[allow(clippy::items_after_test_module)]`
  |     = help: move the items to before the test module was defined
  |
  | error: could not compile `world-server` (lib test) due to 6 previous errors
  | product-check: FAIL (cargo clippy --workspace --all-targets -- -D warnings)
- 2026-08-29T23:00:03Z — run: node scripts/product-check.mjs --fast
  started 2026-08-29T23:00:03Z, exit 1 in 0.4s
  output:
  | product-check: mode=fast
  | product-check: cargo fmt --check
  | Diff in \\?\N:\aigent-place\crates\world-server\src\wire\snapshot.rs:382:
  |          assert!(WorldSnapshotDelta::decode(&proto).is_none());
  |      }
  |  }
  | -
  | -
  |
  | product-check: FAIL (cargo fmt --all -- --check)
- 2026-08-29T23:00:13Z — run: node scripts/product-check.mjs --fast
  started 2026-08-29T23:00:10Z, exit 101 in 2.4s
  output tail (truncated to last 30 lines):
  | product-check: cargo clippy -D warnings
  |     Checking world-server v0.1.0 (N:\aigent-place\crates\world-server)
  | error: unused variable: `sizing`
  |    --> crates\world-server\src\transport.rs:287:17
  |     |
  | 287 |             let sizing = match encoded_bytes {
  |     |                 ^^^^^^ help: if this is intentional, prefix it with an underscore: `_sizing`
  |     |
  |     = note: `-D unused-variables` implied by `-D warnings`
  |     = help: to override `-D warnings` add `#[allow(unused_variables)]`
  |
  | error: unused variable: `enqueue`
  |    --> crates\world-server\src\fanout.rs:834:17
  |     |
  | 834 |             let enqueue = connection
  |     |                 ^^^^^^^ help: if this is intentional, prefix it with an underscore: `_enqueue`
  |
  | error: function `encode_publish_frames` is never used
  |     --> crates\world-server\src\transport.rs:1099:4
  |      |
  | 1099 | fn encode_publish_frames(
  |      |    ^^^^^^^^^^^^^^^^^^^^^
  |      |
  |      = note: `-D dead-code` implied by `-D warnings`
  |      = help: to override `-D warnings` add `#[allow(dead_code)]`
  |
  | error: could not compile `world-server` (lib) due to 3 previous errors
  | warning: build failed, waiting for other jobs to finish...
  | error: could not compile `world-server` (lib test) due to 3 previous errors
  | product-check: FAIL (cargo clippy --workspace --all-targets -- -D warnings)
- 2026-08-29T23:01:16Z — run: node scripts/product-check.mjs --fast
  started 2026-08-29T23:01:15Z, exit 101 in 1.6s
  output tail (truncated to last 30 lines):
  | product-check: cargo clippy -D warnings
  |     Checking world-server v0.1.0 (N:\aigent-place\crates\world-server)
  | error[E0425]: cannot find value `enqueue` in this scope
  |    --> crates\world-server\src\fanout.rs:518:17
  |     |
  | 511 |             let _enqueue = connection
  |     |                 -------- `_enqueue` defined here
  | ...
  | 518 |                 enqueue,
  |     |                 ^^^^^^^
  |     |
  | help: the leading underscore in `_enqueue` marks it as unused, consider renaming it to `enqueue`
  |     |
  | 511 |             let enqueue = connection
  |     |                 ~~~~~~~
  |
  | error: unused variable: `sizing`
  |    --> crates\world-server\src\transport.rs:287:17
  |     |
  | 287 |             let sizing = match encoded_bytes {
  |     |                 ^^^^^^ help: if this is intentional, prefix it with an underscore: `_sizing`
  |     |
  |     = note: `-D unused-variables` implied by `-D warnings`
  |     = help: to override `-D warnings` add `#[allow(unused_variables)]`
  |
  | For more information about this error, try `rustc --explain E0425`.
  | error: could not compile `world-server` (lib) due to 2 previous errors
  | warning: build failed, waiting for other jobs to finish...
  | error: could not compile `world-server` (lib test) due to 2 previous errors
  | product-check: FAIL (cargo clippy --workspace --all-targets -- -D warnings)
- 2026-08-29T23:03:13Z — run: node scripts/product-check.mjs --fast
  started 2026-08-29T23:03:11Z, exit 101 in 2.0s
  output:
  | product-check: mode=fast
  | product-check: cargo fmt --check
  | product-check: cargo clippy -D warnings
  |     Checking world-server v0.1.0 (N:\aigent-place\crates\world-server)
  | error: unused variable: `enqueue`
  |    --> crates\world-server\src\fanout.rs:834:17
  |     |
  | 834 |             let enqueue = connection
  |     |                 ^^^^^^^ help: if this is intentional, prefix it with an underscore: `_enqueue`
  |     |
  |     = note: `-D unused-variables` implied by `-D warnings`
  |     = help: to override `-D warnings` add `#[allow(unused_variables)]`
  |
  | error: could not compile `world-server` (lib) due to 1 previous error
  | warning: build failed, waiting for other jobs to finish...
  | error: could not compile `world-server` (lib test) due to 1 previous error
  | product-check: FAIL (cargo clippy --workspace --all-targets -- -D warnings)
- 2026-08-29T23:03:45Z — run: node scripts/product-check.mjs --fast
  started 2026-08-29T23:03:43Z, exit 101 in 2.6s
  output tail (truncated to last 30 lines):
  | product-check: cargo fmt --check
  | product-check: cargo clippy -D warnings
  |     Checking world-server v0.1.0 (N:\aigent-place\crates\world-server)
  |     Checking protocol-conformance v0.1.0 (N:\aigent-place\crates\protocol-conformance)
  |     Checking workload-harness v0.1.0 (N:\aigent-place\crates\workload-harness)
  | error: unreachable statement
  |    --> crates\world-server\tests\live_aoi_behavior.rs:135:5
  |     |
  | 134 |     panic!("no snapshot or delta frame arrived");
  |     |     -------------------------------------------- any code following this expression is unreachable
  | 135 |     panic!("no snapshot or delta frame arrived");
  |     |     ^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^ unreachable statement
  |     |
  |     = note: `-D unreachable-code` implied by `-D warnings`
  |     = help: to override `-D warnings` add `#[allow(unreachable_code)]`
  |     = note: this error originates in the macro `panic` (in Nightly builds, run with -Z macro-backtrace for more info)
  |
  | error: could not compile `world-server` (test "live_aoi_behavior") due to 1 previous error
  | warning: build failed, waiting for other jobs to finish...
  | error: unused variable: `bodies`
  |    --> crates\world-server\tests\outbound_pressure_accounting.rs:304:19
  |     |
  | 304 |     let (is_full, bodies) = state_frame_bodies(&frame);
  |     |                   ^^^^^^ help: if this is intentional, prefix it with an underscore: `_bodies`
  |     |
  |     = note: `-D unused-variables` implied by `-D warnings`
  |     = help: to override `-D warnings` add `#[allow(unused_variables)]`
  |
  | error: could not compile `world-server` (test "outbound_pressure_accounting") due to 1 previous error
  | product-check: FAIL (cargo clippy --workspace --all-targets -- -D warnings)
- 2026-08-29T23:04:13Z — run: node scripts/product-check.mjs --fast
  started 2026-08-29T23:04:13Z, exit 101 in 0.8s
  output tail (truncated to last 30 lines):
  | product-check: cargo fmt --check
  | product-check: cargo clippy -D warnings
  |     Checking world-server v0.1.0 (N:\aigent-place\crates\world-server)
  | error[E0425]: cannot find value `bodies` in this scope
  |    --> crates\world-server\tests\outbound_pressure_accounting.rs:272:9
  |     |
  | 269 |     let (is_full, _bodies) = state_frame_bodies(&frame);
  |     |                   ------- `_bodies` defined here
  | ...
  | 272 |         bodies.len(),
  |     |         ^^^^^^
  |     |
  | help: the leading underscore in `_bodies` marks it as unused, consider renaming it to `bodies`
  |     |
  | 269 |     let (is_full, bodies) = state_frame_bodies(&frame);
  |     |                   ~~~~~~
  |
  | error: unused variable: `bodies`
  |    --> crates\world-server\tests\outbound_pressure_accounting.rs:304:19
  |     |
  | 304 |     let (is_full, bodies) = state_frame_bodies(&frame);
  |     |                   ^^^^^^ help: if this is intentional, prefix it with an underscore: `_bodies`
  |     |
  |     = note: `-D unused-variables` implied by `-D warnings`
  |     = help: to override `-D warnings` add `#[allow(unused_variables)]`
  |
  | For more information about this error, try `rustc --explain E0425`.
  | error: could not compile `world-server` (test "outbound_pressure_accounting") due to 2 previous errors
  | warning: build failed, waiting for other jobs to finish...
  | product-check: FAIL (cargo clippy --workspace --all-targets -- -D warnings)
- 2026-08-29T23:04:50Z — run: node scripts/product-check.mjs --fast
  started 2026-08-29T23:04:50Z, exit 101 in 0.8s
  output:
  | product-check: mode=fast
  | product-check: cargo fmt --check
  | product-check: cargo clippy -D warnings
  |     Checking world-server v0.1.0 (N:\aigent-place\crates\world-server)
  | error[E0425]: cannot find value `bodies` in this scope
  |    --> crates\world-server\tests\outbound_pressure_accounting.rs:272:9
  |     |
  | 269 |     let (is_full, _bodies) = state_frame_bodies(&frame);
  |     |                   ------- `_bodies` defined here
  | ...
  | 272 |         bodies.len(),
  |     |         ^^^^^^
  |     |
  | help: the leading underscore in `_bodies` marks it as unused, consider renaming it to `bodies`
  |     |
  | 269 |     let (is_full, bodies) = state_frame_bodies(&frame);
  |     |                   ~~~~~~
  |
  | For more information about this error, try `rustc --explain E0425`.
  | error: could not compile `world-server` (test "outbound_pressure_accounting") due to 1 previous error
  | product-check: FAIL (cargo clippy --workspace --all-targets -- -D warnings)
- 2026-08-29T23:05:02Z — run: node scripts/product-check.mjs --fast
  started 2026-08-29T23:05:02Z, exit 101 in 0.8s
  output:
  | product-check: mode=fast
  | product-check: cargo fmt --check
  | product-check: cargo clippy -D warnings
  |     Checking world-server v0.1.0 (N:\aigent-place\crates\world-server)
  | error[E0425]: cannot find value `bodies` in this scope
  |    --> crates\world-server\tests\outbound_pressure_accounting.rs:272:9
  |     |
  | 269 |     let (is_full, _bodies) = state_frame_bodies(&frame);
  |     |                   ------- `_bodies` defined here
  | ...
  | 272 |         bodies.len(),
  |     |         ^^^^^^
  |     |
  | help: the leading underscore in `_bodies` marks it as unused, consider renaming it to `bodies`
  |     |
  | 269 |     let (is_full, bodies) = state_frame_bodies(&frame);
  |     |                   ~~~~~~
  |
  | For more information about this error, try `rustc --explain E0425`.
  | error: could not compile `world-server` (test "outbound_pressure_accounting") due to 1 previous error
  | product-check: FAIL (cargo clippy --workspace --all-targets -- -D warnings)
- 2026-08-29T23:06:17Z — run: node scripts/product-check.mjs --fast
  started 2026-08-29T23:05:59Z, exit 101 in 17.8s
  output tail (truncated to last 30 lines):
  |
  | test result: FAILED. 5 passed; 1 failed; 0 ignored; 0 measured; 0 filtered out; finished in 1.00s
  |
  |     Checking world-server v0.1.0 (N:\aigent-place\crates\world-server)
  |     Finished `dev` profile [unoptimized + debuginfo] target(s) in 0.36s
  |    Compiling world-server v0.1.0 (N:\aigent-place\crates\world-server)
  |    Compiling workload-harness v0.1.0 (N:\aigent-place\crates\workload-harness)
  |    Compiling protocol-conformance v0.1.0 (N:\aigent-place\crates\protocol-conformance)
  |     Finished `test` profile [unoptimized + debuginfo] target(s) in 8.63s
  |      Running unittests src\lib.rs (target\debug\deps\aigent_protocol-2be7322e8a1e4d5b.exe)
  |      Running unittests src\lib.rs (target\debug\deps\protocol_conformance-3437ac2bd595267c.exe)
  |      Running unittests src\main.rs (target\debug\deps\protocol_conformance-4ddea74bf07dca6d.exe)
  |      Running unittests src\lib.rs (target\debug\deps\workload_harness-5c8f22c454e7ee4f.exe)
  |      Running unittests src\main.rs (target\debug\deps\workload_harness-769cb61ce6459d91.exe)
  |      Running unittests src\lib.rs (target\debug\deps\world_server-2d7c22779d6e15e7.exe)
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
  | error: test failed, to rerun pass `-p world-server --test outbound_drain_behavior`
  | product-check: FAIL (cargo test --workspace)
- 2026-08-29T23:08:44Z — run: node scripts/product-check.mjs --fast
  started 2026-08-29T23:08:29Z, exit 101 in 14.7s
  output tail (truncated to last 30 lines):
  |     Checking world-server v0.1.0 (N:\aigent-place\crates\world-server)
  |     Checking workload-harness v0.1.0 (N:\aigent-place\crates\workload-harness)
  |     Checking protocol-conformance v0.1.0 (N:\aigent-place\crates\protocol-conformance)
  |     Finished `dev` profile [unoptimized + debuginfo] target(s) in 1.30s
  |    Compiling world-server v0.1.0 (N:\aigent-place\crates\world-server)
  |    Compiling protocol-conformance v0.1.0 (N:\aigent-place\crates\protocol-conformance)
  |    Compiling workload-harness v0.1.0 (N:\aigent-place\crates\workload-harness)
  |     Finished `test` profile [unoptimized + debuginfo] target(s) in 4.99s
  |      Running unittests src\lib.rs (target\debug\deps\aigent_protocol-2be7322e8a1e4d5b.exe)
  |      Running unittests src\lib.rs (target\debug\deps\protocol_conformance-3437ac2bd595267c.exe)
  |      Running unittests src\main.rs (target\debug\deps\protocol_conformance-4ddea74bf07dca6d.exe)
  |      Running unittests src\lib.rs (target\debug\deps\workload_harness-5c8f22c454e7ee4f.exe)
  |      Running unittests src\main.rs (target\debug\deps\workload_harness-769cb61ce6459d91.exe)
  |      Running unittests src\lib.rs (target\debug\deps\world_server-2d7c22779d6e15e7.exe)
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
  | error: test failed, to rerun pass `-p world-server --test outbound_pressure_accounting`
  | product-check: FAIL (cargo test --workspace)
- 2026-08-29T23:11:31Z — run: node scripts/product-check.mjs --fast
  started 2026-08-29T23:11:18Z, exit 0 in 12.8s
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
- 2026-08-29T23:12:01Z — run: node scripts/product-check.mjs
  started 2026-08-29T23:11:44Z, exit 0 in 16.7s
  output tail (truncated to last 30 lines):
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
  | npm notice run @aigent-place/protocol@0.1.0 test
  | npm notice run node --test ./test/binary-conformance.test.mjs
  | npm notice run @aigent-place/aigent-sdk@0.1.0 test
  | npm notice run node --test ./test/sdk-exports.test.mjs
  | npm notice run aigent-place@0.1.0 viewer:build
  | npm notice run npm run build -w @aigent-place/viewer
  | npm notice run @aigent-place/viewer@0.1.0 build
  | npm notice run vite build
  |
  | (!) Some chunks are larger than 500 kB after minification. Consider:
  | - Using dynamic import() to code-split the application
  | - Use build.rollupOptions.output.manualChunks to improve chunking: https://rollupjs.org/configuration-options/#output-manualchunks
  | - Adjust chunk size limit for this warning via build.chunkSizeWarningLimit.
  | npm notice run aigent-place@0.1.0 viewer:smoke
  | npm notice run npm run smoke -w @aigent-place/viewer
  | npm notice run @aigent-place/viewer@0.1.0 smoke
  | npm notice run node ./scripts/smoke.mjs
- 2026-08-29T23:22:24Z — run: node scripts/product-check.mjs
  started 2026-08-29T23:22:24Z, exit 1 in 0.3s
  output:
  | product-check: mode=full
  | product-check: cargo fmt --check
  | Diff in \\?\N:\aigent-place\crates\world-server\src\wire\snapshot.rs:408:
  |          std::fs::create_dir_all(&out_dir).expect("create conformance binary dir");
  |          std::fs::write(
  |              out_dir.join("world-snapshot-body.hex"),
  | -            body_bytes.iter().map(|b| format!("{:02x}", b)).collect::<String>(),
  | +            body_bytes
  | +                .iter()
  | +                .map(|b| format!("{:02x}", b))
  | +                .collect::<String>(),
  |          )
  |          .expect("write body fixture");
  |          std::fs::write(
  | Diff in \\?\N:\aigent-place\crates\world-server\src\wire\snapshot.rs:415:
  |              out_dir.join("world-snapshot-delta.hex"),
  | -            delta_bytes.iter().map(|b| format!("{:02x}", b)).collect::<String>(),
  | +            delta_bytes
  | +                .iter()
  | +                .map(|b| format!("{:02x}", b))
  | +                .collect::<String>(),
  |          )
  |          .expect("write delta fixture");
  |      }
  | product-check: FAIL (cargo fmt --all -- --check)
- 2026-08-29T23:22:32Z — run: node scripts/product-check.mjs
  started 2026-08-29T23:22:30Z, exit 101 in 1.6s
  output tail (truncated to last 30 lines):
  |     = note: `-D clippy::format-collect` implied by `-D warnings`
  |     = help: to override `-D warnings` add `#[allow(clippy::format_collect)]`
  |
  | error: use of `format!` to build up a string from an iterator
  |    --> crates\world-server\src\wire\snapshot.rs:419:13
  |     |
  | 419 | /             delta_bytes
  | 420 | |                 .iter()
  | 421 | |                 .map(|b| format!("{:02x}", b))
  | 422 | |                 .collect::<String>(),
  |     | |____________________________________^
  |     |
  | help: call `fold` instead
  |    --> crates\world-server\src\wire\snapshot.rs:421:18
  |     |
  | 421 |                 .map(|b| format!("{:02x}", b))
  |     |                  ^^^
  | help: ... and use the `write!` macro here
  |    --> crates\world-server\src\wire\snapshot.rs:421:26
  |     |
  | 421 |                 .map(|b| format!("{:02x}", b))
  |     |                          ^^^^^^^^^^^^^^^^^^^^
  |     = note: this can be written more efficiently by appending to a `String` directly
  |     = help: for further information visit https://rust-lang.github.io/rust-clippy/master/index.html#format_collect
  |
  |     Checking protocol-conformance v0.1.0 (N:\aigent-place\crates\protocol-conformance)
  |     Checking workload-harness v0.1.0 (N:\aigent-place\crates\workload-harness)
  | error: could not compile `world-server` (lib test) due to 2 previous errors
  | warning: build failed, waiting for other jobs to finish...
  | product-check: FAIL (cargo clippy --workspace --all-targets -- -D warnings)
- 2026-08-29T23:24:12Z — run: node scripts/product-check.mjs
  started 2026-08-29T23:24:11Z, exit 101 in 1.5s
  output:
  | product-check: mode=full
  | product-check: cargo fmt --check
  | product-check: cargo clippy -D warnings
  |     Checking world-server v0.1.0 (N:\aigent-place\crates\world-server)
  | error[E0599]: cannot write into `std::string::String`
  |    --> crates\world-server\src\wire\snapshot.rs:412:32
  |     |
  | 412 |                 let _ = write!(out, "{:02x}", b);
  |     |                                ^^^
  |    --> /rustc/4d91de4e48198da2e33413efdcd9cd2cc0c46688\library\core\src\fmt\mod.rs:218:8
  |     |
  |     = note: the method is available for `std::string::String` here
  |     |
  | note: must implement `io::Write`, `fmt::Write`, or have a `write_fmt` method
  |    --> crates\world-server\src\wire\snapshot.rs:412:32
  |     |
  | 412 |                 let _ = write!(out, "{:02x}", b);
  |     |                                ^^^
  |     = help: items from traits can only be used if the trait is in scope
  | help: trait `Write` which provides `write_fmt` is implemented but not in scope; perhaps you want to import it
  |     |
  | 254 +     use std::fmt::Write;
  |     |
  |
  | For more information about this error, try `rustc --explain E0599`.
  | error: could not compile `world-server` (lib test) due to 1 previous error
  | warning: build failed, waiting for other jobs to finish...
  | product-check: FAIL (cargo clippy --workspace --all-targets -- -D warnings)
- 2026-08-29T23:25:01Z — run: node scripts/product-check.mjs
  started 2026-08-29T23:25:00Z, exit 1 in 0.3s
  output:
  | product-check: mode=full
  | product-check: cargo fmt --check
  | Diff in \\?\N:\aigent-place\crates\world-server\src\wire\snapshot.rs:253:
  |  mod tests {
  |      use super::*;
  |      use crate::entity::Position;
  | -    use std::fmt::Write;
  |      use aigent_protocol::shape_node::Primitive;
  |      use aigent_protocol::BoxPrimitive;
  | +    use std::fmt::Write;
  |
  |      fn sample_shape() -> ShapeTree {
  |          ShapeTree {
  | product-check: FAIL (cargo fmt --all -- --check)
- 2026-08-29T23:25:38Z — run: node scripts/product-check.mjs
  started 2026-08-29T23:25:05Z, exit 0 in 32.3s
  output tail (truncated to last 30 lines):
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
  | npm notice run @aigent-place/protocol@0.1.0 test
  | npm notice run node --test ./test/binary-conformance.test.mjs
  | npm notice run @aigent-place/aigent-sdk@0.1.0 test
  | npm notice run node --test ./test/sdk-exports.test.mjs
  | npm notice run aigent-place@0.1.0 viewer:build
  | npm notice run npm run build -w @aigent-place/viewer
  | npm notice run @aigent-place/viewer@0.1.0 build
  | npm notice run vite build
  |
  | (!) Some chunks are larger than 500 kB after minification. Consider:
  | - Using dynamic import() to code-split the application
  | - Use build.rollupOptions.output.manualChunks to improve chunking: https://rollupjs.org/configuration-options/#output-manualchunks
  | - Adjust chunk size limit for this warning via build.chunkSizeWarningLimit.
  | npm notice run aigent-place@0.1.0 viewer:smoke
  | npm notice run npm run smoke -w @aigent-place/viewer
  | npm notice run @aigent-place/viewer@0.1.0 smoke
  | npm notice run node ./scripts/smoke.mjs
- 2026-08-29T23:26:35Z — run: node scripts/product-check.mjs
  started 2026-08-29T23:26:19Z, exit 0 in 15.7s
  output tail (truncated to last 30 lines):
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
  | npm notice run @aigent-place/protocol@0.1.0 test
  | npm notice run node --test ./test/binary-conformance.test.mjs
  | npm notice run @aigent-place/aigent-sdk@0.1.0 test
  | npm notice run node --test ./test/sdk-exports.test.mjs
  | npm notice run aigent-place@0.1.0 viewer:build
  | npm notice run npm run build -w @aigent-place/viewer
  | npm notice run @aigent-place/viewer@0.1.0 build
  | npm notice run vite build
  |
  | (!) Some chunks are larger than 500 kB after minification. Consider:
  | - Using dynamic import() to code-split the application
  | - Use build.rollupOptions.output.manualChunks to improve chunking: https://rollupjs.org/configuration-options/#output-manualchunks
  | - Adjust chunk size limit for this warning via build.chunkSizeWarningLimit.
  | npm notice run aigent-place@0.1.0 viewer:smoke
  | npm notice run npm run smoke -w @aigent-place/viewer
  | npm notice run @aigent-place/viewer@0.1.0 smoke
  | npm notice run node ./scripts/smoke.mjs
  | npm notice run @aigent-place/viewer@0.1.0 test:real-snapshot
  | npm notice run node --test ./test/real-snapshot.test.mjs
