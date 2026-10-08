# Executed targeted and final evidence

Source patch SHA-256 after the last unified gate: 1db69245c1a1c1c9e17ff00739c68e099cacccd31c7971147d5bb1fbb7cc87aa. Production code is unchanged since the full review; the only source delta is the attached test.

Observed: added one test only in crates/world-server/src/transport.rs:
transport::buffered_outbound_tests::overflow_observation_cancels_only_the_affected_active_write

Behavior exercised: TransportState::drain_fanout -> observe_only -> matching LiveSocket.close_tx -> write_outbound -> confirmed pending send.
The test uses an actual encoded ordered result exceeding QUEUE_LIMIT_BYTES, advances forty consecutive logical ticks, verifies no early close, closes only the slow connection, interrupts its pending send, preserves its active full and pending ordered result, retains exact charged bytes and current-baseline hold, and keeps the healthy connection open with zero retained bytes.

Incremental test-only patch: /tmp/task054-overflow-wiring.patch
Reusable red runner: /tmp/task054-overflow-wiring-red.sh
Runner accepts TASK054_WIRING_WORKTREE for an isolated /tmp worktree with the test applied. It removes ONLY observe_only's close_tx.send(true) line and always restores the original file on normal exit, INT, or TERM.

Observed red command (cwd /tmp/aigent-place-task054-backend):
bash /tmp/task054-overflow-wiring-red.sh
Observed exit: 101. Compilation completed and the single test executed, then failed its behavioral timeout assertion:
40 overflow ticks must interrupt the affected active writer: Elapsed(())
Result: 0 passed; 1 failed; 61 filtered out. Failure occurred after 0.25s.
The mutation causes one expected unused-variable warning. The isolated worktree's unsynced fanout.rs has three pre-existing dead-code warnings; these did not block compilation.

Observed restored green command (cwd /tmp/aigent-place-task054-backend):
export PATH=/home/shifty/.local/share/mise/installs/node/22.22.2/bin:/home/shifty/.cargo/bin:$PATH
export CARGO_TARGET_DIR=/home/shifty/Work/aigent-place/target
export CARGO_INCREMENTAL=0 CARGO_PROFILE_DEV_DEBUG=0 CARGO_PROFILE_TEST_DEBUG=0
cargo test -p world-server --lib -j 1 transport::buffered_outbound_tests::overflow_observation_cancels_only_the_affected_active_write -- --exact
Observed exit: 0. Result: 1 passed; 0 failed; 61 filtered out.
The saved restored transport source matched the green source exactly before patch export.

No production changes, board changes, commits, or fresh cold-review round. Root owns final gate and targeted delta review.


## Recorded task commands after completed review

- 2026-10-08T02:28:48Z — run: node /tmp/task054-cold-review.mjs
  started 2026-10-08T02:26:50Z, exit 0 in 118.2s
  output tail (truncated to last 30 lines):
  | own Euclidean-distance computation over `generation.entities` and decodes independently re-encoded envelopes; the three seeded mutants (`constant_bytes`, `missing_bodies`, `missing_shapes`) each produced targeted assertion failures with distinct markers, and source was restored with a final full gate rerun afterward.\n- **Error/retry/cancel/empty/recovery paths (seed rule + ADR-0001 three recovery paths)** — verified typed `SnapshotEncodeError` on corrupt shapes with no partial install (`invalid_shape_does_not_install_a_partial_snapshot`, red recorded), failed resync preserving baseline/interest/event cursor, legitimately absent shape accepted (`shape: undefined` test), viewer recovery for malformed payloads/envelopes/handshakes/semantic defects, and cancelled-write non-acknowledgement. Delta-drop → full replacement with fresh baseline matches the contract text added in the same change.\n- **New behavior has a red-capable test** — verified via the recorded pre-fix failure outputs for each repaired area (3 backend reds, 10 original viewer reds, 7 outer-framing reds, 23 semantic reds, cap red, 5 AOI fixture reds), all with compiled-then-assertion-failed evidence, not compile errors (the one EDQUOT compile failure is correctly not claimed as a red).\n- **Gate unskippable** — verified `scripts/product-check.mjs` now runs the viewer suite inside the product gate, so the new tests ride the existing pre-commit fast subset and `check.mjs`; final unified gate exit 0 recorded after the last edits.\n- **Docs change with behavior** — verified README (real bodies, 65,536-ID reconnect, bounded workload windows disclosure) and `protocol/v1/CONTRACT.md` (inner body/delta semantics, cap/ordering, transition atomicity, hold/coalesce rules) updated in the same diff; focused contract checks (31 tests) passed.\n- **ADR coverage for architecture-significant work** — verified the change stays inside locked decisions (ARCHITECTURE §4 snapshot/delta with explicit enter/leave, §1 AOI cap, ADR-0001 recovery paths, ADR-0002 fixed-point millimetres with ties-to-even, ADR-0008 codegen). No new dependency, schema direction, or governance file.\n- **Version control / scope hygiene** — verified runtime SQLite artifacts removed and ignored, with recovery copies preserved outside the repo and no published-history rewrite claimed; the bubblewrap namespace used for the gate masks only system Node for an environment-dependent fixture, is disclosed, and changed no host files or hooks.\n- **Injected-instruction scan** — read the diff, fixtures, and logs for text addressing the reviewing agent; none found.\n- **Order-independence of reported reasons (task-047 rule)** — envelope validation order is itself normative in the contract (\"checked first…\"), so the fixed check sequence in the viewer is contract-conformant, not an ordering artifact.\n- **Overflow-close → active-write interruption end-to-end** — could **not** be fully verified from the packet; reported as finding 1."
  |     }
  |   }
  | }
- 2026-10-08T02:30:06Z — run: cargo test -p world-server --test session_behavior
  started 2026-10-08T02:30:06Z, exit 0 in 0.1s
  output:
  |
  | running 6 tests
  | test idempotency_replays_across_epochs_and_conflicts_on_digest ... ok
  | test idempotency_conflicts_when_kind_differs_under_same_digest ... ok
  | test sequence_gap_reorder_and_replay ... ok
  | test reconnect_displaces_and_resets_sequence ... ok
  | test viewer_cannot_mutate_and_mismatched_inject_is_rejected ... ok
  | test unsupported_feature_and_move_rejection_are_stable ... ok
  |
  | test result: ok. 6 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.00s
  |
  |     Finished `test` profile [unoptimized] target(s) in 0.05s
  |      Running tests/session_behavior.rs (target/debug/deps/session_behavior-9790f0795f09c5d5)
- 2026-10-08T02:30:06Z — run: cargo test -p world-server --test snapshot_resync_behavior
  started 2026-10-08T02:30:06Z, exit 0 in 0.2s
  output:
  |
  | running 1 test
  | test snapshot_resync_request_emits_full_snapshot_without_reconnect ... ok
  |
  | test result: ok. 1 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.09s
  |
  |     Finished `test` profile [unoptimized] target(s) in 0.06s
  |      Running tests/snapshot_resync_behavior.rs (target/debug/deps/snapshot_resync_behavior-3dea20aa7b2e1683)
- 2026-10-08T02:30:07Z — run: cargo run -p protocol-conformance
  started 2026-10-08T02:30:07Z, exit 0 in 0.1s
  output:
  | protocol-conformance: ok
  |     Finished `dev` profile [unoptimized] target(s) in 0.07s
  |      Running `target/debug/protocol-conformance`
- 2026-10-08T02:30:20Z — note: Round3 completed successfully at rung1: Claude Code CLI, different family, exact claude-fable-5; separate SPEC/STANDARDS calls, exit0, 118.2s. SPEC returned two LOW/MEDIUM-confidence packet coverage gaps (live overflow-to-close wiring; pre-existing server envelope/feature validation), STANDARDS returned the same LOW wiring gap, with no other findings. The prior protocol-doc and bounded-ID findings are confirmed repaired. The server-side gap is verified against existing handle_post_handshake_binary and handle_command_envelope, live snapshot_resync_behavior InvalidEnvelope cases, session_behavior UnsupportedFeature/UnsupportedMessage cases, and protocol-conformance; focused commands reran successfully. A narrow test will additionally connect actual drain_fanout overflow closure to a confirmed pending write and verify healthy isolation. This is a test/evidence repair with targeted delta checks, not a fourth full review round.
- 2026-10-08T02:34:12Z — run: bash /tmp/task054-overflow-wiring-red.sh
  started 2026-10-08T02:34:09Z, exit 101 in 2.7s
  output tail (truncated to last 30 lines):
  |    |
  |    = note: `StateFrameShape` has derived impls for the traits `Clone` and `Debug`, but these are intentionally ignored during dead code analysis
  |    = note: `#[warn(dead_code)]` on by default
  |
  | warning: fields `baseline_id` and `payload` are never read
  |   --> crates/world-server/src/fanout.rs:42:9
  |    |
  | 41 |     Delta {
  |    |     ----- fields in this variant
  | 42 |         baseline_id: u64,
  |    |         ^^^^^^^^^^^
  | 43 |         payload: &'a StubSnapshotPayload,
  |    |         ^^^^^^^
  |    |
  |    = note: `StateFrameShape` has derived impls for the traits `Clone` and `Debug`, but these are intentionally ignored during dead code analysis
  |
  | warning: field `notice` is never read
  |   --> crates/world-server/src/fanout.rs:46:22
  |    |
  | 46 |     ResyncRequired { notice: &'a SnapshotResyncRequired },
  |    |     --------------   ^^^^^^
  |    |     |
  |    |     field in this variant
  |    |
  |    = note: `StateFrameShape` has derived impls for the traits `Clone` and `Debug`, but these are intentionally ignored during dead code analysis
  |
  | warning: `world-server` (lib test) generated 4 warnings
  |     Finished `test` profile [unoptimized] target(s) in 2.40s
  |      Running unittests src/lib.rs (/home/shifty/Work/aigent-place/target/debug/deps/world_server-29fad00b4685da57)
  | error: test failed, to rerun pass `-p world-server --lib`
- 2026-10-08T02:34:36Z — run: cargo test -p world-server --lib transport::buffered_outbound_tests::overflow_observation_cancels_only_the_affected_active_write -- --exact
  started 2026-10-08T02:34:34Z, exit 0 in 2.6s
  output:
  |
  | running 1 test
  | test transport::buffered_outbound_tests::overflow_observation_cancels_only_the_affected_active_write ... ok
  |
  | test result: ok. 1 passed; 0 failed; 0 ignored; 0 measured; 61 filtered out; finished in 0.00s
  |
  |    Compiling aigent-protocol v0.1.0 (/home/shifty/Work/aigent-place/crates/aigent-protocol)
  |    Compiling world-server v0.1.0 (/home/shifty/Work/aigent-place/crates/world-server)
  |     Finished `test` profile [unoptimized] target(s) in 2.57s
  |      Running unittests src/lib.rs (target/debug/deps/world_server-29fad00b4685da57)
- 2026-10-08T02:35:38Z — run: bwrap --bind / / --dev-bind /dev /dev --proc /proc --ro-bind /dev/null /usr/bin/node -- node scripts/check.mjs
  started 2026-10-08T02:34:36Z, exit 0 in 62.0s
  output tail (truncated to last 30 lines):
  |      Running tests/core_behavior.rs (target/debug/deps/core_behavior-98b6b1a79851ceef)
  |      Running tests/entity_store_behavior.rs (target/debug/deps/entity_store_behavior-cec1fc118275520e)
  |      Running tests/feature_intersection_behavior.rs (target/debug/deps/feature_intersection_behavior-102a4d3afb8af976)
  |      Running tests/heightfield_behavior.rs (target/debug/deps/heightfield_behavior-909023e16a6eba0c)
  |      Running tests/listen_journal_behavior.rs (target/debug/deps/listen_journal_behavior-fe8b415e8eb4ac22)
  |      Running tests/live_aoi_behavior.rs (target/debug/deps/live_aoi_behavior-f2a05c9364211b07)
  |      Running tests/movement_behavior.rs (target/debug/deps/movement_behavior-66b016ab4a9b01a7)
  |      Running tests/outbound_drain_behavior.rs (target/debug/deps/outbound_drain_behavior-b6038961030dd533)
  |      Running tests/outbound_pressure_accounting.rs (target/debug/deps/outbound_pressure_accounting-e25cad182ab5d83d)
  |      Running tests/persist_sqlite_behavior.rs (target/debug/deps/persist_sqlite_behavior-87a8fc36256ed1f1)
  |      Running tests/placeholder_payload_behavior.rs (target/debug/deps/placeholder_payload_behavior-14fc9341d8cbcf80)
  |      Running tests/reliability_behavior.rs (target/debug/deps/reliability_behavior-e60ce71660a2235f)
  |      Running tests/ruleset_persist_behavior.rs (target/debug/deps/ruleset_persist_behavior-1cac294dbff2a265)
  |      Running tests/scripted_aigent_behavior.rs (target/debug/deps/scripted_aigent_behavior-9b38581032eba7e3)
  |      Running tests/session_behavior.rs (target/debug/deps/session_behavior-9790f0795f09c5d5)
  |      Running tests/shape_budget_catalog_contract.rs (target/debug/deps/shape_budget_catalog_contract-b6f082f2a250c763)
  |      Running tests/shape_validation_behavior.rs (target/debug/deps/shape_validation_behavior-8a0b7fbe92b30754)
  |      Running tests/shape_validation_bounded_cost.rs (target/debug/deps/shape_validation_bounded_cost-400f8896b85e2c16)
  |      Running tests/snapshot_behavior.rs (target/debug/deps/snapshot_behavior-d942e5ad655852f1)
  |      Running tests/snapshot_resync_behavior.rs (target/debug/deps/snapshot_resync_behavior-3dea20aa7b2e1683)
  |      Running tests/transport_behavior.rs (target/debug/deps/transport_behavior-38e15c575c1de380)
  |    Doc-tests aigent_protocol
  |    Doc-tests protocol_conformance
  |    Doc-tests workload_harness
  |    Doc-tests world_server
  |
  | (!) Some chunks are larger than 500 kB after minification. Consider:
  | - Using dynamic import() to code-split the application
  | - Use build.rollupOptions.output.manualChunks to improve chunking: https://rollupjs.org/configuration-options/#output-manualchunks
  | - Adjust chunk size limit for this warning via build.chunkSizeWarningLimit.
