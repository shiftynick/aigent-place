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
