---
id: task-009
title: Build the initial workload load harness
status: done
priority: p1
tags: [area:performance, milestone:world-core]
blockedBy: [task-008, task-015, task-016]
createdAt: "2026-07-29T12:45:23Z"
updatedAt: "2026-08-04T20:23:53Z"
---

<!-- task-tracker:description -->
## Description

Create a reproducible load harness for the ARCHITECTURE.md v1 connection, AOI, tick, percept, snapshot, and queue targets. Acceptance: results report tick-overrun and cadence distributions, exercise the degradation ladder, identify the tested machine profile, and fail when contractual thresholds are exceeded.

<!-- task-tracker:log -->
## Log

- 2026-07-29T12:45:23Z — created (status: backlog)
- 2026-07-29T12:55:20Z — edited (+blockedBy task-015; +blockedBy task-016)
- 2026-08-04T20:14:11Z — note: rubric: (1) reproducible harness covers ARCHITECTURE §1 connection/AOI/tick/percept/snapshot/queue targets (2) reports tick-overrun and cadence distributions (3) exercises degradation ladder (4) identifies tested machine profile (5) fails when contractual thresholds exceeded (6) gates pass
- 2026-08-04T20:14:11Z — moved to in_progress (claimed by shift@Shiftor)
- 2026-08-04T20:19:00Z — note: chose in-process Instant sim-stage timing + synthetic ladder; host-soak optional (unpaced Instant under-band documented); wired into product-check fast+full; constants mirror workload-contract.mjs
- 2026-08-04T20:19:00Z — note: docs: README+AGENTS+product-check help updated for workload-harness
- 2026-08-04T20:19:00Z — moved to review
- 2026-08-04T20:19:01Z — run: cargo test -p workload-harness
  started 2026-08-04T20:19:00Z, exit 0 in 1.1s
  output:
  |
  | running 3 tests
  | test tests::constants_match_world_server_and_contract ... ok
  | test tests::windows_and_boundary_advance_retreat ... ok
  | test tests::gate_profile_passes ... ok
  |
  | test result: ok. 3 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.87s
  |
  |
  | running 0 tests
  |
  | test result: ok. 0 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.00s
  |
  |
  | running 0 tests
  |
  | test result: ok. 0 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.00s
  |
  |     Finished `test` profile [unoptimized + debuginfo] target(s) in 0.07s
  |      Running unittests src\lib.rs (target\debug\deps\workload_harness-30ad363e4391c815.exe)
  |      Running unittests src\main.rs (target\debug\deps\workload_harness-250851091f446973.exe)
  |    Doc-tests workload_harness
- 2026-08-04T20:19:02Z — run: cargo run -q -p workload-harness
  started 2026-08-04T20:19:01Z, exit 0 in 1.0s
  output:
  | workload-harness: machine profile
  |   os=windows arch=x86_64 family=windows cpus=24 tick=20Hz/50ms
  | workload-harness: ticks=1200 overruns=0 rate=0.0000 p50_us=33 p95_us=48 p99_us=74
  | workload-harness: viewer cadence samples=599 hist={2: 599}
  | workload-harness: aigent cadence samples=299 hist={4: 299}
  | workload-harness: aoi_max_delivered=100 queue_isolated=true final_level=0
  | workload-harness: ladder advance→1 action=Advance cadence=5 aoi=100 refuse=false floor=None
  | workload-harness: ladder advance→2 action=Advance cadence=2 aoi=100 refuse=false floor=None
  | workload-harness: ladder advance→3 action=Advance cadence=2 aoi=50 refuse=false floor=None
  | workload-harness: ladder advance→4 action=Advance cadence=2 aoi=25 refuse=false floor=None
  | workload-harness: ladder advance→5 action=Advance cadence=2 aoi=25 refuse=true floor=None
  | workload-harness: ladder advance→6 action=Advance cadence=2 aoi=25 refuse=true floor=Some(5)
  | workload-harness: ladder advance→7 action=Advance cadence=2 aoi=25 refuse=true floor=Some(2)
  | workload-harness: ladder advance→8 action=Advance cadence=2 aoi=25 refuse=true floor=Some(1)
  | workload-harness: ladder retreat→7 action=Retreat
  | workload-harness: ladder retreat→6 action=Retreat
  | workload-harness: ladder retreat→5 action=Retreat
  | workload-harness: ladder retreat→4 action=Retreat
  | workload-harness: ladder retreat→3 action=Retreat
  | workload-harness: ladder retreat→2 action=Retreat
  | workload-harness: ladder retreat→1 action=Retreat
  | workload-harness: ladder retreat→0 action=Retreat
  | workload-harness: ok
- 2026-08-04T20:20:08Z — run: node scripts/check.mjs
  started 2026-08-04T20:19:02Z, exit 0 in 65.7s
  output tail (truncated to last 30 lines):
  |
  |
  | > @aigent-place/viewer@0.1.0 smoke
  | > node ./scripts/smoke.mjs
  |
  | viewer: smoke ok
  | product-check: PASS
  |     Checking world-server v0.1.0 (N:\aigent-place\crates\world-server)
  |     Checking protocol-conformance v0.1.0 (N:\aigent-place\crates\protocol-conformance)
  |     Finished `dev` profile [unoptimized + debuginfo] target(s) in 0.62s
  |    Compiling world-server v0.1.0 (N:\aigent-place\crates\world-server)
  |    Compiling protocol-conformance v0.1.0 (N:\aigent-place\crates\protocol-conformance)
  |     Finished `test` profile [unoptimized + debuginfo] target(s) in 4.56s
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
- 2026-08-04T20:23:04Z — note: cold-review r1 fixes: capacity sustain counters; rotating connection AOI+publish_to cadence; paced --host-soak fails outside band; failure-path unit tests. Gate uses unpaced Instant profile (~1s); operator --host-soak for 60s wall band.
- 2026-08-04T20:23:04Z — note: cold-review: rung1 codex SPEC+STANDARDS; material findings fixed; residual: full 800-conn every-tick fanout deferred for gate runtime (stripe rotation covers all within window)
- 2026-08-04T20:23:53Z — run: node scripts/check.mjs
  started 2026-08-04T20:23:04Z, exit 0 in 49.1s
  output tail (truncated to last 30 lines):
  | ✓ built in 1.30s
  |
  | > aigent-place@0.1.0 viewer:smoke
  | > npm run smoke -w @aigent-place/viewer
  |
  |
  | > @aigent-place/viewer@0.1.0 smoke
  | > node ./scripts/smoke.mjs
  |
  | viewer: smoke ok
  | product-check: PASS
  |     Finished `dev` profile [unoptimized + debuginfo] target(s) in 0.14s
  |     Finished `test` profile [unoptimized + debuginfo] target(s) in 0.14s
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
- 2026-08-04T20:23:53Z — moved to done
