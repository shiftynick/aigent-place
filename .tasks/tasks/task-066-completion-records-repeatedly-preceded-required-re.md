---
id: task-066
title: Completion records repeatedly preceded required review evidence
status: backlog
priority: p2
tags: [area:quality, phase:retrospective, needs:operator]
blockedBy: []
createdAt: "2026-10-08T14:07:36Z"
updatedAt: "2026-10-08T14:07:36Z"
---

<!-- task-tracker:description -->
## Description

First recorded retrospective covers 2026-07-29 through 2026-10-08. Tasks 003, 060 and 061 were marked done then forcibly reopened for unresolved findings or missing cold review/full gates. Existing upgrade guidance already predates the occurrences, so this is a point-of-use completion failure. Proposed exact small correction in both execute-task skill copies: replace "Then, when the task may reach done:" with "Before running move ... done, record a completion note that links the final passing gates and both terminal review results; if either is missing or unresolved, keep the task in review." A generic mold correction requires its own lifecycle, sync validation and upstream treatment; defer implementation for operator decision.

<!-- task-tracker:log -->
## Log

- 2026-10-08T14:07:36Z — created (status: backlog)
