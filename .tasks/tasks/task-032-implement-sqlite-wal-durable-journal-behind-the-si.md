---
id: task-032
title: Implement SQLite WAL durable journal behind the single-writer contract
status: ready
priority: p1
tags: [milestone:live-connection-slice, area:persistence]
blockedBy: []
createdAt: "2026-08-04T20:36:31Z"
updatedAt: "2026-08-04T20:36:57Z"
---

<!-- task-tracker:description -->
## Description

Replace RAM-only durability for the demo/default world binary with SQLite WAL behind the existing single-writer generation journal contract (ADR-0005): admit one generation at a time, commit atomically, fail closed on corruption, recover last committed boundary. Keep an in-memory journal for fast tests. Acceptance: restart recovers last committed generation from SQLite; integrity failures fail closed; tick path still does not await commit; product gate covers the new path.

<!-- task-tracker:log -->
## Log

- 2026-08-04T20:36:31Z — created (status: backlog)
- 2026-08-04T20:36:56Z — note: operator: approved in live-connection-slice; SQLite in this front (not deferred)
- 2026-08-04T20:36:57Z — moved to ready
