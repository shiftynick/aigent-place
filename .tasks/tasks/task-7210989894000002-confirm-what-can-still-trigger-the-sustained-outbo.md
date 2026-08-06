---
id: task-7210989894000002
title: Confirm what can still trigger the sustained-outbound-overflow disconnect
status: backlog
priority: p2
tags: [area:network, phase:debt]
blockedBy: []
createdAt: "2026-08-06T15:47:38Z"
updatedAt: "2026-08-06T15:47:38Z"
---

<!-- task-tracker:description -->
## Description

Discovered while fixing task-041. Now that the live drain charges real encoded frame bytes, snapshot state alone can no longer sustain the ARCHITECTURE section 1 disconnect. A frame is bounded by the AOI hard cap (100 bodies, about 4 KB encoded), and OutboundQueue::enqueue_state coalesces replaceable state to the newest item as soon as the candidate total exceeds 256 KiB, so queued state settles back to roughly one frame and over_limit_ticks resets long before 40 consecutive observations. The disconnect is therefore reachable only through non-coalescable event bytes (OutboundQueue::enqueue_event, fed by command results in TransportState::handle_command_envelope). crates/world-server/tests/outbound_pressure_accounting.rs asserts the coalesce-threshold crossing and that it does not disconnect; crates/world-server/tests/outbound_drain_behavior.rs still proves the disconnect only through the fixed-size drain_fanout(Some(n)) fixture, which no production path uses. Decide whether that is the intended reading of the degradation ladder, and either add end-to-end coverage that a paused writer accumulating real event bytes is closed within OVERFLOW_TICK_OBSERVATIONS, or record the coalescing bound explicitly in ARCHITECTURE section 1 so the guard is not read as a snapshot-pressure guard.

<!-- task-tracker:log -->
## Log

- 2026-08-06T15:47:38Z — created (status: backlog)
