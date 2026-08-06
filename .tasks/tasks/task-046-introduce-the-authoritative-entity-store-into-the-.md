---
id: task-046
title: Introduce the authoritative entity store into the world core
status: backlog
priority: p0
tags: [milestone:shape-collision-slice, area:server]
blockedBy: []
createdAt: "2026-08-06T13:24:48Z"
updatedAt: "2026-08-06T13:24:48Z"
---

<!-- task-tracker:description -->
## Description

The world core currently holds no spatial entity state: authoritative state is a scalar counter used for replay-equivalence tests, and leases reference a body id that has no position, shape, or revision. Introduce an authoritative entity store holding monotonic entity ids, entity revisions, canonical f64 metre positions, and a shape slot, per ADR-0002 identity and coordinate rules. Ids allocate only on authoritative accept, start at 1, are never reused, and iterate in ascending numeric order. Revisions start at 1 and increment exactly once per accepted externally visible change; rejections and semantic no-ops do not increment. This is the milestone's risk probe: it must not weaken the existing tick machinery. Acceptance: entity state participates in immutable generation publication and generation digests; tentative-tick durable-before-apply ordering still installs only after durable success; same-build replay of a command log still reproduces identical digests with entity state present; out-of-range or non-finite positions are rejected at the boundary; product gate green.

<!-- task-tracker:log -->
## Log

- 2026-08-06T13:24:48Z — created (status: backlog)
