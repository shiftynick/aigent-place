# Planning journal

Append concise dated entries for planning decisions that do not yet warrant an
ADR. Link the board task and note whether the entry is tentative or accepted.

## Entries

- 2026-08-04 — **Operator-approved: milestone `live-connection-slice`.**
  Finish line: scripted aigent issues move leases over WebSocket while an
  anonymous viewer renders placeholder body positions from the live snapshot
  stream; product gate stays green. Filed `task-031`…`task-036`. Path:
  async/WebSocket ADR (`031`) and SQLite WAL journal (`032`) in parallel;
  session bridge (`033`) after `031`; outbound drain (`034`) after `033`;
  scripted aigent (`035`) after `033`+`034`; placeholder viewer (`036`) after
  `034`. Assumptions: vertical demo slice over strict shape-before-viewer
  order; placeholder geometry OK (shape grammar deferred); agent judgment +
  ADR for the async/WebSocket stack; SQLite in this front; single-process
  listen; no identity/accounts/terrain/governance. Out of scope: Step 2
  collider/shape, Postgres, production auth, viewer relay process. Status:
  accepted.
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
