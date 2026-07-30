---
id: task-026
title: "Upgrade Agent Foundry 0.6.0 -> 0.9.0"
status: done
priority: p1
tags: [area:process, phase:upgrade]
blockedBy: []
createdAt: "2026-07-30T18:21:51Z"
updatedAt: "2026-07-30T18:41:53Z"
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
- 2026-07-30T18:25:52Z — note: upgrade applied 0.6.0 -> 0.9.0. Backup: .agent-foundry-backups/20260730T182236331Z. Seed files restored from git and re-merged (only AGENTS.md needed new content: cursor-cli row + twelve-workflow count). Single mold divergence docs/SDLC.md 'Protected default branch' re-applied on the new Commit authority section and now recorded in LOCAL-CHANGES.md. 0.7.0 actions 2-3 and 0.8.0 actions 2-6 are no-ops: those files carried no local drift in the step-1 report, verified against the installed tree. 0.9.0 actions 2/5 no-op: no pre-existing cursor-cli or references/ paths; codex-in-claude remains the automatic counterpart bridge. run-checks: PASS (skill-sync + 16 suites, up from 14; 2 POSIX-only cursor-agent tests skip on Windows).
- 2026-07-30T18:25:53Z — run: node .agent-foundry/check-foundry-drift.mjs
  started 2026-07-30T18:25:53Z, exit 0 in 0.1s
  output:
  | foundry-drift: installed from Agent Foundry 0.9.0 on 2026-07-30T18:22:36.331Z
  |
  | Locally modified (mold) (1)
  |   The Foundry owns these. An upgrade replaces them — re-apply, upstream, or drop each change deliberately.
  |   - docs/SDLC.md
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
  | 83 unchanged, 8 diverged. Record intentional divergence in .agent-foundry/LOCAL-CHANGES.md
  | so the next upgrade does not silently revert it.
- 2026-07-30T18:26:19Z — run: node scripts/check.mjs
  started 2026-07-30T18:26:01Z, exit 0 in 18.2s
  output tail (truncated to last 30 lines):
  |     # Subtest: soft-deletes by setting status=done and adding deleted:true tag
  |     ok 1 - soft-deletes by setting status=done and adding deleted:true tag
  |       ---
  |       duration_ms: 139.0369
  |       type: 'test'
  |       ...
  |     # Subtest: keeps dependents blocked when their blocker is soft-deleted
  |     ok 2 - keeps dependents blocked when their blocker is soft-deleted
  |       ---
  |       duration_ms: 347.8174
  |       type: 'test'
  |       ...
  |     1..2
  | ok 141 - task rm
  |   ---
  |   duration_ms: 486.9781
  |   type: 'suite'
  |   ...
  | 1..141
  | # tests 309
  | # suites 62
  | # pass 307
  | # fail 0
  | # cancelled 0
  | # skipped 2
  | # todo 0
  | # duration_ms 17353.7966
  |
  | run-checks: PASS (skill-sync + 16 suites)
  | process-docs: PASS (no unresolved markers in scoped non-binary files)
- 2026-07-30T18:41:53Z — moved to review
- 2026-07-30T18:41:53Z — note: delivered via PR #9 (squash 9171ebe); process-gate passed on the PR; backup .agent-foundry-backups/20260730T182236331Z deleted after operator acceptance
- 2026-07-30T18:41:53Z — moved to done
