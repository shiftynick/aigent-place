---
id: task-018
title: Implement connection sessions and authoritative command results
status: backlog
priority: p0
tags: [area:protocol, milestone:world-core]
blockedBy: [task-004]
createdAt: "2026-07-29T13:03:23Z"
updatedAt: "2026-07-29T13:03:23Z"
---

<!-- task-tracker:description -->
## Description

Implement server-side handshake and feature negotiation, one live session epoch per aigent body, duplicate-session displacement, monotonic command sequencing, idempotency-key replay, and authoritative typed results/rejections. Acceptance: integration tests cover reconnect, stale epochs, duplicate connections, duplicate keys, gaps/reordering, unsupported features, and every mutating command receiving exactly one stable outcome.

<!-- task-tracker:log -->
## Log

- 2026-07-29T13:03:23Z — created (status: backlog)
