---
id: task-017
title: Resolve deferred product questions before dependent milestones
status: done
priority: p2
tags: [area:product, milestone:foundations]
blockedBy: []
createdAt: "2026-07-29T12:55:20Z"
updatedAt: "2026-08-04T18:41:10Z"
---

<!-- task-tracker:description -->
## Description

Use the operator decision workflow to resolve the open questions in ARCHITECTURE.md: spawn placement, viewer accounts, physical interaction verbs, text moderation, and Track B expiry/weight. Acceptance: each outcome is recorded in an accepted ADR or remains explicitly deferred with a revisit trigger, and downstream tasks gain any resulting dependency edges.

<!-- task-tracker:log -->
## Log

- 2026-07-29T12:55:20Z — created (status: backlog)
- 2026-08-04T17:57:52Z — note: operator: judgement — (1) spawn plaza at origin ring for v1 (2) viewers anonymous (3) no physical verbs in v1; Track B candidates only (4) moderation MVP = owner accountability + report flow (5) Track B order-only, no expiry/weight in v1
- 2026-08-04T17:57:52Z — note: removed needs:operator after delegated judgement; execute records ADRs/deferrals
- 2026-08-04T17:58:15Z — edited (-tag needs:operator)
- 2026-08-04T18:38:44Z — note: rubric: (1) each ARCHITECTURE open question recorded as accepted ADR decision or explicit deferral with revisit trigger (2) ARCHITECTURE open-questions section updated (3) ADR index updated (4) gates pass
- 2026-08-04T18:38:44Z — moved to in_progress (claimed by shift@Shiftor)
- 2026-08-04T18:39:16Z — note: chose single ADR-0009 for the five related v1 dispositions; no new board edges yet — no spawn/moderation tasks filed
- 2026-08-04T18:39:16Z — moved to review
- 2026-08-04T18:40:24Z — note: cold-review: Codex SPEC+STANDARDS PASS (rung 1)
- 2026-08-04T18:41:10Z — run: node scripts/check.mjs
  started 2026-08-04T18:40:24Z, exit 0 in 45.5s
  output tail (truncated to last 30 lines):
  | vite v7.3.6 building client environment for production...
  | transforming...
  | ✓ 6 modules transformed.
  | rendering chunks...
  | computing gzip size...
  | dist/index.html                   0.54 kB │ gzip:   0.33 kB
  | dist/assets/index-Bz14P-qO.css    0.40 kB │ gzip:   0.29 kB
  | dist/assets/index-C7wmcl1-.js   470.97 kB │ gzip: 118.45 kB │ map: 2,654.73 kB
  | ✓ built in 1.20s
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
  |     Finished `dev` profile [unoptimized + debuginfo] target(s) in 0.34s
  |    Compiling world-server v0.1.0 (N:\aigent-place\crates\world-server)
  |     Finished `test` profile [unoptimized + debuginfo] target(s) in 1.01s
  |      Running unittests src\lib.rs (target\debug\deps\aigent_protocol-86d67fcb42c6c4e6.exe)
  |      Running unittests src\lib.rs (target\debug\deps\world_server-8b2395def4e5f8a5.exe)
  |      Running unittests src\main.rs (target\debug\deps\world_server-20961b293e18112a.exe)
  |      Running tests\core_behavior.rs (target\debug\deps\core_behavior-27e34be77b07f0f2.exe)
  |      Running tests\session_behavior.rs (target\debug\deps\session_behavior-b33dbd4f25948a60.exe)
  |    Doc-tests aigent_protocol
  |    Doc-tests world_server
- 2026-08-04T18:41:10Z — moved to done
