# HANDOFF — Aigent Place

A repository for the Aigent Place architecture and implementation.

This handoff was initialized and tailored during installation. The
`handoff-writer` skill owns it from here on and preserves these sections while
refreshing their state.

## TL;DR

The repository contains an approved base architecture and an Agent Foundry
workflow, but no product runtime or build workspace. It is hosted publicly at
`shiftynick/aigent-place`; task `task-019` established the protected
branch-per-task pull-request workflow. Continue with `task-002`, the versioned
protocol envelope and compatibility contract.

## To pick up tomorrow

Exact, copy-pasteable commands. Use the skill tree for your harness —
`.agents/skills/...` under Codex, `.claude/skills/...` under Claude Code.

```text
git status --short
node .agents/skills/task-tracker/scripts/task.mjs board
```

Then read the active task and its log before changing any file.

## What's where

| Path | Purpose |
| --- | --- |
| `ARCHITECTURE.md` | Product contract, locked decisions, workload targets, and build order. |
| `README.md` | Human entry point and current repository-stage summary. |
| `AGENTS.md` | Agent operating contract, source precedence, invariants, and quality gate. |
| `CLAUDE.md` | Claude Code entry point into the shared operating contract. |
| `CONTRIBUTING.md` | Contribution, review, and validation workflow. |
| `.tasks/` | Persistent implementation board and execution evidence. |
| `.agents/skills/`, `.claude/skills/` | Codex and Claude workflow implementations. |
| `docs/SDLC.md` | Task lifecycle, cold-review ladder, and commit authority. |
| `docs/adr/` | Proposed and accepted architecture decisions. |
| `docs/ENGINEERING-STANDARDS.md` | General and stack-specific engineering rules. |
| `docs/REVIEW-STANDARDS.md` | Seed review lenses and future project-earned patterns. |
| `.agent-foundry/` | Installed checks, manifest, drift guidance, and local-change record. |
| `scripts/` | Authoritative local gate wrapper and its regression tests. |
| `.gitignore` | Repository-local transient-state exclusions. |
| `PLANNING-JOURNAL.md`, `BLOCKED-JOURNAL.md` | Durable planning and blocker history. |

## Mental model

The server owns world truth. Owner-run aigent services are remote brains that
submit bounded intents; browsers only observe snapshots. The 20 Hz simulation
stage is isolated from serialization and socket I/O, and same-build replay
depends on canonical ordering plus seeded randomness. The shared primitive
shape grammar drives bodies, structures, and colliders. `aigent` is the
intentional product term for a world inhabitant; use plain `agent` only for the
generic industry concept.

## What was finished this session

- Installed Agent Foundry 0.6.0 without `--force`.
- Preserved `.claude/skills/codex-in-cc/SKILL.md`.
- Tailored the project orientation, engineering standards, validation
  contract, handoff, and initial implementation board from `ARCHITECTURE.md`.
- Added one bootstrap-earned review lens for recognizing locked architecture
  decisions; no runtime defect pattern exists yet.
- Retained the pre-existing `.claude/skills/codex-in-cc/` bridge as a local
  extension; the Foundry lifecycle uses `.claude/skills/codex-in-claude/`.

## What's in progress / half-done

No product implementation is half-done. `task-019` created the public remote,
protected `main`, and proved `process-gate` locally and on a clean Ubuntu
checkout. The dependency-ordered Step 0 contract front is ready.

## Open questions for the human

The unresolved product questions are listed under `ARCHITECTURE.md` → "Open
questions" and tracked by `task-017`; they do not block the first foundation
contracts.

## Validation state

The current `node scripts/check.mjs` evidence is recorded in `task-019`: 16
local tests and all 289 Foundry tests pass. GitHub Actions run `30459765418`
passed `process-gate` in 30 seconds on a clean Ubuntu checkout with the pinned
Node version and active `main` ruleset. No product build or runtime validation
exists yet.

## Worktree and operational state

The bootstrap commit is published as the initial `main` of the public
`git@github.com:shiftynick/aigent-place.git` remote. Governance work is on
`main` after squash-merging PR #1. The clone uses `.githooks` through
`core.hooksPath`. There are no running services, credentials, or deployments.
Task-001 tailored the README entry point and left `ARCHITECTURE.md` unchanged.

## Known blockers and risks

No current delivery blocker is recorded. The main product risk remains
implementing runtime code before the Step 0 contracts and executable quality
gate are established.

## Common pitfalls

- Do not spell a world inhabitant as `agent`; the deliberate product noun is
  `aigent`.
- Do not treat compilation or type generation as proof of the 20 Hz,
  backpressure, replay, or workload contracts; each needs behavioral evidence.
- Do not let viewer serialization or slow sockets run on the simulation stage.
