---
id: task-013
title: Specify workload and degradation contracts
status: done
priority: p0
tags: [area:architecture, milestone:foundations]
blockedBy: []
createdAt: "2026-07-29T12:55:19Z"
updatedAt: "2026-08-04T16:07:00Z"
---

<!-- task-tracker:description -->
## Description

Write the normative Step 0 workload targets, measurement definitions, connection/AOI/queue limits, cadence decoupling, and ordered degradation ladder. Acceptance: each threshold has a measurement window and pass/fail definition, overload transitions are deterministic, and the future load harness can consume the contract without guessing.

<!-- task-tracker:log -->
## Log

- 2026-07-29T12:55:19Z — created (status: backlog)
- 2026-08-04T15:49:32Z — note: operator: use your judgement on all open Step 0 questions (2026-08-04)
- 2026-08-04T15:49:33Z — note: judgment: viewer cadence 10->5->2 Hz; AOI 100->50->25; aigent percept degrade 5->2->1 Hz floor; queue/disconnect remain 256KiB / 2s as protocol; measurement windows: pass if overrun_rate <1% over rolling 60s; degrade when overrun_rate >5% sustained 30s; refuse new viewers after AOI rung; aigents prioritized over viewers
- 2026-08-04T15:49:33Z — note: rubric: (1) workload/v1 CONTRACT.md defines every §1 target with measurement window and pass/fail (2) ordered degradation ladder is deterministic and checkable via fixtures (3) scripts/workload-contract(.test).mjs evaluate fixtures; check.mjs runs them (4) ADR records judgment defaults; README links contract (5) future load harness can consume numeric thresholds without guessing
- 2026-08-04T15:49:33Z — moved to in_progress (claimed by shift@Shiftor)
- 2026-08-04T15:53:54Z — note: chose discrete cadence 10/5/2, AOI 100/50/25, percept floor 5/2/1; pass <1%/60s and degrade >5%/30s; one-step advance/retreat at 600-tick boundaries; queue disconnect deferred to protocol constants
- 2026-08-04T15:53:54Z — moved to review
- 2026-08-04T16:06:47Z — run: node scripts/check.mjs
  started 2026-08-04T16:06:16Z, exit 0 in 31.4s
  output tail (truncated to last 30 lines):
  |     # Subtest: soft-deletes by setting status=done and adding deleted:true tag
  |     ok 1 - soft-deletes by setting status=done and adding deleted:true tag
  |       ---
  |       duration_ms: 245.8435
  |       type: 'test'
  |       ...
  |     # Subtest: keeps dependents blocked when their blocker is soft-deleted
  |     ok 2 - keeps dependents blocked when their blocker is soft-deleted
  |       ---
  |       duration_ms: 564.2801
  |       type: 'test'
  |       ...
  |     1..2
  | ok 159 - task rm
  |   ---
  |   duration_ms: 810.2558
  |   type: 'suite'
  |   ...
  | 1..159
  | # tests 359
  | # suites 62
  | # pass 357
  | # fail 0
  | # cancelled 0
  | # skipped 2
  | # todo 0
  | # duration_ms 30572.6357
  |
  | run-checks: PASS (skill-sync + 18 suites)
  | process-docs: PASS (no unresolved markers in scoped non-binary files)
- 2026-08-04T16:07:00Z — note: cold-review: rung 1 (separate CLI, different model family) — SPEC via codex, STANDARDS via claude; 3 rounds; must-fix fixed (pass/fail for all targets, percept floor null until after refuse, role AOI, protocol queue import, capacity sustain, ladder-to-8, queue disconnect 40, cadence fail, retreat-from-refuse, sim-tick measurement wording). Remaining at cap: wall-clock 20Hz band deferred to task-009; VIEWERS_DEGRADED workload-owned until protocol enum; ADR accepted under operator judgement go-ahead.
- 2026-08-04T16:07:00Z — moved to done
