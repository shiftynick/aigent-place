---
name: task-tracker
description: >-
  Persistent file-based kanban for cross-session, cross-agent dev work.
  Use when starting non-trivial dev work, deciding what to work on, marking
  progress, hitting a blocker, finishing a task, discovering new follow-ups,
  or whenever the user mentions tasks, the board, kanban, "what's next",
  "what should I work on", in_progress, blocked, or review. Distinct from
  the in-conversation plan tool, which is for transcript-scoped step tracking
  only.
---

# Task Tracker

Persistent kanban at `<repo-root>/.tasks/tasks/` driven by a bundled
zero-dep Node script. Completed tasks get moved to
`<repo-root>/.tasks/archive/`. State lives in per-task `.md` files; the
script serializes writes through a repository lock and Windows-safe backup
replacement. No package install required.

This skill is **agent-autonomous**: a single agent is expected to drive
each task from claim through done and archive without waiting on the
user, gated by the review checklist below. Committing that work follows
the commit-authority rule in `docs/SDLC.md`, which a project may tighten
in its `AGENTS.md`.

## Invoking

The script lives at `scripts/task.mjs` next to this SKILL.md. Invoke it
from PowerShell or another shell with the install path:

    node <skill-dir>/scripts/task.mjs <verb> [args...]

In this repo:

    node .agents/skills/task-tracker/scripts/task.mjs <verb>

## When to use

- Before starting non-trivial work → `task.mjs next`
- When `next` returns nothing claimable → inspect blockers and underspecified
  work before asking for concrete missing input
- When starting → `task.mjs move <id> in_progress`
- When you discover follow-up work that won't fit this turn → `task.mjs add ...`
- When code is written and tests pass → `task.mjs move <id> review`
- When the review checklist is satisfied → `task.mjs move <id> done`
  (you do this yourself — don't wait for the user)
- When blocked → `task.mjs note <id> "<reason>"` then `task.mjs move <id> blocked`
- When wrapping up a session → `task.mjs archive`
- When user asks "what are we working on" → `task.mjs board`

## Standard workflow (autonomous)

**Single-agent assumption.** The self-selection in step 1 is correct when one
agent works the board. When several agents run in parallel, the operator
assigns tasks and agents do **not** self-select — see "Parallel work" below
before running `next`.

```bash
# 1. Find work. If nothing is ready, triage first (see next section).
node .agents/skills/task-tracker/scripts/task.mjs next

# 2. Claim it.
node .agents/skills/task-tracker/scripts/task.mjs move task-007 in_progress

# 3. Work. Log meaningful decisions / direction changes inline.
node .agents/skills/task-tracker/scripts/task.mjs note task-007 "tried X, switched to Y"

# 4. Move to review when code+tests are in place.
node .agents/skills/task-tracker/scripts/task.mjs move task-007 review

# 5. Self-verify against the review checklist. If it passes, close it out.
node .agents/skills/task-tracker/scripts/task.mjs move task-007 done

# 6. Wrapping up the session — sweep done tasks into the archive.
node .agents/skills/task-tracker/scripts/task.mjs archive
```

The agent owns every step. Only stop and surface to the user when:
- the review checklist genuinely cannot be satisfied without their input
  (e.g., subjective design call, missing credentials, ambiguous spec), or
- a task is blocked by something outside the agent's control.

## When `next` is empty

`backlog` and `ready` are both claimable. Therefore, `next` returning no
output means every remaining task is blocked, already active, under review,
or complete.

1. Run `board` and `list --blocked`.
2. Resolve a dependency or clarify an underspecified card when the repository
   contains enough evidence.
3. Promote an unblocked backlog item to `ready` only as an intentional queue
   signal; promotion does not make it newly claimable.
4. If progress needs an operator decision or external change, report that
   exact condition rather than asking an open-ended "what next?".

## Review checklist (before `move <id> done`)

A task in `review` only moves to `done` once **all** applicable items
below are true. Evidence that is expressible as a command must be recorded
with `task.mjs run` (see "Recorded evidence") so the log shows what actually
executed; use `task.mjs note` only for evidence a command cannot express.

For any work touching code:
- [ ] Unit and/or integration tests covering the change exist and pass
  locally. New behavior → new tests; bug fix → regression test. If the
  surrounding code has no existing test infrastructure, add the minimum
  needed rather than skipping.
- [ ] The full relevant test suite (not just the new tests) passes.
- [ ] No lint/type errors introduced (run the project's checker if one
  exists).
- [ ] **Fresh-eyes review (required)** — hand the diff to a reviewer
  with no session context before promoting to `done`. Use the highest
  available rung of the cold-review ladder in `docs/SDLC.md`, and record
  which rung was used; the reviewer must receive only the task, rubric,
  standards, and diff. See the `execute-task` skill for the full two-axis
  review protocol.
- [ ] If a skill under `.agents/skills/` changed, the mirrored copy under
  the counterpart harness changed identically in the same commit. Verify
  with `node .agent-foundry/check-skill-sync.mjs`.

For any work that produces a runnable surface:
- [ ] Smoke-tested by actually running the application end-to-end on the
  golden path (CLI invocation, server boot + request, script execution,
  etc.), not just by reading the diff.
- [ ] If the change is observable in a frontend UI (new component,
  layout/behavior change, user-facing interaction), drive a real browser
  to confirm it renders and behaves as
  expected. Pure internal frontend refactors covered by tests are
  exempt.

For any work that changes operator behavior, setup, product concepts, APIs,
agent/delegation workflow, validation commands, troubleshooting, or supported
limitations:
- [ ] Updated `README.md`, the relevant doc under `docs/`, or an ADR when the
  change affects project framing, design contracts, API behavior, or runbooks.
- [ ] If no documentation update is needed, logged why in the task notes before
  moving out of `review`.

For docs / config / pure-text changes:
- [ ] Re-read the file end-to-end after the edit; no broken links,
  stale references, or contradictions with sibling docs.

If any box can't be checked, the task stays in `review`. Log what's
missing with `task.mjs note` and either finish the work or hand back to
the user with a specific question — never auto-promote to `done` on
faith.

## Archiving done tasks

Sweep `done` tasks to the archive when wrapping up a session, when the
`done` column starts crowding the board, or before producing a handoff.
Don't archive immediately on each move-to-done — leaving recent
completions visible briefly is useful context for the next claim.

```bash
node .agents/skills/task-tracker/scripts/task.mjs archive --dry-run  # preview
node .agents/skills/task-tracker/scripts/task.mjs archive            # apply
```

Archived tasks disappear from `board`, `list`, `show`, and `next`. A normal
archived `done` task satisfies dependencies; a soft-deleted task never does.

## Filing follow-ups

If you discover a follow-up that's out of scope for the current task:

```bash
node .agents/skills/task-tracker/scripts/task.mjs add "Refactor X once Y lands" --priority p2 --tag area:process --blocked-by task-007
```

Tell the user (when surfacing): "Filed as task-NNN, blocked by current task."

### Writing durable task descriptions

Tasks often sit in `backlog` for weeks while the code moves underneath them,
so write descriptions that survive drift:

- **Name behaviors, interfaces, and concepts — not file paths or line
  numbers.** "The settings validator that all write paths share must also
  reject X" stays true after a refactor; `validation.rs:142` doesn't.
  Exception: a task being claimed immediately in the same session may carry
  paths as a convenience.
- **Size to one fresh agent session** (one context window: claim, implement,
  review, validate, commit). If honestly describing the work needs more than
  that, it's an epic — split it into session-sized tasks with `--blocked-by`
  edges instead of filing one oversized card.
- State the acceptance criteria as observable outcomes a cold reader could
  verify, not as "clean up / improve" adjectives.

## Columns

The CLI enforces the normal lifecycle below. `--force` is the explicit escape
hatch and may only be used when the user authorizes it.

`backlog → ready → in_progress → review → done`, plus `blocked`.

- `backlog` — known work, not yet triaged.
- `ready` — triaged and queued; explicit "do this next" signal.
- `in_progress` — actively being worked.
- `review` — code/changes complete, awaiting the review checklist
  verification.
- `done` — checklist satisfied, closed out.
- `blocked` — waiting on something the agent can't unblock; note the
  reason.

## Dependencies

`--blocked-by task-NNN` declares a dependency. The CLI prevents dependency
cycles on add/edit, rejects unknown or soft-deleted blocker IDs, and refuses
to move into `in_progress`, `review`, or `done` while any blocker is not a
live `done` task. Use
`--force` only when the user explicitly says so (the override is logged).

`next` only suggests tasks with all dependencies satisfied. Both
`backlog` and `ready` are treated as claimable. Within a priority
bucket, `ready` sorts first as a tiebreaker. `list --ready` applies the
same claimable filter.

## Tags

Convention is `key:value`. Common keys: `area:core`, `area:desktop`,
`area:architecture`, `area:tooling`, `area:process`, `milestone:<name>`, and
`needs:operator`. Filter with `list --tag area:core`.

**`milestone:` and `phase:` are not interchangeable:**

- `milestone:<name>` — the **work front** a task belongs to. `plan-milestone`
  files and queries by this tag, so a front card tagged anything else is
  invisible to it, and the failure is silent: the filter returns a partial
  front, which reads as "most of the milestone is done" rather than "the query
  missed half the board".
- `phase:<name>` — the **kind or provenance** of the work, independent of any
  milestone: `phase:bootstrap` for installation tailoring, `phase:audit` for
  cards a `codebase-audit` filed.

A card can carry both. If a board was seeded by hand with `phase:` names that
were meant as milestones, retag those to `milestone:` — `list --tag` will not
tell you they are missing.

## Read commands

```bash
task.mjs board                              # ASCII kanban
task.mjs list                               # flat list
task.mjs list --status ready
task.mjs list --tag area:core
task.mjs list --blocked | --ready
task.mjs list --json
task.mjs show task-007
task.mjs next
```

Archived tasks are hidden from normal `board`, `list`, `show`, and `next`
output. A normal archived `done` task satisfies dependencies; a soft-deleted
task never does.

### HTML board view

For a human-friendly snapshot of the whole board (columns, priorities,
tags, blocker state, expandable descriptions/logs, collapsed archive):

```bash
node .agents/skills/task-tracker/scripts/board-html.mjs   # writes .tasks/board.html
```

Read-only and regenerated on demand — the markdown task files stay the
source of truth, and the output file is gitignored. Pass `--out <path>`
to write elsewhere. Offer to regenerate it whenever the user asks to
"see the board".

## Write commands

```bash
task.mjs add "<title>" [--priority p1] [--tag k:v ...] [--blocked-by task-NNN ...] [--description "..."]
task.mjs move <id> <status> [--force] [--note "..."]
task.mjs note <id> "<text>"
task.mjs run <id> -- <command> [args...]      # execute + record evidence
task.mjs edit <id> [--title ...] [--priority ...] [--add-tag ...] [--remove-tag ...]
                   [--add-blocked-by ...] [--remove-blocked-by ...] [--description "..."]
task.mjs rm <id>                            # soft-delete: status=done + tag deleted:true
task.mjs archive [--dry-run]                # move done tasks to .tasks/archive/
```

Priority enum: `p0 p1 p2 p3` (default `p2`). Default status on `add`: `backlog`.

Free text (titles, notes, descriptions) may start with dashes. If the text
could be mistaken for one of this CLI's own flags, end option parsing first
with a bare `--`, or use the `--flag=value` form:

```bash
task.mjs note task-007 -- "--force was required because ..."
task.mjs add --title="--weird but valid title"
```

### Recorded evidence: `task.mjs run`

`run` executes a command and appends what **actually happened** — the exact
command, exit code, duration, and a bounded output tail — to the task log,
written by the tool from the real result rather than typed from memory:

```bash
node .agents/skills/task-tracker/scripts/task.mjs run task-007 -- npm test
```

This is the required form of validation evidence wherever the validation is
expressible as a command: a `run` entry in the log is **recorded** evidence;
a hand-typed note claiming a command passed is not, and reviewers treat it
accordingly. Use `note` for evidence that is not a command (a browser
walkthrough, a screenshot location, a manual observation).

Notes on behavior:

- The command executes with the repo lock *released*, so a long test suite
  does not block other board commands; only the append takes the lock.
- The command runs through the shell from the repository root; quote
  accordingly. Full output streams to the console; the log keeps the tail.
- A failing command still records its evidence, then exits 1 — failure
  evidence is exactly as valuable as success evidence.
- Runs longer than 15 minutes time out; split the gate or record the long run
  with `note` plus its own logged output.

### Claims: who is working on what

Moving a task to `in_progress` records `claimedBy` (the `FOUNDRY_AGENT`
environment variable when set, otherwise `user@host`) and `claimedAt`. Any
move out of `in_progress` clears both. `board` shows the owner in brackets;
`show` prints both fields.

**Set `FOUNDRY_AGENT` to a distinct session name** when several agents work
the same board from one machine account — otherwise their claims are
indistinguishable.

**What a claim does and does not guarantee.** `claimedBy` is an *advisory
active-owner marker*, *not a lock.* `.tasks/` is tracked in Git, so a claim
made in one worktree or clone is invisible everywhere else until it is
committed, merged, and pulled. Nothing prevents two agents from claiming the
same task. The repo lock serializes *writes to the board files*; it does not
coordinate *who works on what*.

**Stale claims.** A claim does not expire on its own; a crashed session leaves
its task claimed. Before treating a claim as stale: check `claimedAt` age
(older than ~24h with no matching log activity is suspect), check the log for
recent entries, and check for uncommitted work in the worktree touching the
task's area. To take over, do not `--force` past anything — log the takeover
(`task.mjs note`), move the task back through `blocked` or `ready`, salvage
in-flight work from the worktree, and re-claim. The old claim is evidence of
where the previous session died; read its log before overwriting its state.

### Parallel work: one agent per worktree

**Two agents must never share one working directory.** They share `HEAD`, the
index, and the worktree, so in practice: one agent's `git add` is wiped by the
other's staging, a finished change lands committed on the other task's branch
because `HEAD` moved underneath it, and both edit the same shared documents.
None of these fail loudly. Only the "stage named paths, never `git add -A`"
rule keeps the damage recoverable.

Give each agent its own worktree, branched from an **explicit** start point:

```bash
git fetch origin
git worktree add ../<project>-task-NNN -b task-NNN-short-slug origin/main
```

The `origin/main` is load-bearing. Without it the new branch forks from
whatever the calling shell has checked out — during parallel work, usually
another task's branch — which reproduces the wrong-branch failure while
looking correct.

Two things that already work in a worktree, verified: the board CLI (repo-root
discovery matches a linked worktree's `.git` file as well as a directory), and
`core.hooksPath`, which lives in the shared config and so applies everywhere
with no per-worktree setup.

**Preflight for parallel sessions:**

1. The **operator assigns** tasks; agents do not self-select with `next`.
2. Pull before claiming, so the board you read is current.
3. Each agent edits only its own task card — separate files merge cleanly.
4. Expect shared documents (`AGENTS.md`, standards) to conflict; coordinate
   edits to them through the operator or sequence them.

This model works for a small number of agents with a human in the loop. It
does not scale further, and the board is advisory under concurrency by design.

### Waiting on a human: `needs:operator`

Anything that waits on a human decision must exist **on the board**, not only
in prose. Tag it `needs:operator` (and usually move it to `blocked`):

```bash
task.mjs edit task-012 --add-tag needs:operator
task.mjs list --tag needs:operator          # the operator's queue
```

This is the single view an operator checks to answer "what is waiting on me?"
A `proposed` ADR awaiting acceptance gets a companion `needs:operator` task
citing the ADR; so does a blocked credential, an unresolved design call, or a
plan awaiting approval. Remove the tag the moment the human answers.

### Process friction: the `friction:` note prefix

When the workflow itself — not the code — causes waste, log it immediately as
a note beginning with `friction:`. This exact prefix is the convention the
`retrospective` skill greps for across the archive; friction that never gets
written down never gets fixed.

```bash
task.mjs note task-007 "friction: SDLC and execute-task disagreed on X; spent a round reconciling"
```

## Exit codes

| Code | Meaning                                                        |
| ---- | -------------------------------------------------------------- |
| 0    | success (including "no claimable task" for `next`)             |
| 1    | runtime error; also `run` when the executed command failed     |
| 2    | bad usage / validation failure (blocked move, cycle, bad enum) |
| 4    | task id not found                                              |
| 5    | concurrent lock or write conflict — the CLI already retried     |

## Concurrency

All board commands, including reads and HTML snapshots, serialize through
`.tasks/.write-lock`. This protects ID allocation and prevents readers from
observing a task halfway through a Windows-safe replacement. The lock records
its owning process; a later command recovers dead-owner locks and rolls back
interrupted backups. Individual updates also retain an mtime check.

Lock acquisition retries with a short backoff before giving up, so ordinary
multi-agent contention resolves without a visible failure. Exit code 5 means
one of two distinct things, and the message says which:

- `lock held by another process` — contention outlasted the retry window.
  Something is holding the board much longer than a normal command; check for
  a stuck process rather than immediately retrying again.
- `task file changed since read` — an mtime collision: another writer changed
  the task between this command's read and write. Re-read and reapply.

The consistency guarantee requires a writable `.tasks` directory even for
read commands. In a deliberately read-only checkout, inspect the Markdown task
files directly rather than claiming the CLI board is available.

## Common pitfalls

- **Don't auto-promote review → done without the checklist.** "Tests
  exist somewhere in the repo" is not the same as "this change is
  covered". If you can't point at the specific test that would have
  caught a regression, the checklist is not satisfied.
- **Don't skip fresh-eyes review because "the change looks simple".**
  Simple changes are where confirmation bias bites hardest. When no
  independent reviewer is available, descend the `docs/SDLC.md` cold-review
  ladder rather than skipping — and declare the rung you landed on.
- **Don't bypass dep guards casually.** If `move` refuses with "blocked
  by task-XXX", that's the safety net. Use `--force` only on explicit
  user instruction.
- **Don't ask an open-ended "what should I work on" before diagnosing the
  board.** If `next` is empty, inspect blockers and underspecified cards;
  promoting backlog to `ready` does not make it newly claimable.
- **Don't hand-edit task `## Log` sections.** The CLI is the writer.
  `## Description` is hand-editable except that
  `<!-- task-tracker:... -->` comments are reserved format markers.
- **`next` exit 0 with no output means "no claimable work"** — not an
  error. Distinguish from non-zero (actual error) before reporting to user.
- **Prefer `add` over expanding the current task's scope** when you
  discover follow-ups mid-stream.
- **Don't bake file paths/line numbers into backlog descriptions.** They
  go stale; describe the behavior or interface instead (see "Writing
  durable task descriptions").
