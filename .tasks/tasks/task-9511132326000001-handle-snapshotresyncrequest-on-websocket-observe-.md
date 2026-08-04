---
id: task-9511132326000001
title: Handle SnapshotResyncRequest on WebSocket observe path
status: backlog
priority: p2
tags: [area:network]
blockedBy: []
createdAt: "2026-08-04T22:11:22Z"
updatedAt: "2026-08-04T22:11:22Z"
---

<!-- task-tracker:description -->
## Description

Viewer currently recovers baseline loss by reconnecting. Transport should accept SnapshotResyncRequest and emit a fresh full snapshot without forcing reconnect.

<!-- task-tracker:log -->
## Log

- 2026-08-04T22:11:22Z — created (status: backlog)
