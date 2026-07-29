---
id: task-002
title: Specify the protocol envelope and compatibility contract
status: done
priority: p0
tags: [area:architecture, milestone:foundations]
blockedBy: [task-019, task-020]
createdAt: "2026-07-29T12:45:23Z"
updatedAt: "2026-07-29T16:18:22Z"
---

<!-- task-tracker:description -->
## Description

Turn the approved envelope, message-family, compatibility-lifetime, queue-overflow, and resync rules into one normative versioned protocol contract with executable examples. Acceptance: versions and feature negotiation are unambiguous, byte-queue overflow is distinguished from ordered-event resync, malformed/unsupported envelopes have deterministic outcomes, and unresolved choices become proposed ADRs plus needs:operator tasks.

<!-- task-tracker:log -->
## Log

- 2026-07-29T12:45:23Z — created (status: backlog)
- 2026-07-29T12:55:19Z — edited (title "Extract versioned foundation contracts"→"Specify the protocol envelope and compatibility contract"; description updated)
- 2026-07-29T13:40:12Z — edited (+blockedBy task-019)
- 2026-07-29T14:29:15Z — note: rubric: (1) A single versioned protocol contract defines the v1 envelope, roles, message families, directionality, correlation, and typed deterministic outcomes without duplicating future generated wire types. (2) Handshake negotiation unambiguously selects supported protocol and feature versions, including unknown features, unsupported majors, deprecated majors, and spectate-only fallback under the published six-month policy. (3) Command metadata and server outcomes specify session epoch, monotonic sequence, idempotency replay, entity revisions, and exactly one authoritative accepted or rejected result for every mutating command. (4) Backpressure rules distinguish byte-queue coalescing/disconnect from ordered-event gap recovery and snapshot-baseline resync, with explicit state transitions and no silent event loss. (5) Executable deterministic examples cover valid negotiation plus malformed, unsupported, overflow, event-gap, and baseline-loss paths; the repository gate runs them and all documentation links and process checks pass.
- 2026-07-29T14:29:15Z — moved to in_progress (claimed by codex-task-002)
- 2026-07-29T14:35:12Z — edited (+tag needs:operator; +blockedBy task-020)
- 2026-07-29T14:35:12Z — note: decision checkpoint: delegated contract scans found that version selection, cross-epoch idempotency, and ordered-event recovery are public wire choices not fixed by ARCHITECTURE.md. Proposed ADR-0001 recommends protocol-major plus versioned-feature negotiation, spectate-only retired-major fallback, aigent-scoped idempotency, and separate byte-queue/event/snapshot recovery. The choice is expensive to reverse, so implementation is blocked pending task-020 operator acceptance.
- 2026-07-29T14:35:12Z — moved to blocked
- 2026-07-29T14:35:31Z — run: git diff --check
  started 2026-07-29T14:35:31Z, exit 0 in 0.1s
  output:
  | (no output)
- 2026-07-29T14:35:46Z — run: node scripts/check.mjs
  started 2026-07-29T14:35:31Z, exit 0 in 15.3s
  output tail (truncated to last 30 lines):
  |     # Subtest: soft-deletes by setting status=done and adding deleted:true tag
  |     ok 1 - soft-deletes by setting status=done and adding deleted:true tag
  |       ---
  |       duration_ms: 119.5662
  |       type: 'test'
  |       ...
  |     # Subtest: keeps dependents blocked when their blocker is soft-deleted
  |     ok 2 - keeps dependents blocked when their blocker is soft-deleted
  |       ---
  |       duration_ms: 298.772
  |       type: 'test'
  |       ...
  |     1..2
  | ok 121 - task rm
  |   ---
  |   duration_ms: 418.4508
  |   type: 'suite'
  |   ...
  | 1..121
  | # tests 289
  | # suites 62
  | # pass 289
  | # fail 0
  | # cancelled 0
  | # skipped 0
  | # todo 0
  | # duration_ms 14663.3538
  |
  | run-checks: PASS (skill-sync + 14 suites)
  | process-docs: PASS (no unresolved markers in scoped non-binary files)
- 2026-07-29T15:32:48Z — edited (-tag needs:operator)
- 2026-07-29T15:38:39Z — moved to in_progress (claimed by codex-task-002)
- 2026-07-29T15:45:35Z — note: implementation choices: selected the highest decodable retired major for spectate fallback; carried session_epoch in CommandMetadata; treated the ADR's 40-tick disconnect window as the explicit exception to task-013's ownership of other measurement windows. The authored proto intentionally limits itself to envelope/control types; domain payload bytes remain unavailable until accepted typed schemas exist.
- 2026-07-29T15:45:35Z — note: protoc is not installed in the current foundation workspace, so task-002 does not claim protobuf compilation. Task-004 owns generator setup and binary/generated-target conformance; task-002 validates deterministic semantics with the zero-dependency Node runner.
- 2026-07-29T15:45:36Z — moved to review
- 2026-07-29T15:59:10Z — note: round 1 cold review: rung 1 Claude counterpart CLI, separate SPEC and STANDARDS calls. Confirmed and fixed silent event loss on stream reset, replay cursor advancement, pass-through envelope/baseline oracles, locale-dependent ordering, session displacement, role/direction validation, event acknowledgement/resume validation, queue coalescing order, command result correlation, deprecation-window coverage, and terminal close behavior. Rejected protoc compilation as task-002 scope because task-004 explicitly owns generator/binary conformance; added a structural proto check for duplicate field numbers and reserved ranges without claiming compilation.
- 2026-07-29T16:08:53Z — note: round 2 cold review: confirmed round-1 fixes and found additional contract/model mismatches. Fixed correlated ProtocolError IDs, exact-next rejection sequence advancement, accepted-result shape validation, viewer mode semantics, retirement eligibility under the six-calendar-month window, wire-level ConnectionDisplaced output, red-capable final-state assertions, connection-bound aigent identity, integrated command envelope identity/version checks, event admission replay, stale/idempotent event cursor handling, queue state reconstruction, exact-limit enqueue semantics, and broader proto/link structural checks.
- 2026-07-29T16:17:23Z — note: final round 3 cold review: rung 1 Claude counterpart CLI, separate SPEC and STANDARDS calls. Reviewer found no rubric-blocking defect. Fixed every must-fix contradiction: all decoded envelope errors now correlate recoverable message IDs; unadmitted events no longer advance the sent cursor; duplicate-session displacement now occurs on the actual handshake path; current/deprecated selection is gated by the published horizon; generic envelopes bind negotiated major/connection; repeated handshake frames fail; unknown feature offers are structurally validated; unavailable command kinds return recorded CommandResult rejections; and dead queue close state was removed. Remaining integration-level transport mapping and extended recovery combinations stay with tasks 004, 006, 011, 013, and 018 as already assigned by ADR-0001.
- 2026-07-29T16:17:23Z — run: node --test scripts/protocol-contract.test.mjs
  started 2026-07-29T16:17:23Z, exit 0 in 0.1s
  output tail (truncated to last 30 lines):
  |   duration_ms: 0.1006
  |   type: 'test'
  |   ...
  | # Subtest: fixture validation rejects duplicate case IDs and limit drift
  | ok 7 - fixture validation rejects duplicate case IDs and limit drift
  |   ---
  |   duration_ms: 1.0005
  |   type: 'test'
  |   ...
  | # Subtest: the authored proto has unique message field numbers and reserved gaps
  | ok 8 - the authored proto has unique message field numbers and reserved gaps
  |   ---
  |   duration_ms: 0.9366
  |   type: 'test'
  |   ...
  | # Subtest: protocol documentation links resolve and canonical ordering is locale-free
  | ok 9 - protocol documentation links resolve and canonical ordering is locale-free
  |   ---
  |   duration_ms: 0.6733
  |   type: 'test'
  |   ...
  | 1..9
  | # tests 9
  | # suites 0
  | # pass 9
  | # fail 0
  | # cancelled 0
  | # skipped 0
  | # todo 0
  | # duration_ms 70.5762
- 2026-07-29T16:17:39Z — run: node scripts/check.mjs
  started 2026-07-29T16:17:23Z, exit 0 in 16.1s
  output tail (truncated to last 30 lines):
  |     # Subtest: soft-deletes by setting status=done and adding deleted:true tag
  |     ok 1 - soft-deletes by setting status=done and adding deleted:true tag
  |       ---
  |       duration_ms: 122.354
  |       type: 'test'
  |       ...
  |     # Subtest: keeps dependents blocked when their blocker is soft-deleted
  |     ok 2 - keeps dependents blocked when their blocker is soft-deleted
  |       ---
  |       duration_ms: 305.8685
  |       type: 'test'
  |       ...
  |     1..2
  | ok 121 - task rm
  |   ---
  |   duration_ms: 428.3193
  |   type: 'suite'
  |   ...
  | 1..121
  | # tests 289
  | # suites 62
  | # pass 289
  | # fail 0
  | # cancelled 0
  | # skipped 0
  | # todo 0
  | # duration_ms 15370.7973
  |
  | run-checks: PASS (skill-sync + 14 suites)
  | process-docs: PASS (no unresolved markers in scoped non-binary files)
- 2026-07-29T16:17:39Z — run: git diff --check HEAD -- . :(exclude).tasks/**
  started 2026-07-29T16:17:39Z, exit 0 in 0.1s
  output:
  | (no output)
- 2026-07-29T16:17:55Z — note: review-cap adjudication: round 3 reported no rubric blocker. Fixed the two requested pre-merge defects and adjacent contract contradictions without opening a fourth round: envelope ProtocolErrors now include recoverable related_message_id, unadmitted events remain unsent until replay, duplicate-session displacement uses the handshake path, generic envelopes bind the negotiated connection, post-negotiation handshakes reject, deprecated command support transitions at the published horizon, invalid compatibility registries cannot masquerade as protocol mismatch, exact-next unavailable kinds produce recorded CommandResult rejections, entity revisions are explicitly non-zero, and coalescing prose matches the over-limit transition. Lower-level WebSocket mapping and integration combinations remain assigned to existing downstream tasks.
- 2026-07-29T16:17:55Z — run: node --test scripts/protocol-contract.test.mjs
  started 2026-07-29T16:17:55Z, exit 0 in 0.1s
  output tail (truncated to last 30 lines):
  |   duration_ms: 0.1022
  |   type: 'test'
  |   ...
  | # Subtest: fixture validation rejects duplicate case IDs and limit drift
  | ok 7 - fixture validation rejects duplicate case IDs and limit drift
  |   ---
  |   duration_ms: 0.9843
  |   type: 'test'
  |   ...
  | # Subtest: the authored proto has unique message field numbers and reserved gaps
  | ok 8 - the authored proto has unique message field numbers and reserved gaps
  |   ---
  |   duration_ms: 0.9632
  |   type: 'test'
  |   ...
  | # Subtest: protocol documentation links resolve and canonical ordering is locale-free
  | ok 9 - protocol documentation links resolve and canonical ordering is locale-free
  |   ---
  |   duration_ms: 0.6935
  |   type: 'test'
  |   ...
  | 1..9
  | # tests 9
  | # suites 0
  | # pass 9
  | # fail 0
  | # cancelled 0
  | # skipped 0
  | # todo 0
  | # duration_ms 68.5008
- 2026-07-29T16:18:11Z — run: node scripts/check.mjs
  started 2026-07-29T16:17:55Z, exit 0 in 15.5s
  output tail (truncated to last 30 lines):
  |     # Subtest: soft-deletes by setting status=done and adding deleted:true tag
  |     ok 1 - soft-deletes by setting status=done and adding deleted:true tag
  |       ---
  |       duration_ms: 122.139
  |       type: 'test'
  |       ...
  |     # Subtest: keeps dependents blocked when their blocker is soft-deleted
  |     ok 2 - keeps dependents blocked when their blocker is soft-deleted
  |       ---
  |       duration_ms: 309.9038
  |       type: 'test'
  |       ...
  |     1..2
  | ok 121 - task rm
  |   ---
  |   duration_ms: 432.1459
  |   type: 'suite'
  |   ...
  | 1..121
  | # tests 289
  | # suites 62
  | # pass 289
  | # fail 0
  | # cancelled 0
  | # skipped 0
  | # todo 0
  | # duration_ms 14878.8618
  |
  | run-checks: PASS (skill-sync + 14 suites)
  | process-docs: PASS (no unresolved markers in scoped non-binary files)
- 2026-07-29T16:18:11Z — run: git diff --check HEAD -- . :(exclude).tasks/**
  started 2026-07-29T16:18:11Z, exit 0 in 0.1s
  output:
  | (no output)
- 2026-07-29T16:18:22Z — note: re-plan check: the accepted contract sharpens but does not invalidate the queued front. Task-004 still owns generated/binary conformance; task-006 snapshot/queue integration; task-011 persistence and retention; task-013 workload transport limits; task-018 handshake/session/result integration. Filed the recurring tautological-oracle review pattern as task-021 rather than expanding this task.
- 2026-07-29T16:18:22Z — moved to done
