# Planning journal

Append concise dated entries for planning decisions that do not yet warrant an
ADR. Link the board task and note whether the entry is tentative or accepted.

## Entries

## 2026-08-04 — live-connection-slice

**Goal:** Make the world-server skeleton tangible over a live WebSocket path.

**Done when:** A scripted aigent issues move leases over WebSocket while an
anonymous viewer renders placeholder body positions from the live snapshot
stream, and the product gate stays green.

Approved front:
- task-031
- task-032
- task-033
- task-034
- task-035
- task-036

Assumptions: vertical demo over strict shape-before-viewer; placeholder
geometry OK; agent judgment + ADR for the stack; SQLite in this front;
single-process listen; no identity/accounts/terrain/governance. Out of scope:
Step 2 collider/shape, Postgres, production auth, viewer relay. Status:
accepted; shipped on `main` including follow-ups #38–#41.
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

## 2026-08-06 — shape-collision-slice

**Goal:** Give the world real spatial bodies — parametric shapes, derived
colliders, and swept collision — so movement is physically meaningful.

**Done when:** A scripted aigent with a multi-part body walks over non-flat
terrain, stops at contact with a second body instead of passing through it,
recovers via `unstick` when boxed in, and the viewer renders both as actual
primitives, with the product gate green.

Approved front:

1. `task-046` — authoritative entity store in the world core (risk probe)
2. `task-047` — closed-form shape-tree validation against ruleset budgets
3. `task-048` — canonical AABB collider derived from a validated shape tree
4. `task-049` — heightfield sampling and grounding
5. `task-050` — uniform spatial-hash broadphase
6. `task-051` — swept movement with a typed MOVE payload
7. `task-052` — deterministic displacement for sleep, wake, restore, unstick
8. `task-053` — `set_shape` with atomic candidate validation
9. `task-054` — real bodies through snapshots and AOI
10. `task-055` — shape trees and terrain rendered in the viewer

Assumptions: ADR-0002 and ADR-0003 stand exactly as accepted and are not
reopened mid-front; the existing tick and durability machinery can host an
entity table without an ADR-level change (`task-046` tests this, and failure
there triggers re-plan rather than a workaround); terrain is deterministic
generation only, sufficient to ground bodies; default bodies are
server-assigned, so `set_shape` is an upgrade path rather than a prerequisite
for having a body.

Out of scope: `place_object`, per-owner budgets, and chunk persistence (Step
5); identity, accounts, and key rotation (Step 4) — trusted-inject demo
identity persists through this front; comms; governance; Postgres; viewer
relay extraction; pose animation against named joints (joints are validated
and carried, not animated).

Operator-approved attack order: `task-044` and `task-041` land before
`task-054`, because real shape trees are far larger than the fixed-size
placeholder body and would otherwise expose missing AOI truncation and
undercounted outbound bytes inside a larger change. Status: accepted.
