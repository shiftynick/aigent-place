---
id: task-029
title: "Upgrade Agent Foundry 0.9.0 -> 0.10.0"
status: done
priority: p1
tags: [area:process, phase:upgrade]
blockedBy: []
createdAt: "2026-07-31T12:44:55Z"
updatedAt: "2026-07-31T13:03:43Z"
---

<!-- task-tracker:description -->
## Description

Install Agent Foundry 0.10.0, preserve and reconcile project-owned seeds and deliberate mold divergence, apply every 0.10.0 upgrade action, and leave the installed workflow synchronized with fully passing Foundry and repository gates.

<!-- task-tracker:log -->
## Log

- 2026-07-31T12:44:55Z — created (status: backlog)
- 2026-07-31T12:44:55Z — note: rubric: (1) every 0.10.0 upgrade action is applied or explicitly justified as a no-op; (2) every seed file is restored and re-merged, none left as stock template; (3) the docs/SDLC.md protected-default-branch mold divergence is preserved or deliberately retired and LOCAL-CHANGES.md remains accurate; (4) branch-namespaced task allocation, default-branch metadata, fail-closed aggregate checks, and Cursor shim guidance are present and verified in the installed tree; (5) post-upgrade drift is explainable line by line; (6) Foundry aggregate and repository quality gates pass, followed by cold SPEC and STANDARDS review.
- 2026-07-31T12:44:55Z — moved to in_progress (claimed by shift@Shiftor)
- 2026-07-31T12:45:13Z — run: node .agent-foundry/check-foundry-drift.mjs
  started 2026-07-31T12:45:13Z, exit 0 in 0.1s
  output:
  | foundry-drift: installed from Agent Foundry 0.9.0 on 2026-07-30T18:22:36.331Z
  |
  | Locally modified (mold) (1)
  |   The Foundry owns these. An upgrade replaces them — re-apply, upstream, or drop each change deliberately.
  |   - docs/SDLC.md
  |
  | Locally modified (seed) (8)
  |   Expected: the project owns these. An upgrade must not overwrite them.
  |   - .agent-foundry/LOCAL-CHANGES.md
  |   - AGENTS.md
  |   - BLOCKED-JOURNAL.md
  |   - CONTRIBUTING.md
  |   - HANDOFF.md
  |   - docs/ENGINEERING-STANDARDS.md
  |   - docs/REVIEW-STANDARDS.md
  |   - docs/adr/README.md
  |
  | 82 unchanged, 9 diverged. Record intentional divergence in .agent-foundry/LOCAL-CHANGES.md
  | so the next upgrade does not silently revert it.
- 2026-07-31T12:45:13Z — note: baseline: upgrading from recorded Agent Foundry 0.9.0 to local clean upstream 0.10.0 at commit 8f28688; pre-upgrade drift is one deliberate mold change (docs/SDLC.md) and eight expected project-owned seed changes.
- 2026-07-31T12:46:12Z — note: install: ran node N:\agent-foundry\scripts\bootstrap-project.mjs --target-path N:\aigent-place --project-name Aigent Place --project-description A repository for the Aigent Place architecture and implementation. --force; rollback backup: N:\aigent-place\.agent-foundry-backups\20260731T124533613Z
- 2026-07-31T12:47:16Z — note: reconciliation: restored all eight committed seeds reported by reconcile-seeds, including docs/out-of-scope/README.md. The only 0.10.0 stock seed-template change was AGENTS.md commit authority; the restored Aigent Place AGENTS.md already delegates to the new stock SDLC default and imposes stricter branch-per-task PR, ruleset, hook, push, and merge policy, so no template text was copied. Generated .agent-foundry.json now records defaultBranch main.
- 2026-07-31T12:47:16Z — note: mold retirement: compared the pre-upgrade backup docs/SDLC.md with installed 0.10.0. Stock now makes the default branch integration-only and delegates naming/enforcement to AGENTS.md; project-specific server ruleset and hook distinctions remain in AGENTS.md. Retired the old docs/SDLC.md divergence in LOCAL-CHANGES.md; drift confirms zero modified mold files.
- 2026-07-31T12:47:16Z — run: node .agent-foundry/check-skill-sync.mjs
  started 2026-07-31T12:47:16Z, exit 0 in 0.1s
  output:
  | skill-sync: PASS (12 shared skills)
- 2026-07-31T12:47:52Z — run: node .agent-foundry/run-checks.mjs
  started 2026-07-31T12:47:16Z, exit 0 in 35.6s
  output tail (truncated to last 30 lines):
  | # Subtest: task rm
  |     # Subtest: soft-deletes by setting status=done and adding deleted:true tag
  |     ok 1 - soft-deletes by setting status=done and adding deleted:true tag
  |       ---
  |       duration_ms: 226.4453
  |       type: 'test'
  |       ...
  |     # Subtest: keeps dependents blocked when their blocker is soft-deleted
  |     ok 2 - keeps dependents blocked when their blocker is soft-deleted
  |       ---
  |       duration_ms: 614.6494
  |       type: 'test'
  |       ...
  |     1..2
  | ok 151 - task rm
  |   ---
  |   duration_ms: 841.2083
  |   type: 'suite'
  |   ...
  | 1..151
  | # tests 329
  | # suites 62
  | # pass 327
  | # fail 0
  | # cancelled 0
  | # skipped 2
  | # todo 0
  | # duration_ms 35344.2574
  |
  | run-checks: PASS (skill-sync + 17 suites)
- 2026-07-31T12:48:23Z — run: node scripts/check.mjs
  started 2026-07-31T12:47:52Z, exit 0 in 31.3s
  output tail (truncated to last 30 lines):
  |     # Subtest: soft-deletes by setting status=done and adding deleted:true tag
  |     ok 1 - soft-deletes by setting status=done and adding deleted:true tag
  |       ---
  |       duration_ms: 303.9587
  |       type: 'test'
  |       ...
  |     # Subtest: keeps dependents blocked when their blocker is soft-deleted
  |     ok 2 - keeps dependents blocked when their blocker is soft-deleted
  |       ---
  |       duration_ms: 646.9982
  |       type: 'test'
  |       ...
  |     1..2
  | ok 151 - task rm
  |   ---
  |   duration_ms: 951.0669
  |   type: 'suite'
  |   ...
  | 1..151
  | # tests 329
  | # suites 62
  | # pass 327
  | # fail 0
  | # cancelled 0
  | # skipped 2
  | # todo 0
  | # duration_ms 30494.1111
  |
  | run-checks: PASS (skill-sync + 17 suites)
  | process-docs: PASS (no unresolved markers in scoped non-binary files)
- 2026-07-31T12:48:23Z — run: node .agent-foundry/check-foundry-drift.mjs
  started 2026-07-31T12:48:23Z, exit 0 in 0.1s
  output:
  | foundry-drift: installed from Agent Foundry 0.10.0 on 2026-07-31T12:45:33.613Z
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
  | 86 unchanged, 7 diverged. Record intentional divergence in .agent-foundry/LOCAL-CHANGES.md
  | so the next upgrade does not silently revert it.
- 2026-07-31T12:49:41Z — moved to review
- 2026-07-31T12:55:43Z — moved to in_progress (claimed by shift@Shiftor)
- 2026-07-31T12:55:43Z — note: cold review round 1: rung 1 via claude-in-codex, Claude Code 2.1.220 (Anthropic family), separate concurrent read-only SPEC and STANDARDS calls. Confirmed: missing per-action disposition, lost bypass-as-incident rule, imprecise preserved-seed accounting, post-doc gate invalidation, reconciler partial preflight mutation and link confinement, and uncovered durable allocation branches. Rejected missing-Git compatibility as out of contract: Foundry bootstrap requires Git and task tracking operates inside a Git repository. Fixes applied; both axes require re-review.
- 2026-07-31T12:55:43Z — note: 0.10.0 upgrade actions: (1) forced install completed and rollback backup retained; (2) reconcile --list and --restore-from-head completed, restoring eight non-preserved committed seeds while the installer preserved and re-baselined three append-only seeds; (3) stock b4510f1..8f28688 starter diff reviewed and AGENTS template delta reconciled through the project stricter policy; (4) both task-tracker trees retain branch-namespaced allocation and gained missing branch-state tests; (5) stock SDLC integration-only rule adopted while the project bypass-incident rule moved to AGENTS.md; (6) run-checks is fail-closed and excludes node_modules, verified by installed tests; (7) both Cursor skills retain Windows shim and cross-platform lookup guidance; (8) aggregate Foundry gate, repository gate, and drift report were run, with final reruns required after review fixes.
- 2026-07-31T12:55:43Z — note: drift accounting: pre-upgrade drift listed eight modified seeds, including BLOCKED-JOURNAL.md. In 0.10.0 the installer preserves and hashes .agent-foundry/LOCAL-CHANGES.md, BLOCKED-JOURNAL.md, and PLANNING-JOURNAL.md in place, so BLOCKED-JOURNAL.md becomes the installed baseline rather than a post-install divergence. Reconcile-seeds separately listed eight non-preserved seeds; docs/out-of-scope/README.md was in that restore set but was not pre-upgrade drift.
- 2026-07-31T12:55:45Z — run: node --test .agent-foundry/reconcile-seeds.test.mjs
  started 2026-07-31T12:55:43Z, exit 0 in 1.5s
  output tail (truncated to last 30 lines):
  |   duration_ms: 533.1454
  |   type: 'test'
  |   ...
  | # Subtest: refuses to overwrite a seed changed after installation
  | ok 4 - refuses to overwrite a seed changed after installation
  |   ---
  |   duration_ms: 319.4802
  |   type: 'test'
  |   ...
  | # Subtest: validates every seed before restoring any of them
  | ok 5 - validates every seed before restoring any of them
  |   ---
  |   duration_ms: 471.8129
  |   type: 'test'
  |   ...
  | # Subtest: refuses seed paths that traverse a symbolic link
  | ok 6 - refuses seed paths that traverse a symbolic link
  |   ---
  |   duration_ms: 7.9738
  |   type: 'test'
  |   ...
  | 1..6
  | # tests 6
  | # suites 0
  | # pass 6
  | # fail 0
  | # cancelled 0
  | # skipped 0
  | # todo 0
  | # duration_ms 1409.9917
- 2026-07-31T12:56:13Z — run: node --test .agents/skills/task-tracker/scripts/task.test.mjs
  started 2026-07-31T12:55:45Z, exit 0 in 27.9s
  output tail (truncated to last 30 lines):
  |   type: 'suite'
  |   ...
  | # Subtest: task rm
  |     # Subtest: soft-deletes by setting status=done and adding deleted:true tag
  |     ok 1 - soft-deletes by setting status=done and adding deleted:true tag
  |       ---
  |       duration_ms: 201.9184
  |       type: 'test'
  |       ...
  |     # Subtest: keeps dependents blocked when their blocker is soft-deleted
  |     ok 2 - keeps dependents blocked when their blocker is soft-deleted
  |       ---
  |       duration_ms: 462.0011
  |       type: 'test'
  |       ...
  |     1..2
  | ok 13 - task rm
  |   ---
  |   duration_ms: 664.0484
  |   type: 'suite'
  |   ...
  | 1..13
  | # tests 63
  | # suites 13
  | # pass 63
  | # fail 0
  | # cancelled 0
  | # skipped 0
  | # todo 0
  | # duration_ms 27804.9834
- 2026-07-31T12:56:13Z — run: node .agent-foundry/check-skill-sync.mjs
  started 2026-07-31T12:56:13Z, exit 0 in 0.1s
  output:
  | skill-sync: PASS (12 shared skills)
- 2026-07-31T12:56:28Z — run: node --test .agent-foundry/reconcile-seeds.test.mjs
  started 2026-07-31T12:56:26Z, exit 0 in 1.5s
  output tail (truncated to last 30 lines):
  |   duration_ms: 503.0827
  |   type: 'test'
  |   ...
  | # Subtest: refuses to overwrite a seed changed after installation
  | ok 4 - refuses to overwrite a seed changed after installation
  |   ---
  |   duration_ms: 356.9673
  |   type: 'test'
  |   ...
  | # Subtest: validates every seed before restoring any of them
  | ok 5 - validates every seed before restoring any of them
  |   ---
  |   duration_ms: 454.623
  |   type: 'test'
  |   ...
  | # Subtest: refuses seed paths that traverse a symbolic link
  | ok 6 - refuses seed paths that traverse a symbolic link
  |   ---
  |   duration_ms: 2.8661
  |   type: 'test'
  |   ...
  | 1..6
  | # tests 6
  | # suites 0
  | # pass 6
  | # fail 0
  | # cancelled 0
  | # skipped 0
  | # todo 0
  | # duration_ms 1394.9659
- 2026-07-31T12:56:28Z — moved to review
- 2026-07-31T12:59:22Z — note: cold review round 2: rung 1 via claude-in-codex, Claude Code 2.1.220 (Anthropic family), separate concurrent read-only SPEC and STANDARDS calls. Aggregate-gate and drift findings were valid but intentionally pending under SDLC final-validation sequencing; removed stale pre-fix counts from HANDOFF before the final run. Rejected metadata warning: malformed metadata intentionally fails safe to a namespaced ID and the Foundry validator diagnoses it. Rejected default-branch filing conflict: the upgrade procedure files the uncommitted card on the default branch, then carries it onto the task branch; it never commits to main. Detached-HEAD same-commit collision is a low-confidence upstream design risk outside this upgrade and is recorded here for future Foundry evaluation.
- 2026-07-31T12:59:52Z — run: node .agent-foundry/run-checks.mjs
  started 2026-07-31T12:59:22Z, exit 0 in 30.3s
  output tail (truncated to last 30 lines):
  | # Subtest: task rm
  |     # Subtest: soft-deletes by setting status=done and adding deleted:true tag
  |     ok 1 - soft-deletes by setting status=done and adding deleted:true tag
  |       ---
  |       duration_ms: 198.9359
  |       type: 'test'
  |       ...
  |     # Subtest: keeps dependents blocked when their blocker is soft-deleted
  |     ok 2 - keeps dependents blocked when their blocker is soft-deleted
  |       ---
  |       duration_ms: 534.0519
  |       type: 'test'
  |       ...
  |     1..2
  | ok 153 - task rm
  |   ---
  |   duration_ms: 733.0961
  |   type: 'suite'
  |   ...
  | 1..153
  | # tests 337
  | # suites 62
  | # pass 335
  | # fail 0
  | # cancelled 0
  | # skipped 2
  | # todo 0
  | # duration_ms 30051.1786
  |
  | run-checks: PASS (skill-sync + 17 suites)
- 2026-07-31T13:00:25Z — run: node scripts/check.mjs
  started 2026-07-31T12:59:53Z, exit 0 in 32.1s
  output tail (truncated to last 30 lines):
  |     # Subtest: soft-deletes by setting status=done and adding deleted:true tag
  |     ok 1 - soft-deletes by setting status=done and adding deleted:true tag
  |       ---
  |       duration_ms: 220.4277
  |       type: 'test'
  |       ...
  |     # Subtest: keeps dependents blocked when their blocker is soft-deleted
  |     ok 2 - keeps dependents blocked when their blocker is soft-deleted
  |       ---
  |       duration_ms: 539.3142
  |       type: 'test'
  |       ...
  |     1..2
  | ok 153 - task rm
  |   ---
  |   duration_ms: 759.849
  |   type: 'suite'
  |   ...
  | 1..153
  | # tests 337
  | # suites 62
  | # pass 335
  | # fail 0
  | # cancelled 0
  | # skipped 2
  | # todo 0
  | # duration_ms 31375.0568
  |
  | run-checks: PASS (skill-sync + 17 suites)
  | process-docs: PASS (no unresolved markers in scoped non-binary files)
- 2026-07-31T13:00:25Z — run: node .agent-foundry/check-foundry-drift.mjs
  started 2026-07-31T13:00:25Z, exit 0 in 0.1s
  output:
  | foundry-drift: installed from Agent Foundry 0.10.0 on 2026-07-31T12:45:33.613Z
  |
  | Locally modified (mold) (4)
  |   The Foundry owns these. An upgrade replaces them — re-apply, upstream, or drop each change deliberately.
  |   - .agent-foundry/reconcile-seeds.mjs
  |   - .agent-foundry/reconcile-seeds.test.mjs
  |   - .agents/skills/task-tracker/scripts/task.test.mjs
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
  | 82 unchanged, 11 diverged. Record intentional divergence in .agent-foundry/LOCAL-CHANGES.md
  | so the next upgrade does not silently revert it.
- 2026-07-31T13:03:43Z — note: cold review round 3 (final capped round): rung 1 via claude-in-codex, Claude Code 2.1.220 (Anthropic family), separate concurrent read-only SPEC and STANDARDS calls. Corrected prior shorthand: malformed metadata first falls through to origin/HEAD and retains compact IDs when that identifies the current default branch; only absence of both valid metadata and usable remote HEAD fails safe to a branch namespace. Remaining diagnostic and detached-same-commit collision risks are deferred to task-9863417679000001. Governance adjudication: the operator explicitly requested this 0.10.0 upgrade, and before mutation was told the plan would reconcile the protected-branch policy across AGENTS.md and docs/SDLC.md; that is the required ask-first authorization for these task-scoped governance edits. No unresolved release blocker remains.
- 2026-07-31T13:03:43Z — moved to done
