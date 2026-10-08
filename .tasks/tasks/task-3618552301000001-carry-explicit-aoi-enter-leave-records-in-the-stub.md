---
id: task-3618552301000001
title: Carry explicit AOI enter/leave records in the stub observe payload
status: done
priority: p1
tags: [area:network, phase:debt, deleted:true]
blockedBy: []
createdAt: "2026-08-06T14:26:33Z"
updatedAt: "2026-10-08T02:41:58Z"
---

<!-- task-tracker:description -->
## Description

task-044 activated an ARCHITECTURE invariant gap that was previously dormant, and this task closes it. ARCHITECTURE 'Message families' requires delta percepts to carry explicit enter/leave records and never infer departure from absence. Before task-044 the stub payload listed every active lease, so a body's absence unambiguously meant its lease had ended and the viewer's remove-what-is-missing rule (apps/viewer/src/main.js) was sound. Now that SnapshotFanout::publish_interest_to truncates to the AOI cap, a body can vanish from the payload merely by leaving the interest set, and the viewer despawns it. publish_interest_to already computes the InterestDiff and discards it, so the data exists. Acceptance: the stub placeholder payload (PLACEHOLDER_VERSION bumped, encoder and decoder updated on both the Rust and viewer sides) carries the enter and leave sets from the interest refresh; the viewer distinguishes 'left my AOI' from 'despawned'; a test asserts a body that leaves the interest set is reported as a leave rather than inferred from absence. Coordinate with task-045, which covers viewer-decoder-versus-server-encoder conformance.

<!-- task-tracker:log -->
## Log

- 2026-08-06T14:26:33Z — created (status: backlog)
- 2026-08-06T14:45:28Z — edited (priority p2→p1)
- 2026-08-06T14:45:40Z — edited (description updated)
- 2026-10-08T02:41:58Z — note: Superseded by completed task-054 in PR #69. The live observe path now carries explicit entered/modified/left_ids real-body transitions, with shared fixtures and actual-viewer behavioral checks; no live browser path depends on stub absence-as-leave. Retire this duplicate card by soft deletion; no separate implementation remains.
- 2026-10-08T02:41:58Z — removed (soft delete)
