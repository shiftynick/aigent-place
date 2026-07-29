---
id: task-007
title: Implement ruleset activation and ordered persistence
status: backlog
priority: p1
tags: [area:core, milestone:world-core]
blockedBy: [task-005]
createdAt: "2026-07-29T12:45:23Z"
updatedAt: "2026-07-29T12:45:23Z"
---

<!-- task-tracker:description -->
## Description

Implement validated ruleset loading with tick-boundary activation and the single-writer event/snapshot persistence pipeline. Acceptance: tests prove activation is atomic at a tick boundary, invalid rulesets do not change live state, persisted ordering matches canonical simulation order, and restart reconstruction preserves the last committed world generation.

<!-- task-tracker:log -->
## Log

- 2026-07-29T12:45:23Z — created (status: backlog)
