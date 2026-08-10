---
id: task-050
title: Implement the uniform spatial-hash broadphase
status: review
priority: p1
tags: [milestone:shape-collision-slice, area:server]
blockedBy: [task-048]
createdAt: "2026-08-06T13:25:08Z"
updatedAt: "2026-08-10T05:06:48Z"
---

<!-- task-tracker:description -->
## Description

There is no broadphase, so any collision query would be O(entities) per moving part. Implement the uniform spatial hash described in ARCHITECTURE section 5: sized to the maximum entity bound, rebuilt from the published immutable generation rather than mutated mid-tick. Sleeping bodies live outside the active broadphase set and are absent from overlap and enclosure queries. Iteration over candidates must be by entity id so results never depend on hash order. Acceptance: rebuild happens off the published generation and never mutates live state mid-tick; query results are identical regardless of insertion order; sleeping bodies are excluded from candidate sets; the workload harness reports broadphase rebuild plus query cost inside the 50ms tick budget at the section 1 target of 300 concurrent aigents; product gate green.

<!-- task-tracker:log -->
## Log

- 2026-08-06T13:25:08Z — created (status: backlog)
- 2026-08-10T01:01:07Z — note: operator: included in approved collision-core attack after collider and aggregate-bound work
- 2026-08-10T04:50:33Z — note: Rubric: (1) build an immutable uniform spatial-hash index only from one published ImmutableGeneration, with cell edge equal to the validated maximum entity extent and no public incremental mutation path; (2) decode and derive canonical aggregate AABBs for active leased entities only, fail closed with typed rebuild errors, and exclude sleeping/unleased or shapeless entities from overlap and enclosure candidate sets; (3) query all intersected cells with exact boundary handling, deduplicate and return candidates in ascending unsigned entity ID, with insertion/hash order unable to affect results; (4) cover generation provenance, sleeping exclusion, insertion-order independence, multi-cell/negative/boundary queries, overlap and enclosure candidate behavior, and invalid frozen geometry with deterministic tests; (5) extend the workload harness to report broadphase rebuild and query timing for 300 concurrent aigents and fail if their combined measured cost exceeds the 50 ms tick budget; focused tests and unified product gate pass.
- 2026-08-10T04:50:34Z — moved to in_progress (claimed by shift@Shiftor; note: claimed for approved collision-core attack; coding delegated to Cursor cursor-grok-4.5-high at high effort; cold SPEC and STANDARDS reviews reserved for Claude claude-fable-5-low at low effort)
- 2026-08-10T05:04:50Z — run: cargo test -p world-server broadphase
  started 2026-08-10T05:04:37Z, exit 0 in 12.5s
  output tail (truncated to last 30 lines):
  |
  | test result: ok. 0 passed; 0 failed; 0 ignored; 0 measured; 4 filtered out; finished in 0.00s
  |
  |    Compiling world-server v0.1.0 (N:\aigent-place\crates\world-server)
  |     Finished `test` profile [unoptimized + debuginfo] target(s) in 6.16s
  |      Running unittests src\lib.rs (target\debug\deps\world_server-2d7c22779d6e15e7.exe)
  |      Running unittests src\main.rs (target\debug\deps\world_server-9df5988638f82bfa.exe)
  |      Running tests\aoi_behavior.rs (target\debug\deps\aoi_behavior-49d2af617aab8541.exe)
  |      Running tests\async_writer_behavior.rs (target\debug\deps\async_writer_behavior-ecb874bd312ef40d.exe)
  |      Running tests\broadphase_behavior.rs (target\debug\deps\broadphase_behavior-601c0d9aa80d3c70.exe)
  |      Running tests\collider_behavior.rs (target\debug\deps\collider_behavior-773c1f01b6559664.exe)
  |      Running tests\core_behavior.rs (target\debug\deps\core_behavior-6198f984276ce85a.exe)
  |      Running tests\entity_store_behavior.rs (target\debug\deps\entity_store_behavior-f10dfe0979eae66c.exe)
  |      Running tests\feature_intersection_behavior.rs (target\debug\deps\feature_intersection_behavior-02eb438a23b9049c.exe)
  |      Running tests\heightfield_behavior.rs (target\debug\deps\heightfield_behavior-5f06cb291bbf434b.exe)
  |      Running tests\live_aoi_behavior.rs (target\debug\deps\live_aoi_behavior-59dfc1b5dc474ab3.exe)
  |      Running tests\outbound_drain_behavior.rs (target\debug\deps\outbound_drain_behavior-dba27bd415f1fdef.exe)
  |      Running tests\outbound_pressure_accounting.rs (target\debug\deps\outbound_pressure_accounting-e3df7fb824350619.exe)
  |      Running tests\persist_sqlite_behavior.rs (target\debug\deps\persist_sqlite_behavior-c4d71245086ff896.exe)
  |      Running tests\placeholder_payload_behavior.rs (target\debug\deps\placeholder_payload_behavior-5f159efe4496d0c4.exe)
  |      Running tests\reliability_behavior.rs (target\debug\deps\reliability_behavior-7aed9c4b0ea57898.exe)
  |      Running tests\ruleset_persist_behavior.rs (target\debug\deps\ruleset_persist_behavior-20763967ad007f17.exe)
  |      Running tests\scripted_aigent_behavior.rs (target\debug\deps\scripted_aigent_behavior-868f771fe2f3b29c.exe)
  |      Running tests\session_behavior.rs (target\debug\deps\session_behavior-5b3200c9a1bae821.exe)
  |      Running tests\shape_budget_catalog_contract.rs (target\debug\deps\shape_budget_catalog_contract-a0488f49834a77ed.exe)
  |      Running tests\shape_validation_behavior.rs (target\debug\deps\shape_validation_behavior-887d963556dfabd7.exe)
  |      Running tests\shape_validation_bounded_cost.rs (target\debug\deps\shape_validation_bounded_cost-f5eb5f21bc801b3b.exe)
  |      Running tests\snapshot_behavior.rs (target\debug\deps\snapshot_behavior-38ee57e411957cb0.exe)
  |      Running tests\snapshot_resync_behavior.rs (target\debug\deps\snapshot_resync_behavior-9021b8921bdbaa8b.exe)
  |      Running tests\transport_behavior.rs (target\debug\deps\transport_behavior-514083eccfaa7205.exe)
- 2026-08-10T05:04:52Z — run: cargo test -p workload-harness
  started 2026-08-10T05:04:50Z, exit 0 in 2.5s
  output:
  |
  | running 5 tests
  | test tests::constants_match_world_server_and_contract ... ok
  | test tests::failure_paths_are_detectable ... ok
  | test tests::windows_and_boundary_advance_retreat ... ok
  | test tests::gate_profile_passes ... ok
  | test tests::report_failures_make_ok_false ... ok
  |
  | test result: ok. 5 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 1.24s
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
  |    Compiling workload-harness v0.1.0 (N:\aigent-place\crates\workload-harness)
  |     Finished `test` profile [unoptimized + debuginfo] target(s) in 0.73s
  |      Running unittests src\lib.rs (target\debug\deps\workload_harness-5c8f22c454e7ee4f.exe)
  |      Running unittests src\main.rs (target\debug\deps\workload_harness-769cb61ce6459d91.exe)
  |    Doc-tests workload_harness
- 2026-08-10T05:04:54Z — run: cargo clippy -p world-server -p workload-harness --all-targets -- -D warnings
  started 2026-08-10T05:04:52Z, exit 0 in 1.6s
  output:
  |     Checking world-server v0.1.0 (N:\aigent-place\crates\world-server)
  |     Checking workload-harness v0.1.0 (N:\aigent-place\crates\workload-harness)
  |     Finished `dev` profile [unoptimized + debuginfo] target(s) in 1.50s
- 2026-08-10T05:05:06Z — run: cargo test -p world-server --test broadphase_behavior
  started 2026-08-10T05:05:05Z, exit 0 in 0.2s
  output:
  |
  | running 8 tests
  | test ruleset_generation_mismatch_fails_closed ... ok
  | test invalid_frozen_geometry_fails_closed ... ok
  | test rebuild_records_generation_provenance_and_cell_edge ... ok
  | test sleeping_unleased_and_shapeless_entities_are_absent ... ok
  | test bucket_candidates_may_be_conservative_relative_to_overlap ... ok
  | test overlap_and_enclosure_candidate_predicates ... ok
  | test candidate_order_is_independent_of_insertion_and_hash_order ... ok
  | test multi_cell_negative_and_exact_boundary_queries ... ok
  |
  | test result: ok. 8 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.00s
  |
  |     Finished `test` profile [unoptimized + debuginfo] target(s) in 0.14s
  |      Running tests\broadphase_behavior.rs (target\debug\deps\broadphase_behavior-601c0d9aa80d3c70.exe)
- 2026-08-10T05:05:08Z — run: cargo run -p workload-harness --quiet
  started 2026-08-10T05:05:06Z, exit 0 in 2.3s
  output:
  | workload-harness: machine profile
  |   os=windows arch=x86_64 family=windows cpus=24 tick=20Hz/50ms
  | workload-harness: ticks=1200 overruns=0 rate=0.0000 p50_us=35 p95_us=41 p99_us=97
  | workload-harness: viewer cadence samples=599 hist={2: 599}
  | workload-harness: aigent cadence samples=299 hist={4: 299}
  | workload-harness: broadphase rebuild_p50_us=2200 rebuild_p95_us=2292 query_p50_us=59 query_p95_us=64 combined_p95_us=2357 samples=32
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
- 2026-08-10T05:05:08Z — note: Integration decisions: rebuild requires matching ImmutableGeneration and RulesetGeneration provenance; cell edge is live shape.max_extent_mm; active_leases is the documented temporary active/sleeping bridge until task-052; shapeless active entities are omitted while malformed frozen geometry and identity mismatches fail closed; large query spans use a deterministic full-index scan instead of attacker-sized cell enumeration; exact overlap and enclosure results are separated from conservative bucket candidates. Measured local gate profile at 300 shaped aigents: rebuild p95 2229us, query p95 60us, combined p95 2288us against the 50000us budget.
- 2026-08-10T05:06:18Z — run: node scripts/check.mjs
  started 2026-08-10T05:05:38Z, exit 0 in 39.6s
  output tail (truncated to last 30 lines):
  |      Running tests\ruleset_persist_behavior.rs (target\debug\deps\ruleset_persist_behavior-20763967ad007f17.exe)
  |      Running tests\scripted_aigent_behavior.rs (target\debug\deps\scripted_aigent_behavior-868f771fe2f3b29c.exe)
  |      Running tests\session_behavior.rs (target\debug\deps\session_behavior-5b3200c9a1bae821.exe)
  |      Running tests\shape_budget_catalog_contract.rs (target\debug\deps\shape_budget_catalog_contract-a0488f49834a77ed.exe)
  |      Running tests\shape_validation_behavior.rs (target\debug\deps\shape_validation_behavior-887d963556dfabd7.exe)
  |      Running tests\shape_validation_bounded_cost.rs (target\debug\deps\shape_validation_bounded_cost-f5eb5f21bc801b3b.exe)
  |      Running tests\snapshot_behavior.rs (target\debug\deps\snapshot_behavior-38ee57e411957cb0.exe)
  |      Running tests\snapshot_resync_behavior.rs (target\debug\deps\snapshot_resync_behavior-9021b8921bdbaa8b.exe)
  |      Running tests\transport_behavior.rs (target\debug\deps\transport_behavior-514083eccfaa7205.exe)
  |    Doc-tests aigent_protocol
  |    Doc-tests protocol_conformance
  |    Doc-tests workload_harness
  |    Doc-tests world_server
  | npm notice run @aigent-place/protocol@0.1.0 test
  | npm notice run node --test ./test/binary-conformance.test.mjs
  | npm notice run @aigent-place/aigent-sdk@0.1.0 test
  | npm notice run node --test ./test/sdk-exports.test.mjs
  | npm notice run aigent-place@0.1.0 viewer:build
  | npm notice run npm run build -w @aigent-place/viewer
  | npm notice run @aigent-place/viewer@0.1.0 build
  | npm notice run vite build
  |
  | (!) Some chunks are larger than 500 kB after minification. Consider:
  | - Using dynamic import() to code-split the application
  | - Use build.rollupOptions.output.manualChunks to improve chunking: https://rollupjs.org/configuration-options/#output-manualchunks
  | - Adjust chunk size limit for this warning via build.chunkSizeWarningLimit.
  | npm notice run aigent-place@0.1.0 viewer:smoke
  | npm notice run npm run smoke -w @aigent-place/viewer
  | npm notice run @aigent-place/viewer@0.1.0 smoke
  | npm notice run node ./scripts/smoke.mjs
- 2026-08-10T05:06:48Z — moved to review (note: implementation complete; focused broadphase and workload tests, clippy -D warnings, mutation-resistant bucket ordering test, 300-aigent timing, fast product gate, and full unified node scripts/check.mjs all pass; ready for separate cold SPEC and STANDARDS review)
