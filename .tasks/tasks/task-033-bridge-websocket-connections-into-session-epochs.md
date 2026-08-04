---
id: task-033
title: Bridge WebSocket connections into session epochs
status: done
priority: p1
tags: [milestone:live-connection-slice, area:network]
blockedBy: [task-031]
createdAt: "2026-08-04T20:36:47Z"
updatedAt: "2026-08-04T21:20:00Z"
---

<!-- task-tracker:description -->
## Description

World server listens for WebSocket clients, performs protocol capability handshake, issues session epochs, stamps decoded mutating commands with arrival_tick, and displaces duplicate aigent command sessions per existing session rules. Socket I/O must not block the simulation stage. Acceptance: a real client can connect and complete handshake; aigent reconnect displaces the prior epoch; malformed envelopes are rejected without stalling ticks; documented listen/bind for local demo.

<!-- task-tracker:log -->
## Log

- 2026-08-04T20:36:47Z — created (status: backlog)
- 2026-08-04T21:07:48Z — note: rubric: (1) listen+WS upgrade per ADR-0010 (2) capability handshake + session epochs (3) mutating cmds stamped arrival_tick into session hub (4) aigent reconnect displaces prior epoch (5) malformed envelopes rejected without stalling ticks (6) documented local bind; focused tests + gate
- 2026-08-04T21:07:48Z — moved to in_progress (claimed by shift@Shiftor)
- 2026-08-04T21:12:12Z — note: chose axum /ws upgrade + SessionHub under Mutex; demo TestTrustedInject; --listen 127.0.0.1:7600; command admission deferred to 035, stamp helper present
- 2026-08-04T21:12:12Z — moved to review
- 2026-08-04T21:19:04Z — note: cold-review r1 findings fixed: command-only arrival_tick stamp+submit; displace closes prior socket; loopback guard; post-handshake malformed closes; tick isolation test. Feature multi-version intersection remains SessionHub single-version model (follow-up).
- 2026-08-04T21:20:00Z — run: node scripts/check.mjs
  started 2026-08-04T21:19:04Z, exit 0 in 55.9s
  output tail (truncated to last 30 lines):
  | viewer: smoke ok
  | product-check: PASS
  |     Checking world-server v0.1.0 (N:\aigent-place\crates\world-server)
  |     Checking workload-harness v0.1.0 (N:\aigent-place\crates\workload-harness)
  |     Checking protocol-conformance v0.1.0 (N:\aigent-place\crates\protocol-conformance)
  |     Finished `dev` profile [unoptimized + debuginfo] target(s) in 1.11s
  |    Compiling aigent-protocol v0.1.0 (N:\aigent-place\crates\aigent-protocol)
  |    Compiling world-server v0.1.0 (N:\aigent-place\crates\world-server)
  |    Compiling workload-harness v0.1.0 (N:\aigent-place\crates\workload-harness)
  |    Compiling protocol-conformance v0.1.0 (N:\aigent-place\crates\protocol-conformance)
  |     Finished `test` profile [unoptimized + debuginfo] target(s) in 2.83s
  |      Running unittests src\lib.rs (target\debug\deps\aigent_protocol-2be7322e8a1e4d5b.exe)
  |      Running unittests src\lib.rs (target\debug\deps\protocol_conformance-3437ac2bd595267c.exe)
  |      Running unittests src\main.rs (target\debug\deps\protocol_conformance-4ddea74bf07dca6d.exe)
  |      Running unittests src\lib.rs (target\debug\deps\workload_harness-0593d857cdb62281.exe)
  |      Running unittests src\main.rs (target\debug\deps\workload_harness-9222080f938c770c.exe)
  |      Running unittests src\lib.rs (target\debug\deps\world_server-2d7c22779d6e15e7.exe)
  |      Running unittests src\main.rs (target\debug\deps\world_server-9df5988638f82bfa.exe)
  |      Running tests\aoi_behavior.rs (target\debug\deps\aoi_behavior-49d2af617aab8541.exe)
  |      Running tests\core_behavior.rs (target\debug\deps\core_behavior-6198f984276ce85a.exe)
  |      Running tests\persist_sqlite_behavior.rs (target\debug\deps\persist_sqlite_behavior-c4d71245086ff896.exe)
  |      Running tests\reliability_behavior.rs (target\debug\deps\reliability_behavior-7aed9c4b0ea57898.exe)
  |      Running tests\ruleset_persist_behavior.rs (target\debug\deps\ruleset_persist_behavior-20763967ad007f17.exe)
  |      Running tests\session_behavior.rs (target\debug\deps\session_behavior-5b3200c9a1bae821.exe)
  |      Running tests\snapshot_behavior.rs (target\debug\deps\snapshot_behavior-38ee57e411957cb0.exe)
  |      Running tests\transport_behavior.rs (target\debug\deps\transport_behavior-514083eccfaa7205.exe)
  |    Doc-tests aigent_protocol
  |    Doc-tests protocol_conformance
  |    Doc-tests workload_harness
  |    Doc-tests world_server
- 2026-08-04T21:20:00Z — moved to done
