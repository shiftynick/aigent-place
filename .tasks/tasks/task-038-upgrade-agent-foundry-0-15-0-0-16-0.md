---
id: task-038
title: "Upgrade Agent Foundry 0.15.0 -> 0.16.0"
status: in_progress
priority: p1
tags: [area:process, phase:upgrade]
blockedBy: []
createdAt: "2026-08-05T02:01:43Z"
updatedAt: "2026-08-05T02:06:16Z"
claimedBy: "shift@Shiftor"
claimedAt: "2026-08-05T02:01:52Z"
---

<!-- task-tracker:description -->
## Description



<!-- task-tracker:log -->
## Log

- 2026-08-05T02:01:43Z — created (status: backlog)
- 2026-08-05T02:01:51Z — note: rubric: (1) every upgrade action from every intervening release applied or explicitly justified as a no-op; (2) every seed file restored and re-merged, none left as template; (3) every mold divergence from the step-1 report re-applied, retired, or recorded in LOCAL-CHANGES.md, file by file; (4) each retirement verified against the installed file rather than trusted from the changelog; (5) post-upgrade drift is fully explainable line by line; (6) run-checks passes
- 2026-08-05T02:01:52Z — moved to in_progress (claimed by shift@Shiftor)
- 2026-08-05T02:01:52Z — run: node .agent-foundry/check-foundry-drift.mjs
  started 2026-08-05T02:01:52Z, exit 0 in 0.1s
  output:
  | foundry-drift: installed from Agent Foundry 0.15.0 on 2026-08-04T14:56:35.517Z
  |
  | Locally modified (mold) (10)
  |   The Foundry owns these. An upgrade replaces them — re-apply, upstream, or drop each change deliberately.
  |   - .agent-foundry/reconcile-seeds.mjs
  |   - .agent-foundry/reconcile-seeds.test.mjs
  |   - .agents/skills/execute-task/references/cold-review.md
  |   - .agents/skills/task-tracker/references/concurrency.md
  |   - .agents/skills/task-tracker/scripts/task.mjs
  |   - .agents/skills/task-tracker/scripts/task.test.mjs
  |   - .claude/skills/execute-task/references/cold-review.md
  |   - .claude/skills/task-tracker/references/concurrency.md
  |   - .claude/skills/task-tracker/scripts/task.mjs
  |   - .claude/skills/task-tracker/scripts/task.test.mjs
  |
  | Locally modified (seed) (8)
  |   Expected: the project owns these. An upgrade must not overwrite them.
  |   - .agent-foundry/LOCAL-CHANGES.md
  |   - AGENTS.md
  |   - CONTRIBUTING.md
  |   - HANDOFF.md
  |   - PLANNING-JOURNAL.md
  |   - docs/ENGINEERING-STANDARDS.md
  |   - docs/REVIEW-STANDARDS.md
  |   - docs/adr/README.md
  |
  | 91 unchanged, 18 diverged. Record intentional divergence in .agent-foundry/LOCAL-CHANGES.md
  | so the next upgrade does not silently revert it.
- 2026-08-05T02:05:48Z — note: baseline drift recorded; backup .agent-foundry-backups/20260805T020201340Z; source N:\agent-foundry 0.16.0; upgrade actions: AGENTS operator-comms+status cmds; kept stock grill-me/execute-task/SDLC; re-applied 10 mold divergences; PLANNING-JOURNAL Goal/Done when/Approved front; project-status --mark-seen + overview generated; gitignore already had status-seen+overview.html
- 2026-08-05T02:06:15Z — run: node .agent-foundry/run-checks.mjs
  started 2026-08-05T02:05:48Z, exit 0 in 27.7s
  output tail (truncated to last 30 lines):
  | # Subtest: task rm
  |     # Subtest: soft-deletes by setting status=done and adding deleted:true tag
  |     ok 1 - soft-deletes by setting status=done and adding deleted:true tag
  |       ---
  |       duration_ms: 220.4009
  |       type: 'test'
  |       ...
  |     # Subtest: keeps dependents blocked when their blocker is soft-deleted
  |     ok 2 - keeps dependents blocked when their blocker is soft-deleted
  |       ---
  |       duration_ms: 455.6968
  |       type: 'test'
  |       ...
  |     1..2
  | ok 163 - task rm
  |   ---
  |   duration_ms: 676.2059
  |   type: 'suite'
  |   ...
  | 1..163
  | # tests 386
  | # suites 66
  | # pass 384
  | # fail 0
  | # cancelled 0
  | # skipped 2
  | # todo 0
  | # duration_ms 27567.549
  |
  | run-checks: PASS (skill-sync + 20 suites)
- 2026-08-05T02:06:16Z — run: node .agent-foundry/check-foundry-drift.mjs
  started 2026-08-05T02:06:15Z, exit 0 in 0.1s
  output:
  | foundry-drift: installed from Agent Foundry 0.16.0 on 2026-08-05T02:02:01.340Z
  |
  | Locally modified (mold) (10)
  |   The Foundry owns these. An upgrade replaces them — re-apply, upstream, or drop each change deliberately.
  |   - .agent-foundry/reconcile-seeds.mjs
  |   - .agent-foundry/reconcile-seeds.test.mjs
  |   - .agents/skills/execute-task/references/cold-review.md
  |   - .agents/skills/task-tracker/references/concurrency.md
  |   - .agents/skills/task-tracker/scripts/task.mjs
  |   - .agents/skills/task-tracker/scripts/task.test.mjs
  |   - .claude/skills/execute-task/references/cold-review.md
  |   - .claude/skills/task-tracker/references/concurrency.md
  |   - .claude/skills/task-tracker/scripts/task.mjs
  |   - .claude/skills/task-tracker/scripts/task.test.mjs
  |
  | Locally modified (seed) (9)
  |   Expected: the project owns these. An upgrade must not overwrite them.
  |   - .agent-foundry/LOCAL-CHANGES.md
  |   - AGENTS.md
  |   - CLAUDE.md
  |   - CONTRIBUTING.md
  |   - HANDOFF.md
  |   - PLANNING-JOURNAL.md
  |   - docs/ENGINEERING-STANDARDS.md
  |   - docs/REVIEW-STANDARDS.md
  |   - docs/adr/README.md
  |
  | 94 unchanged, 19 diverged. Record intentional divergence in .agent-foundry/LOCAL-CHANGES.md
  | so the next upgrade does not silently revert it.
