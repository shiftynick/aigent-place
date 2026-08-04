---
id: task-9863417679000001
title: Harden exceptional task-ID namespace fallbacks
status: done
priority: p3
tags: [area:process, phase:follow-up]
blockedBy: []
createdAt: "2026-07-31T13:03:43Z"
updatedAt: "2026-08-04T23:53:47Z"
---

<!-- task-tracker:description -->
## Description

Malformed or absent default-branch metadata produces an observable diagnostic when remote HEAD cannot identify the default branch, and concurrent detached worktrees at the same commit cannot mint colliding durable task IDs; behavior is mirrored and tested in both harness trees.

<!-- task-tracker:log -->
## Log

- 2026-07-31T13:03:43Z — created (status: backlog)
- 2026-08-04T23:45:13Z — note: rubric: (1) malformed/absent defaultBranch metadata + unusable remote HEAD emits observable diagnostic (2) that path still fails safe to namespaced IDs (3) concurrent detached worktrees at same commit mint distinct namespaces (4) tests cover diagnostic + detached collision (5) mirrored in .agents and .claude; skill sync check passes (6) gate passes
- 2026-08-04T23:45:13Z — moved to in_progress (claimed by shift@Shiftor)
- 2026-08-04T23:46:46Z — note: chose detached namespace key detached:sha:abspath so same-commit worktrees diverge; stderr warning only when metadata unusable AND origin/HEAD missing (remote HEAD still recovers compact IDs)
- 2026-08-04T23:46:46Z — moved to review
- 2026-08-04T23:52:18Z — note: cold-review r1 (codex rung 1): win32-only path lowercasing; trim+reject invalid defaultBranch; mkdtemp worktree fixtures
- 2026-08-04T23:52:18Z — note: adjudicated: rung1 codex; mirrored both harness trees
- 2026-08-04T23:52:46Z — run: node --test .claude/skills/task-tracker/scripts/task.test.mjs
  started 2026-08-04T23:52:18Z, exit 0 in 27.3s
  output tail (truncated to last 30 lines):
  |   type: 'suite'
  |   ...
  | # Subtest: task rm
  |     # Subtest: soft-deletes by setting status=done and adding deleted:true tag
  |     ok 1 - soft-deletes by setting status=done and adding deleted:true tag
  |       ---
  |       duration_ms: 515.0114
  |       type: 'test'
  |       ...
  |     # Subtest: keeps dependents blocked when their blocker is soft-deleted
  |     ok 2 - keeps dependents blocked when their blocker is soft-deleted
  |       ---
  |       duration_ms: 549.5017
  |       type: 'test'
  |       ...
  |     1..2
  | ok 13 - task rm
  |   ---
  |   duration_ms: 1064.64
  |   type: 'suite'
  |   ...
  | 1..13
  | # tests 73
  | # suites 13
  | # pass 73
  | # fail 0
  | # cancelled 0
  | # skipped 0
  | # todo 0
  | # duration_ms 27200.9865
- 2026-08-04T23:52:46Z — run: node .agent-foundry/check-skill-sync.mjs
  started 2026-08-04T23:52:46Z, exit 0 in 0.1s
  output:
  | skill-sync: PASS (16 shared skills)
- 2026-08-04T23:53:37Z — run: node scripts/check.mjs
  started 2026-08-04T23:52:46Z, exit 0 in 50.8s
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
- 2026-08-04T23:53:47Z — moved to done
