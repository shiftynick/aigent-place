# Local changes to the installed workflow

Deliberate divergence from stock Agent Foundry, newest first. An upgrade reads
this file to know what must survive being overwritten — an unrecorded change is
one a future upgrade will silently revert.

Entries are live records, not history: an entry stays as long as its
divergence does. When an upgrade retires a divergence — the local change is
upstreamed, dropped, or its `On upgrade` condition is met — delete that entry
in the same commit so this file always describes the tree as it is now. (The
project's journals are the append-only record of what happened; this one
answers "what is different today".)

Record a divergence here when the Foundry owns the file and would replace it:
the skills, `docs/SDLC.md`, the ADR template, and the checks under
`.agent-foundry/` (the `mold` tier in `manifest.json`).

No entry is needed for files this project owns outright — `AGENTS.md`, the
standards documents, and the append-only logs including this one. Editing
those is the normal case, and an upgrade already leaves them alone or hands
them back to you.

Run `node .agent-foundry/check-foundry-drift.mjs` to list what has actually
diverged, then make sure every `mold` entry it reports appears below.

## Format

```markdown
## <file path>

- **Changed:** what is different from stock, concretely.
- **Why:** the project-specific reason. "Cleaner" is not a reason.
- **On upgrade:** re-apply / re-evaluate / drop once <condition>.
- **Upstream:** yes (generic — propose to Agent Foundry) | no (project-specific).
- **Upstream status:** unsent | packeted | filed | landed | dropped (required for `Upstream: yes`).
- **Upstream ref:** packet path, issue, PR, foundry commit/task, or `none` (required for `Upstream: yes`).
```

No divergence today. Agent Foundry 0.28.0 absorbed every mold change this
project carried: the cold-review prompt-template boundary and the Cursor
compatibility sentence landed in 0.27.0, and the task-ID namespace, seed
restore, and their tests landed in 0.28.0. Each was verified against the
installed file before its entry was deleted (upgrade task-060).
