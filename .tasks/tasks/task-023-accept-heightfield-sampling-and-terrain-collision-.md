---
id: task-023
title: Accept heightfield sampling and terrain collision ADR
status: done
priority: p0
tags: [area:architecture, milestone:foundations]
blockedBy: []
createdAt: "2026-07-30T00:11:47Z"
updatedAt: "2026-07-30T00:22:24Z"
---

<!-- task-tracker:description -->
## Description

Review ADR-0003 and explicitly accept it, reject it, or request specific changes. Acceptance unblocks task-010 to finish deterministic grounding, terrain sweep, wake, restore, and conformance behavior; the choice fixes persisted height samples, chunk seams, and authoritative collision geometry.

<!-- task-tracker:log -->
## Log

- 2026-07-30T00:11:47Z — created (status: backlog)
- 2026-07-30T00:11:56Z — note: blocked: awaiting the operator's explicit decision on docs/adr/0003-heightfield-sampling-and-terrain-collision.md
- 2026-07-30T00:11:56Z — moved to blocked
- 2026-07-30T00:14:21Z — edited (-tag needs:operator)
- 2026-07-30T00:14:21Z — note: operator response recorded verbatim: Accept
- 2026-07-30T00:14:21Z — moved to backlog
- 2026-07-30T00:14:22Z — note: rubric: (1) ADR-0003 status and ADR index both record accepted without changing the approved decision text. (2) The operator's exact response is logged and the blocked journal marks the decision condition resolved. (3) Repository diff checks and the full process gate pass, and a cold review finds no acceptance-record contradiction.
- 2026-07-30T00:14:22Z — moved to in_progress (claimed by codex-root)
- 2026-07-30T00:14:22Z — moved to review
- 2026-07-30T00:20:05Z — run: git diff --check 503f7be^ 503f7be
  started 2026-07-30T00:20:05Z, exit 0 in 0.1s
  output:
  | (no output)
- 2026-07-30T00:20:19Z — run: node scripts/check.mjs
  started 2026-07-30T00:20:05Z, exit 0 in 13.8s
  output tail (truncated to last 30 lines):
  |     # Subtest: soft-deletes by setting status=done and adding deleted:true tag
  |     ok 1 - soft-deletes by setting status=done and adding deleted:true tag
  |       ---
  |       duration_ms: 112.6767
  |       type: 'test'
  |       ...
  |     # Subtest: keeps dependents blocked when their blocker is soft-deleted
  |     ok 2 - keeps dependents blocked when their blocker is soft-deleted
  |       ---
  |       duration_ms: 266.8427
  |       type: 'test'
  |       ...
  |     1..2
  | ok 121 - task rm
  |   ---
  |   duration_ms: 379.6264
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
  | # duration_ms 13186.6538
  |
  | run-checks: PASS (skill-sync + 14 suites)
  | process-docs: PASS (no unresolved markers in scoped non-binary files)
- 2026-07-30T00:20:29Z — note: round 1 cold review: rung 2 fresh subagents, separate SPEC and STANDARDS. Confirmed delivery must use its own task branch/PR, task-010 must durably record the task-023 dependency, and validation evidence must be recorded in this card. Fixed all three by splitting task-023 from task-010, updating task-010 to blocked by task-023, and recording diff-check plus full-gate runs. Adjudication: the ADR workflow explicitly permits an initial accepted commit when the operator already decided; the exact proposed text was presented before the operator replied Accept, and the accepted commit changes only its status relative to that presented text.
- 2026-07-30T00:22:24Z — note: final cold review: round 2 used rung 2 fresh subagents in separate isolated worktrees. SPEC and STANDARDS both passed with no remaining defects; reviewers independently reran diff-check and the full process gate (289 tests).
- 2026-07-30T00:22:24Z — moved to done
