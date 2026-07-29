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

<!-- Add entries below. Delete this line once the first one exists. -->

_No local changes recorded yet._
