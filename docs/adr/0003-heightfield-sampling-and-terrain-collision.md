# ADR 0003: Heightfield sampling and terrain collision

**Status:** accepted
**Date:** 2026-07-29
**Task:** task-010

## Context and problem statement

The base architecture and accepted ADR-0002 require objects to rest on an
authoritative heightfield and movement, wake, and restore to validate against
terrain. They do not define the heightfield sample lattice, interpolation and
boundary rules, grounding support height, or the collision volumes used by a
swept test.

Task-010's first cold review confirmed that a flat scalar test height cannot
prove non-flat grounding or terrain tunnelling behavior. Height sampling and
terrain collision affect generated chunks, persisted modifications, replay,
server collision, and browser rendering, so they are expensive to reverse.

## Decision drivers

- Keep terrain generation and collision deterministic and chunk-seam safe.
- Reuse the accepted conservative AABB collision posture.
- Make grounding and swept terrain contact executable without an unstated
  epsilon or platform-specific mesh intersection.
- Bound candidate and swept-cell enumeration for the hobby-scale server.
- Let the browser render smooth terrain without making its `f32` mesh
  authoritative.

## Considered options

1. Store integer heights on a regular lattice, render bilinear patches, and
   derive conservative per-cell terrain-column AABBs for physics.
2. Use piecewise-constant cells for both rendering and physics.
3. Use the bilinear surface itself as exact collision geometry.

Option 1 preserves smooth rendering while giving physics closed-form,
integer-derived AABBs consistent with ADR-0002. Option 2 is simpler but makes
v1 terrain visibly blocky. Option 3 reduces conservative false positives but
substantially complicates swept collision, grounding maxima, and exact
cross-runtime fixtures.

## Decision

- Each 64 metre chunk owns a regular horizontal lattice of signed integer
  millimetre height samples. `heightfield_cell_size_mm` is a positive
  constitutional world-generation value that exactly divides `64000`; it is
  not votable at v1.
- Adjacent chunks share border sample coordinates. Generation from
  `(world_seed, global_sample_x, global_sample_z)` MUST produce identical
  signed-millimetre heights on either side of a chunk seam. Persisted edits
  address global sample coordinates and update every chunk view of a shared
  border atomically.
- The visible surface inside one cell is the bilinear interpolation of its
  four corner samples. This render surface is descriptive, not authoritative
  collision geometry.
- The canonical terrain collider for one cell is a world-axis aligned column:
  its horizontal bounds are the cell bounds; its lower bound is the negative
  world `y` limit; and its top is the maximum of the four corner heights.
  Columns use the same positive-volume overlap and legal-contact rules as
  entity AABBs.
- Cells are half-open on positive `x` and `z` edges, except cells touching the
  positive world boundary include that boundary. A footprint or sweep selects
  every cell with positive horizontal intersection; this rule prevents seam
  order from changing the candidate set.
- Grounding computes an entity's aggregate horizontal footprint, selects the
  intersected terrain columns, and translates the entity so its aggregate
  lower face equals the greatest selected column top. The input horizontal
  position is unchanged.
- Movement derives the grounded target pose from horizontal movement input,
  then sweeps every moving part AABB against every terrain column intersected
  by the swept aggregate horizontal footprint as well as active entity
  colliders. The earliest contact is authoritative. Equal-time entity
  blockers use entity ID; terrain blockers use global cell coordinate, and
  entities sort before terrain only when the exact contact time and numeric
  key are otherwise equal.
- Wake and restore accept an exact stored pose only when its aggregate lower
  face equals the current support height and its collider has no
  positive-volume overlap with terrain or active entities. Otherwise they run
  ADR-0002's shared displacement search, grounding every candidate through
  the column rule above.
- Height samples, cell coordinates, support heights, terrain AABBs, candidate
  enumeration, and conformance-oracle comparisons use integer arithmetic.
  Swept times are compared as rational numerator/denominator pairs by cross
  multiplication. Runtime `f64` contact positions remain permitted by the
  same-build replay target.

## Consequences

### Good

- Terrain grounding and tunnelling have deterministic, executable outcomes.
- Chunk seams cannot disagree about height or cell ownership.
- Physics reuses conservative AABB and rational-sweep machinery.
- Browser terrain may appear smooth without becoming authoritative.
- The cell size provides an explicit workload/collision-accuracy lever while
  remaining constitutionally fixed for a world.

### Bad

- Conservative column tops can make a body float above the visible bilinear
  surface on sloped cells.
- Small cells improve the approximation but increase broadphase and sweep
  work.
- Height edits on shared chunk borders require atomic multi-view updates.
- Changing cell size for an existing world requires migration or regeneration
  and therefore is not a normal ruleset vote.

## Validation

Task-010 will add non-flat semantic fixtures that derive:

- grounding over a footprint spanning cells of different heights;
- identical support at positive/negative cell and chunk boundaries;
- swept movement blocked by a raised terrain column even when both movement
  endpoints are otherwise clear;
- wake/restore displacement after the heightfield changes; and
- invariant results when height samples or candidate cells are supplied in a
  different order.

The evaluator will compare cell selection, squared distances, and swept contact
times using integer or rational arithmetic rather than fixture-supplied
positions or floating equality.

## Follow-up

- Operator acceptance is tracked by the task created from task-010.
- Task-012 must place heightfield cell size and sample-height bounds in the
  constitution schema.
- Task-005 will implement terrain-column broadphase integration.
