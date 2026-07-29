# task-tracker skill

The project's local, zero-dependency file-based kanban. The Claude-facing
source of truth is this folder under `.claude/skills/`.

Requirements: Node 20+. No `npm install`.

Commands coordinate through a short-lived repository lock, so the `.tasks`
directory must be writable even for consistent board reads. This is an
intentional tradeoff: readers never observe a partially replaced task file.

## Data location

Per-task files live at `<repo-root>/.tasks/tasks/`, where `<repo-root>`
is the closest ancestor directory containing a `.git` folder. The
directory is auto-created. Completed tasks can be moved to
`<repo-root>/.tasks/archive/` with:

```bash
node .claude/skills/task-tracker/scripts/task.mjs archive
node .claude/skills/task-tracker/scripts/task.mjs archive --dry-run
```

Archived tasks are hidden from normal board/list/show/next output. A normal
archived `done` task satisfies dependencies; a task tagged `deleted:true`
never does.

The project commits `.tasks/tasks/` and `.tasks/archive/` because the board is
shared durable project intent. `.tasks/board.html` is generated and ignored.

## Tests

```bash
cd .claude/skills/task-tracker/scripts
node --test task.test.mjs _lib.test.mjs board-html.test.mjs
```

Uses Node's built-in `node:test` runner. No vitest, no jest — keeps the
skill copy-paste portable.

## Verbs

See `SKILL.md` for the agent-facing verb reference.
