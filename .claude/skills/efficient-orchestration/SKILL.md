---
name: efficient-orchestration
description: >-
  Use when the operator requests efficient mode, lower-cost models, liberal
  subagent use, or token savings on codebase-heavy work that can be split into
  bounded research, coding, or testing tasks. Also use when the operator asks
  to coordinate multiple tasks through another model family. Use
  agent-headless instead for one direct provider invocation.
---

# Efficient Orchestration

Spend the expensive model where its marginal judgment matters. Push
repeatable, bounded, or token-heavy work to cheaper, faster workers. The
orchestrator role — decompose, architect, synthesize, judge — never moves.
Only labor moves.

## Where the top tier earns its price

Reserve the orchestrating model for:

- Decomposing ambiguous work into clean parallel slices.
- Architecture, product, and safety tradeoffs.
- Reading conflicting worker reports and deciding what matters.
- Integrating partial implementations into one coherent plan.
- Final review, risk assessment, and user-facing synthesis.

If a task is tiny, or the validation itself needs delicate judgment, keep it
with the orchestrator. Delegation has overhead. A workhorse verifying
subtlety buys risk, not savings.

## Delegation backends

The worker a slice runs on is a dial, not an identity:

- **Default: same-family subagents**, spawned through this harness's own
  delegation mechanism at a cheaper model tier and an explicit effort level.
- **Opt-in: the other model family.** When the invocation names the
  counterpart CLI (e.g. "efficient orchestration with codex" from Claude
  Code, or "with claude" from Codex), route the **work/implementation
  slices** through `node .agent-foundry/delegate-work.mjs` (provider
  `codex` from Claude Code; provider `claude` from Codex). That preset wraps
  `agent-headless`, requires an Environment facts section in the prompt, and
  applies the write-access defaults. A different family is the point. It
  does not share the orchestrator's blind spots on a slice.

Either way, the judgment/synthesis/final-review layer is **never** delegated.
Run independent slices in parallel. Keep blocking or tightly coupled work
local. Everything below applies to both backends — where it says "worker",
read "subagent or counterpart-CLI run". Local commits still follow
`docs/SDLC.md` → "Commit authority" (do not restate it here).

## The two dials: model and effort

Model is not the only knob. Workers also take an effort level. Effort
controls how much a worker reads, verifies, and pushes through before
reporting — not just how long it thinks.

- Mechanical bulk work (inventory, log reduction, scaffolding, search
  summaries) → cheap model at **low** effort.
- Verification, review, and judge stages → keep effort **high** even on a
  smaller model.
- At low effort, workers prefer asking for context over spending tokens to
  find it — so low-effort slices need packets that leave nothing to ask
  about.

## Confirm the dials with the operator

Before the first delegation, confirm the provider, model, and effort routing
with the operator. If the operator did not already supply those choices, ask
one concise question that proposes a complete plan by tier:

- **Orchestration and judgment:** the current provider and top-tier model at
  its current effort level.
- **Work and implementation:** the same-family delegation backend, the least
  expensive available model that is capable of the bounded slices, and low or
  medium effort based on the slice type.
- **Review and verification:** the highest available cold-review ladder rung,
  preferably the configured other-family provider and model, at high effort.

Name the provider and exact model ID that are available in the active
environment. Do not invent an unavailable model. Present the proposal so the
operator can accept it unchanged or replace choices for individual tiers.
Wait for the answer before delegation begins.

If the operator already specified all provider and model choices, skip the
question and use them. If the routing is only partial, ask only for the
missing tiers and still present recommended defaults for those tiers. User
choices do not override the lifecycle, cold-review independence, or agent
boundary rules in `docs/SDLC.md`.

## Announce the confirmed dials

Once per session (and again when a dial changes), state the routing plan to
the operator: for work slices and for review/verification slices separately,
which backend and model family runs them, which specific model, and at which
effort level — plus the reason for any deviation from the defaults above.
When a dial changes mid-run (effort raised, a slice escalated to a
bigger model, work pulled back to the orchestrator), announce the change and
why as it happens. The operator should never have to ask which model and
effort produced or reviewed a given piece of work. Do not re-announce the
same plan before every slice.

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

## Waiting on external work

CI runs, deploys, and delegated workers finish on their own clock. Waiting on
them badly — a shell held open for the duration, or an output file read again
and again — costs turns and tool slots without making the work finish sooner:

- **Do not hold a shell open for a long external wait** when the harness
  offers any non-blocking way to start the work and come back to it.
  Harnesses differ, and some refuse long foreground waits inconsistently —
  confirm what this one actually supports instead of assuming a sleep-and-
  watch loop will run.
- **Do not re-read an unchanged artifact.** A poll that returns nothing new
  is a wasted round trip. Repeatedly reading a log or output file that has
  not moved is the observed failure, not a wait strategy.
- **Do not ping an unfinished review or worker.** Checking a cold-review or
  delegated-worker result that has not changed, with nothing overlapped into
  the wait, is the same waste as re-reading an unchanged file.
- **Scale the interval to what is being waited on.** Check on the cadence of
  the pipeline, not on a short fixed tick.
- **Fill the wait.** This is workflow step 5 applied to machines instead of
  workers: take the next independent slice while the external work runs, and
  return when there is a plausible reason for the result to exist.

If nothing independent remains and the result gates the task, wait once,
deliberately, and say so — rather than converting the wait into a poll loop.

## Handoff packets

Write every delegated prompt as if the worker has seen nothing — because it
has not. Apply `docs/SDLC.md` → "Agent boundaries": capability does not imply
assignment, and every packet names its objective, mutation ceiling, and scope.
Include a required section:

```markdown
## Environment facts
- <auth invocation, memory-file pointer, repo slug, path quirk already known>
```

`delegate-work.mjs` refuses prompts that omit it. Also include:

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
final `git diff` against the task. Let lighter agents gather signal. Keep
truth-judgment with the orchestrator. When workers disagree, the orchestrator
resolves it — never by majority vote among workers.

Do not repeat a worker's broad scan locally unless its evidence is missing,
contradictory, or high-risk. Re-scanning everything yourself forfeits the
savings the delegation bought.

## When a result disappoints: context, then effort, then model

Diagnose in this order. The knobs fix different failures:

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
cleanly, do not reflexively escalate. Routine work on a bigger model buys
verification you did not need at a higher per-token price. Under the
counterpart-CLI backend the same ladder applies with that CLI's dials;
`agent-headless` names them.

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
  they do not.

## Related

- `agent-headless` — the cross-family backend invocation contract
- `execute-task` — the lifecycle this operates inside; review stays cold
- `task-tracker` — recorded evidence (`task.mjs run`) and board ownership
- `plan-milestone` — slicing at milestone scale; this skill slices within a
  task
