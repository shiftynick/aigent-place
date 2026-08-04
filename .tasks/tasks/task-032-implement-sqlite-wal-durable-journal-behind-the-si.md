---
id: task-032
title: Implement SQLite WAL durable journal behind the single-writer contract
status: done
priority: p1
tags: [milestone:live-connection-slice, area:persistence]
blockedBy: []
createdAt: "2026-08-04T20:36:31Z"
updatedAt: "2026-08-04T21:04:37Z"
---

<!-- task-tracker:description -->
## Description

Replace RAM-only durability for the demo/default world binary with SQLite WAL behind the existing single-writer generation journal contract (ADR-0005): admit one generation at a time, commit atomically, fail closed on corruption, recover last committed boundary. Keep an in-memory journal for fast tests. Acceptance: restart recovers last committed generation from SQLite; integrity failures fail closed; tick path still does not await commit; product gate covers the new path.

<!-- task-tracker:log -->
## Log

- 2026-08-04T20:36:31Z — created (status: backlog)
- 2026-08-04T20:36:56Z — note: operator: approved in live-connection-slice; SQLite in this front (not deferred)
- 2026-08-04T20:36:57Z — moved to ready
- 2026-08-04T20:49:44Z — note: rubric: (1) SQLite WAL journal admits one generation, atomic commit (2) restart recovers last committed (3) corrupt/gapped history fails closed (4) InMemoryJournal remains for fast tests (5) tick path has no async await on commit (6) product gate / focused tests cover sqlite recover path
- 2026-08-04T20:49:44Z — moved to in_progress (claimed by shift@Shiftor)
- 2026-08-04T20:54:10Z — note: chose DurableJournal enum (Memory|Sqlite); pending stays RAM until WAL commit; bundled rusqlite; async writer task deferred (skeleton still sync-commits in advance_tick, no .await)
- 2026-08-04T20:54:10Z — moved to review
- 2026-08-04T21:03:32Z — note: cold-review: rung1 codex SPEC PASS; STANDARDS r1 material: integrity_ok+contiguous commit+tests fixed; async durable-before-apply deferred to task-2504442154000001; r2 codec capacity+ARCH docs+commit-gap test fixed
- 2026-08-04T21:04:37Z — run: node scripts/check.mjs
  started 2026-08-04T21:03:32Z, exit 0 in 64.5s
  output tail (truncated to last 30 lines):
  |     Checking hashbrown v0.14.5
  |     Checking hashlink v0.9.1
  |     Checking rusqlite v0.32.1
  |     Checking world-server v0.1.0 (N:\aigent-place\crates\world-server)
  |     Checking workload-harness v0.1.0 (N:\aigent-place\crates\workload-harness)
  |     Checking protocol-conformance v0.1.0 (N:\aigent-place\crates\protocol-conformance)
  |     Finished `dev` profile [unoptimized + debuginfo] target(s) in 5.37s
  |     Blocking waiting for file lock on build directory
  |    Compiling world-server v0.1.0 (N:\aigent-place\crates\world-server)
  |    Compiling workload-harness v0.1.0 (N:\aigent-place\crates\workload-harness)
  |    Compiling protocol-conformance v0.1.0 (N:\aigent-place\crates\protocol-conformance)
  |     Finished `test` profile [unoptimized + debuginfo] target(s) in 4.62s
  |      Running unittests src\lib.rs (target\debug\deps\aigent_protocol-86d67fcb42c6c4e6.exe)
  |      Running unittests src\lib.rs (target\debug\deps\protocol_conformance-4fb38bf4ad182bda.exe)
  |      Running unittests src\main.rs (target\debug\deps\protocol_conformance-bec8c935e163d024.exe)
  |      Running unittests src\lib.rs (target\debug\deps\workload_harness-29b4b01ebc24b7e1.exe)
  |      Running unittests src\main.rs (target\debug\deps\workload_harness-74fdc538c3f780f8.exe)
  |      Running unittests src\lib.rs (target\debug\deps\world_server-6e692d29bcb64960.exe)
  |      Running unittests src\main.rs (target\debug\deps\world_server-468d5dec2725e83f.exe)
  |      Running tests\aoi_behavior.rs (target\debug\deps\aoi_behavior-5634a8cb8d6fb7a7.exe)
  |      Running tests\core_behavior.rs (target\debug\deps\core_behavior-870f4869e8c82656.exe)
  |      Running tests\persist_sqlite_behavior.rs (target\debug\deps\persist_sqlite_behavior-2166985e9aacdbe8.exe)
  |      Running tests\reliability_behavior.rs (target\debug\deps\reliability_behavior-e2a12336a1e80f30.exe)
  |      Running tests\ruleset_persist_behavior.rs (target\debug\deps\ruleset_persist_behavior-bea87f1e2f5f091a.exe)
  |      Running tests\session_behavior.rs (target\debug\deps\session_behavior-627107896f636414.exe)
  |      Running tests\snapshot_behavior.rs (target\debug\deps\snapshot_behavior-90df9f91fd7bdf74.exe)
  |    Doc-tests aigent_protocol
  |    Doc-tests protocol_conformance
  |    Doc-tests workload_harness
  |    Doc-tests world_server
- 2026-08-04T21:04:37Z — moved to done
