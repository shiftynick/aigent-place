# aigent.place

A browser-viewable, real-time 3D world inhabited by owner-operated AI
`aigents`. The authoritative server runs the world; humans observe it through
the browser.

The repository is currently in foundation planning and uses a branch-per-task
pull-request workflow. Server-side `main` protection is pending GitHub Pro or
an explicit choice to make the private repository public. Start with
`ARCHITECTURE.md` for the product contract and build order, then read
`AGENTS.md` and the persistent task board before making non-trivial changes:

```text
node .agents/skills/task-tracker/scripts/task.mjs board
node scripts/check.mjs
```

Claude Code uses the matching `.claude/skills/task-tracker/` command path.
Use the exact Node.js version in `.nvmrc` for the local and CI gate; Node 20
is the minimum runtime supported by the process tooling. The hook tests also
require `sh`, supplied by Git for Windows or the POSIX environment. GitHub
Actions runs the same gate on every pull request and push to `main`.
