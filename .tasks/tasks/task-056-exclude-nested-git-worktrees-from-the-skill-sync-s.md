---
id: task-056
title: Exclude nested git worktrees from the skill-sync scan
status: backlog
priority: p3
tags: [area:process, phase:debt]
blockedBy: []
createdAt: "2026-08-06T14:12:46Z"
updatedAt: "2026-08-06T14:12:46Z"
---

<!-- task-tracker:description -->
## Description

When a workflow runs subagents in isolated git worktrees created under .claude/worktrees/, node .agent-foundry/check-skill-sync.mjs walks the nested checkouts and reports every mirrored skill file inside them as a drift violation, so node scripts/check.mjs fails for reasons unrelated to the change under test. Normal workflow completion removes the worktrees, so this only bites when a run is interrupted, but the failure mode is confusing and blocks the gate. Make the scan ignore nested worktree checkouts, and add .claude/worktrees/ to .gitignore so the directory is never a candidate for staging. Acceptance: with a populated .claude/worktrees/ present, node scripts/check.mjs passes and skill-sync reports only the repository's own mirrored skills; git status does not list worktree contents; a focused test or recorded run demonstrates the previously failing condition now passing.

<!-- task-tracker:log -->
## Log

- 2026-08-06T14:12:46Z — created (status: backlog)
