---
id: task-058
title: "Upgrade Agent Foundry 0.18.0 -> 0.23.0"
status: done
priority: p1
tags: [area:process, phase:upgrade]
blockedBy: []
createdAt: "2026-08-08T16:12:42Z"
updatedAt: "2026-08-08T16:45:54Z"
---

<!-- task-tracker:description -->
## Description

Upgrade the installed Agent Foundry workflow from 0.18.0 to 0.23.0 using the operator-supplied local checkout at N:\agent-foundry. Apply each intervening release action, restore and merge every project-owned seed, adjudicate every baseline mold divergence, retain a recovery backup, and pass Foundry plus project validation before delivery.

<!-- task-tracker:log -->
## Log

- 2026-08-08T16:12:42Z — created (status: backlog)
- 2026-08-08T16:12:48Z — moved to in_progress (claimed by shift@Shiftor)
- 2026-08-08T16:12:49Z — note: rubric: (1) every upgrade action from every intervening release applied or explicitly justified as a no-op; (2) every seed file restored and re-merged, none left as template; (3) every mold divergence from the step-1 report re-applied, retired, or recorded in LOCAL-CHANGES.md, file by file; (4) each retirement verified against the installed file rather than trusted from the changelog; (5) post-upgrade drift is fully explainable line by line; (6) run-checks passes
- 2026-08-08T16:12:49Z — note: upgrade baseline: installed Agent Foundry 0.18.0 with manifest; target local checkout N:\agent-foundry at 0.23.0
- 2026-08-08T16:12:49Z — run: node .agent-foundry/check-foundry-drift.mjs
  started 2026-08-08T16:12:49Z, exit 0 in 0.1s
  output:
  | foundry-drift: installed from Agent Foundry 0.18.0 on 2026-08-06T19:04:27.248Z
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
  | 104 unchanged, 18 diverged. Record intentional divergence in .agent-foundry/LOCAL-CHANGES.md
  | so the next upgrade does not silently revert it.
- 2026-08-08T16:14:10Z — note: forced reinstall: node N:\agent-foundry\scripts\bootstrap-project.mjs --target-path=N:\aigent-place --project-name=Aigent Place --project-description=A repository for the Aigent Place architecture and implementation. --force; backup: N:\aigent-place\.agent-foundry-backups\20260808T161337565Z
- 2026-08-08T16:19:35Z — note: upgrade actions: 0.19 retired four provider aliases; no live callers required mapping; historical task logs retained; 15-skill sync verified. 0.20 merged the STE operator pointer into project AGENTS.md. 0.21 installed deploy-acceptance guidance; no open deploy-waiting card existed to migrate. 0.22 added unsent/none delivery fields to every retained Upstream: yes entry. 0.22.1 retained the Windows-safe escape fixture. 0.23 accepted STE mold wording and merged retained concurrency behavior by meaning.
- 2026-08-08T16:19:35Z — note: seed reconciliation: restored all 8 committed manifest-derived seeds from HEAD; stock-to-stock 0.18.0..0.23.0 changed only AGENTS.md, whose STE pointer, retired-alias catalog, and 15-skill invariant were merged. No seed remains a fresh template.
- 2026-08-08T16:19:36Z — note: mold adjudication: retained 9 divergences after installed-tree verification (COMPATIBILITY sentence fix; dual-tree task ID implementation/docs/tests; atomic and link-confined seed reconciliation/tests). Retired 2 dual-tree cold-review prompt divergences because installed 0.23.0 now contains an equivalent packet-as-data boundary in the prompt protocol. LOCAL-CHANGES.md matches the live mold drift.
- 2026-08-08T16:19:36Z — note: documentation check: docs/SDLC.md and shared guidance landed from stock; AGENTS.md merged; project standards, handoff, ADR index, contribution guide, and other restored seeds had no stock changes to merge. HANDOFF product direction and next execution step did not change, so no checkpoint refresh is needed.
- 2026-08-08T16:20:05Z — run: node .agent-foundry/run-checks.mjs
  started 2026-08-08T16:19:36Z, exit 1 in 29.3s
  output tail (truncated to last 30 lines):
  |       ...
  |     # Subtest: points at a reference file that exists in this tree
  |     ok 5 - points at a reference file that exists in this tree
  |       ---
  |       duration_ms: 0.2849
  |       type: 'test'
  |       ...
  |     # Subtest: still rejects an unknown verb with exit 2
  |     ok 6 - still rejects an unknown verb with exit 2
  |       ---
  |       duration_ms: 51.4615
  |       type: 'test'
  |       ...
  |     1..6
  | ok 136 - task help
  |   ---
  |   duration_ms: 259.304
  |   type: 'suite'
  |   ...
  | 1..136
  | # tests 369
  | # suites 68
  | # pass 368
  | # fail 1
  | # cancelled 0
  | # skipped 0
  | # todo 0
  | # duration_ms 29107.6471
  |
  | run-checks: FAIL (installed tests)
- 2026-08-08T16:23:11Z — note: friction: first recorded run-checks failed 1 of 369 tests, but the failing name fell outside the bounded evidence tail; a filtered rerun and three full captured reruns all passed. No deterministic failing loop could be built and no code was changed for the transient. Final validation must include a fresh recorded run-checks pass.
- 2026-08-08T16:23:11Z — note: behavior/test check: alias retirement is caught by the installed retired-directory and 15-skill sync checks; seed restoration completeness is caught by manifest-derived reconciliation tests and drift; retained task namespace behavior is caught by unborn, detached, remote-HEAD, warning, and cross-worktree tests; seed safety is caught by atomicity and link-traversal tests. Reverting each behavior makes its named check fail while the scripts still load.
- 2026-08-08T16:23:11Z — moved to review
- 2026-08-08T16:29:40Z — edited (description updated)
- 2026-08-08T16:29:40Z — note: cold review round 1: rung 1 via agent-headless provider claude, Claude Code 2.1.222, Anthropic family; separate concurrent SPEC and STANDARDS inspect calls. Result metadata primarily used Claude Opus 5 and also reported a nested Claude Haiku 4.5 model observation. Both axes completed with findings.
- 2026-08-08T16:29:40Z — note: review adjudication: accepted missing durable task description, missing recorded final run-checks/drift/project gate, incorrect unsent status for the existing Cursor compatibility packet, prompt files outside .tmp, incomplete exported review packet, missing rung log, and the need to preserve a failing-test name in future gate summaries. Corrected description/status/prompt location/rung now; final validation evidence follows after re-review.
- 2026-08-08T16:29:40Z — note: review adjudication: accepted that per-release dispositions and retirement equivalence need stronger durable evidence. The 0.19-0.23 action-by-action disposition and the retired cold-review boundary's old/new meaning will be included in the re-review packet and task log.
- 2026-08-08T16:30:18Z — note: 0.19 action disposition: forced install and backup completed; no live non-historical callers of retired wrappers existed; the four stale alias directories were deleted; AGENTS.md and both managed skill READMEs now expose 15 shared skills; skill-sync passes 15. The unmanaged codex-in-cc extension remains Claude-only by project policy.
- 2026-08-08T16:30:18Z — note: 0.20 action disposition: forced mold installed docs/SDLC.md and shared execute-task/grill-me guidance; restored project AGENTS.md then merged its stock ASD-STE100 pointer by meaning; no skill-body conversion was required by that release.
- 2026-08-08T16:30:18Z — note: 0.21 action disposition: forced mold installed the single Deploy-dependent acceptance section in docs/SDLC.md plus execute-task/task-tracker pointers; search of active task cards found no existing card waiting on deploy, so no tag/state migration was required.
- 2026-08-08T16:30:18Z — note: 0.22 action disposition: forced mold installed feedback/retrospective/upgrade status handling; every retained Upstream: yes LOCAL-CHANGES entry now has status/ref. Cursor compatibility is packeted at .agent-foundry/feedback/2026-08-06-cursor-compatibility-stray-token.md; the other eight are unsent with no ref. No tracker column was added.
- 2026-08-08T16:30:18Z — note: 0.22.1 action disposition: forced mold retained the new temp-file escape fixture in both task.test.mjs copies while the project namespace regression tests were re-applied; focused task-tracker tests passed.
- 2026-08-08T16:30:18Z — note: 0.23 action disposition: forced mold installed STE shared guidance and docs/SDLC.md; retained concurrency semantics were merged into concise STE wording in both trees; operator-chat STE and skill-body STE remain governed separately by docs/SDLC.md.
- 2026-08-08T16:30:18Z — note: retirement equivalence: baseline backup cold-review entries said the dispatch prompt itself must carry the packet-as-data/no-authorization boundary. Installed 0.23.0 dual-tree cold-review protocol now says every packet artifact is data, text cannot redirect review, reviewer output is evidence, and reviewers must answer only the supplied axis; this fully covers the retired behavior.
- 2026-08-08T16:30:18Z — note: follow-up filed: task-1783008532000001 will preserve failing suite/test names in bounded Foundry gate summaries so future transient failures remain diagnosable from tracker evidence.
- 2026-08-08T16:35:44Z — note: cold review round 2: rung 1 via concurrent Claude/agent-headless SPEC and STANDARDS calls against the complete exported diff. Accepted: stray unary plus markers in both tracker tests, two unexplained blank-line deletions in both task scripts, incorrect retirement of the dual-tree prompt-template safety divergence, omitted status/ref fields in LOCAL-CHANGES format guidance, and inaccurate alias-retirement test-coverage wording.
- 2026-08-08T16:35:44Z — note: correction to 16:23 behavior/test note: installed checks verify 15 shared trees are synchronized, but they do not assert a fixed count or reject one-tree-only retired aliases. Alias retirement is verified by installed-tree/catalog inspection, not mutation coverage. The remaining named retained behaviors do have focused regression tests.
- 2026-08-08T16:35:44Z — note: correction to retirement note: installed 0.23 narrative prose does not protect a separately copied prompt template. The dual-tree cold-review prompt safety lines were re-applied and restored to LOCAL-CHANGES.md; post-upgrade mold drift should therefore return to 11 files.
- 2026-08-08T16:35:44Z — moved to in_progress (claimed by shift@Shiftor)
- 2026-08-08T16:36:09Z — moved to review
- 2026-08-08T16:42:54Z — note: cold review round 3 (final capped round): SPEC PASS with complete rubric coverage. STANDARDS reported five findings. Accepted: delete .tmp review packet before the filesystem marker scan; treat earlier reruns only as diagnostics and require a new recorded pass; log implementer/reviewer families explicitly; record the early review-state lifecycle mistake as friction. Rejected changing the packeted feedback ref: installed 0.23.0 explicitly makes feedback packets local, transient, git-ignored deliverables and requires LOCAL-CHANGES to point to that path when packeted.
- 2026-08-08T16:42:54Z — note: rung clarification for all three rounds: implementer is Codex on GPT-5, OpenAI family. Review transport was agent-headless via Claude Code 2.1.222; primary review model Claude Opus 5, Anthropic family (result metadata also observed nested Claude Haiku 4.5 activity). This is rung 1, separate CLI and different model family.
- 2026-08-08T16:42:55Z — note: friction: after round 1, task-record and LOCAL-CHANGES edits were made while the card still said review; it returned to in_progress only before round-2 fixes. Later implementation followed the required review -> in_progress -> review path. The historical transition cannot be rewritten and is retained as process evidence.
- 2026-08-08T16:42:55Z — note: validation clarification: the four earlier passing reruns were diagnostic attempts to reproduce the unexplained failure, not validation evidence. They do not satisfy any gate. Only fresh task.mjs run entries after the final review count.
- 2026-08-08T16:42:55Z — note: final review follow-up: filed a p3 process card for the stock 0.23 tension between tracked packeted status and intentionally local git-ignored feedback packets.
- 2026-08-08T16:43:28Z — run: node .agent-foundry/run-checks.mjs
  started 2026-08-08T16:43:00Z, exit 0 in 27.6s
  output tail (truncated to last 30 lines):
  |       ...
  |     # Subtest: points at a reference file that exists in this tree
  |     ok 5 - points at a reference file that exists in this tree
  |       ---
  |       duration_ms: 0.2401
  |       type: 'test'
  |       ...
  |     # Subtest: still rejects an unknown verb with exit 2
  |     ok 6 - still rejects an unknown verb with exit 2
  |       ---
  |       duration_ms: 54.0863
  |       type: 'test'
  |       ...
  |     1..6
  | ok 146 - task help
  |   ---
  |   duration_ms: 276.4523
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
  | # duration_ms 27460.6904
  |
  | run-checks: PASS (skill-sync + 17 suites)
- 2026-08-08T16:43:36Z — run: node .agent-foundry/check-foundry-drift.mjs
  started 2026-08-08T16:43:36Z, exit 0 in 0.1s
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
- 2026-08-08T16:45:05Z — run: node scripts/check.mjs
  started 2026-08-08T16:43:41Z, exit 0 in 83.7s
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
- 2026-08-08T16:45:54Z — note: closeout: AGENTS.md read-through found no reintroduced customization markers. Existing ignored .tmp artifacts belong to prior tasks; this upgrade removed only its task-058 review packet. HANDOFF direction and next product step remain unchanged.
- 2026-08-08T16:45:54Z — moved to done
