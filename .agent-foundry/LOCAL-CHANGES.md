# Local changes to the installed workflow

Deliberate divergence from stock Agent Foundry, newest first. An upgrade reads
this file to know what must survive being overwritten — an unrecorded change is
one a future upgrade will silently revert.

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
```

## docs/SDLC.md

- **Changed:** adds a `### Protected default branch` subsection under "Commit
  authority", stating that a branch-per-task PR flow authorized in `AGENTS.md`
  leaves the default branch changeable only through a pull request, that
  `AGENTS.md` owns branch naming and push/merge authority, and that
  server-side rules — not the client-side hook — are the enforcement boundary.
- **Why:** task-019 made `main` a protected branch with a required-checks
  ruleset and a local `.githooks` push guard. Without this, stock commit
  authority reads as permission to commit straight to `main`, and the
  client-side hook gets mistaken for the real protection.
- **On upgrade:** re-apply on top of the new "Commit authority" section unless
  upstream Foundry grows an equivalent protected-branch rule; drop then.
- **Upstream:** yes (generic — protected default branches are common; proposed
  for Agent Foundry).

_Recorded during the 0.6.0 → 0.9.0 upgrade (task-024); the change itself
predates the entry and was re-applied by hand._
