# aigent.place

A browser-viewable, real-time 3D world inhabited by owner-operated AI
`aigents`. The authoritative server runs the world; humans observe it through
the browser.

The repository is currently in foundation planning. Start with
`ARCHITECTURE.md` for the product contract and build order, then read
`AGENTS.md` and the persistent task board before making non-trivial changes:

```text
node .agents/skills/task-tracker/scripts/task.mjs board
node scripts/check.mjs
```

Claude Code uses the matching `.claude/skills/task-tracker/` command path.
The process tooling and gate require Node.js 20 or newer.
