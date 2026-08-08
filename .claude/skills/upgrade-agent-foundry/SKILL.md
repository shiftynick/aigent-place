---
name: upgrade-agent-foundry
description: >-
  Upgrade this project's installed Agent Foundry workflow kit to a newer
  release, from either a local foundry checkout or a Git URL. Use on
  "upgrade agent foundry", "pull in the new foundry version", "update the
  workflow kit", or when a drift check reports the installed version behind
  an available release. This skill acquires and verifies the new foundry and
  gates the risky steps; the upgrade procedure itself is the acquired
  foundry's UPGRADING.md, followed completely.
---

# Upgrade Agent Foundry

An upgrade replaces the mold this project's workflow was cast from. It must
not destroy what the project has done to its own workflow since installation.

The procedure that protects that is in the foundry itself as `UPGRADING.md`,
versioned with the release being installed. This skill gets you safely to that
document. It does not restate it. Acquire the new foundry, verify it, then
follow its `UPGRADING.md` from top to bottom.

## Establish what is installed

Read the installed version and identity from `.agent-foundry.json` at the
project root.

If that file is missing, stop and report. Without it there is no installed
version to compare against and no project identity to reinstall with. This
skill cannot verify a safe upgrade.

A present `.agent-foundry.json` but missing `.agent-foundry/manifest.json`
means the install predates manifests. Say so explicitly. `UPGRADING.md`
defines the extra care that case needs.

## Surface unsent upstream before changing mold

Before acquiring a new foundry, read `.agent-foundry/LOCAL-CHANGES.md` for
`Upstream: yes` entries with **Upstream status** `unsent` or `packeted`, or
with status missing (treat missing as `unsent`). Report them to the operator
(path, status, ref).

An upgrade may overwrite the mold those entries protect. Unsent generic fixes
should go through `agent-foundry-feedback` first when the operator wants them
proposed upstream. Do not create a parallel delivery tracker. Status and ref
live on the LOCAL-CHANGES entry.

## Acquire the new foundry

The operator names the source. If none was given, ask. Do not guess.

- **Local checkout** — an Agent Foundry working copy already on disk. Use
  its path directly.
- **Git URL** — confirm with the operator before any network fetch, then
  clone to a temporary directory *outside* this project. Ask for the URL if
  the operator has not supplied one. The project records no upstream today.
  A fork's projects must not silently upgrade from a different source.

Then verify the source is actually a foundry before trusting it:

1. It has `VERSION`, `CHANGELOG.md`, `UPGRADING.md`,
   `scripts/bootstrap-project.mjs`, and the `starter/` payload directory at
   its root.
2. Its `VERSION` is newer than the installed version. Same or older: stop
   and report both numbers. "Upgrading" sideways or backwards is a downgrade
   with extra steps. It needs an explicit operator decision.
3. Report the source path, installed version, and target version to the
   operator before changing anything.

## Run the procedure

Read the acquired foundry's `UPGRADING.md` **completely and follow it as the
single authority for the upgrade procedure**, from its first step through
close-out.

This skill ships with the version being upgraded *from*. The procedure comes
from the version being upgraded *to*. Where anything in *this skill* and that
document disagree about the procedure, the acquired `UPGRADING.md` wins.

Its stop rules gate irreversible loss of the project's own workflow history.
Honor them as written. Do not improvise around a step that fails.

`UPGRADING.md` owns the upgrade procedure — including its documented task
entry, which reconstructs the rubric after claiming — but not the rest of
the task lifecycle. The upgrade task's review, recorded validation, and
completion still follow `execute-task` before the card moves to `done`.

If the foundry was cloned to a temporary directory, remove that clone only
after close-out. It is the reference for every reconciliation question.

## Related

- `task-tracker` — the upgrade runs as a normal board task
- `execute-task` — review, validation, and completion for the upgrade task
- `.agent-foundry/README.md` — tiers, drift, and local-change records
- `docs/SDLC.md` — commit authority for the upgrade commit
