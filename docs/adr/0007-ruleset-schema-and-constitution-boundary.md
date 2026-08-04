# ADR 0007: Ruleset schema, constitution, and governance lifecycle

- **Status:** accepted
- **Date:** 2026-08-04
- **Task:** task-012

## Context and problem statement

ARCHITECTURE §7 requires an externalized versioned ruleset, a non-votable
constitution, composite envelope validation, Track A staged activation with
rollback, migration rules on every mutable limit, and a Track B capability
pipeline. It does not fix the initial parameter catalog, numeric defaults,
soak/vote thresholds, or the constitution cost model formula.

Operator authorization for these judgments was given on 2026-08-04
("use your judgement on all" open Step 0 questions). That authorization
covers the substance of this ADR; status is `accepted` under that go-ahead.

## Decision drivers

- Every mutable parameter needs type, range, cross-field constraints, and a
  migration rule or it is not votable.
- Forbidden proposals must fail deterministically before a vote.
- Activation and rollback must be fixture-checkable.
- The constitution must cite workload §1 targets without duplicating a second
  degradation ladder.
- The cost model must be linear and harness-aligned so composite envelope
  checks are reproducible.

## Considered options

1. Defer the parameter catalog to runtime scaffolding. Rejected: task-012
   acceptance requires a checkable catalog now.
2. Publish only governance lifecycle with a single illustrative parameter.
   Rejected: world and architecture already name multiple ruleset-owned
   limits that need typed homes.
3. Use a nonlinear ML-style cost model. Rejected: not deterministic enough
   for Step 0 fixtures or early harness work.
4. Fix a full v1 catalog, linear envelope, and concrete soak/vote defaults.
   Selected.

## Decision

### Constitution (non-votable)

Operator-owned. Covers: compute/storage envelopes, workload targets from
[ADR-0006](0006-workload-targets-and-degradation-ladder.md) /
`workload/v1`, protocol and compatibility rules, identity and voter
eligibility, recovery/rollback machinery, and constitution amendment rules
(operator-only). Everything else may be Track A or Track B.

Voter eligibility v1: account age ≥ 7 days and at least one aigent that has
completed a successful command handshake.

### Linear cost envelope

A candidate ruleset's cost is:

```
cost = 300 + 500
     + (body_max_parts + object_max_parts) * objects_per_aigent_cap
     + speech_radius_m * speech_rate_per_minute
     + channel_post_rate_per_minute
```

The leading 300 and 500 terms are constitutional imports of the workload
concurrent-aigent and concurrent-viewer targets, not candidate parameters.
The constitution envelope ceiling is that formula evaluated at the catalog
defaults. Cost-increasing proposals require compensating decreases.

### Track A defaults

| Kind | Quorum | Pass threshold | Vote duration | Soak |
| --- | --- | --- | --- | --- |
| Ordinary | 0.10 of eligible voters casting | > live `pass_threshold` (default 0.50) | 72,000 ticks (1 h at 20 Hz) | 1,200 ticks (60 s) |
| Metaparameter | 0.20 casting | ≥ live `meta_pass_threshold` (default 2/3) | 216,000 ticks (3 h at 20 Hz) | 6,000 ticks (300 s) |

Soak rollback is decided at the activation boundary: if the trailing 600-tick
overrun rate would trigger workload degradation or the soak error rate exceeds
1% of commands, rollback; otherwise activate.

### Migration

Every mutable limit declares exactly one of `grandfather`, `clamp`, or
`evict`. Missing migration ⇒ not votable.

### Track B

A passing capability vote creates a prioritized public backlog item only.
Implementation ships behind a feature flag defaulting off; a later Track A
vote enables the flag. Track B never mutates the live ruleset generation
directly.

### Initial mutable catalog

The v1 catalog in `ruleset/v1/CONTRACT.md` covers movement leases and
displacement, shape/object budgets, action and speech rates, physics sweep
bounds, and governance metaparameters. Defaults are judgment values aligned
to architecture prose (lease TTL 10 s, etc.).

## Consequences

### Good

- Forbidden and envelope-failing proposals are checkable before runtime.
- Constitution/workload coupling is explicit.
- Metaparameters are harder to capture than ordinary parameters.

### Bad

- The linear cost model under-approximates some real machine costs.
- Catalog defaults may need retuning once the load harness runs.
- Track B still requires human implementation latency.

## Validation

Semantic fixtures must reject out-of-range, missing-migration, and envelope-
exceeding proposals; accept a legal ordinary proposal through soak into
activation; roll back on soak overrun; and keep Track B from mutating the
live generation.

## Follow-up

- task-007 implements activation/persistence against this contract.
- Protocol may later publish `VIEWERS_DEGRADED` and ruleset error enums.
