---
id: task-035
title: Script an aigent connect and move-lease path
status: done
priority: p1
tags: [milestone:live-connection-slice, area:sdk]
blockedBy: [task-033, task-034]
createdAt: "2026-08-04T20:36:47Z"
updatedAt: "2026-08-04T22:01:49Z"
---

<!-- task-tracker:description -->
## Description

Provide a reproducible scripted aigent (SDK or harness) that connects over WebSocket, completes handshake, issues move leases with sequence and idempotency keys, and prints authoritative results or typed rejections. Acceptance: documented one-command local run against a listening world-server moves a body across ticks; replay of the same idempotency key returns the original result; gate or focused test covers the happy path.

<!-- task-tracker:log -->
## Log

- 2026-08-04T20:36:47Z — created (status: backlog)
- 2026-08-04T21:53:47Z — note: rubric: (1) one-command local run connects aigent over WS against listening world-server (2) issues move lease with sequence+idempotency (3) prints authoritative result or typed rejection (4) idempotency replay returns original result (5) body moves across ticks / documented (6) focused test or gate covers happy path
- 2026-08-04T21:53:47Z — moved to in_progress (claimed by shift@Shiftor)
- 2026-08-04T21:58:56Z — note: chose wire MOVE→UpsertLease with empty payload; --listen spawns 20Hz tick+drain; SDK script for one-command demo; Say remains UnsupportedMessage stand-in
- 2026-08-04T21:58:56Z — moved to review
- 2026-08-04T21:59:18Z — run: cargo test -p world-server --test scripted_aigent_behavior --quiet
  started 2026-08-04T21:59:18Z, exit 0 in 0.6s
  output:
  |
  | running 1 test
  | .
  | test result: ok. 1 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.27s
- 2026-08-04T22:00:25Z — run: node scripts/check.mjs
  started 2026-08-04T21:59:18Z, exit 0 in 67.0s
  output tail (truncated to last 30 lines):
  | viewer: smoke ok
  | product-check: PASS
  |     Checking world-server v0.1.0 (N:\aigent-place\crates\world-server)
  |     Checking workload-harness v0.1.0 (N:\aigent-place\crates\workload-harness)
  |     Checking protocol-conformance v0.1.0 (N:\aigent-place\crates\protocol-conformance)
  |     Finished `dev` profile [unoptimized + debuginfo] target(s) in 1.71s
  |    Compiling world-server v0.1.0 (N:\aigent-place\crates\world-server)
  |    Compiling workload-harness v0.1.0 (N:\aigent-place\crates\workload-harness)
  |     Finished `test` profile [unoptimized + debuginfo] target(s) in 4.10s
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
- 2026-08-04T22:01:40Z — note: cold-review r1 (codex rung 1): fixed stale enqueue retry under world lock; script prints typed rejections and waits across ticks. Adjudicated: sim-on-tokio-task is demo slice (existing async-writer follow-up); durable-before-apply still separate.
- 2026-08-04T22:01:49Z — moved to done
