---
id: task-050
title: Implement the uniform spatial-hash broadphase
status: backlog
priority: p1
tags: [milestone:shape-collision-slice, area:server]
blockedBy: [task-048]
createdAt: "2026-08-06T13:25:08Z"
updatedAt: "2026-08-06T13:25:08Z"
---

<!-- task-tracker:description -->
## Description

There is no broadphase, so any collision query would be O(entities) per moving part. Implement the uniform spatial hash described in ARCHITECTURE section 5: sized to the maximum entity bound, rebuilt from the published immutable generation rather than mutated mid-tick. Sleeping bodies live outside the active broadphase set and are absent from overlap and enclosure queries. Iteration over candidates must be by entity id so results never depend on hash order. Acceptance: rebuild happens off the published generation and never mutates live state mid-tick; query results are identical regardless of insertion order; sleeping bodies are excluded from candidate sets; the workload harness reports broadphase rebuild plus query cost inside the 50ms tick budget at the section 1 target of 300 concurrent aigents; product gate green.

<!-- task-tracker:log -->
## Log

- 2026-08-06T13:25:08Z — created (status: backlog)
