---
id: task-011
title: Specify replay and persistence ordering contracts
status: done
priority: p0
tags: [area:architecture, milestone:foundations]
blockedBy: [task-025]
createdAt: "2026-07-29T12:55:19Z"
updatedAt: "2026-07-30T17:14:20Z"
---

<!-- task-tracker:description -->
## Description

Write the normative Step 0 contract for canonical command order, seeded randomness, same-build replay, ID assignment, persistence sequencing, idempotency recovery, and bounded writer-queue saturation. Acceptance: every ordering input and queue-full outcome is explicit and executable replay/recovery examples cover success, retry, and interrupted tails.

<!-- task-tracker:log -->
## Log

- 2026-07-29T12:55:19Z — created (status: backlog)
- 2026-07-30T01:23:34Z — note: rubric: (1) A versioned normative contract defines every canonical command-order input, seeded-randomness derivation/consumption rule, and the exact same-build replay boundary. (2) The single-writer sequence explicitly orders validation, ID/revision allocation, mutation/event/result durability, publication, acknowledgements, and queue admission/failure without ambiguous partial effects. (3) Idempotency and ordered-event journal retention, restart reconstruction, and conflict/retry behavior have explicit finite policies consistent with ADR-0001. (4) Versioned executable examples cover accepted success, identical retry, idempotency conflict, crash before/after durable commit, interrupted/corrupt tails, and every bounded writer-queue saturation outcome. (5) Repository documentation links the contract, architecture-significant choices are accepted ADRs before implementation, and focused plus full gates record passing evidence.
- 2026-07-30T01:23:34Z — moved to in_progress (claimed by shift@Shiftor)
- 2026-07-30T01:31:37Z — edited (+tag needs:operator; +blockedBy task-025)
- 2026-07-30T01:31:37Z — note: decision checkpoint: source analysis confirmed that the queue admission cut point, public transient backpressure outcome, atomic durable generation contents, retention constants, corruption policy, and RNG derivation are persisted or wire-visible decisions not fixed by accepted sources. Proposed ADR-0005 recommends one in-flight atomic generation, pre-admission no-effect protocol errors, 24-hour fixed idempotency retention, 24h/4MiB-per-stream/512MiB-global event retention, versioned CRC32C frames plus SHA-256 semantic digests, and counter-based HMAC-SHA-256 draws. The choices are expensive to reverse, so implementation is blocked pending task-025 operator acceptance.
- 2026-07-30T01:31:37Z — moved to blocked
- 2026-07-30T01:31:48Z — run: git diff --check
  started 2026-07-30T01:31:48Z, exit 0 in 0.1s
  output:
  | (no output)
- 2026-07-30T01:32:03Z — run: node scripts/check.mjs
  started 2026-07-30T01:31:48Z, exit 0 in 14.5s
  output tail (truncated to last 30 lines):
  |     # Subtest: soft-deletes by setting status=done and adding deleted:true tag
  |     ok 1 - soft-deletes by setting status=done and adding deleted:true tag
  |       ---
  |       duration_ms: 118.5095
  |       type: 'test'
  |       ...
  |     # Subtest: keeps dependents blocked when their blocker is soft-deleted
  |     ok 2 - keeps dependents blocked when their blocker is soft-deleted
  |       ---
  |       duration_ms: 334.9305
  |       type: 'test'
  |       ...
  |     1..2
  | ok 121 - task rm
  |   ---
  |   duration_ms: 453.5456
  |   type: 'suite'
  |   ...
  | 1..121
  | # tests 289
  | # suites 62
  | # pass 289
  | # fail 0
  | # cancelled 0
  | # skipped 0
  | # todo 0
  | # duration_ms 13863.0493
  |
  | run-checks: PASS (skill-sync + 14 suites)
  | process-docs: PASS (no unresolved markers in scoped non-binary files)
- 2026-07-30T11:54:07Z — note: operator explicitly accepted ADR-0005 as proposed on 2026-07-30. The decision condition is resolved; task-011 remains dependency-blocked only until task-025 completes protected delivery.
- 2026-07-30T11:56:39Z — edited (-tag needs:operator)
- 2026-07-30T11:59:56Z — moved to backlog
- 2026-07-30T11:59:56Z — moved to in_progress (claimed by shift@Shiftor)
- 2026-07-30T11:59:56Z — note: resumed after task-025 merged: accepted ADR-0005 now governs durable generations, persistence backpressure, retention, crash recovery, semantic digests, and counter-based RNG. This clean branch starts from current origin/main.
- 2026-07-30T12:20:46Z — note: Implemented the ADR-0005 replay/persistence contract, protocol carrier additions, executable semantic fixtures, exact application-frame and RNG derivations, retention/resume behavior, crash-boundary recovery, and README/gate integration. The compact fixture evaluator uses canonical JSON only as a semantic stand-in when payload_bytes is absent; generated protobuf bytes remain the normative digest input and task-004 owns replacing the stand-in.
- 2026-07-30T12:21:02Z — run: node scripts/check.mjs
  started 2026-07-30T12:20:46Z, exit 0 in 16.5s
  output tail (truncated to last 30 lines):
  |     # Subtest: soft-deletes by setting status=done and adding deleted:true tag
  |     ok 1 - soft-deletes by setting status=done and adding deleted:true tag
  |       ---
  |       duration_ms: 140.2623
  |       type: 'test'
  |       ...
  |     # Subtest: keeps dependents blocked when their blocker is soft-deleted
  |     ok 2 - keeps dependents blocked when their blocker is soft-deleted
  |       ---
  |       duration_ms: 348.5989
  |       type: 'test'
  |       ...
  |     1..2
  | ok 121 - task rm
  |   ---
  |   duration_ms: 488.9719
  |   type: 'suite'
  |   ...
  | 1..121
  | # tests 289
  | # suites 62
  | # pass 289
  | # fail 0
  | # cancelled 0
  | # skipped 0
  | # todo 0
  | # duration_ms 15752.4225
  |
  | run-checks: PASS (skill-sync + 14 suites)
  | process-docs: PASS (no unresolved markers in scoped non-binary files)
- 2026-07-30T12:21:03Z — run: git diff --check
  started 2026-07-30T12:21:03Z, exit 0 in 0.1s
  output:
  | (no output)
- 2026-07-30T12:21:03Z — moved to review
- 2026-07-30T12:26:33Z — moved to in_progress (claimed by shift@Shiftor)
- 2026-07-30T12:26:33Z — note: cold review round 1, rung 2: SPEC and STANDARDS both FAIL. Material findings: generation-local tentative cursors; distinct per-session sequence-result ledger and cross-epoch idempotency map; session epoch reset/reconnect cases; exact frame and contiguous-generation validation; checkpoint-plus-suffix cold reconstruction; canonical event eviction/reset/publication; complete RNG audit vectors; uint64/inclusive capacity boundaries; exact-key replay; later oversize classification; collision-free byte identity scopes; full event cursor validation. Implementation resumed; no finding waived.
- 2026-07-30T12:41:03Z — note: round-1 findings resolved: generation-local cursors now advance incrementally; durable per-session result rows are distinct from cross-epoch keys and replay durable rejections; new epochs reset sequence while exact-key aliases avoid duplicate effects; uint64 and inclusive/oversize boundaries are tested; frame validation covers magic/version/type/length/projection/CRC/ordinal/generation/partial-commit and detached checkpoint suffixes rebuild world/cursors/keys/events/RNG; event eviction/reset/cursor and post-result crash delivery are executable; RNG covers full HMAC blocks, forced rejection, spatial scope, invariance, and bounds; live-epoch retention/release is explicit. No review finding waived.
- 2026-07-30T12:41:20Z — run: node scripts/check.mjs
  started 2026-07-30T12:41:03Z, exit 0 in 16.5s
  output tail (truncated to last 30 lines):
  |     # Subtest: soft-deletes by setting status=done and adding deleted:true tag
  |     ok 1 - soft-deletes by setting status=done and adding deleted:true tag
  |       ---
  |       duration_ms: 123.1705
  |       type: 'test'
  |       ...
  |     # Subtest: keeps dependents blocked when their blocker is soft-deleted
  |     ok 2 - keeps dependents blocked when their blocker is soft-deleted
  |       ---
  |       duration_ms: 334.3179
  |       type: 'test'
  |       ...
  |     1..2
  | ok 121 - task rm
  |   ---
  |   duration_ms: 457.5943
  |   type: 'suite'
  |   ...
  | 1..121
  | # tests 289
  | # suites 62
  | # pass 289
  | # fail 0
  | # cancelled 0
  | # skipped 0
  | # todo 0
  | # duration_ms 15726.6472
  |
  | run-checks: PASS (skill-sync + 14 suites)
  | process-docs: PASS (no unresolved markers in scoped non-binary files)
- 2026-07-30T12:41:20Z — run: git diff --check
  started 2026-07-30T12:41:20Z, exit 0 in 0.1s
  output:
  | (no output)
- 2026-07-30T12:41:20Z — moved to review
- 2026-07-30T12:45:50Z — moved to in_progress (claimed by shift@Shiftor)
- 2026-07-30T12:45:50Z — note: cold review round 2, rung 2: SPEC and STANDARDS FAIL. Remaining blocking findings: lossless opaque-byte identity fields; canonical-prefix handling around oversized records; capacity from exact projected frames; scratch/rollback cold reconstruction and independent running-build match; checkpoint+1 suffix and derived torn-tail classification; recovered RNG re-derivation; durable command digest preimage; contiguous visible event ranges and mandatory never-reused epochs; lossless u64 recovery/checkpoint completeness; live-key references/finite eviction; cold post-result event recovery; non-decreasing commit clock. Final review round will follow; no finding waived.
- 2026-07-30T13:03:36Z — note: round-2 and adversarial follow-up findings resolved without waiver: explicit opaque-byte session epochs; canonical oversize prefix; exact encoded-frame projections; detached atomic recovery with independent build binding; raw tail classification; full checkpoint/u64/event validation; durable preimages and live-key retention; cold post-result replay; monotonic commit time; unconditional full RNG block audit; and independently hashed raw payload bytes plus decoded projection. Added focused cases for each remaining edge.
- 2026-07-30T13:03:53Z — run: node scripts/check.mjs
  started 2026-07-30T13:03:36Z, exit 0 in 17.2s
  output tail (truncated to last 30 lines):
  |     # Subtest: soft-deletes by setting status=done and adding deleted:true tag
  |     ok 1 - soft-deletes by setting status=done and adding deleted:true tag
  |       ---
  |       duration_ms: 117.2998
  |       type: 'test'
  |       ...
  |     # Subtest: keeps dependents blocked when their blocker is soft-deleted
  |     ok 2 - keeps dependents blocked when their blocker is soft-deleted
  |       ---
  |       duration_ms: 298.0615
  |       type: 'test'
  |       ...
  |     1..2
  | ok 121 - task rm
  |   ---
  |   duration_ms: 415.4802
  |   type: 'suite'
  |   ...
  | 1..121
  | # tests 289
  | # suites 62
  | # pass 289
  | # fail 0
  | # cancelled 0
  | # skipped 0
  | # todo 0
  | # duration_ms 16435.8367
  |
  | run-checks: PASS (skill-sync + 14 suites)
  | process-docs: PASS (no unresolved markers in scoped non-binary files)
- 2026-07-30T13:03:53Z — run: git diff --check
  started 2026-07-30T13:03:53Z, exit 0 in 0.1s
  output:
  | (no output)
- 2026-07-30T13:03:53Z — moved to review
- 2026-07-30T13:07:15Z — note: cold review round 3/3, rung 2: SPEC and STANDARDS FAIL; task is blocked under the execute-task retry limit and no finding is waived. Reproducible blockers: raw recovery payload representation is UTF-8-only rather than lossless arbitrary bytes; malformed or incomplete RNG audit evidence can commit and only fail on restart; event epoch/sequence/ack allocator state is not full uint64-safe; RNG scope accepts missing or simultaneous generation/spatial scopes instead of exactly one. Focused tests (15/15), full gate (62 product/process + 289 installed), and diff-check pass but do not cover these defects. Uncommitted branch work is preserved for a deliberate remediation decision.
- 2026-07-30T13:07:15Z — moved to blocked
- 2026-07-30T13:12:40Z — note: operator authorized a fresh remediation cycle after the round-3 blocker. Remediation rubric: (1) exact recovery payload bytes are represented losslessly for all octets and length/hash/CRC operate on decoded bytes; (2) commit re-derives and validates every RNG audit, persists the full derived block evidence, and rejects incomplete evidence before generation commit; (3) RNG input requires exactly one explicit generation or spatial scope; (4) event epoch, sequence, acknowledgement, and allocator state accept the complete uint64 range, reject overflow, and fail deterministically on exhausted allocation; (5) focused regression tests, the full gate, and fresh cold SPEC/STANDARDS reviews pass with no material finding.
- 2026-07-30T13:12:40Z — moved to backlog
- 2026-07-30T13:12:40Z — moved to in_progress (claimed by codex-task011-remediation)
- 2026-07-30T13:22:35Z — note: fresh remediation implemented: frame fixtures now carry lowercase payload_hex and all length/hash/CRC checks use decoded bytes, including a non-UTF-8 vector; commit performs a no-mutation preflight that validates and re-derives complete RNG audits and event allocator capacity; RNG requires exactly one explicit scope; event cursor state is normalized to uint64 decimal strings with null exhaustion sentinels and BigInt comparisons; checkpoints now require next stream epoch and global event ordinal so restart cannot reuse allocator state. Focused adversarial verification found no remaining reproduction.
- 2026-07-30T13:22:36Z — run: node --test scripts/replay-contract.test.mjs
  started 2026-07-30T13:22:35Z, exit 0 in 0.2s
  output tail (truncated to last 30 lines):
  |   duration_ms: 0.8345
  |   type: 'test'
  |   ...
  | # Subtest: event epochs are mandatory and reset allocation never fills historical gaps
  | ok 15 - event epochs are mandatory and reset allocation never fills historical gaps
  |   ---
  |   duration_ms: 0.2093
  |   type: 'test'
  |   ...
  | # Subtest: event cursors cover uint64 maxima and allocator exhaustion is deterministic
  | ok 16 - event cursors cover uint64 maxima and allocator exhaustion is deterministic
  |   ---
  |   duration_ms: 0.5638
  |   type: 'test'
  |   ...
  | # Subtest: semantic oracle has no wall-clock, network, or ambient-random dependency
  | ok 17 - semantic oracle has no wall-clock, network, or ambient-random dependency
  |   ---
  |   duration_ms: 0.4858
  |   type: 'test'
  |   ...
  | 1..17
  | # tests 17
  | # suites 0
  | # pass 17
  | # fail 0
  | # cancelled 0
  | # skipped 0
  | # todo 0
  | # duration_ms 149.481
- 2026-07-30T13:22:36Z — run: git diff --check
  started 2026-07-30T13:22:36Z, exit 0 in 0.1s
  output:
  | (no output)
- 2026-07-30T13:22:56Z — run: node scripts/check.mjs
  started 2026-07-30T13:22:39Z, exit 0 in 17.2s
  output tail (truncated to last 30 lines):
  |     # Subtest: soft-deletes by setting status=done and adding deleted:true tag
  |     ok 1 - soft-deletes by setting status=done and adding deleted:true tag
  |       ---
  |       duration_ms: 173.7028
  |       type: 'test'
  |       ...
  |     # Subtest: keeps dependents blocked when their blocker is soft-deleted
  |     ok 2 - keeps dependents blocked when their blocker is soft-deleted
  |       ---
  |       duration_ms: 344.7897
  |       type: 'test'
  |       ...
  |     1..2
  | ok 121 - task rm
  |   ---
  |   duration_ms: 518.6012
  |   type: 'suite'
  |   ...
  | 1..121
  | # tests 289
  | # suites 62
  | # pass 289
  | # fail 0
  | # cancelled 0
  | # skipped 0
  | # todo 0
  | # duration_ms 16484.0994
  |
  | run-checks: PASS (skill-sync + 14 suites)
  | process-docs: PASS (no unresolved markers in scoped non-binary files)
- 2026-07-30T13:23:26Z — moved to review
- 2026-07-30T13:23:52Z — note: cold review remediation round 1: rung 1 counterpart CLI attempted with separate SPEC/STANDARDS calls but Claude weekly quota was exhausted before review. Descending to rung 2 fresh context-free subagents per docs/SDLC.md; no review result was counted from rung 1.
- 2026-07-30T13:30:51Z — moved to in_progress (claimed by shift@Shiftor)
- 2026-07-30T13:30:52Z — note: fresh remediation cold review round 1, rung 2: SPEC and STANDARDS FAIL. Verified findings: scan the entire non-admitted suffix for intrinsically oversized commands; make world-generation and global event-ordinal allocators uint64-safe/exhaustion-safe before mutation; reject malformed payload modes/hex preimages; bind RNG audit generation and canonical command index to the owning committed command; structurally validate checkpoint session/idempotency/result state and require the durable commit clock; enforce canonical decimal-string event cursor representations. No finding waived.
- 2026-07-30T13:39:22Z — note: Remediation round 1 findings resolved without waiver: the non-admitted suffix is fully classified; generation, session, stream, event-sequence, and global-ordinal allocators are uint64/exhaustion-safe before mutation; digest payload modes and canonical hex are validated; RNG evidence is bound to its pending generation and owning canonical command index; checkpoint durable maps and commit clock are structurally validated; event cursors require canonical decimal strings. Added focused regressions for every reproduced defect, including the null exhausted-session cursor path.
- 2026-07-30T13:39:23Z — run: node --test scripts/replay-contract.test.mjs
  started 2026-07-30T13:39:22Z, exit 0 in 0.4s
  output tail (truncated to last 30 lines):
  |   duration_ms: 0.9741
  |   type: 'test'
  |   ...
  | # Subtest: event epochs are mandatory and reset allocation never fills historical gaps
  | ok 15 - event epochs are mandatory and reset allocation never fills historical gaps
  |   ---
  |   duration_ms: 0.2425
  |   type: 'test'
  |   ...
  | # Subtest: event cursors cover uint64 maxima and allocator exhaustion is deterministic
  | ok 16 - event cursors cover uint64 maxima and allocator exhaustion is deterministic
  |   ---
  |   duration_ms: 0.9242
  |   type: 'test'
  |   ...
  | # Subtest: semantic oracle has no wall-clock, network, or ambient-random dependency
  | ok 17 - semantic oracle has no wall-clock, network, or ambient-random dependency
  |   ---
  |   duration_ms: 8.674
  |   type: 'test'
  |   ...
  | 1..17
  | # tests 17
  | # suites 0
  | # pass 17
  | # fail 0
  | # cancelled 0
  | # skipped 0
  | # todo 0
  | # duration_ms 283.0136
- 2026-07-30T13:39:44Z — run: node scripts/check.mjs
  started 2026-07-30T13:39:23Z, exit 0 in 21.4s
  output tail (truncated to last 30 lines):
  |     # Subtest: soft-deletes by setting status=done and adding deleted:true tag
  |     ok 1 - soft-deletes by setting status=done and adding deleted:true tag
  |       ---
  |       duration_ms: 139.0938
  |       type: 'test'
  |       ...
  |     # Subtest: keeps dependents blocked when their blocker is soft-deleted
  |     ok 2 - keeps dependents blocked when their blocker is soft-deleted
  |       ---
  |       duration_ms: 341.8732
  |       type: 'test'
  |       ...
  |     1..2
  | ok 121 - task rm
  |   ---
  |   duration_ms: 481.1017
  |   type: 'suite'
  |   ...
  | 1..121
  | # tests 289
  | # suites 62
  | # pass 289
  | # fail 0
  | # cancelled 0
  | # skipped 0
  | # todo 0
  | # duration_ms 19637.0679
  |
  | run-checks: PASS (skill-sync + 14 suites)
  | process-docs: PASS (no unresolved markers in scoped non-binary files)
- 2026-07-30T13:39:45Z — run: git diff --check
  started 2026-07-30T13:39:44Z, exit 0 in 0.1s
  output:
  | (no output)
- 2026-07-30T13:39:45Z — moved to review
- 2026-07-30T13:44:31Z — moved to in_progress (claimed by shift@Shiftor)
- 2026-07-30T13:44:31Z — note: Fresh remediation cold review round 2, rung 2: SPEC and STANDARDS FAIL. Verified findings: validate cursor requests before allocating new streams; bind recovered RNG audits to record generation and command ordinal; reject decreasing suffix commit clocks; reject unsafe numeric spatial coordinates; validate recovered authoritative result shapes; allow legitimate idempotency-conflict durable rows whose digest differs from the retained cross-epoch key while preserving key linkage; include retained event timestamps in checkpoint commit-clock validation. No finding waived.
- 2026-07-30T13:48:18Z — note: Remediation round 2 findings resolved without waiver: cursor validation now precedes stream/epoch allocation; recovered results and RNG evidence are shape-checked and bound to record generation/ordinal before scratch mutation; suffix commit times cannot decrease; unsafe numeric spatial coordinates are rejected; durable conflict rows preserve their distinct digest semantics; checkpoint event times are covered by the durable clock. Focused regressions reproduce every cold-review counterexample.
- 2026-07-30T13:48:18Z — run: node --test scripts/replay-contract.test.mjs
  started 2026-07-30T13:48:18Z, exit 0 in 0.2s
  output tail (truncated to last 30 lines):
  |   duration_ms: 1.483
  |   type: 'test'
  |   ...
  | # Subtest: event epochs are mandatory and reset allocation never fills historical gaps
  | ok 15 - event epochs are mandatory and reset allocation never fills historical gaps
  |   ---
  |   duration_ms: 0.3353
  |   type: 'test'
  |   ...
  | # Subtest: event cursors cover uint64 maxima and allocator exhaustion is deterministic
  | ok 16 - event cursors cover uint64 maxima and allocator exhaustion is deterministic
  |   ---
  |   duration_ms: 0.7991
  |   type: 'test'
  |   ...
  | # Subtest: semantic oracle has no wall-clock, network, or ambient-random dependency
  | ok 17 - semantic oracle has no wall-clock, network, or ambient-random dependency
  |   ---
  |   duration_ms: 0.6443
  |   type: 'test'
  |   ...
  | 1..17
  | # tests 17
  | # suites 0
  | # pass 17
  | # fail 0
  | # cancelled 0
  | # skipped 0
  | # todo 0
  | # duration_ms 157.0377
- 2026-07-30T13:48:36Z — run: node scripts/check.mjs
  started 2026-07-30T13:48:18Z, exit 0 in 17.7s
  output tail (truncated to last 30 lines):
  |     # Subtest: soft-deletes by setting status=done and adding deleted:true tag
  |     ok 1 - soft-deletes by setting status=done and adding deleted:true tag
  |       ---
  |       duration_ms: 122.8778
  |       type: 'test'
  |       ...
  |     # Subtest: keeps dependents blocked when their blocker is soft-deleted
  |     ok 2 - keeps dependents blocked when their blocker is soft-deleted
  |       ---
  |       duration_ms: 307.9781
  |       type: 'test'
  |       ...
  |     1..2
  | ok 121 - task rm
  |   ---
  |   duration_ms: 430.9609
  |   type: 'suite'
  |   ...
  | 1..121
  | # tests 289
  | # suites 62
  | # pass 289
  | # fail 0
  | # cancelled 0
  | # skipped 0
  | # todo 0
  | # duration_ms 16986.2246
  |
  | run-checks: PASS (skill-sync + 14 suites)
  | process-docs: PASS (no unresolved markers in scoped non-binary files)
- 2026-07-30T13:48:36Z — run: git diff --check
  started 2026-07-30T13:48:36Z, exit 0 in 0.1s
  output:
  | (no output)
- 2026-07-30T13:48:36Z — moved to review
- 2026-07-30T13:55:43Z — note: Fresh remediation cold review round 3/3, rung 2: SPEC and STANDARDS FAIL; retry limit reached and no finding waived. Reproducible blockers: duplicate commit completion can reapply one generation; recovered alias/preserve flags do not enforce canonical identical-key alias versus conflicting-key rejection; commit preflight accepts invalid clocks, unsafe mutation effects, and malformed event fields; recovery cannot detect a truncated final generation without a durable completion/count proof; durable event cursor/epoch/global-ordinal allocations are not recorded in the outcome frame and are instead synthesized on recovery. Focused tests (17/17), full gate (64 product/process plus 289 installed), and diff-check pass but do not cover these defects. Uncommitted branch work is preserved for an operator decision on another remediation cycle.
- 2026-07-30T13:55:43Z — moved to blocked
- 2026-07-30T15:06:16Z — note: fresh remediation rubric: (1) writer completion is one-shot and commit inputs are fully validated before authoritative mutation; (2) recovery derives and enforces canonical idempotency alias/conflict transitions; (3) every durable event records and verifies its assigned epoch, sequence, and global ordinal; (4) each generation carries an atomic expected outcome-record count so terminal truncation fails closed; (5) focused regressions, the full gate, and separate rung-1 Claude SPEC/STANDARDS reviews pass with no material finding.
- 2026-07-30T15:06:16Z — moved to backlog
- 2026-07-30T15:06:17Z — moved to in_progress (claimed by shift@Shiftor)
- 2026-07-30T15:13:05Z — note: Fresh remediation implemented without waiver: writer completion is one-shot; commit preflight rejects invalid clock/result/effect/event inputs; recovery derives retained-key alias/conflict semantics; every outcome records generation_record_count; durable events carry and verify epoch, sequence, ordinal, time, and size. Bounded adversarial verification reproduced all five prior blockers, exercised valid and malicious paths, and reported PASS with no adjacent material defect.
- 2026-07-30T15:13:05Z — run: node --test scripts/replay-contract.test.mjs
  started 2026-07-30T15:13:05Z, exit 0 in 0.2s
  output tail (truncated to last 30 lines):
  |   duration_ms: 3.2858
  |   type: 'test'
  |   ...
  | # Subtest: event epochs are mandatory and reset allocation never fills historical gaps
  | ok 16 - event epochs are mandatory and reset allocation never fills historical gaps
  |   ---
  |   duration_ms: 0.4092
  |   type: 'test'
  |   ...
  | # Subtest: event cursors cover uint64 maxima and allocator exhaustion is deterministic
  | ok 17 - event cursors cover uint64 maxima and allocator exhaustion is deterministic
  |   ---
  |   duration_ms: 1.7913
  |   type: 'test'
  |   ...
  | # Subtest: semantic oracle has no wall-clock, network, or ambient-random dependency
  | ok 18 - semantic oracle has no wall-clock, network, or ambient-random dependency
  |   ---
  |   duration_ms: 0.5062
  |   type: 'test'
  |   ...
  | 1..18
  | # tests 18
  | # suites 0
  | # pass 18
  | # fail 0
  | # cancelled 0
  | # skipped 0
  | # todo 0
  | # duration_ms 163.7045
- 2026-07-30T15:13:21Z — run: node scripts/check.mjs
  started 2026-07-30T15:13:05Z, exit 0 in 15.6s
  output tail (truncated to last 30 lines):
  |     # Subtest: soft-deletes by setting status=done and adding deleted:true tag
  |     ok 1 - soft-deletes by setting status=done and adding deleted:true tag
  |       ---
  |       duration_ms: 133.2626
  |       type: 'test'
  |       ...
  |     # Subtest: keeps dependents blocked when their blocker is soft-deleted
  |     ok 2 - keeps dependents blocked when their blocker is soft-deleted
  |       ---
  |       duration_ms: 354.0383
  |       type: 'test'
  |       ...
  |     1..2
  | ok 121 - task rm
  |   ---
  |   duration_ms: 487.4407
  |   type: 'suite'
  |   ...
  | 1..121
  | # tests 289
  | # suites 62
  | # pass 289
  | # fail 0
  | # cancelled 0
  | # skipped 0
  | # todo 0
  | # duration_ms 14938.4402
  |
  | run-checks: PASS (skill-sync + 14 suites)
  | process-docs: PASS (no unresolved markers in scoped non-binary files)
- 2026-07-30T15:13:21Z — run: git diff --check
  started 2026-07-30T15:13:21Z, exit 0 in 0.1s
  output:
  | (no output)
- 2026-07-30T15:13:21Z — moved to review
- 2026-07-30T15:22:14Z — moved to in_progress (claimed by shift@Shiftor)
- 2026-07-30T15:22:14Z — note: Claude rung-1 fresh remediation round 1: SPEC and STANDARDS FAIL. Verified must-fix findings include binding raw payload bytes to the applied semantic projection in this oracle; replaying availability/invalid precedence before retained-key conflict; preventing well-formed unknown-stream ack/resume from allocating epochs; handling complete committed tails; preserving committed suffix frames across repeated recovery; canonical digest bytes for unavailable/invalid payloads; validating retention-operation clocks; and canonical signed zero. Additional retention-state durability, typed failure, coverage, and documentation findings are under adjudication. No finding waived.
- 2026-07-30T15:28:58Z — note: Claude round-1 remediation completed without waiver: raw recovery bytes are now bound to the applied canonical semantic projection; availability/invalid precedence is replayed before retained-key conflicts; unknown-stream cursors allocate nothing; complete committed tails are accepted; reconstructed suffix frames survive repeated restart; historical sessions disconnect on cold recovery while committed retention decisions remain reproducible; payload digests, operational clocks, signed zero, acknowledgements, occupied-writer oversize handling, and projected frame-size integrity have focused coverage.
- 2026-07-30T15:28:58Z — run: node --test scripts/replay-contract.test.mjs
  started 2026-07-30T15:28:58Z, exit 0 in 0.3s
  output tail (truncated to last 30 lines):
  |   duration_ms: 3.364
  |   type: 'test'
  |   ...
  | # Subtest: event epochs are mandatory and reset allocation never fills historical gaps
  | ok 17 - event epochs are mandatory and reset allocation never fills historical gaps
  |   ---
  |   duration_ms: 0.427
  |   type: 'test'
  |   ...
  | # Subtest: event cursors cover uint64 maxima and allocator exhaustion is deterministic
  | ok 18 - event cursors cover uint64 maxima and allocator exhaustion is deterministic
  |   ---
  |   duration_ms: 0.7849
  |   type: 'test'
  |   ...
  | # Subtest: semantic oracle has no wall-clock, network, or ambient-random dependency
  | ok 19 - semantic oracle has no wall-clock, network, or ambient-random dependency
  |   ---
  |   duration_ms: 0.4897
  |   type: 'test'
  |   ...
  | 1..19
  | # tests 19
  | # suites 0
  | # pass 19
  | # fail 0
  | # cancelled 0
  | # skipped 0
  | # todo 0
  | # duration_ms 171.9249
- 2026-07-30T15:29:14Z — run: node scripts/check.mjs
  started 2026-07-30T15:28:58Z, exit 0 in 16.2s
  output tail (truncated to last 30 lines):
  |     # Subtest: soft-deletes by setting status=done and adding deleted:true tag
  |     ok 1 - soft-deletes by setting status=done and adding deleted:true tag
  |       ---
  |       duration_ms: 113.2505
  |       type: 'test'
  |       ...
  |     # Subtest: keeps dependents blocked when their blocker is soft-deleted
  |     ok 2 - keeps dependents blocked when their blocker is soft-deleted
  |       ---
  |       duration_ms: 289.5668
  |       type: 'test'
  |       ...
  |     1..2
  | ok 121 - task rm
  |   ---
  |   duration_ms: 402.9314
  |   type: 'suite'
  |   ...
  | 1..121
  | # tests 289
  | # suites 62
  | # pass 289
  | # fail 0
  | # cancelled 0
  | # skipped 0
  | # todo 0
  | # duration_ms 15445.4632
  |
  | run-checks: PASS (skill-sync + 14 suites)
  | process-docs: PASS (no unresolved markers in scoped non-binary files)
- 2026-07-30T15:29:14Z — run: git diff --check
  started 2026-07-30T15:29:14Z, exit 0 in 0.1s
  output:
  | (no output)
- 2026-07-30T15:29:15Z — moved to review
- 2026-07-30T15:34:13Z — moved to in_progress (claimed by shift@Shiftor)
- 2026-07-30T15:34:13Z — note: Claude rung-1 fresh remediation round 2 SPEC: FAIL on one verified blocker. An explicitly supplied payload_mode 1/2 could contradict live availability/validity classification, allowing an accepted commit that recovery rejects. No finding waived; fixing by enforcing one canonical derived payload mode at admission. Claude labeled volatile post-install pending state and thrown preflight failures non-blocking observations.
- 2026-07-30T15:35:09Z — note: Round-2 SPEC blocker resolved without waiver: admission now rejects any supplied payload_mode that contradicts the server-derived available/invalid classification, while recovery accepts the already-persisted canonical mode. Added regressions for every contradictory pairing.
- 2026-07-30T15:35:09Z — run: node --test scripts/replay-contract.test.mjs
  started 2026-07-30T15:35:09Z, exit 0 in 0.3s
  output tail (truncated to last 30 lines):
  |   duration_ms: 3.9567
  |   type: 'test'
  |   ...
  | # Subtest: event epochs are mandatory and reset allocation never fills historical gaps
  | ok 17 - event epochs are mandatory and reset allocation never fills historical gaps
  |   ---
  |   duration_ms: 0.6835
  |   type: 'test'
  |   ...
  | # Subtest: event cursors cover uint64 maxima and allocator exhaustion is deterministic
  | ok 18 - event cursors cover uint64 maxima and allocator exhaustion is deterministic
  |   ---
  |   duration_ms: 0.8965
  |   type: 'test'
  |   ...
  | # Subtest: semantic oracle has no wall-clock, network, or ambient-random dependency
  | ok 19 - semantic oracle has no wall-clock, network, or ambient-random dependency
  |   ---
  |   duration_ms: 0.5602
  |   type: 'test'
  |   ...
  | 1..19
  | # tests 19
  | # suites 0
  | # pass 19
  | # fail 0
  | # cancelled 0
  | # skipped 0
  | # todo 0
  | # duration_ms 187.0304
- 2026-07-30T15:35:26Z — run: node scripts/check.mjs
  started 2026-07-30T15:35:10Z, exit 0 in 16.3s
  output tail (truncated to last 30 lines):
  |     # Subtest: soft-deletes by setting status=done and adding deleted:true tag
  |     ok 1 - soft-deletes by setting status=done and adding deleted:true tag
  |       ---
  |       duration_ms: 134.2749
  |       type: 'test'
  |       ...
  |     # Subtest: keeps dependents blocked when their blocker is soft-deleted
  |     ok 2 - keeps dependents blocked when their blocker is soft-deleted
  |       ---
  |       duration_ms: 376.4076
  |       type: 'test'
  |       ...
  |     1..2
  | ok 121 - task rm
  |   ---
  |   duration_ms: 510.7996
  |   type: 'suite'
  |   ...
  | 1..121
  | # tests 289
  | # suites 62
  | # pass 289
  | # fail 0
  | # cancelled 0
  | # skipped 0
  | # todo 0
  | # duration_ms 15497.2918
  |
  | run-checks: PASS (skill-sync + 14 suites)
  | process-docs: PASS (no unresolved markers in scoped non-binary files)
- 2026-07-30T15:35:26Z — run: git diff --check
  started 2026-07-30T15:35:26Z, exit 0 in 0.1s
  output:
  | (no output)
- 2026-07-30T15:35:26Z — moved to review
- 2026-07-30T15:40:31Z — note: Fresh remediation cold review round 3/3, rung 1: SPEC PASS; STANDARDS FAIL on one verified blocker, with no finding waived. Two exact-next commands that reuse one idempotency key within the same admitted generation consult only the durable idempotency map, so the second command can receive a non-canonical accepted result and the writer can commit a suffix recovery rejects. Required repair: layer tentative per-generation idempotency state over durable state and add same-generation identical-alias, different-content conflict, and cold-recovery regressions. Focused tests (19/19), full gate (66 repository tests plus 289 installed workflow tests), skill sync, marker scan, and diff-check pass but do not cover this path. Retry limit reached; uncommitted branch work is preserved.
- 2026-07-30T15:40:31Z — moved to blocked
- 2026-07-30T15:48:19Z — note: fresh remediation rubric: (1) canonical commands within one admitted generation resolve idempotency against prior commands in that same generation; (2) same-key same-digest commands become no-effect aliases and same-key different-digest commands become IDEMPOTENCY_CONFLICT without batch-dependent outcomes; (3) live commit flags and cold recovery derive identical transitions for both paths; (4) focused regressions and an executable conformance case cover same-generation alias, conflict, world effects, and restart; (5) focused tests, full gate, and separate cold SPEC/STANDARDS reviews pass with no material finding.
- 2026-07-30T15:48:19Z — moved to backlog
- 2026-07-30T15:48:19Z — moved to in_progress (claimed by shift@Shiftor)
- 2026-07-30T15:51:32Z — note: Fresh remediation implemented without waiver: admission now layers a tentative idempotency map over durable state and advances it in canonical command order. Same-generation identical reuse becomes a no-effect alias; differing reuse becomes IDEMPOTENCY_CONFLICT; availability precedence remains canonical. Added semantic fixture and focused cold-recovery cases, documented batch-equivalence, and distilled the recurring tentative-overlay review lens. Bounded adversarial worker review PASS; its only non-blocking coverage suggestion was added.
- 2026-07-30T15:51:32Z — run: node --test scripts/replay-contract.test.mjs
  started 2026-07-30T15:51:32Z, exit 0 in 0.3s
  output tail (truncated to last 30 lines):
  |   duration_ms: 3.411
  |   type: 'test'
  |   ...
  | # Subtest: event epochs are mandatory and reset allocation never fills historical gaps
  | ok 18 - event epochs are mandatory and reset allocation never fills historical gaps
  |   ---
  |   duration_ms: 0.5047
  |   type: 'test'
  |   ...
  | # Subtest: event cursors cover uint64 maxima and allocator exhaustion is deterministic
  | ok 19 - event cursors cover uint64 maxima and allocator exhaustion is deterministic
  |   ---
  |   duration_ms: 0.9636
  |   type: 'test'
  |   ...
  | # Subtest: semantic oracle has no wall-clock, network, or ambient-random dependency
  | ok 20 - semantic oracle has no wall-clock, network, or ambient-random dependency
  |   ---
  |   duration_ms: 0.5633
  |   type: 'test'
  |   ...
  | 1..20
  | # tests 20
  | # suites 0
  | # pass 20
  | # fail 0
  | # cancelled 0
  | # skipped 0
  | # todo 0
  | # duration_ms 192.4845
- 2026-07-30T15:51:50Z — run: node scripts/check.mjs
  started 2026-07-30T15:51:33Z, exit 0 in 17.5s
  output tail (truncated to last 30 lines):
  |     # Subtest: soft-deletes by setting status=done and adding deleted:true tag
  |     ok 1 - soft-deletes by setting status=done and adding deleted:true tag
  |       ---
  |       duration_ms: 200.4759
  |       type: 'test'
  |       ...
  |     # Subtest: keeps dependents blocked when their blocker is soft-deleted
  |     ok 2 - keeps dependents blocked when their blocker is soft-deleted
  |       ---
  |       duration_ms: 379.7924
  |       type: 'test'
  |       ...
  |     1..2
  | ok 121 - task rm
  |   ---
  |   duration_ms: 580.4031
  |   type: 'suite'
  |   ...
  | 1..121
  | # tests 289
  | # suites 62
  | # pass 289
  | # fail 0
  | # cancelled 0
  | # skipped 0
  | # todo 0
  | # duration_ms 16776.9753
  |
  | run-checks: PASS (skill-sync + 14 suites)
  | process-docs: PASS (no unresolved markers in scoped non-binary files)
- 2026-07-30T15:51:50Z — run: git diff --check
  started 2026-07-30T15:51:50Z, exit 0 in 0.1s
  output:
  | (no output)
- 2026-07-30T15:51:50Z — moved to review
- 2026-07-30T16:03:22Z — moved to in_progress (claimed by shift@Shiftor)
- 2026-07-30T16:03:22Z — note: Fresh cycle cold review round 1, rung 1: SPEC and STANDARDS FAIL. Verified material findings: checkpoint validation must allow digest-divergent UNSUPPORTED_MESSAGE/INVALID_MESSAGE rows; normative precedence must state availability/invalid before retained-key conflict; same-batch below-cursor identical retry needs a tentative session-result view; maintenance time advanced during an open generation must carry into commit; a committed complete tail must match the final supplied record rather than be silently ignored. Also clarifying recorded retention-decision recovery and adding outbound-link coverage. Whole-batch invalid internal input, typed oracle exceptions, and module split findings are adjudicated non-blocking/out of scope; no material finding waived.
- 2026-07-30T16:07:22Z — note: Round-1 findings resolved without waiver: checkpoints now admit the same digest-divergent availability/invalid rows as suffix replay; section 2 defines availability/validity before conflict; tentative session-result replay eliminates batch-dependent below-cursor retries and preserves canonical delivery order; commit time absorbs maintenance-clock advances; committed complete tails must byte-match the final record; recorded retention decisions and outbound links are explicit and tested.
- 2026-07-30T16:07:23Z — run: node --test scripts/replay-contract.test.mjs
  started 2026-07-30T16:07:22Z, exit 0 in 0.3s
  output tail (truncated to last 30 lines):
  |   duration_ms: 0.5378
  |   type: 'test'
  |   ...
  | # Subtest: event cursors cover uint64 maxima and allocator exhaustion is deterministic
  | ok 19 - event cursors cover uint64 maxima and allocator exhaustion is deterministic
  |   ---
  |   duration_ms: 1.0401
  |   type: 'test'
  |   ...
  | # Subtest: semantic oracle has no wall-clock, network, or ambient-random dependency
  | ok 20 - semantic oracle has no wall-clock, network, or ambient-random dependency
  |   ---
  |   duration_ms: 0.6123
  |   type: 'test'
  |   ...
  | # Subtest: replay contract relative links resolve
  | ok 21 - replay contract relative links resolve
  |   ---
  |   duration_ms: 0.4836
  |   type: 'test'
  |   ...
  | 1..21
  | # tests 21
  | # suites 0
  | # pass 21
  | # fail 0
  | # cancelled 0
  | # skipped 0
  | # todo 0
  | # duration_ms 238.9252
- 2026-07-30T16:07:44Z — run: node scripts/check.mjs
  started 2026-07-30T16:07:23Z, exit 0 in 20.7s
  output tail (truncated to last 30 lines):
  |     # Subtest: soft-deletes by setting status=done and adding deleted:true tag
  |     ok 1 - soft-deletes by setting status=done and adding deleted:true tag
  |       ---
  |       duration_ms: 173.9424
  |       type: 'test'
  |       ...
  |     # Subtest: keeps dependents blocked when their blocker is soft-deleted
  |     ok 2 - keeps dependents blocked when their blocker is soft-deleted
  |       ---
  |       duration_ms: 398.7791
  |       type: 'test'
  |       ...
  |     1..2
  | ok 121 - task rm
  |   ---
  |   duration_ms: 572.8828
  |   type: 'suite'
  |   ...
  | 1..121
  | # tests 289
  | # suites 62
  | # pass 289
  | # fail 0
  | # cancelled 0
  | # skipped 0
  | # todo 0
  | # duration_ms 19798.445
  |
  | run-checks: PASS (skill-sync + 14 suites)
  | process-docs: PASS (no unresolved markers in scoped non-binary files)
- 2026-07-30T16:07:44Z — run: git diff --check
  started 2026-07-30T16:07:44Z, exit 0 in 0.1s
  output:
  | (no output)
- 2026-07-30T16:07:44Z — moved to review
- 2026-07-30T16:19:25Z — moved to in_progress (claimed by shift@Shiftor)
- 2026-07-30T16:19:25Z — note: Fresh cycle cold review round 2, rung 1: STANDARDS PASS; SPEC FAIL on three verified material findings. Reachable retention can preserve a per-session durable result after its referenced idempotency row expires, but checkpoint validation rejects that state; payload mode 2 invents a durable INVALID_MESSAGE outcome that conflicts with protocol v1 INVALID_ENVELOPE/no-effect behavior and ADR-0005's two modes; occupied-writer oversize handling contradicts the unconditional backpressure contract. No finding waived; reopening implementation.
- 2026-07-30T16:22:04Z — note: Round-2 SPEC findings resolved without waiver: checkpoint validation now permits independently retained per-session results after their cross-epoch key row expires while enforcing digest consistency whenever both exist; replay v1 now has only ADR-0005's canonical-typed and exact-unavailable digest modes, with malformed available payloads remaining protocol-v1 INVALID_ENVELOPE no-effect errors; occupied writers return unconditional transient backpressure before oversize classification. Added cold-restart replay and occupied-oversize regressions.
- 2026-07-30T16:22:05Z — run: node --test scripts/replay-contract.test.mjs
  started 2026-07-30T16:22:04Z, exit 0 in 0.3s
  output tail (truncated to last 30 lines):
  |   duration_ms: 0.5393
  |   type: 'test'
  |   ...
  | # Subtest: event cursors cover uint64 maxima and allocator exhaustion is deterministic
  | ok 19 - event cursors cover uint64 maxima and allocator exhaustion is deterministic
  |   ---
  |   duration_ms: 0.9964
  |   type: 'test'
  |   ...
  | # Subtest: semantic oracle has no wall-clock, network, or ambient-random dependency
  | ok 20 - semantic oracle has no wall-clock, network, or ambient-random dependency
  |   ---
  |   duration_ms: 0.5848
  |   type: 'test'
  |   ...
  | # Subtest: replay contract relative links resolve
  | ok 21 - replay contract relative links resolve
  |   ---
  |   duration_ms: 0.5007
  |   type: 'test'
  |   ...
  | 1..21
  | # tests 21
  | # suites 0
  | # pass 21
  | # fail 0
  | # cancelled 0
  | # skipped 0
  | # todo 0
  | # duration_ms 228.1272
- 2026-07-30T16:22:22Z — run: node scripts/check.mjs
  started 2026-07-30T16:22:05Z, exit 0 in 16.9s
  output tail (truncated to last 30 lines):
  |     # Subtest: soft-deletes by setting status=done and adding deleted:true tag
  |     ok 1 - soft-deletes by setting status=done and adding deleted:true tag
  |       ---
  |       duration_ms: 123.5176
  |       type: 'test'
  |       ...
  |     # Subtest: keeps dependents blocked when their blocker is soft-deleted
  |     ok 2 - keeps dependents blocked when their blocker is soft-deleted
  |       ---
  |       duration_ms: 352.0009
  |       type: 'test'
  |       ...
  |     1..2
  | ok 121 - task rm
  |   ---
  |   duration_ms: 475.6446
  |   type: 'suite'
  |   ...
  | 1..121
  | # tests 289
  | # suites 62
  | # pass 289
  | # fail 0
  | # cancelled 0
  | # skipped 0
  | # todo 0
  | # duration_ms 15871.5051
  |
  | run-checks: PASS (skill-sync + 14 suites)
  | process-docs: PASS (no unresolved markers in scoped non-binary files)
- 2026-07-30T16:22:22Z — run: git diff --check
  started 2026-07-30T16:22:22Z, exit 0 in 0.1s
  output:
  | (no output)
- 2026-07-30T16:22:22Z — moved to review
- 2026-07-30T16:29:52Z — note: Fresh remediation cold review round 3/3, rung 1: SPEC and STANDARDS FAIL; retry limit reached and no finding waived. Two reproducible blockers remain: replay/v1/CONTRACT.md section 5.1 still says payload modes 0..2 after the canonical contract and oracle were corrected to 0..1; writer-unavailable admission still emits PERSISTENCE_RECORD_TOO_LARGE for an oversized command instead of the unconditional PERSISTENCE_UNAVAILABLE required after admission has stopped. Focused tests (21/21), full gate (68 repository tests plus 289 installed workflow tests), skill sync, marker scan, and diff-check pass but do not cover both residues. Uncommitted branch work is preserved for an operator decision on another fresh remediation cycle.
- 2026-07-30T16:29:52Z — moved to blocked
- 2026-07-30T17:05:05Z — note: operator authorized another fresh remediation cycle. Rubric: (1) replay v1 defines exactly payload modes 0 and 1 in every normative section and the oracle rejects every other mode; (2) writer-unavailable admission returns PERSISTENCE_UNAVAILABLE for every exact-next command regardless of projected record size; (3) occupied, unavailable, and free-writer oversize precedence each have focused regression coverage; (4) focused and full gates pass; (5) separate rung-1 Claude SPEC and STANDARDS cold reviews pass with no material finding.
- 2026-07-30T17:05:06Z — moved to backlog
- 2026-07-30T17:05:06Z — moved to in_progress (claimed by shift@Shiftor)
- 2026-07-30T17:05:35Z — note: Authorized-cycle remediation implemented: section 5.1 now names only payload modes 0..1, matching section 1.2, ADR-0005, admission, and recovery; writer-unavailable admission now returns PERSISTENCE_UNAVAILABLE before all size classification. The focused unavailable-writer regression covers both ordinary and intrinsically oversized commands.
- 2026-07-30T17:05:35Z — run: node --test scripts/replay-contract.test.mjs
  started 2026-07-30T17:05:35Z, exit 0 in 0.3s
  output tail (truncated to last 30 lines):
  |   duration_ms: 0.4222
  |   type: 'test'
  |   ...
  | # Subtest: event cursors cover uint64 maxima and allocator exhaustion is deterministic
  | ok 19 - event cursors cover uint64 maxima and allocator exhaustion is deterministic
  |   ---
  |   duration_ms: 0.8059
  |   type: 'test'
  |   ...
  | # Subtest: semantic oracle has no wall-clock, network, or ambient-random dependency
  | ok 20 - semantic oracle has no wall-clock, network, or ambient-random dependency
  |   ---
  |   duration_ms: 0.5182
  |   type: 'test'
  |   ...
  | # Subtest: replay contract relative links resolve
  | ok 21 - replay contract relative links resolve
  |   ---
  |   duration_ms: 0.4422
  |   type: 'test'
  |   ...
  | 1..21
  | # tests 21
  | # suites 0
  | # pass 21
  | # fail 0
  | # cancelled 0
  | # skipped 0
  | # todo 0
  | # duration_ms 227.9319
- 2026-07-30T17:05:50Z — run: node scripts/check.mjs
  started 2026-07-30T17:05:35Z, exit 0 in 15.3s
  output tail (truncated to last 30 lines):
  |     # Subtest: soft-deletes by setting status=done and adding deleted:true tag
  |     ok 1 - soft-deletes by setting status=done and adding deleted:true tag
  |       ---
  |       duration_ms: 132.8793
  |       type: 'test'
  |       ...
  |     # Subtest: keeps dependents blocked when their blocker is soft-deleted
  |     ok 2 - keeps dependents blocked when their blocker is soft-deleted
  |       ---
  |       duration_ms: 350.2405
  |       type: 'test'
  |       ...
  |     1..2
  | ok 121 - task rm
  |   ---
  |   duration_ms: 483.2286
  |   type: 'suite'
  |   ...
  | 1..121
  | # tests 289
  | # suites 62
  | # pass 289
  | # fail 0
  | # cancelled 0
  | # skipped 0
  | # todo 0
  | # duration_ms 14505.6983
  |
  | run-checks: PASS (skill-sync + 14 suites)
  | process-docs: PASS (no unresolved markers in scoped non-binary files)
- 2026-07-30T17:05:51Z — run: git diff --check
  started 2026-07-30T17:05:50Z, exit 0 in 0.1s
  output:
  | (no output)
- 2026-07-30T17:05:51Z — moved to review
- 2026-07-30T17:14:20Z — note: Fresh authorized remediation cycle round 1, rung 1 counterpart CLI: separate Claude SPEC PASS and STANDARDS PASS on the complete current diff with all untracked files included. No material finding remains and no finding was waived. Exact reviewed-state validation is recorded: focused 21/21, full repository 68/68, installed workflow 289/289, skill sync PASS, marker scan PASS, diff-check PASS.
- 2026-07-30T17:14:20Z — moved to done
