---
id: task-014
title: Wire the unified gate into pre-commit and branch CI
status: backlog
priority: p0
tags: [area:tooling, milestone:foundations, needs:operator]
blockedBy: [task-003]
createdAt: "2026-07-29T12:55:19Z"
updatedAt: "2026-07-29T13:07:05Z"
---

<!-- task-tracker:description -->
## Description

After the operator selects a CI provider and remote, make the product and Foundry gate unskippable. Acceptance: the documented fast subset runs from a repository pre-commit hook, the full unified gate runs on every branch in the chosen CI, clean-checkout evidence passes, and hook/CI failures preserve actionable output without bypass guidance.

<!-- task-tracker:log -->
## Log

- 2026-07-29T12:55:19Z — created (status: backlog)
- 2026-07-29T13:07:05Z — edited (+tag needs:operator; description updated)
