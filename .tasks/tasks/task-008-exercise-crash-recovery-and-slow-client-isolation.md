---
id: task-008
title: Exercise crash recovery and slow-client isolation
status: backlog
priority: p1
tags: [area:reliability, milestone:world-core]
blockedBy: [task-006, task-007]
createdAt: "2026-07-29T12:45:23Z"
updatedAt: "2026-07-29T12:45:23Z"
---

<!-- task-tracker:description -->
## Description

Build end-to-end recovery and backpressure scenarios across connections, simulation, and persistence. Acceptance: forced process interruption recovers to the documented committed boundary, corrupt or partial tail data fails safely, and slow aigent/viewer clients remain isolated from simulation progress.

<!-- task-tracker:log -->
## Log

- 2026-07-29T12:45:23Z — created (status: backlog)
