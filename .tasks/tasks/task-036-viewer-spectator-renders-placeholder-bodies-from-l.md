---
id: task-036
title: Viewer spectator renders placeholder bodies from live snapshots
status: backlog
priority: p1
tags: [milestone:live-connection-slice, area:viewer]
blockedBy: [task-034]
createdAt: "2026-08-04T20:36:47Z"
updatedAt: "2026-08-04T20:36:56Z"
---

<!-- task-tracker:description -->
## Description

Browser viewer connects as an anonymous spectator, consumes the live snapshot/delta stream, and renders placeholder geometry for aigent bodies with basic interpolation and resync handling. Full shape grammar is out of scope. Acceptance: documented demo shows a remote scripted aigent's position update in the viewer; disconnect/resync does not permanently freeze the scene; viewer smoke remains in the product gate.

<!-- task-tracker:log -->
## Log

- 2026-08-04T20:36:47Z — created (status: backlog)
- 2026-08-04T20:36:56Z — note: operator: placeholder bodies OK; shape grammar deferred to later milestone
