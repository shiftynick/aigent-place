# ADR 0014: Shared ephemeral demo activity and recoverable progress

- **Status:** accepted (delegated operator authority, 2026-10-10)
- **Date:** 2026-10-10
- **Task:** task-072

## Context and problem statement

Four delivered improvement rounds made movement, shapes, aims and camera control
visible. A fresh spectator watched delivered main for 192.39 seconds and could
not identify a shared purpose, phase or outcome. ADR0011 provides physical aims,
not brain motives. ADR0013 defines an optional ephemeral two-binding plaza.
This decision extends those contracts with optional world-defined demo rules;
it does not replace their self-binding, geometry or ordinary-world guarantees.

The operator chose equal viewer/world improvement, lively goal-driven demos,
preserved owner-run brains, and one or two focused improvements per round.
They explicitly said, “You choose everything after independent adversarial
review,” including product and architecture changes, then confirmed the program.
Two fresh independent proposal reviews were adjudicated before selection.
This ADR first existed as proposed. Root accepted it under that explicit
confirmed delegation after the two reviews and documented adjudication.

## Decision drivers

- Show truthful shared progress and earned outcomes without private log claims.
- Require meaningful own contribution from both participants in each phase.
- Preserve stopped participants' earned credit while a slower peer contributes.
- Recover current state for slow or reconnecting viewers without replaying old
  completion as a new live event.
- Keep a bounded optional end-to-end slice; preserve ordinary brains and worlds.

## Considered options

1. Improve staging and labels only. This helps visibility but cannot show purpose.
2. Publish measured geometry with viewer heuristics. Cheaper, but cannot define
   authoritative shared success and risks presenting inference as world fact.
3. Publish private brain completions. Rejected: owner logs are not world proof.
4. Add one optional server-defined activity consumed by independent owner brains.
   Selected, with the lifecycle and recovery revisions below.

## Decision

Add explicit `--demo-activity`, requiring `--demo-plaza` and no journal, plus an
optional owner-side `--activity` demo policy. Plain plaza, existing policies,
ordinary worlds and the owner-run intent interface remain available.

The world alone advances READY, SEPARATE, REGROUP, COMPLETE and SUSPENDED.
READY forms a safe inner band and grants no count or movement credit. Each
movement phase resets both participants' starting poses, own path and signed
net directed contribution. Separation requires a crossing from below plus both
outward proofs. Regroup requires both new inward proofs and safe consecutive
dwell. Only actual authoritative leased movement supplies proof; peer movement,
old phases, private logs, accepted results and non-lease relocation do not.

An earned phase proof remains valid while current net contribution, exact
epoch/body/shape presence and safe geometry qualify. Natural arrival and STOP
may hold. STOP keeps its existing lease-cancellation behavior; no heartbeat or
keep-alive jiggle is required. Continuous recent motion is not a dwell condition.
The phase lifetime bounds waiting. Actual outstanding lease expiry/invalidation,
participant loss/replacement, unsupported or overlapping geometry and timeout
suspend the attempt with a truthful reason. Completed count stays earned.
Recovery goes through READY with zero inherited credit, even without leases.
Overlapping wake geometry does not promise automatic displacement; general
sleep/wake/unstick remains separate task052 work.

Freeze a bounded formation centre/axis during setup. Keep it across completed
rounds; refreeze on reset recovery. Brains derive local targets from public
geometry, choose ordinary MOVE/STOP intents, and never promote world phases.
The existing spawn search must keep stopped participants' footprints reserved;
sequential stopped-first bootstrap is a required regression.

Capture narrow demo presence at tick boundaries with private active owner,
connection and command-epoch guards. A delayed attach cannot replace a newer
epoch, and stale cleanup cannot disconnect the replacement. No general durable
session or lifecycle overhaul is included.

Add typed optional DemoActivity v1 at full field6 and delta field7. Every
accepted generation carries the complete replacement; absence clears prior
activity. Freeze it with entities and include it in the generation digest.
Absent normal-world digest bytes remain unchanged. All full promotion and
resync paths carry latest phase/count and bounded transition history. Global
objective references do not bypass AOI body limits.

State carries a fresh non-auth run token, checked reset/round/transition IDs,
observed and phase ticks, explicit numeric participant slots/availability,
bounded anchors/rules/progress/proof ticks and at most eight typed transitions.
The non-auth startup identifier hashes a domain separator, wall-clock nanoseconds,
process ID and checked per-process counter with existing SHA256. It is portable,
runs outside ticks and carries no authentication or guaranteed cryptographic
uniqueness claim. Restart creates a fresh run and zero rounds. Reset preserves run totals and
monotonic transition IDs. Counter exhaustion fails the optional activity closed.
Validate activity atomically with bodies; malformed or unknown semantics recover
safely. Old clients may ignore the additive optional field.

A compact public activity strip shows rules, phase, both participants' progress,
earned count and recent transitions without selection. Stale/recovery state
stops cues. Initial/recovery full snapshots seed a watermark and render history
without celebrating old transitions. Fresh later deltas may cue unseen IDs.
Reload does not promise exactly-once effects across lost browser memory. Missing
AOI participant records and truncated history are disclosed explicitly.

The selected detailed state table, candidate thresholds and signatures are in
`.tasks/evidence/task-072/design-contract.md` and `interface-outline.md`. Initial
rule candidates are 1.8–2.2m inner band, 5.5m separation, at least1m own path and
directed contribution per participant per movement phase, eight dwell ticks,
20 hold ticks and a 400-tick phase timeout. Actual validation may tune these
within this narrow semantic contract; publish the actual rules.

## Consequences

### Good

- Viewers can follow a clear cooperative objective and accumulating outcomes.
- One phase authority removes competing private/server completion machines.
- Complete state recovery preserves truthful count and phase for slow viewers.
- The optional demonstration keeps normal-world and real-brain interfaces usable.

### Bad

- This adds supported protocol semantics, world state and a transport-to-tick
  presence seam, with more cross-layer tests and maintenance.
- Repeated cooperative rounds demonstrate goal-driven interaction, not open-ended
  society or live model reasoning. Shape and arena assumptions remain narrow.
- A paused brain with valid earned proof can still contribute to a later honest
  completion. The server cannot instantly infer external process or cognition.
- Unsafe overlap may require owner action or restarting the ephemeral demo;
  general deterministic displacement is outside this task.

## Validation

Use per-phase stationary/pre-traveled/one-sided/oscillating and relocation
counterexamples; delayed stopped-after-credit peer; pause before credit; exact
epoch replacement/stale cleanup; lease expiry; unsafe geometry; reset/exhaustion;
optional absence and malformed observation; AOI omission; coalesced/promotion/
resync across completion with no historical cue replay. Require three fresh
180-second new-policy trials with at least three proved rounds each and no
spurious normal-run suspensions, plus a fresh public spectator at30/90/150s.
Separate cold SPEC/STANDARDS axes and the full gate precede protected delivery.
Baseline physical cycles are calibration only.

## Follow-up

- General lifecycle and deterministic displacement remain task052.
- Revisit richer activities after evidence shows the cooperative demonstration
  has become repetitive; no generic activity framework is selected here.
