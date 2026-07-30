---
id: task-023
title: Accept heightfield sampling and terrain collision ADR
status: review
priority: p0
tags: [area:architecture, milestone:foundations]
blockedBy: []
createdAt: "2026-07-30T00:11:47Z"
updatedAt: "2026-07-30T00:14:22Z"
---

<!-- task-tracker:description -->
## Description

Review ADR-0003 and explicitly accept it, reject it, or request specific changes. Acceptance unblocks task-010 to finish deterministic grounding, terrain sweep, wake, restore, and conformance behavior; the choice fixes persisted height samples, chunk seams, and authoritative collision geometry.

<!-- task-tracker:log -->
## Log

- 2026-07-30T00:11:47Z — created (status: backlog)
- 2026-07-30T00:11:56Z — note: blocked: awaiting the operator's explicit decision on docs/adr/0003-heightfield-sampling-and-terrain-collision.md
- 2026-07-30T00:11:56Z — moved to blocked
- 2026-07-30T00:14:21Z — edited (-tag needs:operator)
- 2026-07-30T00:14:21Z — note: operator response recorded verbatim: Accept
- 2026-07-30T00:14:21Z — moved to backlog
- 2026-07-30T00:14:22Z — note: rubric: (1) ADR-0003 status and ADR index both record accepted without changing the approved decision text. (2) The operator's exact response is logged and the blocked journal marks the decision condition resolved. (3) Repository diff checks and the full process gate pass, and a cold review finds no acceptance-record contradiction.
- 2026-07-30T00:14:22Z — moved to in_progress (claimed by codex-root)
- 2026-07-30T00:14:22Z — moved to review
