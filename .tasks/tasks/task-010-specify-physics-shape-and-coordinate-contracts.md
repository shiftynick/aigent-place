---
id: task-010
title: "Specify physics, shape, and coordinate contracts"
status: blocked
priority: p0
tags: [area:architecture, milestone:foundations]
blockedBy: [task-022, task-023, task-024]
createdAt: "2026-07-29T12:55:19Z"
updatedAt: "2026-07-30T00:41:15Z"
---

<!-- task-tracker:description -->
## Description

Write the normative Step 0 contract for collision, sleeping/waking bodies, placement overlap, set_shape, deterministic unstick tie-breaking, the shared primitive grammar, entity IDs, coordinate quantization, and the hard world bound. Acceptance: edge cases have explicit outcomes and validation examples, including sleeping-body overlap and non-finite/out-of-range inputs.

<!-- task-tracker:log -->
## Log

- 2026-07-29T12:55:19Z — created (status: backlog)
- 2026-07-29T22:45:21Z — note: rubric: (1) A versioned normative contract defines canonical entity IDs, coordinates, quantization, primitive trees, transforms, collider derivation, and boundary validation without duplicating the protocol envelope. (2) Collision, movement, placement, set_shape, sleep, wake, restore, and unstick each have explicit deterministic success and rejection outcomes, including simultaneous conflicts. (3) Executable deterministic fixtures cover sleeping-body overlap, occupied wake/restore displacement, overlap rejection, tunneling prevention, deterministic nearest-free tie-breaking, and non-finite/out-of-range inputs. (4) Repository documentation links the contract and the existing gate runs focused plus full checks. (5) Any new expensive-to-reverse wire or persisted-domain choice is recorded in a proposed ADR and implementation does not proceed until operator acceptance.
- 2026-07-29T22:45:21Z — moved to in_progress (claimed by codex-root)
- 2026-07-29T22:49:20Z — edited (+tag needs:operator; +blockedBy task-022)
- 2026-07-29T22:49:20Z — note: decision checkpoint: two isolated delegated scans confirmed that entity ID width, millimetre quantization and tie rounding, primitive transforms and AABB derivation, contact/enclosure rules, sleeping-body placement, and bounded nearest-free search are public or persisted geometry choices not fixed by ARCHITECTURE.md. Proposed ADR-0002 recommends uint64 monotonic IDs, signed millimetres with ties-to-even, conservative transformed AABB unions, legal zero-volume contact, sleeping bodies excluded from placement, and one bounded lattice search for wake/restore/unstick. The choice is expensive to reverse, so implementation is blocked pending task-022 operator acceptance.
- 2026-07-29T22:49:20Z — moved to blocked
- 2026-07-29T22:49:49Z — run: git diff --check HEAD -- . :(exclude).tasks/**
  started 2026-07-29T22:49:49Z, exit 0 in 0.1s
  output:
  | (no output)
- 2026-07-29T22:50:04Z — run: node scripts/check.mjs
  started 2026-07-29T22:49:49Z, exit 0 in 15.2s
  output tail (truncated to last 30 lines):
  |     # Subtest: soft-deletes by setting status=done and adding deleted:true tag
  |     ok 1 - soft-deletes by setting status=done and adding deleted:true tag
  |       ---
  |       duration_ms: 117.8592
  |       type: 'test'
  |       ...
  |     # Subtest: keeps dependents blocked when their blocker is soft-deleted
  |     ok 2 - keeps dependents blocked when their blocker is soft-deleted
  |       ---
  |       duration_ms: 296.791
  |       type: 'test'
  |       ...
  |     1..2
  | ok 121 - task rm
  |   ---
  |   duration_ms: 414.7551
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
  | # duration_ms 14490.8937
  |
  | run-checks: PASS (skill-sync + 14 suites)
  | process-docs: PASS (no unresolved markers in scoped non-binary files)
- 2026-07-29T23:44:01Z — edited (-tag needs:operator)
- 2026-07-29T23:44:01Z — note: operator accepted ADR-0002 as written; the operator-decision condition is resolved. task-010 is queued to resume immediately after task-022 completes its recorded review and validation.
- 2026-07-29T23:44:01Z — moved to backlog
- 2026-07-29T23:47:13Z — moved to in_progress (claimed by codex-root)
- 2026-07-29T23:47:13Z — note: resumed after task-022 completed: ADR-0002 is accepted and now governs the task-010 contract and executable fixtures.
- 2026-07-30T00:03:09Z — note: implementation choices: the owning world contract adds typed PLACE_OBJECT, SET_SHAPE, and UNSTICK protobuf payloads without changing envelope semantics; the semantic evaluator uses lossless decimal parsing for coordinate rounding, numeric uint64 ordering, derived primitive AABBs, swept slab contact, and generated displacement candidates. Heightfield values and ruleset ranges remain owned by task-012; generated/binary protobuf conformance remains task-004.
- 2026-07-30T00:03:09Z — note: protoc is still unavailable in the foundation workspace, so task-010 does not claim compilation or generated bindings. The existing structural proto tests plus task-010 message/link assertions validate the authored source until task-003/task-004 install and run the pinned generator.
- 2026-07-30T00:03:09Z — moved to review
- 2026-07-30T00:20:05Z — edited (+blockedBy task-023)
- 2026-07-30T00:20:05Z — note: ADR-0003 was proposed after round-1 review exposed missing persisted heightfield and terrain-collision semantics. The operator explicitly accepted it; task-010 remains dependency-blocked only until task-023 completes its own delivery lifecycle.
- 2026-07-30T00:20:05Z — moved to blocked
- 2026-07-30T00:41:15Z — edited (+blockedBy task-024)
- 2026-07-30T00:41:15Z — note: ADR-0004 was explicitly accepted as proposed; task-010 remains dependency-blocked only until task-024 completes its independent review and delivery.
