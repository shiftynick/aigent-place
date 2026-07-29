---
id: task-019
title: Establish protected GitHub PR delivery workflow
status: review
priority: p0
tags: [area:process, milestone:foundations]
blockedBy: []
createdAt: "2026-07-29T13:40:04Z"
updatedAt: "2026-07-29T14:12:46Z"
---

<!-- task-tracker:description -->
## Description

Create the personal GitHub remote and establish an agent-manageable branch-per-task delivery path before product development. Acceptance: the public repository uses main and the personal account; a tested direct-main push guard and evidence-based PR template are tracked; the current process gate runs on pull requests and main; main requires pull requests, linear history, green required checks, resolved conversations, and blocks deletion/force-push; squash merging and automatic head-branch deletion are configured; the standing agent push, PR, and conditional merge authority plus ask-first exclusions are documented; and the workflow is proven through an actual green bootstrap PR without changing the machine-global GitHub account.

<!-- task-tracker:log -->
## Log

- 2026-07-29T13:40:04Z — created (status: backlog)
- 2026-07-29T13:40:42Z — note: rubric: (1) A private shiftynick/aigent-place remote uses main and the verified personal Git/gh identity without changing global authentication. (2) GitHub settings enforce PR-only linear main, no force-push/deletion, resolved conversations, squash-only merges, automatic branch deletion, and required green process-gate checks. (3) A tested pre-push guard blocks every update to refs/heads/main while allowing task branches, and the documented per-clone setup activates it. (4) CI runs the single current node scripts/check.mjs gate with pinned Node on pull requests and main using least privilege and useful concurrency behavior. (5) The PR template and SDLC documents require task scope, rubric, recorded validation, cold-review evidence, and define standing agent push/open/conditional squash-merge authority with the approved ask-first exclusions. (6) The workflow is proven by a real task-019 branch and green PR, all local checks and remote rules are recorded, the task and handoff are current, and task-002 becomes next.
- 2026-07-29T13:40:48Z — moved to in_progress (claimed by codex/task-019)
- 2026-07-29T13:43:54Z — note: GitHub account constraint: the personal account accepted repository settings but ruleset listing returned HTTP 403: Upgrade to GitHub Pro or make this repository public to enable this feature. Repository remains private. Continuing all reversible local and CI work; server-side main protection needs the operator to choose Pro or public visibility.
- 2026-07-29T13:44:24Z — moved to review
- 2026-07-29T13:48:15Z — edited (+tag needs:operator)
- 2026-07-29T13:48:15Z — note: Remote settings verified after PATCH: private=true, default_branch=main, allow_squash_merge=true, allow_merge_commit=false, allow_rebase_merge=false, delete_branch_on_merge=true, squash title=PR_TITLE, squash message=PR_BODY. allow_auto_merge remains unavailable/false on the current tier and is not required for the approved flow.
- 2026-07-29T13:48:46Z — note: Cold review round 1, rung 1 (claude-in-codex), separate SPEC and STANDARDS calls. Accepted and fixed: docs no longer claim unavailable ruleset/check enforcement; self-merge authority is conditional on active server protection; needs:operator plus planning/handoff blocker are explicit; CI runs on every branch; action commits are SHA-pinned with checkout credentials disabled; Node pin is documented; attributes normalize text; hook handles unterminated input with actionable diagnostics and finds Git-for-Windows sh; cold-start gh command removed. Verified counter-evidence: the Windows gate had passed before review, personal gh/SSH identity was probed live, remote settings are now recorded, and hook mode is staged as 100755. Rejected: duplicating the full merge policy into docs/SDLC.md would create a second source of truth; that document intentionally delegates project-specific authority to AGENTS.md. Still pending by task design: actual PR/CI proof and server-side ruleset after the operator resolves GitHub tier versus visibility.
- 2026-07-29T13:53:34Z — note: Identity verification: gh API reports login=shiftynick; SSH authenticated as shiftynick; global Git attribution is Nicholas Underwood <shiftynick@gmail.com>; repo-local user.name/user.email remain unset, so no machine-global authentication or attribution was rewritten. Origin is git@github.com:shiftynick/aigent-place.git.
- 2026-07-29T13:54:49Z — run: node scripts/check.mjs
  started 2026-07-29T13:54:35Z, exit 0 in 14.7s
  output tail (truncated to last 30 lines):
  |     # Subtest: soft-deletes by setting status=done and adding deleted:true tag
  |     ok 1 - soft-deletes by setting status=done and adding deleted:true tag
  |       ---
  |       duration_ms: 128.482
  |       type: 'test'
  |       ...
  |     # Subtest: keeps dependents blocked when their blocker is soft-deleted
  |     ok 2 - keeps dependents blocked when their blocker is soft-deleted
  |       ---
  |       duration_ms: 317.1488
  |       type: 'test'
  |       ...
  |     1..2
  | ok 121 - task rm
  |   ---
  |   duration_ms: 445.7328
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
  | # duration_ms 14040.4918
  |
  | run-checks: PASS (skill-sync + 14 suites)
  | process-docs: PASS (no unresolved markers in scoped non-binary files)
- 2026-07-29T13:54:59Z — note: Cold review round 2, rung 1. Accepted and fixed: operator decision is explicit in the planning journal and GitHub Actions choice; handoff operator question now names Pro vs public; gate prerequisites and exact Node pin are documented; merge summary now denies standing merge authority until protection is active; hook adds a timeout plus unterminated allowed-line regression; attributes preserve CRLF for future cmd/bat files; CI concurrency deduplicates push/PR runs by head branch and cancels superseded non-main runs; protected-branch literal is documented. Verified the staged hook is mode 100755 with zero CR bytes. Rejected as expected lifecycle sequencing: untracked/staged deliverables and PR/CI proof are satisfied by the commit/push steps after review, not defects in the implementation packet. The full gate is now recorded green: 16 local tests and 289 Foundry tests. No recurring product defect pattern was found for REVIEW-STANDARDS.
- 2026-07-29T13:57:41Z — note: Cold review round 3, rung 1 final local review. Fixed the two remaining material findings: concurrency now keys both push and PR events by the same normalized head/ref name, and HANDOFF pickup explicitly resolves task-019 before task-002. Also removed stale AGENTS future-tense claiming branch CI still needed. Byte probes confirmed no replacement characters in the PR template/task log; pinned Action SHAs were resolved live from their official GitHub tags before use. Review cap reached with no unresolved local must-fix finding; only the disclosed external GitHub tier decision and remote PR proof remain.
- 2026-07-29T13:58:06Z — run: git push --dry-run origin HEAD:main
  started 2026-07-29T13:58:05Z, exit 1 in 0.7s
  output:
  |
  | pre-push: refusing to push directly to refs/heads/main.
  |
  |   This project uses one task branch and pull request per task.
  |   Push task-NNN-short-slug and open a PR instead.
  |
  |   See AGENTS.md "Git discipline".
  |
  | error: failed to push some refs to 'github.com:shiftynick/aigent-place.git'
- 2026-07-29T13:58:13Z — note: Expected negative-path evidence: the recorded dry-run push of HEAD to refs/heads/main exited 1 because .githooks/pre-push refused the update with branch-per-task guidance. This is the required success condition for the guard, not a validation defect.
- 2026-07-29T14:01:11Z — note: CI diagnosis: run 30458552046 was cancelled by concurrency when PR run 30458602666 started; the repository gate did not fail. The PR run passed in 47s, proving checkout, pinned Actions, Node 22.22.2 resolution, POSIX hook tests, and the clean Ubuntu gate. Because gh pr checks reports the cancelled duplicate as fail, narrowed CI to pull requests plus main pushes, matching the operator-approved design and avoiding ambiguous duplicate process-gate contexts. This correction landed after the three-round review cap; it directly implements the final reviewer recommendation and will be validated by the replacement PR run.
- 2026-07-29T14:01:27Z — run: node scripts/check.mjs
  started 2026-07-29T14:01:11Z, exit 0 in 15.3s
  output tail (truncated to last 30 lines):
  |     # Subtest: soft-deletes by setting status=done and adding deleted:true tag
  |     ok 1 - soft-deletes by setting status=done and adding deleted:true tag
  |       ---
  |       duration_ms: 126.2409
  |       type: 'test'
  |       ...
  |     # Subtest: keeps dependents blocked when their blocker is soft-deleted
  |     ok 2 - keeps dependents blocked when their blocker is soft-deleted
  |       ---
  |       duration_ms: 330.8428
  |       type: 'test'
  |       ...
  |     1..2
  | ok 121 - task rm
  |   ---
  |   duration_ms: 457.1931
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
  | # duration_ms 14582.0547
  |
  | run-checks: PASS (skill-sync + 14 suites)
  | process-docs: PASS (no unresolved markers in scoped non-binary files)
- 2026-07-29T14:02:43Z — note: Remote proof: draft PR #1 https://github.com/shiftynick/aigent-place/pull/1. Replacement pull_request run 30458820759 completed success; process-gate passed in 48s on a clean Ubuntu checkout with pinned checkout/setup-node commits and Node 22.22.2. No duplicate branch-push run was created after narrowing triggers. All local/remote acceptance is complete except server-side protection and required-check enforcement.
- 2026-07-29T14:02:43Z — moved to blocked
- 2026-07-29T14:11:00Z — edited (-tag needs:operator; description updated)
- 2026-07-29T14:11:00Z — note: Operator resolved the blocker: make shiftynick/aigent-place public. Visibility verified PUBLIC. Created active repository ruleset 19976689 with no bypass actors: exact main ref, deletion and non-fast-forward blocked, linear history, PR required, squash-only, stale approvals dismissed, review threads resolved, 0 approvals while solo, and strict required process-gate. Resuming review for final documentation and live enforcement verification.
- 2026-07-29T14:11:01Z — moved to review
- 2026-07-29T14:12:25Z — run: node scripts/check.mjs
  started 2026-07-29T14:12:09Z, exit 0 in 16.2s
  output tail (truncated to last 30 lines):
  |     # Subtest: soft-deletes by setting status=done and adding deleted:true tag
  |     ok 1 - soft-deletes by setting status=done and adding deleted:true tag
  |       ---
  |       duration_ms: 126.2055
  |       type: 'test'
  |       ...
  |     # Subtest: keeps dependents blocked when their blocker is soft-deleted
  |     ok 2 - keeps dependents blocked when their blocker is soft-deleted
  |       ---
  |       duration_ms: 306.2395
  |       type: 'test'
  |       ...
  |     1..2
  | ok 121 - task rm
  |   ---
  |   duration_ms: 432.5401
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
  | # duration_ms 15439.6746
  |
  | run-checks: PASS (skill-sync + 14 suites)
  | process-docs: PASS (no unresolved markers in scoped non-binary files)
- 2026-07-29T14:12:29Z — run: gh api repos/shiftynick/aigent-place/rulesets/19976689
  started 2026-07-29T14:12:29Z, exit 0 in 0.5s
  output:
  | {"id":19976689,"name":"main protection","target":"branch","source_type":"Repository","source":"shiftynick/aigent-place","enforcement":"active","conditions":{"ref_name":{"exclude":[],"include":["refs/heads/main"]}},"rules":[{"type":"deletion"},{"type":"non_fast_forward"},{"type":"required_linear_history"},{"type":"pull_request","parameters":{"required_approving_review_count":0,"dismiss_stale_reviews_on_push":true,"required_reviewers":[],"require_code_owner_review":false,"require_last_push_approval":false,"required_review_thread_resolution":true,"allowed_merge_methods":["squash"]}},{"type":"required_status_checks","parameters":{"strict_required_status_checks_policy":true,"do_not_enforce_on_create":false,"required_status_checks":[{"context":"process-gate"}]}}],"node_id":"RRS_lACqUmVwb3NpdG9yec5Oc0cmzgEw0fE","created_at":"2026-07-29T10:10:27.660-04:00","updated_at":"2026-07-29T10:10:27.705-04:00","bypass_actors":[],"current_user_can_bypass":"never","_links":{"self":{"href":"https://api.github.com/repos/shiftynick/aigent-place/rulesets/19976689"},"html":{"href":"https://github.com/shiftynick/aigent-place/rules/19976689"}}}
- 2026-07-29T14:12:46Z — note: Post-blocker closeout changed only operator-approved visibility state, the live ruleset, task state, and matching process documentation after the three-round cold-review cap. Self-review re-read AGENTS.md, README.md, CONTRIBUTING.md, HANDOFF.md, and both journals end to end; stale-claim search found no private/pending/protection contradiction in authoritative docs, and git diff --check passed. No additional cold-review round is permitted by the task lifecycle cap.
