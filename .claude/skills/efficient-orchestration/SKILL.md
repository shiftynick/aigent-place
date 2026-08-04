---
name: efficient-orchestration
description: >-
  Run the top-tier model as orchestrator — decomposition, architecture,
  synthesis, judgment — while cheaper workhorse models do bounded token-heavy
  research, coding, and testing slices. Use on "efficient mode", "efficient
  orchestration", "save tokens on this big task", "use lesser models",
  "liberal use of subagents", or any codebase-heavy work where cost matters.
  Add "with <counterpart CLI>" to route work slices to the other model family
  via this harness's bridge skill.
---

# Efficient Orchestration

Spend the expensive model where its marginal judgment matters. Push
repeatable, bounded, or token-heavy work to cheaper, faster workers. The
orchestrator's role — decompose, architect, synthesize, judge — never moves;
only labor does.

## Where the top tier earns its price

Reserve the orchestrating model for:

- Decomposing ambiguous work into clean parallel slices.
- Architecture, product, and safety tradeoffs.
- Reading conflicting worker reports and deciding what matters.
- Integrating partial implementations into one coherent plan.
- Final review, risk assessment, and user-facing synthesis.

If a task is tiny, or the validation itself needs delicate judgment, keep it
with the orchestrator — delegation has overhead, and a workhorse verifying
subtlety buys risk, not savings.

## Delegation backends

The worker a slice runs on is a dial, not an identity:

- **Default: same-family subagents**, spawned through this harness's own
  delegation mechanism at a cheaper model tier and an explicit effort level.
- **Opt-in: the other model family.** When the invocation names the
  counterpart CLI (e.g. "efficient orchestration with codex" from Claude
  Code, or "with claude" from Codex), route the **work/implementation
  slices** through the shared `agent-headless` skill (provider `codex` from
  Claude Code; provider `claude` from Codex), which owns the invocation contract,
  sandbox rules, and prompt discipline. A different family is the point: it
  does not share the orchestrator's blind spots on a slice.

Either way, the judgment/synthesis/final-review layer is **never** delegated.
Run independent slices in parallel; keep blocking or tightly coupled work
local. Everything below applies to both backends — where it says "worker",
read "subagent or counterpart-CLI run".

## The two dials: model and effort

Model is not the only knob. Workers also take an effort level, and effort
controls how much a worker reads, verifies, and pushes through before
reporting — not just how long it thinks.

- Mechanical bulk work (inventory, log reduction, scaffolding, search
  summaries) → cheap model at **low** effort.
- Verification, review, and judge stages → keep effort **high** even on a
  smaller model.
- At low effort, workers prefer asking for context over spending tokens to
  find it — so low-effort slices need packets that leave nothing to ask
  about.

## Announce the dials

Before dispatching delegated work, state the routing plan to the operator:
for work slices and for review/verification slices separately, which backend
and model family runs them, which specific model, and at which effort
level — plus the reason for any deviation from the defaults above. When a dial changes mid-run (effort raised, a slice escalated to a
bigger model, work pulled back to the orchestrator), announce the change and
why as it happens. The operator should never have to ask which model and
effort produced or reviewed a given piece of work.

## Workflow

1. Name the expensive-token risk: large repo search, long logs, broad docs,
   or repetitive edits.
2. Split independent work into slices **before** reading everything yourself.
3. Delegate research scans, repository inventory, docs extraction,
   browser/testing passes, log reduction, failure clustering, and bounded
   code edits.
4. Require compact evidence returns: files, line refs, commands run, diffs,
   failures, residual risk, stop conditions hit, and anything the
   orchestrator must decide.
5. While workers run, do orthogonal work.
6. Spend orchestrator tokens on the decision layer: compare results, resolve
   conflicts, choose the implementation path, review the final diff.

## Handoff packets

Write every delegated prompt as if the worker has seen nothing — because it
hasn't. Apply `docs/SDLC.md` → "Agent boundaries": capability does not imply
assignment, and every packet names its objective, mutation ceiling, and scope.
Include:

- The repo path and exact objective.
- Files, packages, or surfaces in scope, and anything explicitly out of scope.
- The evidence format to return.
- Verification commands or browser flows, plus what success looks like when
  that is knowable.
- Stop conditions — stop and report instead of improvising when:
  - the live code does not match the packet's assumption;
  - a verification command fails twice after a reasonable retry;
  - the work appears to require out-of-scope files;
  - the worker cannot produce concrete evidence for its claim.

## Vetting delegated work

A worker report is a **lead, not a fact**. Before acting on a high-impact
finding, opening a PR, or telling the user the work is done: reopen the
important cited files, confirm the line refs and failures, and review the
final `git diff` against the task. Let lighter agents gather signal; keep
truth-judgment with the orchestrator. When workers disagree, the orchestrator
resolves it — never by majority vote among workers.

Do not repeat a worker's broad scan locally unless its evidence is missing,
contradictory, or high-risk — re-scanning everything yourself forfeits the
savings the delegation bought.

## When a result disappoints: context, then effort, then model

Diagnose in this order; the knobs fix different failures:

1. **Fix the context first.** Most bad results are upstream: a vague packet,
   missing scope, no verification command, wrong files in view. Re-read the
   packet before touching any setting.
2. **"Didn't try hard enough" is an effort problem.** Skipped files, tests
   not run, gave up early, asked instead of investigating → same model,
   higher effort, sharper stop condition, explicit legwork demands ("run X,
   paste the output").
3. **"Didn't know enough" is a model problem.** Confidently wrong despite
   good context and visible trying — hallucinated APIs, missed subtlety,
   wrong architecture call → escalate the slice to a bigger model or pull it
   back to the orchestrator. No effort setting fixes a capability gap.

The inverse also holds: when a cheap worker has been handling its slices
cleanly, don't reflexively escalate — routine work on a bigger model buys
verification you didn't need at a higher per-token price. Under the
counterpart-CLI backend the same ladder applies with that CLI's dials; the
bridge skill names them.

## Common scenarios

Soft defaults, not rules:

- **Research:** workers scan docs, prior art, APIs, and repo surfaces; the
  orchestrator decides what evidence changes the plan.
- **Coding:** workers take bounded edits or candidate patches when file
  ownership is clear; the orchestrator owns shared-file coordination,
  integration, and final review. Never point two workers at the same files
  concurrently.
- **Testing:** the orchestrator chooses the validation strategy; workers run
  targeted tests, browser flows, screenshots, and log reduction, reporting
  exact commands, failures, likely causes, and whether failures look flaky,
  environmental, or real.
- **Debugging:** send independent workers after separate theories, logs, or
  repro paths; the final diagnosis stays with the orchestrator.

## Inside the task lifecycle

Delegation changes who does the labor, not what the lifecycle requires:

- **Delegated work is not review.** A worker that implemented or researched a
  slice is warm, not cold; the fresh-eyes review still follows the
  cold-review ladder in `docs/SDLC.md`, separately.
- **Evidence stays recorded.** Validation that a worker ran informally is
  still claimed, not recorded — the orchestrator re-runs the decisive
  commands through `task.mjs run` so the task log shows what actually
  executed.
- **Board writes stay with the orchestrator.** Workers report; the
  orchestrator moves cards, logs notes, and owns the commit per the
  commit-authority policy.

## Guardrails

- Do not delegate the immediate blocker your next step depends on.
- Do not ask multiple workers to edit the same files at the same time.
- Do not forward worker conclusions unvetted when the risk is high.
- Do not claim universal savings — the pattern pays when research,
  implementation, or testing slices genuinely parallelize, and costs when
  they don't.

## Related

- `agent-headless` — the cross-family backend invocation contract
- `execute-task` — the lifecycle this operates inside; review stays cold
- `task-tracker` — recorded evidence (`task.mjs run`) and board ownership
- `plan-milestone` — slicing at milestone scale; this skill slices within a
  task
