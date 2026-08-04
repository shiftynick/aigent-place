---
id: task-003
title: Scaffold pinned product workspace and quality gate
status: done
priority: p0
tags: [area:tooling, milestone:foundations]
blockedBy: [task-002, task-010, task-011, task-012, task-013]
createdAt: "2026-07-29T12:45:23Z"
updatedAt: "2026-08-04T16:47:44Z"
---

<!-- task-tracker:description -->
## Description

Create the minimal Rust world-server and Three.js browser workspace with pinned toolchains, committed lockfiles, formatting/lint/test commands, and one documented local gate suitable for CI. Acceptance: a clean checkout can run the gate, both empty applications build and execute a smoke path, and AGENTS.md plus CONTRIBUTING.md name only commands that were verified.

<!-- task-tracker:log -->
## Log

- 2026-07-29T12:45:23Z — created (status: backlog)
- 2026-07-29T12:55:20Z — edited (+blockedBy task-002; +blockedBy task-010; +blockedBy task-011; +blockedBy task-012; +blockedBy task-013)
- 2026-08-04T16:39:55Z — note: rubric: (1) pinned Rust workspace with world-server crate that builds and runs a smoke path (2) pinned Three.js/Vite viewer app that builds and runs a smoke path (3) committed lockfiles + rust-toolchain + Node via .nvmrc (4) one documented gate command builds/tests both and is wired for local+CI use (5) AGENTS.md and CONTRIBUTING.md name only verified commands
- 2026-08-04T16:39:55Z — moved to in_progress (claimed by shift@Shiftor)
- 2026-08-04T16:44:00Z — moved to review
- 2026-08-04T16:44:04Z — run: node scripts/product-check.mjs
  started 2026-08-04T16:44:01Z, exit 0 in 3.2s
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
  | ✓ built in 1.21s
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
  |     Finished `dev` profile [unoptimized + debuginfo] target(s) in 0.08s
  |     Finished `test` profile [unoptimized + debuginfo] target(s) in 0.08s
  |      Running unittests src\main.rs (target\debug\deps\world_server-cb84350f17519398.exe)
- 2026-08-04T16:44:37Z — run: node scripts/check.mjs
  started 2026-08-04T16:44:04Z, exit 0 in 33.3s
  output tail (truncated to last 30 lines):
  |     # Subtest: soft-deletes by setting status=done and adding deleted:true tag
  |     ok 1 - soft-deletes by setting status=done and adding deleted:true tag
  |       ---
  |       duration_ms: 210.7349
  |       type: 'test'
  |       ...
  |     # Subtest: keeps dependents blocked when their blocker is soft-deleted
  |     ok 2 - keeps dependents blocked when their blocker is soft-deleted
  |       ---
  |       duration_ms: 599.3658
  |       type: 'test'
  |       ...
  |     1..2
  | ok 159 - task rm
  |   ---
  |   duration_ms: 810.2234
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
  | # duration_ms 32432.6093
  |
  | run-checks: PASS (skill-sync + 18 suites)
  | process-docs: PASS (no unresolved markers in scoped non-binary files)
- 2026-08-04T16:45:55Z — run: npm ci
  started 2026-08-04T16:45:53Z, exit 0 in 2.0s
  output:
  |
  | added 16 packages, and audited 18 packages in 2s
  |
  | 5 packages are looking for funding
  |   run `npm fund` for details
  |
  | found 0 vulnerabilities
- 2026-08-04T16:46:23Z — note: cold-review: rung 1 SPEC=codex STANDARDS=claude; SPEC finding fixed (CONTRIBUTING npm ci claim qualified; npm ci recorded). CI workflow left for task-014.
- 2026-08-04T16:46:23Z — moved to done
- 2026-08-04T16:46:33Z — moved to review (forced)
- 2026-08-04T16:46:33Z — note: re-opened review to fix STANDARDS M1/M2 before commit
- 2026-08-04T16:47:09Z — run: node scripts/product-check.mjs
  started 2026-08-04T16:47:04Z, exit 0 in 4.6s
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
  | ✓ built in 1.03s
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
  |     Finished `test` profile [unoptimized + debuginfo] target(s) in 0.07s
  |      Running unittests src\main.rs (target\debug\deps\world_server-cb84350f17519398.exe)
- 2026-08-04T16:47:44Z — run: node scripts/check.mjs
  started 2026-08-04T16:47:09Z, exit 0 in 34.5s
  output tail (truncated to last 30 lines):
  |     # Subtest: soft-deletes by setting status=done and adding deleted:true tag
  |     ok 1 - soft-deletes by setting status=done and adding deleted:true tag
  |       ---
  |       duration_ms: 288.4762
  |       type: 'test'
  |       ...
  |     # Subtest: keeps dependents blocked when their blocker is soft-deleted
  |     ok 2 - keeps dependents blocked when their blocker is soft-deleted
  |       ---
  |       duration_ms: 603.5691
  |       type: 'test'
  |       ...
  |     1..2
  | ok 159 - task rm
  |   ---
  |   duration_ms: 892.4062
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
  | # duration_ms 33685.9637
  |
  | run-checks: PASS (skill-sync + 18 suites)
  | process-docs: PASS (no unresolved markers in scoped non-binary files)
- 2026-08-04T16:47:44Z — note: cold-review: rung 1 SPEC=codex STANDARDS=claude; fixed tautological test, unconditional npm ci, Node .nvmrc assert, vite as devDependency. CI wiring deferred to task-014.
- 2026-08-04T16:47:44Z — moved to done
