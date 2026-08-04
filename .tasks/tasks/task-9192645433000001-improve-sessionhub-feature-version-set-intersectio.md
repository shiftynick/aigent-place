---
id: task-9192645433000001
title: Improve SessionHub feature version set intersection
status: done
priority: p3
tags: [area:network, phase:follow-up]
blockedBy: []
createdAt: "2026-08-04T21:19:04Z"
updatedAt: "2026-08-04T23:27:27Z"
---

<!-- task-tracker:description -->
## Description

SessionHub FeatureOffer carries a single version; wire FeatureOffer.supported_versions cannot intersect correctly when the client offers a non-contiguous set. Acceptance: negotiation selects the highest mutually supported version from the full client set without false acceptance of unsupported mid values.

<!-- task-tracker:log -->
## Log

- 2026-08-04T21:19:04Z — created (status: backlog)
- 2026-08-04T23:20:20Z — note: rubric: (1) FeatureOffer carries supported version set (2) negotiation picks highest mutual version from full client set (3) non-contiguous offers cannot false-accept unsupported mid values (4) focused tests cover contiguous and gapped sets (5) docs/contract note if needed (6) gate passes
- 2026-08-04T23:20:21Z — moved to in_progress (claimed by shift@Shiftor)
- 2026-08-04T23:23:00Z — note: chose FeatureOffer.supported_versions full set through SessionHub; server catalog N means 1..=N; wire path no longer collapses to max before intersect
- 2026-08-04T23:23:00Z — moved to review
- 2026-08-04T23:26:27Z — note: cold-review r1 (codex rung 1): added wire_to_semantic_hello unit test so collapse-to-max cannot regress silently
- 2026-08-04T23:26:28Z — run: cargo test -p world-server --test feature_intersection_behavior --lib feature_wire --quiet
  started 2026-08-04T23:26:28Z, exit 0 in 0.2s
  output:
  |
  | running 1 test
  | .
  | test result: ok. 1 passed; 0 failed; 0 ignored; 0 measured; 13 filtered out; finished in 0.00s
  |
  |
  | running 0 tests
  |
  | test result: ok. 0 passed; 0 failed; 0 ignored; 0 measured; 2 filtered out; finished in 0.00s
- 2026-08-04T23:27:16Z — run: node scripts/check.mjs
  started 2026-08-04T23:26:28Z, exit 0 in 48.0s
  output tail (truncated to last 30 lines):
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
  |      Running tests\feature_intersection_behavior.rs (target\debug\deps\feature_intersection_behavior-02eb438a23b9049c.exe)
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
- 2026-08-04T23:27:27Z — note: adjudicated: wire collapse covered by unit test; ARCHITECTURE updated; rung1 codex
- 2026-08-04T23:27:27Z — moved to done
