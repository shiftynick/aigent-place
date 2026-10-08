---
id: task-042
title: Stop silently discarding failures in the 20 Hz listen loop
status: backlog
priority: p2
tags: [area:reliability, phase:debt]
blockedBy: []
createdAt: "2026-08-06T13:17:31Z"
updatedAt: "2026-10-08T16:36:15Z"
---

<!-- task-tracker:description -->
## Description

Debt left by the live-connection-slice milestone. The listen loop swallows every error it can hit: durable poll failures (crates/world-server/src/transport.rs:375-381), advance_tick_nonblocking failures (crates/world-server/src/transport.rs:382-394), and world enqueue failures in apply_world_effect, including the stale-arrival-tick retry whose result is discarded (crates/world-server/src/transport.rs:852-863). The binary emits nothing after the startup banner (crates/world-server/src/main.rs:38-45), so a persistently failing journal or a rejected command effect is invisible to the operator. The enqueue case is a correctness gap, not only an operability one: SessionHub has already returned an authoritative Accepted result to the client (crates/world-server/src/transport.rs:797-818) before the effect is dropped, so a MOVE can be acknowledged and never reach the world. Acceptance: every failure branch in the loop and in apply_world_effect emits a diagnostic naming tick, connection, and error, and repeated failures are distinguishable from a single retry; a command whose world effect cannot be enqueued does not report Accepted to the client; a test covers the dropped-effect case and asserts the client sees a typed rejection instead.

<!-- task-tracker:log -->
## Log

- 2026-08-06T13:17:31Z — created (status: backlog)
- 2026-08-10T08:12:46Z — note: Task-039 cold review inventory update: after async SQLite becomes the live --listen path, include the second poll_durable call inside the Submitted/Busy arm (current transport.rs near the if let Ok(Some(...)) branch); it can silently discard a same-tick writer error in addition to the top-of-loop and advance branches already listed.
- 2026-10-08T14:11:34Z — note: Audit 2026-10-08 @4e3e070 confirms ignored enqueue/drain/writer errors in the live path: Accepted can precede dropped effects. Keep correlated typed failure/admission and diagnostics as the bounded first step; broader durable replay redesign remains separate.
- 2026-10-08T16:10:46Z — note: Task064 cold r1 exposed newly expanded reconnect/Busy canonical-tuple collision. Task064 now replaces the listen effect swallows with local admission before new-result caching, atomic spawn/effect preflight against pending and tentative.remaining_pending, stable typed Conflict, and uncached internal fatal close. Root integrated patch52d715369143426bbdad75de689afa25da8f8f2ca150483e6078dadfa1b366ac; focused worker regressions/mutations/crate gates pass, finalroot runtime/gate/coldreview pending. Reconcile this fixed enqueue subset after protected task064 delivery. Durable poll/advance/drain diagnostics, global writer-failure lifecycle and durable-before-result delivery remain open; do not mark042done.
- 2026-10-08T16:36:15Z — note: Scope reconciliation after independent r2 source review: task-064 repairs only local queue admission and atomic spawn/effect rejection, pending protected delivery. This card retains loop writer/drain failure diagnostics and visible global writer failure handling. Full durable-before-result publication and restart reconstruction of sequence/idempotency outcomes are now explicit task-6036971654000001 work; task-042 alone must not be reported as implementing ADR 0005 durable replay.
