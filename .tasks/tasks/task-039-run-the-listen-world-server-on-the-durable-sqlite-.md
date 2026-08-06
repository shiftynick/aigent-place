---
id: task-039
title: Run the --listen world server on the durable SQLite journal
status: backlog
priority: p1
tags: [area:persistence, phase:debt]
blockedBy: []
createdAt: "2026-08-06T13:16:53Z"
updatedAt: "2026-08-06T13:16:53Z"
---

<!-- task-tracker:description -->
## Description

Debt left by the live-connection-slice milestone. The listen entrypoint builds shared state with TransportState::new_with_options (crates/world-server/src/main.rs:37), which constructs World::new(WorldConfig::default()) (crates/world-server/src/transport.rs:88) and therefore DurableJournal::memory() (crates/world-server/src/world.rs:130-132). DurableJournal::async_sqlite and World::recover_from_journal exist and are covered by crates/world-server/tests/async_writer_behavior.rs and crates/world-server/tests/persist_sqlite_behavior.rs, but no non-test path ever constructs them, so the live demo loses the entire world on every restart and the durable-before-apply contract (ADR-0005) is exercised only in tests. Acceptance: the listen binary takes a journal path (documented default) and builds its world through DurableJournal::async_sqlite plus journal recovery; a recorded run or integration test shows a MOVE lease granted before shutdown is present in the first snapshot served after restart; a corrupt or gapped journal still fails closed at startup; the 20 Hz loop still uses advance_tick_nonblocking/poll_durable and never awaits storage.

<!-- task-tracker:log -->
## Log

- 2026-08-06T13:16:53Z — created (status: backlog)
