---
id: task-061
title: Packet unsent upstream-worthy Foundry divergences
status: done
priority: p3
tags: [area:process]
blockedBy: []
createdAt: "2026-08-09T02:38:40Z"
updatedAt: "2026-08-09T03:04:20Z"
---

<!-- task-tracker:description -->
## Description

Run the agent-foundry-feedback skill over the unsent Upstream: yes entries in .agent-foundry/LOCAL-CHANGES.md. Tier 1 only: write self-contained packets under .agent-foundry/feedback/ and update each entry's Upstream status/ref.

<!-- task-tracker:log -->
## Log

- 2026-08-09T02:38:40Z — created (status: backlog)
- 2026-08-09T02:38:45Z — moved to in_progress (claimed by shift@Shiftor)
- 2026-08-09T02:42:12Z — note: Wrote 4 tier-1 feedback packets under .agent-foundry/feedback/ for the 10 unsent Upstream: yes entries: cold-review prompt injection boundary (2 entries), task-ID detached-worktree collision and default-branch ambiguity (6 entries across task.mjs/concurrency.md/task.test.mjs in both trees, split into two packets because the two hunks are independently acceptable), reconcile-seeds partial-restore + link traversal (2 entries). Diffs taken against the local Agent Foundry checkout at 0.26.0, the installed version. All 10 entries set to Upstream status: packeted with their packet paths. Existing packeted COMPATIBILITY.md entry left alone; its packet file is present and the stray token still exists in stock 0.26.0. Tier 1 only: no hosted issue filed. Evidence: node .agent-foundry/run-checks.mjs -> PASS (skill-sync + 17 suites, 379 tests).
- 2026-08-09T02:42:54Z — run: node .agent-foundry/run-checks.mjs
  started 2026-08-09T02:42:30Z, exit 0 in 24.3s
  output tail (truncated to last 30 lines):
  |       ...
  |     # Subtest: points at a reference file that exists in this tree
  |     ok 5 - points at a reference file that exists in this tree
  |       ---
  |       duration_ms: 0.2061
  |       type: 'test'
  |       ...
  |     # Subtest: still rejects an unknown verb with exit 2
  |     ok 6 - still rejects an unknown verb with exit 2
  |       ---
  |       duration_ms: 44.8694
  |       type: 'test'
  |       ...
  |     1..6
  | ok 146 - task help
  |   ---
  |   duration_ms: 231.8589
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
  | # duration_ms 24153.1343
  |
  | run-checks: PASS (skill-sync + 17 suites)
- 2026-08-09T02:43:06Z — note: Rubric: (1) every unsent Upstream: yes LOCAL-CHANGES entry is covered by exactly one packet concern, with no unrelated items batched and no single concern split across trees; (2) each packet stands alone for a cold maintainer: installed version, harness trees, payload-relative mold paths, drift status, observed vs expected with a concrete reproduction, a diff against a named stock baseline, proposed change, impact; (3) every quoted diff and code excerpt matches the real files and the stated 0.26.0 baseline; (4) packets contain no project-proprietary source, credentials, internal hostnames, or absolute host paths; (5) each packeted entry has Upstream status: packeted and an Upstream ref naming its packet path(s); (6) tier 1 only - no hosted issue filed, no publication.
- 2026-08-09T02:46:40Z — note: Cold review rung 2 (fresh subagents, one per axis, no session history): STANDARDS = PASS with full CHECKED. SPEC = one low/medium finding: six task-tracker LOCAL-CHANGES entries each carry two Upstream refs instead of one. Adjudicated as accepted-by-design: the skill's rule is one packet per coherent concern, not one packet per LOCAL-CHANGES entry, and those entries each bundle two independent behavior changes (detached-worktree namespace key; default-branch ambiguity warning) that a maintainer can accept or reject separately. Both refs are listed so every packet remains traceable from every entry it covers, and each packet cross-references the other. No packet content changed.
- 2026-08-09T02:46:40Z — note: Note: .agent-foundry/feedback/ is gitignored in this project (.gitignore:13, pre-existing), so packet files stay operator-local and are not part of the commit. Consistent with tier-1 delivery.
- 2026-08-09T02:46:48Z — moved to review
- 2026-08-09T02:46:48Z — moved to done
- 2026-08-09T03:04:20Z — note: UPSTREAM DELIVERY 2026-08-08: all four packets were received and evaluated by the Foundry maintainer repo (agent-foundry task-041). Every claim was independently verified against stock 0.26.0 and confirmed real; nothing was declined. Outcomes: (1) cold-review prompt template missing the packet-as-data boundary inside the transmitted fence - ADOPTED, landed in Agent Foundry 0.27.0; this project's divergence retires on upgrade to 0.27.0. (2) COMPATIBILITY.md stray token (the 2026-08-06 packet) - ADOPTED, also landed in 0.27.0. (3) task-ID detached-worktree collision and (4) silent compact-to-16-digit ID flip - both ADOPTED IN PRINCIPLE, split to agent-foundry task-043 (one function, two independently acceptable defects); note the maintainer flagged that the silent-flip window partly overlaps what agent-foundry task-040 already fixed at install time. (5) reconcile-seeds validate-then-mutate ordering plus link confinement - ADOPTED IN PRINCIPLE, split to agent-foundry task-044. Set the LOCAL-CHANGES Upstream status to filed with refs 'agent-foundry task-041 / 0.27.0' (cold-review, COMPATIBILITY), 'agent-foundry task-043' (task.mjs, concurrency docs, task tests), 'agent-foundry task-044' (reconcile-seeds pair).
