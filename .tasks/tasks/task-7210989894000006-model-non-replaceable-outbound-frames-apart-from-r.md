---
id: task-7210989894000006
title: Model non-replaceable outbound frames apart from replaceable state
status: backlog
priority: p3
tags: [area:network, phase:debt]
blockedBy: []
createdAt: "2026-08-06T16:15:38Z"
updatedAt: "2026-08-06T16:15:38Z"
---

<!-- task-tracker:description -->
## Description

Found by cold review during task-041. OutboundQueue has exactly two buckets: replaceable state items (coalesced to the newest) and event bytes (never coalesced). A SnapshotResyncRequired notice is neither: task-041 charges it through enqueue_state with StateKind::Delta so PublishOutcome::ResyncRequired can carry the EnqueueStateOutcome its callers expect. The bytes charged are exact, but if coalescing drops a queued full snapshot the queue relabels the notice StateKind::Full, so its own bookkeeping claims a self-contained snapshot it does not hold. Nothing miscounts today (the connection is left in ResyncRequired, so the next publish sends a full snapshot anyway), but the kind label is a lie waiting to matter. Give control frames their own representation, or let a publish report an enqueue outcome that is not a state item.

<!-- task-tracker:log -->
## Log

- 2026-08-06T16:15:38Z — created (status: backlog)
