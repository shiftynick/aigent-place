---
id: task-059
title: "Upgrade Agent Foundry 0.23.0 -> 0.24.0"
status: done
priority: p1
tags: [area:process, phase:upgrade]
blockedBy: []
createdAt: "2026-08-08T17:19:20Z"
updatedAt: "2026-08-08T17:31:53Z"
---

<!-- task-tracker:description -->
## Description



<!-- task-tracker:log -->
## Log

- 2026-08-08T17:19:20Z — created (status: backlog)
- 2026-08-08T17:19:27Z — moved to in_progress (claimed by shift@Shiftor)
- 2026-08-08T17:19:27Z — note: rubric: (1) every 0.24.0 upgrade action is applied or explicitly justified as a no-op; (2) every seed file is restored and re-merged, none left as template; (3) every mold divergence in the baseline report is re-applied, retired, or recorded in LOCAL-CHANGES.md file by file; (4) each retirement is verified against the installed file rather than trusted from the changelog; (5) post-upgrade drift is fully explainable line by line; (6) run-checks and the repository quality gate pass
- 2026-08-08T17:19:27Z — note: source: approved local checkout N:\agent-foundry; installed 0.23.0; target 0.24.0; no breaking changes; upgrade actions cover planning lenses, interface outlines, external facts, shift-left review, and severity-gated re-review
- 2026-08-08T17:19:27Z — run: node .agent-foundry/check-foundry-drift.mjs
  started 2026-08-08T17:19:27Z, exit 0 in 0.1s
  output:
  | foundry-drift: installed from Agent Foundry 0.23.0 on 2026-08-08T16:13:37.565Z
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
- 2026-08-08T17:20:06Z — note: forced reinstall: node N:\agent-foundry\scripts\bootstrap-project.mjs --target-path N:\aigent-place --project-name Aigent Place --project-description A repository for the Aigent Place architecture and implementation. --force; recovery backup: N:\aigent-place\.agent-foundry-backups\20260808T171932359Z
- 2026-08-08T17:24:21Z — note: reconciliation: preserved .agent-foundry/agent-headless/COMPATIBILITY.md because 0.24 stock still contains the stray 'An'; preserved .agent-foundry/reconcile-seeds.mjs and .agent-foundry/reconcile-seeds.test.mjs because 0.24 stock did not change them or add equivalent atomic/link-safe behavior; preserved both execute-task cold-review.md divergences by merging the packet-as-data prompt boundary into the new severity-gated stock text; preserved both task-tracker concurrency.md, task.mjs, and task.test.mjs divergences because 0.24 stock did not change those files or add equivalent detached-worktree/default-branch protections. LOCAL-CHANGES.md remains accurate for all 11 mold differences.
- 2026-08-08T17:24:21Z — note: upgrade actions: forced 0.24 install landed plan-milestone planning lenses, execute-task interface outline and warm self-pass, docs/SDLC external-facts guidance, and severity-gated review rules; docs/external creation is correctly a no-op until first use.
- 2026-08-08T17:25:01Z — note: warm self-pass: rubric pass confirmed all 0.24 upgrade actions in the diff, eight committed seed paths equal HEAD, all unchanged-stock mold customizations equal the recovery backup, both cold-review files combine the 0.24 rules with the local prompt boundary, and post-upgrade drift names the same 11 documented mold differences. Standards pass found no whitespace, shared-skill sync, scope, unsafe-write, or documentation defect; no new interface or architecture decision was introduced.
- 2026-08-08T17:25:02Z — moved to review
- 2026-08-08T17:27:24Z — note: cold review round 1: Claude answer-only, model claude-haiku-4-5, highest available cross-family rung; SPEC and STANDARDS ran independently and concurrently. Confirmed high: gates not yet executed, resolved through the lifecycle validation step. Confirmed medium evidence gap: post-upgrade drift seed count changed 7 to 6 because the 0.24 installer preserved LOCAL-CHANGES.md and rebaselined its manifest hash to the preserved content; no seed content changed. Confirmed medium packet gap: LOCAL-CHANGES.md contents were omitted; live inspection confirms all 11 entries still describe the installed divergences, including the re-merged prompt boundary. Re-review packet will include it. Rejected lows: the operator's direct upgrade request plus disclosed plan authorized the 0.24 SDLC payload; docs/external is explicitly lazy-created by the 0.24 upgrade action; the upgrade procedure creates the task with its durable objective in the log.
- 2026-08-08T17:27:53Z — run: node .agent-foundry/run-checks.mjs
  started 2026-08-08T17:27:28Z, exit 0 in 25.5s
  output tail (truncated to last 30 lines):
  |       ...
  |     # Subtest: points at a reference file that exists in this tree
  |     ok 5 - points at a reference file that exists in this tree
  |       ---
  |       duration_ms: 0.2391
  |       type: 'test'
  |       ...
  |     # Subtest: still rejects an unknown verb with exit 2
  |     ok 6 - still rejects an unknown verb with exit 2
  |       ---
  |       duration_ms: 54.1519
  |       type: 'test'
  |       ...
  |     1..6
  | ok 146 - task help
  |   ---
  |   duration_ms: 300.7645
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
  | # duration_ms 25306.6466
  |
  | run-checks: PASS (skill-sync + 17 suites)
- 2026-08-08T17:28:53Z — run: node scripts/check.mjs
  started 2026-08-08T17:27:57Z, exit 0 in 55.4s
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
- 2026-08-08T17:28:58Z — run: node .agent-foundry/check-foundry-drift.mjs
  started 2026-08-08T17:28:58Z, exit 0 in 0.2s
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
- 2026-08-08T17:31:43Z — note: cold review round 2: Claude answer-only, model claude-haiku-4-5, highest available cross-family rung; SPEC PASS with all six rubric lines checked. STANDARDS findings adjudicated: rejected medium governance finding because the operator directly requested this local-source Foundry upgrade and the 0.24 SDLC/re-review payload was disclosed before installation; merge remains ask-first. Rejected medium transition-table finding after repository-wide search: task.mjs governs allowed status moves only, docs/SDLC.md governs review severity, and no stale unconditional re-review rule remains. Rejected low docs/external finding because 0.24 explicitly defines lazy creation. Rejected low packet-attestation finding because recorded command evidence plus exact diff/status are the lifecycle evidence boundary.
- 2026-08-08T17:31:53Z — note: documentation closeout: HANDOFF.md still carries older historical Foundry checkpoints, but this upgrade does not change product direction, phase, or next execution step, so no handoff rewrite is required.
- 2026-08-08T17:31:53Z — moved to done
