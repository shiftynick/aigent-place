# Task-064 bounded local admission follow-up

The follow-up fixes false Accepted results when a reconnect command collides with a queued canonical tuple, and preserves normal spectator/replay classification at terminal World state. All required checks passed. No unresolved defect was identified in the warm self-review. The root owns combined cold reviews, the fresh runtime rebuild, real SDK/browser evidence, and the full repository/product gate.

## Frozen delivery

- Worktree: `/home/shifty/Work/aigent-place-task064-arrival`. Root source was not edited.
- Frozen pre-follow-up index tree: `324e21f056dd5105144de5c0e526388f7b280ca9` (`git write-tree` before production edits, saved in `round1-arrival-followup/base-tree.txt`). Root already contains that exact original four-file arrival repair.
- Delta: `/home/shifty/.local/state/aigent-place/improvement-loop-2026-10-08/round1-arrival-followup.patch`.
- Delta SHA-256: `52d715369143426bbdad75de689afa25da8f8f2ca150483e6078dadfa1b366ac`.
- Export command: `git diff --cached --binary 324e21f056dd5105144de5c0e526388f7b280ca9 > /home/shifty/.local/state/aigent-place/improvement-loop-2026-10-08/round1-arrival-followup.patch`.
- Delta contains only `crates/world-server/src/session.rs`, `src/transport.rs`, `src/world.rs`, and `tests/listen_journal_behavior.rs`. Named staging only. The already staged original `async_writer_behavior.rs` has no delta against the frozen tree. `.tasks` is excluded.
- `git diff --cached --check 324e21f056dd5105144de5c0e526388f7b280ca9` passed, recorded through the task CLI.
- Shared-target writes stopped after the final crate checks. No worker commit, push, PR, or shared board lifecycle operation.

## Cause and approved outline

The prior transport classified/cached a novel command as Accepted before queue insertion. A reconnect starts sequence 1 again, while the World canonical key remains `(arrival_tick, aigent_id, sequence)`. E1 MOVE seq1 queued for T+1 while T was sealed Busy; E2 STOP seq1 selected the same unstarted T+1 tuple. The single enqueue rejected it, but transport ignored that error and delivered the cached Accepted. On failed T retry, a future duplicate can be in `tentative.remaining_pending`, beyond the old pending-only duplicate search. Separately, transport looked up the terminal admission tick before SessionHub classification. That prematurely closed spectators and valid cached replay and attempted to classify arithmetic exhaustion as PersistenceUnavailable.

Root approved the outline after the independent challenge `round1-admission-challenge.md`, before production bodies. The worker card records these five rubric items: real WebSocket reconnect conflict with effect/replay integrity; remaining-pending duplicates during failure/retry Busy; atomic spawn+MOVE preflight; terminal role/replay preservation plus fatal no-cache/no-storage-error behavior; existing public SessionHub and tick/pressure invariants with mutation coverage and final crate checks.

Implementation:

1. `session.rs:184,479`: private `AdmissionFailure<E>` and `submit_command_with_admission<E>` run a synchronous callback only for a novel, decoded, valid exact-next command, before either result cache. Domain Conflict stores both idempotency and sequence results and consumes the exact-next sequence. Fatal returns its error before either cache/cursor changes. Existing public submit keeps its signature with an infallible callback. Replays, role/epoch/sequence/feature classifications, unsupported kinds, and decoding failures never call admission.
2. `world.rs:515`: private `enqueue_batch` checks earliest-unstarted tick and canonical duplicates against pending, tentative remaining pending, and within the new batch, then appends all-or-none. Public enqueue delegates. Original checked admission tick accessor, sealed-generation exclusion, and public next_tick remain intact.
3. `transport.rs:1088,1136`: Sessions -> World lock order; actual effect tick selected synchronously under World ownership; optional demo spawn and MOVE form one batch. Duplicate/no free demo slot maps to existing Conflict15. Terminal/internal failure logs correlated connection ID/message ID after guards drop and closes through the existing socket path, with no published storage-failure code and no cache writes. Geometry skeletons retain their accepted no-effect behavior. Diagnostic stamps are appended after locks release only for newly queued effects.

No published wire/persisted schema, global wall-pressure counter, canonical ordering, durability stamps, or storage wait in the simulation stage changed. This is local queue admission; Accepted delivery still precedes durable installation under the existing behavior. Task-042 global writer failure and durable-result lifecycle remain deferred, as directed. No new ADR is needed to restore this existing admission boundary.

## Regression before production fix

Every command below ran with the exact pinned environment through `node .agents/skills/task-tracker/scripts/task.mjs run task-064 -- ...` in the isolated worktree:

```text
PATH=/home/shifty/.local/share/mise/installs/node/22.22.2/bin:/home/shifty/.cargo/bin:$PATH
CARGO_TARGET_DIR=/home/shifty/Work/aigent-place/target
CARGO_INCREMENTAL=0
CARGO_PROFILE_DEV_DEBUG=0
CARGO_PROFILE_TEST_DEBUG=0
```

- 15:49:03Z: `cargo test -p world-server --test listen_journal_behavior reconnect_during`, exit101, 6.1s. Both new tests compiled/running failed: `reconnect_during_busy_rejects_collision_and_preserves_replays` and `reconnect_during_retry_busy_rejects_tentative_remaining_collision`. Actual assertion: `reconnected seq1 collision must reject rather than falsely accept and drop STOP`; actual CommandResult had `command_message_id:1`, `sequence:1`, colliding-stop key, `Some(Accepted(...))`. These are finding 1 red cases.
- 15:49:16Z: `cargo test -p world-server --lib terminal_world_preserves`, exit101, 4.6s. Both new actual WebSocket cases failed: `terminal_world_preserves_spectate_only_wire_rejection` and `terminal_world_preserves_cached_cross_epoch_wire_replay`. Actual assertion: `terminal state must retain role/replay classification: Close(None)`. These are finding 4 red cases.
- 15:49:38Z: `cargo test -p world-server --test listen_journal_behavior rejected_move_batch_does_not_leave_partial_spawn`, exit101, 0.1s. Compiled/running assertion `batch collision must reject`; actual CommandResult was `Some(Accepted(...))` for partial-move. The final test additionally requires original world_value9, no created entity/binding, and only one original applied command.

The first two baseline runs preceded the worker rubric/outline note; all three preceded production edits. Tests were the only implementation changes for these reds. A later first implementation compile attempt caught a missing test import and Debug derive; it is recorded, fixed, and is not counted as a behavioral red. An initial mutation script lookup failed before any mutation ran; the corrected script then ran all mutations successfully. Full exact task CLI output is in `round1-arrival-followup/evidence-log.md`.

## Final regression assertions

The reconnect tests seal generation T=1, accept E1 MOVE seq1/Koriginal into T+1=2, execute 64 Busy passes while advancing the independent pressure counter, then reconnect the same aigent into E2 and send STOP seq1/Kcollision. They require correlated Conflict, identical same-epoch rejection replay, original durable MOVE and one body at tick2, exactly two original applied effects, fresh seq2 STOP cancellation, and E3 cross-epoch replay of both the rejection and original acceptance without another spawn/MOVE/cancel. The retry test injects T's durable failure, retries T, and repeats the reconnect while future MOVE is in tentative.remaining_pending.

World batch tests require second-tuple collision and internal duplicate rejection to leave pending unchanged. The real WebSocket partial-spawn regression checks there is no orphan body after the rejected MOVE. The 4096-slot full demo grid test requires Conflict and no target spawn. Existing geometry skeleton tests require Ok(None), no applied commands, and no entities.

The terminal WebSocket tests require SpectateOnly for Viewer and cached cross-epoch Accepted replay for Aigent at published MAX. A novel subsequent STOP must close without a binary PersistenceUnavailable envelope, leave diagnostic stamps empty, and leave its seq/key novel and retryable after a synthetic admissible test state is restored. Separate SessionHub tests verify both caches/cursor after fatal, rejection caches across epochs/content conflicts, and callbacks never run for replay/classification/invalid decode.

## Compiling mutation reds

The task CLI ran `python3 /home/shifty/.local/state/aigent-place/improvement-loop-2026-10-08/round1-arrival-followup/mutations.py`, exit0 in 66.0s. Each listed mutation compiled (`Finished test`), ran the named test, failed behaviorally with exit101, and was restored by the script's finally block. No compile-only failure is counted. The following table and `mutations.json` are the exact command/result packet; each `<mutation>.log` contains the actual failure.

| Mutation | Exact command | Result | Detected assertion |
| --- | --- | --- | --- |
| ignore-local-rejection | `cargo test -p world-server --test listen_journal_behavior reconnect_during_busy_rejects_collision_and_preserves_replays` | 101, compiled/running red | Ignored callback rejection; reconnect STOP was falsely Accepted. |
| forget-rejected-key-cache | `cargo test -p world-server --lib local_rejection_caches_key_sequence_and_cross_epoch_replay` | 101, compiled/running red | Rejected idempotency cache had 0 records; expected 1. |
| consume-sequence-on-fatal | `cargo test -p world-server --lib fatal_local_admission_leaves_both_caches_and_cursor_retryable` | 101, compiled/running red | Fatal advanced cursor to 2; expected 1. |
| cache-key-on-fatal | `cargo test -p world-server --lib fatal_local_admission_leaves_both_caches_and_cursor_retryable` | 101, compiled/running red | Fatal left an idempotency record; expected empty. |
| callback-on-sequence-replay | `cargo test -p world-server --lib classifications_and_decoding_failures_do_not_invoke_local_admission` | 101, compiled/running red | Panic callback was invoked on sequence replay. |
| callback-on-key-replay | `cargo test -p world-server --lib local_rejection_caches_key_sequence_and_cross_epoch_replay` | 101, compiled/running red | Panic callback was invoked on cross-epoch key replay. |
| callback-before-valid-move-decode | `cargo test -p world-server --lib classifications_and_decoding_failures_do_not_invoke_local_admission` | 101, compiled/running red | Panic callback was invoked before malformed MOVE rejection. |
| ignore-tentative-remaining-duplicates | `cargo test -p world-server --test listen_journal_behavior reconnect_during_retry_busy_rejects_tentative_remaining_collision` | 101, compiled/running red | Failed-generation retry Busy accepted the colliding STOP. |
| append-partial-effect-batch | `cargo test -p world-server --lib effect_batch_second_collision_leaves_pending_unchanged` | 101, compiled/running red | Pending changed on a rejected second tuple; expected identical pending. |
| ignore-internal-batch-duplicates | `cargo test -p world-server --lib effect_batch_internal_duplicate_leaves_pending_unchanged` | 101, compiled/running red | Internal duplicate returned Ok; expected DuplicateCommandTuple. |
| terminal-check-before-classification | `cargo test -p world-server --lib terminal_world_preserves` | 101, compiled/running red | Both terminal role/replay cases received Close(None). |
| publish-terminal-as-storage-failure | `cargo test -p world-server --lib terminal_world_preserves_cached_cross_epoch_wire_replay` | 101, compiled/running red | Novel terminal command received a binary storage error; expected close. |
| silently-admit-no-free-demo-slot | `cargo test -p world-server --lib full_demo_spawn_grid_rejects_without_a_partial_batch` | 101, compiled/running red | Full grid returned success; expected typed Conflict. |
| reject-existing-geometry-skeletons | `cargo test -p world-server --lib geometry_skeletons_admit_without_local_effects` | 101, compiled/running red | Existing no-effect skeleton returned UnsupportedMessage; expected Ok(None). |

## Final checks after last edit and mutation restoration

All were executed once against restored final source through the task CLI:

| Command | Result |
| --- | --- |
| `cargo fmt --all -- --check` | exit0, 0.3s |
| `cargo clippy -p world-server --all-targets -- -D warnings` | exit0, 3.5s |
| `cargo test -p world-server` | exit0, 14.6s; 279 passed: 73 library, 1 binary, 205 integration; zero doc tests |
| `git diff --cached --check 324e21f056dd5105144de5c0e526388f7b280ca9` | exit0, no whitespace error |

Full crate tests include original 64-Busy first-unsealed generation arrival, late STOP success/failure retry, async sealed rejection/no-drop, checked terminal arithmetic, and wall-pressure expiry while Busy. No extra full product gate or runtime was run by this worker; those remain root-owned. Warm self-review checked all five rubric items, all lock sites (only command ingress simultaneously holds Sessions then World), result/cache boundaries, restored mutation source, and named staged scope; no material issue remained.

## Final source SHA-256

| Path | SHA-256 |
| --- | --- |
| `crates/world-server/src/session.rs` | `cd2f1b2045f55068c401b5b46370207421630dd2070a6117e549d2b805a054f4` |
| `crates/world-server/src/transport.rs` | `6103a6b9793e6aca9aa7c2c0b1ce888795ed2d1c5ee46cc7c3ada53d75184b51` |
| `crates/world-server/src/world.rs` | `5c3fd3727184c4e06eff6639c49f98a2b2e3a0f6fa39273b8f13d5fa7fa58b9c` |
| `crates/world-server/tests/listen_journal_behavior.rs` | `241648c20cf0926a29012af7c91aa5e33bb3bdb17e3099027f807ecc67054c5c` |

Evidence files:

- `round1-arrival-followup/evidence-log.md`: exact own task CLI follow-up slice, including baseline reds, development compile/script corrections, mutations, final checks, warm review, and frozen handoff.
- `round1-arrival-followup/task-064-worker-card.md`: complete own card copy.
- `round1-arrival-followup/mutations.json`, `mutations.py`, and 14 mutation logs.
- `round1-arrival-followup/manifest.json`: hashes, frozen tree, mutation results, and final checks.

Limitations: this bounded fix does not make command results durable before delivery, implement global storage-failure shutdown, or add geometry effects to existing skeleton commands. Existing task-042 and product work retain those scopes. Parent will rebuild the integrated root binary for real runtime evidence, since a shared target can contain another worktree's executable.
