---
id: task-015
title: Build a protocol conformance client
status: done
priority: p1
tags: [area:protocol, milestone:world-core]
blockedBy: [task-004, task-018]
createdAt: "2026-07-29T12:55:19Z"
updatedAt: "2026-08-04T19:49:12Z"
---

<!-- task-tracker:description -->
## Description

Build a standalone owner-side client that exercises handshake, feature negotiation, valid message round-trips, malformed envelopes, compatibility failures, baseline loss, and resync against the server contract. Acceptance: it runs non-interactively in the unified gate and reports protocol-version and behavior mismatches deterministically.

<!-- task-tracker:log -->
## Log

- 2026-07-29T12:55:19Z — created (status: backlog)
- 2026-07-29T13:03:23Z — edited (+blockedBy task-018)
- 2026-08-04T19:35:36Z — note: rubric: (1) standalone owner-side client exercises handshake + feature negotiation (2) valid round-trips + malformed envelopes + compatibility failures report deterministic mismatches (3) baseline loss and resync paths covered (4) runs non-interactively in unified gate (5) gates pass
- 2026-08-04T19:35:36Z — moved to in_progress (claimed by shift@Shiftor)
- 2026-08-04T19:39:54Z — note: chose in-process SessionHub+SnapshotFanout client (no WS listen yet); scenarios cover handshake/features/round-trip/malformed/compat/baseline/resync + wire fixture; wired into product-check fast+full
- 2026-08-04T19:39:54Z — note: docs: product-check help updated; no ARCHITECTURE change — Step 1 already names conformance client
- 2026-08-04T19:39:54Z — moved to review
- 2026-08-04T19:40:30Z — run: cargo test -p protocol-conformance
  started 2026-08-04T19:40:29Z, exit 0 in 1.2s
  output:
  |
  | running 2 tests
  | test tests::smoke_marker_stable ... ok
  | test tests::all_scenarios_pass ... ok
  |
  | test result: ok. 2 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.00s
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
  |    Compiling protocol-conformance v0.1.0 (N:\aigent-place\crates\protocol-conformance)
  |     Finished `test` profile [unoptimized + debuginfo] target(s) in 0.80s
  |      Running unittests src\lib.rs (target\debug\deps\protocol_conformance-4de84872cf483720.exe)
  |      Running unittests src\main.rs (target\debug\deps\protocol_conformance-6496179a32a996ea.exe)
  |    Doc-tests protocol_conformance
- 2026-08-04T19:40:31Z — run: cargo run -q -p protocol-conformance
  started 2026-08-04T19:40:30Z, exit 0 in 0.2s
  output:
  | protocol-conformance: ok
- 2026-08-04T19:41:22Z — run: node scripts/check.mjs
  started 2026-08-04T19:40:31Z, exit 0 in 51.3s
  output tail (truncated to last 30 lines):
  | dist/assets/index-Bz14P-qO.css    0.40 kB │ gzip:   0.29 kB
  | dist/assets/index-C7wmcl1-.js   470.97 kB │ gzip: 118.45 kB │ map: 2,654.73 kB
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
  |     Checking world-server v0.1.0 (N:\aigent-place\crates\world-server)
  |     Finished `dev` profile [unoptimized + debuginfo] target(s) in 0.42s
  |    Compiling world-server v0.1.0 (N:\aigent-place\crates\world-server)
  |     Finished `test` profile [unoptimized + debuginfo] target(s) in 1.56s
  |      Running unittests src\lib.rs (target\debug\deps\aigent_protocol-86d67fcb42c6c4e6.exe)
  |      Running unittests src\lib.rs (target\debug\deps\protocol_conformance-4de84872cf483720.exe)
  |      Running unittests src\main.rs (target\debug\deps\protocol_conformance-6496179a32a996ea.exe)
  |      Running unittests src\lib.rs (target\debug\deps\world_server-8b2395def4e5f8a5.exe)
  |      Running unittests src\main.rs (target\debug\deps\world_server-20961b293e18112a.exe)
  |      Running tests\core_behavior.rs (target\debug\deps\core_behavior-27e34be77b07f0f2.exe)
  |      Running tests\reliability_behavior.rs (target\debug\deps\reliability_behavior-ec5ac31ad01948c6.exe)
  |      Running tests\ruleset_persist_behavior.rs (target\debug\deps\ruleset_persist_behavior-8c2280d1b0b92702.exe)
  |      Running tests\session_behavior.rs (target\debug\deps\session_behavior-b33dbd4f25948a60.exe)
  |      Running tests\snapshot_behavior.rs (target\debug\deps\snapshot_behavior-0187fbac67f66f88.exe)
  |    Doc-tests aigent_protocol
  |    Doc-tests protocol_conformance
  |    Doc-tests world_server
- 2026-08-04T19:45:40Z — note: cold-review rung1 codex: SPEC PASS. STANDARDS: (1) rejected hub-via-protobuf-only — SessionHub is semantic by task-018; wire covered by fixture round-trips; proto FeatureOffer shape differs until WS mapping task (2) fixed mismatch diagnostic tests (3) fixed seeded non-default event cursor (4) reverted AGENTS.md ask-first; README documents gate
- 2026-08-04T19:45:42Z — run: node scripts/product-check.mjs --fast
  started 2026-08-04T19:45:40Z, exit 0 in 2.6s
  output tail (truncated to last 30 lines):
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
  | product-check: world-server smoke
  | world-server: smoke ok
  | product-check: protocol-conformance
  | protocol-conformance: ok
  | product-check: PASS (fast subset)
  |     Finished `dev` profile [unoptimized + debuginfo] target(s) in 0.07s
  |     Finished `test` profile [unoptimized + debuginfo] target(s) in 0.16s
  |      Running unittests src\lib.rs (target\debug\deps\aigent_protocol-86d67fcb42c6c4e6.exe)
  |      Running unittests src\lib.rs (target\debug\deps\protocol_conformance-4de84872cf483720.exe)
  |      Running unittests src\main.rs (target\debug\deps\protocol_conformance-6496179a32a996ea.exe)
  |      Running unittests src\lib.rs (target\debug\deps\world_server-8b2395def4e5f8a5.exe)
  |      Running unittests src\main.rs (target\debug\deps\world_server-20961b293e18112a.exe)
  |      Running tests\core_behavior.rs (target\debug\deps\core_behavior-27e34be77b07f0f2.exe)
  |      Running tests\reliability_behavior.rs (target\debug\deps\reliability_behavior-ec5ac31ad01948c6.exe)
  |      Running tests\ruleset_persist_behavior.rs (target\debug\deps\ruleset_persist_behavior-8c2280d1b0b92702.exe)
  |      Running tests\session_behavior.rs (target\debug\deps\session_behavior-b33dbd4f25948a60.exe)
  |      Running tests\snapshot_behavior.rs (target\debug\deps\snapshot_behavior-0187fbac67f66f88.exe)
  |    Doc-tests aigent_protocol
  |    Doc-tests protocol_conformance
  |    Doc-tests world_server
- 2026-08-04T19:49:12Z — note: cold-review: rung1 codex. SPEC PASS. STANDARDS r1 findings fixed (cursor seed, mismatch path); r2 residual fixed via run_scenarios/exit_code_for; r3 STANDARDS PASS. AGENTS.md left unchanged (ask-first); README+product-check document gate.
- 2026-08-04T19:49:12Z — note: validation: cargo test -p protocol-conformance; cargo run -p protocol-conformance; node scripts/check.mjs; product-check --fast (includes protocol-conformance smoke)
- 2026-08-04T19:49:12Z — moved to done
