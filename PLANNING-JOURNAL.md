# Planning journal

Append concise dated entries for planning decisions that do not yet warrant an
ADR. Link the board task and note whether the entry is tentative or accepted.

## Entries

- 2026-07-29 — **Operator-approved in session: foundations delivery
  workflow.** Before product work, establish the private
  `shiftynick/aigent-place` remote with GitHub Actions and prove a protected,
  branch-per-task pull-request path that an agent can operate under standing
  authority with explicit governance, credential, deployment, and
  unverifiable-check exclusions (`task-019`). `task-002` now depends on that
  setup. The existing `task-014` remains after workspace scaffolding and is
  narrowed to extending the established CI workflow with the product gate and
  adding the fast pre-commit subset. Assumptions: the personal `shiftynick`
  GitHub identity remains the intended owner, the repository starts private,
  solo development uses zero required approvals, and squash merge keeps
  `main` linear.
- 2026-07-29 — **Constraint discovered during task-019.** GitHub returned
  HTTP 403 for private-repository rulesets on the current account tier.
  Everything except server-side protection can proceed while the repository
  remains private; completing the accepted finish line requires GitHub Pro or
  an explicit operator decision to make the repository public.
- 2026-07-29 — **Operator decision: make the repository public.** Public
  visibility enables the accepted protection contract without a GitHub plan
  upgrade. Active ruleset `19976689` now protects `main`, requires strict
  `process-gate`, allows squash merges only, requires resolved conversations,
  and has no bypass actors.
