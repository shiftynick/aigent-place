---
id: task-034
title: Drain outbound mailboxes to WebSocket clients
status: done
priority: p1
tags: [milestone:live-connection-slice, area:network]
blockedBy: [task-033]
createdAt: "2026-08-04T20:36:47Z"
updatedAt: "2026-08-04T21:50:56Z"
---

<!-- task-tracker:description -->
## Description

Wire fan-out observe paths so snapshot baselines, deltas, authoritative results, and typed errors reach connected sockets as versioned protocol envelopes, respecting per-connection encoded byte caps and slow-client isolation (overflow disconnect without stalling sim). Acceptance: connected aigent and viewer roles receive observe traffic on the wire; sustained overflow isolates only the slow connection; product tests or harness prove non-blocking drain under load pressure.

<!-- task-tracker:log -->
## Log

- 2026-08-04T20:36:47Z — created (status: backlog)
- 2026-08-04T21:24:25Z — note: rubric: (1) snapshot/delta/result/error envelopes reach sockets (2) per-conn byte caps respected (3) sustained overflow isolates only slow conn (4) drain never blocks sim tick (5) aigent+viewer receive observe traffic (6) focused tests + gate
- 2026-08-04T21:24:25Z — moved to in_progress (claimed by shift@Shiftor)
- 2026-08-04T21:28:46Z — note: chose bounded mpsc try_send drain; pause flag models stuck writer; CommandResult also try_sent; overflow observe closes only slow
- 2026-08-04T21:28:46Z — moved to review
- 2026-08-04T21:45:29Z — note: cold-review r2 (codex rung 1): SPEC high#1 listen-loop out of scope (task-035); SPEC/STANDARDS high pending+drain_state+command accounting fixed; medium coverage/tests expanded; medium gate evidence pending task.mjs run
- 2026-08-04T21:49:39Z — run: cargo test -p world-server --test outbound_drain_behavior --quiet
  started 2026-08-04T21:49:38Z, exit 0 in 0.9s
  output:
  |
  | running 6 tests
  | ......
  | test result: ok. 6 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.65s
- 2026-08-04T21:49:46Z — note: cold-review r3 (codex rung 1): fixed silent-drop via pending eviction; fixed drain_all race under sockets lock; ProtocolError wire test added. Adjudicated: frame-count channel vs QUEUE_LIMIT_BYTES is protocol accounting-by-design; PublicationMailbox mutex pre-exists (follow-up async writer). Round cap reached after must-fixes.
- 2026-08-04T21:50:46Z — run: node scripts/check.mjs
  started 2026-08-04T21:49:46Z, exit 0 in 60.0s
  output tail (truncated to last 30 lines):
  | viewer: smoke ok
  | product-check: PASS
  |     Checking world-server v0.1.0 (N:\aigent-place\crates\world-server)
  |     Checking workload-harness v0.1.0 (N:\aigent-place\crates\workload-harness)
  |     Checking protocol-conformance v0.1.0 (N:\aigent-place\crates\protocol-conformance)
  |     Finished `dev` profile [unoptimized + debuginfo] target(s) in 1.14s
  |    Compiling world-server v0.1.0 (N:\aigent-place\crates\world-server)
  |    Compiling workload-harness v0.1.0 (N:\aigent-place\crates\workload-harness)
  |    Compiling protocol-conformance v0.1.0 (N:\aigent-place\crates\protocol-conformance)
  |     Finished `test` profile [unoptimized + debuginfo] target(s) in 5.27s
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
  |      Running tests\session_behavior.rs (target\debug\deps\session_behavior-5b3200c9a1bae821.exe)
  |      Running tests\snapshot_behavior.rs (target\debug\deps\snapshot_behavior-38ee57e411957cb0.exe)
  |      Running tests\transport_behavior.rs (target\debug\deps\transport_behavior-514083eccfaa7205.exe)
  |    Doc-tests aigent_protocol
  |    Doc-tests protocol_conformance
  |    Doc-tests workload_harness
  |    Doc-tests world_server
- 2026-08-04T21:50:56Z — moved to done
