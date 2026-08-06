---
id: task-041
title: Account real encoded frame bytes in the live outbound drain
status: done
priority: p2
tags: [area:network, phase:debt]
blockedBy: []
createdAt: "2026-08-06T13:17:20Z"
updatedAt: "2026-08-06T23:50:28Z"
---

<!-- task-tracker:description -->
## Description

Debt left by the live-connection-slice milestone. TransportState::drain_fanout sizes outbound pressure from a provisional envelope whose payload is only the 32-byte generation digest (crates/world-server/src/transport.rs:205-214) and passes that length into SnapshotFanout::publish_to (crates/world-server/src/fanout.rs:239-254), but the frames actually written to the socket carry StubSnapshotPayload::encode_wire, which is 49 bytes plus 40 bytes per active body (crates/world-server/src/transport.rs:225-240 and 871-914, crates/world-server/src/snapshot.rs:60-67 and 87-104). Queue accounting therefore understates real socket bytes by roughly 40 bytes per body per frame, so the 256 KiB / 40-consecutive-tick slow-client disconnect guard (crates/world-server/src/outbound.rs:9-12) under-counts on the only path that has real sockets. The unit tests do not catch it because they pass encoded_bytes = None and get the accurate StubSnapshotPayload::encoded_bytes. Acceptance: the drain accounts the actual encoded length of each frame it hands to a connection; a test with a body count large enough to matter asserts the queued byte total equals the bytes delivered, and that a paused writer crosses the overflow threshold within the documented number of 20 Hz observations.

<!-- task-tracker:log -->
## Log

- 2026-08-06T13:17:20Z — created (status: backlog)
- 2026-08-06T13:26:44Z — moved to ready
- 2026-08-06T15:40:11Z — note: rubric: (1) on the live drain path (drain_fanout(None)) a connection's queued outbound bytes equal the exact byte length of the frame its socket receives, for a generation whose interest set fills the AOI hard cap; (2) the frame is sized and written from the same server message id and the same payload, so no digest-only provisional envelope is encoded or charged; (3) delta frames on the socket path are charged their real encoded length instead of the 32-byte logical stand-in; (4) with its writer paused, a connection reaches the 256 KiB coalesce threshold after the number of drains its real delivered frame bytes imply (derived from the socket, +/-1 frame) and is not disconnected by that coalescing; (5) fixed-size overrides (drain_fanout(Some(n))) and the logical publish_to / client_resync sizing keep current behaviour and the full product gate passes.
- 2026-08-06T15:40:18Z — moved to in_progress (claimed by shift@Shiftor)
- 2026-08-06T15:45:55Z — run: cargo test -p world-server --test outbound_pressure_accounting
  started 2026-08-06T15:45:51Z, exit 101 in 4.6s
  output tail (truncated to last 30 lines):
  | thread 'queued_bytes_equal_the_snapshot_frame_the_socket_receives' panicked at crates\world-server\tests\outbound_pressure_accounting.rs:215:5:
  | assertion `left == right` failed: outbound pressure must be charged the bytes the socket actually received
  |   left: 51
  |  right: 4072
  | note: run with `RUST_BACKTRACE=1` environment variable to display a backtrace
  |
  | ---- delta_frames_are_charged_their_wire_bytes stdout ----
  |
  | thread 'delta_frames_are_charged_their_wire_bytes' panicked at crates\world-server\tests\outbound_pressure_accounting.rs:250:5:
  | assertion `left == right` failed: a delta must be charged its encoded frame, not a logical stand-in
  |   left: 51
  |  right: 4072
  |
  | ---- paused_writer_reaches_the_coalesce_threshold_on_its_real_frame_bytes stdout ----
  |
  | thread 'paused_writer_reaches_the_coalesce_threshold_on_its_real_frame_bytes' panicked at crates\world-server\tests\outbound_pressure_accounting.rs:298:37:
  | a paused writer must reach the 256 KiB threshold once it is charged the bytes it owes
  |
  |
  | failures:
  |     delta_frames_are_charged_their_wire_bytes
  |     paused_writer_reaches_the_coalesce_threshold_on_its_real_frame_bytes
  |     queued_bytes_equal_the_snapshot_frame_the_socket_receives
  |
  | test result: FAILED. 0 passed; 3 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.07s
  |
  |    Compiling world-server v0.1.0 (N:\aigent-place\.claude\worktrees\wf_540eed4f-57d-1\crates\world-server)
  |     Finished `test` profile [unoptimized + debuginfo] target(s) in 3.81s
  |      Running tests\outbound_pressure_accounting.rs (target\debug\deps\outbound_pressure_accounting-e3df7fb824350619.exe)
  | error: test failed, to rerun pass `-p world-server --test outbound_pressure_accounting`
- 2026-08-06T15:46:28Z — run: cargo test -p world-server
  started 2026-08-06T15:46:12Z, exit 0 in 15.1s
  output tail (truncated to last 30 lines):
  | test websocket_reconnect_closes_displaced_socket ... ok
  |
  | test result: ok. 4 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.01s
  |
  |
  | running 0 tests
  |
  | test result: ok. 0 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.00s
  |
  |    Compiling world-server v0.1.0 (N:\aigent-place\.claude\worktrees\wf_540eed4f-57d-1\crates\world-server)
  |     Finished `test` profile [unoptimized + debuginfo] target(s) in 8.00s
  |      Running unittests src\lib.rs (target\debug\deps\world_server-2d7c22779d6e15e7.exe)
  |      Running unittests src\main.rs (target\debug\deps\world_server-9df5988638f82bfa.exe)
  |      Running tests\aoi_behavior.rs (target\debug\deps\aoi_behavior-49d2af617aab8541.exe)
  |      Running tests\async_writer_behavior.rs (target\debug\deps\async_writer_behavior-ecb874bd312ef40d.exe)
  |      Running tests\core_behavior.rs (target\debug\deps\core_behavior-6198f984276ce85a.exe)
  |      Running tests\feature_intersection_behavior.rs (target\debug\deps\feature_intersection_behavior-02eb438a23b9049c.exe)
  |      Running tests\live_aoi_behavior.rs (target\debug\deps\live_aoi_behavior-59dfc1b5dc474ab3.exe)
  |      Running tests\outbound_drain_behavior.rs (target\debug\deps\outbound_drain_behavior-dba27bd415f1fdef.exe)
  |      Running tests\outbound_pressure_accounting.rs (target\debug\deps\outbound_pressure_accounting-e3df7fb824350619.exe)
  |      Running tests\persist_sqlite_behavior.rs (target\debug\deps\persist_sqlite_behavior-c4d71245086ff896.exe)
  |      Running tests\placeholder_payload_behavior.rs (target\debug\deps\placeholder_payload_behavior-5f159efe4496d0c4.exe)
  |      Running tests\reliability_behavior.rs (target\debug\deps\reliability_behavior-7aed9c4b0ea57898.exe)
  |      Running tests\ruleset_persist_behavior.rs (target\debug\deps\ruleset_persist_behavior-20763967ad007f17.exe)
  |      Running tests\scripted_aigent_behavior.rs (target\debug\deps\scripted_aigent_behavior-868f771fe2f3b29c.exe)
  |      Running tests\session_behavior.rs (target\debug\deps\session_behavior-5b3200c9a1bae821.exe)
  |      Running tests\snapshot_behavior.rs (target\debug\deps\snapshot_behavior-38ee57e411957cb0.exe)
  |      Running tests\snapshot_resync_behavior.rs (target\debug\deps\snapshot_resync_behavior-9021b8921bdbaa8b.exe)
  |      Running tests\transport_behavior.rs (target\debug\deps\transport_behavior-514083eccfaa7205.exe)
  |    Doc-tests world_server
- 2026-08-06T15:48:07Z — note: implementation: introduced StateSizing (Payload | Fixed | Frame) plus StateFrameShape in fanout.rs instead of the Option<usize> byte hint. The fan-out owns payload selection but only the transport knows the envelope framing that reaches a socket, so the socket path passes StateSizing::Frame(&measure) and the fan-out asks it for the exact length of the frame it is about to write. publish_to and client_resync keep their Option<usize> signatures via StateSizing::logical, so the workload harness, the conformance oracles, and the existing pressure fixtures are behaviourally unchanged.
- 2026-08-06T15:48:08Z — note: implementation: drain_fanout now mints one server message id per connection per pass and uses it for both the sizing and the written frame, so the two encodings are byte-identical; the digest-only provisional envelope (and the second message id it burned) are gone. Sizing uses prost's encoded_len on the same Envelope shape the writer builds (shared server_envelope helper) rather than a second serialization. Each state item is sized against the baseline id its frame will carry, including the id a coalesce-promotion would assign, so a promoted full snapshot is also charged its real bytes.
- 2026-08-06T15:48:08Z — note: implementation: StateSizing::Frame holds a &(dyn Fn + Sync). The Sync bound is load-bearing: drain_fanout holds the sizing across the fanout mutex await, and without it the 20 Hz simulation future stops being Send and tokio::spawn will not compile.
- 2026-08-06T15:48:21Z — note: acceptance deviation, with evidence: the card asks the new test to assert that a paused writer 'crosses the overflow threshold within the documented number of 20 Hz observations'. That is unreachable once the accounting is correct, and the same ARCHITECTURE section 1 line says why: a frame is bounded by the AOI hard cap (100 bodies, 4072 bytes measured), and OutboundQueue::enqueue_state coalesces replaceable state to the newest item as soon as the candidate total passes 256 KiB, so queued state can never stay over the limit for 40 consecutive observations on snapshot pressure alone. 40 observations x 4072 bytes is also only 163 KB. The test therefore asserts the observable the fix actually moves: the queue reaches the 256 KiB coalesce threshold after the number of drains its measured delivered frame implies (65 of 4072 bytes), and the connection is not disconnected by that coalescing. Reachability of the disconnect itself is filed as task-7210989894000002 rather than fixed here.
- 2026-08-06T15:48:21Z — note: out-of-scope discoveries filed: task-7210989894000001 (client-resync frame still sized without its envelope), task-7210989894000002 (what can still trigger the sustained-overflow disconnect), task-7210989894000003 (resync-required notice charged a delta frame it never sends), task-7210989894000004 (unreferenced SnapshotFanout::drain_mailbox).
- 2026-08-06T15:48:56Z — note: documentation check: no product or operator documentation change is needed. ARCHITECTURE section 1 already specifies the 256 KiB per-connection outbound queue in socket bytes and section 2 already names OutboundQueue as its owner; this change makes the code match that contract rather than changing it. The new behaviour is documented at the point of use (drain_fanout and StateSizing doc comments) and asserted in crates/world-server/tests/outbound_pressure_accounting.rs.
- 2026-08-06T15:48:56Z — moved to review
- 2026-08-06T15:51:29Z — note: cost trade recorded: in the Frame sizing mode the delta path measures both the delta frame and the full frame (the size a coalesce-promotion would charge), so a publish encodes the stub payload twice for sizing plus once for the frame it writes, instead of the previous tiny provisional plus one real encode. Measuring lazily would mean changing OutboundQueue::enqueue_state's full_encoded_bytes parameter into a closure, which would churn the workload harness and snapshot_behavior call sites for a stub payload bounded at about 4 KB by the AOI hard cap, off the simulation stage. Chose the explicit version; revisit if the workload harness ever measures serialization cost.
- 2026-08-06T15:51:29Z — note: cold review: ladder rung 1 (separate CLI, different model family). Transport agent-headless 0.15-vendored runtime, provider codex, codex-cli 0.145.0 (GPT-5.x family), access inspect (read-only), effort high, SPEC and STANDARDS dispatched as two independent calls with no conversation history.
- 2026-08-06T16:03:33Z — run: cargo test -p world-server --test outbound_pressure_accounting
  started 2026-08-06T16:03:25Z, exit 101 in 8.0s
  output tail (truncated to last 30 lines):
  | assertion `left == right` failed: a delta must be charged its encoded frame, not a logical stand-in
  |   left: 51
  |  right: 4072
  |
  | ---- paused_writer_reaches_the_coalesce_threshold_on_its_real_frame_bytes stdout ----
  |
  | thread 'paused_writer_reaches_the_coalesce_threshold_on_its_real_frame_bytes' panicked at crates\world-server\tests\outbound_pressure_accounting.rs:312:37:
  | a paused writer must reach the 256 KiB threshold once it is charged the bytes it owes
  |
  | ---- coalescing_charges_the_promoted_full_snapshot_it_writes stdout ----
  |
  | thread 'coalescing_charges_the_promoted_full_snapshot_it_writes' panicked at crates\world-server\tests\outbound_pressure_accounting.rs:373:5:
  | assertion `left == right` failed: the baseline frame must be charged the bytes it puts on the wire
  |   left: 51
  |  right: 4072
  |
  |
  | failures:
  |     a_resync_notice_is_charged_instead_of_the_delta_it_replaces
  |     coalescing_charges_the_promoted_full_snapshot_it_writes
  |     delta_frames_are_charged_their_wire_bytes
  |     paused_writer_reaches_the_coalesce_threshold_on_its_real_frame_bytes
  |     queued_bytes_equal_the_snapshot_frame_the_socket_receives
  |
  | test result: FAILED. 1 passed; 5 failed; 0 ignored; 0 measured; 0 filtered out; finished in 3.78s
  |
  |    Compiling world-server v0.1.0 (N:\aigent-place\.claude\worktrees\wf_540eed4f-57d-1\crates\world-server)
  |     Finished `test` profile [unoptimized + debuginfo] target(s) in 3.64s
  |      Running tests\outbound_pressure_accounting.rs (target\debug\deps\outbound_pressure_accounting-e3df7fb824350619.exe)
  | error: test failed, to rerun pass `-p world-server --test outbound_pressure_accounting`
- 2026-08-06T16:04:04Z — note: review round 1 adjudication (both axes, codex/GPT-5.x, rung 1). CONFIRMED and fixed: (a) SPEC-1 payload race - the drain took the fanout lock twice, so a client resync landing between publish and encode could replace last_payload and make the charged frame differ from the written one; publish and encode now happen under one lock with no await between them. (b) SPEC-2 / STANDARDS-1 resync-required notice - my frame sizing had turned a roughly accurate 32-byte charge into a ~4 KB charge for a ~30-byte notice, a regression I introduced; SnapshotChannel::delta_rejection now decides before anything is charged, and the notice is charged its own encoded envelope. Filed task-7210989894000003 was therefore removed as fixed here rather than deferred. (c) STANDARDS-3 the promotion branch was untested - added coalescing_charges_the_promoted_full_snapshot_it_writes, and verified by mutation that replacing the promoted size with payload.encoded_bytes() fails it (4049 vs 4072). (d) STANDARDS-4 drain_mailbox advertised a frame-sizing mode it cannot serve (one measurer is bound to a single connection's envelope and message id) - its parameter is back to Option<usize> with the constraint documented. (e) STANDARDS-2 no proof the production sizing path keeps ticks moving - added production_sizing_drain_does_not_delay_logical_ticks with four stuck writers on drain_fanout(None). (f) SPEC-3 / STANDARDS-5 full gate not yet recorded - it runs after this fix round, as docs/SDLC.md validation phase 2 requires.
- 2026-08-06T16:15:55Z — note: review round 2 adjudication (both axes, codex/GPT-5.x, rung 1). CONFIRMED and fixed: (a) STANDARDS-2 the non-blocking test was too weak - it now bounds twenty production-sizing drains by the twenty ticks of 50 ms budget they consume and reports the worst single pass, instead of an arbitrary five-second ceiling. (b) STANDARDS-5 newly public plumbing - StateSizing, StateFrameShape, StateSizing::logical, publish_interest_to, delta_rejection and require_resync are now pub(crate) and dropped from the lib re-exports, so no external caller can bypass byte pressure with Frame(|_| 0) or flip a channel to ResyncRequired out of band. (c) STANDARDS-3 second half - the deliberate ordering (a rejected baseline now outranks the coalesce promotion) is documented at the branch, including what it supersedes and why pushing a notice beats pushing a fresh full snapshot into an over-limit queue. CONFIRMED but filed rather than fixed: (d) STANDARDS-1 (high) coalescing resets the fan-out's replaceable state without withdrawing frames already handed to the socket task's bounded buffer, so after a coalesce the queue accounts one frame while the connection can still owe up to sixteen - real, bounded by OUTBOUND_CHANNEL_CAP plus the pending deque, and a divergence between the queue model and the transport buffer rather than a sizing error; fixing it means deciding what coalescing means on the socket side, which is task-7210989894000005. The test module now states this scope boundary explicitly rather than implying the queue totals every byte still owed. (e) STANDARDS-3 first half - a notice charged as StateKind::Delta can be relabelled Full by coalescing; the bytes stay exact and the connection is already in ResyncRequired, so nothing miscounts, but the label is wrong: task-7210989894000006. SPEC round 2 returned a single finding, the unrecorded full gate, which runs next.
- 2026-08-06T16:17:35Z — run: node scripts/check.mjs
  started 2026-08-06T16:16:30Z, exit 0 in 65.6s
  output tail (truncated to last 30 lines):
  |      Running tests\persist_sqlite_behavior.rs (target\debug\deps\persist_sqlite_behavior-c4d71245086ff896.exe)
  |      Running tests\placeholder_payload_behavior.rs (target\debug\deps\placeholder_payload_behavior-5f159efe4496d0c4.exe)
  |      Running tests\reliability_behavior.rs (target\debug\deps\reliability_behavior-7aed9c4b0ea57898.exe)
  |      Running tests\ruleset_persist_behavior.rs (target\debug\deps\ruleset_persist_behavior-20763967ad007f17.exe)
  |      Running tests\scripted_aigent_behavior.rs (target\debug\deps\scripted_aigent_behavior-868f771fe2f3b29c.exe)
  |      Running tests\session_behavior.rs (target\debug\deps\session_behavior-5b3200c9a1bae821.exe)
  |      Running tests\snapshot_behavior.rs (target\debug\deps\snapshot_behavior-38ee57e411957cb0.exe)
  |      Running tests\snapshot_resync_behavior.rs (target\debug\deps\snapshot_resync_behavior-9021b8921bdbaa8b.exe)
  |      Running tests\transport_behavior.rs (target\debug\deps\transport_behavior-514083eccfaa7205.exe)
  |    Doc-tests aigent_protocol
  |    Doc-tests protocol_conformance
  |    Doc-tests workload_harness
  |    Doc-tests world_server
  | npm notice run @aigent-place/protocol@0.1.0 test
  | npm notice run node --test ./test/binary-conformance.test.mjs
  | npm notice run @aigent-place/aigent-sdk@0.1.0 test
  | npm notice run node --test ./test/sdk-exports.test.mjs
  | npm notice run aigent-place@0.1.0 viewer:build
  | npm notice run npm run build -w @aigent-place/viewer
  | npm notice run @aigent-place/viewer@0.1.0 build
  | npm notice run vite build
  |
  | (!) Some chunks are larger than 500 kB after minification. Consider:
  | - Using dynamic import() to code-split the application
  | - Use build.rollupOptions.output.manualChunks to improve chunking: https://rollupjs.org/configuration-options/#output-manualchunks
  | - Adjust chunk size limit for this warning via build.chunkSizeWarningLimit.
  | npm notice run aigent-place@0.1.0 viewer:smoke
  | npm notice run npm run smoke -w @aigent-place/viewer
  | npm notice run @aigent-place/viewer@0.1.0 smoke
  | npm notice run node ./scripts/smoke.mjs
- 2026-08-06T16:26:58Z — note: review round 3 adjudication (both axes, codex/GPT-5.x, rung 1; this is the three-round cap in the cold-review protocol). SPEC-1 CONFIRMED and answered: checking delta_rejection before the coalesce promotion does change ordering for the logical and fixed sizing modes too, so rubric line 5's 'unchanged behaviour' claim needed qualifying rather than defending. Making the ordering depend on the sizing mode would be worse (two semantics for one publish), so the ordering stands for every mode and the deviation is recorded here: what changed is which frame an unusable baseline answers with when the queue is at its limit, never the bytes any mode charges for a frame it does write. Writing the test for that corner produced better evidence than the finding assumed: a notice is about 21 bytes, so adding it to a queue one frame under the 256 KiB limit cannot cross it, and the promotion branch the new ordering outranks is only reachable when the queue is within a few bytes of the limit. an_unusable_baseline_answers_with_a_notice_under_load now covers the loaded case and the code comment states the real reachability. The full gate, which runs the workload harness and the conformance oracles on the logical paths, passes.
- 2026-08-06T16:26:59Z — note: review round 3 adjudication, second finding. STANDARDS-1 (high) CONFIRMED in part: spawn_simulation_loop does await drain_fanout between ticks, so serialization spends tick budget, and four connections is not the 300-aigent target. That the drain sits on the tick path is task-034's design, not something this task introduced; what this task changed is its cost. ARCHITECTURE section 1 says workload targets are measured by the load harness rather than assumed, and the harness does not drive drain_fanout at all today, so the scale question is filed as task-7210989894000007 rather than faked with a four-connection integration test. What was strengthened here: the test now also counts passes that reach the 50 ms tick budget and fails when more than one does, so a systematic breach cannot hide behind an aggregate bound while a single descheduled pass does not flake the gate. Unresolved risk surfaced: the drain's cost at 300 connections is unmeasured, and the redundant sizing encodes named in the task-7210989894000007 description are the first thing to remove if that measurement is unfavourable.
- 2026-08-06T16:28:32Z — run: node scripts/check.mjs
  started 2026-08-06T16:27:29Z, exit 0 in 63.7s
  output tail (truncated to last 30 lines):
  |      Running tests\persist_sqlite_behavior.rs (target\debug\deps\persist_sqlite_behavior-c4d71245086ff896.exe)
  |      Running tests\placeholder_payload_behavior.rs (target\debug\deps\placeholder_payload_behavior-5f159efe4496d0c4.exe)
  |      Running tests\reliability_behavior.rs (target\debug\deps\reliability_behavior-7aed9c4b0ea57898.exe)
  |      Running tests\ruleset_persist_behavior.rs (target\debug\deps\ruleset_persist_behavior-20763967ad007f17.exe)
  |      Running tests\scripted_aigent_behavior.rs (target\debug\deps\scripted_aigent_behavior-868f771fe2f3b29c.exe)
  |      Running tests\session_behavior.rs (target\debug\deps\session_behavior-5b3200c9a1bae821.exe)
  |      Running tests\snapshot_behavior.rs (target\debug\deps\snapshot_behavior-38ee57e411957cb0.exe)
  |      Running tests\snapshot_resync_behavior.rs (target\debug\deps\snapshot_resync_behavior-9021b8921bdbaa8b.exe)
  |      Running tests\transport_behavior.rs (target\debug\deps\transport_behavior-514083eccfaa7205.exe)
  |    Doc-tests aigent_protocol
  |    Doc-tests protocol_conformance
  |    Doc-tests workload_harness
  |    Doc-tests world_server
  | npm notice run @aigent-place/protocol@0.1.0 test
  | npm notice run node --test ./test/binary-conformance.test.mjs
  | npm notice run @aigent-place/aigent-sdk@0.1.0 test
  | npm notice run node --test ./test/sdk-exports.test.mjs
  | npm notice run aigent-place@0.1.0 viewer:build
  | npm notice run npm run build -w @aigent-place/viewer
  | npm notice run @aigent-place/viewer@0.1.0 build
  | npm notice run vite build
  |
  | (!) Some chunks are larger than 500 kB after minification. Consider:
  | - Using dynamic import() to code-split the application
  | - Use build.rollupOptions.output.manualChunks to improve chunking: https://rollupjs.org/configuration-options/#output-manualchunks
  | - Adjust chunk size limit for this warning via build.chunkSizeWarningLimit.
  | npm notice run aigent-place@0.1.0 viewer:smoke
  | npm notice run npm run smoke -w @aigent-place/viewer
  | npm notice run @aigent-place/viewer@0.1.0 smoke
  | npm notice run node ./scripts/smoke.mjs
- 2026-08-06T16:28:49Z — note: DISTILL: added one lens to docs/REVIEW-STANDARDS.md - for a budget, quota, or backpressure guard, verify the charged quantity is derived from the same artifact the system releases, because a provisional or logical stand-in on the live path diverges silently while the accurate value is exactly what the test paths exercise. That is this defect verbatim, and task-044 was the same shape one task earlier (interest truncation existed but nothing on the live path called it), so the class recurs.
- 2026-08-06T16:28:49Z — note: final state: the diff changed after round 3 (the notice-under-load test, the tick-budget pass count, one comment correction, and the distilled lens), which the protocol's three-round cap anticipates - remaining findings are logged and filed rather than re-reviewed. Follow-ups filed: task-7210989894000001 client-resync envelope overhead, task-7210989894000002 what can still trigger the sustained-overflow disconnect, task-7210989894000004 unreferenced drain_mailbox, task-7210989894000005 coalescing does not withdraw already-buffered socket frames, task-7210989894000006 control frames modelled as replaceable state, task-7210989894000007 drain cost against the tick budget at workload scale.
- 2026-08-06T16:28:56Z — moved to done
- 2026-08-06T23:49:42Z — note: rebase integration onto task-046 (merged as f4280e1): outbound_pressure_accounting.rs builds ImmutableGeneration as a struct literal and stopped compiling once the entity store added entities + next_entity_id (E0063). Fixture now passes an empty table and FIRST_ENTITY_ID, with a comment recording that frame bytes derive from the lease-backed placeholder payload rather than the entity table, so an empty table is correct rather than convenient. Compiler-verified; no change to the sizing logic under review.
- 2026-08-06T23:50:28Z — run: node scripts/check.mjs
  started 2026-08-06T23:49:42Z, exit 0 in 46.2s
  output tail (truncated to last 30 lines):
  |      Running tests\ruleset_persist_behavior.rs (target\debug\deps\ruleset_persist_behavior-20763967ad007f17.exe)
  |      Running tests\scripted_aigent_behavior.rs (target\debug\deps\scripted_aigent_behavior-868f771fe2f3b29c.exe)
  |      Running tests\session_behavior.rs (target\debug\deps\session_behavior-5b3200c9a1bae821.exe)
  |      Running tests\shape_budget_catalog_contract.rs (target\debug\deps\shape_budget_catalog_contract-a0488f49834a77ed.exe)
  |      Running tests\shape_validation_behavior.rs (target\debug\deps\shape_validation_behavior-887d963556dfabd7.exe)
  |      Running tests\shape_validation_bounded_cost.rs (target\debug\deps\shape_validation_bounded_cost-f5eb5f21bc801b3b.exe)
  |      Running tests\snapshot_behavior.rs (target\debug\deps\snapshot_behavior-38ee57e411957cb0.exe)
  |      Running tests\snapshot_resync_behavior.rs (target\debug\deps\snapshot_resync_behavior-9021b8921bdbaa8b.exe)
  |      Running tests\transport_behavior.rs (target\debug\deps\transport_behavior-514083eccfaa7205.exe)
  |    Doc-tests aigent_protocol
  |    Doc-tests protocol_conformance
  |    Doc-tests workload_harness
  |    Doc-tests world_server
  | npm notice run @aigent-place/protocol@0.1.0 test
  | npm notice run node --test ./test/binary-conformance.test.mjs
  | npm notice run @aigent-place/aigent-sdk@0.1.0 test
  | npm notice run node --test ./test/sdk-exports.test.mjs
  | npm notice run aigent-place@0.1.0 viewer:build
  | npm notice run npm run build -w @aigent-place/viewer
  | npm notice run @aigent-place/viewer@0.1.0 build
  | npm notice run vite build
  |
  | (!) Some chunks are larger than 500 kB after minification. Consider:
  | - Using dynamic import() to code-split the application
  | - Use build.rollupOptions.output.manualChunks to improve chunking: https://rollupjs.org/configuration-options/#output-manualchunks
  | - Adjust chunk size limit for this warning via build.chunkSizeWarningLimit.
  | npm notice run aigent-place@0.1.0 viewer:smoke
  | npm notice run npm run smoke -w @aigent-place/viewer
  | npm notice run @aigent-place/viewer@0.1.0 smoke
  | npm notice run node ./scripts/smoke.mjs
