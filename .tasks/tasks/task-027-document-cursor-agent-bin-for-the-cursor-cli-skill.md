---
id: task-027
title: Document CURSOR_AGENT_BIN for the cursor-cli skill
status: done
priority: p3
tags: [area:process]
blockedBy: []
createdAt: "2026-07-30T18:46:09Z"
updatedAt: "2026-07-30T18:47:01Z"
---

<!-- task-tracker:description -->
## Description



<!-- task-tracker:log -->
## Log

- 2026-07-30T18:46:09Z — created (status: backlog)
- 2026-07-30T18:47:00Z — moved to in_progress (claimed by shift@Shiftor)
- 2026-07-30T18:47:01Z — note: Documented CURSOR_AGENT_BIN under Project-local skills in AGENTS.md using generic install locations rather than a machine-specific absolute path. Verified the documented Windows form end to end: CURSOR_AGENT_BIN="$LOCALAPPDATA/cursor-agent/agent.cmd" ... --list-models returned the model list. Gate: node scripts/check.mjs PASS (run-checks skill-sync + 16 suites).
- 2026-07-30T18:47:01Z — moved to review
- 2026-07-30T18:47:01Z — moved to done
