# ADR 0012: Authoritative shape presentation and distinct demo bodies

- **Status:** accepted
- **Date:** 2026-10-08
- **Task:** task-068

## Context and problem statement

Round 3's fresh live critic found two nearly coincident cubes hard to
distinguish. Independent adversarial review identified a more precise defect:
the server publishes a coloured 1 x 1.8 x 1 metre shape, while the viewer draws
a locally coloured 1 metre cube. ShapeTree already carries all six primitives.
Terrain has no observation carrier, and larger routes are not proven
traversable under the existing conservative terrain-column movement rules.

The selected round is one bounded improvement: truthful shape presentation
and distinct physical demo bodies. It implements part of task-055, which stays
open for authoritative terrain, render rebasing and full interpolation.
ADR-0002's geometry and ADR-0011's observation semantics remain authoritative.

## Decision drivers

- Make inhabitants distinguishable from their actual public geometry.
- Preserve server-owned geometry, owner-run brains and read-only spectators.
- Bound validation and graphics allocation before processing a shape.
- Keep colour, material metadata and physical collision separate.
- Preserve the existing validated demo routes while checking actual motion.

## Considered options

1. Render authoritative shapes and introduce distinct validated server-owned
   demo silhouettes through existing creation, grounding and persistence.
2. Keep placeholder cubes and change local colours or add local role names.
3. Include terrain rendering, wider routes and an observational story ticker
   in the same round.

## Decision

Select option 1 after the independent proposal challenge. This adds no wire
field, persisted format or mutating owner command.

The orchestrator accepts this decision under the operator's explicit
2026-10-08 delegation: architecture changes are allowed and the orchestrator
chooses everything after independent adversarial review. The fresh challenge
and root adjudication preceded this record and all implementation. This is
acceptance through delegated authority; the operator did not personally review
these rendering details.

Render box, sphere, capsule, cylinder, cone and solid panel at the dimensions
in the decoded ShapeTree. Millimetres become metres. Origins are geometric
centres; capsule segment length excludes its two hemispheres. Parent transforms
compose before child transforms, including the root transform. Entity position
is applied once; it already includes authoritative grounding. Curved surfaces
are descriptive meshes, not substitutes for the conservative canonical AABBs.

Present RGB bytes are interpreted as sRGB and converted to the renderer's
working colour space. Alpha is the supplied byte divided by 255, including
zero; an omitted alpha within a present colour therefore remains zero.
Absent colour uses neutral sRGB grey. Material tags and joint names remain
opaque node metadata; they do not select external assets, executable shaders,
physical properties or invented material behaviour. Tessellation is bounded
renderer detail. Alpha blending has normal transparent-surface sorting limits.

Validate the complete graph and primitive/transform/colour boundaries before
graphics allocation. The viewer supports the constitutional maximum of 256
parts per entity and the existing 100-record observation cap. Reject malformed
or oversized shapes explicitly; do not silently truncate or fabricate a cube.
An absent ShapeTree is an existing valid shapeless entity: retain its position,
numeric label and aim without fabricating a surface, using point bounds at the
entity origin. A present empty tree is malformed and is treated differently.
Also enforce a 1 MiB UTF-8 presentation metadata/key budget per shape before
copying or sorting metadata. This is a viewer support limit, not a claim that
the wire contract forbids larger legal tag lists. Unsupported presentation
must remain explicit and must not cause an unlimited resync loop.
Stage a complete valid replacement before releasing old graphics. Cache an
unchanged shape so aim-only and position changes do not rebuild it. Replacement,
leave and viewer disposal release owned resources exactly once. Camera fitting
and labels derive from composed shape bounds rather than placeholder extents.

The listen/demo creation path assigns distinct composed shapes by reserved
spawn ordinal, accounting for committed, tentative and queued bodies once.
Selection never depends on owner identity, role text or an identity hash.
The stored shape is the public physical fact; a silhouette does not name a role.
Use the same 1 x 1.8 x 1 metre aggregate footprint/extents where practical to
reduce route risk. Validate against live body-class budgets before queueing
and again under the application generation before allocation and binding.
If a pending ruleset activates on that tick, use its effective budget after
the existing soak decision. A bounded cloned-store preview may resolve that
budget without moving the established command or ruleset activation stages.
Grounding, collision and existing persisted shape bytes remain authoritative.
Rejected creation must not allocate an ID or install a binding or partial body.

Reference grids stay explicitly descriptive. No terrain is reconstructed from
assumed defaults. No wider route or ticker is selected, and no new display
claims arrival, meeting, sleep, ownership or brain motivation. Physical aims
retain ADR-0011's meaning. Existing authentication, lifecycle and durable
command-result gaps remain documented; these bodies do not repair them.

## Consequences

### Good

- Spectators see geometry and colour already present in public observations.
- Distinct bodies make the current two-aigent activity easier to follow.
- Rendering has a bounded, testable boundary and explicit resource ownership.
- Existing clients and persisted generations retain their current formats.

### Bad

- Two silhouettes still exercise a limited movement-only world vocabulary.
- New compositions need physical revalidation despite matching aggregate size.
- Thousands of legal parts can remain expensive to draw; bounded allocation
  does not establish maximum-cast interactive frame rate.
- Transparent surfaces have renderer sorting limits, and opaque tags receive
  no special appearance until a separate material contract exists.
- Absolute far-world rendering and terrain remain task-055 gaps.
- A legal shape with unusually large metadata can exceed this viewer's
  presentation support; it must be reported rather than silently truncated.
- Admission results still precede durable commit under the existing known gap.

## Validation

Real Three.js tests independently check dimensions, composed poses, colour,
zero alpha, all six primitives and malformed/budget cases. Compiling mutations
must remove each changed behaviour and produce an executed red test.
Server tests cover live body budgets, pending/tentative assignment, rejected
creation and persisted/snapshot shape truth. A rebuilt fresh-world two-brain
run records at least 90 seconds of actual authoritative motion per body.
Real Chromium checks geometry, controls and an edge case; a new fresh spectator
tests silhouette distinguishability. Both cold review axes and the full gate
must complete before protected PR delivery and the next critique.

## Follow-up

- Task-055 remains open for terrain transport/rendering, 64 metre rebasing,
  full interpolation acceptance and remaining presentation issues.
- Task-040, task-052 and task-6036971654000001 remain unfinished.
- Rounds 4 and 5 are selected only after this round's validated delivery.
