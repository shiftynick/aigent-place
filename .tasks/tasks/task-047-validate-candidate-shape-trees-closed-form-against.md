---
id: task-047
title: Validate candidate shape trees closed-form against ruleset budgets
status: backlog
priority: p0
tags: [milestone:shape-collision-slice, area:server]
blockedBy: []
createdAt: "2026-08-06T13:24:48Z"
updatedAt: "2026-08-06T13:24:48Z"
---

<!-- task-tracker:description -->
## Description

The protocol schematizes ShapeTree, ShapeNode, and the six v1 primitives, but the server performs no validation of a candidate shape. Implement closed-form validation of a complete candidate shape tree per ADR-0002: one rooted acyclic tree, unique non-zero node ids, at most one parent per node, normalized unit quaternion rotations, exactly one primitive per node, unique joint names, and strictly positive primitive dimensions except a capsule's cylindrical segment which may be zero and a panel which must have non-zero thickness. Budgets come from the live ruleset generation (shape.body_max_parts, shape.body_max_joints, shape.object_max_parts, shape.object_max_joints, shape.max_extent_mm) and differ for bodies versus placed objects. Validation is all-or-nothing on the complete candidate. Acceptance: shear, non-finite values, non-positive dimensions, duplicate node ids, duplicate joint names, cycles, multiple roots, and budget excess each reject the whole candidate with a typed reason; validation cost is bounded and allocation-free per node beyond the tree itself; a rejected candidate mutates nothing; focused tests cover each reject class; product gate green.

<!-- task-tracker:log -->
## Log

- 2026-08-06T13:24:48Z — created (status: backlog)
