# Task-064 arrival repair — exact worker evidence

Mutation ceiling: patch only, in /home/shifty/Work/aigent-place-task064-arrival. Four named Rust files are staged. No commit, push, task-state move, root-tree write, wire/persisted schema change, or shared skill change. Binary patch: round1-arrival.patch. Source/patch SHA-256 manifest: round1-arrival/manifest.json. Full copied worker card: round1-arrival/own-task-064.md; only worker entries: round1-arrival/evidence-log.md.

Observed cause: spawn_simulation_loop increments the transport pressure counter every 50 ms, including TickAdvance::Busy. World advances its logical clock only in install_tentative after durable success. Old transport ingress/effect stamps used max(pressure clock, world.next_tick), so every Busy pass permanently pushed future commands farther ahead. ADR-0005 and replay/v1/CONTRACT.md require the earliest input batch that has not started.

Observed original runtime red: `python3 /home/shifty/.local/state/aigent-place/improvement-loop-2026-10-08/round1-sdk-diagnosis/repro.py 9` (worker exec cwd was own worktree; external existing harness targets SDK worktree). Trial repro-1791470705093688989 held a fresh journal write lock for 9.00077 seconds, released it before SDK launch, and durable generation resumed from 1 to 12 before launch. Actual SDK command returned accepted/replayed/renewed but exited 1 after 8.3365 seconds. Observer first body was delayed until 9.42644 seconds and subsequently moved x=25→1500 mm. Unchanged binary SHA-256 f8af3fa4c8ba95559ef55c52a68ed6f4a7b5bbff86019047558d895c0c1816c1. Harness stopped its disposable server/observer in finally.

Outline and implementation (logged before production bodies):
- `pub(crate) World::next_command_tick(&self) -> Result<u64, WorldError>` returns next unstarted batch; a tentative batch reserves its current tick, so checked tick+1 is eligible.
- Add library-only `WorldError::TickExhausted`. Sealed MAX has no successor; published MAX cannot become available again because the public TickClock saturates.
- World::enqueue uses the same eligible minimum and rejects fresh commands in an already sealed tick. Failure restoration bypasses new-arrival validation through the existing direct pending-queue restoration.
- Initial transport stamp is an earlier diagnostic sample, not a reservation. apply_world_effect reserves again and enqueues spawn+MOVE under World ownership. Its small Result return reports terminal exhaustion instead of sending an accepted wire result with no effect; ingress exhaustion uses existing PERSISTENCE_UNAVAILABLE before hub submission.
- Leave the existing wall-paced counter and 40-observation outbound expiry unchanged. Public World::next_tick and all versioned wire/persisted schemas are unchanged. No production storage wait was added.

Regression before fix, recorded by worker task.mjs run (each listed behavioral red compiled and ran):
1. `cargo test -p world-server --test listen_journal_behavior --test async_writer_behavior`: execution stopped after the async-writer binary: new tick-1 enqueue returned Ok during sealed async tick 1; expected StaleArrivalTick minimum 2 (4 passed, 1 failed).
2. `cargo test -p world-server --test listen_journal_behavior`: after 64 Busy/pressure passes the MOVE was stamped 65 instead of 2; late STOP retained tick 1 instead of 2. Refined exact first-eligible body oracle then ran with `cargo test -p world-server --test listen_journal_behavior move_after_busy_passes_uses_first_unsealed_durable_generation` and failed because eligible tick 2 had no bound body.
3. `cargo test -p world-server --lib enqueue_rejects_arrival_when_sealed_tick_has_no_successor`: sealed MAX admitted a new command. After initial repair, extended regression before published-MAX guard again failed: completed MAX enqueue returned Ok instead of TickExhausted. One initial test fixture compilation error was corrected before the compiled behavioral red run.

Green permanent checks cover real generated WebSocket MOVE after 64 Busy passes; first eligible generation contains canonical spawn before MOVE, both with arrival tick 2, and produces an AIGENT real-body full snapshot; sealed tick rejects new arrivals; generated MOVE before seal and STOP after seal remain ordered through success and failure/retry with exactly one spawned entity; earlier diagnostic stamp cannot control actual reservation across a tick boundary; slow-client close still fires at 40 pressure observations while World stays Busy; sealed and completed MAX do not wrap/reopen.

Nine separate behavior-removing mutations compiled and ran red (each cargo command exited 101 with test result FAILED; originals restored in finally):
- Effect wall clock restored: `cargo test -p world-server --test listen_journal_behavior move_after_busy_passes_uses_first_unsealed_durable_generation`.
- Ignore sealed tick in eligible accessor: `cargo test -p world-server --test async_writer_behavior async_writer_rejects_new_command_in_already_sealed_tick`.
- Weaken enqueue minimum to raw clock: same async_writer sealed-tick command.
- Drop late arrivals on durable failure: `cargo test -p world-server --test listen_journal_behavior late_stop_preserves_sealed_move_order_after_success_or_retry`.
- Derive pressure observations from durable clock: `cargo test -p world-server --lib overflow_observation_cancels_only_the_affected_active_write_while_world_busy`.
- Reuse earlier diagnostic stamp for enqueue: `cargo test -p world-server --lib effect_reservation_ignores_diagnostic_stamp_from_before_seal`.
- Wrap successor at terminal tick: `cargo test -p world-server --lib enqueue_rejects_arrival_when_sealed_tick_has_no_successor`.
- Drop late arrivals on durable success: first-eligible MOVE command above.
- Remove only completed-terminal guard: terminal enqueue command above.

Mutation JSON and per-mutation full outputs are in round1-arrival/mutations.json and terminal-mutation.json, plus named .log files. Exact executed harnesses are mutations.py and terminal-mutation.py. They require compilation completion plus an executed failing test verdict, rather than treating any nonzero status as a mutation red. Eight original mutations were also repeated after the terminal extension; all remained compiling reds.

Final checks after final source edit and restored mutations (recorded through worker task.mjs run):
- `cargo fmt --all -- --check`: exit 0, 0.3 s.
- `cargo clippy -p world-server --all-targets -- -D warnings`: exit 0, 3.8 s.
- `cargo test -p world-server`: exit 0, 11.2 s; all library, binary, integration and documentation tests passed. Earlier focused repaired run passed 64 library, 5 async writer and 5 listen journal tests.
- `git diff --cached --check`: exit 0. Staged scope: exactly the four Rust paths in manifest; .tasks excluded from patch.

Environment for Cargo evidence: PATH pinned to node 22.22.2 and ~/.cargo/bin; CARGO_TARGET_DIR=/home/shifty/Work/aigent-place/target, CARGO_INCREMENTAL=0, CARGO_PROFILE_DEV_DEBUG=0, CARGO_PROFILE_TEST_DEBUG=0. Shared target writes have stopped; root must rebuild its integrated tree before final live runtime/hash evidence.

Warm self-pass: read frozen diff against rubric, REVIEW-STANDARDS and applicable ENGINEERING-STANDARDS; no remaining material finding. Accepted ADR-0005/replay v1 already control this behavior, so no ADR/schema amendment. No temporary repository instrumentation or throwaway repository harness remains; external evidence scripts remain outside repository.

Limits: this repairs scheduling after storage resumes; it cannot make an actively blocked durable writer publish movement. Existing listen/demo result-before-durability and other silent effect failure debt remain task-042 scope. This worker did not rerun root live SDK/browser/released-lock acceptance or the full repository gate and did not run cold review; root owns those final recorded steps.
