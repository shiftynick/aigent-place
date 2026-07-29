---
id: task-001
title: Tailor Agent Foundry bootstrap to this project
status: done
priority: p0
tags: [area:process, phase:bootstrap]
blockedBy: []
createdAt: "2026-07-29T12:42:09Z"
updatedAt: "2026-07-29T13:15:00Z"
---

<!-- task-tracker:description -->
## Description

Replace customization markers using live repository evidence; record sources of truth, product invariants, real validation commands, and the initial dependency-ordered implementation front. Validate both skill trees and run cold SPEC/STANDARDS review.

<!-- task-tracker:log -->
## Log

- 2026-07-29T12:42:09Z — created (status: backlog)
- 2026-07-29T12:42:09Z — moved to in_progress (claimed by shift@Shiftor)
- 2026-07-29T12:42:09Z — note: rubric: (1) authoritative project orientation is evidence-based; (2) all customization markers are resolved or explicitly scoped; (3) validation commands execute; (4) initial tasks are dependency-ordered and context-sized; (5) cold SPEC and STANDARDS reviews are adjudicated
- 2026-07-29T12:46:05Z — run: node .agent-foundry/run-checks.mjs
  started 2026-07-29T12:45:50Z, exit 0 in 15.2s
  output tail (truncated to last 30 lines):
  | # Subtest: task rm
  |     # Subtest: soft-deletes by setting status=done and adding deleted:true tag
  |     ok 1 - soft-deletes by setting status=done and adding deleted:true tag
  |       ---
  |       duration_ms: 124.3004
  |       type: 'test'
  |       ...
  |     # Subtest: keeps dependents blocked when their blocker is soft-deleted
  |     ok 2 - keeps dependents blocked when their blocker is soft-deleted
  |       ---
  |       duration_ms: 293.9025
  |       type: 'test'
  |       ...
  |     1..2
  | ok 121 - task rm
  |   ---
  |   duration_ms: 418.3154
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
  | # duration_ms 14974.6772
  |
  | run-checks: PASS (skill-sync + 14 suites)
- 2026-07-29T12:46:17Z — run: node -e const fs=require('fs'); const files=['AGENTS.md','CONTRIBUTING.md','HANDOFF.md','docs/ENGINEERING-STANDARDS.md','docs/REVIEW-STANDARDS.md']; const hits=files.filter(f=>fs.readFileSync(f,'utf8').includes('[CUSTOMIZE')); if(hits.length){console.error('unresolved markers: '+hits.join(', ')); process.exit(1)} console.log('customization markers: 0')
  started 2026-07-29T12:46:17Z, exit 1 in 0.2s
  output:
  | [eval]:1
  | const
  |      
  | Unexpected token `<eof>`. Expected yield, an identifier, [ or {
  |
  | SyntaxError: Unexpected end of input
  |     at makeContextifyScript (node:internal/vm:185:14)
  |     at compileScript (node:internal/process/execution:383:10)
  |     at evalTypeScript (node:internal/process/execution:256:22)
  |     at node:internal/main/eval_string:74:3
  |
  | Node.js v22.22.2
- 2026-07-29T12:46:17Z — run: node .agent-foundry/check-foundry-drift.mjs
  started 2026-07-29T12:46:17Z, exit 0 in 0.1s
  output:
  | foundry-drift: installed from Agent Foundry 0.6.0 on 2026-07-29T12:41:50.207Z
  |
  | Locally modified (seed) (5)
  |   Expected: the project owns these. An upgrade must not overwrite them.
  |   - AGENTS.md
  |   - CONTRIBUTING.md
  |   - HANDOFF.md
  |   - docs/ENGINEERING-STANDARDS.md
  |   - docs/REVIEW-STANDARDS.md
  |
  | 70 unchanged, 5 diverged. Record intentional divergence in .agent-foundry/LOCAL-CHANGES.md
  | so the next upgrade does not silently revert it.
- 2026-07-29T12:46:17Z — moved to review
- 2026-07-29T12:46:37Z — note: validation retry: the first inline Node marker check was split by Windows shell quoting; replaced it with an explicit temporary script and did not change repository content
- 2026-07-29T12:46:37Z — run: node C:\Users\shift\AppData\Local\Temp\aigent-place-check-tailoring.mjs
  started 2026-07-29T12:46:37Z, exit 0 in 0.1s
  output:
  | customization markers: 0
- 2026-07-29T12:57:19Z — moved to in_progress (claimed by shift@Shiftor)
- 2026-07-29T12:57:19Z — note: cold review round 1, rung 1 counterpart Claude CLI, SPEC: accepted reproducible/wider marker validation, missing gate automation task, bridge ambiguity, stale handoff seed text, oversized Step 0 card, omitted conformance/AOI work, stray validation artifact, gate duplication, coordinate qualifier, and README orientation; fixed in the packet. F1 was review-in-progress timing. F2 was already covered by dual-tree test discovery but explicit entry-point runs will be added. F5 was rejected because LOCAL-CHANGES.md explicitly says seed-tier edits need no entry.
- 2026-07-29T12:57:19Z — note: cold review round 1, rung 1 counterpart Claude CLI, STANDARDS: accepted durable marker check, legacy bridge documentation, gate automation, operator-question tracking, locked-decision precedence, Step 0 edge-case coverage, invariant qualifier, handoff map, and explicit Claude-tree execution. Encoding loss was confined to the PowerShell review pipeline; live UTF-8 contains ±, ×, and arrows. Parallel Step 0 contracts intentionally remain independent p0 roots; tracker slug truncation is by design.
- 2026-07-29T12:57:19Z — note: cleanup: removed the zero-byte root artifact fs.readFileSync(f created by the malformed inline validation command
- 2026-07-29T12:57:41Z — run: node scripts/check.mjs
  started 2026-07-29T12:57:26Z, exit 1 in 15.3s
  output tail (truncated to last 30 lines):
  |       ---
  |       duration_ms: 131.5241
  |       type: 'test'
  |       ...
  |     # Subtest: keeps dependents blocked when their blocker is soft-deleted
  |     ok 2 - keeps dependents blocked when their blocker is soft-deleted
  |       ---
  |       duration_ms: 321.351
  |       type: 'test'
  |       ...
  |     1..2
  | ok 121 - task rm
  |   ---
  |   duration_ms: 452.9847
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
  | # duration_ms 14937.4315
  |
  | run-checks: PASS (skill-sync + 14 suites)
  | Unresolved Agent Foundry customization markers:
  |   - .agents/skills/codebase-audit/SKILL.md
  |   - .claude/skills/codebase-audit/SKILL.md
- 2026-07-29T12:57:41Z — run: node .agents/skills/task-tracker/scripts/task.mjs board
  started 2026-07-29T12:57:41Z, exit 0 in 0.1s
  output tail (truncated to last 30 lines):
  |   task-003  p0  Scaffold pinned product workspace and quality gate
  |   task-004  p0  Generate protocol types and conformance fixtures
  |   task-005  p0  Implement deterministic fixed-tick world core
  |   task-006  p1  Implement snapshot baselines and full resync
  |   task-007  p1  Implement ruleset activation and ordered persistence
  |   task-008  p1  Exercise crash recovery and slow-client isolation
  |   task-009  p1  Build the initial workload load harness
  |   task-010  p0  Specify physics, shape, and coordinate contracts
  |   task-011  p0  Specify replay and persistence ordering contracts
  |   task-012  p0  Specify the ruleset schema and constitution boundary
  |   task-013  p0  Specify workload and degradation contracts
  |   task-014  p0  Wire the unified gate into pre-commit and branch CI
  |   task-015  p1  Build a protocol conformance client
  |   task-016  p1  Implement interest management and AOI truncation
  |   task-017  p2  Resolve deferred product questions before dependent miles...
  |
  | READY
  |   (empty)
  |
  | IN_PROGRESS
  |   task-001  p0  Tailor Agent Foundry bootstrap to this project  [shift@Shiftor]
  |
  | REVIEW
  |   (empty)
  |
  | DONE
  |   (empty)
  |
  | BLOCKED
  |   (empty)
- 2026-07-29T12:57:41Z — run: node .claude/skills/task-tracker/scripts/task.mjs board
  started 2026-07-29T12:57:41Z, exit 0 in 0.1s
  output tail (truncated to last 30 lines):
  |   task-003  p0  Scaffold pinned product workspace and quality gate
  |   task-004  p0  Generate protocol types and conformance fixtures
  |   task-005  p0  Implement deterministic fixed-tick world core
  |   task-006  p1  Implement snapshot baselines and full resync
  |   task-007  p1  Implement ruleset activation and ordered persistence
  |   task-008  p1  Exercise crash recovery and slow-client isolation
  |   task-009  p1  Build the initial workload load harness
  |   task-010  p0  Specify physics, shape, and coordinate contracts
  |   task-011  p0  Specify replay and persistence ordering contracts
  |   task-012  p0  Specify the ruleset schema and constitution boundary
  |   task-013  p0  Specify workload and degradation contracts
  |   task-014  p0  Wire the unified gate into pre-commit and branch CI
  |   task-015  p1  Build a protocol conformance client
  |   task-016  p1  Implement interest management and AOI truncation
  |   task-017  p2  Resolve deferred product questions before dependent miles...
  |
  | READY
  |   (empty)
  |
  | IN_PROGRESS
  |   task-001  p0  Tailor Agent Foundry bootstrap to this project  [shift@Shiftor]
  |
  | REVIEW
  |   (empty)
  |
  | DONE
  |   (empty)
  |
  | BLOCKED
  |   (empty)
- 2026-07-29T12:57:42Z — run: node .agent-foundry/check-skill-sync.mjs
  started 2026-07-29T12:57:42Z, exit 0 in 0.1s
  output:
  | skill-sync: PASS (11 shared skills)
- 2026-07-29T12:58:07Z — note: marker-scan scope: task state and dependency directories are excluded; the one explanatory marker in each managed codebase-audit skill is allowlisted by exact path and count, with regression coverage
- 2026-07-29T12:58:23Z — run: node scripts/check.mjs
  started 2026-07-29T12:58:07Z, exit 0 in 15.6s
  output tail (truncated to last 30 lines):
  |     # Subtest: soft-deletes by setting status=done and adding deleted:true tag
  |     ok 1 - soft-deletes by setting status=done and adding deleted:true tag
  |       ---
  |       duration_ms: 121.1235
  |       type: 'test'
  |       ...
  |     # Subtest: keeps dependents blocked when their blocker is soft-deleted
  |     ok 2 - keeps dependents blocked when their blocker is soft-deleted
  |       ---
  |       duration_ms: 292.5765
  |       type: 'test'
  |       ...
  |     1..2
  | ok 121 - task rm
  |   ---
  |   duration_ms: 413.8093
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
  | # duration_ms 15178.1484
  |
  | run-checks: PASS (skill-sync + 14 suites)
  | process-docs: PASS (no unresolved customization markers)
- 2026-07-29T12:58:50Z — moved to review
- 2026-07-29T13:03:23Z — moved to in_progress (claimed by shift@Shiftor)
- 2026-07-29T13:03:24Z — note: round 2 SPEC accepted: separated the bootstrap-earned review lens, added task-018 for server handshake/session/idempotency/result behavior and wired dependents, widened/documented the marker gate, expanded the handoff map, logged README tailoring, and added connection/version invariants.
- 2026-07-29T13:03:24Z — note: round 2 SPEC adjudication: task-003 remains blocked by all Step 0 contracts because ARCHITECTURE.md explicitly says everything after Step 0 depends on them and task-003 executes runnable smoke applications; backlog tasks remain claimable by tracker design; retitled task filenames retain their original slug by tracker design. Explicit next, drift, operator-queue, and git-status evidence will be refreshed.
- 2026-07-29T13:03:24Z — note: round 1 review provenance: both axes used the Codex-side claude-in-codex bridge to invoke Claude Code as a separate model family with tools disabled. SPEC findings covered missing review evidence, dual-tree validation, marker reproducibility/scope, seed drift handling, gate automation, bridge naming, handoff state, task sizing/completeness, stray artifact, invariant/gate duplication, and README orientation; each accepted or rejected outcome is summarized in the 12:57 notes and implemented in the current packet.
- 2026-07-29T13:03:24Z — note: round 1 STANDARDS provenance: findings covered marker evidence/scope, bridge duplication, seed drift policy, gate automation, review timing/rung, operator questions, locked decisions, persistence/overflow/physics/determinism contract gaps, invariant/gate duplication, packet encoding, handoff mapping, review-lens state, priorities, tracker slugging, and named-command verification; accepted items were fixed or filed, while live UTF-8, Step 0 parallel roots, seed-tier policy, and tracker slug behavior were verified and retained.
- 2026-07-29T13:03:48Z — run: node scripts/check.mjs
  started 2026-07-29T13:03:32Z, exit 0 in 16.0s
  output tail (truncated to last 30 lines):
  |     # Subtest: soft-deletes by setting status=done and adding deleted:true tag
  |     ok 1 - soft-deletes by setting status=done and adding deleted:true tag
  |       ---
  |       duration_ms: 129.9847
  |       type: 'test'
  |       ...
  |     # Subtest: keeps dependents blocked when their blocker is soft-deleted
  |     ok 2 - keeps dependents blocked when their blocker is soft-deleted
  |       ---
  |       duration_ms: 346.5764
  |       type: 'test'
  |       ...
  |     1..2
  | ok 121 - task rm
  |   ---
  |   duration_ms: 476.6589
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
  | # duration_ms 15566.4707
  |
  | run-checks: PASS (skill-sync + 14 suites)
  | process-docs: PASS (no unresolved markers in scoped non-binary files)
- 2026-07-29T13:03:48Z — run: node .agents/skills/task-tracker/scripts/task.mjs next
  started 2026-07-29T13:03:48Z, exit 0 in 0.1s
  output:
  | task-002
- 2026-07-29T13:03:48Z — run: node .claude/skills/task-tracker/scripts/task.mjs next
  started 2026-07-29T13:03:48Z, exit 0 in 0.1s
  output:
  | task-002
- 2026-07-29T13:03:48Z — run: node .agent-foundry/check-foundry-drift.mjs
  started 2026-07-29T13:03:48Z, exit 0 in 0.1s
  output:
  | foundry-drift: installed from Agent Foundry 0.6.0 on 2026-07-29T12:41:50.207Z
  |
  | Locally modified (seed) (5)
  |   Expected: the project owns these. An upgrade must not overwrite them.
  |   - AGENTS.md
  |   - CONTRIBUTING.md
  |   - HANDOFF.md
  |   - docs/ENGINEERING-STANDARDS.md
  |   - docs/REVIEW-STANDARDS.md
  |
  | 70 unchanged, 5 diverged. Record intentional divergence in .agent-foundry/LOCAL-CHANGES.md
  | so the next upgrade does not silently revert it.
- 2026-07-29T13:03:49Z — run: node .agents/skills/task-tracker/scripts/task.mjs list --tag needs:operator
  started 2026-07-29T13:03:49Z, exit 0 in 0.1s
  output:
  | task-017   backlog      p2  [area:product,milestone:foundations,needs:operator] Resolve deferred product questions before dependent milestones
- 2026-07-29T13:03:49Z — run: git status --short
  started 2026-07-29T13:03:49Z, exit 0 in 0.1s
  output:
  | ?? .agent-foundry.json
  | ?? .agent-foundry/
  | ?? .agents/
  | ?? .claude/
  | ?? .gitignore
  | ?? .tasks/
  | ?? AGENTS.md
  | ?? ARCHITECTURE.md
  | ?? BLOCKED-JOURNAL.md
  | ?? CLAUDE.md
  | ?? CONTRIBUTING.md
  | ?? HANDOFF.md
  | ?? PLANNING-JOURNAL.md
  | ?? README.md
  | ?? docs/
  | ?? scripts/
- 2026-07-29T13:04:02Z — note: round 2 SPEC full adjudication: F1 accepted and separated project lens; F2 accepted as task-018 plus dependency edges; F3 backlog-is-claimable inference rejected and both next commands passed; F4 drift refreshed; F5 provenance expanded; F6 scan widened/documented/tested; F7 handoff map expanded; F8 README edit logged; F9 rejected under explicit Step 0 dependency; F10 connection invariants added; F11 retained tracker-owned original slug after retitle; F12 cadence clarified and operator/git commands passed.
- 2026-07-29T13:04:02Z — note: friction: check-foundry-drift tells the operator to record all divergence in LOCAL-CHANGES.md, while LOCAL-CHANGES.md explicitly says seed-tier edits need no entry; followed the tier-specific policy and verified there is no mold divergence
- 2026-07-29T13:04:03Z — moved to review
- 2026-07-29T13:07:05Z — moved to in_progress (claimed by shift@Shiftor)
- 2026-07-29T13:07:05Z — note: final SPEC adjudication: F1 is satisfied by the pending final-round separate STANDARDS call and will be logged; F2 compatibility clock corrected to published deprecation; F3 task-014 tagged needs:operator and now names CI/remote choice; F4 marker exclusions now exactly document and test node_modules plus Rust target; F5 task-004 now also waits for gate automation; F6 rejected because the operator's install request activated BOOTSTRAP.md, whose task objective explicitly requires seeding the initial dependency-ordered front, while task-001 is a bootstrap phase rather than a product milestone.
- 2026-07-29T13:07:21Z — run: node scripts/check.mjs
  started 2026-07-29T13:07:05Z, exit 0 in 15.8s
  output tail (truncated to last 30 lines):
  |     # Subtest: soft-deletes by setting status=done and adding deleted:true tag
  |     ok 1 - soft-deletes by setting status=done and adding deleted:true tag
  |       ---
  |       duration_ms: 177.4433
  |       type: 'test'
  |       ...
  |     # Subtest: keeps dependents blocked when their blocker is soft-deleted
  |     ok 2 - keeps dependents blocked when their blocker is soft-deleted
  |       ---
  |       duration_ms: 299.5379
  |       type: 'test'
  |       ...
  |     1..2
  | ok 121 - task rm
  |   ---
  |   duration_ms: 477.1004
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
  | # duration_ms 15457.7688
  |
  | run-checks: PASS (skill-sync + 14 suites)
  | process-docs: PASS (no unresolved markers in scoped non-binary files)
- 2026-07-29T13:07:33Z — moved to review
- 2026-07-29T13:12:31Z — moved to in_progress (claimed by shift@Shiftor)
- 2026-07-29T13:12:31Z — note: final STANDARDS round used rung 1 via the Codex-side claude-in-codex bridge to a separate Claude model family. Accepted: realpath-safe gate entry, Node 20 documentation, self-policing allowlist diagnostics/tests, explanatory source comment, exact target-directory scope, fail-closed symlink/I/O handling, centralized scope docs, tool-output ignores, and README harness/gate guidance. No security or destructive-action issue was found.
- 2026-07-29T13:12:49Z — run: node scripts/check.mjs
  started 2026-07-29T13:12:31Z, exit 0 in 17.1s
  output tail (truncated to last 30 lines):
  |     # Subtest: soft-deletes by setting status=done and adding deleted:true tag
  |     ok 1 - soft-deletes by setting status=done and adding deleted:true tag
  |       ---
  |       duration_ms: 135.5931
  |       type: 'test'
  |       ...
  |     # Subtest: keeps dependents blocked when their blocker is soft-deleted
  |     ok 2 - keeps dependents blocked when their blocker is soft-deleted
  |       ---
  |       duration_ms: 332.7806
  |       type: 'test'
  |       ...
  |     1..2
  | ok 121 - task rm
  |   ---
  |   duration_ms: 468.4913
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
  | # duration_ms 16601.4061
  |
  | run-checks: PASS (skill-sync + 14 suites)
  | process-docs: PASS (no unresolved markers in scoped non-binary files)
- 2026-07-29T13:14:02Z — note: review cap reached at round 3: final SPEC and separate final STANDARDS both used rung 1 through claude-in-codex. All substantive findings were fixed; post-review fixes were self-checked against the exact findings and the full authoritative gate, with no open must-fix or follow-up defect remaining.
- 2026-07-29T13:14:18Z — run: node scripts/check.mjs
  started 2026-07-29T13:14:02Z, exit 0 in 16.6s
  output tail (truncated to last 30 lines):
  |     # Subtest: soft-deletes by setting status=done and adding deleted:true tag
  |     ok 1 - soft-deletes by setting status=done and adding deleted:true tag
  |       ---
  |       duration_ms: 139.7954
  |       type: 'test'
  |       ...
  |     # Subtest: keeps dependents blocked when their blocker is soft-deleted
  |     ok 2 - keeps dependents blocked when their blocker is soft-deleted
  |       ---
  |       duration_ms: 332.7479
  |       type: 'test'
  |       ...
  |     1..2
  | ok 121 - task rm
  |   ---
  |   duration_ms: 472.6502
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
  | # duration_ms 16187.4432
  |
  | run-checks: PASS (skill-sync + 14 suites)
  | process-docs: PASS (no unresolved markers in scoped non-binary files)
- 2026-07-29T13:14:18Z — moved to review
- 2026-07-29T13:14:19Z — moved to done
- 2026-07-29T13:15:00Z — note: git closeout: repaired invalid unborn HEAD ref from refs/heads/ to refs/heads/master before the initial task-scoped commit
