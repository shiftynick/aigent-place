---
id: task-018
title: Implement connection sessions and authoritative command results
status: done
priority: p0
tags: [area:protocol, milestone:world-core]
blockedBy: [task-004]
createdAt: "2026-07-29T13:03:23Z"
updatedAt: "2026-08-04T18:36:43Z"
---

<!-- task-tracker:description -->
## Description

Implement server-side handshake and feature negotiation, one live session epoch per aigent body, duplicate-session displacement, monotonic command sequencing, idempotency-key replay, and authoritative typed results/rejections. Acceptance: integration tests cover reconnect, stale epochs, duplicate connections, duplicate keys, gaps/reordering, unsupported features, and every mutating command receiving exactly one stable outcome.

<!-- task-tracker:log -->
## Log

- 2026-07-29T13:03:23Z — created (status: backlog)
- 2026-08-04T17:57:52Z — note: operator: Q2=A (Codex+orchestrator) — explicit test-only trusted aigent_id inject; production auth later; do not pretend identity milestone is done
- 2026-08-04T18:24:16Z — note: rubric: (1) handshake/feature negotiation + one live epoch per aigent (2) duplicate-session displacement (3) monotonic sequencing + idempotency replay (4) every mutating command gets exactly one stable outcome (5) test-only trusted aigent_id inject (Q2=A); auth later (6) gates pass
- 2026-08-04T18:24:16Z — moved to in_progress (claimed by shift@Shiftor)
- 2026-08-04T18:29:17Z — note: impl: SessionHub handshake/displace/sequence/idempotency; Q2=A inject; MOVE=UNSUPPORTED_MESSAGE
- 2026-08-04T18:29:17Z — moved to review
- 2026-08-04T18:35:41Z — note: cold-review: Codex SPEC PASS; STANDARDS clock+kind-idempotency fixed; re-adjudicated
- 2026-08-04T18:36:30Z — run: node scripts/check.mjs
  started 2026-08-04T18:35:41Z, exit 0 in 48.5s
  output tail (truncated to last 30 lines):
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
  | ✓ built in 1.35s
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
  |     Finished `dev` profile [unoptimized + debuginfo] target(s) in 0.07s
  |     Finished `test` profile [unoptimized + debuginfo] target(s) in 0.15s
  |      Running unittests src\lib.rs (target\debug\deps\aigent_protocol-86d67fcb42c6c4e6.exe)
  |      Running unittests src\lib.rs (target\debug\deps\world_server-8b2395def4e5f8a5.exe)
  |      Running unittests src\main.rs (target\debug\deps\world_server-20961b293e18112a.exe)
  |      Running tests\core_behavior.rs (target\debug\deps\core_behavior-27e34be77b07f0f2.exe)
  |      Running tests\session_behavior.rs (target\debug\deps\session_behavior-b33dbd4f25948a60.exe)
  |    Doc-tests aigent_protocol
  |    Doc-tests world_server
- 2026-08-04T18:36:43Z — moved to done
