---
id: task-006
title: Implement snapshot baselines and full resync
status: backlog
priority: p1
tags: [area:protocol, milestone:world-core]
blockedBy: [task-005, task-018]
createdAt: "2026-07-29T12:45:23Z"
updatedAt: "2026-07-29T13:03:23Z"
---

<!-- task-tracker:description -->
## Description

Implement connection snapshot production outside the simulation stage, per-connection baselines, bounded outbound queues, coalescing, and full-resync recovery. Acceptance: integration tests prove dropped baselines recover, slow connections cannot stall ticks, and sustained overflow follows the documented disconnect contract.

<!-- task-tracker:log -->
## Log

- 2026-07-29T12:45:23Z — created (status: backlog)
- 2026-07-29T13:03:23Z — edited (+blockedBy task-018)
