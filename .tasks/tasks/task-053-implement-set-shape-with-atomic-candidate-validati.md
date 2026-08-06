---
id: task-053
title: Implement set_shape with atomic candidate validation
status: backlog
priority: p1
tags: [milestone:shape-collision-slice, area:server]
blockedBy: [task-048, task-051]
createdAt: "2026-08-06T13:25:34Z"
updatedAt: "2026-08-06T13:25:34Z"
---

<!-- task-tracker:description -->
## Description

SetShapePayload exists in the protocol but has no server implementation. Implement set_shape per ADR-0002: validate the complete candidate tree and its derived collider at the body's current pose, then apply atomically. Any failure, including overlap with an active body or object, leaves the prior shape, position, and revision entirely unchanged. The server never partially applies a shape and never auto-displaces a body to make a rejected shape fit. Success increments the entity revision exactly once and is visible to later commands in the same tick in canonical order. Acceptance: a candidate that overlaps geometry is rejected with a typed reason and the prior shape survives byte-identically; a rejected candidate does not increment the revision; a valid candidate applies atomically and increments the revision exactly once; body budgets rather than object budgets are enforced; product gate green.

<!-- task-tracker:log -->
## Log

- 2026-08-06T13:25:34Z — created (status: backlog)
