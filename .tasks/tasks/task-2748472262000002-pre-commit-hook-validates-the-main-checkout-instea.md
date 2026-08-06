---
id: task-2748472262000002
title: Pre-commit hook validates the main checkout instead of the linked worktree
status: backlog
priority: p1
tags: [area:process, needs:operator]
blockedBy: []
createdAt: "2026-08-06T15:30:49Z"
updatedAt: "2026-08-06T15:30:49Z"
---

<!-- task-tracker:description -->
## Description

In this clone core.hooksPath is an absolute path into the main checkout, and .githooks/pre-commit derives its root from the hook script location rather than from the working tree being committed. In any linked git worktree the hook therefore changes into the main checkout and runs the fast product subset there instead of against the code being committed. Observed while committing on branch task-046-authoritative-entity-store from a linked worktree: the hook reported 12 reliability_behavior tests and did not run the entity_store_behavior binary at all, which is the test set of main, while the identical command run from the worktree ran 7 entity_store_behavior tests and 13 reliability_behavior tests and printed PASS. Effect: anyone committing from a worktree receives a green pre-commit signal for code they are not committing, and a broken worktree commit would still pass the hook. Durable behavior wanted: the pre-commit hook validates the working tree that owns the commit. Resolving the hook root from the git top-level of the invoking working tree is the obvious approach, with a regression check next to the existing push-guard behavioral test in the unified gate. AGENTS.md Git discipline makes .githooks a surface that requires asking the operator first, so agree the approach before changing the hook.

<!-- task-tracker:log -->
## Log

- 2026-08-06T15:30:49Z — created (status: backlog)
