---
id: task-024
title: "Upgrade Agent Foundry 0.6.0 -> 0.9.0"
status: in_progress
priority: p1
tags: [area:process, phase:upgrade]
blockedBy: []
createdAt: "2026-07-30T18:21:51Z"
updatedAt: "2026-07-30T18:22:12Z"
claimedBy: "shift@Shiftor"
claimedAt: "2026-07-30T18:22:06Z"
---

<!-- task-tracker:description -->
## Description



<!-- task-tracker:log -->
## Log

- 2026-07-30T18:21:51Z — created (status: backlog)
- 2026-07-30T18:22:06Z — moved to in_progress (claimed by shift@Shiftor)
- 2026-07-30T18:22:06Z — note: rubric: (1) every upgrade action from every intervening release applied or explicitly justified as a no-op; (2) every seed file restored and re-merged, none left as template; (3) every mold divergence from the step-1 report re-applied, retired, or recorded in LOCAL-CHANGES.md, file by file; (4) each retirement verified against the installed file rather than trusted from the changelog; (5) post-upgrade drift is fully explainable line by line; (6) run-checks passes
- 2026-07-30T18:22:12Z — run: node .agent-foundry/check-foundry-drift.mjs
  started 2026-07-30T18:22:12Z, exit 0 in 0.1s
  output:
  | foundry-drift: installed from Agent Foundry 0.6.0 on 2026-07-29T12:41:50.207Z
  |
  | Locally modified (mold) (1)
  |   The Foundry owns these. An upgrade replaces them — re-apply, upstream, or drop each change deliberately.
  |   - docs/SDLC.md
  |
  | Locally modified (seed) (8)
  |   Expected: the project owns these. An upgrade must not overwrite them.
  |   - AGENTS.md
  |   - BLOCKED-JOURNAL.md
  |   - CONTRIBUTING.md
  |   - HANDOFF.md
  |   - PLANNING-JOURNAL.md
  |   - docs/ENGINEERING-STANDARDS.md
  |   - docs/REVIEW-STANDARDS.md
  |   - docs/adr/README.md
  |
  | 66 unchanged, 9 diverged. Record intentional divergence in .agent-foundry/LOCAL-CHANGES.md
  | so the next upgrade does not silently revert it.
