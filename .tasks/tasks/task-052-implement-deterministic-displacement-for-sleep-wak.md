---
id: task-052
title: "Implement deterministic displacement for sleep, wake, restore, and unstick"
status: backlog
priority: p1
tags: [milestone:shape-collision-slice, area:server]
blockedBy: [task-051]
createdAt: "2026-08-06T13:25:34Z"
updatedAt: "2026-08-06T13:25:34Z"
---

<!-- task-tracker:description -->
## Description

Disconnect, wake, restore, and unstick have no geometric behavior. Implement them per ADR-0002. Disconnect cancels active leases before the body becomes sleeping; a sleeping body retains authoritative state but is absent from the broadphase and from all placement overlap and enclosure checks. Wake and restore first test the stored position as if the body were active, and on conflict use the same displacement search as unstick, never ad hoc or random placement. The search takes horizontal candidates offset from the stored origin by integer multiples of movement.displacement_step_mm, derives candidate y by grounding on the heightfield, and excludes candidates outside the world bound or beyond movement.max_displacement_radius_mm. Legal candidates order by squared three-dimensional distance from the stored origin then lexicographically by signed millimetre (x, y, z); the first is authoritative. If no candidate is legal, wake leaves the body sleeping, restore retains it sleeping with a typed recovery condition, and unstick rejects without movement, and the world stays available. Unstick is gated on movement.unstick_blocked_ticks consecutive blocked ticks and rate-limited by movement.unstick_rate_per_minute. Acceptance: the search terminates when boxed in and never loops; results are identical regardless of entity and obstacle iteration order; a successful displacement increments the entity revision, persists, logs, and emits a visible ordered event; wake, restore, and unstick share one observable displacement path; product gate green.

<!-- task-tracker:log -->
## Log

- 2026-08-06T13:25:34Z — created (status: backlog)
