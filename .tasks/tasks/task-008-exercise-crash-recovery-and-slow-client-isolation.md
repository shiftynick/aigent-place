---
id: task-008
title: Exercise crash recovery and slow-client isolation
status: done
priority: p1
tags: [area:reliability, milestone:world-core]
blockedBy: [task-006, task-007]
createdAt: "2026-07-29T12:45:23Z"
updatedAt: "2026-08-04T19:33:10Z"
---

<!-- task-tracker:description -->
## Description

Build end-to-end recovery and backpressure scenarios across connections, simulation, and persistence. Acceptance: forced process interruption recovers to the documented committed boundary, corrupt or partial tail data fails safely, and slow aigent/viewer clients remain isolated from simulation progress.

<!-- task-tracker:log -->
## Log

- 2026-07-29T12:45:23Z — created (status: backlog)
- 2026-08-04T19:18:37Z — note: rubric: (1) forced interruption recovers to last committed generation boundary (2) uncommitted/corrupt/partial tail fails closed with no live mutation (3) slow aigent/viewer clients cannot stall simulation ticks (4) sustained outbound overflow isolates the slow connection only (5) gates pass
- 2026-08-04T19:18:37Z — moved to in_progress (claimed by shift@Shiftor)
- 2026-08-04T19:21:30Z — note: chose sealed SHA-256 integrity_hex on CommittedGeneration + verify_committed fail-closed on corrupt/gap; recover_from_journal returns Result so live world never mutates from bad history
- 2026-08-04T19:21:30Z — note: docs: no ARCHITECTURE change — §1 and build-order already name crash recovery/slow-client backpressure; behavior covered by reliability_behavior.rs
- 2026-08-04T19:21:30Z — moved to review
- 2026-08-04T19:25:49Z — note: cold-review round1 (rung1 codex): fixed pending params in integrity digest; added incomplete/truncated partial-tail fail-closed + pending tamper test; concurrent undrained mailbox test. Rejected: OS process-crash against SQLite — InMemoryJournal is task-007 skeleton; begin/discard matches ADR-0005 uncommitted-tail. Rejected new ADR: integrity seal implements ADR-0005 corrupt-committed fail-closed. Socket e2e deferred (no transport yet; mailbox/fanout is the isolation boundary).
- 2026-08-04T19:26:08Z — run: cargo test -p world-server
  started 2026-08-04T19:26:06Z, exit 0 in 2.2s
  output tail (truncated to last 30 lines):
  |
  | test result: ok. 6 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.00s
  |
  |
  | running 7 tests
  | test sustained_overflow_disconnects_on_fortieth_tick ... ok
  | test overflow_counter_resets_at_or_below_limit ... ok
  | test mismatched_baseline_requires_resync ... ok
  | test delta_updates_payload_from_generation ... ok
  | test dropped_baseline_resync_preserves_event_stream_and_enqueues ... ok
  | test fanout_observe_closes_slow_connection_without_affecting_world ... ok
  | test mailbox_decouples_tick_from_fanout_drain ... ok
  |
  | test result: ok. 7 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.00s
  |
  |
  | running 0 tests
  |
  | test result: ok. 0 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.00s
  |
  |    Compiling world-server v0.1.0 (N:\aigent-place\crates\world-server)
  |     Finished `test` profile [unoptimized + debuginfo] target(s) in 1.26s
  |      Running unittests src\lib.rs (target\debug\deps\world_server-8b2395def4e5f8a5.exe)
  |      Running unittests src\main.rs (target\debug\deps\world_server-20961b293e18112a.exe)
  |      Running tests\core_behavior.rs (target\debug\deps\core_behavior-27e34be77b07f0f2.exe)
  |      Running tests\reliability_behavior.rs (target\debug\deps\reliability_behavior-ec5ac31ad01948c6.exe)
  |      Running tests\ruleset_persist_behavior.rs (target\debug\deps\ruleset_persist_behavior-8c2280d1b0b92702.exe)
  |      Running tests\session_behavior.rs (target\debug\deps\session_behavior-b33dbd4f25948a60.exe)
  |      Running tests\snapshot_behavior.rs (target\debug\deps\snapshot_behavior-0187fbac67f66f88.exe)
  |    Doc-tests world_server
- 2026-08-04T19:26:53Z — run: node scripts/check.mjs
  started 2026-08-04T19:26:18Z, exit 1 in 35.0s
  output tail (truncated to last 30 lines):
  |   ---
  |   duration_ms: 817.2597
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
  | # duration_ms 33627.1971
  |
  | run-checks: PASS (skill-sync + 18 suites)
  | process-docs: PASS (no unresolved markers in scoped non-binary files)
  | product-check: mode=full
  | product-check: cargo fmt --check
  | Diff in \\?\N:\aigent-place\crates\world-server\tests\reliability_behavior.rs:239:
  |      fanout
  |          .publish_to(b"slow", &published, Some(QUEUE_LIMIT_BYTES + 1))
  |          .unwrap();
  | -    fanout
  | -        .publish_to(b"fast", &published, Some(1024))
  | -        .unwrap();
  | +    fanout.publish_to(b"fast", &published, Some(1024)).unwrap();
  |
  |      for _ in 0..OVERFLOW_TICK_OBSERVATIONS {
  |          let gen = world.advance_tick().unwrap().clone();
  | product-check: FAIL (cargo fmt --all -- --check)
- 2026-08-04T19:30:50Z — run: node scripts/check.mjs
  started 2026-08-04T19:30:16Z, exit 101 in 34.2s
  output tail (truncated to last 30 lines):
  |    = help: to override `-D warnings` add `#[allow(clippy::needless_borrows_for_generic_args)]`
  |
  | error: the borrowed expression implements the required traits
  |   --> crates\world-server\src\persist.rs:42:31
  |    |
  | 42 |                 hasher.update(&(path.len() as u32).to_be_bytes());
  |    |                               ^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^ help: change this to: `(path.len() as u32).to_be_bytes()`
  |    |
  |    = help: for further information visit https://rust-lang.github.io/rust-clippy/master/index.html#needless_borrows_for_generic_args
  |
  | error: the borrowed expression implements the required traits
  |   --> crates\world-server\src\persist.rs:51:27
  |    |
  | 51 |             hasher.update(&(summary.len() as u32).to_be_bytes());
  |    |                           ^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^ help: change this to: `(summary.len() as u32).to_be_bytes()`
  |    |
  |    = help: for further information visit https://rust-lang.github.io/rust-clippy/master/index.html#needless_borrows_for_generic_args
  |
  | error: the borrowed expression implements the required traits
  |   --> crates\world-server\src\persist.rs:58:27
  |    |
  | 58 |             hasher.update(&(lease.aigent_id.len() as u32).to_be_bytes());
  |    |                           ^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^ help: change this to: `(lease.aigent_id.len() as u32).to_be_bytes()`
  |    |
  |    = help: for further information visit https://rust-lang.github.io/rust-clippy/master/index.html#needless_borrows_for_generic_args
  |
  | error: could not compile `world-server` (lib test) due to 4 previous errors
  | warning: build failed, waiting for other jobs to finish...
  | error: could not compile `world-server` (lib) due to 4 previous errors
  | product-check: FAIL (cargo clippy --workspace --all-targets -- -D warnings)
- 2026-08-04T19:33:01Z — run: node scripts/check.mjs
  started 2026-08-04T19:32:15Z, exit 0 in 46.2s
  output tail (truncated to last 30 lines):
  | ✓ 6 modules transformed.
  | rendering chunks...
  | computing gzip size...
  | dist/index.html                   0.54 kB │ gzip:   0.33 kB
  | dist/assets/index-Bz14P-qO.css    0.40 kB │ gzip:   0.29 kB
  | dist/assets/index-C7wmcl1-.js   470.97 kB │ gzip: 118.45 kB │ map: 2,654.73 kB
  | ✓ built in 1.22s
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
  |     Finished `dev` profile [unoptimized + debuginfo] target(s) in 0.13s
  |    Compiling world-server v0.1.0 (N:\aigent-place\crates\world-server)
  |     Finished `test` profile [unoptimized + debuginfo] target(s) in 1.18s
  |      Running unittests src\lib.rs (target\debug\deps\aigent_protocol-86d67fcb42c6c4e6.exe)
  |      Running unittests src\lib.rs (target\debug\deps\world_server-8b2395def4e5f8a5.exe)
  |      Running unittests src\main.rs (target\debug\deps\world_server-20961b293e18112a.exe)
  |      Running tests\core_behavior.rs (target\debug\deps\core_behavior-27e34be77b07f0f2.exe)
  |      Running tests\reliability_behavior.rs (target\debug\deps\reliability_behavior-ec5ac31ad01948c6.exe)
  |      Running tests\ruleset_persist_behavior.rs (target\debug\deps\ruleset_persist_behavior-8c2280d1b0b92702.exe)
  |      Running tests\session_behavior.rs (target\debug\deps\session_behavior-b33dbd4f25948a60.exe)
  |      Running tests\snapshot_behavior.rs (target\debug\deps\snapshot_behavior-0187fbac67f66f88.exe)
  |    Doc-tests aigent_protocol
  |    Doc-tests world_server
- 2026-08-04T19:33:10Z — note: cold-review: rung1 via agent-headless provider=codex (model family GPT, implementer Cursor/Grok). Round1 findings fixed (pending params, partial/incomplete, concurrent). Round2 lease identity digest fixed + fmt. Round3 SPEC only remaining finding was clippy needless_borrows (fixed); STANDARDS PASS. Cap reached; post-cap lint-only fix verified by check.mjs.
- 2026-08-04T19:33:10Z — note: validation: cargo test -p world-server (incl reliability 12); cargo fmt --check; cargo clippy -D warnings; node scripts/check.mjs exit 0
- 2026-08-04T19:33:10Z — moved to done
