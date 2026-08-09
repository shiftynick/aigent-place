---
id: task-060
title: "Upgrade Agent Foundry 0.24.0 -> 0.28.0"
status: done
priority: p1
tags: [area:process, phase:upgrade]
blockedBy: []
createdAt: "2026-08-09T23:16:25Z"
updatedAt: "2026-08-09T23:19:18Z"
---

<!-- task-tracker:description -->
## Description



<!-- task-tracker:log -->
## Log

- 2026-08-09T23:16:25Z — created (status: backlog)
- 2026-08-09T23:16:25Z — moved to in_progress (claimed by shift@Shiftor)
- 2026-08-09T23:16:25Z — note: rubric: (1) every upgrade action from every intervening release applied or explicitly justified as a no-op; (2) every seed file restored and re-merged, none left as template; (3) every mold divergence from the step-1 report re-applied, retired, or recorded in LOCAL-CHANGES.md, file by file; (4) each retirement verified against the installed file rather than trusted from the changelog; (5) post-upgrade drift is fully explainable line by line; (6) run-checks passes
- 2026-08-09T23:16:26Z — run: node .agent-foundry/check-foundry-drift.mjs
  started 2026-08-09T23:16:25Z, exit 0 in 0.1s
  output:
  | foundry-drift: installed from Agent Foundry 0.24.0 on 2026-08-08T17:19:32.359Z
  |
  | Locally modified (mold) (11)
  |   The Foundry owns these. An upgrade replaces them — re-apply, upstream, or drop each change deliberately.
  |   - .agent-foundry/agent-headless/COMPATIBILITY.md
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
  | Locally modified (seed) (6)
  |   Expected: the project owns these. An upgrade must not overwrite them.
  |   - AGENTS.md
  |   - CONTRIBUTING.md
  |   - HANDOFF.md
  |   - docs/ENGINEERING-STANDARDS.md
  |   - docs/REVIEW-STANDARDS.md
  |   - docs/adr/README.md
  |
  | 95 unchanged, 17 diverged. Record intentional divergence in .agent-foundry/LOCAL-CHANGES.md
  | so the next upgrade does not silently revert it.
- 2026-08-09T23:18:21Z — note: backup: .agent-foundry-backups/20260809T231632155Z. All 11 mold divergences RETIRED, each verified against the installed 0.28.0 file rather than the changelog: COMPATIBILITY.md stray token absent and the comma present; the packet-as-data boundary is inside the fenced prompt template (stock wording is broader than this project's - it enumerates the carriers, names the axis as uncapturable, and asks the reviewer to report such text as a finding); task.mjs carries the worktree-keyed detached namespace and the default-branch warning; concurrency.md documents both; reconcile-seeds.mjs preflights and rejects link traversal; both test files carry the matching coverage. Note the two concurrency.md copies were already byte-identical to 0.28.0 stock before the install - the Foundry adopted this project's paragraph verbatim.
- 2026-08-09T23:18:21Z — note: 0.26.0 action re defaultBranch: .agent-foundry.json records 'main', which is this repository's real default branch; no correction needed. 0.25.0 and 0.26.0 execute-task/cold-review actions were satisfied by the forced reinstall plus the divergence check above.
- 2026-08-09T23:18:48Z — run: node .agent-foundry/run-checks.mjs
  started 2026-08-09T23:18:21Z, exit 0 in 26.5s
  output tail (truncated to last 30 lines):
  |       ...
  |     # Subtest: points at a reference file that exists in this tree
  |     ok 5 - points at a reference file that exists in this tree
  |       ---
  |       duration_ms: 0.2213
  |       type: 'test'
  |       ...
  |     # Subtest: still rejects an unknown verb with exit 2
  |     ok 6 - still rejects an unknown verb with exit 2
  |       ---
  |       duration_ms: 45.9017
  |       type: 'test'
  |       ...
  |     1..6
  | ok 152 - task help
  |   ---
  |   duration_ms: 246.931
  |   type: 'suite'
  |   ...
  | 1..152
  | # tests 393
  | # suites 68
  | # pass 393
  | # fail 0
  | # cancelled 0
  | # skipped 0
  | # todo 0
  | # duration_ms 26279.5874
  |
  | run-checks: PASS (skill-sync + 17 suites)
- 2026-08-09T23:19:18Z — moved to review
- 2026-08-09T23:19:18Z — moved to done
