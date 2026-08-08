---
name: attack-the-board
description: >-
  Interrogate the remaining backlog up front, then execute as much of it as
  possible autonomously: scope the work, plan the path, harvest every
  operator-only question in one batch, then run task after task through the
  standard lifecycle until nothing claimable remains. Use on "attack the
  board", "burn down the backlog", "work through everything you can", or
  "how far can you get without me". Distinct from plan-milestone (which
  produces tasks) and execute-task (which runs one); this drives a multi-task
  session across existing tasks.
---

# Attack the Board

Front-load every question, then run dark. The reactive default — hit an
ambiguity mid-task, block, wait for the operator — wastes the operator's
absence. This skill inverts it. Sweep the whole selected front first. Extract
every decision only the operator can make. Get answers in one batch. Then
execute autonomously until something genuinely stops the run.

This skill sequences and drives; it does not replace the lifecycle. Every
task still runs through `execute-task` in full — rubric, cold review,
validation, and completion under the commit-authority policy in
`docs/SDLC.md`, which remains authoritative for commit authority and the
review ladder. Do not restate or shortcut either.

## Phase 1 — Scope the front

1. Read the board:

   ```bash
   node .agents/skills/task-tracker/scripts/task.mjs board
   ```

2. The run's scope is every incomplete task matching the filter the operator
   gave (priority, tag, milestone, explicit task list) — not just what is
   claimable this minute. That includes tasks whose dependencies sit earlier
   in the same scope: harvest and plan them now; work them as the path
   completes their blockers. Also sweep `blocked` tasks tagged
   `needs:operator` that match the filter: their pending questions join the
   harvest batch, and an answer that resolves one puts the task back on the
   path.
3. If the operator gave no filter and the scope is large — roughly, more
   than a handful of substantial tasks — do not silently pick a subset or
   attempt everything. Present the board's shape and offer concrete filters:
   "all p1s", "everything tagged area:X", "the top N by dependency order".
   Proceed only on a confirmed scope.
4. If the scope is empty or clearly invalidated by recent work, stop and
   recommend `plan-milestone`. Attack-the-board consumes a backlog; it never
   invents one.

## Phase 2 — Plan the path and harvest questions

Order the in-scope tasks into a work path: dependency order first, then
risk — prefer early tasks whose outcome could invalidate later ones, so
invalidation is discovered while the operator's answers are still fresh.

Then make one **quick** pass per task — minutes, not a pre-mortem — asking
only:

- Is the objective checkable as written, or does it need an operator call?
- Does it depend on a product, stack, or scope decision the repo cannot
  answer?
- Does it require authority beyond the autonomous boundary (push, deploy,
  destructive action, external credentials)?

Collect every hit into a single batch. Present it to the operator **together
with the run plan** — ordered path, questions per task, skipped/blocked
tasks, and the stop conditions below — as one interaction, before any task is
claimed. The operator's answers are the go-ahead. Do not come back for a
second approval unless an answer changes the path itself. Record each answer
on the task it affects:

```bash
node .agents/skills/task-tracker/scripts/task.mjs note task-NNN "operator: <decision>"
```

An answer that lives only in the transcript is lost to context churn and
invisible to cold reviewers; the board note is the durable copy. When an
answer resolves a previously blocked task, remove its `needs:operator` tag
and move it out of `blocked` per `task-tracker`. When the operator declines
a question, block that card with the exact open question, tag it
`needs:operator`, and record the blocker as `docs/SDLC.md` requires — the
run routes around it. With the answers recorded, run dark.

## Phase 3 — Execute until blocked

Work the path one task at a time. For each task, invoke `execute-task` and
follow it completely. Between tasks:

- Re-read `board` and the affected tasks' notes as the source of truth.
  Treat your own recollection of earlier tasks as stale.
- Reconcile: if the finished task invalidated a queued one, update or block
  the queued card before claiming the next. If it invalidated the premises
  behind an operator answer, stop — the plan the operator approved no longer
  exists.

**Delegation is default-on.** Run each task in the `efficient-orchestration`
posture: the orchestrator holds the run plan and judgment; workers take the
bounded research, implementation, and testing slices. The operator may name
the worker family up front (e.g. "with codex"); pass that through to the
delegation backend. For tiny tasks where delegation is pure overhead, work
locally — that skill's own guardrails apply.

**A real blocker is only:**

- an external condition the agent cannot resolve;
- a new ambiguity the harvested answers do not cover and repository evidence
  cannot settle;
- an action beyond the autonomous authority boundary in `docs/SDLC.md`;
- one task exhausting the cold-review cap `execute-task`'s references
  define — apply their at-cap procedure first; the blocker is whatever
  operator decision remains — or a required validation gate that cannot
  pass without one.

Everything else is not a blocker: route around it, file a follow-up task, or
absorb it into the current task if in scope. When a task hits a real
blocker, block the card with the exact question it is waiting on, tag it
`needs:operator`, record the blocker as `docs/SDLC.md` requires, and
continue with the next unblocked task on the path. The run halts only when
nothing claimable remains in scope.

Never mark a harvested question answered by inference. Never quietly skip a
hard task to keep the completion count moving — a blocked card with a sharp
question is a better outcome than a guessed answer.

## Phase 4 — Report

End every run — completed or halted — with:

- tasks completed, each with its commit or change packet, whichever the
  commit-authority policy directed;
- tasks blocked, each with the exact question it awaits;
- follow-up tasks filed and queued tasks updated or invalidated;
- friction observed, recorded as `friction:` notes for `retrospective`.

If the session is ending or direction materially changed, write the handoff
via `handoff-writer`. Leave `done` tasks visible; archive only in a
session-close sweep per `task-tracker`.

## Context discipline

A multi-task run outlives any single context. Keep the orchestrator thin:
the board and task notes carry the durable state, workers carry the
token-heavy labor, and the run plan is re-derivable from `board` plus the
recorded operator answers. If context runs short mid-run, finish the current
task cleanly, write the report and handoff, and let a fresh session resume
from the board.

## Related

- `task-tracker` — board and CLI authority; scope reads and note writes
- `execute-task` — the per-task lifecycle this drives; never bypassed
- `efficient-orchestration` — the default execution posture and its dials
- `plan-milestone` — produces the backlog this skill consumes
- `grill-me` — deep interrogation of an idea; phase 2 here is the quick form
- `handoff-writer` — end-of-run handoff
- `docs/SDLC.md` — commit authority, review ladder, agent boundaries
