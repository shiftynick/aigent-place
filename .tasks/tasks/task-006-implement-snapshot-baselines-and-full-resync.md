---
id: task-006
title: Implement snapshot baselines and full resync
status: done
priority: p1
tags: [area:protocol, milestone:world-core]
blockedBy: [task-005, task-018]
createdAt: "2026-07-29T12:45:23Z"
updatedAt: "2026-08-04T19:04:28Z"
---

<!-- task-tracker:description -->
## Description

Implement connection snapshot production outside the simulation stage, per-connection baselines, bounded outbound queues, coalescing, and full-resync recovery. Acceptance: integration tests prove dropped baselines recover, slow connections cannot stall ticks, and sustained overflow follows the documented disconnect contract.

<!-- task-tracker:log -->
## Log

- 2026-07-29T12:45:23Z — created (status: backlog)
- 2026-07-29T13:03:23Z — edited (+blockedBy task-018)
- 2026-08-04T18:51:18Z — note: rubric: (1) snapshot production off sim stage from immutable generation (2) per-connection baselines + full-resync recovery when baseline dropped/missing (3) bounded outbound queue with coalescing (4) sustained overflow disconnects per protocol contract (5) slow connections cannot stall tick advancement (6) gates pass
- 2026-08-04T18:51:18Z — moved to in_progress (claimed by shift@Shiftor)
- 2026-08-04T18:55:25Z — note: impl: OutboundQueue + SnapshotChannel + SnapshotFanout; off-tick; 40-tick disconnect; baseline resync preserves events
- 2026-08-04T18:55:25Z — moved to review
- 2026-08-04T19:03:44Z — note: cold-review: Codex STANDARDS PASS; SPEC findings fixed (mailbox sync_channel try_send, consecutive observe_at, coalesce-to-full, resync enqueues)
- 2026-08-04T19:04:28Z — run: node scripts/check.mjs
  started 2026-08-04T19:03:44Z, exit 0 in 44.3s
  output tail (truncated to last 30 lines):
  |
  | vite v7.3.6 building client environment for production...
  | transforming...
  | ✓ 6 modules transformed.
  | rendering chunks...
  | computing gzip size...
  | dist/index.html                   0.54 kB │ gzip:   0.33 kB
  | dist/assets/index-Bz14P-qO.css    0.40 kB │ gzip:   0.29 kB
  | dist/assets/index-C7wmcl1-.js   470.97 kB │ gzip: 118.45 kB │ map: 2,654.73 kB
  | ✓ built in 1.23s
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
  |     Finished `dev` profile [unoptimized + debuginfo] target(s) in 0.06s
  |     Finished `test` profile [unoptimized + debuginfo] target(s) in 0.13s
  |      Running unittests src\lib.rs (target\debug\deps\aigent_protocol-86d67fcb42c6c4e6.exe)
  |      Running unittests src\lib.rs (target\debug\deps\world_server-8b2395def4e5f8a5.exe)
  |      Running unittests src\main.rs (target\debug\deps\world_server-20961b293e18112a.exe)
  |      Running tests\core_behavior.rs (target\debug\deps\core_behavior-27e34be77b07f0f2.exe)
  |      Running tests\session_behavior.rs (target\debug\deps\session_behavior-b33dbd4f25948a60.exe)
  |      Running tests\snapshot_behavior.rs (target\debug\deps\snapshot_behavior-0187fbac67f66f88.exe)
  |    Doc-tests aigent_protocol
  |    Doc-tests world_server
- 2026-08-04T19:04:28Z — moved to done
