---
id: task-3526582562000001
title: Wire replay semantic oracle onto COMMAND_OUTCOME protobuf decoder
status: done
priority: p1
tags: [area:protocol, milestone:foundations]
blockedBy: [task-004]
createdAt: "2026-08-04T17:34:55Z"
updatedAt: "2026-08-04T18:09:49Z"
---

<!-- task-tracker:description -->
## Description

Replace replay-v1 JSON payload_hex application with the generated CommandOutcome protobuf decoder/encoder from task-004; update fixtures projection_sha256 bindings and CONTRACT.md handoff text.

<!-- task-tracker:log -->
## Log

- 2026-08-04T17:34:55Z — created (status: backlog)
- 2026-08-04T17:57:52Z — note: operator: no fork — proceed with ADR-0008/replay contract defaults (protobuf payload_hex, projection_sha256 binds semantic JSON)
- 2026-08-04T17:58:15Z — note: rubric: (1) replay oracle decodes COMMAND_OUTCOME payload_hex via generated protobuf (2) projection_sha256 still binds semantic JSON projection (3) fixtures/CONTRACT handoff text updated (4) check.mjs passes
- 2026-08-04T17:58:15Z — moved to in_progress (claimed by shift@Shiftor)
- 2026-08-04T18:04:08Z — moved to review
- 2026-08-04T18:04:09Z — run: node --test scripts/replay-contract.test.mjs
  started 2026-08-04T18:04:08Z, exit 0 in 0.4s
  output tail (truncated to last 30 lines):
  |   duration_ms: 0.888
  |   type: 'test'
  |   ...
  | # Subtest: event cursors cover uint64 maxima and allocator exhaustion is deterministic
  | ok 19 - event cursors cover uint64 maxima and allocator exhaustion is deterministic
  |   ---
  |   duration_ms: 1.682
  |   type: 'test'
  |   ...
  | # Subtest: semantic oracle has no wall-clock, network, or ambient-random dependency
  | ok 20 - semantic oracle has no wall-clock, network, or ambient-random dependency
  |   ---
  |   duration_ms: 0.7525
  |   type: 'test'
  |   ...
  | # Subtest: replay contract relative links resolve
  | ok 21 - replay contract relative links resolve
  |   ---
  |   duration_ms: 0.598
  |   type: 'test'
  |   ...
  | 1..21
  | # tests 21
  | # suites 0
  | # pass 21
  | # fail 0
  | # cancelled 0
  | # skipped 0
  | # todo 0
  | # duration_ms 303.9506
- 2026-08-04T18:04:09Z — note: cold-review: rung1 Codex SPEC+STANDARDS (operator: codex for reviews). Packet: replay-command-outcome mapper + validateRecoveryFrames bind.
- 2026-08-04T18:08:38Z — note: cold-review: Codex SPEC+STANDARDS PASS after decode↔wireSemanticProjection bind + negative tests.
- 2026-08-04T18:09:24Z — run: node scripts/check.mjs
  started 2026-08-04T18:08:38Z, exit 0 in 46.1s
  output tail (truncated to last 30 lines):
  |
  | > @aigent-place/viewer@0.1.0 build
  | > vite build
  |
  | vite v7.3.6 building client environment for production...
  | transforming...
  | ✓ 6 modules transformed.
  | rendering chunks...
  | computing gzip size...
  | dist/index.html                   0.54 kB │ gzip:   0.33 kB
  | dist/assets/index-Bz14P-qO.css    0.40 kB │ gzip:   0.29 kB
  | dist/assets/index-C7wmcl1-.js   470.97 kB │ gzip: 118.45 kB │ map: 2,654.73 kB
  | ✓ built in 1.07s
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
  |    Compiling aigent-protocol v0.1.0 (N:\aigent-place\crates\aigent-protocol)
  |     Finished `dev` profile [unoptimized + debuginfo] target(s) in 1.56s
  |    Compiling aigent-protocol v0.1.0 (N:\aigent-place\crates\aigent-protocol)
  |     Finished `test` profile [unoptimized + debuginfo] target(s) in 1.76s
  |      Running unittests src\lib.rs (target\debug\deps\aigent_protocol-7322e4ed8557c9aa.exe)
  |      Running unittests src\main.rs (target\debug\deps\world_server-cb84350f17519398.exe)
  |    Doc-tests aigent_protocol
- 2026-08-04T18:09:49Z — moved to done
