# Contributing to Aigent Place

Start with `AGENTS.md`, then inspect the task board. Use the skill tree for
the harness you are in — `.agents/skills/...` under Codex,
`.claude/skills/...` under Claude Code; the CLI is identical in both.

```text
node .agents/skills/task-tracker/scripts/task.mjs board
node .agents/skills/task-tracker/scripts/task.mjs next
```

Update `main`, then create a branch and optional worktree for the assigned
task:

```text
git fetch origin
git worktree add ../aigent-place-task-NNN -b task-NNN-short-slug origin/main
```

The explicit `origin/main` start point prevents a new task from inheriting
another task branch's unmerged commits. Use one agent per worktree.

Enable the repository's direct-main push guard once per clone:

```text
git config core.hooksPath .githooks
```

## Changes

- Work on one `task-NNN-short-slug` branch and pull request per board task;
  never commit or push directly to `main`.
- Complete `.github/pull_request_template.md` honestly. Validation evidence
  names commands that actually ran, and the task log remains authoritative.
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

Use the exact Node.js version in `.nvmrc`; Node 20 is only the minimum runtime
supported by the process tooling. The gate runs the Foundry suites, the
direct-main push-guard tests, and the process-document scan whose exact scope
is defined in `AGENTS.md`. Those hook tests require `sh`, supplied by Git for
Windows and standard on supported POSIX development environments. GitHub
Actions uses `.nvmrc` and runs the same command as `process-gate` on every
pushed branch, pull requests, and `main`. The check becomes required when
server-side protection is available.

When the workspace task introduces product commands, update this section and
`AGENTS.md` in the same change.

Do not claim a check passed unless it was executed successfully in the current
change packet.
