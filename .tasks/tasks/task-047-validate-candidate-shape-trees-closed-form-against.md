---
id: task-047
title: Validate candidate shape trees closed-form against ruleset budgets
status: done
priority: p0
tags: [milestone:shape-collision-slice, area:server]
blockedBy: []
createdAt: "2026-08-06T13:24:48Z"
updatedAt: "2026-08-06T16:13:56Z"
---

<!-- task-tracker:description -->
## Description

The protocol schematizes ShapeTree, ShapeNode, and the six v1 primitives, but the server performs no validation of a candidate shape. Implement closed-form validation of a complete candidate shape tree per ADR-0002: one rooted acyclic tree, unique non-zero node ids, at most one parent per node, normalized unit quaternion rotations, exactly one primitive per node, unique joint names, and strictly positive primitive dimensions except a capsule's cylindrical segment which may be zero and a panel which must have non-zero thickness. Budgets come from the live ruleset generation (shape.body_max_parts, shape.body_max_joints, shape.object_max_parts, shape.object_max_joints, shape.max_extent_mm) and differ for bodies versus placed objects. Validation is all-or-nothing on the complete candidate. Acceptance: shear, non-finite values, non-positive dimensions, duplicate node ids, duplicate joint names, cycles, multiple roots, and budget excess each reject the whole candidate with a typed reason; validation cost is bounded and allocation-free per node beyond the tree itself; a rejected candidate mutates nothing; focused tests cover each reject class; product gate green.

<!-- task-tracker:log -->
## Log

- 2026-08-06T13:24:48Z — created (status: backlog)
- 2026-08-06T14:37:13Z — moved to ready
- 2026-08-06T14:45:24Z — note: rubric: (1) validate_shape_tree(&ShapeTree, ShapeClass, &RulesetParameters) accepts a valid multi-node body and object tree and returns a typed ShapeRejection for every invalid class, borrowing the candidate immutably so a rejected candidate mutates nothing. (2) Each reject class has a focused test asserting the SPECIFIC typed reason: empty tree, zero node id, duplicate node id, unknown parent, no root, multiple roots, cycle, missing primitive, non-positive dimension per primitive, panel zero thickness, negative capsule segment (and segment==0 ACCEPTED), non-finite quaternion, non-unit quaternion, out-of-world translation, invalid/duplicate joint name, invalid/duplicate material tag, out-of-range color, part budget excess, joint budget excess, extent budget excess. (3) Budgets are read from the live RulesetGeneration parameter map, not constants: body and object classes read shape.body_* vs shape.object_* and a test that only changes the live ruleset value flips accept to reject for both classes. (4) Ruleset catalog validation accepts the five shape.* paths with CONTRACT.md ranges/defaults and enforces body_max_joints<=body_max_parts and object_max_joints<=object_max_parts as CrossField. (5) Validation is single-pass bounded: O(n log n) with a fixed small number of allocations and no per-node heap allocation; asserted by a large-tree test that stays within budget. (6) cargo fmt/clippy/test and node scripts/check.mjs green; task-relevant docs updated or a no-doc-change check recorded.
- 2026-08-06T14:45:30Z — moved to in_progress (claimed by shift@Shiftor)
- 2026-08-06T14:56:41Z — note: decision (max_extent_mm scope): ADR-0002 and world/v1 4.2 require a candidate to 'fit the active ruleset's primitive and aggregate bounds', and ARCHITECTURE 6 names the budget 'bounding box', but shape.max_extent_mm is the only extent parameter in the catalog and neither document splits it. The aggregate bound needs composed parent-before-child transforms and the per-node AABB, which is task-048's objective ('provide the aggregate AABB that grounding, placement, and enclosure checks consume'). Computing it here would duplicate that task and would be the wrong place to own it. So task-047 applies shape.max_extent_mm as the PRIMITIVE bound: each primitive's own full local extent on each of its own axes, derived from the world/v1 4.2 half-extent table and doubled, using checked integer arithmetic (overflow reports ExtentBudgetExceeded rather than wrapping). This is deliberately conservative in the safe direction - it never accepts an oversized primitive - and it never rejects a shape the aggregate rule would accept, because a single primitive can never be smaller than the aggregate that contains it. Reversible inside the code this task owns per docs/SDLC.md; no ADR written and no normative contract edited. Follow-up filed for the aggregate half.
- 2026-08-06T14:56:52Z — note: decision (live budgets): the Rust ruleset catalog in crates/world-server/src/ruleset.rs held only 5 of the 29 contract paths and rejects unknown paths, so no live generation carried shape.*. Added the five shape.* entries with their ruleset/v1/CONTRACT.md ranges and defaults plus the two documented cross-field constraints (body_max_joints<=body_max_parts, object_max_joints<=object_max_parts). Deliberately did NOT touch the Rust composite cost model, which is still the skeleton's candidate_cost/cost_ceiling stand-in rather than the contract section 4 formula - that belongs to the ruleset runtime, not to shape validation. ShapeBudgets::from_ruleset returns a typed MissingBudgetParameter/InvalidBudgetParameter rejection instead of falling back to a constant, so budgets can never silently stop tracking the live generation.
- 2026-08-06T14:57:02Z — note: decision (shear and absent fields): LocalTransform has no scale or shear field, so shear is unrepresentable in this schema; the unit-quaternion magnitude check (|mag^2 - 1| <= 1e-6, world/v1 4.1) is what enforces ADR-0002's 'shear rejects the complete candidate', since a non-unit quaternion is the only way to smuggle scale through a rotation. Absent transform and absent rotation both reject: the protobuf default quaternion is (0,0,0,0), not identity, so absence cannot be read as 'unrotated'. Absent translation IS accepted as the zero vector, because there the protobuf default is genuinely the meaningful value. Canonicalization (normalize + q/-q sign fix) is accepted-state storage, not validation, so it is left to the task that installs an accepted shape.
- 2026-08-06T14:57:14Z — note: decision (bounded-cost evidence): first attempt measured the 'allocation-free per node' criterion directly with a counting #[global_allocator] in a dedicated test binary. The workspace sets unsafe_code = 'forbid', which cannot be locally overridden, so GlobalAlloc cannot be implemented anywhere in this workspace. Respected the invariant rather than weakening it, and replaced the measurement with the observable property that actually matters for the malicious-asset surface: crates/world-server/tests/shape_validation_bounded_cost.rs builds a 256-node candidate in which EVERY node is independently invalid, proves under a permissive budget that the per-node defect is what rejects, then shows that under a tighter budget the reported reason is PartBudgetExceeded - which is only possible if the budget short-circuits before any node is inspected. Allocation is constrained by construction instead: every buffer is allocated in one block sized from the already-budget-checked node count, before the per-node pass, and the material-tag scratch buffer is reused across nodes.
- 2026-08-06T15:01:05Z — note: mutation check of the derived-oracle lens (docs/REVIEW-STANDARDS.md): deliberately broke the implementation three times and confirmed the suite goes red each time, so the oracles assert real behavior rather than echoing the fixture. (1) ShapeBudgets::from_ruleset hardcoding max_parts=256 instead of reading the live value -> part_budget_is_read_from_the_live_generation and body_and_object_budgets_differ_on_one_tree FAILED. (2) capsule negative-segment guard replaced with 'if false' -> capsule_segment_of_zero_is_legal_but_negative_is_not FAILED. (3) part-budget check moved from before the per-node pass to after it -> part_budget_short_circuits_before_any_per_node_work FAILED. All three reverted; fmt/clippy/tests re-run clean afterwards.
- 2026-08-06T15:01:22Z — note: doc check: README.md updated with the shape-validation paragraph (what is enforced, live-ruleset budgets, body vs object separation, all-or-nothing, budget short-circuit, aggregate bound deferred). Deliberately did NOT edit world/v1/CONTRACT.md, ADR-0002, or ADR-0003: this task implements accepted decisions and does not change them, and the one underspecified point (which granularity shape.max_extent_mm binds at) is recorded as a provisional in-code interpretation with follow-up task-2929451841000001 rather than being written into a normative contract unilaterally. AGENTS.md and docs/SDLC.md are governance surfaces requiring operator approval and were not touched.
- 2026-08-06T15:01:31Z — run: cargo test -p world-server --test shape_validation_behavior --test shape_validation_bounded_cost
  started 2026-08-06T15:01:30Z, exit 0 in 0.2s
  output tail (truncated to last 30 lines):
  | test missing_primitive_rejects ... ok
  | test node_array_order_does_not_change_the_outcome ... ok
  | test empty_tree_rejects ... ok
  | test missing_root_rejects ... ok
  | test missing_transform_or_rotation_rejects ... ok
  | test extent_budget_is_read_from_the_live_generation ... ok
  | test invalid_and_duplicate_joint_names_reject ... ok
  | test invalid_and_duplicate_material_tags_reject ... ok
  | test non_finite_rotation_rejects ... ok
  | test zero_node_id_rejects ... ok
  | test non_unit_rotation_rejects_but_tolerance_accepts ... ok
  | test part_budget_is_read_from_the_live_generation ... ok
  | test translation_outside_the_world_bound_rejects ... ok
  | test unknown_parent_rejects ... ok
  | test non_positive_dimensions_reject_per_primitive_and_field ... ok
  | test self_parent_rejects_as_a_cycle ... ok
  |
  | test result: ok. 27 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.00s
  |
  |
  | running 3 tests
  | test part_budget_short_circuits_before_any_per_node_work ... ok
  | test the_deepest_catalog_legal_chain_validates ... ok
  | test a_maximal_chain_closed_into_a_cycle_terminates ... ok
  |
  | test result: ok. 3 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.00s
  |
  |     Finished `test` profile [unoptimized + debuginfo] target(s) in 0.12s
  |      Running tests\shape_validation_behavior.rs (target\debug\deps\shape_validation_behavior-887d963556dfabd7.exe)
  |      Running tests\shape_validation_bounded_cost.rs (target\debug\deps\shape_validation_bounded_cost-f5eb5f21bc801b3b.exe)
- 2026-08-06T15:01:39Z — run: cargo test -p world-server --test ruleset_persist_behavior
  started 2026-08-06T15:01:38Z, exit 0 in 0.4s
  output:
  |
  | running 7 tests
  | test live_generation_carries_every_shape_budget ... ok
  | test invalid_ruleset_rejected_live_unchanged ... ok
  | test shape_budget_candidates_are_range_and_cross_field_checked ... ok
  | test activation_only_at_tick_boundary_after_soak ... ok
  | test persist_order_matches_canonical_sim ... ok
  | test restart_reconstructs_last_committed_generation ... ok
  | test pending_survives_in_committed_journal_until_activation ... ok
  |
  | test result: ok. 7 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.00s
  |
  |     Finished `test` profile [unoptimized + debuginfo] target(s) in 0.13s
  |      Running tests\ruleset_persist_behavior.rs (target\debug\deps\ruleset_persist_behavior-20763967ad007f17.exe)
- 2026-08-06T15:01:51Z — moved to review
- 2026-08-06T15:16:00Z — run: cargo clippy --workspace --all-targets -- -D warnings
  started 2026-08-06T15:15:59Z, exit 0 in 1.4s
  output:
  |     Checking world-server v0.1.0 (N:\aigent-place\.claude\worktrees\wf_478f7fc6-df9-2\crates\world-server)
  |     Checking workload-harness v0.1.0 (N:\aigent-place\.claude\worktrees\wf_478f7fc6-df9-2\crates\workload-harness)
  |     Checking protocol-conformance v0.1.0 (N:\aigent-place\.claude\worktrees\wf_478f7fc6-df9-2\crates\protocol-conformance)
  |     Finished `dev` profile [unoptimized + debuginfo] target(s) in 1.18s
- 2026-08-06T15:16:25Z — run: cargo test --workspace
  started 2026-08-06T15:16:07Z, exit 0 in 19.0s
  output tail (truncated to last 30 lines):
  |    Compiling protocol-conformance v0.1.0 (N:\aigent-place\.claude\worktrees\wf_478f7fc6-df9-2\crates\protocol-conformance)
  |     Finished `test` profile [unoptimized + debuginfo] target(s) in 5.72s
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
- 2026-08-06T15:17:54Z — run: node scripts/check.mjs
  started 2026-08-06T15:16:34Z, exit 0 in 80.8s
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
- 2026-08-06T15:18:08Z — note: cold review round 1 — LADDER RUNG 1 (separate CLI, different model family). Transport: .agent-foundry/agent-headless/cli.js run --provider codex --access inspect --effort high. Model family: OpenAI GPT-5.x via codex-cli 0.145.0. Two axes dispatched CONCURRENTLY as separate read-only calls with the complete packet (new-file contents + git diff HEAD); no conversation history. Both returned valid terminal results with substantial CHECKED lists. SPEC: 6 findings. STANDARDS: 6 findings.
- 2026-08-06T15:18:20Z — note: adjudication round 1 — REJECTED (1 of 12). SPEC#1 (high, 'E0382 moved value: the non-Copy primitive is moved by the first reject_reason closure then reused by negate'): FALSE, not reproduced. Counter-evidence: prost generates 'shape_node::Primitive' with #[derive(Clone, Copy, PartialEq, ::prost::Oneof)] (verified in target/debug/build/aigent-protocol-*/out/aigent.protocol.v1.rs line 226), so the value is Copy and reuse is legal; the test binary compiles and all 27 tests were executed green before and after the review. The reviewer inferred the type was non-Copy from the packet without the generated source. Recorded per docs/SDLC.md: review output is evidence, not authority.
- 2026-08-06T15:18:41Z — note: adjudication round 1 — ACCEPTED AND FIXED. (a) STANDARDS#1 (high, envelope bypass) CONFIRMED and it is a hole this task introduced: adding shape.body_max_parts / shape.object_max_parts to the Rust catalog made two ruleset/v1 section 4 COST-DRIVING terms votable, while this server still runs the skeleton candidate_cost/cost_ceiling stand-in and does not even hold the other terms of that formula (budget.objects_per_aigent, speech.*, channel.post_rate_per_minute). Because the section 4 ceiling EQUALS the formula on the default catalog, any increase without a compensating decrease must reject - so admitting an unscored increase would let governance raise a server-enforced budget past the constitution. Fix: ENVELOPE_COST_DRIVING_PATHS in ruleset.rs refuses any value above the catalog default for those two paths with CostExceeded. Deliberately stricter than the contract (it also refuses compensating trades) because that is the safe direction; downward migration and grandfathered generations are unaffected. Regression test: raising_an_envelope_cost_driving_shape_budget_is_refused. (b) SPEC#2 = STANDARDS#2 (tag_scratch reallocating inside the node loop) CONFIRMED: the module claimed every allocation was made up front, which was false for the lazily grown tag scratch. Fix: the widest material-tag list is measured before the per-node pass and tag_scratch is sized once from it, so allocation count is now genuinely fixed. (c) SPEC#3 (InvalidIdentifier conflated joint names and material tags) CONFIRMED against rubric line 2, which lists them as separate classes. Fix: split into InvalidJointName and InvalidMaterialTag, with a test asserting the two are distinguishable. (d) SPEC#4 = STANDARDS#4 (live-value flip tests only covered body budgets) CONFIRMED against rubric line 3. Fix: part, joint and extent flip tests are now parameterized over both ShapeClass::Body and ShapeClass::Object. (e) STANDARDS#3 (public ShapeBudgets fields let a caller construct max_parts: u32::MAX and defeat boundedness) CONFIRMED against 'make invalid states unrepresentable'. Fix: fields are private with accessors; from_ruleset is the only constructor and range-checks against the catalog.
- 2026-08-06T15:18:56Z — note: adjudication round 1 — remaining. (f) SPEC#5 + STANDARDS#5 (the five ranges/defaults are hand-transcribed from ruleset/v1/CONTRACT.md with no synchronization gate; the filed follow-up documents the risk but does not protect this implementation) CONFIRMED. Fix: new crates/world-server/tests/shape_budget_catalog_contract.rs include_str!s the normative contract, PARSES its section 3 table rows, and derives every expected default and range boundary from the document itself - so editing the contract without editing the Rust catalog now fails a test instead of drifting silently. This closes the gap for the five shape.* rows; task-2929451841000002 remains open for the rest of the catalog and for the composite cost model. (g) SPEC#6 + STANDARDS#6 (no recorded clippy / full test / unified gate evidence; the reviewer could not run Cargo because its sandbox denied the target lockfile write) CONFIRMED as a packet gap. Fix: cargo clippy --workspace --all-targets -D warnings, cargo test --workspace, and node scripts/check.mjs are now all recorded through task.mjs run, exit 0. (h) SELF-IDENTIFIED, not raised by either reviewer: reason reporting depended on input array order, while world/v1 section 4.1 states array order is not semantic and canonical order is ascending node_id. With two independent defects present, a reversed array named a different node. Fix: validation now runs in two passes - identity first, then all per-node and connectivity work in canonical ascending node_id order - so neither the outcome nor which defect is named can depend on array order. Test node_array_order_does_not_change_the_outcome extended with two-defect cases.
- 2026-08-06T15:34:44Z — note: cold review round 2 — LADDER RUNG 1 again (agent-headless provider codex, codex-cli 0.145.0, --access inspect --effort high), two axes dispatched concurrently on the fixed diff. SPEC: PASS with a full CHECKED list (verified every rejection class, both-class budget flips, canonical ordering, fixed allocation count, out-of-scope boundaries intact, and re-ran the compiled tests itself). STANDARDS: 3 medium findings, all CONFIRMED and all fixed. (1) The round 1 envelope fix was CRUDER THAN NECESSARY: refusing each part path above its own default also refused compensating trades that section 4 explicitly keeps legal, e.g. body 33 with object 63 leaves the sum at 96 so the cost term is unchanged. The reviewer correctly noted the other formula terms cannot vary here because this catalog rejects them as unknown paths, so the trade IS scoreable. Fix: the check now bounds the SUM of shape.body_max_parts + shape.object_max_parts against the default sum, which is exactly the envelope for this catalog and admits compensating trades; new test a_compensating_trade_between_part_budgets_is_admitted covers both the admitted trade and the refused increase. Writing that test immediately caught a second real interaction: lowering object parts to 63 while leaving object joints at 64 violates the documented joints<=parts cross-field rule, so the test now moves both. (2) material_tags is unbounded by any shape budget. Confirmed as a genuine gap, but adding a tag-count parameter is a ruleset-CONTRACT change, not a shape-validation change, so it is documented in the module header and filed as task-2929451841000003 rather than invented here; added a_wide_material_tag_list_is_still_validated_correctly proving correctness and distinct typed reasons at 5000 tags with the duplicate placed last. (3) The contract-sync test asserted a high boundary it never constructed. Fix: it now constructs BOTH documented boundaries and asserts the absence of OutOfRange specifically (a high boundary may still be refused by the envelope, which is a different correct outcome), plus a new shape_budgets_accept_the_contract_boundaries covering the independently duplicated limits inside ShapeBudgets::from_ruleset. Verified red-capable by lowering the Rust shape.max_extent_mm maximum to 99999: catalog_range_boundaries_match_the_contract FAILED with 'shape.max_extent_mm=100000 is a contract boundary and must be in range' while the read-side test correctly stayed green, then reverted.
- 2026-08-06T15:35:04Z — run: cargo test --workspace
  started 2026-08-06T15:34:52Z, exit 0 in 12.4s
  output tail (truncated to last 30 lines):
  |    Compiling workload-harness v0.1.0 (N:\aigent-place\.claude\worktrees\wf_478f7fc6-df9-2\crates\workload-harness)
  |     Finished `test` profile [unoptimized + debuginfo] target(s) in 3.53s
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
- 2026-08-06T15:35:57Z — run: node scripts/check.mjs
  started 2026-08-06T15:35:10Z, exit 0 in 46.9s
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
- 2026-08-06T15:41:29Z — note: cold review round 3 (final round of the three-round cap) — LADDER RUNG 1 (agent-headless provider codex, codex-cli 0.145.0, --access inspect --effort high), two axes dispatched concurrently. BOTH AXES PASS with substantive CHECKED lists. Both independently re-derived the envelope algebra and confirmed the reduction is sound: with every non-shape term of the section 4 formula absent and therefore fixed at its contract default, cost minus ceiling reduces exactly to (body_max_parts + object_max_parts - 96) * objects_per_aigent, so bounding the sum at 96 is exactly the envelope and compensating trades remain legal. Both traced the two-pass canonical-order restructure across every rejection path and confirmed reporting is input-order independent. Both re-executed the compiled suites themselves (43 tests) and confirmed the recorded exit-0 gate evidence. No findings remain open; nothing was deferred at the round cap.
- 2026-08-06T15:42:54Z — run: node scripts/check.mjs
  started 2026-08-06T15:41:37Z, exit 0 in 77.5s
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
- 2026-08-06T15:43:36Z — moved to done
- 2026-08-06T15:44:44Z — note: DEFECT IN THE COMMIT MESSAGE, needs an operator decision. I passed the commit message using PowerShell here-string syntax (-m @'...'@) through the Bash tool, which does not understand it, so a literal '@' line was prepended. The commit subject is therefore '@' and the intended subject 'task-047: reject malformed candidate shapes before they reach the world' became the first body line; the rest of the message is intact. This is cosmetic and the branch is local and unpushed, and AGENTS.md mandates squash-only merges where the pull request title supplies the final subject, so it does not reach main on its own. I did NOT correct it because this task was given an explicit 'no --amend' constraint and git reset would be the same rewrite by another name; quietly deviating from a stated constraint is worse than surfacing it. Recommended fix, one command, at the operator's discretion: git commit --amend to drop the leading '@' line. Root cause for the retrospective: the Bash tool documents that PowerShell here-strings are not supported and that heredocs must be used instead; I used the wrong one on a Windows host where both shells are available.
- 2026-08-06T15:47:57Z — run: node scripts/check.mjs
  started 2026-08-06T15:47:05Z, exit 0 in 51.1s
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
- 2026-08-06T15:48:05Z — note: post-review cleanup: removed the unused DimensionField::SegmentLength variant. It was dead because a capsule's cylindrical segment is the one dimension allowed to be zero, so its failure is NegativeSegmentLength rather than NonPositiveDimension; the doc comment now states that instead of leaving an unused variant to imply otherwise. Neither reviewer flagged it across three rounds. docs/ENGINEERING-STANDARDS.md: build extension points only when a current requirement justifies them. Full gate re-run after the change, exit 0.
- 2026-08-06T16:11:37Z — note: cold-review adjudication round 4 (finishing pass over the two returned RUNG 1 packets; no new review dispatched). SPEC axis: 1 finding, CONFIRMED and FIXED. STANDARDS axis: 5 findings, 4 CONFIRMED and FIXED, 1 REJECTED with counter-evidence. Both CHECKED sections were substantial rather than thin (independent gate re-runs, hand-audited allocation sites, independently re-derived envelope algebra, ten and six reverted mutations against a detached worktree), so both axes are treated as complete terminal results. Per-finding adjudication follows in the next notes.
- 2026-08-06T16:11:49Z — note: cold-review SPEC-1 / STANDARDS-1 (README.md:65-76 states unwired behavior in the present indicative) — CONFIRMED against live evidence, FIXED. Verified both halves myself: grep for validate_shape_tree outside src/shape.rs and the tests returns only the pub use re-export at lib.rs:57, so no command, session, or tick path calls the validator and nothing is rejected on any live request; and no AABB derivation exists outside aoi.rs, so no aggregate bound is applied anywhere. The repository front door therefore claimed world/v1 section 4.2 was fully enforced today while src/shape.rs:40-44 was honest about exactly the same deferral. Rewrote the paragraph: enforces becomes implements ... in world_server::validate_shape_tree; extent budgets becomes per-primitive extent budgets; and the false aggregate sentence is replaced by an explicit outstanding-work sentence naming both gaps (no command path calls the validator until set_shape and place_object land, and the aggregate bound waits on the canonical AABB collider). AGENTS.md never report a planned or unavailable command as passing now holds for behavior prose, not just commands.
- 2026-08-06T16:12:00Z — note: cold-review STANDARDS-2 (ShapeRejection::InvalidBudgetParameter is a public reject class with no oracle) — CONFIRMED by reproducing the reported mutation, FIXED, and the fix mutation-verified. On the pre-fix tree, replacing the out-of-range branch body with MissingBudgetParameter (collapsing two distinct typed reasons into one and discarding the offending value) left the ENTIRE cargo test -p world-server suite green, because the only test reaching that branch asserted is_err() and nothing more. That defeats rubric line 1 (a typed reason for every invalid class) and rubric line 2 (a focused test asserting the SPECIFIC reason) for this one class, and a grandfathered generation carrying an out-of-catalog budget would have been reported to the caller as a MISSING parameter. Fix in tests/shape_budget_catalog_contract.rs: replaced the is_err assertion with an exact assert_eq on InvalidBudgetParameter { path, value }, and added a second case driving shape.max_extent_mm below its contract low so the reported path is proven to track the parameter that actually failed rather than being pinned to whichever path from_ruleset happens to read first. Re-ran the identical mutation after the fix: shape_budgets_accept_the_contract_boundaries FAILS. The oracle is red-capable, not a restatement of the fixture.
- 2026-08-06T16:12:13Z — note: cold-review STANDARDS-3 (three places claim every heap allocation happens in one block up front) — CONFIRMED, FIXED as a documentation defect. The inline comment Nothing below this block allocates was plainly false: validate_shape_tree_with_budgets calls check_connected_acyclic, which allocates two further Vecs sized from nodes.len(). The module header and the bounded-cost test header repeated the same wrong claim. The substantive property survives — five allocation sites, each sized once from the already-budget-checked node count, none per node — so this is not a behavior defect; but the bounded-cost suite explicitly declines to measure allocation and defers to that comment as its evidence, so rubric line 5 rested on a statement that did not describe the code. Corrected all three sites to state five buffers, three taken before the per-node pass and two by the reachability walk after it, and added the capacity argument to the check_connected_acyclic doc (a node is marked ON_PATH before it is pushed, so no walk pushes it twice and path cannot outgrow its capacity) so the count is checkable at the site rather than asserted from a distance. Also corrected the same sentence to three linear passes plus two tree-wide sorts and one per-node tag sort, which the old two passes plus two sorts undercounted. Deliberately did NOT hoist the two walk buffers into the up-front block to make the original sentence true: that would make the common early-reject path allocate buffers it never uses, and the property that actually matters (fixed count, none per node) already holds. Docs were changed to match the code, not the reverse.
- 2026-08-06T16:12:22Z — note: cold-review STANDARDS-4 (CATALOG_MAX_PARTS = 256 hand-restated in the bounded-cost suite) — CONFIRMED, FIXED, mutation-verified. Treated as a must-fix rather than a nit: the four tests claim in their doc comments to exercise the deepest catalog legal chain and the largest tree the catalog permits, but the size that makes those claims true was an unanchored literal, while the sibling suite already demonstrated the correct pattern of include_str-ing ruleset/v1/CONTRACT.md and parsing the row. Replaced the constant with catalog_max_parts(), which parses the shape.body_max_parts range out of the contract table. Mutation-verified in both directions: raising the contract row to 1..300 now fails ALL FOUR bounded-cost tests (from_ruleset refuses the out-of-catalog budget), whereas with the literal every one of them would have stayed green while silently no longer testing the maximum and their doc comments would have quietly become false. This is the derived-oracle lens in docs/REVIEW-STANDARDS.md applied to input SIZING rather than to expectations; same defect class, and the lens already covers it.
- 2026-08-06T16:12:37Z — note: cold-review STANDARDS-5 (the shape.max_extent_mm granularity choice should have carried a proposed ADR) — REJECTED, no ADR written, counter-evidence recorded as required for substantive disagreement. The reviewer read the per-primitive binding as a novel architecture decision tripping the SDLC ADR gate. Read against the accepted contract it is not one. world/v1/CONTRACT.md section 4.2 already requires a candidate to fit the active ruleset PRIMITIVE AND AGGREGATE bounds — the accepted contract itself names two distinct applications of the one ruleset parameter — and section 5 then assigns the aggregate AABB to world-bound, broadphase, budget, and enclosure checks, which locates the aggregate budget check at the canonical collider that task-048 owns. Applying shape.max_extent_mm per primitive now is therefore implementing the primitive half of an already-accepted clause and deferring the half that structurally requires a collider this task does not own. That is scope sequencing, which docs/SDLC.md assigns to the task log, not a choice that shapes system structure or is expensive to reverse. On ARCHITECTURE.md:255 naming the budget bounding box: that line is a one-line parenthetical in a budget list, and AGENTS.md classifies these as orientation summaries whose precise definitions are controlled elsewhere, so it does not outrank section 4.2. The genuinely open question underneath the finding — whether shape.max_extent_mm was meant as a half-extent, in which case this implementation is 2x stricter than intended — is real, is documented in-code at src/shape.rs:40-44 and on ShapeBudgets::max_extent_mm, and is already filed as task-2929451841000001, whose description explicitly routes it to an ADR at the point where the answer would CHANGE the semantics rather than clarify them. That is the correct place for the gate; an ADR written now would be recording a deferral, not a decision. Accepted residual risk, surfaced rather than hidden.
- 2026-08-06T16:12:47Z — note: cold-review, deliberately NOT fixed: the literal @ line on commit b1b4790. Confirmed still present in git log. It falls outside both review axes (repository hygiene, not spec or standards), correcting it requires precisely the --amend or git reset this task was explicitly instructed not to perform, and AGENTS.md mandates squash-only merges where the pull request title supplies the final subject, so it cannot reach main on its own. Left surfaced in the earlier task note for the operator, with the one-command fix recorded there. Also note for whoever integrates this branch: it was finished in a fresh worktree whose starting branch did not carry the implementation. The task-047-shape-validation branch was checked out with --ignore-other-worktrees from the finishing worktree after confirming the implementing worktree was clean at the same tip (87cbdb5) and idle; no other branch was touched.
- 2026-08-06T16:13:56Z — run: node scripts/check.mjs
  started 2026-08-06T16:12:54Z, exit 0 in 62.3s
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
