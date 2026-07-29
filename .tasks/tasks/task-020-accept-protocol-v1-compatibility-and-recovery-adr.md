---
id: task-020
title: Accept protocol v1 compatibility and recovery ADR
status: done
priority: p0
tags: [area:architecture, milestone:foundations]
blockedBy: []
createdAt: "2026-07-29T14:35:12Z"
updatedAt: "2026-07-29T15:38:39Z"
---

<!-- task-tracker:description -->
## Description

Review ADR-0001 and explicitly accept it, reject it, or request specific changes. Acceptance unblocks task-002 to author the public v1 protobuf envelope and semantic conformance fixtures; because the decision fixes public wire compatibility, idempotency, and event-recovery behavior, implementation must not proceed while the ADR remains proposed.

<!-- task-tracker:log -->
## Log

- 2026-07-29T14:35:12Z — created (status: backlog)
- 2026-07-29T14:35:12Z — note: blocked: awaiting the operator's explicit decision on docs/adr/0001-protocol-v1-compatibility-and-recovery.md
- 2026-07-29T14:35:12Z — moved to blocked
- 2026-07-29T15:30:23Z — note: operator decision recorded: on 2026-07-29 the operator explicitly accepted ADR-0001 as written.
- 2026-07-29T15:30:23Z — note: rubric: (1) ADR-0001 status and index both record accepted. (2) The operator acceptance is logged durably. (3) task-002 no longer waits on an operator decision.
- 2026-07-29T15:30:23Z — edited (-tag needs:operator)
- 2026-07-29T15:30:24Z — moved to in_progress (claimed by codex-task-002)
- 2026-07-29T15:30:51Z — moved to review
- 2026-07-29T15:30:52Z — run: git diff --check
  started 2026-07-29T15:30:51Z, exit 0 in 0.1s
  output:
  | (no output)
- 2026-07-29T15:31:10Z — run: node scripts/check.mjs
  started 2026-07-29T15:30:52Z, exit 0 in 17.9s
  output tail (truncated to last 30 lines):
  |     # Subtest: soft-deletes by setting status=done and adding deleted:true tag
  |     ok 1 - soft-deletes by setting status=done and adding deleted:true tag
  |       ---
  |       duration_ms: 144.8406
  |       type: 'test'
  |       ...
  |     # Subtest: keeps dependents blocked when their blocker is soft-deleted
  |     ok 2 - keeps dependents blocked when their blocker is soft-deleted
  |       ---
  |       duration_ms: 335.8724
  |       type: 'test'
  |       ...
  |     1..2
  | ok 121 - task rm
  |   ---
  |   duration_ms: 480.8384
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
  | # duration_ms 17159.1608
  |
  | run-checks: PASS (skill-sync + 14 suites)
  | process-docs: PASS (no unresolved markers in scoped non-binary files)
- 2026-07-29T15:32:48Z — note: cold SPEC round 1 was inconclusive because PowerShell rendered the task text as System.Object[]; reviewer also raised architecture-quality observations outside task-020's acceptance-record scope. Reissuing a complete packet before adjudication.
- 2026-07-29T15:35:08Z — note: operator acceptance (verbatim): ok no convex, good research. return to task 002, i accept adr 001
- 2026-07-29T15:35:09Z — note: adjudication: ADR-0001 was authored and logged as proposed before the operator response but remained uncommitted because task-002 was blocked mid-lifecycle; the accepted status and proposal are intentionally landing in one task branch. Restored the Follow-up text to the exact proposed wording so the only accepted-record changes are status and index. Architecture-quality observations belong to task-002 contract implementation and will be resolved there without changing the accepted decision.
- 2026-07-29T15:35:09Z — run: git diff --check HEAD
  started 2026-07-29T15:35:09Z, exit 2 in 0.1s
  output:
  | docs/adr/0001-protocol-v1-compatibility-and-recovery.md:3: trailing whitespace.
  | +**Status:** accepted  
  | docs/adr/0001-protocol-v1-compatibility-and-recovery.md:4: trailing whitespace.
  | +**Date:** 2026-07-29
- 2026-07-29T15:35:18Z — run: git diff --check HEAD
  started 2026-07-29T15:35:18Z, exit 2 in 0.1s
  output:
  | .tasks/tasks/task-020-accept-protocol-v1-compatibility-and-recovery-adr.md:72: trailing whitespace.
  | +  | +**Status:** accepted
- 2026-07-29T15:35:39Z — note: friction: task.mjs run copied git diff --check's trailing-space diagnostic verbatim into the tracked task log, so a later whole-tree git diff --check flags the generated evidence line itself. Validation now scopes out .tasks while preserving the immutable CLI-authored log.
- 2026-07-29T15:35:40Z — run: git diff --check HEAD -- . :(exclude).tasks/**
  started 2026-07-29T15:35:39Z, exit 0 in 0.1s
  output:
  | (no output)
- 2026-07-29T15:38:39Z — run: node scripts/check.mjs
  started 2026-07-29T15:38:23Z, exit 0 in 15.4s
  output tail (truncated to last 30 lines):
  |     # Subtest: soft-deletes by setting status=done and adding deleted:true tag
  |     ok 1 - soft-deletes by setting status=done and adding deleted:true tag
  |       ---
  |       duration_ms: 122.4584
  |       type: 'test'
  |       ...
  |     # Subtest: keeps dependents blocked when their blocker is soft-deleted
  |     ok 2 - keeps dependents blocked when their blocker is soft-deleted
  |       ---
  |       duration_ms: 306.5885
  |       type: 'test'
  |       ...
  |     1..2
  | ok 121 - task rm
  |   ---
  |   duration_ms: 429.1613
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
  | # duration_ms 14675.5688
  |
  | run-checks: PASS (skill-sync + 14 suites)
  | process-docs: PASS (no unresolved markers in scoped non-binary files)
- 2026-07-29T15:38:39Z — note: final review adjudication: SPEC and STANDARDS used rung 1 (Claude counterpart CLI), separate round-2 calls. No finding invalidated acceptance. Fixed final-tree validation and ADR header rendering; rejected the claimed need for a committed proposed revision because the process requires proposal-before-acceptance, which the task log and blocked state prove, not a separate commit. The task-020 decision card is an intentional mid-task dependency delivered with task-002's single contract PR.
- 2026-07-29T15:38:39Z — moved to done
