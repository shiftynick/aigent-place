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

## 2026-10-08 — five-round-live-demo

**Goal:** Improve the live spectator experience and world activity equally,
so lively, goal-driven aigents produce events worth following.

**Done when:** Five sequential rounds each finish one or two selected
improvements, fresh independent proposal challenge and code review, real
runtime validation, and protected PR delivery before the next critique.

Announcement: Watch the world through a viewer that makes its activity easy
to follow. Demo aigents pursue goals and react to what happens around them.
The program improves both the inhabitants and the spectator experience;
owner-run brains retain their integration path.

Operator authority: the six-decision interview ended with "confirmed,
proceed" on 2026-10-08. The operator chose equal viewer/world weight, lively
aigents and emergent stories, goal-driven demo brains, and focused rounds.
The operator allowed product/architecture changes and delegated selection
of all proposals to the orchestrator after independent adversarial review.
This supplies planning and product-decision authority for the five rounds;
hooks, enforcement, and protected PR requirements still apply.

Approved front selected after the round-1 critique and independent challenge:

1. `task-064` — restore a visible, bounded live movement demonstration.
   Separate workers repair the actual Node demo and camera visibility. The
   combined finish line uses a rebuilt server, a fresh journal, one aigent,
   at least 1 m of observed displacement over at least 2 seconds, real
   Chromium visibility, and clean success/failure exits within 10 seconds.

Round-1 proposal records: `.tasks/review-packets/task-064-proposals/`.
Rounds 2–5 are selected only after observing the preceding round. This entry
does not preselect a reactive cast or claim that the first tracer is emergence.

The first combined runtime found an existing admission-clock defect: after
durability pauses, wall-paced scheduling can put commands far ahead of the
world tick, so motion arrives after the demo deadline. A released SQLite
write-lock reproduces it; a newly started control passes. A separate clean
challenge approved a bounded prerequisite repair inside `task-064`: derive
command admission from the earliest unstarted world tick, reject admission
into sealed in-flight ticks, and retain the wall-paced slow-client pressure
clock. This implements accepted ADR-0005 without a wire or persisted-schema
change. Failure/retry, MOVE/STOP ordering, pressure expiry and arithmetic
boundaries require regression evidence. It is part of the selected reliable
demo outcome, not a third feature. The initial browser load also exposed a
Vite optimizer reload race; the validator now waits for an actual rendered
canvas and empty baseline before launching the sole demo aigent.

The first cold review found that reconnecting during a sealed writer stall
can reset the command sequence and collide with a queued effect. A separate
source adjudicator confirmed it and challenged the bounded repair: admit a
complete local spawn/effect batch before caching a new result, cache a typed
collision rejection for stable retries, and leave fatal admission uncached.
Terminal tick exhaustion keeps role/replay classification and uses an
internal diagnostic and generic close, without a global writer-failure code.
The review also removes SDK test timing limits outside the approved rubric.
These fixes remain prerequisites within task-064. Durable-result publication
and restart recovery remain `task-6036971654000001` work; listen-loop failure
diagnostics and writer-failure handling remain `task-042` work.

Assumptions: owner-side demo brains suffice; no live-model credentials are
needed; the server remains authoritative unless a later independently
challenged and recorded decision changes the product contract. Existing
`task-052`, `task-053`, and `task-055` remain unfinished and retain their full
acceptance criteria. Round 1 does not claim terrain, general self-body
binding, six-primitive rendering, or navigation beyond the current AOI.

### Cadence audit and retrospective

Before this new milestone boundary, a read-only whole-repository audit at
`4e3e070fd2e6eb990a44f9a01390855cd1ac0816` examined both churn reports and the
transport/world/heightfield, movement, persistence, viewer/SDK, gate, and
orientation sources. Seven findings cleared the evidence bar: the actual
Node demo diverged from its test (`task-064`); connected idle bodies become
non-colliding (`task-052`); SessionHub retains closed connections (`task-043`);
workload timing excludes live scheduled fanout (`task-7210989894000007`);
transport failures escape authoritative results (`task-042`); runtime catalog
guards remain partial (`task-2929451841000002`); and orientation facts have
drifted (`task-065`). Five reuse existing cards; two are new cards. File size
alone, independent runtime/oracle geometry, unfinished product verbs, and
unbounded replay redesign were considered and dropped. No new review lens
was added: existing executable-example and lifecycle lenses cover these
findings; round 1 directly runs the real Node entry point.

The first recorded retrospective covers 2026-07-29–2026-10-08. The signal
sweep examined 83 cards: 8 friction notes, 4 forced transitions, 12 cards
with review churn, and 102 failed recorded runs, including deliberate reds.
One pattern cleared the three-occurrence bar: `task-003`, `task-060`, and
`task-061` were marked done before required evidence or findings were
resolved, then reopened. A bounded point-of-use correction is `task-066`,
tagged `needs:operator`; implementation is outside the app program.
No pruning is justified without two recorded inactive windows. Watched:
shell/commit syntax mismatch (`task-046`, `task-047`) and provider/wrapper
timeout mismatch (`task-048`, `task-049`, already addressed by Foundry).
`LOCAL-CHANGES.md` has no unsent or packeted upstream entries.

## 2026-10-08 — five-round-live-demo

**Goal:** Improve the live spectator experience and world activity equally,
so lively, goal-driven aigents produce events worth following.

**Done when:** Five sequential rounds each finish one or two selected
improvements, fresh independent proposal challenge and code review, real
runtime validation, and protected PR delivery before the next critique.

Approved front under the operator's confirmed selection delegation:

1. `task-064` — round1 complete through PR70, protected squash9274ffe,
   exact-head and main-push gate green; typed bounded MOVE and camera controls.
2. `task-067` — round2 responsive runner/seeker demo and truthful spectator
   aims/trails/selection/follow, with same-generation snapshot self binding.

Announcement: Two demo aigents stay active in a small plaza. One visits nearby
points, and the other responds to its observed position. Their movement targets
and recent paths help you follow what happens. Select a body and follow its
motion; owner-run brains use the same generated movement protocol.

The fresh live critic saw501 updates over25.019s with one unmoving body and
recommended sustained activity plus legibility. A separate adversarial review
returned Revise, removing a client-written name/goal channel and requiring
correct self binding and position-based recovery. A second clean reviewer
verified existing full/delta carriers and returned Proceed with additive private
self binding plus public physical target/speed aims. Root adopted this revised
pair and accepted ADR0011 using the operator's explicit architecture-selection
delegation. Concise evidence is `.tasks/evidence/task-067/proposal-adjudication.md`.

Three isolated patch workers own server/protocol, demo brains and viewer; root
owns integration, contracts and delivery. Runtime acceptance uses a fresh exact
two-body journal,90s, at least2 observed-position-driven goal transitions each,
perturbation response within15s, independent stop, reconnect/resync, truthful
aims and a30s cold spectator read. Fixed choreography, self guesses or invented
lifecycle text fail acceptance. No future round is selected before this result.

Assumptions: demo brains suffice; no model credentials are needed; movement
aims are public physical intent, not rich motivation. Full durable results
remain task-6036971654000001; auth, sleep/wake, shape/placement and terrain
presentation remain separate existing tasks. All protected delivery and gate
requirements are unchanged.

Round2 implementation/runtime checkpoint: all workers integrated, lost initial
bootstrap recovery fixed with real CLI regression, rootSDK47/47 passing. The
final-source190s run passes14 independent physical checks: first90s travel
32.674m/42.416m,14 qualifying meetings, same-body reconnect, separate STOPs
and actual brain/observer exits0. Native and fresh30s spectator checks pass;
close-pass label overlap remains a low task055 follow-up. Both fresh rung1 cold
axes completed and are adjudicated; a new independent auditor reproduced the
raw physical evidence and verified mutant receipts/current manifests. The97.2s
full gate passed on final production sources. Closeout documentary review,
post-closeout gate and protected PR delivery remain.
