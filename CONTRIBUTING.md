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

For every change, run the process/contract gate:

```text
node scripts/check.mjs
```

For product workspace changes (Rust server, viewer, or their tooling), also run:

```text
node scripts/product-check.mjs
```

Use the exact Node.js version in `.nvmrc` and the Rust toolchain pinned by
`rust-toolchain.toml`. Node 20 is only the minimum runtime supported by the
process tooling. The process gate runs the Foundry suites, contract oracles,
direct-main push-guard tests, and the process-document scan whose exact scope
is defined in `AGENTS.md`. Those hook tests require `sh`, supplied by Git for
Windows and standard on supported POSIX development environments. The product
gate runs `cargo fmt --check`, `cargo clippy -D warnings`, `cargo test`, the
`world-server` smoke binary, and the viewer production build plus smoke script.

GitHub Actions currently runs `node scripts/check.mjs` as `process-gate` on
every pull request and push to `main`. Task-014 wires the product gate into CI
and pre-commit. The active `main` ruleset requires the process check on an
up-to-date branch.

Verified product helper commands (also exercised by `product-check`):

```text
cargo run -p world-server
npm ci
npm run viewer:build
npm run viewer:smoke
```

`product-check` always runs `npm ci` so the install matches `package-lock.json`.
It also refuses to continue when `process.versions.node` does not equal the
exact version in `.nvmrc`.
Do not claim a check passed unless it was executed successfully in the current
change packet.
