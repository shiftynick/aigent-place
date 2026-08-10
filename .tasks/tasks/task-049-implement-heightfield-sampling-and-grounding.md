---
id: task-049
title: Implement heightfield sampling and grounding
status: review
priority: p1
tags: [milestone:shape-collision-slice, area:server]
blockedBy: [task-048]
createdAt: "2026-08-06T13:25:08Z"
updatedAt: "2026-08-10T03:28:42Z"
---

<!-- task-tracker:description -->
## Description

Bodies have no terrain to rest on, so no position is grounded. Implement the heightfield and grounding per ADR-0003: each 64 metre chunk owns a regular lattice of signed integer millimetre height samples with a constitutional heightfield_cell_size_mm that exactly divides 64000. Generation from (world_seed, global_sample_x, global_sample_z) must produce identical heights on both sides of a chunk seam. The canonical terrain collider for a cell is a world-axis-aligned column whose horizontal bounds are the cell bounds, whose lower bound is the negative world y limit, and whose top is the maximum of its four corner samples. Cells are half-open on positive x and z edges except cells touching the positive world boundary. A footprint selects every cell with positive horizontal intersection. Grounding computes the entity's aggregate horizontal footprint, selects intersected columns, and translates the entity so its aggregate lower face equals the greatest selected column top, leaving horizontal position unchanged. Terrain generation only; chunk persistence and edits are out of scope. Acceptance: seam samples are identical from both adjacent chunks; grounding on non-flat terrain rests on the maximum column top, not an average or a corner; boundary cells follow the half-open rule so seam order cannot change the candidate set; product gate green.

<!-- task-tracker:log -->
## Log

- 2026-08-06T13:25:08Z — created (status: backlog)
- 2026-08-10T01:01:07Z — note: operator: included in approved collision-core attack after collider and aggregate-bound work
- 2026-08-10T02:34:20Z — note: rubric: (1) Implement deterministic procedural heightfield chunks with 64 m extent, ruleset-selected cell size that exactly divides 64000, and seam-identical samples derived only from world_seed and global sample coordinates. (2) Expose canonical terrain columns with cell horizontal bounds, negative world-y lower bound, maximum-of-four-samples top, and the contract half-open positive-edge rule including the positive world boundary exception. (3) Select exactly the cells having positive horizontal intersection with an aggregate footprint, with deterministic seam/boundary behavior independent of enumeration order. (4) Ground an aggregate collider by changing only Y so its lower face equals the greatest selected terrain-column top; cover non-flat maximum behavior, negative coordinates, seams, and world boundaries. (5) Keep generation/pure geometry task-scoped, defer persistence/edits, document public boundaries, and pass focused plus unified gates.
- 2026-08-10T02:34:20Z — moved to in_progress (claimed by shift@Shiftor; note: claimed by codex collision-core attack; coding Cursor cursor-grok-4.5-high high effort; cold reviews Claude Fable 5 low effort)
- 2026-08-10T02:53:24Z — run: node .agent-foundry/agent-headless/cli.js run --provider cursor --cwd N:\aigent-place --model cursor-grok-4.5-high --effort high --access edit-isolated --prompt-file C:\Users\shift\AppData\Local\Temp\task-049-cursor-impl.md --timeout-ms 1200000 --trust-workspace --output text --json
  started 2026-08-10T02:38:24Z, timed out after 900.0s
  output:
  | (node:55980) [MODULE_TYPELESS_PACKAGE_JSON] Warning: Module type of file:///N:/aigent-place/.agent-foundry/agent-headless/cli.js is not specified and it doesn't parse as CommonJS.
  | Reparsing as ES module because module syntax was detected. This incurs a performance overhead.
  | To eliminate this warning, add "type": "module" to N:\aigent-place\package.json.
  | (Use `node --trace-warnings ...` to show where the warning was created)
- 2026-08-10T02:53:52Z — note: friction: Cursor cursor-grok-4.5-high implementation was requested with a 1200000 ms provider timeout, but task-tracker run enforced its 900 s ceiling and terminated the wrapper first, so no normalized result/worktree path was returned; do not repeat the same full request automatically
- 2026-08-10T03:25:55Z — run: node scripts/check.mjs
  started 2026-08-10T03:25:01Z, exit 0 in 54.0s
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
- 2026-08-10T03:28:34Z — note: mutation evidence: changing grounding support comparator from greatest to least made mutation_guard_max_support_and_half_open_are_observable fail (exit 101, expected 7905 vs i64::MIN); changing exact-min-edge ownership to include prev_right == lo made the same guard fail (exit 101, leaked cell x=0); both mutations restored; full heightfield suite then passed 12/12
- 2026-08-10T03:28:42Z — moved to review (note: implementation complete; focused checks, full unified gate, and mutation-sensitive acceptance evidence green; entering cold review)
