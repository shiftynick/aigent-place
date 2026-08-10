---
id: task-049
title: Implement heightfield sampling and grounding
status: done
priority: p1
tags: [milestone:shape-collision-slice, area:server]
blockedBy: [task-048]
createdAt: "2026-08-06T13:25:08Z"
updatedAt: "2026-08-10T04:45:20Z"
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
- 2026-08-10T03:31:49Z — run: node .agent-foundry/agent-headless/cli.js run --provider claude --prompt-file C:\Users\shift\AppData\Local\Temp\task-049-spec-review-r1.md --cwd N:\aigent-place --model claude-fable-5 --effort low --access inspect --session ephemeral --timeout-ms 600000 --output text --json
  started 2026-08-10T03:30:17Z, exit 0 in 92.0s
  output tail (truncated to last 30 lines):
  | n recomputes `min.y` through the non-linear rounding chain in `derive_collider`, so bit-exact equality of the re-derived lower face with `support_top` is not guaranteed for arbitrary translations (the passing test covers one value, `12_345.5`, whose offsets happen to be exactly representable). No analysis or test establishes exactness for translations with non-representable fractional parts. | low | medium\n\n3. Repository / commit scope | rubric 5 | This review environment has no shell tool, so `git diff HEAD^..HEAD`, `git status --short`, and `git ls-files --others --exclude-standard` could not be executed; complete parent-diff scope (no out-of-scope files touched) and the claimed green `node scripts/check.mjs` unified gate could not be independently re-verified and rest solely on the task log entries. | low | high\n\nCHECKED\n1. Verified by reading `HeightfieldConfig::new` (positive, exact divisor of `CHUNK_SIZE_MM = 64_000`), `sample_height_mm` (pure HMAC-SHA256 of seed + domain + version + big-endian global i64 coords, exact uniform reduction into a span dividing 2^64), `chunk_view` sharing border global coordinates, and seam tests for positive and negative chunk pairs plus frozen sample vectors — no findings.\n2. Verified `terrain_column`: cell horizontal bounds (world-clipped), `lower_y_mm = -WORLD_BOUND_MM`, top = max of four corner samples; half-open positive edges enforced by strict inequalities in `cell_index_range`, closed `+WORLD_BOUND_MM` face on the last cell confirmed in unit and behavior tests including the non-divisor-of-W clipping case — no findings.\n3. Verified `select_cells` uses closed-form inclusive index ranges with strict inequalities (positive intersection only), canonical ascending `(x,z)` enumeration, exact `f64` integer-edge products, fail-closed cap, and the shuffled-order/seam behavior tests — no findings.\n4. Verified `ground()` changes only Y (bit-preserved X/Z), uses greatest column top with deterministic tie-break, and the max-not-average/corner behavior; findings 1 and 2 record the coverage and exact-equality gaps.\n5. Verified module scope (generation/pure geometry only, persistence/edits/sweep/broadphase/mutation explicitly out of scope in module docs), public API documented and re-exported in `lib.rs`, contract §3.3/3.4/5 consistency; finding 3 records the unverifiable gate/scope claims.\n"
  |     }
  |   ],
  |   "exitCode": 0,
  |   "modelRequested": "claude-fable-5",
  |   "warnings": [],
  |   "workspace": {
  |     "cwd": "N:\\aigent-place",
  |     "access": "inspect"
  |   },
  |   "stderr": "",
  |   "durationMs": 91947
  | }
  | (node:16252) [MODULE_TYPELESS_PACKAGE_JSON] Warning: Module type of file:///N:/aigent-place/.agent-foundry/agent-headless/cli.js is not specified and it doesn't parse as CommonJS.
  | Reparsing as ES module because module syntax was detected. This incurs a performance overhead.
  | To eliminate this warning, add "type": "module" to N:\aigent-place\package.json.
  | (Use `node --trace-warnings ...` to show where the warning was created)
- 2026-08-10T03:34:40Z — run: node .agent-foundry/agent-headless/cli.js run --provider claude --prompt-file C:\Users\shift\AppData\Local\Temp\task-049-standards-review-r1.md --cwd N:\aigent-place --model claude-fable-5 --effort low --access inspect --session ephemeral --timeout-ms 600000 --output text --json
  started 2026-08-10T03:32:13Z, exit 0 in 146.7s
  output tail (truncated to last 30 lines):
  | oes not divide `WORLD_BOUND_MM` (`cell_size_chunk_divisor_not_world_bound_clips_boundary_columns`, cells 1562/−1563 with clipped closed faces at ±W). Confirmed `i64_to_exact_f64` guards the 2^53 exactness assumption and that all edge products within ±10^8 mm are exact.\n- Checked arithmetic and fail-closed costs: every multiply/add on indices and edges is `checked_*` with typed errors; `HEIGHTFIELD_MAX_SELECTED_CELLS` rejects rather than truncates (`candidate_limit_fails_closed_without_silent_truncation`); non-finite, out-of-world, and empty footprints reject before enumeration; the world-edge nudge loops are bounded (at most one step is ever needed, since `i_min·s ≤ i_max·s < W` and right edges exceed `lo ≥ −W`) and terminate in error, not truncation.\n- Deterministic ordering/tie behavior: support comparator takes the greatest top with lowest-`(x,z)` tie retention over canonical ascending enumeration; no hash iteration, wall clock, or platform-dependent input anywhere in the module (ENGINEERING-STANDARDS State and data).\n- Oracle independence (REVIEW-STANDARDS derived-oracle lens): the behavior suite freezes ten literal sample heights independent of the implementation (`known_sample_vector_is_deterministic_and_repeated`), and the max-corner tests derive expected tops from corner samples and assert inequality against average and a fixed corner; the in-module encoding-oracle unit test restates the message layout rather than calling the function under test. Mutation evidence in the task log shows both guards go red under comparator and edge-ownership mutations.\n- X/Z bit preservation and API misuse: `ground` rebuilds the point from `to_bits`, asserts bit equality in debug and in the behavior test including signed-zero canonicalization in `WorldPointMm`; `TerrainColumn`/`GroundingResult` fields are private with documented accessors; `Heightfield` construction is fallible so an invalid cell size cannot exist.\n- Scope: module doc and code contain no persistence, edit, sweep, broadphase, or entity-mutation surface; `lib.rs` re-exports the heightfield API alongside existing collider/shape exports.\n- Untrusted content: no agent-addressed text found in the reviewed files.\n- Not verifiable here: parent-diff completeness, untracked files, and gate execution (finding 2); general bit-exactness of the grounded lower face (finding 1).\n"
  |     }
  |   ],
  |   "exitCode": 0,
  |   "modelRequested": "claude-fable-5",
  |   "warnings": [],
  |   "workspace": {
  |     "cwd": "N:\\aigent-place",
  |     "access": "inspect"
  |   },
  |   "stderr": "",
  |   "durationMs": 146604
  | }
  | (node:55644) [MODULE_TYPELESS_PACKAGE_JSON] Warning: Module type of file:///N:/aigent-place/.agent-foundry/agent-headless/cli.js is not specified and it doesn't parse as CommonJS.
  | Reparsing as ES module because module syntax was detected. This incurs a performance overhead.
  | To eliminate this warning, add "type": "module" to N:\aigent-place\package.json.
  | (Use `node --trace-warnings ...` to show where the warning was created)
- 2026-08-10T03:36:04Z — note: round-1 adjudication: confirmed SPEC finding 1 (missing direct ground() coverage at negative coordinates, chunk seam, and world bounds) and shared SPEC/STANDARDS exact-equality finding. Reproduction: seed 0x31, cell 1000, identity 333 mm box, translation (100.1,-12345.1,100.1) grounded to support 6540 but re-derived aggregate min was 6539.999999999998 (bit mismatch). Reviewer shell-unavailable scope/gate findings are transport limitations; main verified git scope and recorded full gate directly. Medium fixes require both cold axes round 2.
- 2026-08-10T04:39:50Z — note: round-1 fixes integrated: grounding now accepts ShapeTree, re-derives candidate colliders, returns only on bit-exact support equality, uses 16 bounded residual corrections then a complete 64-step ordered-f64 binary search across in-world Y, and returns typed exact_grounding_unreachable when representation skips support; direct negative/chunk/world-edge tests and identity/rotated regressions added; canonical collider semantics unchanged
- 2026-08-10T04:40:48Z — run: node scripts/check.mjs
  started 2026-08-10T04:39:50Z, exit 0 in 58.1s
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
- 2026-08-10T04:42:46Z — run: node .agent-foundry/agent-headless/cli.js run --provider claude --prompt-file C:\Users\shift\AppData\Local\Temp\task-049-spec-review-r2.md --cwd N:\aigent-place --model claude-fable-5 --effort low --access inspect --session ephemeral --timeout-ms 600000 --output text --json
  started 2026-08-10T04:41:23Z, exit 0 in 83.0s
  output tail (truncated to last 30 lines):
  | tprint`; `shuffled_source_order_cannot_change_candidate_set_or_support` and the half-open mutation guard cover behavior, with the task-log mutation evidence showing both guards go red under comparator and edge-ownership mutations. No findings.\n4. Grounding — round-1 findings are resolved at HEAD. `ground` now takes `&ShapeTree`, re-derives colliders, preserves X/Z bit-identically (including signed zero, with debug asserts and behavior assertions), selects the greatest column top with deterministic lowest-`(x,z)` tie retention, and returns only when the re-derived aggregate min Y is bit-identical to the integer support. The solver is sound: `derive_collider` computes `(translation.y + center) − world_half` per node and aggregates by min, which is weakly monotone non-decreasing in Y under round-to-nearest, so the 16 residual corrections plus the 64-step ordered-`f64`-key binary search (key range < 2^64, so 64 steps are complete over every representable in-world Y) either find an exact pose or correctly conclude the value is skipped and fail closed with typed `ExactGroundingUnreachable`, which `world/v1/CONTRACT.md` §5 now records as `exact_grounding_unreachable` with the explicit no-epsilon rule. Direct-`ground` coverage now includes negative cells, the x = 0 and x = 64 000 chunk seams, ±world-edge footprints, the fractional-identity and rotated-arithmetic round-1 counterexamples (with the naive formula pinned as still inexact), the unrepresentable fail-closed case at a normal budget-scale rotated shape, and a 288-case deterministic rotated/fractional corpus, all asserting bit-exact re-derived lower faces via `assert_exact_direct_ground`. No findings.\n5. Scope, boundaries, gates — module doc confines the surface to generation/pure geometry with persistence, edits, sweep, broadphase, and entity mutation explicitly out of scope, matching the task's deferral; the public API is documented and re-exported from `lib.rs`; contract §3.4/§5 and ADR-0003 remain consistent with the code, including the documented safety-cap disclosure. The unified gate (`node scripts/check.mjs` exit 0, 58.1 s post-fix) and full parent-diff scope rest on the task-log record because this review environment has no shell; per the review brief that is a transport limitation already independently checked by the primary agent, not a product finding. No findings.\n"
  |     }
  |   ],
  |   "exitCode": 0,
  |   "modelRequested": "claude-fable-5",
  |   "warnings": [],
  |   "workspace": {
  |     "cwd": "N:\\aigent-place",
  |     "access": "inspect"
  |   },
  |   "stderr": "",
  |   "durationMs": 82936
  | }
  | (node:62028) [MODULE_TYPELESS_PACKAGE_JSON] Warning: Module type of file:///N:/aigent-place/.agent-foundry/agent-headless/cli.js is not specified and it doesn't parse as CommonJS.
  | Reparsing as ES module because module syntax was detected. This incurs a performance overhead.
  | To eliminate this warning, add "type": "module" to N:\aigent-place\package.json.
  | (Use `node --trace-warnings ...` to show where the warning was created)
- 2026-08-10T04:45:07Z — run: node .agent-foundry/agent-headless/cli.js run --provider claude --prompt-file C:\Users\shift\AppData\Local\Temp\task-049-standards-review-r2.md --cwd N:\aigent-place --model claude-fable-5 --effort low --access inspect --session ephemeral --timeout-ms 600000 --output text --json
  started 2026-08-10T04:42:50Z, exit 0 in 136.5s
  output tail (truncated to last 30 lines):
  | ub` on keys prevent wrap; residual loop is capped at 16 with a fixed-point break; both exits are typed, never epsilon-accepting. `i64_to_exact_f64` canonicalizes zero so support 0 compares against IEEE `+0.0` (exact-difference subtraction cannot yield −0.0).\n- **Residual/world-bounds handling** — residual candidates outside the closed world interval break to the complete binary phase instead of probing out-of-world; `translation_with_y` re-validates through `WorldPointMm`.\n- **ENGINEERING-STANDARDS errors/typed boundaries** — closed `HeightfieldError` enum with `Display`/`Error`, all index/edge arithmetic `checked_*`, derivation failures mapped (`map_derive_error`) without swallowing; cap fails closed rather than truncating.\n- **ENGINEERING-STANDARDS testing / REVIEW-STANDARDS derived-oracle lens** — frozen ten-literal sample vector independent of the implementation; max-vs-average/corner tests derive expectations from corner samples; `assert_exact_direct_ground` re-derives support and the lower face independently of `ground`'s internals; direct boundary coverage exists for negative cells, x=0 and x=64000 seams, ±world edges, the fractional and rotated round-1 counterexamples (naive formula pinned inexact), the fail-closed unreachable case, and a bounded 288-case corpus; task-log mutation evidence shows comparator and edge-ownership mutations go red.\n- **REVIEW-STANDARDS order-independence rule** — support selection iterates the canonical ascending enumeration with a lowest-`(x,z)` tie rule, and `shuffled_source_order_cannot_change_candidate_set_or_support` proves order invariance; no hash iteration, wall clock, or platform-dependent input in the module.\n- **Documentation standard / public API** — module docs state scope (generation/pure geometry; persistence, edits, sweep, broadphase, mutation out of scope), all public items documented with `# Errors`, and `lib.rs` re-exports the full surface including the search-bound constants the tests import.\n- **Task-049 scope** — no persistence, edit, or entity-mutation surface added; canonical collider derivation unchanged.\n- **Untrusted content** — no agent-addressed text in any reviewed file.\n- **Gate/diff scope** — unified gate exit 0 (58.1 s) and parent-diff scope rest on the primary agent's direct verification per the brief; not re-runnable here and not a product finding.\n"
  |     }
  |   ],
  |   "exitCode": 0,
  |   "modelRequested": "claude-fable-5",
  |   "warnings": [],
  |   "workspace": {
  |     "cwd": "N:\\aigent-place",
  |     "access": "inspect"
  |   },
  |   "stderr": "",
  |   "durationMs": 136443
  | }
  | (node:57188) [MODULE_TYPELESS_PACKAGE_JSON] Warning: Module type of file:///N:/aigent-place/.agent-foundry/agent-headless/cli.js is not specified and it doesn't parse as CommonJS.
  | Reparsing as ES module because module syntax was detected. This incurs a performance overhead.
  | To eliminate this warning, add "type": "module" to N:\aigent-place\package.json.
  | (Use `node --trace-warnings ...` to show where the warning was created)
- 2026-08-10T04:45:20Z — note: cold review complete: ladder rung 1, separate agent-headless CLI, provider claude, exact model claude-fable-5 (Anthropic family), effort low, separate cold SPEC and STANDARDS calls. Round 1 confirmed direct grounding boundary coverage and exact re-derived lower-face defects; fixes adjudicated and integrated. Round 2 SPEC PASS and STANDARDS PASS with complete CHECKED coverage.
- 2026-08-10T04:45:20Z — moved to done (note: rubric satisfied; post-fix unified gate exit 0; mutation evidence recorded; rung-1 round-2 SPEC/STANDARDS PASS; task-scoped commits ready for PR)
