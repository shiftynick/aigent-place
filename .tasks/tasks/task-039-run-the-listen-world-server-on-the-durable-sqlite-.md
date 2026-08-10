---
id: task-039
title: Run the --listen world server on the durable SQLite journal
status: done
priority: p1
tags: [area:persistence, phase:debt]
blockedBy: []
createdAt: "2026-08-06T13:16:53Z"
updatedAt: "2026-08-10T08:13:39Z"
---

<!-- task-tracker:description -->
## Description

Debt left by the live-connection-slice milestone. The listen entrypoint builds shared state with TransportState::new_with_options (crates/world-server/src/main.rs:37), which constructs World::new(WorldConfig::default()) (crates/world-server/src/transport.rs:88) and therefore DurableJournal::memory() (crates/world-server/src/world.rs:130-132). DurableJournal::async_sqlite and World::recover_from_journal exist and are covered by crates/world-server/tests/async_writer_behavior.rs and crates/world-server/tests/persist_sqlite_behavior.rs, but no non-test path ever constructs them, so the live demo loses the entire world on every restart and the durable-before-apply contract (ADR-0005) is exercised only in tests. Acceptance: the listen binary takes a journal path (documented default) and builds its world through DurableJournal::async_sqlite plus journal recovery; a recorded run or integration test shows a MOVE lease granted before shutdown is present in the first snapshot served after restart; a corrupt or gapped journal still fails closed at startup; the 20 Hz loop still uses advance_tick_nonblocking/poll_durable and never awaits storage.

<!-- task-tracker:log -->
## Log

- 2026-08-06T13:16:53Z — created (status: backlog)
- 2026-08-10T07:55:42Z — moved to in_progress (claimed by shift@Shiftor)
- 2026-08-10T07:55:57Z — note: Rubric: (1) --listen accepts a documented journal path/default; (2) startup constructs DurableJournal::async_sqlite and recovers before serving; (3) integration evidence proves a granted MOVE lease survives restart into the first snapshot; (4) corrupt or gapped journals fail closed; (5) the 20 Hz loop remains nonblocking via advance_tick_nonblocking/poll_durable; (6) focused tests and the repository gate pass.
- 2026-08-10T08:08:21Z — note: Implementation by Cursor cursor-grok-4.5-high at high effort. Primary verification: focused listen_journal_behavior 3/3 PASS; cargo clippy -p world-server --all-targets -- -D warnings PASS; cargo test -p world-server PASS; CLI --help documents --journal; node scripts/product-check.mjs --fast PASS.
- 2026-08-10T08:08:21Z — moved to review (note: Implementation and fast validation complete; entering separate cold SPEC and STANDARDS reviews.)
- 2026-08-10T08:11:33Z — note: Cold review rung 1: Claude claude-fable-5 low effort. SPEC: NO MATERIAL FINDINGS. STANDARDS raised live runtime persistence failures as MEDIUM and durable-ack wording as LOW. Adjudication: task-042 is the existing dedicated board task for all loop/apply failure branches, typed rejection, diagnostics, and retry distinction; folding it into task-039 would violate one-task-per-branch scope. Current docs state durable-before-install only and do not claim durable-before-acknowledge. Requesting fresh STANDARDS confirmation of this task-boundary adjudication.
- 2026-08-10T08:12:46Z — note: Fresh low-effort STANDARDS adjudication: NO MATERIAL FINDINGS. Confirmed task-042 pre-exists for the complete runtime writer-failure/typed-rejection lifecycle; task-039 startup failures fail closed; pending commands and tentative state remain uninstalled on writer failure; README/ARCHITECTURE claim durable-before-install, not durable-before-acknowledge.
- 2026-08-10T08:13:38Z — note: Final acceptance: node scripts/check.mjs PASS. Process checks and full product gate passed; focused restart/corrupt/gap tests 3/3; Clippy clean; workload combined p95 2399 us with zero overruns. Cold review rung 1: separate SPEC and STANDARDS with claude-fable-5 low effort; final SPEC and adjudicated STANDARDS both NO MATERIAL FINDINGS.
- 2026-08-10T08:13:39Z — moved to done (note: Rubric satisfied; full gate and cold reviews complete.)
