---
id: task-9511132326000001
title: Handle SnapshotResyncRequest on WebSocket observe path
status: done
priority: p2
tags: [area:network]
blockedBy: []
createdAt: "2026-08-04T22:11:22Z"
updatedAt: "2026-08-04T23:17:11Z"
---

<!-- task-tracker:description -->
## Description

Viewer currently recovers baseline loss by reconnecting. Transport should accept SnapshotResyncRequest and emit a fresh full snapshot without forcing reconnect.

<!-- task-tracker:log -->
## Log

- 2026-08-04T22:11:22Z — created (status: backlog)
- 2026-08-04T23:03:32Z — note: rubric: (1) transport accepts SnapshotResyncRequest on observe path (2) emits fresh full snapshot without forcing reconnect (3) preserves ordered event stream cursor (protocol v1) (4) focused WS/integration test proves resync without new handshake (5) docs note the recovery path (6) gate passes
- 2026-08-04T23:03:32Z — moved to in_progress (claimed by shift@Shiftor)
- 2026-08-04T23:06:12Z — note: chose deliver_client_resync via fanout.client_resync so event cursor stays intact; viewer sends SnapshotResyncRequest in-band instead of closing the socket
- 2026-08-04T23:06:12Z — moved to review
- 2026-08-04T23:12:34Z — note: cold-review r1 (codex rung 1): fixed hold_observe race around resync delivery; INVALID_ENVELOPE on conn-id/major mismatch
- 2026-08-04T23:12:34Z — run: cargo test -p world-server --test snapshot_resync_behavior --quiet
  started 2026-08-04T23:12:34Z, exit 0 in 0.2s
  output:
  |
  | running 1 test
  | .
  | test result: ok. 1 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.01s
- 2026-08-04T23:13:27Z — run: node scripts/check.mjs
  started 2026-08-04T23:12:34Z, exit 0 in 53.0s
  output tail (truncated to last 30 lines):
  |     Finished `test` profile [unoptimized + debuginfo] target(s) in 1.36s
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
- 2026-08-04T23:16:13Z — note: cold-review r2 (codex rung 1): required envelope metadata; duplicate message_id → INVALID_ENVELOPE; duplicate assertion in focused test; viewer+scripted-move send metadata
- 2026-08-04T23:16:13Z — note: adjudicated: hold_observe + envelope boundary closed; concurrent race covered by hold flag; rung1 codex
- 2026-08-04T23:16:14Z — run: cargo test -p world-server --test snapshot_resync_behavior --quiet
  started 2026-08-04T23:16:13Z, exit 0 in 0.2s
  output:
  |
  | running 1 test
  | .
  | test result: ok. 1 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.01s
- 2026-08-04T23:17:05Z — run: node scripts/check.mjs
  started 2026-08-04T23:16:14Z, exit 0 in 51.0s
  output tail (truncated to last 30 lines):
  |     Finished `test` profile [unoptimized + debuginfo] target(s) in 1.36s
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
- 2026-08-04T23:17:11Z — moved to done
