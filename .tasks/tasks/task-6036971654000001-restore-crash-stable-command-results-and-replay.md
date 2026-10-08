---
id: task-6036971654000001
title: Restore crash-stable command results and replay
status: backlog
priority: p1
tags: [area:reliability, phase:debt]
blockedBy: []
createdAt: "2026-10-08T16:35:59Z"
updatedAt: "2026-10-08T16:35:59Z"
---

<!-- task-tracker:description -->
## Description

The live listen path delivers authoritative Accepted and Rejected outcomes before durable commit and keeps sequence cursors and idempotency results only in SessionHub memory. Accepted effects can be lost after a writer error followed by a crash; existing IdempotencyConflict and the local-admission Conflict added in task-064 can become Accepted after restart. Implement accepted ADR 0005 command-result publication and recovery without changing its contract. Acceptance: accepted and rejected exact-next outcomes, cursor updates and key mappings commit together before client delivery; a crash before commit exposes no authoritative outcome; restart after commit reconstructs sequence and cross-epoch key replay, including cached Conflict; same-payload retries return the original result while different payloads preserve the original-key outcome and return IdempotencyConflict; writer failure prevents further undurable results and permits recovery only through the documented verified restart path. Use controlled writer/crash schedules and compiling behavioral mutations. This is deferred reliability work discovered during the five-round program, not completed by task-064; decomposition must remain small enough for fresh-context execution.

<!-- task-tracker:log -->
## Log

- 2026-10-08T16:35:59Z — created (status: backlog)
