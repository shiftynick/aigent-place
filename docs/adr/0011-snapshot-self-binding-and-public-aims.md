# ADR 0011: Snapshot self binding and public physical movement aims

- **Status:** accepted
- **Date:** 2026-10-08
- **Task:** task-067

## Context and problem statement

Round 2 needs independent owner-side demo brains to identify their own body
among multiple observed bodies, and spectators to understand current movement.
The live command result is sent at admission, before first-body creation is
applied. It cannot supply the first binding without changing the unresolved
durable command-result pipeline. Snapshot generations already freeze the
aigent/body bindings, entities and active movement leases together.

The fresh live critic proposed a responsive two-aigent cast and a spectator
goal inspector. Independent adversarial review removed a public client-written
name/goal channel from this round. A second clean design review verified that
existing per-connection full/delta carriers provide reliable current binding
state, including coalesced full replacements, without a separate push channel.

## Decision drivers

- Correct self identity before self-dependent decisions; no order/hash guess.
- Bind positions and physical aims to one published immutable generation.
- Keep observer state replaceable and recoverable through existing baselines.
- Make movement legible while preserving owner-run brains and a read-only viewer.
- Add generated v1 fields with unknown-field compatibility and no version bump.

## Considered options

1. A private post-spawn SelfBodyBound percept, with reliable pending state and
   re-delivery on reconnect/resync.
2. Additive self binding in every full/delta and public physical aims in entity
   records, projected from the same immutable generation.
3. Fill CommandAccepted entity references or ServerHello with the binding.
4. A public owner-written name/stated-goal status channel.

## Decision

Select option 2. WorldSnapshotBodyProto adds optional uint64 self_body_id at
field 5; WorldSnapshotDeltaProto adds it at field 6. Their canonical in-server
forms retain this field so every encode path, including retained-state
coalescing, preserves it. An aigent connection stores the negotiated opaque
aigent identity; projection looks up only generation.aigent_bodies. Viewer
connections carry no such identity and never receive a self binding. Do not
derive identity from focus_body_id or a mutable-world lookup.

Every successfully applied full or delta restates the binding for that
generation: present means bound to that nonzero ID; absent means currently
unbound. This is independent of entity enter/leave semantics. A client clears
binding on a new handshake and snapshot recovery, adopts it only after an
entire valid transition, and holds self-dependent decisions until both binding
and own pose are observed. An initial MOVE to a known bounded plaza point may
bootstrap existing server-owned demo-body creation without guessing a body.

RealEntityRecord adds optional MoveAim at field 5 with signed millimetre
target_x_mm/target_z_mm and positive speed_mm_per_s, matching MOVE's generated
types. Project from the same generation's active_leases. Full-record equality
includes aim, so stationary target changes and lease removal appear as deltas.
Absence means only that this generation has no active movement aim. It does
not establish arrival, blockage, sleep, disconnect, or a brain's motivation.
Do not publish expiry or add delta ticks in this round; the viewer has no
countdown consumer.

Physical movement aims are deliberately public to all observers in the AOI,
including other aigents. Opaque owner identities and client-written display
text are not public records. Viewer labels are local numeric body labels.
The change adds no mutating command, persistence schema or brain authority.

The orchestrator accepts this decision under the operator's explicit
2026-10-08 delegation: proposals may change architecture, and the orchestrator
chooses everything after independent adversarial review. Both independent
reviews and the response to the first review are retained with task evidence.
This is acceptance through delegated authority, not a claim that the operator
personally reviewed these field details.

## Consequences

### Good

- Private identity is atomic with the observation that describes its body.
- Reconnect/resync/coalesced full use the same existing recovery mechanism.
- Spectators can see truthful destinations and motion without a claims channel.
- Existing v1 clients can ignore the new fields and still render positions.

### Bad

- Movement targets become public information; future hidden-intent mechanics
  must explicitly revisit this decision.
- Physical aims do not describe rich motivations; legibility must be tested
  with a cold spectator.
- Every client must apply binding replacement semantics, including absence.
- Trusted-inject authentication and full durable command-result recovery remain
  existing defects; this projection does not repair or weaken their contracts.
- The two-body demo requires a fresh journal and rejects an ambiguous larger
  observed cast; this is not a general named-resident registry.

## Validation

Shared generated Rust/JavaScript fixtures cover optional fields while old
fixtures remain byte-identical. Behavioral tests and compiling mutants cover
same-generation identity, private role boundaries, retained-state coalescing,
metadata-only aim changes/removal, reconnect/resync and unknown fields.
A fresh 90-second two-body run uses decoded authoritative positions for goal
transitions and perturbation reactions. Real Chromium proves aims/trails and
selection/follow; a separate cold spectator tests pursuit legibility.

## Follow-up

- Existing task-040 authentication and task-6036971654000001 durable results
  remain open. Sleep/wake, shape/placement and terrain presentation are separate.
- Revisit richer public motivations only if cold spectator evidence shows
  physical aims insufficient; no future round is preselected.
