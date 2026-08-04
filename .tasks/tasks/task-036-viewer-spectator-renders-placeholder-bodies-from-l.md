---
id: task-036
title: Viewer spectator renders placeholder bodies from live snapshots
status: done
priority: p1
tags: [milestone:live-connection-slice, area:viewer]
blockedBy: [task-034]
createdAt: "2026-08-04T20:36:47Z"
updatedAt: "2026-08-04T22:11:22Z"
---

<!-- task-tracker:description -->
## Description

Browser viewer connects as an anonymous spectator, consumes the live snapshot/delta stream, and renders placeholder geometry for aigent bodies with basic interpolation and resync handling. Full shape grammar is out of scope. Acceptance: documented demo shows a remote scripted aigent's position update in the viewer; disconnect/resync does not permanently freeze the scene; viewer smoke remains in the product gate.

<!-- task-tracker:log -->
## Log

- 2026-08-04T20:36:47Z — created (status: backlog)
- 2026-08-04T20:36:56Z — note: operator: placeholder bodies OK; shape grammar deferred to later milestone
- 2026-08-04T22:05:07Z — note: rubric: (1) viewer connects anonymous spectator over WS (2) consumes live snapshot/delta stream (3) renders placeholder geometry for aigent bodies (4) basic interpolation (5) resync on baseline loss without permanent freeze (6) documented demo with scripted aigent position update (7) viewer smoke stays in gate
- 2026-08-04T22:05:07Z — moved to in_progress (claimed by shift@Shiftor)
- 2026-08-04T22:07:37Z — note: chose AIGB stub payload with lease-derived placeholder poses; viewer ?ws= live spectator with lerp + reconnect; smoke keeps gate
- 2026-08-04T22:07:37Z — moved to review
- 2026-08-04T22:07:38Z — run: cargo test -p world-server --test placeholder_payload_behavior --quiet
  started 2026-08-04T22:07:37Z, exit 0 in 0.2s
  output:
  |
  | running 2 tests
  | ..
  | test result: ok. 2 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.00s
- 2026-08-04T22:08:35Z — run: node scripts/check.mjs
  started 2026-08-04T22:07:38Z, exit 0 in 57.6s
  output tail (truncated to last 30 lines):
  |    Compiling protocol-conformance v0.1.0 (N:\aigent-place\crates\protocol-conformance)
  |    Compiling workload-harness v0.1.0 (N:\aigent-place\crates\workload-harness)
  |     Finished `test` profile [unoptimized + debuginfo] target(s) in 5.45s
  |      Running unittests src\lib.rs (target\debug\deps\aigent_protocol-2be7322e8a1e4d5b.exe)
  |      Running unittests src\lib.rs (target\debug\deps\protocol_conformance-3437ac2bd595267c.exe)
  |      Running unittests src\main.rs (target\debug\deps\protocol_conformance-4ddea74bf07dca6d.exe)
  |      Running unittests src\lib.rs (target\debug\deps\workload_harness-0593d857cdb62281.exe)
  |      Running unittests src\main.rs (target\debug\deps\workload_harness-9222080f938c770c.exe)
  |      Running unittests src\lib.rs (target\debug\deps\world_server-2d7c22779d6e15e7.exe)
  |      Running unittests src\main.rs (target\debug\deps\world_server-9df5988638f82bfa.exe)
  |      Running tests\aoi_behavior.rs (target\debug\deps\aoi_behavior-49d2af617aab8541.exe)
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
- 2026-08-04T22:11:22Z — note: cold-review r1 (codex rung 1): fixed explicit handshake state; baseline mismatch/resync reconnects for full snapshot; reject deltas while waitingForFull. Filed: server-side SnapshotResyncRequest handling still deferred.
- 2026-08-04T22:11:22Z — moved to done
