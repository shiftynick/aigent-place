# CLAUDE.md

Read `AGENTS.md` first; it is the shared project orientation and operating
contract for Aigent Place.

Claude-specific workflow skills live under `.claude/skills/`. Use:

```text
node .claude/skills/task-tracker/scripts/task.mjs board
node .claude/skills/task-tracker/scripts/task.mjs next
```

Use `.claude/skills/codex-in-claude/` for cold Codex review when the shared
`execute-task` workflow requires the other model family. When it is
unavailable, descend the cold-review ladder in `docs/SDLC.md` rather than
skipping the review.

Do not duplicate product rules here. Update `AGENTS.md` so humans, Codex, and
Claude receive the same authoritative project contract.
