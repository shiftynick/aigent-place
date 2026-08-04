---
id: task-016
title: Implement interest management and AOI truncation
status: done
priority: p1
tags: [area:core, milestone:world-core]
blockedBy: [task-005]
createdAt: "2026-07-29T12:55:19Z"
updatedAt: "2026-08-04T20:09:33Z"
---

<!-- task-tracker:description -->
## Description

Implement spatial interest management and nearest-first area-of-interest truncation for aigent percepts and viewer snapshots. Acceptance: tests prove deterministic membership/order, the 100-entity hard cap, boundary movement, empty areas, and bounded work under dense populations.

<!-- task-tracker:log -->
## Log

- 2026-07-29T12:55:19Z — created (status: backlog)
- 2026-08-04T19:56:07Z — note: rubric: (1) deterministic nearest-first membership/order with distance ties by ascending entity_id (2) 100-entity hard cap never exceeded (3) boundary movement updates enter/leave correctly (4) empty interest sets handled (5) dense populations use bounded spatial gather (6) gates pass
- 2026-08-04T19:56:07Z — moved to in_progress (claimed by shift@Shiftor)
- 2026-08-04T19:58:32Z — note: chose pure aoi truncate_nearest + SpatialHash gather; enter/leave via interest_diff; no radius (workload has none); caps match AOI_HARD_CAP/VIEWER ladder; off-tick policy only
- 2026-08-04T19:58:32Z — note: docs: no ARCHITECTURE edit — §1/§2 already name 100 hard-cap nearest-first AOI; behavior in aoi_behavior.rs
- 2026-08-04T19:58:32Z — moved to review
- 2026-08-04T19:58:56Z — run: cargo test -p world-server --test aoi_behavior
  started 2026-08-04T19:58:55Z, exit 0 in 1.3s
  output:
  |
  | running 8 tests
  | test deterministic_membership_and_order_ignore_input_shuffle ... ok
  | test empty_interest_set ... ok
  | test hard_cap_truncates_to_100 ... ok
  | test boundary_movement_updates_enter_leave ... ok
  | test duplicate_ids_rejected ... ok
  | test viewer_cap_shrinks_while_aigent_stays_hard_cap ... ok
  | test spatial_nearest_matches_full_truncate ... ok
  | test dense_population_spatial_gather_is_bounded ... ok
  |
  | test result: ok. 8 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.03s
  |
  |    Compiling world-server v0.1.0 (N:\aigent-place\crates\world-server)
  |     Finished `test` profile [unoptimized + debuginfo] target(s) in 1.07s
  |      Running tests\aoi_behavior.rs (target\debug\deps\aoi_behavior-bb3d3fa6d4b52b0c.exe)
- 2026-08-04T19:59:48Z — run: node scripts/check.mjs
  started 2026-08-04T19:58:56Z, exit 0 in 52.4s
  output tail (truncated to last 30 lines):
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
  |     Checking world-server v0.1.0 (N:\aigent-place\crates\world-server)
  |     Checking protocol-conformance v0.1.0 (N:\aigent-place\crates\protocol-conformance)
  |     Finished `dev` profile [unoptimized + debuginfo] target(s) in 0.72s
  |    Compiling world-server v0.1.0 (N:\aigent-place\crates\world-server)
  |    Compiling protocol-conformance v0.1.0 (N:\aigent-place\crates\protocol-conformance)
  |     Finished `test` profile [unoptimized + debuginfo] target(s) in 3.47s
  |      Running unittests src\lib.rs (target\debug\deps\aigent_protocol-86d67fcb42c6c4e6.exe)
  |      Running unittests src\lib.rs (target\debug\deps\protocol_conformance-4de84872cf483720.exe)
  |      Running unittests src\main.rs (target\debug\deps\protocol_conformance-6496179a32a996ea.exe)
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
  |    Doc-tests world_server
- 2026-08-04T20:05:09Z — note: cold-review r1 fixes: SpatialHash occupied-ring gather + AABB early-stop; clamp to AOI_HARD_CAP; fanout.refresh_interest enter/leave; distant/off-center regression tests
- 2026-08-04T20:06:21Z — run: node scripts/check.mjs
  started 2026-08-04T20:05:40Z, exit 1 in 40.8s
  output tail (truncated to last 30 lines):
  |  }
  |
  |  fn chebyshev(a: (i64, i64, i64), b: (i64, i64, i64)) -> i64 {
  | -    (a.0 - b.0).abs().max((a.1 - b.1).abs()).max((a.2 - b.2).abs())
  | +    (a.0 - b.0)
  | +        .abs()
  | +        .max((a.1 - b.1).abs())
  | +        .max((a.2 - b.2).abs())
  |  }
  |
  |  fn clamp_aoi_cap(cap: u32) -> Result<u32, AoiError> {
  | Diff in \\?\N:\aigent-place\crates\world-server\src\aoi.rs:249:
  |                  if let Some(farthest_id) = truncated.last().copied() {
  |                      let farthest = candidates.get(&farthest_id).expect("survivor");
  |                      let farthest_dist = farthest.distance_squared_to(focus).sqrt();
  | -                    let covered =
  | -                        self.min_dist_outside_visited_aabb(focus, focus_cell, ring);
  | +                    let covered = self.min_dist_outside_visited_aabb(focus, focus_cell, ring);
  |                      if covered >= farthest_dist {
  |                          self.last_cells_visited = cells_visited;
  |                          self.last_entities_examined = entities_examined;
  | Diff in \\?\N:\aigent-place\crates\world-server\src\aoi.rs:295:
  |          let dz = (focus.z - min_z).min(max_z - focus.z);
  |          dx.min(dy).min(dz).max(0.0)
  |      }
  | -
  |  }
  |
  |  #[cfg(test)]
  | product-check: FAIL (cargo fmt --all -- --check)
- 2026-08-04T20:07:45Z — note: adjudicated r2: fixed early-stop strict >; SpatialHash duplicate reject; fanout dense path uses SpatialHash. Enter/leave wire payload deferred (no snapshot schema yet); refresh_interest is the membership delivery API. O(N) ring-index once accepted; entities_examined remains the gather bound.
- 2026-08-04T20:08:23Z — run: node scripts/check.mjs
  started 2026-08-04T20:07:45Z, exit 1 in 37.7s
  output tail (truncated to last 30 lines):
  |   duration_ms: 800.0526
  |   type: 'suite'
  |   ...
  | 1..159
  | # tests 359
  | # suites 62
  | # pass 357
  | # fail 0
  | # cancelled 0
  | # skipped 2
  | # todo 0
  | # duration_ms 36447.1847
  |
  | run-checks: PASS (skill-sync + 18 suites)
  | process-docs: PASS (no unresolved markers in scoped non-binary files)
  | product-check: mode=full
  | product-check: cargo fmt --check
  | error: unexpected closing delimiter: `}`
  |    --> \\?\N:\aigent-place\crates\world-server\tests\aoi_behavior.rs:165:1
  |     |
  | 156 |     for id in 1..=100u64 {
  |     |                          - this opening brace...
  | 157 |         hash.insert(entity(id, 5.0, 0.0, 0.0));
  | 158 |     }
  |     |     - ...matches this closing brace
  | ...
  | 165 | }
  |     | ^ unexpected closing delimiter
  |
  | product-check: FAIL (cargo fmt --all -- --check)
- 2026-08-04T20:09:18Z — run: node scripts/check.mjs
  started 2026-08-04T20:08:33Z, exit 0 in 45.6s
  output tail (truncated to last 30 lines):
  | ✓ built in 1.17s
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
  |     Checking protocol-conformance v0.1.0 (N:\aigent-place\crates\protocol-conformance)
  |     Finished `dev` profile [unoptimized + debuginfo] target(s) in 0.26s
  |    Compiling world-server v0.1.0 (N:\aigent-place\crates\world-server)
  |    Compiling protocol-conformance v0.1.0 (N:\aigent-place\crates\protocol-conformance)
  |     Finished `test` profile [unoptimized + debuginfo] target(s) in 2.26s
  |      Running unittests src\lib.rs (target\debug\deps\aigent_protocol-86d67fcb42c6c4e6.exe)
  |      Running unittests src\lib.rs (target\debug\deps\protocol_conformance-4de84872cf483720.exe)
  |      Running unittests src\main.rs (target\debug\deps\protocol_conformance-6496179a32a996ea.exe)
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
  |    Doc-tests world_server
- 2026-08-04T20:09:33Z — note: cold-review: rung1 codex. SPEC/STANDARDS r1 SpatialHash bugs fixed; r2 early-stop/tie, duplicates, dense SpatialHash fanout path fixed. STANDARDS residual: enter/leave protobuf deferred; O(N) ring index once accepted. Gate exit 0.
- 2026-08-04T20:09:33Z — moved to done
