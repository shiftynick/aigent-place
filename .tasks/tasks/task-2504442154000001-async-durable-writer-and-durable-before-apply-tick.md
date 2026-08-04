---
id: task-2504442154000001
title: Async durable writer and durable-before-apply tick ordering
status: done
priority: p2
tags: [milestone:live-connection-slice, area:persistence]
blockedBy: [task-032]
createdAt: "2026-08-04T20:59:02Z"
updatedAt: "2026-08-04T23:00:35Z"
---

<!-- task-tracker:description -->
## Description

Move generation durability off the simulation stage onto a bounded single-writer queue so the tick never blocks on SQLite, and reorder apply/publish so tentative mutations are not authoritative before durable commit (ADR-0005). Acceptance: slow or locked storage cannot stall the 20 Hz stage; writer failure discards the tentative generation without publishing; focused tests prove both behaviors.

<!-- task-tracker:log -->
## Log

- 2026-08-04T20:59:02Z — created (status: backlog)
- 2026-08-04T22:41:56Z — note: rubric: (1) generation durability off sim stage onto bounded single-writer queue (2) tick never blocks on SQLite I/O (3) apply/publish only after durable commit per ADR-0005 (4) writer failure discards tentative generation without publishing (5) focused tests prove non-blocking under slow/locked storage and fail-closed discard (6) gate passes
- 2026-08-04T22:41:57Z — moved to in_progress (claimed by shift@Shiftor)
- 2026-08-04T22:43:13Z — note: chose draft-then-commit-then-install for ADR-0005 durable-before-apply; AsyncSqlite single-writer thread with bounded queue so tick never awaits SQLite
- 2026-08-04T22:47:17Z — note: docs: ARCHITECTURE + README note async writer / durable-before-apply; listen demo still in-memory (writer API + tests cover async path)
- 2026-08-04T22:47:17Z — moved to review
- 2026-08-04T22:54:26Z — note: cold-review r1 (codex rung 1): fixed pending overwrite during inflight; transport publish omission; docs for advance_tick wait; in_flight clear on disconnect; deterministic nonblock proof + inflight-enqueue test
- 2026-08-04T22:54:26Z — note: cold-review r2 (codex rung 1): removed internal poll from advance_tick_nonblocking; restore pending on apply/begin errors; AsyncSqlite verify/recover via WAL reopen
- 2026-08-04T22:59:25Z — note: cold-review r3 (codex rung 1): SPEC only gate-evidence gap; STANDARDS slow-test elapsed restored as must-fix; round cap — adjudicated prior defects closed
- 2026-08-04T22:59:26Z — run: cargo test -p world-server --test async_writer_behavior --quiet
  started 2026-08-04T22:59:25Z, exit 0 in 1.3s
  output:
  |
  | running 4 tests
  | ....
  | test result: ok. 4 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.23s
- 2026-08-04T22:59:28Z — run: cargo test -p world-server --quiet
  started 2026-08-04T22:59:26Z, exit 0 in 1.7s
  output tail (truncated to last 30 lines):
  |
  |
  | running 5 tests
  | .....
  | test result: ok. 5 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.00s
  |
  |
  | running 1 test
  | .
  | test result: ok. 1 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.25s
  |
  |
  | running 6 tests
  | ......
  | test result: ok. 6 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.00s
  |
  |
  | running 7 tests
  | .......
  | test result: ok. 7 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.00s
  |
  |
  | running 4 tests
  | ....
  | test result: ok. 4 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.01s
  |
  |
  | running 0 tests
  |
  | test result: ok. 0 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.00s
- 2026-08-04T23:00:24Z — run: node scripts/check.mjs
  started 2026-08-04T22:59:28Z, exit 0 in 55.8s
  output tail (truncated to last 30 lines):
  |    Compiling protocol-conformance v0.1.0 (N:\aigent-place\crates\protocol-conformance)
  |     Finished `test` profile [unoptimized + debuginfo] target(s) in 1.26s
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
  |      Running tests\outbound_drain_behavior.rs (target\debug\deps\outbound_drain_behavior-dba27bd415f1fdef.exe)
  |      Running tests\persist_sqlite_behavior.rs (target\debug\deps\persist_sqlite_behavior-c4d71245086ff896.exe)
  |      Running tests\placeholder_payload_behavior.rs (target\debug\deps\placeholder_payload_behavior-5f159efe4496d0c4.exe)
  |      Running tests\reliability_behavior.rs (target\debug\deps\reliability_behavior-7aed9c4b0ea57898.exe)
  |      Running tests\ruleset_persist_behavior.rs (target\debug\deps\ruleset_persist_behavior-20763967ad007f17.exe)
  |      Running tests\scripted_aigent_behavior.rs (target\debug\deps\scripted_aigent_behavior-868f771fe2f3b29c.exe)
  |      Running tests\session_behavior.rs (target\debug\deps\session_behavior-5b3200c9a1bae821.exe)
  |      Running tests\snapshot_behavior.rs (target\debug\deps\snapshot_behavior-38ee57e411957cb0.exe)
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
- 2026-08-04T23:00:35Z — note: adjudicated: r1-r3 defects fixed; listen remains in-memory (API+tests cover async); cold-review rung1 codex both axes
- 2026-08-04T23:00:35Z — moved to done
