# Blocked journal

Append blockers that survive the current task turn. Every entry must identify
the task, exact blocking condition, evidence already checked, and a concrete
`Resume:` command or action.

## Entries

- 2026-07-29 — `task-019` cannot enable server-side `main` protection or make
  `process-gate` required while `shiftynick/aigent-place` is private on the
  current GitHub account tier. GitHub ruleset API returned HTTP 403 with
  "Upgrade to GitHub Pro or make this repository public." Local validation
  passes, draft PR #1 is open, and clean Ubuntu run `30458820759` passed.
  Repository settings already enforce squash-only merge methods and automatic
  branch deletion, but these are not substitutes for branch protection.
  **Resume:** choose GitHub Pro or explicitly authorize public visibility;
  then activate the documented ruleset, require `process-gate`, verify live
  settings, update task/PR evidence, mark PR #1 ready, and complete it.
  **Resolved 2026-07-29:** the operator chose public visibility. Ruleset
  `19976689` is active with `process-gate` required and no bypass actors.

- 2026-07-29 — `task-002` cannot encode the public v1 protocol envelope until
  the operator decides proposed
  [ADR-0001](docs/adr/0001-protocol-v1-compatibility-and-recovery.md).
  Independent contract scans confirmed that `ARCHITECTURE.md` fixes the
  high-level invariants but not the expensive-to-reverse version-selection,
  cross-epoch idempotency, or ordered-event recovery semantics. Task `task-020`
  is the `needs:operator` decision card.
  **Resume:** accept ADR-0001, reject it, or request specific changes; then
  complete task-020, remove `needs:operator` from task-002, return task-002 to
  `in_progress`, and implement the schema, contract, and executable examples.
  **Resolved 2026-07-29:** the operator explicitly accepted ADR-0001 as
  written. Task-020 records the decision and task-002 may resume.

- 2026-07-29 — `task-010` cannot encode the public and persisted world
  geometry contract until the operator decides proposed
  [ADR-0002](docs/adr/0002-world-geometry-and-displacement-semantics.md).
  Two isolated contract scans confirmed that `ARCHITECTURE.md` fixes the
  high-level physics, shape, sleep, and coordinate invariants but not entity
  ID width, fixed-point precision and rounding, primitive transform/collider
  derivation, contact and enclosure semantics, sleeping-body placement, or
  bounded deterministic displacement. Task `task-022` is the
  `needs:operator` decision card.
  **Resume:** accept ADR-0002, reject it, or request specific changes; then
  complete task-022, remove `needs:operator` from task-010, return task-010 to
  `in_progress`, and implement the normative contract plus executable
  conformance examples.
  **Resolved 2026-07-29:** the operator explicitly accepted ADR-0002 as
  written. Task-022 records the decision; task-010 may resume when that
  decision card completes its validation and review.

- 2026-07-29 — `task-010` cannot finish grounding, terrain collision, wake,
  or restore conformance until the operator decides proposed
  [ADR-0003](docs/adr/0003-heightfield-sampling-and-terrain-collision.md).
  The first cold SPEC and STANDARDS reviews confirmed that the accepted
  architecture names an authoritative heightfield but does not define its
  sample lattice, chunk-seam ownership, support-height boundaries, or
  sweepable collision geometry. Those choices affect persisted chunks,
  replay, server collision, and browser terrain. Task `task-023` is the
  `needs:operator` decision card.
  **Resume:** accept ADR-0003, reject it, or request specific changes; then
  complete task-023, remove `needs:operator` from task-010, return task-010 to
  `in_progress`, implement the accepted terrain model, fix the remaining
  adjudicated round-1 findings, and re-run separate cold SPEC and STANDARDS
  reviews.
  **Resolved 2026-07-29:** the operator explicitly accepted ADR-0003 as
  written. Task-023 records the decision; task-010 may resume when that
  decision card completes its validation and review.
