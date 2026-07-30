---
id: task-025
title: Accept durable command replay and persistence backpressure ADR
status: review
priority: p0
tags: [area:architecture, milestone:foundations]
blockedBy: []
createdAt: "2026-07-30T01:31:37Z"
updatedAt: "2026-07-30T11:54:07Z"
---

<!-- task-tracker:description -->
## Description

Review proposed ADR-0005 and explicitly accept, revise, or reject its durable generation boundary, transient persistence backpressure wire behavior, 24-hour idempotency promise, bounded ordered-event retention, framed SQLite recovery rules, and counter-based RNG contract. Acceptance unblocks task-011; no implementation occurs on this card.

<!-- task-tracker:log -->
## Log

- 2026-07-30T01:31:37Z — created (status: backlog)
- 2026-07-30T11:54:07Z — note: rubric: (1) ADR-0005 records the operator's explicit acceptance without altering the proposed decision text. (2) The ADR index reports accepted status and task-011 records that its decision condition is resolved but remains dependency-blocked until delivery completes. (3) Focused document/diff validation and the full repository gate pass, and independent SPEC/STANDARDS review finds no acceptance-record defect.
- 2026-07-30T11:54:07Z — moved to in_progress (claimed by shift@Shiftor)
- 2026-07-30T11:54:07Z — edited (-tag needs:operator)
- 2026-07-30T11:54:07Z — note: operator explicitly accepted ADR-0005 as proposed on 2026-07-30; this task records and delivers that decision.
- 2026-07-30T11:54:07Z — moved to review
