---
id: task-2929451841000002
title: Stop hand-transcribing the ruleset catalog into Rust
status: backlog
priority: p2
tags: [area:server]
blockedBy: []
createdAt: "2026-08-06T14:57:42Z"
updatedAt: "2026-10-08T14:11:34Z"
---

<!-- task-tracker:description -->
## Description

crates/world-server/src/ruleset.rs holds a hand-written subset of the ruleset/v1 parameter catalog: paths, inclusive ranges, defaults, and cross-field constraints are transcribed from ruleset/v1/CONTRACT.md and duplicated again in scripts/ruleset-contract.mjs. task-047 grew that subset from 5 paths to 10 by adding the shape.* budgets, which makes the drift risk concrete - the Rust catalog and the JS contract evaluator can now disagree about a range or a default with nothing failing. docs/ENGINEERING-STANDARDS.md requires one source of truth per fact and says protocol and ruleset contracts are defined once and generated, not hand-copied; the Rust ruleset catalog currently violates that the same way hand-copied wire types would. Also note the Rust composite cost model is still the skeleton's candidate_cost/cost_ceiling stand-in rather than the section 4 formula. Options: generate the Rust catalog table from the contract during the build the way protocol types are generated, or add a gate check that asserts the Rust catalog agrees with scripts/ruleset-contract.mjs for every path it declares. Acceptance: changing a range or default in one place cannot leave the other stale without a check failing.

<!-- task-tracker:log -->
## Log

- 2026-08-06T14:57:42Z — created (status: backlog)
- 2026-10-08T14:11:34Z — note: Audit 2026-10-08 @4e3e070: shape_budget_catalog_contract now guards five shape paths. Narrow remaining contract drift to movement runtime rows and explicitly labelled prototype governance defaults (1/2 versus normative1200/6000). Avoid duplicating completed shape guards.
