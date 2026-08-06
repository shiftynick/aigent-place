---
id: task-046
title: Introduce the authoritative entity store into the world core
status: review
priority: p0
tags: [milestone:shape-collision-slice, area:server]
blockedBy: []
createdAt: "2026-08-06T13:24:48Z"
updatedAt: "2026-08-06T15:04:07Z"
---

<!-- task-tracker:description -->
## Description

The world core currently holds no spatial entity state: authoritative state is a scalar counter used for replay-equivalence tests, and leases reference a body id that has no position, shape, or revision. Introduce an authoritative entity store holding monotonic entity ids, entity revisions, canonical f64 metre positions, and a shape slot, per ADR-0002 identity and coordinate rules. Ids allocate only on authoritative accept, start at 1, are never reused, and iterate in ascending numeric order. Revisions start at 1 and increment exactly once per accepted externally visible change; rejections and semantic no-ops do not increment. This is the milestone's risk probe: it must not weaken the existing tick machinery. Acceptance: entity state participates in immutable generation publication and generation digests; tentative-tick durable-before-apply ordering still installs only after durable success; same-build replay of a command log still reproduces identical digests with entity state present; out-of-range or non-finite positions are rejected at the boundary; product gate green.

<!-- task-tracker:log -->
## Log

- 2026-08-06T13:24:48Z — created (status: backlog)
- 2026-08-06T14:37:13Z — moved to ready
- 2026-08-06T14:47:07Z — note: rubric: (1) entity ids allocate 1,2,3.. only on authoritative accept; a rejected creation allocates nothing and leaves the allocator unchanged; published iteration is ascending unsigned id (2) revision starts at 1 and increments exactly once per accepted externally visible change; a semantic no-op (same position, same shape slot) and every rejection leave it unchanged; an external mutation at revision u64::MAX-1 rejects REVISION_EXHAUSTED without effect (ADR-0004) (3) non-finite or out-of-[-100000,+100000]-metre components reject at the store boundary with a typed reason and mutate nothing; -0.0 canonicalizes to 0.0 (4) entity table + allocator participate in ImmutableGeneration and change its digest, and are covered by the durable packet integrity digest and codec round-trip (5) with entity commands present the async tentative tick installs entity mutations only after durable success (invisible while tentative, unchanged on writer failure) and recovery restores entities + allocator (6) same-build replay of a log containing entity commands reproduces an identical generation digest; full product gate green
- 2026-08-06T14:47:13Z — moved to in_progress (claimed by shift@Shiftor)
- 2026-08-06T14:59:20Z — note: impl: new crates/world-server/src/entity.rs owns EntityStore (BTreeMap keyed by u64 id, ascending iteration), Position (private finite f64 fields, -0.0 canonicalized), PositionRequest (unvalidated wire-level metres), ShapeSlot, EntityError. Entity state threads through World -> TentativeTick -> ImmutableGeneration -> CommittedGeneration so ADR-0005 durable-before-apply covers it unchanged.
- 2026-08-06T14:59:29Z — note: chose: shape storage is an opaque ShapeSlot(Vec<u8>) of already-encoded ShapeTree bytes rather than the generated prost ShapeTree. Two reasons: (a) task-046 owns storage only, so decoding here would pre-empt task-047 validation and task-048 collider derivation; (b) prost ShapeTree contains f64 quaternion components, so embedding it would force Eq off ImmutableGeneration and CommittedGeneration - a weakening of existing types the risk probe is supposed to avoid.
- 2026-08-06T14:59:32Z — note: chose: Position and PositionRequest implement PartialEq bitwise on the IEEE-754 representation and therefore Eq. Bitwise equality is reflexive even for NaN, so Eq stays sound for the unvalidated request type; Position additionally canonicalizes -0.0 and rejects non-finite values, so bitwise equality coincides with numeric equality there. This keeps CommandEffect/QueuedCommand/ImmutableGeneration/CommittedGeneration Eq exactly as before.
- 2026-08-06T14:59:42Z — note: chose: an entity domain rejection inside a tick is a recorded rejection summary, not a tick failure. world/v1 section 1 makes a domain-level rejection a recorded CommandResult, and ADR-0005 keeps the generation atomic; aborting the tick on a bad coordinate would let one caller stall every other command in the batch. apply_effect still returns Err only for infrastructure failures (RNG).
- 2026-08-06T14:59:45Z — note: chose: durable generation codec version 1 -> 2 to carry the entity table and the id allocator. ADR-0005 requires every id/revision allocator change to share the mutation's transaction, and task-007 cold review already established the precedent that authoritative state omitted from the packet is a defect (leases). No committed journal fixture exists in-repo, and decode rejects an unknown version rather than reinterpreting old bytes, so the change fails closed.
- 2026-08-06T15:00:35Z — note: docs: updated ARCHITECTURE.md section 2 with the EntityStore paragraph (identity, revision, canonical position bound, opaque shape slot, tentative-tick participation, digest coverage). world/v1/CONTRACT.md and the ADRs are normative Step 0 documents describing the target semantics and need no change. Filed task-2748472262000001 for the ADR-0004 terminal forced-sleep transition and recovery diagnostic, which needs the sleep lifecycle that does not exist yet.
- 2026-08-06T15:00:57Z — run: node scripts/product-check.mjs --fast
  started 2026-08-06T15:00:43Z, exit 0 in 13.5s
  output tail (truncated to last 30 lines):
  |     Finished `dev` profile [unoptimized + debuginfo] target(s) in 3.19s
  |    Compiling workload-harness v0.1.0 (N:\aigent-place\.claude\worktrees\wf_478f7fc6-df9-1\crates\workload-harness)
  |    Compiling protocol-conformance v0.1.0 (N:\aigent-place\.claude\worktrees\wf_478f7fc6-df9-1\crates\protocol-conformance)
  |     Finished `test` profile [unoptimized + debuginfo] target(s) in 1.06s
  |      Running unittests src\lib.rs (target\debug\deps\aigent_protocol-2be7322e8a1e4d5b.exe)
  |      Running unittests src\lib.rs (target\debug\deps\protocol_conformance-3437ac2bd595267c.exe)
  |      Running unittests src\main.rs (target\debug\deps\protocol_conformance-4ddea74bf07dca6d.exe)
  |      Running unittests src\lib.rs (target\debug\deps\workload_harness-0593d857cdb62281.exe)
  |      Running unittests src\main.rs (target\debug\deps\workload_harness-9222080f938c770c.exe)
  |      Running unittests src\lib.rs (target\debug\deps\world_server-2d7c22779d6e15e7.exe)
  |      Running unittests src\main.rs (target\debug\deps\world_server-9df5988638f82bfa.exe)
  |      Running tests\aoi_behavior.rs (target\debug\deps\aoi_behavior-49d2af617aab8541.exe)
  |      Running tests\async_writer_behavior.rs (target\debug\deps\async_writer_behavior-ecb874bd312ef40d.exe)
  |      Running tests\core_behavior.rs (target\debug\deps\core_behavior-6198f984276ce85a.exe)
  |      Running tests\entity_store_behavior.rs (target\debug\deps\entity_store_behavior-f10dfe0979eae66c.exe)
  |      Running tests\feature_intersection_behavior.rs (target\debug\deps\feature_intersection_behavior-02eb438a23b9049c.exe)
  |      Running tests\outbound_drain_behavior.rs (target\debug\deps\outbound_drain_behavior-dba27bd415f1fdef.exe)
  |      Running tests\persist_sqlite_behavior.rs (target\debug\deps\persist_sqlite_behavior-c4d71245086ff896.exe)
  |      Running tests\placeholder_payload_behavior.rs (target\debug\deps\placeholder_payload_behavior-5f159efe4496d0c4.exe)
  |      Running tests\reliability_behavior.rs (target\debug\deps\reliability_behavior-7aed9c4b0ea57898.exe)
  |      Running tests\ruleset_persist_behavior.rs (target\debug\deps\ruleset_persist_behavior-20763967ad007f17.exe)
  |      Running tests\scripted_aigent_behavior.rs (target\debug\deps\scripted_aigent_behavior-868f771fe2f3b29c.exe)
  |      Running tests\session_behavior.rs (target\debug\deps\session_behavior-5b3200c9a1bae821.exe)
  |      Running tests\snapshot_behavior.rs (target\debug\deps\snapshot_behavior-38ee57e411957cb0.exe)
  |      Running tests\snapshot_resync_behavior.rs (target\debug\deps\snapshot_resync_behavior-9021b8921bdbaa8b.exe)
  |      Running tests\transport_behavior.rs (target\debug\deps\transport_behavior-514083eccfaa7205.exe)
  |    Doc-tests aigent_protocol
  |    Doc-tests protocol_conformance
  |    Doc-tests workload_harness
  |    Doc-tests world_server
- 2026-08-06T15:01:13Z — moved to review
- 2026-08-06T15:02:06Z — run: node scripts/check.mjs
  started 2026-08-06T15:01:21Z, exit 0 in 44.8s
  output tail (truncated to last 30 lines):
  |      Running tests\persist_sqlite_behavior.rs (target\debug\deps\persist_sqlite_behavior-c4d71245086ff896.exe)
  |      Running tests\placeholder_payload_behavior.rs (target\debug\deps\placeholder_payload_behavior-5f159efe4496d0c4.exe)
  |      Running tests\reliability_behavior.rs (target\debug\deps\reliability_behavior-7aed9c4b0ea57898.exe)
  |      Running tests\ruleset_persist_behavior.rs (target\debug\deps\ruleset_persist_behavior-20763967ad007f17.exe)
  |      Running tests\scripted_aigent_behavior.rs (target\debug\deps\scripted_aigent_behavior-868f771fe2f3b29c.exe)
  |      Running tests\session_behavior.rs (target\debug\deps\session_behavior-5b3200c9a1bae821.exe)
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
- 2026-08-06T15:04:05Z — note: red-capable check (derived-oracle lens): temporarily broke entity.rs twice and observed the expected failures before reverting. (1) allocating the id before position validation in create() -> entity::tests::ids_are_monotonic_and_only_accepted_creation_consumes_one, accepted_creations_allocate_ascending_ids_and_publish_them, and same_build_replay_reproduces_entity_state_and_digest all FAILED. (2) disabling the position no-op short circuit -> entity::tests::revision_increments_once_and_skips_no_ops, rejections_and_no_ops_leave_state_and_revision_unchanged, and same_build_replay_reproduces_entity_state_and_digest all FAILED. Both mutations were reverted and the suite is green again; the recorded gate runs are against the reverted code.
- 2026-08-06T15:04:07Z — note: friction: the first commit attempt used a PowerShell here-string through the Bash tool, so the literal @ delimiters became the commit subject line. Fixed with git reset --soft HEAD~1 plus a fresh commit through the pre-commit hook (no --amend, no --no-verify, nothing pushed); the hook re-ran the fast product subset and passed. Recording it because the mistake is silent - the commit succeeds and only git log --oneline shows the damage.
