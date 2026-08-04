---
id: task-012
title: Specify the ruleset schema and constitution boundary
status: done
priority: p0
tags: [area:architecture, milestone:foundations]
blockedBy: []
createdAt: "2026-07-29T12:55:19Z"
updatedAt: "2026-08-04T16:16:43Z"
---

<!-- task-tracker:description -->
## Description

Write the normative Step 0 ruleset schema, non-votable constitution, composite envelope validation, activation/rollback lifecycle, and Track A/Track B boundary. Acceptance: every mutable parameter has type/range/cross-field constraints, forbidden proposals fail deterministically, and activation plus rollback examples are checkable.

<!-- task-tracker:log -->
## Log

- 2026-07-29T12:55:19Z — created (status: backlog)
- 2026-08-04T15:49:33Z — note: operator: use your judgement on all open Step 0 questions (2026-08-04)
- 2026-08-04T15:49:33Z — note: judgment: soak 60s ordinary / 300s metaparams; majority vs 2/3 supermajority; linear constitution cost model from §1 targets; full mutable catalog from ARCHITECTURE+world expectations with type/range/migration
- 2026-08-04T16:07:40Z — note: rubric: (1) ruleset/v1 CONTRACT defines mutable parameter catalog with type/range/cross-field/migration (2) non-votable constitution cites workload targets and linear cost envelope (3) Track A activation/rollback and Track B boundary are fixture-checkable (4) forbidden proposals fail deterministically in evaluator (5) ADR + README + check.mjs wiring
- 2026-08-04T16:07:41Z — moved to in_progress (claimed by shift@Shiftor)
- 2026-08-04T16:10:51Z — moved to review
- 2026-08-04T16:11:20Z — run: node scripts/check.mjs
  started 2026-08-04T16:10:51Z, exit 0 in 29.1s
  output tail (truncated to last 30 lines):
  |     # Subtest: soft-deletes by setting status=done and adding deleted:true tag
  |     ok 1 - soft-deletes by setting status=done and adding deleted:true tag
  |       ---
  |       duration_ms: 246.3064
  |       type: 'test'
  |       ...
  |     # Subtest: keeps dependents blocked when their blocker is soft-deleted
  |     ok 2 - keeps dependents blocked when their blocker is soft-deleted
  |       ---
  |       duration_ms: 620.8753
  |       type: 'test'
  |       ...
  |     1..2
  | ok 159 - task rm
  |   ---
  |   duration_ms: 867.3297
  |   type: 'suite'
  |   ...
  | 1..159
  | # tests 359
  | # suites 62
  | # pass 357
  | # fail 0
  | # cancelled 0
  | # skipped 2
  | # todo 0
  | # duration_ms 28459.9495
  |
  | run-checks: PASS (skill-sync + 18 suites)
  | process-docs: PASS (no unresolved markers in scoped non-binary files)
- 2026-08-04T16:16:43Z — run: node scripts/check.mjs
  started 2026-08-04T16:16:14Z, exit 0 in 28.6s
  output tail (truncated to last 30 lines):
  |     # Subtest: soft-deletes by setting status=done and adding deleted:true tag
  |     ok 1 - soft-deletes by setting status=done and adding deleted:true tag
  |       ---
  |       duration_ms: 194.6256
  |       type: 'test'
  |       ...
  |     # Subtest: keeps dependents blocked when their blocker is soft-deleted
  |     ok 2 - keeps dependents blocked when their blocker is soft-deleted
  |       ---
  |       duration_ms: 466.8741
  |       type: 'test'
  |       ...
  |     1..2
  | ok 159 - task rm
  |   ---
  |   duration_ms: 661.615
  |   type: 'suite'
  |   ...
  | 1..159
  | # tests 359
  | # suites 62
  | # pass 357
  | # fail 0
  | # cancelled 0
  | # skipped 2
  | # todo 0
  | # duration_ms 27934.9852
  |
  | run-checks: PASS (skill-sync + 18 suites)
  | process-docs: PASS (no unresolved markers in scoped non-binary files)
- 2026-08-04T16:16:43Z — note: cold-review: rung 1 SPEC=codex STANDARDS=claude; round1 findings fixed (one-vote-per-account, live pass_threshold, Track B vote lifecycle, vote duration, catalog speed/despawn, soak error-rate, ADR tick math/cost wording, rejection reason set). Remaining logged: full entity migration simulation deferred to task-007; catalog not every future limit; ceiling equals default cost by design.
- 2026-08-04T16:16:43Z — moved to done
