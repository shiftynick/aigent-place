---
id: task-062
title: "Upgrade Agent Foundry 0.26.0 -> 0.27.0"
status: in_progress
priority: p1
tags: [area:process, phase:upgrade]
blockedBy: []
createdAt: "2026-08-09T03:08:37Z"
updatedAt: "2026-08-09T03:12:41Z"
claimedBy: "shift@Shiftor"
claimedAt: "2026-08-09T03:08:45Z"
---

<!-- task-tracker:description -->
## Description



<!-- task-tracker:log -->
## Log

- 2026-08-09T03:08:37Z — created (status: backlog)
- 2026-08-09T03:08:45Z — moved to in_progress (claimed by shift@Shiftor)
- 2026-08-09T03:08:45Z — note: rubric: (1) every upgrade action from every intervening release applied or explicitly justified as a no-op; (2) every seed file restored and re-merged, none left as template; (3) every mold divergence from the step-1 report re-applied, retired, or recorded in LOCAL-CHANGES.md, file by file; (4) each retirement verified against the installed file rather than trusted from the changelog; (5) post-upgrade drift is fully explainable line by line; (6) run-checks passes; (7) upstream bookkeeping from the task-061 delivery note applied exactly: cold-review and COMPATIBILITY divergences retired, task-ID trio and reconcile-seeds pair moved to Upstream status filed with the refs the note names
- 2026-08-09T03:09:00Z — run: node .agent-foundry/check-foundry-drift.mjs
  started 2026-08-09T03:09:00Z, exit 0 in 0.1s
  output:
  | foundry-drift: installed from Agent Foundry 0.26.0 on 2026-08-09T02:06:50.307Z
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
  | 94 unchanged, 18 diverged. Record intentional divergence in .agent-foundry/LOCAL-CHANGES.md
  | so the next upgrade does not silently revert it.
- 2026-08-09T03:10:15Z — note: upgrade baseline: from Agent Foundry 0.26.0 (installed 2026-08-09T02:06:50Z) to 0.27.0 from local checkout N:/agent-foundry commit b2781fd. Reinstall command: node N:/agent-foundry/scripts/bootstrap-project.mjs --target-path N:/aigent-place --project-name 'Aigent Place' --project-description '...' --force. Backup path: .agent-foundry-backups/20260809T030943298Z. Intervening releases: 0.27.0 only. Baseline drift: 11 mold + 7 seed divergences, all recorded in LOCAL-CHANGES.md.
- 2026-08-09T03:11:42Z — run: node .agent-foundry/run-checks.mjs
  started 2026-08-09T03:11:17Z, exit 0 in 25.1s
  output tail (truncated to last 30 lines):
  |       ...
  |     # Subtest: points at a reference file that exists in this tree
  |     ok 5 - points at a reference file that exists in this tree
  |       ---
  |       duration_ms: 0.2294
  |       type: 'test'
  |       ...
  |     # Subtest: still rejects an unknown verb with exit 2
  |     ok 6 - still rejects an unknown verb with exit 2
  |       ---
  |       duration_ms: 73.3155
  |       type: 'test'
  |       ...
  |     1..6
  | ok 146 - task help
  |   ---
  |   duration_ms: 438.5216
  |   type: 'suite'
  |   ...
  | 1..146
  | # tests 379
  | # suites 68
  | # pass 379
  | # fail 0
  | # cancelled 0
  | # skipped 0
  | # todo 0
  | # duration_ms 24891.5116
  |
  | run-checks: PASS (skill-sync + 17 suites)
- 2026-08-09T03:11:59Z — run: node .agent-foundry/check-foundry-drift.mjs
  started 2026-08-09T03:11:59Z, exit 0 in 0.1s
  output:
  | foundry-drift: installed from Agent Foundry 0.27.0 on 2026-08-09T03:09:43.298Z
  |
  | Locally modified (mold) (8)
  |   The Foundry owns these. An upgrade replaces them — re-apply, upstream, or drop each change deliberately.
  |   - .agent-foundry/reconcile-seeds.mjs
  |   - .agent-foundry/reconcile-seeds.test.mjs
  |   - .agents/skills/task-tracker/references/concurrency.md
  |   - .agents/skills/task-tracker/scripts/task.mjs
  |   - .agents/skills/task-tracker/scripts/task.test.mjs
  |   - .claude/skills/task-tracker/references/concurrency.md
  |   - .claude/skills/task-tracker/scripts/task.mjs
  |   - .claude/skills/task-tracker/scripts/task.test.mjs
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
  | 97 unchanged, 15 diverged. Record intentional divergence in .agent-foundry/LOCAL-CHANGES.md
  | so the next upgrade does not silently revert it.
- 2026-08-09T03:12:41Z — run: node scripts/check.mjs
  started 2026-08-09T03:11:59Z, exit 0 in 42.6s
  output tail (truncated to last 30 lines):
  |      Running tests\ruleset_persist_behavior.rs (target\debug\deps\ruleset_persist_behavior-20763967ad007f17.exe)
  |      Running tests\scripted_aigent_behavior.rs (target\debug\deps\scripted_aigent_behavior-868f771fe2f3b29c.exe)
  |      Running tests\session_behavior.rs (target\debug\deps\session_behavior-5b3200c9a1bae821.exe)
  |      Running tests\shape_budget_catalog_contract.rs (target\debug\deps\shape_budget_catalog_contract-a0488f49834a77ed.exe)
  |      Running tests\shape_validation_behavior.rs (target\debug\deps\shape_validation_behavior-887d963556dfabd7.exe)
  |      Running tests\shape_validation_bounded_cost.rs (target\debug\deps\shape_validation_bounded_cost-f5eb5f21bc801b3b.exe)
  |      Running tests\snapshot_behavior.rs (target\debug\deps\snapshot_behavior-38ee57e411957cb0.exe)
  |      Running tests\snapshot_resync_behavior.rs (target\debug\deps\snapshot_resync_behavior-9021b8921bdbaa8b.exe)
  |      Running tests\transport_behavior.rs (target\debug\deps\transport_behavior-514083eccfaa7205.exe)
  |    Doc-tests aigent_protocol
  |    Doc-tests protocol_conformance
  |    Doc-tests workload_harness
  |    Doc-tests world_server
  | npm notice run @aigent-place/protocol@0.1.0 test
  | npm notice run node --test ./test/binary-conformance.test.mjs
  | npm notice run @aigent-place/aigent-sdk@0.1.0 test
  | npm notice run node --test ./test/sdk-exports.test.mjs
  | npm notice run aigent-place@0.1.0 viewer:build
  | npm notice run npm run build -w @aigent-place/viewer
  | npm notice run @aigent-place/viewer@0.1.0 build
  | npm notice run vite build
  |
  | (!) Some chunks are larger than 500 kB after minification. Consider:
  | - Using dynamic import() to code-split the application
  | - Use build.rollupOptions.output.manualChunks to improve chunking: https://rollupjs.org/configuration-options/#output-manualchunks
  | - Adjust chunk size limit for this warning via build.chunkSizeWarningLimit.
  | npm notice run aigent-place@0.1.0 viewer:smoke
  | npm notice run npm run smoke -w @aigent-place/viewer
  | npm notice run @aigent-place/viewer@0.1.0 smoke
  | npm notice run node ./scripts/smoke.mjs
