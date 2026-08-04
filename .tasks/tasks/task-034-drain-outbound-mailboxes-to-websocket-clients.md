---
id: task-034
title: Drain outbound mailboxes to WebSocket clients
status: backlog
priority: p1
tags: [milestone:live-connection-slice, area:network]
blockedBy: [task-033]
createdAt: "2026-08-04T20:36:47Z"
updatedAt: "2026-08-04T20:36:47Z"
---

<!-- task-tracker:description -->
## Description

Wire fan-out observe paths so snapshot baselines, deltas, authoritative results, and typed errors reach connected sockets as versioned protocol envelopes, respecting per-connection encoded byte caps and slow-client isolation (overflow disconnect without stalling sim). Acceptance: connected aigent and viewer roles receive observe traffic on the wire; sustained overflow isolates only the slow connection; product tests or harness prove non-blocking drain under load pressure.

<!-- task-tracker:log -->
## Log

- 2026-08-04T20:36:47Z — created (status: backlog)
