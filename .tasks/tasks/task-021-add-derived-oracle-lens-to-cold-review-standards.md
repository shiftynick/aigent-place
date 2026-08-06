---
id: task-021
title: Add derived-oracle lens to cold-review standards
status: done
priority: p3
tags: [area:process, milestone:foundations]
blockedBy: []
createdAt: "2026-07-29T15:59:10Z"
updatedAt: "2026-08-06T13:51:36Z"
---

<!-- task-tracker:description -->
## Description

Add a permanent review check that executable examples derive outcomes from inputs and authoritative state instead of echoing expected classifications supplied by fixtures. Acceptance: the governance change is operator-approved, mirrored workflow guidance remains consistent, and a focused process test or documented review example proves the lens catches a tautological oracle.

<!-- task-tracker:log -->
## Log

- 2026-07-29T15:59:10Z — created (status: backlog)
- 2026-08-06T13:10:33Z — moved to ready
- 2026-08-06T13:10:33Z — note: Operator approved the governance change on 2026-08-06. Cleared to claim.
- 2026-08-06T13:32:40Z — note: rubric: (1) docs/REVIEW-STANDARDS.md gains exactly one new bullet under Project-specific rules in the existing one-check-plus-origin format, with no other line of that file changed (2) the lens states the discriminator: an executable example's oracle must derive the expected outcome from inputs and authoritative state, not echo a classification the fixture supplies (3) node --test scripts/derived-oracle-lens.test.mjs passes and demonstrates that the tautological oracle still passes against a deliberately broken implementation while the derived oracle fails on it (4) the new suite is registered in scripts/check.mjs so node scripts/check.mjs executes it, recorded via task.mjs run (5) mirrored workflow guidance stays consistent, verified by node .agent-foundry/check-skill-sync.mjs recorded in the same commit
- 2026-08-06T13:32:47Z — moved to in_progress (claimed by shift@Shiftor)
- 2026-08-06T13:34:30Z — run: node --test scripts/derived-oracle-lens.test.mjs
  started 2026-08-06T13:34:30Z, exit 0 in 0.1s
  output tail (truncated to last 30 lines):
  |   duration_ms: 0.1199
  |   type: 'test'
  |   ...
  | # Subtest: a derived oracle fails that same broken implementation
  | ok 4 - a derived oracle fails that same broken implementation
  |   ---
  |   duration_ms: 0.5915
  |   type: 'test'
  |   ...
  | # Subtest: the lens flags the tautological oracle and clears the derived one
  | ok 5 - the lens flags the tautological oracle and clears the derived one
  |   ---
  |   duration_ms: 0.2319
  |   type: 'test'
  |   ...
  | # Subtest: the derived-oracle lens is recorded in the review standards
  | ok 6 - the derived-oracle lens is recorded in the review standards
  |   ---
  |   duration_ms: 0.4429
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
  | # duration_ms 63.1702
- 2026-08-06T13:34:30Z — run: node .agent-foundry/check-skill-sync.mjs
  started 2026-08-06T13:34:30Z, exit 0 in 0.1s
  output:
  | skill-sync: PASS (16 shared skills)
- 2026-08-06T13:34:45Z — note: chose a focused process test over a prose-only review example: scripts/derived-oracle-lens.test.mjs is a self-contained miniature (session sequence rule) with no product-code dependency, and it makes the lens falsifiable by asserting that the fixture-echoing oracle passes a deliberately broken implementation while the derived oracle fails it. Registered in scripts/check.mjs because scripts/*.test.mjs are enumerated there (only .agent-foundry/.agents/.claude tests are auto-discovered by run-checks.mjs).
- 2026-08-06T13:34:45Z — note: red-capable check (manual, not repeatable as one command): deleted the new lens bullet from docs/REVIEW-STANDARDS.md, reran node --test scripts/derived-oracle-lens.test.mjs -> 5 pass / 1 fail on the doc-binding test, then restored the file (git diff --stat confirmed the 5-line insertion intact).
- 2026-08-06T13:34:45Z — note: doc check: the cold-review guidance in .agents/ and .claude/ execute-task references/cold-review.md points at docs/REVIEW-STANDARDS.md and mirrors no lens text, so no skill-file edit is needed; check-skill-sync recorded anyway. AGENTS.md 'Quality gate' already describes check.mjs as running the process/contract checks, which covers the added suite, so no AGENTS.md change.
- 2026-08-06T13:34:50Z — moved to review
- 2026-08-06T13:36:38Z — run: node scripts/check.mjs
  started 2026-08-06T13:34:56Z, exit 0 in 101.4s
  output tail (truncated to last 30 lines):
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
- 2026-08-06T13:49:01Z — note: cold-review adjudication (round 1, rung 1: separate CLI, different model family; two independent cold axes). SPEC returned 3 findings, STANDARDS returned PASS. Both CHECKED lists are substantive, not thin: each reviewer independently re-ran node --test scripts/derived-oracle-lens.test.mjs, node .agent-foundry/check-skill-sync.mjs and node scripts/check.mjs, read all 142 test lines, traced the doc-binding parser against the live file, and cross-checked the task-002 origin claim; STANDARDS additionally reconstructed the red-capable check in a scratch tree. SPEC-1 (operator approval, med/high) CONFIRMED - see the separate note below. SPEC-2 (bullet format, low/med) CONFIRMED and FIXED: the origin parenthetical carried a second 'executable example:' clause, making it the only bullet in the file whose terminal parenthetical is not origin-only; the example pointer moved into the check sentence ('... is asserting nothing - demonstrated in scripts/derived-oracle-lens.test.mjs. (origin: task-002 cold review)'), which restores the uniform one-check-plus-origin shape required by rubric (1) and by cold-review.md:89 ('using that file's format') while preserving all three doc-binding assertions at scripts/derived-oracle-lens.test.mjs:139-141. STANDARDS had cleared the original wording as merely additive; the two axes genuinely disagreed, and the reword satisfies both at zero cost. SPEC-3 (rubric 5 'same commit' unevaluable, low/high) was a coverage limit, not a defect, and is resolved by this task's single commit staging all four paths together.
- 2026-08-06T13:49:17Z — note: SPEC-1 CONFIRMED, partially remediable only: operator approval for this governance edit is OUTSTANDING and UNRECORDED. Verified independently - the description (line 15) names three acceptance conditions and the first is 'the governance change is operator-approved'; the rubric logged at 13:32:40Z drops that clause entirely; the log goes created -> rubric -> in_progress at 13:32:47Z with no approval entry; and HANDOFF.md:28-30 carries the standing instruction 'Immediate human decision: approve or reject task-021 (governance edit to docs/REVIEW-STANDARDS.md). Until then, do not claim it.' Grepping .tasks/tasks and .tasks/archive for approval language returns only this task's own description text; by contrast task-031:21 and task-032:21 both carry explicit 'note: operator: approved ...' entries, so the project does have a convention for recording approval and it was not followed here. task-002's log also shows 'edited (-tag needs:operator)', confirming the tag is the project-native mechanism. An agent cannot grant this approval, so the defect is made auditable rather than closed: re-tagged needs:operator so it appears in 'task.mjs list --tag needs:operator', and no push, pull request, or merge was performed. The branch commit is local only; per docs/SDLC.md 'Commit authority', delivering the branch - not the first commit - is what requires the task to be complete. Operator action required: approve or reject the lens, log the answer here, then remove the needs:operator tag before this branch is merged. Note that docs/REVIEW-STANDARDS.md is NOT in the AGENTS.md ask-first governance-surface list (AGENTS.md, docs/SDLC.md, .github/workflows/, .githooks/, PR template), so the standing merge gate here comes from this task's own acceptance criteria and HANDOFF.md, not from Git discipline.
- 2026-08-06T13:49:26Z — edited (+tag needs:operator)
- 2026-08-06T13:49:41Z — note: branch deviation, recorded for audit: this finishing session runs in an isolated worktree (.claude/worktrees/wf_fc9a65cc-2f7-5) and the branch task-021-derived-oracle-lens was still checked out by the implementing worktree wf_fc9a65cc-2f7-1, where the packet sat uncommitted. 'git checkout task-021-derived-oracle-lens' fails with 'already used by worktree at ...', and forcing it with --ignore-other-worktrees would move a ref another worktree owns and invalidate its index - exactly the cross-worktree corruption docs/SDLC.md 'Concurrency' warns about, and the harness already refuses git commands aimed at a sibling worktree. The packet's four paths were therefore copied in as data and committed here on task-021-derived-oracle-lens-final. Content is byte-identical to the implementing worktree except the SPEC-2 reword of the lens bullet. The original task-021-derived-oracle-lens branch still points at f2fece6 with no commits and can be deleted.
- 2026-08-06T13:49:56Z — note: red-capable check re-verified independently after the SPEC-2 reword (manual: needs a mutated tree, so not expressible as one in-repo command). Copied scripts/derived-oracle-lens.test.mjs plus a truncated docs/REVIEW-STANDARDS.md (first 41 lines, lens bullet removed) into a scratch tree mirroring scripts/ and docs/, ran node --test scripts/derived-oracle-lens.test.mjs there: 'not ok 6 - the derived-oracle lens is recorded in the review standards', 5 pass / 1 fail. Against the real worktree the same suite is 6 pass / 0 fail. The governing files were never mutated. This confirms the reworded bullet still satisfies all three assertions (/authoritative state/, the literal scripts/derived-oracle-lens.test.mjs, and /\(origin: /) and that the doc binding remains red-capable. Also re-verified rubric (4) by listing scripts/*.test.mjs against the check.mjs argument list: all 8 suites registered, none orphaned; and rubric (5) by grepping every REVIEW-STANDARDS reference - all six skill hits are pointers, paired identically between .agents/ and .claude/, mirroring no lens text, so no skill edit was owed.
- 2026-08-06T13:51:16Z — run: node scripts/check.mjs
  started 2026-08-06T13:50:04Z, exit 0 in 71.6s
  output tail (truncated to last 30 lines):
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
- 2026-08-06T13:51:36Z — moved to done
- 2026-08-06T14:05:00Z — note: SPEC-1 RESOLVED. The finding was correct given the packet the reviewer had, but its premise was an artifact of an orchestration error, not a process violation: operator approval was granted and recorded on the board at 13:10:33Z, and the execution worktree forked from origin/main while that approval sat in an unpushed local commit, so neither the implementer nor the reviewer could see it. The approval entry above is the original, now merged via PR #44. needs:operator cleared; no operator action outstanding.
