---
id: task-061
title: "Upgrade Agent Foundry 0.28.0 -> 0.30.1"
status: done
priority: p1
tags: [area:process, phase:upgrade]
blockedBy: []
createdAt: "2026-08-10T21:54:22Z"
updatedAt: "2026-08-10T21:56:50Z"
---

<!-- task-tracker:description -->
## Description



<!-- task-tracker:log -->
## Log

- 2026-08-10T21:54:22Z — created (status: backlog)
- 2026-08-10T21:54:22Z — moved to in_progress (claimed by shift@Shiftor)
- 2026-08-10T21:54:22Z — note: rubric: (1) every upgrade action from every intervening release applied or explicitly justified as a no-op; (2) every seed file restored and re-merged, none left as template; (3) every mold divergence from the step-1 report re-applied, retired, or recorded in LOCAL-CHANGES.md, file by file; (4) each retirement verified against the installed file rather than trusted from the changelog; (5) post-upgrade drift is fully explainable line by line; (6) run-checks passes
- 2026-08-10T21:54:22Z — run: node .agent-foundry/check-foundry-drift.mjs
  started 2026-08-10T21:54:22Z, exit 0 in 0.1s
  output:
  | foundry-drift: installed from Agent Foundry 0.28.0 on 2026-08-09T23:16:32.155Z
  |
  | Locally modified (seed) (7)
  |   Expected: the project owns these. An upgrade must not overwrite them.
  |   - .agent-foundry/LOCAL-CHANGES.md
  |   - AGENTS.md
  |   - CONTRIBUTING.md
  |   - HANDOFF.md
  |   - docs/ENGINEERING-STANDARDS.md
  |   - docs/REVIEW-STANDARDS.md
  |   - docs/adr/README.md
  |
  | 105 unchanged, 7 diverged. Record intentional divergence in .agent-foundry/LOCAL-CHANGES.md
  | so the next upgrade does not silently revert it.
- 2026-08-10T21:56:20Z — note: upgrade plan applied: 0.29.0 agent-headless allowlist + models.md; 0.30.0 presets + timeout stack + skill/SDLC; 0.30.1 process-tree. No mold divergences to re-apply. Backup: N:\aigent-place\.agent-foundry-backups"
- 2026-08-10T21:56:50Z — run: node .agent-foundry/run-checks.mjs
  started 2026-08-10T21:56:20Z, exit 0 in 29.2s
  output tail (truncated to last 30 lines):
  |       ...
  |     # Subtest: points at a reference file that exists in this tree
  |     ok 5 - points at a reference file that exists in this tree
  |       ---
  |       duration_ms: 0.2006
  |       type: 'test'
  |       ...
  |     # Subtest: still rejects an unknown verb with exit 2
  |     ok 6 - still rejects an unknown verb with exit 2
  |       ---
  |       duration_ms: 43.3584
  |       type: 'test'
  |       ...
  |     1..6
  | ok 159 - task help
  |   ---
  |   duration_ms: 234.2405
  |   type: 'suite'
  |   ...
  | 1..159
  | # tests 417
  | # suites 72
  | # pass 417
  | # fail 0
  | # cancelled 0
  | # skipped 0
  | # todo 0
  | # duration_ms 28989.9491
  |
  | run-checks: PASS (skill-sync + 18 suites)
- 2026-08-10T21:56:50Z — run: node .agent-foundry/check-foundry-drift.mjs
  started 2026-08-10T21:56:50Z, exit 0 in 0.1s
  output:
  | foundry-drift: installed from Agent Foundry 0.30.1 on 2026-08-10T21:54:59.845Z
  |
  | Locally modified (seed) (6)
  |   Expected: the project owns these. An upgrade must not overwrite them.
  |   - AGENTS.md
  |   - CONTRIBUTING.md
  |   - HANDOFF.md
  |   - docs/ENGINEERING-STANDARDS.md
  |   - docs/REVIEW-STANDARDS.md
  |   - docs/adr/README.md
  |
  | 114 unchanged, 6 diverged. Record intentional divergence in .agent-foundry/LOCAL-CHANGES.md
  | so the next upgrade does not silently revert it.
- 2026-08-10T21:56:50Z — moved to review
- 2026-08-10T21:56:50Z — moved to done
