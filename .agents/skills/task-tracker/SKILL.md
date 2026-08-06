---
name: task-tracker
description: >-
  Operate the persistent file-based task board: inspect, add, claim, move,
  block, annotate, validate, and archive tasks. Use for "what's next", "what
  should I work on", tasks, board, kanban, backlog, ready, in_progress,
  review, blocked, or task-tracker CLI semantics. Distinct from a
  transcript-scoped plan; use execute-task for work after selection.
---

# Task Tracker

This skill is the board and CLI authority. State is stored in
`.tasks/tasks/`; completed tasks can move to `.tasks/archive/`. The bundled
zero-dependency Node CLI serializes writes through a repository lock and uses
Windows-safe replacement. `execute-task` owns the implementation, review,
validation, and commit lifecycle.

Invoke from the repository root:

```bash
node .agents/skills/task-tracker/scripts/task.mjs <verb> [args...]
```

## Common operations

```bash
task.mjs board
task.mjs next
task.mjs show task-007
task.mjs add "Title" --priority p1 --tag area:core --description "..."
task.mjs move task-007 in_progress
task.mjs note task-007 "decision or observation"
task.mjs run task-007 -- <command> [args...]
task.mjs move task-007 review
task.mjs move task-007 done
task.mjs archive --dry-run
task.mjs archive
```

Use the harness-local full `task.mjs` prefix shown above in actual commands. Read
`references/cli-reference.md` completely before using less common flags,
editing or deleting cards, diagnosing exit codes/locks, or generating HTML.

## Selecting and claiming

Both unblocked `backlog` and `ready` tasks are claimable. `ready` is an
intentional queue signal and wins only as a same-priority tiebreaker. If
`next` returns no output with exit code 0, run `board` and `list --blocked`;
all remaining work is blocked, active, under review, or complete.

Before `in_progress`, follow `execute-task`'s rubric requirement.
Dependency guards reject claims while blockers are incomplete. Never use
`--force` without explicit user authorization.

When several agents work in parallel, the operator assigns tasks; agents do
not self-select. Before parallel work, takeover of a claim, or worktree setup,
read `references/concurrency.md` completely.

## State and dependencies

Normal states are:

`backlog -> ready -> in_progress -> review -> done`

`blocked` is for an external condition the agent cannot resolve. The CLI
enforces legal transitions and dependencies. `--blocked-by task-NNN` adds a
dependency, rejects cycles and unknown/deleted IDs, and prevents movement into
`in_progress`, `review`, or `done` until every blocker is a live or archived
`done` task.

Moving to `in_progress` records `claimedBy` and `claimedAt`; the owner comes
from `FOUNDRY_AGENT` when set, otherwise `user@host`. Claims are advisory, not
cross-worktree locks.

## Recorded evidence

Validation expressible as a command must use:

```bash
node .agents/skills/task-tracker/scripts/task.mjs run task-007 -- npm test
```

`run` executes from the repository root and records the exact command, exit
code, duration, and bounded output tail. Output still streams to the console.
Failure is recorded and exits 1. The repository lock is released while the
command runs. Use `note` only for evidence a command cannot express.

The tracker records evidence; `execute-task` defines which validation and
cold review are required before moving from `review` to `done`. Recording a
transition is not evidence that it happened: a lifecycle written after the
work reads exactly like one written as the work proceeded.

## Durable board hygiene

- Log meaningful choices and direction changes.
- Prefix workflow waste exactly with `friction:` for retrospective mining.
- File out-of-scope follow-ups instead of expanding the active task.
- Anything awaiting a human is a task tagged `needs:operator`, usually
  `blocked`; remove the tag when answered.
- Leave recent completions visible in `done`, then archive in a session-close
  sweep.
- Do not hand-edit `## Log`; the CLI owns it.

Before filing work that will not be claimed immediately, read
`references/task-authoring.md` completely.

## Safety

- Never auto-promote `review` to `done`; follow `execute-task`.
- Never bypass dependency guards casually.
- Never let an empty `next` result become invented work.
- Do not use two agents in one working directory.
- A writable `.tasks` directory is required even for CLI reads because reads
  participate in lock recovery. In a read-only checkout, inspect Markdown
  directly.

## Related

- `execute-task` - lifecycle authority after task selection
- `references/cli-reference.md` - complete command and troubleshooting reference
- `references/concurrency.md` - required for parallel sessions and takeovers
- `references/task-authoring.md` - required for durable backlog cards
- `docs/SDLC.md` - governing lifecycle and commit policy
