---
id: task-014
title: Wire the unified gate into pre-commit and branch CI
status: backlog
priority: p0
tags: [area:tooling, milestone:foundations]
blockedBy: [task-003]
createdAt: "2026-07-29T12:55:19Z"
updatedAt: "2026-07-29T13:40:17Z"
---

<!-- task-tracker:description -->
## Description

After the product workspace establishes its pinned build and test commands, extend the existing GitHub process-gate workflow with the product gate and add the documented fast subset to a repository pre-commit hook. Acceptance: the fast subset runs locally before commits, the full unified product plus Foundry gate runs on pull requests and main, clean-checkout evidence passes, and hook or CI failures preserve actionable output without bypass guidance.

<!-- task-tracker:log -->
## Log

- 2026-07-29T12:55:19Z — created (status: backlog)
- 2026-07-29T13:07:05Z — edited (+tag needs:operator; description updated)
- 2026-07-29T13:40:17Z — edited (-tag needs:operator; description updated)
