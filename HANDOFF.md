# HANDOFF — Aigent Place, 2026-08-04

Cold-start checkpoint after a workflow-maintenance session. Foundation
contracts are unchanged; the repository's operational state was cleaned up and
the installed workflow kit was upgraded.

---

## TL;DR

Aigent Place is still in foundation-contract work; there is no Rust/browser
product workspace or runtime yet. Protocol v1, deterministic world geometry,
and replay/persistence contracts are merged into public `main` with their ADRs
accepted. The workflow-maintenance work shipped no product code: Agent Foundry
is now upgraded from 0.6.0 through 0.15.0, stale worktrees and branches were
removed, and completed cards were archived. Resume product work with
`task-012` (ruleset schema and constitution boundary) from the single checkout
at `N:\aigent-place`.

---

## To pick up next

There is now exactly one checkout, it is clean, and it is on `main`:

```powershell
Set-Location N:\aigent-place
git status -sb
git pull --ff-only
node .claude/skills/task-tracker/scripts/task.mjs next
node .claude/skills/task-tracker/scripts/task.mjs show task-012
```

`task.mjs next` returned `task-012` at this checkpoint. Use the `execute-task`
lifecycle: log a checkable rubric before claiming, then work on a new
`task-012-*` branch cut from current `origin/main`. `main` is protected — never
commit to it directly; deliver through a PR that passes `process-gate`.

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
| Installed workflow kit metadata and checks | `.agent-foundry/` |
| Deliberate divergence from stock Foundry | `.agent-foundry/LOCAL-CHANGES.md` |
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
- The installed workflow under `.agents/` and `.claude/` is a *vendored* kit
  (Agent Foundry), not project code. It has an upstream at `N:\agent-foundry`
  and its own upgrade procedure. Files are tiered `seed` (this project owns
  them) or `mold` (upstream owns them; divergence must be recorded).

## Workflow state at this checkpoint

No product contract changed. The prior cleanup PRs and current upgrade are
process/workflow work.

- **Agent Foundry 0.10.0 → 0.15.0 delivery** (task-030). This adds `CHECKED`
  cold-review attestations, `attack-the-board`, the reusable upgrade and
  feedback skills, sanitized recorded evidence, and the unified
  `agent-headless` runner. The four prior local mold fixes remain applied and
  recorded. The exact local source commit is `1cf45f9`; it was three commits
  ahead of `origin/master` when installed, so do not describe the payload as a
  published remote release. The new rollback backup is retained pending
  operator acceptance.
- **Agent Foundry 0.9.0 → 0.10.0 delivery** (task-029). The reconciler restored
  eight non-preserved committed seeds; the installer retained and re-baselined
  the three append-only preserved seeds. The upgrade installed branch-namespaced
  task allocation and fail-closed aggregate checks, and recorded `main` as the
  default branch. Stock Foundry now carries the
  integration-only default-branch rule, so the former `docs/SDLC.md` mold
  divergence was retired; Aigent Place's stricter PR/ruleset policy remains in
  `AGENTS.md`. Cold review also hardened the installed seed reconciler against
  partial preflight failure and link traversal, and added missing allocation
  coverage; those local mold changes are recorded for upstreaming. The rollback
  backup is retained pending operator acceptance.
- **Upgraded Agent Foundry 0.6.0 → 0.9.0** (PR #9, `9171ebe`), applying the
  upgrade actions of every intervening release:
  - 0.7.0 agent-boundary convention in `docs/SDLC.md`
  - 0.8.0 slimmed `execute-task` / `task-tracker` entrypoints with detail moved
    into routed `references/` files
  - 0.9.0 shared `cursor-cli` skill in both harness trees, plus its wrapper
    test suites
  Seed files were restored from Git and re-merged; the sole `mold` divergence
  (the task-019 "Protected default branch" section in `docs/SDLC.md`) was
  re-applied and is now recorded in `.agent-foundry/LOCAL-CHANGES.md`.
- **Cleaned up the worktree sprawl.** Removed 17 stale worktrees and deleted 11
  merged/superseded local branches. Verified before deleting that every branch
  was either merged into `origin/main` or a strict subset of it — `main`'s
  `world/` tree is byte-identical to the merged task-010 branch.
- **Closed out and archived the board** (PR #10, `f21a139`): 11 completed cards
  moved to `.tasks/archive/`.
- **Documented `CURSOR_AGENT_BIN`** in `AGENTS.md` (PR #11, `b0f18d9`) after
  the `cursor-cli` smoke test found Cursor's shim is not on a non-interactive
  shell's `PATH`.
- **Smoke-tested `cursor-cli`** read-only against `docs/SDLC.md` with
  `cursor-grok-4.5-low-fast`; output was verified line by line against the
  source file.
- Refreshed this handoff and removed a stale `N:/cadre` path from
  `.claude/skills/codex-in-cc/SKILL.md` (task-028).

## What's in progress / half-done

Task-030 is the workflow-upgrade delivery task. After it merges, no board task
is `in_progress`, `review`, or `blocked`; `task-012` remains next.

- The repository still has no product workspace, build, runtime service,
  credentials, deployment, or running server. That is expected at this phase.
- 15 backlog tasks remain, all foundation or world-core work.

## Open questions for the human

No operator decision blocks the next board task. `task-017` carries
`needs:operator` for deferred product questions and does **not** block
`task-012`. Check the operator queue with:

```powershell
node .claude/skills/task-tracker/scripts/task.mjs list --tag needs:operator
```

## Validation state

For the 0.15.0 upgrade, use task-030's recorded command evidence and the
delivery PR checks; do not reuse the historical pre-review test totals. The
authoritative commands are:

```text
node scripts/check.mjs
node .agent-foundry/run-checks.mjs
node .agent-foundry/check-foundry-drift.mjs
```

The two POSIX-only Cursor tests **skip** on Windows; that is expected, not a
failure. Task-029 also added Windows-executed link-traversal coverage for the
seed reconciler.

`process-gate` passed on GitHub Actions for PRs #9, #10, and #11 before each
merge.

## Worktree and operational state

- Public remote: `git@github.com:shiftynick/aigent-place.git`
- Protected branch: `main`, ruleset `19976689`, strict `process-gate` required,
  squash merges only, no bypass actors
- Task-030 base commit on `main`: `0be1a0b`
- **Checkouts: exactly one, `N:\aigent-place`; task-030 uses its own branch**
- Open GitHub PRs: none
- Services/deployments: none
- Git hooks: clones should set `core.hooksPath=.githooks`
- Installed workflow kit: Agent Foundry 0.15.0 from local source commit
  `1cf45f9`, upstream checkout at `N:\agent-foundry`
- The 0.10.0→0.15.0 rollback backup is retained at
  `.agent-foundry-backups/20260804T145635517Z` pending operator acceptance
- The 0.9.0→0.10.0 rollback backup is retained at
  `.agent-foundry-backups/20260731T124533613Z` pending operator acceptance
- The 0.6.0→0.9.0 upgrade backup under `.agent-foundry-backups/` was deleted
  after operator acceptance

## Known blockers and risks

No product-design blocker.

The main project risk remains writing runtime code before the remaining Step 0
contracts and the product quality gate exist. `task-012` and `task-013` are
still foundation contracts; `task-003` scaffolds the product workspace.

The prior operational risk — acting on stale board state from an old worktree —
is now resolved by there being only one checkout. If you create worktrees for
parallel agents again, note that `.tasks/` is versioned, so board state is
per-worktree and a claim is invisible elsewhere until merged.

## Recent commit history

```text
b0f18d9 task-027: document CURSOR_AGENT_BIN for the cursor-cli skill (#11)
f21a139 task-026: close out Foundry upgrade card (#10)
9171ebe task-026: upgrade Agent Foundry 0.6.0 -> 0.9.0 (#9)
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
# Orientation. One checkout, already on main.
Set-Location N:\aigent-place
git status -sb
git pull --ff-only

# Board.
node .claude/skills/task-tracker/scripts/task.mjs board
node .claude/skills/task-tracker/scripts/task.mjs next
node .claude/skills/task-tracker/scripts/task.mjs show task-012
node .claude/skills/task-tracker/scripts/task.mjs list --tag needs:operator

# Authoritative repository gate.
node scripts/check.mjs

# Focused foundation-contract suites.
node --test scripts/protocol-contract.test.mjs
node --test scripts/world-contract.test.mjs
node --test scripts/replay-contract.test.mjs

# Installed workflow kit: gate, sync, and divergence report.
node .agent-foundry/run-checks.mjs
node .agent-foundry/check-skill-sync.mjs
node .agent-foundry/check-foundry-drift.mjs

# Operator-selected Cursor call (read-only). Model must be named; auto is rejected.
$env:CURSOR_AGENT_BIN = "$env:LOCALAPPDATA\cursor-agent\agent.cmd"
node .claude/skills/cursor-cli/scripts/cursor-agent.mjs --list-models

# Inspect remote PR/check state.
gh pr list
gh pr checks <number> --watch --interval 10
```

## Common pitfalls

- Cold reviewers must receive `git diff --binary HEAD` plus the complete
  contents of every untracked file (`git ls-files --others --exclude-standard`).
  A bare `git diff` is working-tree-versus-index and hides exactly the staged
  contract/oracle files the review exists to check.
- **Task IDs collide across branches.** The board mints the next free ID from
  the *current branch's* `.tasks/`, so a card filed on a stale branch can
  duplicate one `main` already used. This session hit it: the Foundry upgrade
  was filed as task-024 while `main` had minted task-024 for an ADR, and
  `task.mjs board` then failed with `ERROR: duplicate task id`. Cut task
  branches from current `origin/main`.
- **Check what a branch is based on before opening its PR.** The upgrade branch
  was cut from a stale task-010 line and carried 4 superseded commits; a PR from
  it would have reverted contracts `main` had already delivered. Verify with
  `git log --oneline origin/main..HEAD` and rebuild by cherry-picking onto
  current `main` if the base is wrong.
- Do not put machine-specific absolute paths in shared docs or skills. Use
  `$LOCALAPPDATA` / `$HOME`, or resolve with
  `git rev-parse --show-toplevel`. This bit both `AGENTS.md` (nearly) and
  `codex-in-cc/SKILL.md` (actually).
- Cursor's `agent` shim is not on a non-interactive shell's `PATH`; the
  `cursor-cli` wrapper fails with "agent was not found" until
  `CURSOR_AGENT_BIN` names it. See `AGENTS.md` → "Cursor Agent binary".
- Cursor is operator-selected only, and `auto` is rejected because Cursor routes
  across model families. A Claude model through Cursor is only cold-review
  rung 2 against a Claude implementer; pick a different family for rung 1.
- `task.mjs archive` takes no task ID — it is `archive [--dry-run]` and sweeps
  every `done` card. `task.mjs archive task-NNN` fails with
  `ERROR: unknown flag`.
- `gh pr merge --squash --delete-branch` can merge remotely and *then* exit
  nonzero when it tries to switch to a `main` that is checked out elsewhere.
  Query `gh pr view` after such an error before retrying; the remote operation
  may already have succeeded.
- The GitHub connector and local `gh` CLI can represent different accounts. The
  connector failed PR creation with "must be a collaborator"; `gh auth status`
  confirmed `shiftynick` and the CLI succeeded. The CLI is the verified path.
- On Windows, launching the Claude wrapper through `Start-Process` can split a
  multiword prompt into invalid arguments. Direct invocation with
  `& node ... --prompt $prompt` is the verified path.
- Do not simplify replay/persistence precedence casually. Availability,
  structural validity, sequence replay, writer state, oversize classification,
  idempotency, and domain rejection are intentionally ordered, and cold
  recovery must reproduce the same outcome.
- Editing a `mold` file without recording it in `.agent-foundry/LOCAL-CHANGES.md`
  means the next Foundry upgrade silently reverts it. The task-019 SDLC section
  survived this upgrade only because the drift report caught it.
- Never report a planned or unavailable command as passing. Record executable
  evidence through the task tracker.
