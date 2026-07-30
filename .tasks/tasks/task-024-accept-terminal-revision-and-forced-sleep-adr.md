---
id: task-024
title: Accept terminal revision and forced-sleep ADR
status: done
priority: p0
tags: [area:architecture, milestone:foundations]
blockedBy: []
createdAt: "2026-07-30T00:41:15Z"
updatedAt: "2026-07-30T00:43:46Z"
---

<!-- task-tracker:description -->
## Description

Review ADR-0004 and explicitly accept it, reject it, or request changes. Acceptance unblocks task-010 to define revision exhaustion without allowing an ownerless active collider or a non-monotonic externally visible lifecycle transition.

<!-- task-tracker:log -->
## Log

- 2026-07-30T00:41:15Z — created (status: backlog)
- 2026-07-30T00:41:15Z — note: operator response recorded verbatim: Accept
- 2026-07-30T00:41:15Z — edited (-tag needs:operator)
- 2026-07-30T00:41:15Z — note: rubric: (1) ADR-0004 and the ADR index record accepted with the exact proposed decision. (2) The operator's exact response and resolved blocker are durable. (3) task-010 records task-024 as its dependency until this independently reviewed decision task is done. (4) Diff checks and the full gate pass and separate cold reviews find no contradiction.
- 2026-07-30T00:41:15Z — moved to in_progress (claimed by codex-root)
- 2026-07-30T00:41:15Z — moved to review
- 2026-07-30T00:41:19Z — run: git diff --check HEAD -- .
  started 2026-07-30T00:41:19Z, exit 0 in 0.1s
  output:
  | (no output)
- 2026-07-30T00:41:33Z — run: node scripts/check.mjs
  started 2026-07-30T00:41:19Z, exit 0 in 13.9s
  output tail (truncated to last 30 lines):
  |     # Subtest: soft-deletes by setting status=done and adding deleted:true tag
  |     ok 1 - soft-deletes by setting status=done and adding deleted:true tag
  |       ---
  |       duration_ms: 102.0334
  |       type: 'test'
  |       ...
  |     # Subtest: keeps dependents blocked when their blocker is soft-deleted
  |     ok 2 - keeps dependents blocked when their blocker is soft-deleted
  |       ---
  |       duration_ms: 271.7753
  |       type: 'test'
  |       ...
  |     1..2
  | ok 121 - task rm
  |   ---
  |   duration_ms: 373.9513
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
  | # duration_ms 13261.6348
  |
  | run-checks: PASS (skill-sync + 14 suites)
  | process-docs: PASS (no unresolved markers in scoped non-binary files)
- 2026-07-30T00:43:46Z — note: final cold review: rung 2 fresh subagents in separate isolated worktrees. SPEC and STANDARDS both passed with no findings; both independently reran diff-check and the full process gate (289 tests).
- 2026-07-30T00:43:46Z — moved to done
