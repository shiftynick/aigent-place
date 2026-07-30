# World geometry contract v1

This is the normative Step 0 contract for entity identity, coordinates, shape
trees, collision, geometry mutation, sleeping bodies, deterministic
displacement, and `unstick`.

It implements
[ADR-0002](../../docs/adr/0002-world-geometry-and-displacement-semantics.md)
and
[ADR-0003](../../docs/adr/0003-heightfield-sampling-and-terrain-collision.md),
with terminal revision behavior fixed by
[ADR-0004](../../docs/adr/0004-terminal-revision-and-forced-sleep.md).
The public message definitions live in
[`aigent.proto`](../../protocol/v1/aigent.proto). The executable semantic
examples are
[`conformance/physics-shapes-v1.json`](conformance/physics-shapes-v1.json).

The words **MUST**, **MUST NOT**, **SHOULD**, and **MAY** are normative.
Generated-code and binary protobuf conformance remain owned by task-004.

## 1. Authority and atomicity

The world server is the sole authority for entity state and collision. Every
operation in one 50 ms tick reads one frozen ruleset generation. Commands use
the canonical ordering defined by the base architecture; a geometry effect
accepted earlier in that order is visible to every later command in the tick.

A geometry operation is atomic. It either publishes its entire new state and
one authoritative result, or publishes no state change. Rejection does not
allocate an entity ID, increment an entity revision, or partially install a
shape.

This contract defines domain outcomes. Envelope admission, command sequencing,
idempotency, and result replay follow the
[protocol v1 contract](../../protocol/v1/CONTRACT.md); an exact-next
domain-level rejection is still a recorded `CommandResult` and advances the
accepted command sequence.

## 2. Entity identity and revision

- `entity_id` is a protobuf `uint64` in the inclusive range
  `1..18446744073709551615`. Zero is invalid.
- The server allocates IDs globally in strictly increasing order only after a
  creation command has passed every validation stage and its durable mutation
  is accepted. IDs are never reused.
- Canonical entity ordering is unsigned numeric order, not decimal-string,
  byte-string, locale, insertion, or hash iteration order.
- `revision` is a non-zero `uint64` beginning at `1`.
- One accepted externally visible mutation increments the affected entity
  exactly once. A semantic no-op or rejection does not increment it.
- A command that mutates several entities increments each changed entity once
  and returns every affected `(entity_id, revision)` pair in numeric ID order
  through `CommandAccepted.affected_world_entities`.
- Revision `18446744073709551615` is reserved for terminal forced sleep.
  Externally requested mutations at revision `18446744073709551614` or greater
  reject without effect as `REVISION_EXHAUSTED`, preserving one final
  increment for disconnect safety. An exact-pose restore at the predecessor is
  a non-mutating startup operation and is therefore permitted; a restore that
  requires displacement rejects before consuming the reserved increment.
- Disconnecting an active entity at the reserved predecessor cancels leases,
  sleeps it, and increments to the terminal revision. Terminal entities remain
  permanently sleeping and non-colliding; wake, restore-to-active, movement,
  `set_shape`, and `unstick` reject as `REVISION_EXHAUSTED`.
- An active entity loaded at the terminal revision is invalid persisted state.
  Recovery makes it terminal sleeping without arithmetic and never admits it
  to the active broadphase. The server records
  `WORLD_RECOVERY_DIAGNOSTIC_CODE_TERMINAL_REVISION_FORCED_SLEEP` in its
  durable recovery log and publishes `WorldRecoveryDiagnostic` to active
  connections as `Percept.payload` with
  `PERCEPT_KIND_WORLD_RECOVERY_DIAGNOSTIC`.
- Exhausting the `uint64` ID space or externally usable revision space is a
  typed no-effect capacity rejection (`ENTITY_ID_EXHAUSTED` or
  `REVISION_EXHAUSTED`); arithmetic MUST NOT wrap to zero.

JavaScript and JSON tooling MUST use a lossless 64-bit representation such as
generated `bigint` or canonical unsigned decimal strings. Ordinary JavaScript
`number` is not a valid entity-ID representation.

## 3. Coordinates and chunks

### 3.1 Canonical space

Metres are the canonical unit. The coordinate system is right-handed: `x` and
`z` are horizontal, and `y` is up. Authoritative simulation and stored
positions are server `f64`.

Every supplied coordinate component MUST be finite and within the closed
interval `[-100000.000, +100000.000]` metres. A collider's complete derived
AABB MUST also remain inside that interval on all axes. NaN, positive or
negative infinity, and an out-of-range value are rejected before ruleset,
collision, budget, or state mutation work.

### 3.2 Wire quantization

Public positions, primitive dimensions, and transform translations are signed
integer millimetres. Their protobuf representation is `sint64`.

When a boundary accepts floating-point metres, it MUST:

1. reject a non-finite value;
2. reject a value outside the metre bound;
3. multiply by `1000`;
4. round to the nearest integer, choosing the even integer on an exact tie;
5. canonicalize negative zero to integer zero; and
6. confirm that the quantized value is within
   `[-100000000, +100000000]` millimetres.

Validation before rounding is load-bearing: `100000.0004` metres is rejected,
not rounded back to the positive boundary. Integer millimetres decode to `f64`
metres by exact division by `1000`.

### 3.3 Chunks

For either horizontal axis:

```text
chunk = floor(axis_metres / 64)
local = axis_metres - chunk * 64
```

`local` is in `[0, 64)` metres. Mathematical floor is required, so `-64`
belongs to chunk `-1` at local `0`, and `-0.001` belongs to chunk `-1` near
local `64`. Chunk coordinates are signed `i32`.

### 3.4 Heightfield lattice

Each chunk owns a regular horizontal lattice of signed integer-millimetre
height samples. `heightfield_cell_size_mm` is positive, exactly divides
`64000`, and is fixed constitutionally for the world. Samples are addressed
by global integer `(sample_x, sample_z)` coordinates; generation is a pure
function of `(world_seed, sample_x, sample_z)`. Shared chunk-border samples
therefore have one value, and persisted border edits update every chunk view
atomically.

The visible terrain is the bilinear interpolation of the four cell corners,
but rendering is not collision authority. Physics derives one AABB column per
cell: horizontal bounds are the cell bounds, the lower `y` bound is the
negative world limit, and the upper bound is the greatest of the four corner
samples. Cells are half-open on positive `x` and `z` edges, except at the
positive world boundary. A footprint selects every cell with strictly
positive horizontal intersection.

## 4. Shape tree

One grammar is used for aigent bodies, placed objects, rendering parameters,
colliders, and budget accounting.

### 4.1 Tree and transforms

A `ShapeTree` MUST contain exactly one root and at least one node.

- `node_id` is unique, non-zero `uint32`.
- The root alone has `parent_node_id = 0`. Every other parent ID names a node
  in the same tree.
- Parent references MUST form one connected acyclic tree.
- Input array order is not semantic. Canonical node order is ascending
  `node_id`.
- Each node has one `LocalTransform` and exactly one primitive.
- World transforms compose parent before child. Scale and shear do not exist;
  size is expressed only by primitive parameters.
- A rotation is a finite quaternion `(x, y, z, w)` whose squared magnitude is
  within `1e-6` of `1`. The server normalizes it once. The first non-zero
  component in `(w, x, y, z)` is made positive so `q` and `-q` have one
  canonical representation.
- Joint names and material tags are ASCII identifiers matching
  `[a-z][a-z0-9_.-]{0,63}`. Joint names are unique within a tree. Duplicate
  material tags on one node are invalid. Material-tag order is not semantic;
  accepted state stores tags in ascending ASCII byte order.
- RGBA components are integers in `0..255`.

Any missing primitive, duplicate identity, broken parent, cycle, invalid
identifier, non-finite transform, invalid quaternion, invalid color, or
ruleset-budget excess rejects the complete shape as `invalid_shape`.

### 4.2 Primitive parameters

Primitive local origins are their geometric centres. Capsule, cylinder, and
cone axes are local `y`.

| Primitive | Parameters and local half-extents |
| --- | --- |
| box | positive `size_x_mm`, `size_y_mm`, `size_z_mm`; half-extents are each size divided by two |
| sphere | positive `radius_mm`; half-extents `(r, r, r)` |
| capsule | positive `radius_mm`, non-negative `segment_length_mm`; half-extents `(r, segment/2 + r, r)` |
| cylinder | positive `radius_mm`, positive `height_mm`; half-extents `(r, height/2, r)` |
| cone | positive `radius_mm`, positive `height_mm`; conservative half-extents `(r, height/2, r)` |
| panel | positive `width_mm`, `height_mm`, and `thickness_mm`; local axes are width `x`, height `y`, thickness `z` |

All parameters use the signed `sint64` millimetre wire representation from
section 3.2, MUST satisfy the positive or non-negative constraints above, and
MUST fit the active ruleset's primitive and aggregate bounds.

## 5. Canonical collider

Each node contributes one conservative world-axis aligned bounding box. Given
local half-extents `h` and the node's composed rotation matrix `R`, world
half-extents are:

```text
world_half_extent[i] = sum(abs(R[i,j]) * h[j], j = x,y,z)
```

The AABB centre is the node origin after composed transforms and entity
translation. The entity collider is the ordered union of node AABBs in
ascending node-ID order; boxes are not merged into a hull.

Two AABBs overlap only if their intersection has strictly positive extent on
all three axes. Face, edge, and point contact are legal. Collision code MUST
NOT introduce an unstated epsilon. Same-build replay, not cross-platform
floating-point identity, is the determinism target.

The aggregate AABB is the component-wise minimum and maximum over the node
AABBs. It is used for world-bound, broadphase, budget, and enclosure checks;
it does not replace the ordered AABB union for overlap or sweep.

Active bodies and placed objects contribute colliders. Sleeping bodies do not.
The broadphase is a uniform spatial hash rebuilt from a published immutable
generation; its cell size is ruleset/workload policy and cannot alter
narrowphase results.

Grounding translates an entity vertically until its aggregate lower face
equals the greatest terrain-column top beneath cells having positive-area
intersection with its aggregate horizontal footprint. Horizontal coordinates
do not change. Terrain columns participate in overlap, wake, restore, and
continuous movement using the same legal-contact rule as entity AABBs.

## 6. Movement

Movement is a continuous swept test over the full requested segment, never an
endpoint teleport.

For every moving-node AABB and every terrain or active-obstacle AABB, the
server computes slab entry and exit times on each axis. A pair contacts during
the segment when the maximum entry time is no greater than the minimum exit
time and the interval intersects `[0,1]`. The authoritative body translation
is the earliest contact position, or the requested endpoint when no contact
exists.

- The response is `blocked`, never bounce, push, stack, or momentum.
- Legal contact at the starting position does not itself block motion away
  from the contact.
- Initial positive-volume overlap is an invalid world state and MUST be
  repaired through restore displacement before normal movement.
- Zero-length movement in a legal state is an accepted semantic no-op.
- Equal-time blockers use a normalized signed-integer key. An entity key is
  `(entity_id, 0)` and a terrain key is global `(cell_x, cell_z)`;
  lexicographically lower keys win. When the exact time and both key
  components are equal, the entity sorts first.
- Commands are resolved by the architecture's exact
  `(arrival_tick, aigent_id, sequence)` tuple. Entity-ID ordering governs
  collection iteration and multi-entity restore, not command order. An
  `aigent_id` is compared as an unsigned lexicographic byte string. An earlier
  accepted position participates in later sweeps. Every conformance move
  supplies a canonical non-negative decimal `arrival_tick`, a non-empty opaque
  `aigent_id`, and a positive canonical decimal `sequence`; the oracle rejects
  missing or malformed ordering metadata rather than inventing a fallback.

Conformance comparisons represent slab entry and exit times as reduced or
cross-multiplication-safe rational numerator/denominator pairs. Runtime
contact positions remain server `f64`; fixture oracles MUST NOT use
floating-point equality or an unstated decimal-rounding epsilon to choose the
winner.

The server retains its contact `f64` position. Public snapshots/results
quantize that position by section 3.2; quantization does not move the
authoritative collider through the contact plane.

## 7. Placement and `set_shape`

### 7.1 Placement

`PLACE_OBJECT` payload bytes MUST encode `PlaceObjectPayload`. The client
supplies horizontal `x_mm`, `z_mm`, and the complete shape. The server derives
`y` by translating the candidate until its aggregate lower face touches the
maximum authoritative heightfield value under its horizontal aggregate
footprint.

Validation order is:

1. payload framing and supplied-coordinate validity;
2. tree, transform, and primitive validity;
3. complete collider inside the world bound;
4. ruleset ownership, part, joint, size, area, and object budgets;
5. positive-volume overlap with active bodies or objects;
6. enclosure of an active aigent.

Enclosure means the candidate object's aggregate AABB strictly contains an
active aigent's aggregate AABB on both horizontal axes and covers its full
vertical interval. Vertical boundary equality is allowed so two
heightfield-grounded shapes can still form a cage. This conservative check
also catches a hollow composition whose individual parts do not overlap the
body. Sleeping bodies are absent from both overlap and enclosure checks.

Overlap rejects as generic `COMMAND_REJECTION_CODE_CONFLICT` with
`PHYSICS_REJECTION_CODE_OVERLAP`. Hollow enclosure rejects as generic
`CONFLICT` with `ENCLOSES_AIGENT`. Validation and ruleset failures use
`INVALID_INTENT` or `RULESET_VIOLATION` respectively with the matching
`PhysicsRejection`. The first failure in the order above is authoritative.

Only after all validation succeeds may persistence allocate the next entity
ID. The accepted object begins at revision `1`.

All typed physics failures map to the outer `CommandRejected.code` below:

| Physics rejection | Outer command rejection |
| --- | --- |
| `INVALID_COORDINATE`, `OUT_OF_WORLD_BOUNDS`, `INVALID_SHAPE`, `UNSTICK_NOT_ELIGIBLE` | `INVALID_INTENT` |
| `OVERLAP`, `ENCLOSES_AIGENT`, `NO_FREE_POSITION` | `CONFLICT` |
| `ENTITY_ID_EXHAUSTED`, `REVISION_EXHAUSTED` | `BUDGET_EXCEEDED` |

Ruleset-owned limits continue to use `RULESET_VIOLATION`, and an unstick
rate-limit failure uses `RATE_LIMITED`.

### 7.2 `set_shape`

`SET_SHAPE` payload bytes MUST encode `SetShapePayload`. The complete
candidate tree replaces the prior tree only if it passes shape, world-bound,
budget, terrain and active-entity overlap, and active-aigent-enclosure
validation at the entity's current pose.

Failure preserves the previous tree, position, and revision. The server never
partially installs, clamps, or auto-displaces a rejected shape. A candidate
whose canonical tree equals the installed canonical tree is an accepted
semantic no-op and preserves revision; any other acceptance increments the
entity revision exactly once.

## 8. Sleep, wake, restore, and displacement

Disconnect first cancels every active lease, then marks the body sleeping and
removes it from the active broadphase. This forced transition increments once,
including from the reserved predecessor to terminal revision. An
already-sleeping body is a semantic no-op at every revision. The sleeping body
retains identity, revision, shape, and stored position. Because it does not
collide, active bodies may cross it and objects may be placed through its
stored location.

Wake and restore test the stored position against the current frozen ruleset,
heightfield, world bound, and active colliders. The exact stored pose is legal
only when its aggregate lower face equals the current support height and it
has no positive-volume overlap with terrain or active entities. A conflict
invokes the shared search below. Multiple restored bodies are processed by
ascending entity ID, so each accepted earlier position is visible to the next.

### 8.1 Candidate search

Let `step` be the ruleset's positive `displacement_step_mm` and `radius` its
finite non-negative `max_displacement_radius_mm`. Wake and restore first test
the exact stored server `f64` position. If it conflicts, the search anchor
`(ox, oy, oz)` is that position's ties-to-even millimetre projection.
`unstick` always uses the current position's projected anchor.

1. Generate every integer pair `(kx, kz)` for which
   `(kx * step)^2 + (kz * step)^2 <= radius^2`.
2. Candidate horizontal coordinates are
   `(ox + kx * step, oz + kz * step)`.
3. Derive authoritative candidate `y` by the same grounding rule as
   placement. Its ties-to-even millimetre projection is the `y` value used by
   distance and tie comparisons.
4. Exclude a candidate outside the world bound, over budget, or overlapping
   active geometry. For `unstick`, also exclude `(kx, kz) = (0,0)`.
5. Order remaining candidates by squared three-dimensional integer-millimetre
   distance from the projected anchor, then signed-millimetre `(x, y, z)`
   lexicographic order.
6. Select the first candidate.

This is the nearest legal candidate in the configured lattice, not a claim
about every continuous point. Search terminates because the radius is finite.
Obstacle/entity input order has no effect.

### 8.2 Outcomes

- Wake at the stored position or at a displaced position makes the body active
  and increments its revision once. If no candidate exists, the body remains
  sleeping and body-mutating commands reject with `NO_FREE_POSITION`; the
  connection remains usable.
- Restore at the stored position preserves the persisted revision. A displaced
  restore increments it once and emits the recovery displacement. If no
  candidate exists, the body is restored sleeping with a typed
  `NO_FREE_POSITION` recovery condition; world startup continues.
  Exact-pose restore is consequently valid at the reserved predecessor, while
  displaced restore there rejects as `REVISION_EXHAUSTED` and remains sleeping.
- `UNSTICK` payload bytes MUST encode empty `UnstickPayload`. It is eligible
  only when the active body has a movement lease blocked for at least the
  ruleset threshold and the owner is within the unstick rate limit. Ineligible
  requests reject with `UNSTICK_NOT_ELIGIBLE`; rate-limit failures use the
  generic `RATE_LIMITED` rejection. No-candidate failure leaves the body
  unchanged.
- Successful `unstick` teleports to the selected candidate, clears the blocked
  counter and movement lease, increments revision once, persists the mutation,
  logs it, and emits a visible ordered event.

Successful displacement results use `PhysicsCommandResult` with the
authoritative position and `displaced = true`; the affected ID and revision
exist only in `CommandAccepted.affected_world_entities`. A domain rejection is
carried in `CommandRejected.payload` as `PhysicsRejection`. Envelope-level
behavior and idempotent result replay remain unchanged.

## 9. Conformance boundary

The semantic fixture format is not a wire schema. It uses canonical decimal
strings for 64-bit IDs and exact decimal coordinate inputs so JavaScript
cannot silently lose precision. Opaque aigent IDs use their UTF-8 fixture
bytes for the protocol's unsigned bytewise order. Heightfield samples use
integer `sample_x`, `sample_z`, and `height_mm` fields; sample coordinates are
global lattice indices, not millimetre positions. The evaluator:

- derives quantization, shape bounds, overlap, swept contact, command order,
  grounding, and displacement candidates from fixture inputs;
- never accepts fixture-provided collision or nearest-position oracles;
- performs no network, storage, wall-clock, locale, random, or scheduler work;
  and
- canonicalizes only fields whose order is explicitly non-semantic.

Task-004 replaces semantic payload stand-ins with generated/binary protobuf
round trips without changing these outcomes.
