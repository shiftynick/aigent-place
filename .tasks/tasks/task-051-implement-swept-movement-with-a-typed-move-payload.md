---
id: task-051
title: Implement swept movement with a typed MOVE payload
status: backlog
priority: p0
tags: [milestone:shape-collision-slice, area:server]
blockedBy: [task-046, task-049, task-050]
createdAt: "2026-08-06T13:25:34Z"
updatedAt: "2026-08-06T13:25:34Z"
---

<!-- task-tracker:description -->
## Description

Wire MOVE currently maps to an internal lease-upsert harness with no target and no physical effect. Introduce the typed MOVE payload and execute leases as real motion per ADR-0002 and ARCHITECTURE section 3 and 5. Movement sweeps every moving part AABB over the requested segment against terrain columns and every active collider, stopping at the earliest contact with no bounce, push, stacking, or momentum. Zero-length movement succeeds as a no-op when the starting state is legal. Motion is bounded by movement.max_speed_mm_per_s and physics.sweep_max_mm from the live ruleset. Commands resolve in canonical command order and geometry effects are immediately visible to later commands in the same tick. Equal-time blockers are reported by lowest entity id. A lease making no progress for movement.blocked_lease_ticks terminates and reports blocked to the aigent. Acceptance: a body thinner than one tick of travel is not tunnelled through; contact stops motion exactly at the contact surface; two commands in one tick see each other's geometry effects in canonical order; equal-time ties resolve by lowest entity id regardless of iteration order; blocked leases terminate and report a typed reason rather than burning collision work; product gate green.

<!-- task-tracker:log -->
## Log

- 2026-08-06T13:25:34Z — created (status: backlog)
