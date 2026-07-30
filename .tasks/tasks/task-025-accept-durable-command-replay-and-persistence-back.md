---
id: task-025
title: Accept durable command replay and persistence backpressure ADR
status: done
priority: p0
tags: [area:architecture, milestone:foundations]
blockedBy: []
createdAt: "2026-07-30T01:31:37Z"
updatedAt: "2026-07-30T11:58:37Z"
---

<!-- task-tracker:description -->
## Description

Review proposed ADR-0005 and explicitly accept, revise, or reject its durable generation boundary, transient persistence backpressure wire behavior, 24-hour idempotency promise, bounded ordered-event retention, framed SQLite recovery rules, and counter-based RNG contract. Acceptance unblocks task-011; no implementation occurs on this card.

<!-- task-tracker:log -->
## Log

- 2026-07-30T01:31:37Z — created (status: backlog)
- 2026-07-30T11:54:07Z — note: rubric: (1) ADR-0005 records the operator's explicit acceptance without altering the proposed decision text. (2) The ADR index reports accepted status and task-011 records that its decision condition is resolved but remains dependency-blocked until delivery completes. (3) Focused document/diff validation and the full repository gate pass, and independent SPEC/STANDARDS review finds no acceptance-record defect.
- 2026-07-30T11:54:07Z — moved to in_progress (claimed by shift@Shiftor)
- 2026-07-30T11:54:07Z — edited (-tag needs:operator)
- 2026-07-30T11:54:07Z — note: operator explicitly accepted ADR-0005 as proposed on 2026-07-30; this task records and delivers that decision.
- 2026-07-30T11:54:07Z — moved to review
- 2026-07-30T11:56:58Z — note: round-1 cold review: rung 2 fresh subagents, separate SPEC and STANDARDS calls. Both verified the ADR decision body remained unchanged. Fixed stale task-011 needs:operator state; STANDARDS additionally required the blocker journal resolution and removal of inherited ADR header trailing whitespace.
- 2026-07-30T11:58:15Z — note: round-2 cold review: rung 2 fresh subagents, separate SPEC and STANDARDS calls; both PASS with no findings. ADR-0005 decision body is unchanged from the proposed packet, and ADR/index/task/journal state is consistent.
- 2026-07-30T11:58:15Z — run: git diff --check origin/main
  started 2026-07-30T11:58:15Z, exit 0 in 0.1s
  output:
  | (no output)
- 2026-07-30T11:58:30Z — run: node scripts/check.mjs
  started 2026-07-30T11:58:15Z, exit 0 in 14.9s
  output tail (truncated to last 30 lines):
  |     # Subtest: soft-deletes by setting status=done and adding deleted:true tag
  |     ok 1 - soft-deletes by setting status=done and adding deleted:true tag
  |       ---
  |       duration_ms: 117.1417
  |       type: 'test'
  |       ...
  |     # Subtest: keeps dependents blocked when their blocker is soft-deleted
  |     ok 2 - keeps dependents blocked when their blocker is soft-deleted
  |       ---
  |       duration_ms: 293.8983
  |       type: 'test'
  |       ...
  |     1..2
  | ok 121 - task rm
  |   ---
  |   duration_ms: 411.1418
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
  | # duration_ms 14153.0154
  |
  | run-checks: PASS (skill-sync + 14 suites)
  | process-docs: PASS (no unresolved markers in scoped non-binary files)
- 2026-07-30T11:58:37Z — moved to done
