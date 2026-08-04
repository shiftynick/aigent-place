---
id: task-2504442154000001
title: Async durable writer and durable-before-apply tick ordering
status: backlog
priority: p2
tags: [milestone:live-connection-slice, area:persistence]
blockedBy: [task-032]
createdAt: "2026-08-04T20:59:02Z"
updatedAt: "2026-08-04T20:59:02Z"
---

<!-- task-tracker:description -->
## Description

Move generation durability off the simulation stage onto a bounded single-writer queue so the tick never blocks on SQLite, and reorder apply/publish so tentative mutations are not authoritative before durable commit (ADR-0005). Acceptance: slow or locked storage cannot stall the 20 Hz stage; writer failure discards the tentative generation without publishing; focused tests prove both behaviors.

<!-- task-tracker:log -->
## Log

- 2026-08-04T20:59:02Z — created (status: backlog)
