# Ruleset schema and constitution contract v1

This document is the normative Step 0 contract for the versioned ruleset
schema, non-votable constitution, composite envelope validation, Track A
activation/rollback lifecycle, and Track B capability boundary. It implements
[ARCHITECTURE.md](../../ARCHITECTURE.md) §7 and
[ADR-0007](../../docs/adr/0007-ruleset-schema-and-constitution-boundary.md).

It composes with
[workload/v1](../../workload/v1/CONTRACT.md) (non-votable §1 targets and
degradation measurement),
[protocol/v1](../../protocol/v1/CONTRACT.md),
[world/v1](../../world/v1/CONTRACT.md), and
[replay/v1](../../replay/v1/CONTRACT.md). Runtime loaders, persistence wiring,
and generated bindings are outside this contract.

The words **MUST**, **MUST NOT**, **SHOULD**, and **MAY** are normative.

## 1. Generations

The live ruleset is an immutable **generation**: a complete parameter map plus
metadata `(generation_id, activated_tick)`. Exactly one generation is live for
command validation in a tick. A pending generation MAY exist after a passed
vote and before activation. Swap MUST occur only at a tick boundary.

## 2. Constitution (non-votable)

Governance MUST NOT amend the constitution through Track A or Track B. The
constitution covers:

1. compute and storage envelopes, including the linear cost ceiling in §4;
2. workload targets and degradation measurement windows from workload v1;
3. protocol and compatibility rules;
4. identity and voter eligibility;
5. recovery and rollback machinery for ruleset activation; and
6. amendment rules for the constitution itself (operator-only).

### 2.1 Voter eligibility

An account is eligible to vote when both are true:

- account age ≥ **7** days; and
- at least one aigent owned by the account has completed a successful
  command-capable handshake.

Eligibility is constitutional and not votable.

## 3. Mutable parameter catalog

Every Track A parameter MUST declare: path, JSON type, inclusive range or enum,
optional cross-field constraints, default, whether it is a **metaparameter**,
and exactly one migration rule (`grandfather` | `clamp` | `evict`). A parameter
without a migration rule is not votable.

v1 catalog (paths are dot-separated):

| Path | Type | Range / notes | Default | Meta | Migration |
| --- | --- | --- | --- | --- | --- |
| `movement.lease_ttl_ms` | int | 1000..60000 | 10000 | no | clamp |
| `movement.max_speed_mm_per_s` | int | 1..50000 | 5000 | no | clamp |
| `movement.blocked_lease_ticks` | int | 1..200 | 20 | no | clamp |
| `movement.displacement_step_mm` | int | 1..1000 | 50 | no | clamp |
| `movement.max_displacement_radius_mm` | int | 0..100000 | 5000 | no | clamp |
| `movement.unstick_blocked_ticks` | int | 1..2000 | 40 | no | clamp |
| `movement.unstick_rate_per_minute` | int | 1..60 | 6 | no | clamp |
| `shape.body_max_parts` | int | 1..256 | 32 | no | grandfather |
| `shape.body_max_joints` | int | 0..256 | 32 | no | grandfather |
| `shape.object_max_parts` | int | 1..256 | 64 | no | grandfather |
| `shape.object_max_joints` | int | 0..256 | 64 | no | grandfather |
| `shape.max_extent_mm` | int | 1..100000 | 10000 | no | clamp |
| `budget.objects_per_aigent` | int | 0..10000 | 100 | no | evict |
| `budget.area_mm2_per_aigent` | int | 0..1e12 | 25000000 | no | evict |
| `budget.chunk_touches_per_hour` | int | 1..100000 | 500 | no | clamp |
| `lifecycle.despawn_timeout_ms` | int | 1000..86400000 | 300000 | no | clamp |
| `speech.radius_mm` | int | 0..100000 | 30000 | no | clamp |
| `speech.rate_per_minute` | int | 0..600 | 60 | no | clamp |
| `channel.post_rate_per_minute` | int | 0..600 | 30 | no | clamp |
| `action.submission_rate_per_second` | int | 1..100 | 20 | no | clamp |
| `physics.min_object_thickness_mm` | int | 1..1000 | 10 | no | clamp |
| `physics.sweep_max_mm` | int | 1..100000 | 5000 | no | clamp |
| `governance.quorum_ratio` | number | 0.01..1 | 0.10 | yes | clamp |
| `governance.pass_threshold` | number | 0.50..1 | 0.50 | yes | clamp |
| `governance.vote_duration_ticks` | int | 1200..2592000 | 72000 | yes | clamp |
| `governance.soak_delay_ticks` | int | 200..120000 | 1200 | yes | clamp |
| `governance.meta_quorum_ratio` | number | 0.01..1 | 0.20 | yes | clamp |
| `governance.meta_pass_threshold` | number | 0.50..1 | 0.6666666666666666 | yes | clamp |
| `governance.meta_vote_duration_ticks` | int | 1200..2592000 | 216000 | yes | clamp |
| `governance.meta_soak_delay_ticks` | int | 200..120000 | 6000 | yes | clamp |

Cross-field constraints:

- `movement.max_displacement_radius_mm` MUST be ≥ `movement.displacement_step_mm`
  when radius > 0;
- `governance.meta_pass_threshold` MUST be ≥ `governance.pass_threshold`;
- `governance.meta_quorum_ratio` MUST be ≥ `governance.quorum_ratio`;
- `governance.meta_soak_delay_ticks` MUST be ≥ `governance.soak_delay_ticks`;
- `governance.meta_vote_duration_ticks` MUST be ≥ `governance.vote_duration_ticks`;
- `shape.body_max_joints` MUST be ≤ `shape.body_max_parts`;
- `shape.object_max_joints` MUST be ≤ `shape.object_max_parts`.

## 4. Composite envelope validation

Per-parameter range checks are necessary but not sufficient. A complete
candidate configuration is scored:

```
cost = 300 + 500
     + (body_max_parts + object_max_parts) * objects_per_aigent
     + (speech.radius_mm / 1000) * speech.rate_per_minute
     + channel.post_rate_per_minute
```

The constants 300 and 500 are constitutional imports of the workload
concurrent-aigent and concurrent-viewer targets; they are not candidate
parameters. The constitution ceiling is this formula on the default catalog.
Because the ceiling equals the default cost, any proposal that increases a
cost-driving term without a compensating decrease is rejected with
`ENVELOPE_EXCEEDED`. Published parameter maxima remain valid for downward
migration and compensating trades. A candidate with `cost > ceiling` MUST NOT
reach a vote.

## 5. Track A lifecycle

1. **Propose** a path and value (or a batch of path/value pairs forming one
   candidate). Rejection reasons are the closed set:
   `EMPTY_PROPOSAL`, `UNKNOWN_PATH`, `TYPE_ERROR`, `OUT_OF_RANGE`,
   `CROSS_FIELD`, `INCOMPLETE_CANDIDATE`, `ENVELOPE_EXCEEDED`. Unknown paths,
   type errors, range violations, cross-field failures, and envelope failures
   reject immediately and have no effect. Every catalog path carries a
   migration rule; a catalog entry without one is a contract defect, not a
   runtime proposal outcome.
2. **Vote** while eligible. Exactly one ballot per owner `account_id` per
   proposal. Duplicate account ballots reject with `DUPLICATE_VOTE`. Missing
   account id rejects with `MISSING_ACCOUNT_ID`. Ineligible voters reject with
   `INELIGIBLE_VOTER`. Ordinary vs metaparameter thresholds come from the
   **live** generation. A proposal that touches any metaparameter path uses
   metaparameter thresholds for the whole proposal. Ordinary proposals pass
   when turnout ≥ live quorum and approval **>** live `pass_threshold`.
   Metaparameter proposals pass when turnout ≥ live meta quorum and approval
   **≥** live `meta_pass_threshold`. Closing before `opened_at + vote_duration`
   fails with `VOTE_STILL_OPEN`.
3. On pass: commit a **pending** generation with soak delay from the live
   governance soak parameter matching the proposal class. Derived data MAY be
   precomputed off-tick. Pending status is durable.
4. After soak delay ticks elapse, at the next tick boundary: if soak health
   holds as measured at that activation boundary, **activate** atomically and
   broadcast `ruleset_changed`; else **rollback** the pending generation and
   keep the prior live generation.
5. Soak health fails when either the workload degrade condition would trigger
   on the soak's trailing 600 ticks (> 5% overrun) or soak command error rate
   exceeds 0.01, measured at the activation boundary.

Crash between commit and activation MUST recover the pending generation as
pending, never as silently live or silently discarded.

On activation, active leases are revalidated under the new generation and
clamped or cancelled per each parameter's migration rule.

## 6. Track B boundary

Track B proposals are free-form capability requests that use the ordinary
Track A voting thresholds and duration but, on pass, MUST append a backlog
item only. They MUST NOT mutate the live or pending ruleset generation.
Implemented capabilities ship behind feature flags defaulting off; enabling a
flag is a separate Track A parameter change once such a flag path exists.

## 7. Conformance boundary

[`conformance/ruleset-v1.json`](conformance/ruleset-v1.json) supplies example
scenarios. The evaluator derives accept/reject and lifecycle traces from this
contract. Fixtures MUST NOT supply oracle fields that replace derived
validation or soak outcomes.

Wire protobuf for governance messages remains a later protocol task.
