---
id: task-038
title: "Upgrade Agent Foundry 0.15.0 -> 0.16.0"
status: in_progress
priority: p1
tags: [area:process, phase:upgrade]
blockedBy: []
createdAt: "2026-08-05T02:01:43Z"
updatedAt: "2026-08-05T02:19:31Z"
claimedBy: "shift@Shiftor"
claimedAt: "2026-08-05T02:19:31Z"
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
- 2026-08-05T02:07:23Z — moved to review
- 2026-08-05T02:07:23Z — note: cold review rung 1 (Codex) SPEC+STANDARDS concurrent
- 2026-08-05T02:19:22Z — run: node scripts/check.mjs
  started 2026-08-05T02:18:45Z, exit 0 in 36.7s
  output tail (truncated to last 30 lines):
  |      Running unittests src\lib.rs (target\debug\deps\aigent_protocol-2be7322e8a1e4d5b.exe)
  |      Running unittests src\lib.rs (target\debug\deps\protocol_conformance-3437ac2bd595267c.exe)
  |      Running unittests src\main.rs (target\debug\deps\protocol_conformance-4ddea74bf07dca6d.exe)
  |      Running unittests src\lib.rs (target\debug\deps\workload_harness-0593d857cdb62281.exe)
  |      Running unittests src\main.rs (target\debug\deps\workload_harness-9222080f938c770c.exe)
  |      Running unittests src\lib.rs (target\debug\deps\world_server-2d7c22779d6e15e7.exe)
  |      Running unittests src\main.rs (target\debug\deps\world_server-9df5988638f82bfa.exe)
  |      Running tests\aoi_behavior.rs (target\debug\deps\aoi_behavior-49d2af617aab8541.exe)
  |      Running tests\async_writer_behavior.rs (target\debug\deps\async_writer_behavior-ecb874bd312ef40d.exe)
  |      Running tests\core_behavior.rs (target\debug\deps\core_behavior-6198f984276ce85a.exe)
  |      Running tests\feature_intersection_behavior.rs (target\debug\deps\feature_intersection_behavior-02eb438a23b9049c.exe)
  |      Running tests\outbound_drain_behavior.rs (target\debug\deps\outbound_drain_behavior-dba27bd415f1fdef.exe)
  |      Running tests\persist_sqlite_behavior.rs (target\debug\deps\persist_sqlite_behavior-c4d71245086ff896.exe)
  |      Running tests\placeholder_payload_behavior.rs (target\debug\deps\placeholder_payload_behavior-5f159efe4496d0c4.exe)
  |      Running tests\reliability_behavior.rs (target\debug\deps\reliability_behavior-7aed9c4b0ea57898.exe)
  |      Running tests\ruleset_persist_behavior.rs (target\debug\deps\ruleset_persist_behavior-20763967ad007f17.exe)
  |      Running tests\scripted_aigent_behavior.rs (target\debug\deps\scripted_aigent_behavior-868f771fe2f3b29c.exe)
  |      Running tests\session_behavior.rs (target\debug\deps\session_behavior-5b3200c9a1bae821.exe)
  |      Running tests\snapshot_behavior.rs (target\debug\deps\snapshot_behavior-38ee57e411957cb0.exe)
  |      Running tests\snapshot_resync_behavior.rs (target\debug\deps\snapshot_resync_behavior-9021b8921bdbaa8b.exe)
  |      Running tests\transport_behavior.rs (target\debug\deps\transport_behavior-514083eccfaa7205.exe)
  |    Doc-tests aigent_protocol
  |    Doc-tests protocol_conformance
  |    Doc-tests workload_harness
  |    Doc-tests world_server
  |
  | (!) Some chunks are larger than 500 kB after minification. Consider:
  | - Using dynamic import() to code-split the application
  | - Use build.rollupOptions.output.manualChunks to improve chunking: https://rollupjs.org/configuration-options/#output-manualchunks
  | - Adjust chunk size limit for this warning via build.chunkSizeWarningLimit.
- 2026-08-05T02:19:22Z — note: adjudication: accepted SPEC/STANDARDS findings on missing scripts/check.mjs evidence and CLAUDE.md missing 0.16 status/overview seed merge; recording gate + merging CLAUDE.md; low audit-trail note added
- 2026-08-05T02:19:22Z — note: install audit: pre-upgrade git status clean except review-packets moved aside; bootstrap: node N:\agent-foundry\scripts\bootstrap-project.mjs --target-path N:\aigent-place --project-name 'Aigent Place' --project-description 'A repository for the Aigent Place architecture and implementation.' --force; backup .agent-foundry-backups/20260805T020201340Z
- 2026-08-05T02:19:31Z — moved to in_progress (claimed by shift@Shiftor; forced)
