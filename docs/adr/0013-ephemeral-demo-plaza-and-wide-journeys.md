# ADR 0013: Ephemeral demo plaza and wider observed journeys

- **Status:** accepted
- **Date:** 2026-10-08
- **Task:** task-069; task-070 for automatic framing

## Context and problem statement

Round 4's fresh live critic found distinct bodies moving in a small patch,
with frequent real aim changes and little sustained activity to follow.
Independent proposal review rejected smoothing absent aims and widening
coordinates without testing seeker intercepts. A current-main live probe
admitted an 8 metre eastward target, but movement stopped at 2.480 metres
with a typed BLOCKED result. That route is disproved; other regions remain
unproved. Conservative grounding and per-part sweeps can block even descending
edges of the generated noise terrain.

There is no height-edit persistence or terrain observation carrier. A durable
flat profile would need world identity and a format boundary that old binaries
actually reject: a new metadata table alone is ignored by the old reader.
Two disposable demo bodies do not justify that compatibility work this round.

## Decision drivers

- Give owner-driven aigents room for real journeys and responsive pursuit.
- Preserve the normal durable world and canonical geometry.
- Make optional temporary state and recovery limits explicit.
- Show actual wider observations without taking camera control from viewers.

## Considered options

1. Explicit ephemeral authoritative plaza, a wider local policy preset, and
   automatic framing from observed geometry.
2. Durable plaza with startup-pinned identity and old-reader rejection.
3. Search for a larger noise pocket or constrain pursuit to a validated graph.
4. Keep the small stage and add viewer history or aim smoothing.

## Decision

Select option 1 as two sequential tasks and protected main-targeted PRs.
Task-069 delivers the world/demo slice. Task-070 delivers automatic framing and
joint live spectator validation. Both finish before the round-5 critique.

The orchestrator accepts this decision under the operator's explicit
2026-10-08 delegation: product and architecture changes are allowed, and the
orchestrator chooses everything after independent adversarial review. Two new
independent design reviews and root adjudication preceded acceptance and code.
The operator did not personally review these implementation details.

The server flag `--demo-plaza` creates a new temporary world with a marked
in-memory journal. Help and startup output state that it resets on restart.
Combining it with `--journal` rejects before opening or touching the journal
path or accepting connections. Normal listen keeps its SQLite/noise behavior.
No release or external deployment is part of this decision.

The optional profile is immutable: at the existing 1000 mm lattice, global
sample coordinates X/Z in [-16,16] inclusive have height 0 mm; other samples
use unchanged NoiseV1. This produces flat cells [-16,16) metres, with noisy
transition cells outside. Chunk views, max-corner columns, exact grounding and
ordinary earliest-contact per-part sweeps use the same instance sampling seam.
The free NoiseV1 generator, normal fixtures and default WorldConfig retain
their semantics. ADR-0003's lattice, seams, legal contact, grounding and sweep
remain authoritative; this adds one optional generation identity, not stepping,
clipping, runtime terrain editing or a scalar replacement inside movement.

A narrow constructor owns the optional profile and marked ephemeral memory.
The marker survives journal cloning. Generic recovery of marked ephemeral
history fails with a typed error, even if it is empty. World/journal identity
checks are two-sided before tick advancement, mutation or commit: a plaza
world rejects unmarked memory or durable journals, and a normal noise world
rejects marked plaza memory, including replacements through `journal_mut`.
No profile data is sent through the SQLite writer or generation codec.
This is an API ownership boundary; deliberate copying of public generation
fields into unrelated storage is outside its contract.

The optional mode supports two concurrent demo bindings. Count the union of
committed, tentative and same-batch queued identities once. Reject a third
new identity before allocating an ID, binding or lease. Preserve application
collision rechecks and tick-local newborn reservations. Existing identities
can reconnect within the running process. Restart creates fresh bodies rather
than restoring bindings. This is not authentication, general lifecycle or
arbitrary-crowd support.

The SDK CLI flag `--wide-plaza` selects wider local runner/seeker policy;
the narrow preset remains available for the normal world. The runner rectangle
has X in [-6,6] metres and Z in [-4,4] metres. Retreat anchors and observed-peer
intercepts are bounded by the existing +/-8 metre clamp. This convex domain,
including the real 0.5 metre horizontal half-footprint, stays at least 7.5
metres inside the flat cells. Straight intercepts remain inside that domain;
real both-direction sweeps and dense samples verify the argument for both
composed bodies. Boundary and exterior collision remain active.

Policy progress uses authoritative observed positions, with leases, STOP,
collision avoidance, dwell, own-travel checks and peer response. Tune real
journey and pause cadence rather than suppressing aim changes. Two repeated
qualifying terrain-block or position-stall failures produce a loud typed,
non-retryable wide-demo error. Entity avoidance is not called terrain failure.
The error names the failed wide movement and paired setup; it does not claim
the wire proves which terrain profile is running. Public aims retain ADR-0011.

Task-070 uses growth-only padded bounds from applied composed shapes, a minimum
growth threshold and a smoothed automatic transition. Manual orbit/pan and
follow retain camera authority; Reset enables automatic fitting again. No
unobserved waypoint or assumed terrain bounds enter fitting. The grid remains
explicitly a reference: this decision adds no terrain carrier or mesh.

## Consequences

### Good

- Real movement can cross a wider known support region without geometry hacks.
- Normal persistence and owner-run brain integration remain available.
- Temporary mode cannot silently recover its terrain as the normal world.
- Spectators can follow actual widening activity while retaining camera control.

### Bad

- Optional demo state disappears on process loss; restart repopulates it.
- Paired server/policy flags add setup complexity and cannot be negotiated
  through the current terrain-free wire contract.
- Two bodies on a plain stage may still be insufficiently interesting.
- Normal terrain, dormant-body collision, auth, durable command outcomes and
  terrain editing remain unfinished work, not repaired by this mode.
- The profile and conservative inset support only this local demo vocabulary.

## Validation

Task-069 checks independent sample/column/support expectations, both actual
composed bodies through unchanged ground/sweep in both directions and dense
intercepts, exterior blocking, concurrent/pending capacity, recovery and
two-sided journal swaps. Real CLI checks verify argument rejection before path
touch and loud bounded wrong-pair failure. Compiling mutations remove changed
behaviors and must produce executed behavioral failures.

Several fresh identity pairs run for at least 190 seconds in plaza+wide mode.
Decode real positions and aims for sustained multi-second journeys, own-motion
peer response, pause/reconnect and separate STOP. Repeated horizontal centre
distance convergence to 1.2-1.8 metres after >4 metre separation is supporting
evidence; <1 metre penetration and Accepted/goal counters are not success.
Task-070 adds real-Three frustum/manual/follow/Reset tests and actual desktop,
narrow and stale browser paths, with a fresh spectator. Interest limits are
recorded honestly. Separate cold axes, final full gates and protected delivery
apply to each task. The next critique uses the delivered plaza+wide local demo.

## Follow-up

- Round 5 is chosen only from a new critique after both round-4 tasks finish.
- Task-055 retains terrain transport/rendering, rebasing, interpolation and
  remaining presentation work; task-052 retains lifecycle/collision gaps.
- Durable profile identity, old-reader compatibility and editable terrain are
  separate future decisions. No current-aim smoothing or semantic feed ships.
