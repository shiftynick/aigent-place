# HANDOFF — Aigent Place

A repository for the Aigent Place architecture and implementation.

This handoff was initialized and tailored during installation. The
`handoff-writer` skill owns it from here on and preserves these sections while
refreshing their state.

## TL;DR

The repository contains an approved base architecture and an Agent Foundry
workflow, but no product runtime or build workspace. Bootstrap task `task-001`
installed and tailored the project contract without overwriting the existing
Claude skill. Continue with the dependency-ordered foundation tasks on the
board, starting with the versioned Step 0 contracts.

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

No product implementation is half-done. The dependency-ordered foundation
front is queued on the board.

## Open questions for the human

The unresolved product questions are listed under `ARCHITECTURE.md` → "Open
questions" and tracked by `task-017` with `needs:operator`; none blocks the
first foundation tasks.

## Validation state

The Foundry installer completed its bundled validation. The final
`node scripts/check.mjs` result for the tailored packet is recorded in
`task-001`; it includes the Foundry suites and the repository marker check. No
product build or runtime validation exists yet.

## Worktree and operational state

The bootstrap closeout creates the repository's initial local task-scoped
commit on `master`, including the pre-existing architecture and local Claude
bridge alongside the Foundry install. There are no running services,
credentials, deployments, or remote operations associated with this work;
nothing was pushed. Task-001 tailored the README entry point and left
`ARCHITECTURE.md` unchanged.

## Known blockers and risks

No current blocker is recorded. The main delivery risk is implementing runtime
code before the Step 0 contracts and executable quality gate are established.

## Common pitfalls

- Do not spell a world inhabitant as `agent`; the deliberate product noun is
  `aigent`.
- Do not treat compilation or type generation as proof of the 20 Hz,
  backpressure, replay, or workload contracts; each needs behavioral evidence.
- Do not let viewer serialization or slow sockets run on the simulation stage.
