---
id: task-044
title: Apply AOI interest truncation on the live snapshot fan-out path
status: ready
priority: p2
tags: [area:network, phase:debt]
blockedBy: []
createdAt: "2026-08-06T13:17:53Z"
updatedAt: "2026-08-06T13:26:44Z"
---

<!-- task-tracker:description -->
## Description

Debt left by the live-connection-slice milestone. Interest management from task-016 is implemented and unit-tested but never runs on the live path: neither ConnectionOutbound::refresh_interest nor SnapshotFanout::refresh_interest (crates/world-server/src/fanout.rs:150-217) is called anywhere in crates/world-server/src/transport.rs. drain_fanout encodes StubSnapshotPayload::from_generation, which includes every active lease in the world (crates/world-server/src/transport.rs:205, crates/world-server/src/snapshot.rs:41-56), and every connection keeps the default focus at the origin with the default cap (crates/world-server/src/fanout.rs:121, 140-142). Every connected spectator therefore receives every body regardless of the AOI hard cap of 100 and the viewer caps in crates/world-server/src/aoi.rs:10-13, and the enter/leave interest diff is exercised only by unit tests. Acceptance: the drain refreshes each connection interest set before encoding, using the connection body position as focus for aigents and the documented default for viewers, and the emitted payload contains only the truncated set; an integration test with more than AOI_HARD_CAP bodies asserts a connected client receives at most the cap and that bodies leaving the interest set stop appearing.

<!-- task-tracker:log -->
## Log

- 2026-08-06T13:17:53Z — created (status: backlog)
- 2026-08-06T13:26:44Z — moved to ready
