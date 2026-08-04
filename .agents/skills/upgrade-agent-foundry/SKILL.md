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

An upgrade replaces the mold this project's workflow was cast from without
destroying what the project has done to its own workflow since installation.
The procedure that protects that is maintained in the foundry itself as
`UPGRADING.md`, versioned with the release being installed. This skill gets
you safely to that document and does not restate it: acquire the new
foundry, verify it, then follow its `UPGRADING.md` from top to bottom.

## Establish what is installed

Read the installed version and identity from `.agent-foundry.json` at the
project root. If that file is missing, stop and report: without it there is
no installed version to compare against and no project identity to reinstall
with, and this skill cannot verify a safe upgrade. A present
`.agent-foundry.json` but missing `.agent-foundry/manifest.json` means the
install predates manifests — say so explicitly; `UPGRADING.md` defines the
extra care that case needs.

## Acquire the new foundry

The operator names the source; if none was given, ask rather than guessing:

- **Local checkout** — an Agent Foundry working copy already on disk. Use
  its path directly.
- **Git URL** — confirm with the operator before any network fetch, then
  clone to a temporary directory *outside* this project. Ask for the URL if
  the operator has not supplied one; the project records no upstream today,
  and a fork's projects must not silently upgrade from a different source.

Then verify the source is actually a foundry before trusting it:

1. It has `VERSION`, `CHANGELOG.md`, `UPGRADING.md`,
   `scripts/bootstrap-project.mjs`, and the `starter/` payload directory at
   its root.
2. Its `VERSION` is newer than the installed version. Same or older: stop
   and report both numbers — "upgrading" sideways or backwards is a
   downgrade with extra steps, and needs an explicit operator decision.
3. Report the source path, installed version, and target version to the
   operator before changing anything.

## Run the procedure

Read the acquired foundry's `UPGRADING.md` **completely and follow it as the
single authority for the upgrade procedure**, from its first step through
close-out. This skill ships with the version being upgraded *from*; the
procedure comes from the version being upgraded *to* — where anything in
*this skill* and that document disagree about the procedure, the acquired
`UPGRADING.md` wins. Its stop rules gate irreversible loss of the project's
own workflow history: honor them as written, and do not improvise around a
step that fails.

`UPGRADING.md` owns the upgrade procedure — including its documented task
entry, which reconstructs the rubric after claiming — but not the rest of
the task lifecycle: the upgrade task's review, recorded validation, and
completion still follow `execute-task` before the card moves to `done`.

If the foundry was cloned to a temporary directory, remove that clone only
after close-out — it is the reference for every reconciliation question.

## Related

- `task-tracker` — the upgrade runs as a normal board task
- `execute-task` — review, validation, and completion for the upgrade task
- `.agent-foundry/README.md` — tiers, drift, and local-change records
- `docs/SDLC.md` — commit authority for the upgrade commit
