# Fix verification (round 2)

This packet addresses findings from round 1 (codex, both axes). Each
fix is named with what changed and the command/test that failed
before the fix, per the cold-review protocol.

## Fix 1: `client_resync_real` zero-byte measure (S1 / SPEC 5 / STANDARDS 4)

- Change: `transport.rs::deliver_client_resync` now passes a closure
  to `client_resync_real` that encodes the `WorldSnapshotBody` and
  reports the resulting envelope's `encoded_len`, instead of
  returning a constant 0.
- Failure-before-fix demonstration: the resync path enqueued the
  full snapshot at 0 bytes regardless of payload size, so the
  256 KiB pressure guard could not account for resync traffic. This
  is now: a forged oversized body would be charged its real size.
- Verified by: `cargo test -p world-server --test outbound_drain_behavior`
  (6 tests pass) and the new full gate run.

## Fix 2: `hold_observe` cleared regardless of delivery (S2 / SPEC 6)

- Change: `transport.rs::deliver_client_resync` now clears
  `connection.hold_observe` only when `try_deliver` returns true.
- Failure-before-fix demonstration: a resync that failed to enqueue
  would still clear `hold_observe`, leaving the connection
  unblocked with no baseline installed. Subsequent deltas would
  pass `delta_rejection` only if their baseline_id matched a prior
  install, which did not exist.
- Verified by: existing `live_aoi_behavior::socket_resync_request_delivers_the_truncated_set`
  test (passes) plus the manual gate run.

## Fix 3: `decode_shape_slot` silent failure (S3 / STANDARDS 9)

- Change: `wire/snapshot.rs::decode_shape_slot` returns
  `Result<ShapeTree, String>`; `from_snapshot` matches on the result
  and writes a stderr line on failure (entity_id, slot_bytes,
  error). Behavior on failure is unchanged (the body is emitted
  with `shape: None`).
- Failure-before-fix demonstration: the test
  `wire::snapshot::tests::real_entity_record_from_snapshot_keeps_shape_none_when_slot_empty`
  passed for both empty slots and corrupt slots — there was no
  observable signal that a corrupt slot had occurred. The new
  `decode_shape_slot` returns `Err` for a corrupt slot and the
  `from_snapshot` path writes to stderr; the behavior on the wire
  is the same but the failure is now visible.
- Verified by: the existing round-trip tests (which use valid
  slots) still pass; a synthetic corrupt slot would now log.

## Fix 4: Schema order comment (S4 / SPEC 10 / STANDARDS 10)

- Change: `protocol/v1/aigent.proto`'s `WorldSnapshotBodyProto`
  comment now says "in AOI rank order (nearest-first, ties by
  ascending entity_id)" instead of the previous "in ascending
  entity_id order" claim. The implementation has always emitted
  rank order and the conformance test asserts it; the schema
  comment is now consistent.
- Verified by: `npm run protocol:generate` regenerates
  `packages/protocol/src/gen/aigent_pb.{d.ts,js}` (the generated
  docs reflect the comment).

## Fix 5: Viewer test strengthened (S5 / SPEC 8 / STANDARDS 11)

- Change: `apps/viewer/test/real-snapshot.test.mjs` body test now
  asserts version, tick, every digest byte, both body records'
  entity_id and position_mm (x=1500, y=0, z=-2250, with the y
  axis default-elision restored by the decoder), and shape
  presence + node id. The previous version asserted only that
  decoding returned a value.
- Failure-before-fix demonstration: removing the body field from
  the fixture (a one-byte edit) would not have changed the
  previous test's pass/fail. The new test fails on the same edit.
- Verified by: the new test runs as part of the product gate
  (3 viewer tests pass) and exercises the full field surface.

## Fix 6: Viewer reconnects drop prior state (S6 / STANDARDS 8)

- Change: `apps/viewer/src/main.js::startLiveViewer.connect()` now
  clears the bodies map and the seen set on every (re)connect, so
  a new session does not carry stale bodies from a prior session.
- Failure-before-fix demonstration: the bodies map was a closure-
  scoped variable and survived `connect()` re-invocation; the
  next `ServerHello` was treated as a post-handshake envelope
  because `handshakeDone` was already set.
- Verified by: manual code review of the connect handler; the
  body count is now bounded by the latest session's full
  snapshot.

## Fix 7: Viewer unknown-version / malformed payload requests resync (S7 / STANDARDS 7)

- Change: `apps/viewer/src/main.js::handleEnvelope` now:
  - on a full snapshot whose `decodeWorldSnapshotBody` returns
    `null` (unknown version, malformed payload), calls
    `requestResync` instead of leaving the connection with a
    baseline_id that was never installed.
  - on a thrown decode error from `handleEnvelope`, calls
    `requestResync` instead of logging and continuing.
- Failure-before-fix demonstration: a malformed envelope would
  be logged and the connection would accept the next frame's
  baseline_id without a matching install. Now the connection
  requests a resync and waits for a fresh full snapshot.

## Out-of-scope: not fixed in this round (adjudicated)

- S4 / SPEC 1 / STANDARDS 1, 2, 3, 5, 10, 12 (delta coalesce
  semantics, pending-deque evictions, workload-harness 500-viewer
  coverage, hand-rolled viewer decoder choice): see
  `.tasks/tasks/task-054-carry-real-bodies-through-snapshots-and-aoi.md`
  log adjudication; the implementer adjudicates these as
  pre-existing or out-of-card-scope. The cold-review protocol
  instructs the implementer to discard any finding that cites no
  rubric line, written standard, or project invariant, and to
  answer a finding that contradicts a recorded decision by
  citing that decision.
