# ADR 0002: World geometry and displacement semantics

**Status:** accepted
**Date:** 2026-07-29
**Task:** task-010

## Context and problem statement

The base architecture fixes a server-authoritative collision-only world, a
shared parametric primitive tree, stable monotonically assigned entity IDs,
finite server `f64` positions, fixed-point wire coordinates, sleeping bodies
outside collision, and deterministic displacement on wake, restore, and
`unstick`. It does not fix the representations and tie rules needed for Rust,
browser, SDK, persistence, and replay implementations to agree.

These choices affect public payloads, persisted world state, collider results,
and replay. They are expensive to reverse after generated types or durable
events exist, so task-010 must not encode them without operator acceptance.

## Decision drivers

- Preserve the locked collision-only and same-build deterministic-replay
  posture without promising cross-platform floating-point identity.
- Keep validation and collider derivation closed-form and bounded.
- Give every accepted or rejected geometry operation one deterministic result.
- Keep browser and owner-SDK representations lossless without hand-copied wire
  types.
- Make recovery and escape behavior terminate even when no nearby free
  position exists.

## Considered options

1. Use monotonic `uint64` entity IDs, millimetre fixed-point coordinates,
   conservative transformed AABB colliders, and a bounded deterministic
   displacement lattice.
2. Use UUID entity IDs, floating-point wire coordinates, and exact primitive or
   convex-hull collision.
3. Leave representation, contact, and displacement details to each runtime
   implementation.

Option 1 best matches the locked monotonic-ID, fixed-point-wire, bounding-volume
collider, and deterministic-order decisions. Option 2 adds distributed
allocation and geometry complexity that v1 does not require. Option 3 would
create incompatible clients and non-replayable edge behavior.

## Decision

### Identity and revisions

- `entity_id` is an unsigned 64-bit integer allocated globally in strictly
  increasing order. Allocation starts at `1`; `0` is invalid; IDs are never
  reused. Numeric unsigned order is the canonical entity order.
- An ID is allocated only when entity creation is authoritatively accepted.
  Rejected or retried creation does not consume another public ID.
- Entity revision is an unsigned 64-bit integer beginning at `1`. Each accepted
  externally visible change increments it exactly once. Rejection and a
  semantic no-op do not increment it; `0` is invalid.

### Coordinates and quantization

- Metres are the canonical unit. The coordinate system is right-handed:
  `x` and `z` are horizontal and `y` is up.
- Authoritative simulation positions are finite server `f64` values. Every
  component must be within the closed interval
  `[-100000.000, +100000.000]` metres.
- Public world-space positions, primitive dimensions, and transform
  translations use signed 64-bit integer millimetres. Decode is exact integer
  division by `1000`.
- At a client floating-point boundary the server first rejects non-finite or
  out-of-range metres, then rounds metres to millimetres using
  round-to-nearest, ties-to-even. Negative zero canonicalizes to zero. A value
  outside the world bound is never rounded back into the world.
- A 64 metre chunk coordinate is `floor(axis_metres / 64)`. Its local offset
  is in `[0, 64)` metres, so negative exact boundaries follow mathematical
  floor rather than truncation toward zero.

### Shape grammar and collider

- A shape is one rooted, acyclic tree. Each node has a unique non-zero
  unsigned node ID, at most one parent, a local translation, a normalized unit
  quaternion rotation, and exactly one primitive. Named joints are unique
  within the tree. Parent transforms compose before child transforms.
- The v1 primitives are box, sphere, capsule, cylinder, cone, and panel.
  Primitive dimensions are strictly positive millimetres except the capsule's
  cylindrical segment, which may be zero. A panel has non-zero thickness.
  Shear, non-finite values, non-positive dimensions, duplicate IDs or names,
  cycles, and budget excess reject the complete candidate shape.
- The canonical collider is the ordered union of one conservative world-axis
  aligned bounding box per transformed primitive, sorted by node ID. The AABB
  is derived analytically from the primitive's local extents and absolute
  rotation matrix. Rendering detail, color, material tags, and joint names do
  not alter collision.
- Two AABBs overlap only when their intersection has positive extent on all
  three axes. Face, edge, and point contact are legal.

### Movement and geometry mutation

- Movement sweeps every moving part AABB over the requested segment against
  terrain and every active collider. It stops at the earliest contact, with no
  bounce, push, stacking, or momentum. Zero-length movement succeeds as a
  no-op when the starting state is legal.
- Commands in a tick resolve in canonical command order. Geometry effects are
  immediately visible to later commands in that order. Equal-time blockers are
  reported by lowest entity ID.
- Placement is atomic. The server grounds the candidate against the
  authoritative heightfield, then validates bounds, budgets, overlap, and
  enclosure before allocating an entity ID. It rejects positive-volume overlap
  with any active body or object. It also rejects a placed object's aggregate
  AABB strictly containing an active aigent's aggregate AABB, even if a hollow
  composition avoids primitive overlap. Contact alone is legal.
- `set_shape` validates the complete candidate tree and its collider at the
  body's current pose. Overlap or any other failure leaves the prior shape,
  position, and revision unchanged; the server never partially applies or
  auto-displaces a rejected shape.

### Sleep, wake, restore, and unstick

- Disconnect cancels active leases before the body becomes sleeping. A sleeping
  body retains authoritative state but is absent from the broadphase and all
  placement overlap/enclosure checks. Objects may therefore be placed through
  its stored location.
- Wake and restore first test the stored position as if the body were active.
  On conflict they use the same displacement search as `unstick`; they never
  use ad hoc or random placement.
- The search operates on horizontal candidates offset from the stored origin
  by integer multiples of the active ruleset's positive
  `displacement_step_mm`. Candidate `y` is derived by grounding the body on the
  authoritative heightfield. Candidates outside the world bound or beyond the
  ruleset's finite `max_displacement_radius_mm` are excluded.
- Legal candidates are ordered by squared three-dimensional distance from the
  stored origin, then lexicographically by `(x, y, z)` signed millimetres. The
  first candidate is authoritative. Entity and obstacle iteration order cannot
  affect the result.
- If no candidate is legal, wake leaves the body sleeping, restore retains it
  sleeping with a typed recovery condition, and `unstick` rejects without
  movement. The connection/world remains available.
- `unstick` is available only after the configured consecutive blocked-tick
  threshold and is rate-limited by the ruleset. A successful displacement
  increments the entity revision, is persisted, logged, and emitted as a
  visible ordered event. Wake and restore displacement use the same observable
  result shape.

The ruleset contract owns allowed ranges and defaults for displacement step,
search radius, primitive budgets, dimensions, movement speed, lease timing,
blocked ticks, and rate limits. The workload contract owns performance limits.
The persistence contract owns durable queue and replay ordering. Those
contracts may constrain values but may not change the semantics above.

## Consequences

### Good

- Rust, browser, and SDK targets can share one lossless public representation
  and one canonical ordering.
- Bounding-volume collision, overlap, and sweep examples can use integer and
  rational derived oracles rather than platform-sensitive tolerances.
- Sleeping bodies cannot grief by reserving space, while wake and recovery
  remain deterministic and bounded.
- Failed geometry operations are atomic and cannot consume IDs or revisions.

### Bad

- Conservative AABBs produce false-positive collision around rotated or
  tapered primitives.
- Millimetre wire precision and a ruleset displacement lattice are less
  continuous than the server's internal `f64` space.
- A bounded search can leave a body sleeping even when a free point exists
  outside the configured radius or between lattice candidates.
- Aggregate-AABB enclosure rejection can conservatively reject some harmless
  sparse compositions.
- JavaScript clients must use generated 64-bit-safe representations rather
  than ordinary `number` for IDs and millimetre coordinates.

## Validation

Task-010 will add executable semantic fixtures and a pure evaluator that derive
their own results. They will cover signed half-way quantization, exact world
bounds, non-finite and out-of-range rejection, primitive validation, legal
contact, placement and `set_shape` atomicity, sleeping-body overlap, occupied
wake/restore displacement, swept thin-obstacle collision, entity-order
independence, nearest-free ties, and bounded-search failure.

Task-004 will prove generated Rust, browser, and SDK types preserve the selected
64-bit representations and typed geometry outcomes.

## Follow-up

- Operator acceptance is tracked by the task created from task-010.
- Task-012 must define constitutional ranges for every ruleset-owned geometry
  and displacement parameter named above.
