---
id: task-048
title: Derive the canonical AABB collider from a validated shape tree
status: in_progress
priority: p0
tags: [milestone:shape-collision-slice, area:server]
blockedBy: [task-047]
createdAt: "2026-08-06T13:25:08Z"
updatedAt: "2026-08-10T01:31:18Z"
claimedBy: codex-attack-collision-core
claimedAt: "2026-08-10T01:01:07Z"
---

<!-- task-tracker:description -->
## Description

Nothing derives collision geometry from a shape. Implement the canonical collider per ADR-0002: the ordered union of one conservative world-axis-aligned bounding box per transformed primitive, sorted by node id. Each AABB is derived analytically from the primitive's local extents and its absolute rotation matrix after parent transforms compose before child transforms. Rendering detail, color, material tags, and joint names must not affect the collider. Provide the aggregate AABB and aggregate horizontal footprint that grounding, placement, and enclosure checks consume. Two AABBs overlap only when their intersection has positive extent on all three axes; face, edge, and point contact are legal. Acceptance: derivation is deterministic and order-stable for a given tree; rotated primitives produce conservative boxes that contain the primitive; the positive-extent overlap rule is exercised at exact face, edge, and point contact and reports no overlap; cosmetic-only tree changes produce a byte-identical collider; product gate green.

<!-- task-tracker:log -->
## Log

- 2026-08-06T13:25:08Z — created (status: backlog)
- 2026-08-10T01:01:06Z — note: operator: approved collision-core attack path task-048 -> task-2929451841000001 -> task-049 -> task-050 -> task-051; coding model cursor-grok-4.5-high at high effort; Fable cold reviews at low effort
- 2026-08-10T01:01:07Z — note: rubric: (1) Derive one conservative world-axis-aligned AABB per transformed primitive using composed parent-before-child transforms and stable node-id order. (2) Expose deterministic aggregate AABB and horizontal footprint values for downstream grounding, placement, and enclosure checks. (3) Treat only positive three-axis intersection as overlap, with exact face, edge, and point contact legal. (4) Prove rotated primitives are contained and cosmetic-only changes leave collider bytes unchanged using behavior tests that fail when derivation or ordering is broken. (5) Keep the change task-scoped, document the collider boundary, and pass focused tests plus the full product gate.
- 2026-08-10T01:01:07Z — moved to in_progress (claimed by codex-attack-collision-core)
- 2026-08-10T01:03:41Z — run: node .agent-foundry/agent-headless/cli.js run --provider cursor --cwd N:\aigent-place --model cursor-grok-4.5-high --effort high --access inspect --prompt-file .tasks/review-packets/task-048-cursor-design.md --timeout-ms 1200000 --trust-workspace --output text --json
  started 2026-08-10T01:01:49Z, exit 0 in 112.5s
  output:
  | {
  |   "provider": "cursor",
  |   "status": "succeeded",
  |   "finalText": "",
  |   "events": [
  |     {
  |       "provider": "cursor",
  |       "type": "result",
  |       "kind": "result",
  |       "raw": "\n"
  |     }
  |   ],
  |   "exitCode": 0,
  |   "modelRequested": "cursor-grok-4.5-high",
  |   "warnings": [],
  |   "workspace": {
  |     "cwd": "N:\\aigent-place",
  |     "access": "inspect"
  |   },
  |   "stderr": "",
  |   "durationMs": 111534
  | }
  | (node:55884) [MODULE_TYPELESS_PACKAGE_JSON] Warning: Module type of file:///N:/aigent-place/.agent-foundry/agent-headless/cli.js is not specified and it doesn't parse as CommonJS.
  | Reparsing as ES module because module syntax was detected. This incurs a performance overhead.
  | To eliminate this warning, add "type": "module" to N:\aigent-place\package.json.
  | (Use `node --trace-warnings ...` to show where the warning was created)
- 2026-08-10T01:03:55Z — note: friction: Cursor cursor-grok-4.5-high inspect call completed successfully but returned an empty result, so it supplied no API proposal; do not repeat the same call without changing the packet or access mode
- 2026-08-10T01:04:52Z — note: outline: add collider.rs with WorldPointMm::new/accessors, Aabb::min/max/overlaps_positive_volume/horizontal_footprint, HorizontalFootprint accessors, NodeAabb::node_id/bounds, Collider::parts/aggregate/canonical_bits, and derive_collider(&ShapeTree, WorldPointMm) -> Result<Collider, ColliderDerivationError>. Use f64 millimetres because rotated integer dimensions and odd half-extents are fractional; canonical bits preserve same-build byte comparison. Derivation errors fail closed on non-finite world translation or arithmetic and on any supposedly validated-tree invariant missing at this boundary. Export through lib.rs. No aggregate ruleset-budget enforcement in this task.
- 2026-08-10T01:20:39Z — run: node .agent-foundry/agent-headless/cli.js run --provider cursor --cwd N:\aigent-place --model cursor-grok-4.5-high --effort high --access edit-isolated --prompt-file C:\Users\shift\AppData\Local\Temp\codex-task-048-cursor-impl.md --timeout-ms 1200000 --trust-workspace --output text --json
  started 2026-08-10T01:05:39Z, timed out after 900.0s
  output:
  | (node:56968) [MODULE_TYPELESS_PACKAGE_JSON] Warning: Module type of file:///N:/aigent-place/.agent-foundry/agent-headless/cli.js is not specified and it doesn't parse as CommonJS.
  | Reparsing as ES module because module syntax was detected. This incurs a performance overhead.
  | To eliminate this warning, add "type": "module" to N:\aigent-place\package.json.
  | (Use `node --trace-warnings ...` to show where the warning was created)
- 2026-08-10T01:27:56Z — run: node .agent-foundry/agent-headless/cli.js run --provider cursor --cwd N:\aigent-place --model cursor-grok-4.5-high --effort high --access edit-isolated --prompt-file C:\Users\shift\AppData\Local\Temp\codex-task-048-cursor-repair.md --timeout-ms 840000 --trust-workspace --output text --json
  started 2026-08-10T01:23:36Z, exit 0 in 260.0s
  output tail (truncated to last 30 lines):
  | r": "cursor",
  |       "type": "result",
  |       "kind": "result",
  |       "raw": "Using worktree: C:\\Users\\shift\\.cursor\\worktrees\\aigent-place\\agent-headless-msmjsk29-71f4d0fc7b64\n## Status\n\nCompile ambiguity is fixed; one likely rustfmt line and one likely clippy paren issue were cleaned up. **Shell is blocked in this session** (`Rejected:` on every command, including `whoami` / subagents), so the three cargo gates were **not executed**.\n\n### Files changed\n| File | Change |\n| --- | --- |\n| `crates/world-server/tests/collider_behavior.rs` | `(1.0_f64 - …).sqrt()`; wrap long `assert_corners_inside` call (`max_width = 100`) |\n| `crates/world-server/src/collider.rs` | `!magnitude_squared.is_finite()` (drop unused parens) |\n| `crates/world-server/src/lib.rs` | **unchanged** (exports already present) |\n\n### Commands / results\n| Command | Result |\n| --- | --- |\n| `cargo fmt --all -- --check` | **Not run** (shell rejected) |\n| `cargo test -p world-server --test collider_behavior` | **Not run** (shell rejected) |\n| `cargo clippy -p world-server --all-targets -- -D warnings` | **Not run** (shell rejected) |\n\n### Contract check (static)\nAgainst ADR-0002 and `world/v1/CONTRACT.md` §§4.2 / 5, the implementation matches the accepted scope:\n\n- Parent-before-child: Hamilton `parent * child`; child translation rotated by parent before add  \n- `abs(R)*h` via `checked_extent`  \n- Ascending `node_id` part order + `canonical_bits`  \n- Aggregate component-wise min/max (not hull merge)  \n- Strict positive-volume overlap (face/edge/point contact ≠ overlap)  \n- Cosmetic fields absent from derivation / bits  \n- No aggregate `max_extent_mm` enforcement (deferred as required)  \n- World-contract rotated-box fixture numbers match the independent hand-check (`[-90,120,30]` … `[310,320,630]`)\n\n### Residual risks\n- **Gate status unknown** until fmt / test / clippy actually run in this worktree.  \n- Preemptive fmt/clippy edits were not confirmed by the tools.  \n- Same-build bit-identity and composition tests are unexecuted.\n\nRe-run the three commands locally (or re-invoke with Shell enabled) to close validation.\n"
  |     }
  |   ],
  |   "exitCode": 0,
  |   "modelRequested": "cursor-grok-4.5-high",
  |   "warnings": [],
  |   "workspace": {
  |     "cwd": "N:\\aigent-place",
  |     "access": "edit-isolated",
  |     "worktree": "C:\\Users\\shift\\.cursor\\worktrees\\aigent-place\\agent-headless-msmjsk29-71f4d0fc7b64",
  |     "worktreeSource": "reported",
  |     "worktreeName": "agent-headless-msmjsk29-71f4d0fc7b64"
  |   },
  |   "stderr": "",
  |   "durationMs": 258743
  | }
  | (node:47880) [MODULE_TYPELESS_PACKAGE_JSON] Warning: Module type of file:///N:/aigent-place/.agent-foundry/agent-headless/cli.js is not specified and it doesn't parse as CommonJS.
  | Reparsing as ES module because module syntax was detected. This incurs a performance overhead.
  | To eliminate this warning, add "type": "module" to N:\aigent-place\package.json.
  | (Use `node --trace-warnings ...` to show where the warning was created)
- 2026-08-10T01:28:26Z — run: cargo fmt --all -- --check
  started 2026-08-10T01:28:26Z, exit 1 in 0.2s
  output tail (truncated to last 30 lines):
  | -    vector: [f64; 3],
  | -) -> Result<[f64; 3], ColliderDerivationError> {
  | +fn rotate_vector(q: UnitQuat, vector: [f64; 3]) -> Result<[f64; 3], ColliderDerivationError> {
  |      let matrix = rotation_matrix(q);
  |      Ok([
  |          checked_dot(matrix[0], vector)?,
  | Diff in \\?\N:\aigent-place\crates\world-server\tests\collider_behavior.rs:133:
  |  /// Independent unit-quaternion normalization matching `world-contract.mjs`.
  |  fn normalize_quat(q: [f64; 4]) -> [f64; 4] {
  |      let magnitude = (q[0] * q[0] + q[1] * q[1] + q[2] * q[2] + q[3] * q[3]).sqrt();
  | -    let mut n = [q[0] / magnitude, q[1] / magnitude, q[2] / magnitude, q[3] / magnitude];
  | +    let mut n = [
  | +        q[0] / magnitude,
  | +        q[1] / magnitude,
  | +        q[2] / magnitude,
  | +        q[3] / magnitude,
  | +    ];
  |      let first = [n[3], n[0], n[1], n[2]]
  |          .into_iter()
  |          .find(|value| *value != 0.0)
  | Diff in \\?\N:\aigent-place\crates\world-server\tests\collider_behavior.rs:360:
  |          let shape = ShapeTree {
  |              nodes: vec![node(1, 0, 0, 0, 0, Some(primitive))],
  |          };
  | -        let collider =
  | -            derive_collider(&shape, WorldPointMm::origin()).expect("identity primitive");
  | +        let collider = derive_collider(&shape, WorldPointMm::origin()).expect("identity primitive");
  |          assert_eq!(collider.parts().len(), 1);
  |          assert_aabb_matches(
  |              collider.parts()[0].bounds(),
- 2026-08-10T01:28:38Z — run: cargo fmt --all -- --check
  started 2026-08-10T01:28:38Z, exit 0 in 0.2s
  output:
  | (no output)
- 2026-08-10T01:28:42Z — run: cargo test -p world-server --test collider_behavior
  started 2026-08-10T01:28:38Z, exit 0 in 3.6s
  output:
  |
  | running 14 tests
  | test aggregate_is_component_wise_minmax_not_a_hull_merge_of_parts ... ok
  | test entity_translation_offsets_every_part ... ok
  | test fail_closed_on_empty_tree_and_missing_invariants ... ok
  | test capsule_zero_segment_half_extents_remain_radius_on_y ... ok
  | test identity_primitives_match_contract_half_extents ... ok
  | test canonical_bits_are_little_endian_node_id_and_f64_patterns ... ok
  | test overlap_requires_strictly_positive_extent_on_all_axes ... ok
  | test cosmetic_fields_do_not_change_canonical_bits ... ok
  | test parent_orientation_rotates_child_translation_before_addition ... ok
  | test rotated_box_matches_independent_corner_oracle ... ok
  | test rotated_box_matches_world_contract_fixture ... ok
  | test same_build_derivation_is_bit_identical_across_calls ... ok
  | test world_point_rejects_non_finite_and_canonicalizes_negative_zero ... ok
  | test parts_sort_by_ascending_node_id_despite_shuffled_input ... ok
  |
  | test result: ok. 14 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.00s
  |
  |    Compiling world-server v0.1.0 (N:\aigent-place\crates\world-server)
  |     Finished `test` profile [unoptimized + debuginfo] target(s) in 3.29s
  |      Running tests\collider_behavior.rs (target\debug\deps\collider_behavior-773c1f01b6559664.exe)
- 2026-08-10T01:28:44Z — run: cargo clippy -p world-server --all-targets -- -D warnings
  started 2026-08-10T01:28:42Z, exit 101 in 1.7s
  output:
  |     Checking world-server v0.1.0 (N:\aigent-place\crates\world-server)
  | error: using `clone` on type `Quaternion` which implements the `Copy` trait
  |    --> crates\world-server\tests\collider_behavior.rs:428:50
  |     |
  | 428 |                 transform: transform(10, 20, 30, parent_rotation.clone()),
  |     |                                                  ^^^^^^^^^^^^^^^^^^^^^^^ help: try removing the `clone` call: `parent_rotation`
  |     |
  |     = help: for further information visit https://rust-lang.github.io/rust-clippy/master/index.html#clone_on_copy
  |     = note: `-D clippy::clone-on-copy` implied by `-D warnings`
  |     = help: to override `-D warnings` add `#[allow(clippy::clone_on_copy)]`
  |
  | error: using `clone` on type `Quaternion` which implements the `Copy` trait
  |    --> crates\world-server\tests\collider_behavior.rs:432:49
  |     |
  | 432 |                 transform: transform(100, 0, 0, child_rotation.clone()),
  |     |                                                 ^^^^^^^^^^^^^^^^^^^^^^ help: try removing the `clone` call: `child_rotation`
  |     |
  |     = help: for further information visit https://rust-lang.github.io/rust-clippy/master/index.html#clone_on_copy
  |
  | error: using `clone` on type `Quaternion` which implements the `Copy` trait
  |    --> crates\world-server\tests\collider_behavior.rs:503:45
  |     |
  | 503 |             transform: transform(5, -7, 11, rotation.clone()),
  |     |                                             ^^^^^^^^^^^^^^^^ help: try removing the `clone` call: `rotation`
  |     |
  |     = help: for further information visit https://rust-lang.github.io/rust-clippy/master/index.html#clone_on_copy
  |
  | error: could not compile `world-server` (test "collider_behavior") due to 3 previous errors
  | warning: build failed, waiting for other jobs to finish...
- 2026-08-10T01:29:04Z — run: cargo fmt --all -- --check
  started 2026-08-10T01:29:04Z, exit 0 in 0.2s
  output:
  | (no output)
- 2026-08-10T01:29:05Z — run: cargo test -p world-server --test collider_behavior
  started 2026-08-10T01:29:04Z, exit 0 in 1.0s
  output:
  |
  | running 14 tests
  | test capsule_zero_segment_half_extents_remain_radius_on_y ... ok
  | test canonical_bits_are_little_endian_node_id_and_f64_patterns ... ok
  | test rotated_box_matches_independent_corner_oracle ... ok
  | test aggregate_is_component_wise_minmax_not_a_hull_merge_of_parts ... ok
  | test same_build_derivation_is_bit_identical_across_calls ... ok
  | test identity_primitives_match_contract_half_extents ... ok
  | test fail_closed_on_empty_tree_and_missing_invariants ... ok
  | test parent_orientation_rotates_child_translation_before_addition ... ok
  | test parts_sort_by_ascending_node_id_despite_shuffled_input ... ok
  | test entity_translation_offsets_every_part ... ok
  | test world_point_rejects_non_finite_and_canonicalizes_negative_zero ... ok
  | test overlap_requires_strictly_positive_extent_on_all_axes ... ok
  | test cosmetic_fields_do_not_change_canonical_bits ... ok
  | test rotated_box_matches_world_contract_fixture ... ok
  |
  | test result: ok. 14 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.00s
  |
  |    Compiling world-server v0.1.0 (N:\aigent-place\crates\world-server)
  |     Finished `test` profile [unoptimized + debuginfo] target(s) in 0.69s
  |      Running tests\collider_behavior.rs (target\debug\deps\collider_behavior-773c1f01b6559664.exe)
- 2026-08-10T01:29:06Z — run: cargo clippy -p world-server --all-targets -- -D warnings
  started 2026-08-10T01:29:05Z, exit 0 in 0.4s
  output:
  |     Checking world-server v0.1.0 (N:\aigent-place\crates\world-server)
  |     Finished `dev` profile [unoptimized + debuginfo] target(s) in 0.28s
- 2026-08-10T01:29:29Z — note: behavior tests before cold review: collider derivation/order is removed by iterating unsorted or skipping parent composition; aggregate behavior is removed by using only one part; legal-contact behavior is removed by changing strict overlap to inclusive; cosmetic independence is removed by including presentation fields in canonical output. Each has a named task test and will be mutation-checked before review.
- 2026-08-10T01:29:39Z — run: cargo test -p world-server --test collider_behavior overlap_requires_strictly_positive_extent_on_all_axes
  started 2026-08-10T01:29:37Z, exit 101 in 1.6s
  output:
  |
  | running 1 test
  | test overlap_requires_strictly_positive_extent_on_all_axes ... FAILED
  |
  | failures:
  |
  | ---- overlap_requires_strictly_positive_extent_on_all_axes stdout ----
  |
  | thread 'overlap_requires_strictly_positive_extent_on_all_axes' panicked at crates\world-server\tests\collider_behavior.rs:597:5:
  | assertion failed: !a.overlaps_positive_volume(face)
  | note: run with `RUST_BACKTRACE=1` environment variable to display a backtrace
  |
  |
  | failures:
  |     overlap_requires_strictly_positive_extent_on_all_axes
  |
  | test result: FAILED. 0 passed; 1 failed; 0 ignored; 0 measured; 13 filtered out; finished in 0.00s
  |
  |    Compiling world-server v0.1.0 (N:\aigent-place\crates\world-server)
  |     Finished `test` profile [unoptimized + debuginfo] target(s) in 1.30s
  |      Running tests\collider_behavior.rs (target\debug\deps\collider_behavior-773c1f01b6559664.exe)
  | error: test failed, to rerun pass `-p world-server --test collider_behavior`
- 2026-08-10T01:29:53Z — run: cargo test -p world-server --test collider_behavior parent_orientation_rotates_child_translation_before_addition
  started 2026-08-10T01:29:51Z, exit 0 in 1.7s
  output:
  |
  | running 1 test
  | test parent_orientation_rotates_child_translation_before_addition ... ok
  |
  | test result: ok. 1 passed; 0 failed; 0 ignored; 0 measured; 13 filtered out; finished in 0.00s
  |
  |    Compiling world-server v0.1.0 (N:\aigent-place\crates\world-server)
  | warning: function `multiply_quaternion` is never used
  |    --> crates\world-server\src\collider.rs:582:4
  |     |
  | 582 | fn multiply_quaternion(a: UnitQuat, b: UnitQuat) -> Result<UnitQuat, ColliderDerivationError> {
  |     |    ^^^^^^^^^^^^^^^^^^^
  |     |
  |     = note: `#[warn(dead_code)]` on by default
  |
  | warning: `world-server` (lib) generated 1 warning
  |     Finished `test` profile [unoptimized + debuginfo] target(s) in 1.40s
  |      Running tests\collider_behavior.rs (target\debug\deps\collider_behavior-773c1f01b6559664.exe)
- 2026-08-10T01:30:35Z — run: cargo test -p world-server --test collider_behavior parts_sort_by_ascending_node_id_despite_shuffled_input
  started 2026-08-10T01:30:33Z, exit 101 in 2.0s
  output:
  |
  | running 1 test
  | test parts_sort_by_ascending_node_id_despite_shuffled_input ... FAILED
  |
  | failures:
  |
  | ---- parts_sort_by_ascending_node_id_despite_shuffled_input stdout ----
  |
  | thread 'parts_sort_by_ascending_node_id_despite_shuffled_input' panicked at crates\world-server\tests\collider_behavior.rs:544:5:
  | assertion `left == right` failed
  |   left: [30, 20, 10]
  |  right: [10, 20, 30]
  | note: run with `RUST_BACKTRACE=1` environment variable to display a backtrace
  |
  |
  | failures:
  |     parts_sort_by_ascending_node_id_despite_shuffled_input
  |
  | test result: FAILED. 0 passed; 1 failed; 0 ignored; 0 measured; 13 filtered out; finished in 0.00s
  |
  |    Compiling world-server v0.1.0 (N:\aigent-place\crates\world-server)
  |     Finished `test` profile [unoptimized + debuginfo] target(s) in 1.65s
  |      Running tests\collider_behavior.rs (target\debug\deps\collider_behavior-773c1f01b6559664.exe)
  | error: test failed, to rerun pass `-p world-server --test collider_behavior`
- 2026-08-10T01:30:44Z — run: cargo test -p world-server --test collider_behavior aggregate_is_component_wise_minmax_not_a_hull_merge_of_parts
  started 2026-08-10T01:30:42Z, exit 101 in 1.8s
  output:
  |
  | running 1 test
  | test aggregate_is_component_wise_minmax_not_a_hull_merge_of_parts ... FAILED
  |
  | failures:
  |
  | ---- aggregate_is_component_wise_minmax_not_a_hull_merge_of_parts stdout ----
  |
  | thread 'aggregate_is_component_wise_minmax_not_a_hull_merge_of_parts' panicked at crates\world-server\tests\collider_behavior.rs:566:17:
  | index out of bounds: the len is 1 but the index is 1
  | note: run with `RUST_BACKTRACE=1` environment variable to display a backtrace
  |
  |
  | failures:
  |     aggregate_is_component_wise_minmax_not_a_hull_merge_of_parts
  |
  | test result: FAILED. 0 passed; 1 failed; 0 ignored; 0 measured; 13 filtered out; finished in 0.00s
  |
  |    Compiling world-server v0.1.0 (N:\aigent-place\crates\world-server)
  |     Finished `test` profile [unoptimized + debuginfo] target(s) in 1.48s
  |      Running tests\collider_behavior.rs (target\debug\deps\collider_behavior-773c1f01b6559664.exe)
  | error: test failed, to rerun pass `-p world-server --test collider_behavior`
- 2026-08-10T01:30:57Z — run: cargo test -p world-server --test collider_behavior aggregate_is_component_wise_minmax_not_a_hull_merge_of_parts
  started 2026-08-10T01:30:55Z, exit 101 in 2.0s
  output tail (truncated to last 30 lines):
  | failures:
  |
  | ---- aggregate_is_component_wise_minmax_not_a_hull_merge_of_parts stdout ----
  |
  | thread 'aggregate_is_component_wise_minmax_not_a_hull_merge_of_parts' panicked at crates\world-server\tests\collider_behavior.rs:67:5:
  | max.x: actual=50 expected=550 delta=500 tol=0.000000001
  | note: run with `RUST_BACKTRACE=1` environment variable to display a backtrace
  |
  |
  | failures:
  |     aggregate_is_component_wise_minmax_not_a_hull_merge_of_parts
  |
  | test result: FAILED. 0 passed; 1 failed; 0 ignored; 0 measured; 13 filtered out; finished in 0.00s
  |
  |    Compiling world-server v0.1.0 (N:\aigent-place\crates\world-server)
  | warning: associated function `component_wise_union` is never used
  |    --> crates\world-server\src\collider.rs:144:8
  |     |
  | 93  | impl Aabb {
  |     | --------- associated function in this implementation
  | ...
  | 144 |     fn component_wise_union(parts: &[NodeAabb]) -> Result<Self, ColliderDerivationError> {
  |     |        ^^^^^^^^^^^^^^^^^^^^
  |     |
  |     = note: `#[warn(dead_code)]` on by default
  |
  | warning: `world-server` (lib) generated 1 warning
  |     Finished `test` profile [unoptimized + debuginfo] target(s) in 1.78s
  |      Running tests\collider_behavior.rs (target\debug\deps\collider_behavior-773c1f01b6559664.exe)
  | error: test failed, to rerun pass `-p world-server --test collider_behavior`
- 2026-08-10T01:31:18Z — note: mutation check: inclusive overlap made the exact-face test fail; reversing parts made the node-order test fail; replacing aggregate union with the first part made the aggregate test fail. Removing child quaternion composition did NOT fail the parent/child test because its child primitive was a cube. Confirmed coverage gap: make that child asymmetric and assert its composed bounds before review.
