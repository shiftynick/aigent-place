# ADR 0004: Terminal revision and forced sleep

**Status:** accepted
**Date:** 2026-07-29
**Task:** task-010

## Context and problem statement

The accepted world contract requires every externally visible entity mutation
to increment a non-zero `uint64` revision exactly once. It also requires
revision exhaustion to reject without effect and arithmetic never to wrap.
Separately, disconnect must cancel leases and make the aigent body sleeping
and non-colliding so an ownerless body cannot remain an authoritative obstacle.

Those rules conflict when an active body has revision
`18446744073709551615`: sleeping it cannot increment, while rejecting the
transition leaves an uncontrolled active collider. The choice affects
persisted state, public results, recovery, and replay, so task-010 cannot
select it as an evaluator-only edge case.

## Decision drivers

- Disconnect must fail safe by removing ownerless bodies from collision.
- Public revisions must remain monotonic, non-zero, and never wrap.
- Normal commands must receive a typed no-effect result before capacity is
  irrecoverably consumed.
- Persisted recovery must have one deterministic interpretation of terminal
  state.
- The rule should not add a second version counter solely for an unreachable
  operational edge.

## Considered options

1. Reserve the maximum `uint64` revision for a terminal forced-sleep
   transition.
2. Permit forced sleep at revision exhaustion without incrementing revision.
3. Add a separately versioned collision-lifecycle epoch that can advance after
   entity revision exhaustion.

Option 1 preserves the one-change/one-revision rule and fail-safe disconnect
with one reserved value. Option 2 is simpler but makes two observably different
states share a revision. Option 3 is the most general but adds schema,
persistence, and comparison complexity for an exhaustion case that should
never occur in normal operation.

## Decision

- Revision `18446744073709551615` is reserved for terminal forced sleep.
- Externally requested entity mutations require enough capacity for both the
  requested increment and a later forced-sleep increment. At revision
  `18446744073709551614` or greater they reject without effect as
  `REVISION_EXHAUSTED`.
- Disconnect at revision `18446744073709551614` cancels leases, transitions
  the active body to sleeping, increments it to the terminal revision, and
  persists and publishes that final state.
- An entity at the terminal revision is permanently sleeping and
  non-colliding. Wake, restore-to-active, unstick, shape mutation, and movement
  reject as `REVISION_EXHAUSTED`.
- An already-sleeping disconnect is a semantic no-op at every revision.
- Legacy or corrupt persisted state containing an active terminal-revision
  entity is recovered as terminal sleeping without arithmetic, emits a typed
  recovery diagnostic, and never enters the active broadphase.

## Consequences

### Good

- Disconnect remains fail-safe without wrapping or reusing a revision.
- Every valid externally visible state change still has a unique revision.
- Commands encounter exhaustion one mutation early and receive a deterministic
  typed rejection.
- Recovery can repair an impossible active-terminal state without making it
  authoritative.

### Bad

- One `uint64` value is unavailable to normal entity mutations.
- Clients and persistence code must understand that the maximum revision is a
  terminal lifecycle marker, not merely a large ordinary revision.
- Capacity checks must reserve a future disconnect increment rather than only
  checking whether the immediate addition wraps.

## Validation

Task-010 will add semantic cases proving that:

- an external mutation at the reserved predecessor rejects without mutation;
- disconnect at the predecessor reaches terminal sleeping exactly once;
- repeated disconnect is a no-op;
- terminal wake, restore-to-active, movement, shape mutation, and unstick
  reject without mutation; and
- active terminal persisted state recovers to non-colliding terminal sleep.

## Follow-up

- Operator acceptance is tracked by the companion task created from task-010.
- Persistence and server runtime tasks must preserve the terminal marker and
  recovery diagnostic.
