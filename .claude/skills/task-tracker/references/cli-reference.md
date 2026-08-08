# Task tracker CLI reference

Read this file completely before you use uncommon board operations or
troubleshoot the CLI.

## Read commands

```bash
task.mjs board
task.mjs list
task.mjs list --status ready
task.mjs list --tag area:core
task.mjs list --blocked
task.mjs list --ready
task.mjs list --json
task.mjs show task-007
task.mjs next
```

Archived tasks are hidden from normal reads. A normal archived `done` task
satisfies dependencies. A soft-deleted task does not.
`list --ready` uses the same claimable filter as `next`. `board` shows active
owners in brackets. `show` prints `claimedBy` and `claimedAt`.

Generate the read-only HTML board with:

```bash
node .claude/skills/task-tracker/scripts/board-html.mjs
```

It writes the gitignored `.tasks/board.html`. `--out <path>` changes the
destination. Offer regeneration when the user asks to see the board.

## Write commands

```bash
task.mjs add "<title>" [--priority p1] [--tag k:v ...] [--blocked-by task-NNN ...] [--description "..."]
task.mjs move <id> <status> [--force] [--note "..."]
task.mjs note <id> "<text>"
task.mjs run <id> -- <command> [args...]
task.mjs edit <id> [--title ...] [--priority ...] [--add-tag ...] [--remove-tag ...]
                   [--add-blocked-by ...] [--remove-blocked-by ...] [--description "..."]
task.mjs rm <id>
task.mjs archive [--dry-run]
```

Priorities are `p0`, `p1`, `p2`, `p3`. The default is `p2`. New tasks start
in `backlog`. `rm` is a soft delete (`done` plus `deleted:true`).
Every move out of `in_progress` clears `claimedBy` and `claimedAt`. An
authorized `--force` transition is recorded in the task log.

Free text may begin with dashes. Use a bare `--` before ambiguous positional
text, or use the `--flag=value` form:

```bash
task.mjs note task-007 -- "--force was considered"
task.mjs add --title="--valid title"
```

`## Description` is hand-editable. `## Log` is CLI-owned. Never edit or
remove `<!-- task-tracker:... -->` markers. They delimit those sections.

## Tags

Use `key:value`. Common tags include `area:core`, `area:architecture`,
`area:tooling`, `area:process`, `milestone:<name>`, `phase:<name>`,
`needs:operator`, and `needs:deploy-acceptance` (see `docs/SDLC.md` →
"Deploy-dependent acceptance").

`milestone:` identifies an operator-approved work front. `plan-milestone`
queries it. `phase:` describes kind or provenance, such as
`phase:bootstrap` or `phase:audit`. They are not interchangeable. A card may
carry both.

## Archiving

Preview before you apply:

```bash
task.mjs archive --dry-run
task.mjs archive
```

Archive at session wrap, before a formal handoff, or when `done` crowds the
board. Do not archive immediately after every completion.

## Exit codes and locking

| Code | Meaning |
| --- | --- |
| 0 | success, including no claimable task from `next` |
| 1 | runtime error, or executed `run` command failed |
| 2 | usage/validation failure |
| 4 | task ID not found |
| 5 | lock or write conflict after retries |

All commands serialize through `.tasks/.write-lock`. The lock records its
process, recovers dead owners, and rolls back interrupted backups. Updates
also check mtime.

Exit 5 distinguishes:

- `lock held by another process`: contention exceeded retries. Inspect the
  owning process. Do not loop blindly.
- `task file changed since read`: re-read current state, then reapply the
  intended update.

`run` releases the lock during execution and reacquires it only to append
evidence. Runs time out after 15 minutes. Split longer gates, or preserve
their own logged output and note its location.
