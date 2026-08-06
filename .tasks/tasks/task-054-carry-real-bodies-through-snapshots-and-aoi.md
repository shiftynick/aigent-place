---
id: task-054
title: Carry real bodies through snapshots and AOI
status: backlog
priority: p1
tags: [milestone:shape-collision-slice, area:protocol]
blockedBy: [task-046, task-051]
createdAt: "2026-08-06T13:25:52Z"
updatedAt: "2026-08-06T13:25:52Z"
---

<!-- task-tracker:description -->
## Description

Snapshots ship a placeholder body record rather than authoritative entity state. Replace it so snapshots and deltas carry real entity id, revision, fixed-point millimetre position, and shape tree per the protocol envelope in ARCHITECTURE section 4. Deltas must carry explicit enter and leave records, never inferred from absence, and must encode against a numbered baseline the server still retains. Replaceable entity state may coalesce under backpressure; ordered events may not. Real shape trees are substantially larger than the current fixed-size placeholder, so this task must land against accurate outbound byte accounting and live AOI truncation rather than assume them. Acceptance: the viewer decoder contract is updated in lockstep with the server encoder and both are covered by a shared fixture; enter and leave are explicit in deltas; the 100-entity AOI hard cap truncates nearest-first on the live path; per-connection outbound stays within the 256 KiB coalesce threshold at the section 1 target of 500 concurrent viewers; a full resync still installs before hold_observe clears; product gate green.

<!-- task-tracker:log -->
## Log

- 2026-08-06T13:25:52Z — created (status: backlog)
