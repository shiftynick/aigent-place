# Task072 interface outline (before implementation)

Logged before production bodies. ADR0014 and design-contract.md control behavior.

## Wire types

`WorldSnapshotBodyProto.demo_activity` (optional field6) and
`WorldSnapshotDeltaProto.demo_activity` (optional field7) carry the SAME complete
replacement `DemoActivitySnapshot`. Absence clears state. Wire body version1 stays.

Enums (zero is unspecified and rejected by new semantic consumers):

```text
DemoActivityPhase: READY1, SEPARATE2, REGROUP3, COMPLETE4, SUSPENDED5
DemoParticipantAvailability: UNBOUND1, MISSING_BODY2, DISCONNECTED3, AVAILABLE4
DemoActivityReason: NORMAL1, PARTICIPANT_UNAVAILABLE2, SESSION_CHANGED3,
  BODY_CHANGED4, LEASE_INACTIVE5, NO_PROGRESS6, UNSAFE_GEOMETRY7,
  COUNTER_EXHAUSTED8
```

```text
DemoActivitySnapshot {
  version: uint32(1); run_id: bytes16(2); reset_id: uint64(3);
  observed_tick: uint64(4); phase: Phase(5); phase_started_tick: uint64(6);
  completed_rounds: uint64(7); participants: Participant[2](8);
  rules: Rules(9); transition_id: uint64(10);
  recent_transitions: Transition[0..8](11);
  formation_center_mm?: Vector3Millimeters(12);
  formation_axis_mm?: Vector3Millimeters(13);
  credit_started_tick?: uint64(14); dwell_ticks: uint32(15); reason: Reason(16);
}
Participant {
  body_id?: uint64(1); availability: Availability(2);
  phase_start_position_mm?: Vector3Millimeters(3);
  travel_mm: uint32(4); contribution_mm: sint32(5); earned_tick?: uint64(6);
}
Rules {
  inner_min_mm: uint32(1); inner_max_mm: uint32(2); separate_mm: uint32(3);
  min_travel_mm: uint32(4); min_contribution_mm: uint32(5);
  dwell_ticks: uint32(6); complete_hold_ticks: uint32(7);
  recovery_hold_ticks: uint32(8); phase_timeout_ticks: uint32(9);
}
Transition {
  id: uint64(1); tick: uint64(2); from: Phase(3); to: Phase(4);
  completed_rounds: uint64(5); reason: Reason(6); reset_id: uint64(7);
}
```

`run_id` is non-auth startup input. Fixed ordered participant slots are public
numeric body identities; private owner/connection/epoch triples stay server-side.
Formation axis is a horizontal direction scaled to1000mm, length1000 within
integer rounding tolerance2mm, never a body pose. Anchors are within the bounded
plaza (horizontal ±8000mm); y stays canonical and bounded. Progress travel caps
at its published minimum; signed contribution is bounded ±32000mm and remains
net current displacement. Credit origin persists through COMPLETE, so proof ticks
may precede COMPLETE entry. READY/SUSPENDED have no credit origin/proofs/dwell.
No continuous freshness timer. Maximum encoded activity is2048bytes; production
and consumer tests must prove that bound with maximal valid state/history.

## Rust seam (worker may refine internal names before bodies, log refinements)

```rust
World::ephemeral_demo_activity(config: WorldConfig, run_id: [u8; 16]) -> World
TransportState::new_demo_activity(hub: SessionHub, allow_non_loopback: bool,
                                 run_id: [u8; 16]) -> Arc<TransportState>
World::attach_demo_participant(owner, connection_id, command_epoch)
World::detach_demo_participant(owner, connection_id, command_epoch)
DemoActivity::advance(tick, post_movement_inputs) -> bounded immutable state
DemoActivityState::to_proto() -> DemoActivitySnapshot
```

Domain activity types derive Eq and enter ImmutableGeneration; generated proto
types are adapters, not the domain model. Advance runs inside the same tentative
tick draft as movement, with actual lease motion and termination inputs. No
publication or credit before draft installation. Matching private triples guard
attach/cleanup, delayed old attach cannot displace current epoch. Token creation
runs once in startup, outside the simulation stage. Normal None digest unchanged.

## Shared consumer seam (SDK worker owns)

```js
validateDemoActivity(value) // undefined -> undefined; valid generated object -> same;
                            // malformed/unknown/oversized -> TypeError
createActivityPolicy(role) // existing policy decide interface; runner/seeker speeds
```

Validator exported by @aigent-place/protocol; one semantic validator for SDK and
viewer. It validates bounded generated decoded data before observation commits.
SDK SnapshotView stores `demoActivity` atomically with bodies. `--activity` requires
`--fresh-two-body` and excludes `--wide-plaza`. Missing/foreign state fails clearly
after bounded setup; no independent completion or phase machine. Root owns schema
and generated artifacts; SDK worker owns validator/tests/package test wiring.

## Viewer seam (viewer worker owns)

```js
activityPresentation(activity, observedBodies, freshness) // public factual rows
createActivityCueTracker() // baseline/recovery, fresh delta, reset/run/history gap
```

Live snapshot decoder validates and commits activity with body transition.
Initial/recovery FULL establishes watermark without live cue. Fresh later DELTA
may cue new IDs once. Same-run memory survives reconnect; reload starts baseline.
Strip shows phase, two IDs, own progress, rules, count, recent transitions,
last-observed/recovery and AOI omissions; no camera control mutation.

## Least certain choices and falsification

Initial physical rules1800–2200/5500/1000mm,8dwell,20hold,400timeout need actual
three fresh180s runtime trials. A five-second unequal arrival hold must complete
after both earned proof, despite STOP cancellation. Phase-reset, one-sided,
oscillating and pre-traveled stationary mutants must fail semantic assertions.
Every full promotion/resync path must carry latest replacement. Stale cleanup
must fail to remove newer epoch. Unsafe overlap must fail closed. Public layout
must retain canvas at780x493 and1280x800 and keep existing camera controls.
