---
id: task-042
title: Stop silently discarding failures in the 20 Hz listen loop
status: backlog
priority: p2
tags: [area:reliability, phase:debt]
blockedBy: []
createdAt: "2026-08-06T13:17:31Z"
updatedAt: "2026-08-06T13:17:31Z"
---

<!-- task-tracker:description -->
## Description

Debt left by the live-connection-slice milestone. The listen loop swallows every error it can hit: durable poll failures (crates/world-server/src/transport.rs:375-381), advance_tick_nonblocking failures (crates/world-server/src/transport.rs:382-394), and world enqueue failures in apply_world_effect, including the stale-arrival-tick retry whose result is discarded (crates/world-server/src/transport.rs:852-863). The binary emits nothing after the startup banner (crates/world-server/src/main.rs:38-45), so a persistently failing journal or a rejected command effect is invisible to the operator. The enqueue case is a correctness gap, not only an operability one: SessionHub has already returned an authoritative Accepted result to the client (crates/world-server/src/transport.rs:797-818) before the effect is dropped, so a MOVE can be acknowledged and never reach the world. Acceptance: every failure branch in the loop and in apply_world_effect emits a diagnostic naming tick, connection, and error, and repeated failures are distinguishable from a single retry; a command whose world effect cannot be enqueued does not report Accepted to the client; a test covers the dropped-effect case and asserts the client sees a typed rejection instead.

<!-- task-tracker:log -->
## Log

- 2026-08-06T13:17:31Z — created (status: backlog)
