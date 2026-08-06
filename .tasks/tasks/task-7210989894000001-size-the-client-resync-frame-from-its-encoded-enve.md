---
id: task-7210989894000001
title: Size the client-resync frame from its encoded envelope
status: backlog
priority: p3
tags: [area:network, phase:debt]
blockedBy: []
createdAt: "2026-08-06T15:47:08Z"
updatedAt: "2026-08-06T15:47:08Z"
---

<!-- task-tracker:description -->
## Description

TransportState::deliver_client_resync charges SnapshotFanout::client_resync with encoded_bytes = None, so the queue is charged StubSnapshotPayload::encoded_bytes (the stub wire payload) while the socket receives that payload wrapped in a protocol Envelope. The live path therefore still undercounts a client-requested resync by the envelope overhead (about 21 bytes at protocol v1). task-041 fixed the same class of defect for the observe drain by giving SnapshotFanout::publish_interest_to a StateSizing::Frame measurer; client_resync kept its Option<usize> logical sizing because its three callers (protocol-conformance and two world-server tests) size logically. Make the resync path measure the frame it writes, using the same StateSizing type, and assert queued bytes equal the delivered frame length as crates/world-server/tests/outbound_pressure_accounting.rs does for observe traffic.

<!-- task-tracker:log -->
## Log

- 2026-08-06T15:47:08Z — created (status: backlog)
