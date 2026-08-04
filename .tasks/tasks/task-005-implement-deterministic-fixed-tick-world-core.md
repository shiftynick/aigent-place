---
id: task-005
title: Implement deterministic fixed-tick world core
status: done
priority: p0
tags: [area:core, milestone:world-core]
blockedBy: [task-004, task-014]
createdAt: "2026-07-29T12:45:23Z"
updatedAt: "2026-08-04T18:22:19Z"
---

<!-- task-tracker:description -->
## Description

Implement the authoritative 20 Hz simulation skeleton with canonical command ordering, seeded randomness, bounded movement leases, and immutable generations handed to downstream snapshot work. Acceptance: behavioral tests prove tick progression, order independence from arrival/scheduler order, lease expiry, and same-build replay equivalence.

<!-- task-tracker:log -->
## Log

- 2026-07-29T12:45:23Z — created (status: backlog)
- 2026-07-29T12:55:20Z — edited (+blockedBy task-014)
- 2026-08-04T17:57:52Z — note: operator: Q1=B (Codex+orchestrator) — internal lease harness for TTL/expiry; MOVE wire schema deferred; unschematized MOVE stays UNSUPPORTED_MESSAGE
- 2026-08-04T18:12:17Z — note: rubric: (1) 20 Hz tick advances deterministically with immutable generation handoff (2) same inputs same-build replay-equivalent regardless of arrival/scheduler order (3) movement lease TTL/expiry via internal harness; wire MOVE stays UNSUPPORTED_MESSAGE (4) seeded RNG draws are deterministic under world seed (5) focused + full gate pass
- 2026-08-04T18:12:17Z — moved to in_progress (claimed by shift@Shiftor)
- 2026-08-04T18:17:43Z — note: impl: world-server lib — tick/order/rng/lease/generation; internal lease harness; MOVE wire unchanged; ARCHITECTURE §2 pointer
- 2026-08-04T18:17:43Z — moved to review
- 2026-08-04T18:21:30Z — note: cold-review: Codex SPEC PASS (re-review); STANDARDS mojibake in §/→ comments fixed to ASCII; stale arrival + u128 RNG bound fixed
- 2026-08-04T18:22:12Z — run: node scripts/check.mjs
  started 2026-08-04T18:21:30Z, exit 0 in 42.6s
  output tail (truncated to last 30 lines):
  | rendering chunks...
  | computing gzip size...
  | dist/index.html                   0.54 kB │ gzip:   0.33 kB
  | dist/assets/index-Bz14P-qO.css    0.40 kB │ gzip:   0.29 kB
  | dist/assets/index-C7wmcl1-.js   470.97 kB │ gzip: 118.45 kB │ map: 2,654.73 kB
  | ✓ built in 1.02s
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
  |     Finished `dev` profile [unoptimized + debuginfo] target(s) in 0.28s
  |    Compiling getrandom v0.4.3
  |    Compiling world-server v0.1.0 (N:\aigent-place\crates\world-server)
  |    Compiling tempfile v3.27.0
  |    Compiling prost-build v0.13.5
  |    Compiling aigent-protocol v0.1.0 (N:\aigent-place\crates\aigent-protocol)
  |     Finished `test` profile [unoptimized + debuginfo] target(s) in 3.35s
  |      Running unittests src\lib.rs (target\debug\deps\aigent_protocol-86d67fcb42c6c4e6.exe)
  |      Running unittests src\lib.rs (target\debug\deps\world_server-ce5eeebd36fb54a4.exe)
  |      Running unittests src\main.rs (target\debug\deps\world_server-fbf8d4d0021f87ea.exe)
  |      Running tests\core_behavior.rs (target\debug\deps\core_behavior-bea2110228f3f1e9.exe)
  |    Doc-tests aigent_protocol
  |    Doc-tests world_server
- 2026-08-04T18:22:19Z — moved to done
