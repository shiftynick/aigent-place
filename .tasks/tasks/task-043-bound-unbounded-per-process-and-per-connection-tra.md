---
id: task-043
title: Bound unbounded per-process and per-connection transport growth
status: backlog
priority: p2
tags: [area:network, phase:debt]
blockedBy: []
createdAt: "2026-08-06T13:17:42Z"
updatedAt: "2026-08-06T13:17:42Z"
---

<!-- task-tracker:description -->
## Description

Debt left by the live-connection-slice milestone. Two structures in the live transport grow without limit. TransportState::stamped_arrivals is a test and observation Vec that is pushed for every admitted command (crates/world-server/src/transport.rs:68, 90, 791-795) and is never drained by any non-test path, so it grows for the lifetime of the process. ConnectionOutbound::seen_client_message_ids is a HashSet holding every client message id ever accepted on a connection (crates/world-server/src/fanout.rs:130, 145; used at crates/world-server/src/transport.rs:679-699), so it grows for the lifetime of each connection. A long-running listen server leaks memory in proportion to total command traffic, which contradicts the sustained-load posture the workload contract assumes. Acceptance: stamped_arrivals is removed from shared state or confined to a test-only surface; duplicate client message_id rejection is preserved under a documented bounded rule (for example a monotonic high-water mark plus a fixed replay window) and still returns INVALID_ENVELOPE inside that window; a test drives a large number of commands on one connection and asserts both structures stay bounded.

<!-- task-tracker:log -->
## Log

- 2026-08-06T13:17:42Z — created (status: backlog)
