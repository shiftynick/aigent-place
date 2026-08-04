---
id: task-035
title: Script an aigent connect and move-lease path
status: backlog
priority: p1
tags: [milestone:live-connection-slice, area:sdk]
blockedBy: [task-033, task-034]
createdAt: "2026-08-04T20:36:47Z"
updatedAt: "2026-08-04T20:36:47Z"
---

<!-- task-tracker:description -->
## Description

Provide a reproducible scripted aigent (SDK or harness) that connects over WebSocket, completes handshake, issues move leases with sequence and idempotency keys, and prints authoritative results or typed rejections. Acceptance: documented one-command local run against a listening world-server moves a body across ticks; replay of the same idempotency key returns the original result; gate or focused test covers the happy path.

<!-- task-tracker:log -->
## Log

- 2026-08-04T20:36:47Z — created (status: backlog)
