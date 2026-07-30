# HANDOFF — Aigent Place, 2026-07-30

Cold-start checkpoint after completing the first three executable foundation
contracts and pausing before task-012.

---

## TL;DR

Aigent Place is still in foundation-contract work; there is no Rust/browser
product workspace or runtime yet. Protocol v1, deterministic world geometry,
and replay/persistence contracts are now merged into public `main` through PRs
#2, #6, and #8, with their architecture decisions accepted. No task is active
or blocked on the current board. Resume with `task-012`, which specifies the
ruleset schema and constitution boundary; do not resume from the stale dirty
root checkout without first isolating or preserving its user-owned task-023
card edit.

---

## To pick up next

The clean current `main` checkout is presently
`N:\aigent-place-task022-delivery`, despite its historical name:

```powershell
Set-Location N:\aigent-place-task022-delivery
git status -sb
git pull --ff-only
node .agents/skills/task-tracker/scripts/task.mjs next
node .agents/skills/task-tracker/scripts/task.mjs show task-012
```

`task.mjs next` returned `task-012` at this checkpoint. Use the
`execute-task` lifecycle: log a checkable rubric before claiming, then work on
a new `task-012-*` branch created from current `origin/main`. Do not commit
directly to `main`.

If the historical worktrees are cleaned up first, resolve and preserve the
dirty root checkout before removing anything:

```powershell
git -C N:\aigent-place status --short
git -C N:\aigent-place diff -- .tasks/tasks/task-023-accept-heightfield-sampling-and-terrain-collision-.md
git -C N:\aigent-place worktree list
```

The root checkout's task-023 modification is user-owned and must not be
discarded merely because task-023 is already merged on `main`.

## What's where

| Thing | Location |
| --- | --- |
| Product architecture and build order | `ARCHITECTURE.md` |
| Agent operating contract and source precedence | `AGENTS.md` |
| Task lifecycle and cold-review ladder | `docs/SDLC.md` |
| Persistent task board and evidence | `.tasks/` |
| Accepted architecture decisions | `docs/adr/` |
| Protocol v1 contract and fixtures | `protocol/v1/` |
| World geometry/physics contract and fixtures | `world/v1/` |
| Replay/persistence contract and fixtures | `replay/v1/` |
| Replay semantic oracle and focused tests | `scripts/replay-contract.mjs`, `scripts/replay-contract.test.mjs` |
| Unified current process/contract gate | `scripts/check.mjs` |
| Review lenses learned from completed work | `docs/REVIEW-STANDARDS.md` |
| Planning and historical blockers | `PLANNING-JOURNAL.md`, `BLOCKED-JOURNAL.md` |

## Mental model (don't lose this)

- The world server is authoritative. Owner-run aigent services submit bounded
  intents; browsers are read-only spectators.
- Simulation runs at a fixed 20 Hz. Serialization, persistence waits, and
  socket writes cannot block the simulation stage.
- Same-build replay is deterministic through canonical command ordering,
  counter-based seeded randomness, versioned durable frames, and strict
  recovery validation. It is not promised to be bit-identical across
  platforms.
- Exactly one live session epoch may command an aigent body. Sequence results
  and cross-epoch idempotency rows are distinct durable views with finite
  retention.
- Persistence admits at most one atomic generation at a time. Transient
  backpressure has no authoritative effect; committed results, mutations,
  events, retention choices, and allocator state recover together.
- The shared parametric primitive grammar drives bodies, built objects, and
  collision geometry. Positions are canonical `f64` values within ±100 km.
- `aigent` means a world inhabitant. Use `agent` only for the generic industry
  concept.
- Convex was evaluated and rejected for this design. Keep the authoritative
  fixed-tick Rust server and explicit replay/persistence model unless a later
  accepted ADR changes it.

## What was finished this session

- Accepted and merged the remaining architecture decisions needed by the first
  executable contract front:
  - ADR-0002 through PR #3 (`1adec35`)
  - ADR-0003 through PR #4 (`06f2d0a`)
  - ADR-0004 through PR #5 (`c50f017`)
  - ADR-0005 through PR #7 (`7b1ffdf`)
- Completed deterministic world geometry, shapes, terrain collision, movement,
  restore, sleep, revisions, and conformance behavior in task-010; squash
  merged PR #6 as `0512cb7`.
- Completed task-011's normative replay/persistence contract, executable
  fixtures, semantic oracle, protocol persistence carriers, recovery rules,
  retention behavior, queue saturation behavior, and gate integration.
- Remediated all material cold-review findings, including same-generation
  tentative idempotency/session overlays, lossless durable bytes, uint64
  exhaustion, RNG audit ownership, atomic tail validation, retention-state
  reconstruction, payload-mode consistency, and writer-state error
  precedence.
- Final independent tool-disabled Claude reviews returned SPEC PASS and
  STANDARDS PASS on the complete task-011 packet.
- Task-011 PR #8 passed the protected remote `process-gate` and squash-merged
  as `3fbeb0b7da755d4acb898e7c3dd7033921df02ea`. The remote task branch was
  deleted.
- Fast-forwarded the clean `main` worktree at
  `N:\aigent-place-task022-delivery` to `3fbeb0b`.

## What's in progress / half-done

No board task is currently `in_progress`, `review`, or `blocked` on current
`main`.

Operational cleanup is intentionally unfinished:

- `N:\aigent-place` is on old branch `task-010-physics-contract` at `351126b`
  and has an uncommitted modification to
  `.tasks/tasks/task-023-accept-heightfield-sampling-and-terrain-collision-.md`.
  That edit is user-owned.
- `N:\aigent-place-task011-final` is clean at local commit `edbd79b`; its
  remote branch is gone because PR #8 was squash-merged.
- Multiple old delivery and detached review worktrees remain. Do not delete
  them in bulk without first resolving absolute paths and checking every
  worktree for changes.
- The repository still has no product workspace, build, runtime service,
  credentials, deployment, or running server.

## Open questions for the human

No operator decision currently blocks the next board task. Deferred product
questions remain on task-017 and do not block task-012.

## Validation state

Task-011's final reviewed state recorded:

```text
node --test scripts/replay-contract.test.mjs
PASS — 21/21

node scripts/check.mjs
PASS — 68/68 repository tests
PASS — 289/289 installed Foundry workflow tests
PASS — skill sync and unresolved-marker scan

git diff --check
PASS
```

GitHub Actions run `30565142977` completed `process-gate` successfully before
PR #8 merged. Current `main` is `3fbeb0b` and is clean in
`N:\aigent-place-task022-delivery`.

## Worktree and operational state

- Public remote: `git@github.com:shiftynick/aigent-place.git`
- Protected branch: `main`
- Current remote/main commit: `3fbeb0b`
- Current clean main worktree: `N:\aigent-place-task022-delivery`
- Root checkout: stale task branch with a dirty user-owned task card
- Open GitHub PRs: none at this checkpoint
- Services/deployments: none
- Git hooks: repository clones should use `core.hooksPath=.githooks`

The GitHub connector available to Codex was authenticated as a non-collaborator
and could not create PR #8. The authenticated `gh` CLI account `shiftynick`
worked and is the verified fallback for this repository.

## Known blockers and risks

There is no product-design blocker. The immediate operational risk is acting
on stale task-board state from an old worktree. Always confirm current
`origin/main` and use the clean main worktree before selecting or claiming the
next task.

The main project risk remains writing runtime code before the remaining Step 0
contracts and product quality gate are established. Task-012 and task-013 are
still foundation contracts; task-003 scaffolds the product workspace.

## Recent commit history

```text
3fbeb0b task-011: specify replay and persistence ordering contracts (#8)
7b1ffdf task-025: accept durable replay and backpressure ADR (#7)
0512cb7 task-010: specify deterministic world geometry contracts (#6)
c50f017 task-024: accept terminal revision safety (#5)
06f2d0a task-023: accept deterministic terrain semantics (#4)
1adec35 task-022: accept world geometry semantics (#3)
1a1db71 task-002: make protocol v1 behavior executable (#2)
30531df task-019: establish protected GitHub PR delivery
729f5a1 task-001: establish the dual-agent project workflow
```

## Frequently-needed commands

```powershell
# Work from current main, not the stale root checkout.
Set-Location N:\aigent-place-task022-delivery
git status -sb
git pull --ff-only

# Board orientation.
node .agents/skills/task-tracker/scripts/task.mjs board
node .agents/skills/task-tracker/scripts/task.mjs next
node .agents/skills/task-tracker/scripts/task.mjs show task-012

# Authoritative repository gate.
node scripts/check.mjs

# Focused foundation-contract suites.
node --test scripts/protocol-contract.test.mjs
node --test scripts/world-contract.test.mjs
node --test scripts/replay-contract.test.mjs

# Verify shared Foundry skills remain mirrored.
node .agent-foundry/check-skill-sync.mjs

# Inspect remote PR/check state.
gh pr list
gh pr checks <number> --watch --interval 5
```

## Common pitfalls

- `N:\aigent-place` is not current `main`. Its board says task-010/task-011 are
  unfinished because it predates their squash merges. Do not treat that stale
  board as current.
- A clean worktree with a historical name can still be the canonical `main`
  checkout; check `git branch --show-current` and `git status -sb`, not the
  directory name.
- Never discard or fold the root task-023 card edit into unrelated work. It is
  user-owned even though task-023 is already merged.
- Cold reviewers must receive `git diff --binary HEAD` plus the complete
  contents of every untracked file. A bare diff or staged-index assumption
  hides important new contract/oracle files.
- On Windows, launching the Claude wrapper through `Start-Process` can split a
  multiword prompt into invalid arguments. Direct PowerShell invocation with
  `& node ... --prompt $prompt` is the verified path.
- `gh pr merge --squash --delete-branch` merged PR #8 remotely, then exited
  nonzero because it tried to switch to `main`, which was already checked out
  in another worktree. Always query `gh pr view` after such an error before
  retrying; the remote operation may already have succeeded.
- The GitHub connector and local `gh` CLI can represent different accounts.
  Connector PR creation failed with “must be a collaborator”; `gh auth status`
  confirmed `shiftynick` and the CLI succeeded.
- Do not simplify replay/persistence precedence casually. Availability,
  structural validity, sequence replay, writer state, oversize classification,
  idempotency, and domain rejection are intentionally ordered, and cold
  recovery must reproduce the same outcome.
- Never report a planned or unavailable command as passing. Record executable
  evidence through the task tracker.
