---
id: task-2748472262000001
title: Implement ADR-0004 terminal revision forced sleep and its recovery diagnostic
status: backlog
priority: p2
tags: [milestone:shape-collision-slice, area:server]
blockedBy: []
createdAt: "2026-08-06T15:00:27Z"
updatedAt: "2026-08-06T15:00:27Z"
---

<!-- task-tracker:description -->
## Description

The entity store (task-046) enforces the externally requested revision capacity rejection (a mutation at revision 18446744073709551614 or greater rejects as REVISION_EXHAUSTED without effect), but it has no active/sleeping lifecycle, so the rest of ADR-0004 is unimplemented. Once sleep state exists (task-052), implement: disconnect at the reserved predecessor cancels leases, sleeps the body, and increments to the terminal revision 18446744073709551615 exactly once; an already-sleeping disconnect is a no-op at every revision; a terminal entity is permanently sleeping and non-colliding, with wake, restore-to-active, movement, set_shape, and unstick rejecting as REVISION_EXHAUSTED; recovery of persisted state holding an ACTIVE terminal-revision entity makes it terminal sleeping without arithmetic, never admits it to the broadphase, records WORLD_RECOVERY_DIAGNOSTIC_CODE_TERMINAL_REVISION_FORCED_SLEEP durably, and publishes WorldEntityReference/WorldRecoveryDiagnostic to active connections. Note that world/v1 CONTRACT.md also permits an exact-pose restore at the predecessor as a non-mutating startup operation while a restore needing displacement must reject before consuming the reserved increment. Acceptance: each bullet has a focused behavioral test; product gate green.

<!-- task-tracker:log -->
## Log

- 2026-08-06T15:00:27Z — created (status: backlog)
