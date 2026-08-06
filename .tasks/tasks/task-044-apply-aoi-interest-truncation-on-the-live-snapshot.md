---
id: task-044
title: Apply AOI interest truncation on the live snapshot fan-out path
status: done
priority: p2
tags: [area:network, phase:debt]
blockedBy: []
createdAt: "2026-08-06T13:17:53Z"
updatedAt: "2026-08-06T14:48:10Z"
---

<!-- task-tracker:description -->
## Description

Debt left by the live-connection-slice milestone. Interest management from task-016 is implemented and unit-tested but never runs on the live path: neither ConnectionOutbound::refresh_interest nor SnapshotFanout::refresh_interest (crates/world-server/src/fanout.rs:150-217) is called anywhere in crates/world-server/src/transport.rs. drain_fanout encodes StubSnapshotPayload::from_generation, which includes every active lease in the world (crates/world-server/src/transport.rs:205, crates/world-server/src/snapshot.rs:41-56), and every connection keeps the default focus at the origin with the default cap (crates/world-server/src/fanout.rs:121, 140-142). Every connected spectator therefore receives every body regardless of the AOI hard cap of 100 and the viewer caps in crates/world-server/src/aoi.rs:10-13, and the enter/leave interest diff is exercised only by unit tests. Acceptance: the drain refreshes each connection interest set before encoding, using the connection body position as focus for aigents and the documented default for viewers, and the emitted payload contains only the truncated set; an integration test with more than AOI_HARD_CAP bodies asserts a connected client receives at most the cap and that bodies leaving the interest set stop appearing.

<!-- task-tracker:log -->
## Log

- 2026-08-06T13:17:53Z — created (status: backlog)
- 2026-08-06T13:26:44Z — moved to ready
- 2026-08-06T14:19:47Z — note: rubric: (1) TransportState::drain_fanout refreshes each connection's interest set before encoding, so a connected viewer in a world with more than AOI_HARD_CAP active leases receives exactly 100 bodies on the wire instead of every lease. (2) The delivered body ids equal a nearest-first ranking derived independently in the test from the generation's authoritative lease table and the connection's focus, not by calling the production AOI ranking function. (3) An aigent connection ranks against its own body's live pose (own body first) and its delivered set differs from the origin-focused viewer set; the aigent's body id is learned from the world's own lease table, not from a re-implemented id mapping. (4) Bodies that drop out of the interest set stop appearing in the following delta payload on the same connection. (5) A client-requested resync baseline carries the same truncated set, so resync cannot bypass the hard cap. (6) cargo test for world-server plus protocol-conformance, workload-harness, and the full node scripts/check.mjs gate stay green.
- 2026-08-06T14:19:53Z — moved to in_progress (claimed by shift@Shiftor)
- 2026-08-06T14:25:51Z — run: cargo test -p world-server
  started 2026-08-06T14:25:40Z, exit 0 in 11.6s
  output tail (truncated to last 30 lines):
  | test websocket_reconnect_closes_displaced_socket ... ok
  | test malformed_post_handshake_closes_without_blocking_logical_ticks ... ok
  |
  | test result: ok. 4 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.01s
  |
  |
  | running 0 tests
  |
  | test result: ok. 0 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.00s
  |
  |    Compiling world-server v0.1.0 (N:\aigent-place\.claude\worktrees\wf_2fce973e-e55-1\crates\world-server)
  |     Finished `test` profile [unoptimized + debuginfo] target(s) in 5.69s
  |      Running unittests src\lib.rs (target\debug\deps\world_server-2d7c22779d6e15e7.exe)
  |      Running unittests src\main.rs (target\debug\deps\world_server-9df5988638f82bfa.exe)
  |      Running tests\aoi_behavior.rs (target\debug\deps\aoi_behavior-49d2af617aab8541.exe)
  |      Running tests\async_writer_behavior.rs (target\debug\deps\async_writer_behavior-ecb874bd312ef40d.exe)
  |      Running tests\core_behavior.rs (target\debug\deps\core_behavior-6198f984276ce85a.exe)
  |      Running tests\feature_intersection_behavior.rs (target\debug\deps\feature_intersection_behavior-02eb438a23b9049c.exe)
  |      Running tests\live_aoi_behavior.rs (target\debug\deps\live_aoi_behavior-59dfc1b5dc474ab3.exe)
  |      Running tests\outbound_drain_behavior.rs (target\debug\deps\outbound_drain_behavior-dba27bd415f1fdef.exe)
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
- 2026-08-06T14:26:51Z — note: design: kept SnapshotFanout::publish_to untruncated and added publish_interest_to for connection fan-out. The workload harness and the protocol conformance oracles drive interest from their own candidate catalog and then publish; forcing truncation into publish_to would have re-ranked their payloads against placeholder lease poses they do not use. drain_mailbox now uses publish_interest_to too (it had no callers), so no fan-out entry point bypasses the cap.
- 2026-08-06T14:26:51Z — note: design: focus tracking reads the focus body's lease straight out of ImmutableGeneration.active_leases (a BTreeMap keyed by body_id, so O(log n)) rather than scanning the candidate vector. A focus body with no live lease keeps the previous focus instead of snapping back to the origin. hold_observe is checked before the interest refresh so a held connection never records an interest set it was not sent.
- 2026-08-06T14:26:51Z — note: design: client_resync now truncates too, otherwise a SnapshotResyncRequest would hand a client the whole world past the cap. SnapshotChannel::request_resync was removed rather than re-signatured: once the caller supplies the truncated payload it was a pure alias of install_full, and it had exactly one caller.
- 2026-08-06T14:26:51Z — note: design: refresh_interest returns Result, so the drain needs an answer for AoiError (reachable today only through a zero viewer_aoi_cap). Added PublishOutcome::InterestUnavailable, which queues nothing and puts nothing on the wire - failing closed rather than falling back to an untruncated payload that would breach the hard cap.
- 2026-08-06T14:26:51Z — note: filed follow-up task-3618552301000001: the stub payload still has no enter/leave records, so a truncated body is indistinguishable from a despawned one - which ARCHITECTURE 'Message families' forbids for delta percepts. Out of scope here; publish_interest_to already computes the diff for it to use.
- 2026-08-06T14:27:25Z — moved to review
- 2026-08-06T14:30:54Z — run: node scripts/check.mjs
  started 2026-08-06T14:29:59Z, exit 0 in 54.8s
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
- 2026-08-06T14:31:11Z — note: perf: publish_interest_to rebuilds the candidate list per connection per drain. That is the same O(connections x bodies) shape the previous code already paid, because publish_to called StubSnapshotPayload::from_generation per connection too; the per-connection allocation actually shrinks, since the payload now holds at most 100 bodies instead of every lease. Hoisting candidate construction out of the drain loop would need a signature change across the fan-out seam, so it is left for the workload-tuning work rather than folded into this wiring task.
- 2026-08-06T14:32:19Z — note: cold review: ladder rung 1 (separate CLI, different model family). Transport agent-headless, provider codex, codex-cli 0.145.0, GPT-5.x family, access inspect, effort high, two independent read-only calls with no conversation history. SPEC returned one medium finding: the packet showed only cargo test -p world-server, so rubric line 6's other gates were unverifiable from it. Adjudicated correct-on-the-packet but stale: node scripts/check.mjs (which runs the Rust suites, protocol-conformance, workload-harness, protocol codegen freshness, TypeScript conformance, and the viewer build and smoke) was executed after the packet export and is recorded in this log at exit 0. No code change required.
- 2026-08-06T14:38:31Z — note: cold review round 1, STANDARDS axis (rung 1, codex-cli 0.145.0): three findings, all confirmed against live files. (1) med - AoiError swallowed at both boundaries, so an unusable AOI policy starves a client silently. Fixed the half this task owns: DrainReport now carries interest_unavailable, a typed (connection, AoiError) list, and drain_fanout records the skipped connection there instead of dropping it. The client_resync half needs a wider return type that ripples into the protocol-conformance gate oracle and snapshot_behavior, so it is filed as task-3618552301000002 rather than absorbed. (2) med - the socket resync test was a vacuous oracle: it asserted len <= cap against an empty world, which passes even if the handler sends everything. Rewritten to drive two real aigent MOVEs into the authoritative world and lower the viewer policy cap to 1, then assert the wire payload equals the single derived survivor and excludes the other body. (3) low - the zero-cap test never exercised recovery. It now restores VIEWER_AOI_CAPS[2] and asserts delivery resumes with a fresh full baseline carrying exactly the restored cap's truncated set.
- 2026-08-06T14:38:31Z — note: red-capability evidence: with crates/world-server/src stashed, 5 of the 6 new tests failed against the original live path. The rewritten socket resync oracle was separately falsified by a targeted mutation - reverting client_resync to StubSnapshotPayload::from_generation made both resync tests fail, the wire one on [5025827462638657142, 17864257541300775489] against the derived expectation [5025827462638657142]. The mutation was reverted before validation.
- 2026-08-06T14:40:55Z — run: node scripts/check.mjs
  started 2026-08-06T14:40:03Z, exit 0 in 51.4s
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
- 2026-08-06T14:42:31Z — note: cold review round 2 (rung 1, codex-cli 0.145.0, two independent read-only calls). SPEC returned one medium finding, again the same packet-freshness artifact: the packet was exported before the gate re-run finished, so rubric line 6's non-Rust gates were unverifiable from it. Adjudicated correct-on-the-packet and now resolved by evidence - node scripts/check.mjs was re-run on this exact revision after the review fixes and fmt/clippy, recorded at exit 0 in 51.4s, and nothing in the diff changed afterward. No code change required. SPEC confirmed rubric lines 1-5 directly against the revised diff, including the rewritten socket-resync oracle.
- 2026-08-06T14:46:53Z — note: cold review round 2, STANDARDS axis: three findings, all confirmed. (1) med - enter/leave. Round 1 said this change did not make the pre-existing gap worse; round 2 disagreed and round 2 is right. Before this change a body's absence from the payload unambiguously meant its lease ended, so the viewer's remove-what-is-missing rule was sound; truncation makes absence ambiguous, which ARCHITECTURE 'Message families' forbids. Not absorbed: carrying the records needs a PLACEHOLDER_VERSION bump plus matching viewer decoder changes, a payload-format revision well outside a wiring task, and the operator-approved card explicitly asks for bodies leaving the interest set to stop appearing. Handled by documenting the limitation in the README and at publish_interest_to, and by raising task-3618552301000001 to p1 with the activation framing. (2) med - client_resync still swallows AoiError into None. Held: telling the client anything needs a ProtocolErrorCode that protocol/v1 does not have (the eight existing codes are protocol, feature, and persistence failures), so widening only the Rust return type would leave the client equally silent. task-3618552301000002 now names the missing wire code as the blocking sub-decision. Unreachable in production today - nothing sets a zero viewer cap and the ladder's minimum is 25. (3) low - fixed. The zero-cap test now asserts the connection's outbound queue state_bytes is zero, a deterministic signal that nothing was enqueued, so the 250 ms socket-silence check is no longer the oracle.
- 2026-08-06T14:46:53Z — note: review rounds: 2 of the 3-round cap used. Unresolved risk carried into completion, stated plainly: with more than 100 bodies in view, a client cannot yet tell an AOI departure from a despawn. It is documented in the README, at the code site, and tracked at p1 as task-3618552301000001. The alternative was shipping an unbounded fan-out that breaks the hard workload cap, which is the worse of the two.
- 2026-08-06T14:48:01Z — run: node scripts/check.mjs
  started 2026-08-06T14:47:02Z, exit 0 in 59.8s
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
- 2026-08-06T14:48:10Z — moved to done
