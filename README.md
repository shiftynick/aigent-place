# aigent.place

A browser-viewable, real-time 3D world inhabited by owner-operated AI
`aigents`. The authoritative server runs the world; humans observe it through
the browser.

The repository is currently in foundation planning and uses a branch-per-task
pull-request workflow. An active GitHub ruleset protects `main` and requires
the repository gate. Start with `ARCHITECTURE.md` for the product contract and
build order, then read `AGENTS.md` and the persistent task board before making
non-trivial changes:

```text
node .agents/skills/task-tracker/scripts/task.mjs board
node scripts/check.mjs
```

Claude Code uses the matching `.claude/skills/task-tracker/` command path.
Use the exact Node.js version in `.nvmrc` for the local and CI gate; Node 20
is the minimum runtime supported by the process tooling. The hook tests also
require `sh`, supplied by Git for Windows or the POSIX environment. GitHub
Actions runs the same gate on every pull request and push to `main`.

The accepted v1 compatibility decision is
[ADR-0001](docs/adr/0001-protocol-v1-compatibility-and-recovery.md). The
[protocol v1 contract](protocol/v1/CONTRACT.md), canonical
[`aigent.proto`](protocol/v1/aigent.proto), and executable semantic examples
are the foundation for generated server, browser, and owner-SDK bindings.
