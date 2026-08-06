---
id: task-048
title: Derive the canonical AABB collider from a validated shape tree
status: backlog
priority: p0
tags: [milestone:shape-collision-slice, area:server]
blockedBy: [task-047]
createdAt: "2026-08-06T13:25:08Z"
updatedAt: "2026-08-06T13:25:08Z"
---

<!-- task-tracker:description -->
## Description

Nothing derives collision geometry from a shape. Implement the canonical collider per ADR-0002: the ordered union of one conservative world-axis-aligned bounding box per transformed primitive, sorted by node id. Each AABB is derived analytically from the primitive's local extents and its absolute rotation matrix after parent transforms compose before child transforms. Rendering detail, color, material tags, and joint names must not affect the collider. Provide the aggregate AABB and aggregate horizontal footprint that grounding, placement, and enclosure checks consume. Two AABBs overlap only when their intersection has positive extent on all three axes; face, edge, and point contact are legal. Acceptance: derivation is deterministic and order-stable for a given tree; rotated primitives produce conservative boxes that contain the primitive; the positive-extent overlap rule is exercised at exact face, edge, and point contact and reports no overlap; cosmetic-only tree changes produce a byte-identical collider; product gate green.

<!-- task-tracker:log -->
## Log

- 2026-08-06T13:25:08Z — created (status: backlog)
