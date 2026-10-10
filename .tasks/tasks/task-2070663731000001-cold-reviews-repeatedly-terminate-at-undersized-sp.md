---
id: task-2070663731000001
title: Cold reviews repeatedly terminate at undersized spending caps
status: backlog
priority: p3
tags: [area:process, phase:retrospective, needs:operator]
blockedBy: []
createdAt: "2026-10-10T06:33:21Z"
updatedAt: "2026-10-10T06:33:21Z"
---

<!-- task-tracker:description -->
## Description

Cold-review cap termination repeated in three independent completed tasks: task-064 (six-dollar per-axis cap, incomplete wrapper exit1/139.3s; fresh twelve-dollar retry completed), task-068 (twelve-dollar cap, exit1/99.5s; eighteen-dollar retry completed), and task-071 (three-dollar documentary delta cap, exit1/30.9s; six-dollar retry completed). Total recorded incomplete wrapper time is269.7s; no aggregate monetary loss is inferred. The governing point is Execute Task’s cold-review reference, Dispatch preset: both harness copies illustrate a three-dollar cap without sizing guidance. The example is not proof that it caused the chosen caps.

Proposed exact addition immediately after that preset: “Choose the per-axis spending cap from the packet size and recent completed review costs. The example’s $3 is illustrative. A cap termination leaves the axis incomplete.”

This is a queued mold proposal requiring operator approval before implementation. Acceptance: retain useful spending caps, complete review context and incomplete-axis handling; add the same approved wording to both harness copies; perform ordinary rubric, cold review and relevant gates; verify skill synchronization; record any implemented generic divergence and upstream treatment in the existing Foundry local-changes record. Do not treat this card as approval, a fixed higher spending mandate, or part of a sixth product round.

<!-- task-tracker:log -->
## Log

- 2026-10-10T06:33:21Z — created (status: backlog)
