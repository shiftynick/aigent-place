---
name: plan-milestone
description: >-
  Decompose an operator-agreed goal into a dependency-ordered, context-sized
  task front on the board — and re-plan an existing front when evidence
  invalidates it. Use when the user says "plan the next milestone", "what
  should the next phase be", "break this goal down", "re-plan", or when
  `execute-task`'s completion check finds the current front exhausted or
  invalidated. The operator approves the plan before any task is filed.
  Distinct from task-tracker (which stores tasks) and execute-task (which
  consumes them): this skill produces them.
---

# Plan Milestone

`execute-task` consumes well-formed tasks. This skill creates those tasks.
It also corrects them when the plan behind them stops being true.

The contract: **humans steer at the milestone level, agents execute at the
task level.** The agent proposes a plan. The operator approves it. Only then
does it become board state. Within an approved front, agents adjust freely.
A *new direction* always passes through this skill and an operator's yes.

## When to run

- The board's claimable front is nearly exhausted and the project is not done.
- A completed task invalidated the approach behind queued work (the re-plan
  check in `execute-task` step 7 fired at milestone scope).
- The operator states or changes a goal.
- On request: "plan the next milestone", "re-plan".

Do not run it to add one follow-up task (`task.mjs add` is enough). Do not
re-litigate a milestone the operator just approved because execution feels
hard three tasks in. That is a blocker or a decision point, not a plan.

## Procedure

### 1. Name the goal and its finish line

Write one sentence for the outcome. Add an observable definition of done for
the *milestone* (not per task): what works when this front is complete. If
you cannot state the goal this way, the missing piece is a decision, not a
plan. Use `grill-me` or surface a `needs:operator` task before planning.

### 2. Gather evidence before decomposing

Read the live state that constrains the plan: the board (`task.mjs board`,
including `blocked` and recent `done`), accepted and proposed ADRs,
`HANDOFF.md`, the journals, and the code areas the goal touches. A plan
written from memory of the codebase produces tasks that fight reality. The
step-1 rubric of the first executed task will expose that immediately.

### 3. Decompose against the constraints

Break the goal into tasks. Every card must satisfy the board's own rules:

- **One fresh context each** — claim, implement, review, validate, commit.
  Bigger than that is an epic. Split it before filing, never after.
- **Durable descriptions** — behaviors and interfaces, not file paths and
  line numbers (see `task-tracker` on writing durable descriptions).
- **Observable acceptance criteria** per task, checkable by a cold reviewer.
- **Real dependencies only.** `--blocked-by` edges that mirror actual
  sequencing, not narrative order. Independent tasks stay independent.
  Parallel agents live on that property.
- **Front-load the risk.** Put the task most likely to invalidate the plan
  first, in cheapest-probe form. Re-plan after task one, not task nine.

Where the goal forks on an architecture choice, plan up to the fork. File
the decision as a `proposed` ADR plus `needs:operator` task. Scope the
milestone to end there. Do not plan both branches.

### 4. Propose to the operator — before filing anything

Present the plan as a compact review artifact:

```markdown
## Milestone: <name>

Goal: <one sentence> — done when <observable finish line>.

| # | Task | Depends on | Risk it retires |
| - | ---- | ---------- | --------------- |
| 1 | ...  | —          | ...             |

Assumptions this plan stands on: <the load-bearing ones>
Explicitly out of scope: <what a reasonable reader might expect but won't get>
```

Then wait. **No task is filed until the operator approves.** If the operator
amends, amend and re-present. Silence is not approval. This is the one
deliberate synchronous human gate in the lifecycle. Everything downstream of
it is autonomous because this step happened.

### 5. File the front

On approval, file each task with the milestone tag and the dependency edges:

```bash
node .claude/skills/task-tracker/scripts/task.mjs add "<task title>" --priority p1 --tag milestone:<name> --tag area:<area> --blocked-by task-NNN --description "<durable description + acceptance criteria>"
```

Record the approved plan summary in `PLANNING-JOURNAL.md` with this stable
header so the operator status can quote the approved direction without
generating prose:

```markdown
## YYYY-MM-DD — <milestone-tag-suffix>

**Goal:** <the approved one-sentence goal>

**Done when:** <the approved one-sentence finish line>

Approved front:

1. `task-NNN` — <short outcome>

Assumptions: <the load-bearing assumptions>
```

Use the exact suffix carried by `milestone:<name>`. List every task ID in
the approved front. Append entries in chronological order. If two accepted
entries share a date, the later one supersedes the earlier one. That entry
is what a future re-plan diffs against.

### 6. Re-planning an existing front

When evidence invalidates queued work:

1. Name what changed and which assumption from the journal entry it broke.
2. List the queued tasks the break reaches. Untouched tasks stay untouched.
   Re-planning is surgery, not amputation.
3. Propose the delta to the operator: tasks to drop, amend, add, re-order.
   Small deltas are still proposals. They change agreed direction.
4. On approval: `task.mjs edit` / `rm` / `add`, then append a complete
   replacement entry in the stable format above, including the current full
   approved front and the reason for the change. The status projection reads
   the latest accepted entry. It does not reconstruct a chain of deltas.

## Anti-patterns

- **Filing first, asking after.** The board is shared state. A filed plan
  creates momentum an operator has to push against. Propose, then file.
- **The hundred-task plan.** Past one or two milestones of visibility, tasks
  are speculation wearing card costumes. Plan the front you can see. Note
  the horizon beyond it in the journal instead.
- **Epics in disguise** — "Implement the sync engine" is a milestone name,
  not a task title.
- **Phantom dependencies** that encode "it felt like the right order" and
  serialize work that could run in parallel.
- **Re-planning as churn.** If every completed task triggers a re-plan, the
  decomposition is too speculative. Plan a shorter front.
- **Padding the plan** with process tasks ("set up X", "investigate Y")
  that have no observable outcome. Investigations are tasks only when their
  deliverable is a recorded decision.

## Related

- `docs/SDLC.md` → "Planning above the task" — the authority this executes
- `task-tracker` — card rules this skill must satisfy
- `execute-task` — consumes the front; its step-7 check triggers re-planning
- `grill-me` — when the goal itself is fuzzy
- `the-fool` — stress-test a milestone plan before proposing it
- `adr` — decisions the plan forks on
