---
id: task-011
title: Specify replay and persistence ordering contracts
status: blocked
priority: p0
tags: [area:architecture, milestone:foundations]
blockedBy: [task-025]
createdAt: "2026-07-29T12:55:19Z"
updatedAt: "2026-07-30T11:56:39Z"
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
