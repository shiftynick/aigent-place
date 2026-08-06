---
id: task-2929451841000001
title: Apply the aggregate shape extent bound where the collider is derived
status: backlog
priority: p1
tags: [milestone:shape-collision-slice, area:server]
blockedBy: []
createdAt: "2026-08-06T14:57:28Z"
updatedAt: "2026-08-06T14:57:28Z"
---

<!-- task-tracker:description -->
## Description

task-047 validates candidate shape trees and applies shape.max_extent_mm as a per-primitive local extent bound, because the aggregate bound requires composed parent-before-child transforms and the per-node AABB that task-048 owns. world/v1/CONTRACT.md section 4.2 requires a candidate to fit the active ruleset's 'primitive and aggregate bounds' and ARCHITECTURE.md section 6 names the budget 'bounding box', so the aggregate half is still unenforced: a tree of individually legal primitives spread by large translations currently passes shape validation. Once the canonical aggregate AABB exists, reject a candidate whose aggregate AABB extent exceeds shape.max_extent_mm on any axis, using the same all-or-nothing typed rejection as world_server::ShapeRejection (add an AggregateExtentBudgetExceeded variant rather than reusing the per-primitive one, so the two bounds stay distinguishable). Decide at that point whether world/v1/CONTRACT.md should be amended to state explicitly which granularity shape.max_extent_mm binds at; if the answer changes the semantics rather than clarifying them, it needs an ADR. Acceptance: a tree whose primitives are each within budget but whose aggregate AABB is not rejects with the aggregate reason; the per-primitive bound in crates/world-server/src/shape.rs still rejects independently; body and object classes both exercised.

<!-- task-tracker:log -->
## Log

- 2026-08-06T14:57:28Z — created (status: backlog)
