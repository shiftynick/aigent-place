---
id: task-052
title: "Implement deterministic displacement for sleep, wake, restore, and unstick"
status: backlog
priority: p1
tags: [milestone:shape-collision-slice, area:server]
blockedBy: [task-051]
createdAt: "2026-08-06T13:25:34Z"
updatedAt: "2026-10-08T16:48:03Z"
---

<!-- task-tracker:description -->
## Description

Disconnect, wake, restore, and unstick have no geometric behavior. Implement them per ADR-0002. Disconnect cancels active leases before the body becomes sleeping; a sleeping body retains authoritative state but is absent from the broadphase and from all placement overlap and enclosure checks. Wake and restore first test the stored position as if the body were active, and on conflict use the same displacement search as unstick, never ad hoc or random placement. The search takes horizontal candidates offset from the stored origin by integer multiples of movement.displacement_step_mm, derives candidate y by grounding on the heightfield, and excludes candidates outside the world bound or beyond movement.max_displacement_radius_mm. Legal candidates order by squared three-dimensional distance from the stored origin then lexicographically by signed millimetre (x, y, z); the first is authoritative. If no candidate is legal, wake leaves the body sleeping, restore retains it sleeping with a typed recovery condition, and unstick rejects without movement, and the world stays available. Unstick is gated on movement.unstick_blocked_ticks consecutive blocked ticks and rate-limited by movement.unstick_rate_per_minute. Acceptance: the search terminates when boxed in and never loops; results are identical regardless of entity and obstacle iteration order; a successful displacement increments the entity revision, persists, logs, and emits a visible ordered event; wake, restore, and unstick share one observable displacement path; product gate green.

<!-- task-tracker:log -->
## Log

- 2026-08-06T13:25:34Z — created (status: backlog)
- 2026-10-08T14:11:33Z — note: Audit 2026-10-08 @4e3e070: active_shaped_body_ids and DraftCollisionView infer sleep from absence of movement leases. A connected aigent reaching a goal, stopping, blocking or expiring a lease becomes non-colliding without disconnecting. This card must separate awake/sleep lifecycle from active intent and cover a connected stationary-body collision regression.
- 2026-10-08T15:19:57Z — note: Round-1 independent runtime observation at integrated task-064: passive snapshots continued from x1050 to x1500 after the scripted SDK process closed successfully. This is evidence of post-disconnect motion only; collision/sleep state was not inspected. Include listener disconnect-to-sleep integration in this existing lifecycle task. Exact trace is improvement-loop-2026-10-08/round1-runtime/retry-fresh/observer.log, with SDK launch/exit metadata; no task-052 completion claim.
- 2026-10-08T16:48:03Z — note: Completed task-064 cold r2 reports the unchanged Unstick skeleton accepts payload bytes without validation or effects. Preserve typed Unstick payload and eligibility rejection coverage alongside the lifecycle work.
