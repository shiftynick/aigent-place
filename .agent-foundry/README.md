# Agent Foundry in this project

This directory holds the installed Foundry's own metadata and checks. It is not
product code and it is not the task board.

| File | Purpose |
| --- | --- |
| `manifest.json` | What was installed, at which version, with a hash and tier per managed file. Generated — do not hand-edit. |
| `run-checks.mjs` | Runs the skill-sync gate plus every test suite the kit owns. |
| `agent-headless/` | Unified provider runner, library test seam, compatibility matrix, license, provenance, and reconstructable source patches. |
| `reconcile-seeds.mjs` | Lists or restores every non-preserved project seed after a forced upgrade. |
| `check-skill-sync.mjs` | Verifies the two harness skill trees still agree. |
| `check-foundry-drift.mjs` | Reports how installed files differ from what was installed. |
| `LOCAL-CHANGES.md` | Your record of deliberate divergence from the stock workflow. |
| `feedback/` | Transient feedback packets bound for the Foundry, written by `agent-foundry-feedback`. Git-ignored and unmanaged; deleted once delivered. |

## The installed workflow is yours to evolve

Agent Foundry ships a starting point, not a frozen standard. Tailoring it to
this project is expected: sharpen a skill's trigger, add a checklist item that
catches a defect this codebase actually produces, encode a real command in a
validation step, delete a section that does not apply here.

The one thing local evolution must not do is drift silently. A future upgrade
replaces Foundry-owned files, and anything undocumented is lost with no
argument. So:

1. **Make the change in both harness trees** when it touches a shared skill,
   and verify with `node .agent-foundry/check-skill-sync.mjs`.
2. **Record it in `LOCAL-CHANGES.md`** — what changed, why, and whether it
   should be upstreamed. One entry per divergence.
3. **Upstream what is generic.** A change that would help any project belongs
   in the Foundry itself, not in ten copies of it.

## Tiers

`manifest.json` classifies every managed file:

- **`seed`** — installed once; this project owns it from then on. `AGENTS.md`,
  `CONTRIBUTING.md`, `HANDOFF.md`, the journals, and the two standards
  documents. Editing these is the normal case and needs no `LOCAL-CHANGES.md`
  entry. An upgrade resets them to the new template and expects you to restore
  and re-merge (see `UPGRADING.md`).
  - **Append-only logs are stronger than seed**: `LOCAL-CHANGES.md`,
    `PLANNING-JOURNAL.md`, and `BLOCKED-JOURNAL.md` are never rewritten once
    they exist — not even by `--force`. Their stock content is an empty
    header with no upgrade value, while your content is irreplaceable, and
    `LOCAL-CHANGES.md` in particular is the file an upgrade *reads* to know
    what not to revert.
- **`mold`** — the Foundry owns it: the skills, `docs/SDLC.md`, the ADR
  template, these checks. Upgrades replace them, so divergence here is what
  `LOCAL-CHANGES.md` exists to protect.

Everything else — `.tasks/`, real ADRs, journal entries, out-of-scope records,
and any `feedback/` packets — is project state the installer does not manage:
it is absent from the
manifest, never replaced, and never reconciled on upgrade. The one contact
point is `.tasks/tasks/.gitkeep` and `.tasks/archive/.gitkeep`, which the
payload ships so the empty directories survive Git; board cards, archives,
and their content are untouched.

## Routine checks

```bash
node .agent-foundry/run-checks.mjs            # sync gate + every kit test suite
node .agent-foundry/check-foundry-drift.mjs   # what we have changed
```

`run-checks` discovers suites rather than listing them, so a skill that ships
new tests in a future release is covered without touching the project's gate.

`agent-headless/` is Foundry-owned mold shared by both harnesses. Read its
`PROVENANCE.md` before refreshing artifacts; updates require upstream tests,
license/dependency/security review, hash refresh, and a Foundry release.

The checks have deliberately different force:

- **`run-checks` should be a gate.** It is the sync check plus every installed
  suite, and both are things this project should never be able to break
  silently. Wire it into the quality gate and CI.
- **`check-skill-sync` should be a gate.** It exits non-zero on real drift
  between the trees, and that drift is always a mistake — two harness trees
  disagreeing silently breaks the cross-family cold review the whole review
  ladder depends on. Wire it into the project's quality gate and CI alongside
  the tests.
- **`check-foundry-drift` is a report, never a gate.** Divergence from stock
  is a legitimate choice this project is allowed to make; the check exists so
  an upgrade knows what to preserve, not to forbid customization.

Upgrade procedure: `UPGRADING.md` in the Agent Foundry repository.
