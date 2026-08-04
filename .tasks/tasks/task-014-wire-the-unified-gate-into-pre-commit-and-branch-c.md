---
id: task-014
title: Wire the unified gate into pre-commit and branch CI
status: done
priority: p0
tags: [area:tooling, milestone:foundations]
blockedBy: [task-003]
createdAt: "2026-07-29T12:55:19Z"
updatedAt: "2026-08-04T17:10:14Z"
---

<!-- task-tracker:description -->
## Description

After the product workspace establishes its pinned build and test commands, extend the existing GitHub process-gate workflow with the product gate and add the documented fast subset to a repository pre-commit hook. Acceptance: the fast subset runs locally before commits, the full unified product plus Foundry gate runs on pull requests and main, clean-checkout evidence passes, and hook or CI failures preserve actionable output without bypass guidance.

<!-- task-tracker:log -->
## Log

- 2026-07-29T12:55:19Z — created (status: backlog)
- 2026-07-29T13:07:05Z — edited (+tag needs:operator; description updated)
- 2026-07-29T13:40:17Z — edited (-tag needs:operator; description updated)
- 2026-08-04T16:53:27Z — note: rubric: (1) check.mjs runs process+full product gate (2) CI installs Node+Rust and runs unified gate (3) pre-commit runs documented fast product subset (4) failures are actionable with no bypass guidance (5) AGENTS/CONTRIBUTING document both paths; clean-checkout evidence recorded
- 2026-08-04T16:53:27Z — moved to in_progress (claimed by shift@Shiftor)
- 2026-08-04T16:56:21Z — moved to review
- 2026-08-04T17:00:08Z — note: cold-review round1: rung1 Codex SPEC + Claude STANDARDS. SPEC findings: (1) missing clean-checkout evidence (2) chmodSync masked hook mode. STANDARDS: Claude answer-only call produced tool-invocation garbage — invalid/incomplete; re-running. Adjudication: fix test to assert git 100755; record validation; re-review both axes.
- 2026-08-04T17:00:09Z — run: node scripts/product-check.mjs --fast
  started 2026-08-04T17:00:08Z, exit 0 in 0.8s
  output:
  | product-check: mode=fast
  | product-check: cargo fmt --check
  | product-check: cargo clippy -D warnings
  | product-check: cargo test
  |
  | running 1 test
  | test tests::smoke_marker_matches_documented_output ... ok
  |
  | test result: ok. 1 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.00s
  |
  | product-check: world-server smoke
  | world-server: smoke ok
  | product-check: PASS (fast subset)
  |     Finished `dev` profile [unoptimized + debuginfo] target(s) in 0.08s
  |     Finished `test` profile [unoptimized + debuginfo] target(s) in 0.10s
  |      Running unittests src\main.rs (target\debug\deps\world_server-cb84350f17519398.exe)
- 2026-08-04T17:06:46Z — note: adjudication r2: fixed Node/nvmrc docs, README space, npm ci wipe note, tmp gitignore; hook behavioral tests (missing node, stub pass/fail) plus AIGENT_PRECOMMIT_PRODUCT_CHECK seam; mode 100755 asserted. Rejected smoke-hang. Rejected missing rust-toolchain as packet gap.
- 2026-08-04T17:06:53Z — note: clean-checkout evidence: detached worktree from write-tree object; node scripts/check.mjs exit 0 (process-docs PASS + product-check PASS)
- 2026-08-04T17:07:31Z — run: node scripts/check.mjs
  started 2026-08-04T17:06:53Z, exit 0 in 37.5s
  output tail (truncated to last 30 lines):
  |
  | > aigent-place@0.1.0 viewer:build
  | > npm run build -w @aigent-place/viewer
  |
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
  | ✓ built in 1.24s
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
  |     Finished `test` profile [unoptimized + debuginfo] target(s) in 0.07s
  |      Running unittests src\main.rs (target\debug\deps\world_server-cb84350f17519398.exe)
- 2026-08-04T17:10:13Z — note: cold-review: rung1 Codex SPEC + Claude STANDARDS. r1: missing evidence + chmod mask. r2 STANDARDS: docs/tests. r3: rejected AIGENT_PRECOMMIT bypass seam — removed; PATH node stub tests instead. Cap after 3 rounds; must-fix from r3 applied; no remaining substantive findings.
- 2026-08-04T17:10:14Z — run: node --test .githooks/pre-commit.test.mjs scripts/product-check.test.mjs
  started 2026-08-04T17:10:13Z, exit 0 in 0.5s
  output tail (truncated to last 30 lines):
  |   duration_ms: 89.5201
  |   type: 'test'
  |   ...
  | # Subtest: parseArgs recognizes --fast and help flags
  | ok 7 - parseArgs recognizes --fast and help flags
  |   ---
  |   duration_ms: 1.0561
  |   type: 'test'
  |   ...
  | # Subtest: assertNodeMatchesNvmrc accepts the current runtime when it matches
  | ok 8 - assertNodeMatchesNvmrc accepts the current runtime when it matches
  |   ---
  |   duration_ms: 0.2708
  |   type: 'test'
  |   ...
  | # Subtest: assertNodeMatchesNvmrc rejects a mismatched version
  | ok 9 - assertNodeMatchesNvmrc rejects a mismatched version
  |   ---
  |   duration_ms: 0.5445
  |   type: 'test'
  |   ...
  | 1..9
  | # tests 9
  | # suites 0
  | # pass 9
  | # fail 0
  | # cancelled 0
  | # skipped 0
  | # todo 0
  | # duration_ms 432.516
- 2026-08-04T17:10:14Z — moved to done
