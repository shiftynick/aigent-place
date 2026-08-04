---
id: task-033
title: Bridge WebSocket connections into session epochs
status: backlog
priority: p1
tags: [milestone:live-connection-slice, area:network]
blockedBy: [task-031]
createdAt: "2026-08-04T20:36:47Z"
updatedAt: "2026-08-04T20:36:47Z"
---

<!-- task-tracker:description -->
## Description

World server listens for WebSocket clients, performs protocol capability handshake, issues session epochs, stamps decoded mutating commands with arrival_tick, and displaces duplicate aigent command sessions per existing session rules. Socket I/O must not block the simulation stage. Acceptance: a real client can connect and complete handshake; aigent reconnect displaces the prior epoch; malformed envelopes are rejected without stalling ticks; documented listen/bind for local demo.

<!-- task-tracker:log -->
## Log

- 2026-08-04T20:36:47Z — created (status: backlog)
