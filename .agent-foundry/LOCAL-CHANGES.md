# Local changes to the installed workflow

Deliberate divergence from stock Agent Foundry, newest first. An upgrade reads
this file to know what must survive being overwritten — an unrecorded change is
one a future upgrade will silently revert.

Entries are live records, not history: an entry stays as long as its
divergence does. When an upgrade retires a divergence — the local change is
upstreamed, dropped, or its `On upgrade` condition is met — delete that entry
in the same commit so this file always describes the tree as it is now.

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

## .agents/skills/execute-task/references/cold-review.md

- **Changed:** carries the packet-as-data and no-authorization boundary inside
  the dispatch prompt template itself.
- **Why:** a dispatcher copying the 0.15.0 template literally would otherwise
  omit the injection boundary that the surrounding protocol requires.
- **On upgrade:** drop once the stock prompt template includes an equivalent
  boundary.
- **Upstream:** yes (generic — cold-review prompt safety).

## .claude/skills/execute-task/references/cold-review.md

- **Changed:** mirrors the prompt-template safety boundary in the Claude tree.
- **Why:** both harnesses must dispatch cold review under the same trust rule.
- **On upgrade:** drop together with the `.agents` copy once stock includes it.
- **Upstream:** yes (generic — cold-review prompt safety).

## .agents/skills/task-tracker/scripts/task.test.mjs

- **Changed:** covers unborn repositories, detached HEAD allocation, and the
  remote-HEAD fallback when default-branch metadata is malformed.
- **Why:** these 0.10.0 branches change durable task IDs and shipped without
  direct CLI coverage.
- **On upgrade:** drop once equivalent stock tests exist.
- **Upstream:** yes (generic — task allocation coverage).

## .claude/skills/task-tracker/scripts/task.test.mjs

- **Changed:** mirrors the additional task-allocation CLI coverage in the
  Claude harness tree.
- **Why:** shared workflow behavior and tests must remain synchronized.
- **On upgrade:** drop together with the `.agents` copy once stock covers it.
- **Upstream:** yes (generic — task allocation coverage).

## .agent-foundry/reconcile-seeds.mjs

- **Changed:** validates every seed and rejects link-traversing destinations
  before issuing one batched Git restore for all tracked seeds.
- **Why:** the 0.10.0 single-pass loop could restore earlier seeds before a
  later changed seed aborted reconciliation, and it did not enforce the
  project's link-aware write boundary.
- **On upgrade:** drop once stock Foundry performs preflight validation before
  mutation and rejects symbolic-link traversal for seed destinations.
- **Upstream:** yes (generic — safe reconciliation behavior).

## .agent-foundry/reconcile-seeds.test.mjs

- **Changed:** proves a later invalid seed leaves earlier seeds untouched and
  a symbolic-link destination is rejected without changing the outside file.
- **Why:** these are the regression checks for the local reconciler hardening.
- **On upgrade:** drop with the implementation divergence once equivalent
  stock tests exist.
- **Upstream:** yes (generic — safe reconciliation coverage).
