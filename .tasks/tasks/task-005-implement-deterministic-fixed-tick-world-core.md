---
id: task-005
title: Implement deterministic fixed-tick world core
status: backlog
priority: p0
tags: [area:core, milestone:world-core]
blockedBy: [task-004, task-014]
createdAt: "2026-07-29T12:45:23Z"
updatedAt: "2026-07-29T12:55:20Z"
---

<!-- task-tracker:description -->
## Description

Implement the authoritative 20 Hz simulation skeleton with canonical command ordering, seeded randomness, bounded movement leases, and immutable generations handed to downstream snapshot work. Acceptance: behavioral tests prove tick progression, order independence from arrival/scheduler order, lease expiry, and same-build replay equivalence.

<!-- task-tracker:log -->
## Log

- 2026-07-29T12:45:23Z — created (status: backlog)
- 2026-07-29T12:55:20Z — edited (+blockedBy task-014)
