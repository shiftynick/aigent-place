---
id: task-7210989894000005
title: Withdraw superseded frames when outbound state coalesces
status: backlog
priority: p2
tags: [area:network, phase:debt]
blockedBy: []
createdAt: "2026-08-06T16:15:38Z"
updatedAt: "2026-08-06T16:15:38Z"
---

<!-- task-tracker:description -->
## Description

Found by cold review during task-041. Coalescing lives in OutboundQueue (crates/world-server/src/outbound.rs), but the frames it declares superseded have usually already been handed to the socket task: TransportState::try_deliver puts them in a bounded mpsc channel (OUTBOUND_CHANNEL_CAP = 8) and then a bounded pending deque (8 more, oldest evicted). When enqueue_state coalesces, the fan-out's replaceable state resets to one item while the socket still writes every frame already buffered, so after a coalesce the queue accounts one frame and the connection can still owe up to sixteen. The divergence is bounded by those buffers and is conservative in neither direction (pending eviction also drops frames the queue still counts). task-041 made this reachable in practice, because with real frame bytes a stuck writer now reaches the 256 KiB threshold in about 65 drains instead of thousands. Decide what 'coalesce' means on the socket side: either the transport drops superseded state frames from its own buffer when a publish reports enqueue.coalesced (command results and other non-replaceable frames must survive), or the accounting takes the buffered frames into account. crates/world-server/tests/outbound_pressure_accounting.rs documents the current scope boundary in its module comment.

<!-- task-tracker:log -->
## Log

- 2026-08-06T16:15:38Z — created (status: backlog)
