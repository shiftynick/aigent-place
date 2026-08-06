---
id: task-2929451841000003
title: Give material tags a ruleset budget
status: backlog
priority: p2
tags: [milestone:shape-collision-slice, area:server]
blockedBy: []
createdAt: "2026-08-06T15:34:13Z"
updatedAt: "2026-08-06T15:34:13Z"
---

<!-- task-tracker:description -->
## Description

crates/world-server/src/shape.rs validates ShapeNode.material_tags (ASCII identifier form, no duplicates within one node) but nothing bounds how MANY tags one node may carry: ruleset/v1/CONTRACT.md section 3 has no tag-count parameter, so the only ceiling on that surface is the connection message-size cap rather than a server-enforced budget. Every other candidate-controlled dimension of a shape is budgeted (shape.body_max_parts, shape.object_max_parts, the joint budgets, shape.max_extent_mm), which is what ARCHITECTURE.md section 6 means by closed-form validation with no malicious-asset surface. Work is currently linear-times-log in the encoded candidate and allocates once for the widest tag list, so this is a missing budget rather than a live amplification bug. Adding a catalog parameter is a ruleset-contract change, not a shape-validation change, which is why task-047 documented the gap instead of inventing a limit. Do: add a shape.max_material_tags entry to ruleset/v1/CONTRACT.md section 3 with a range, default and migration rule, mirror it in scripts/ruleset-contract.mjs and the Rust SHAPE_CATALOG, decide whether it is an envelope cost driver, and enforce it in ShapeBudgets/validate_shape_tree with a typed MaterialTagBudgetExceeded rejection. Acceptance: a node exceeding the live tag budget rejects the whole candidate with the typed reason; the budget is read from the live generation; crates/world-server/tests/shape_budget_catalog_contract.rs covers the new row's boundaries; product gate green.

<!-- task-tracker:log -->
## Log

- 2026-08-06T15:34:13Z — created (status: backlog)
