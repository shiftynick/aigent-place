---
id: task-049
title: Implement heightfield sampling and grounding
status: backlog
priority: p1
tags: [milestone:shape-collision-slice, area:server]
blockedBy: [task-048]
createdAt: "2026-08-06T13:25:08Z"
updatedAt: "2026-08-06T13:25:08Z"
---

<!-- task-tracker:description -->
## Description

Bodies have no terrain to rest on, so no position is grounded. Implement the heightfield and grounding per ADR-0003: each 64 metre chunk owns a regular lattice of signed integer millimetre height samples with a constitutional heightfield_cell_size_mm that exactly divides 64000. Generation from (world_seed, global_sample_x, global_sample_z) must produce identical heights on both sides of a chunk seam. The canonical terrain collider for a cell is a world-axis-aligned column whose horizontal bounds are the cell bounds, whose lower bound is the negative world y limit, and whose top is the maximum of its four corner samples. Cells are half-open on positive x and z edges except cells touching the positive world boundary. A footprint selects every cell with positive horizontal intersection. Grounding computes the entity's aggregate horizontal footprint, selects intersected columns, and translates the entity so its aggregate lower face equals the greatest selected column top, leaving horizontal position unchanged. Terrain generation only; chunk persistence and edits are out of scope. Acceptance: seam samples are identical from both adjacent chunks; grounding on non-flat terrain rests on the maximum column top, not an average or a corner; boundary cells follow the half-open rule so seam order cannot change the candidate set; product gate green.

<!-- task-tracker:log -->
## Log

- 2026-08-06T13:25:08Z — created (status: backlog)
