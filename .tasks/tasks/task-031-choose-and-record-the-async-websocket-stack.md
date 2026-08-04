---
id: task-031
title: Choose and record the async WebSocket stack
status: done
priority: p1
tags: [milestone:live-connection-slice, area:network]
blockedBy: []
createdAt: "2026-08-04T20:36:31Z"
updatedAt: "2026-08-04T20:46:42Z"
---

<!-- task-tracker:description -->
## Description

Propose and accept an ADR naming the world-server async runtime and WebSocket library for v1 (listen, accept, framed binary envelopes) under the fixed 20 Hz non-blocking sim contract and Windows CI. Acceptance: ADR accepted; choice documented so later transport tasks do not invent stack ad hoc; no production listen path required in this task beyond what the ADR needs to be concrete.

<!-- task-tracker:log -->
## Log

- 2026-08-04T20:36:31Z — created (status: backlog)
- 2026-08-04T20:36:56Z — note: operator: approved live-connection-slice 2026-08-04; agent judgment + ADR for tokio/WebSocket stack
- 2026-08-04T20:36:57Z — moved to ready
- 2026-08-04T20:41:40Z — note: rubric: (1) ADR names async runtime + WebSocket library for v1 listen/accept/binary envelopes (2) options genuinely weighed incl. tick non-blocking and Windows CI (3) status accepted under operator agent-judgment go-ahead (4) adr index updated (5) follow-ups point at transport tasks not invent stack (6) no production listen implementation required
- 2026-08-04T20:41:40Z — moved to in_progress (claimed by shift@Shiftor)
- 2026-08-04T20:42:12Z — note: chose tokio + axum binary WebSocket; sync sim on dedicated owner with bounded channels; accepted under operator agent-judgment go-ahead (no listen impl in this task)
- 2026-08-04T20:42:40Z — moved to review
- 2026-08-04T20:45:44Z — note: cold-review: rung1 codex SPEC+STANDARDS; r1 findings (Windows CI option compare; operator cite in packet) fixed; r2 both PASS
- 2026-08-04T20:46:41Z — run: node scripts/check.mjs
  started 2026-08-04T20:45:44Z, exit 0 in 57.0s
  output tail (truncated to last 30 lines):
  | > aigent-place@0.1.0 viewer:smoke
  | > npm run smoke -w @aigent-place/viewer
  |
  |
  | > @aigent-place/viewer@0.1.0 smoke
  | > node ./scripts/smoke.mjs
  |
  | viewer: smoke ok
  | product-check: PASS
  |     Checking workload-harness v0.1.0 (N:\aigent-place\crates\workload-harness)
  |     Finished `dev` profile [unoptimized + debuginfo] target(s) in 0.43s
  |    Compiling workload-harness v0.1.0 (N:\aigent-place\crates\workload-harness)
  |     Finished `test` profile [unoptimized + debuginfo] target(s) in 1.03s
  |      Running unittests src\lib.rs (target\debug\deps\aigent_protocol-86d67fcb42c6c4e6.exe)
  |      Running unittests src\lib.rs (target\debug\deps\protocol_conformance-4de84872cf483720.exe)
  |      Running unittests src\main.rs (target\debug\deps\protocol_conformance-6496179a32a996ea.exe)
  |      Running unittests src\lib.rs (target\debug\deps\workload_harness-30ad363e4391c815.exe)
  |      Running unittests src\main.rs (target\debug\deps\workload_harness-250851091f446973.exe)
  |      Running unittests src\lib.rs (target\debug\deps\world_server-8b2395def4e5f8a5.exe)
  |      Running unittests src\main.rs (target\debug\deps\world_server-20961b293e18112a.exe)
  |      Running tests\aoi_behavior.rs (target\debug\deps\aoi_behavior-bb3d3fa6d4b52b0c.exe)
  |      Running tests\core_behavior.rs (target\debug\deps\core_behavior-27e34be77b07f0f2.exe)
  |      Running tests\reliability_behavior.rs (target\debug\deps\reliability_behavior-ec5ac31ad01948c6.exe)
  |      Running tests\ruleset_persist_behavior.rs (target\debug\deps\ruleset_persist_behavior-8c2280d1b0b92702.exe)
  |      Running tests\session_behavior.rs (target\debug\deps\session_behavior-b33dbd4f25948a60.exe)
  |      Running tests\snapshot_behavior.rs (target\debug\deps\snapshot_behavior-0187fbac67f66f88.exe)
  |    Doc-tests aigent_protocol
  |    Doc-tests protocol_conformance
  |    Doc-tests workload_harness
  |    Doc-tests world_server
- 2026-08-04T20:46:42Z — moved to done
