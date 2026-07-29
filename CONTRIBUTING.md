# Contributing to Aigent Place

Start with `AGENTS.md`, then inspect the task board. Use the skill tree for
the harness you are in — `.agents/skills/...` under Codex,
`.claude/skills/...` under Claude Code; the CLI is identical in both.

```text
node .agents/skills/task-tracker/scripts/task.mjs board
node .agents/skills/task-tracker/scripts/task.mjs next
```

## Changes

- Use a board task for non-trivial code, configuration, architecture, process,
  or documentation work.
- Keep one coherent objective per task and commit.
- Write observable acceptance criteria and a short execution rubric.
- Preserve unrelated worktree changes.
- Add tests that would fail without behavioral changes.
- Update behavior, commands, contracts, and limitations with their docs.

## Review

Every task receives separate cold-context passes:

- SPEC checks the objective and rubric.
- STANDARDS checks correctness, safety, maintainability, tests, and project
  invariants.

Use the highest available rung of the cold-review ladder in `docs/SDLC.md` and
record which rung was used. Review findings are hypotheses until verified
against live evidence.

If you change a skill, change its mirrored copy in the counterpart harness in
the same commit and run `node .agent-foundry/check-skill-sync.mjs`.

## Validation

The product workspace has not been scaffolded, so there is not yet a product
build, lint, or test command. Run the installed process-tooling gate for every
change:

```text
node scripts/check.mjs
```

The gate requires Node.js 20 or newer. It runs the Foundry suites and the
process-document scan whose exact scope is defined in `AGENTS.md`.

When the workspace task introduces product commands, update this section and
`AGENTS.md` in the same change.

Do not claim a check passed unless it was executed successfully in the current
change packet.
