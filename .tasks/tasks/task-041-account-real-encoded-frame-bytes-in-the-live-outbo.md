---
id: task-041
title: Account real encoded frame bytes in the live outbound drain
status: ready
priority: p2
tags: [area:network, phase:debt]
blockedBy: []
createdAt: "2026-08-06T13:17:20Z"
updatedAt: "2026-08-06T13:26:44Z"
---

<!-- task-tracker:description -->
## Description

Debt left by the live-connection-slice milestone. TransportState::drain_fanout sizes outbound pressure from a provisional envelope whose payload is only the 32-byte generation digest (crates/world-server/src/transport.rs:205-214) and passes that length into SnapshotFanout::publish_to (crates/world-server/src/fanout.rs:239-254), but the frames actually written to the socket carry StubSnapshotPayload::encode_wire, which is 49 bytes plus 40 bytes per active body (crates/world-server/src/transport.rs:225-240 and 871-914, crates/world-server/src/snapshot.rs:60-67 and 87-104). Queue accounting therefore understates real socket bytes by roughly 40 bytes per body per frame, so the 256 KiB / 40-consecutive-tick slow-client disconnect guard (crates/world-server/src/outbound.rs:9-12) under-counts on the only path that has real sockets. The unit tests do not catch it because they pass encoded_bytes = None and get the accurate StubSnapshotPayload::encoded_bytes. Acceptance: the drain accounts the actual encoded length of each frame it hands to a connection; a test with a body count large enough to matter asserts the queued byte total equals the bytes delivered, and that a paused writer crosses the overflow threshold within the documented number of 20 Hz observations.

<!-- task-tracker:log -->
## Log

- 2026-08-06T13:17:20Z — created (status: backlog)
- 2026-08-06T13:26:44Z — moved to ready
