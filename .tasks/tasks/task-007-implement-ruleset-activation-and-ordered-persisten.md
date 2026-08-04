---
id: task-007
title: Implement ruleset activation and ordered persistence
status: done
priority: p1
tags: [area:core, milestone:world-core]
blockedBy: [task-005]
createdAt: "2026-07-29T12:45:23Z"
updatedAt: "2026-08-04T19:14:50Z"
---

<!-- task-tracker:description -->
## Description

Implement validated ruleset loading with tick-boundary activation and the single-writer event/snapshot persistence pipeline. Acceptance: tests prove activation is atomic at a tick boundary, invalid rulesets do not change live state, persisted ordering matches canonical simulation order, and restart reconstruction preserves the last committed world generation.

<!-- task-tracker:log -->
## Log

- 2026-07-29T12:45:23Z — created (status: backlog)
- 2026-08-04T19:06:03Z — note: rubric: (1) validated ruleset load; invalid cannot change live state (2) activation atomic at tick boundary only (3) single-writer persistence order matches canonical sim order (4) restart reconstructs last committed generation (5) gates pass
- 2026-08-04T19:06:03Z — moved to in_progress (claimed by shift@Shiftor)
- 2026-08-04T19:10:18Z — note: impl: RulesetStore + InMemoryJournal wired into World; activate at boundary; recover last committed
- 2026-08-04T19:10:18Z — moved to review
- 2026-08-04T19:14:04Z — note: cold-review: Codex SPEC findings fixed (recover discards pending; leases persisted; unknown params rejected; ruleset owns TTL); STANDARDS adjudicated
- 2026-08-04T19:14:49Z — run: node scripts/check.mjs
  started 2026-08-04T19:14:04Z, exit 0 in 45.9s
  output tail (truncated to last 30 lines):
  | vite v7.3.6 building client environment for production...
  | transforming...
  | ✓ 6 modules transformed.
  | rendering chunks...
  | computing gzip size...
  | dist/index.html                   0.54 kB │ gzip:   0.33 kB
  | dist/assets/index-Bz14P-qO.css    0.40 kB │ gzip:   0.29 kB
  | dist/assets/index-C7wmcl1-.js   470.97 kB │ gzip: 118.45 kB │ map: 2,654.73 kB
  | ✓ built in 1.18s
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
  |     Finished `test` profile [unoptimized + debuginfo] target(s) in 0.12s
  |      Running unittests src\lib.rs (target\debug\deps\aigent_protocol-86d67fcb42c6c4e6.exe)
  |      Running unittests src\lib.rs (target\debug\deps\world_server-8b2395def4e5f8a5.exe)
  |      Running unittests src\main.rs (target\debug\deps\world_server-20961b293e18112a.exe)
  |      Running tests\core_behavior.rs (target\debug\deps\core_behavior-27e34be77b07f0f2.exe)
  |      Running tests\ruleset_persist_behavior.rs (target\debug\deps\ruleset_persist_behavior-8c2280d1b0b92702.exe)
  |      Running tests\session_behavior.rs (target\debug\deps\session_behavior-b33dbd4f25948a60.exe)
  |      Running tests\snapshot_behavior.rs (target\debug\deps\snapshot_behavior-0187fbac67f66f88.exe)
  |    Doc-tests aigent_protocol
  |    Doc-tests world_server
- 2026-08-04T19:14:50Z — moved to done
