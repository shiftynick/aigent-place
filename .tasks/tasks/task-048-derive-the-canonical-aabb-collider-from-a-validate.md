---
id: task-048
title: Derive the canonical AABB collider from a validated shape tree
status: in_progress
priority: p0
tags: [milestone:shape-collision-slice, area:server]
blockedBy: [task-047]
createdAt: "2026-08-06T13:25:08Z"
updatedAt: "2026-08-10T01:20:39Z"
claimedBy: codex-attack-collision-core
claimedAt: "2026-08-10T01:01:07Z"
---

<!-- task-tracker:description -->
## Description

Nothing derives collision geometry from a shape. Implement the canonical collider per ADR-0002: the ordered union of one conservative world-axis-aligned bounding box per transformed primitive, sorted by node id. Each AABB is derived analytically from the primitive's local extents and its absolute rotation matrix after parent transforms compose before child transforms. Rendering detail, color, material tags, and joint names must not affect the collider. Provide the aggregate AABB and aggregate horizontal footprint that grounding, placement, and enclosure checks consume. Two AABBs overlap only when their intersection has positive extent on all three axes; face, edge, and point contact are legal. Acceptance: derivation is deterministic and order-stable for a given tree; rotated primitives produce conservative boxes that contain the primitive; the positive-extent overlap rule is exercised at exact face, edge, and point contact and reports no overlap; cosmetic-only tree changes produce a byte-identical collider; product gate green.

<!-- task-tracker:log -->
## Log

- 2026-08-06T13:25:08Z — created (status: backlog)
- 2026-08-10T01:01:06Z — note: operator: approved collision-core attack path task-048 -> task-2929451841000001 -> task-049 -> task-050 -> task-051; coding model cursor-grok-4.5-high at high effort; Fable cold reviews at low effort
- 2026-08-10T01:01:07Z — note: rubric: (1) Derive one conservative world-axis-aligned AABB per transformed primitive using composed parent-before-child transforms and stable node-id order. (2) Expose deterministic aggregate AABB and horizontal footprint values for downstream grounding, placement, and enclosure checks. (3) Treat only positive three-axis intersection as overlap, with exact face, edge, and point contact legal. (4) Prove rotated primitives are contained and cosmetic-only changes leave collider bytes unchanged using behavior tests that fail when derivation or ordering is broken. (5) Keep the change task-scoped, document the collider boundary, and pass focused tests plus the full product gate.
- 2026-08-10T01:01:07Z — moved to in_progress (claimed by codex-attack-collision-core)
- 2026-08-10T01:03:41Z — run: node .agent-foundry/agent-headless/cli.js run --provider cursor --cwd N:\aigent-place --model cursor-grok-4.5-high --effort high --access inspect --prompt-file .tasks/review-packets/task-048-cursor-design.md --timeout-ms 1200000 --trust-workspace --output text --json
  started 2026-08-10T01:01:49Z, exit 0 in 112.5s
  output:
  | {
  |   "provider": "cursor",
  |   "status": "succeeded",
  |   "finalText": "",
  |   "events": [
  |     {
  |       "provider": "cursor",
  |       "type": "result",
  |       "kind": "result",
  |       "raw": "\n"
  |     }
  |   ],
  |   "exitCode": 0,
  |   "modelRequested": "cursor-grok-4.5-high",
  |   "warnings": [],
  |   "workspace": {
  |     "cwd": "N:\\aigent-place",
  |     "access": "inspect"
  |   },
  |   "stderr": "",
  |   "durationMs": 111534
  | }
  | (node:55884) [MODULE_TYPELESS_PACKAGE_JSON] Warning: Module type of file:///N:/aigent-place/.agent-foundry/agent-headless/cli.js is not specified and it doesn't parse as CommonJS.
  | Reparsing as ES module because module syntax was detected. This incurs a performance overhead.
  | To eliminate this warning, add "type": "module" to N:\aigent-place\package.json.
  | (Use `node --trace-warnings ...` to show where the warning was created)
- 2026-08-10T01:03:55Z — note: friction: Cursor cursor-grok-4.5-high inspect call completed successfully but returned an empty result, so it supplied no API proposal; do not repeat the same call without changing the packet or access mode
- 2026-08-10T01:04:52Z — note: outline: add collider.rs with WorldPointMm::new/accessors, Aabb::min/max/overlaps_positive_volume/horizontal_footprint, HorizontalFootprint accessors, NodeAabb::node_id/bounds, Collider::parts/aggregate/canonical_bits, and derive_collider(&ShapeTree, WorldPointMm) -> Result<Collider, ColliderDerivationError>. Use f64 millimetres because rotated integer dimensions and odd half-extents are fractional; canonical bits preserve same-build byte comparison. Derivation errors fail closed on non-finite world translation or arithmetic and on any supposedly validated-tree invariant missing at this boundary. Export through lib.rs. No aggregate ruleset-budget enforcement in this task.
- 2026-08-10T01:20:39Z — run: node .agent-foundry/agent-headless/cli.js run --provider cursor --cwd N:\aigent-place --model cursor-grok-4.5-high --effort high --access edit-isolated --prompt-file C:\Users\shift\AppData\Local\Temp\codex-task-048-cursor-impl.md --timeout-ms 1200000 --trust-workspace --output text --json
  started 2026-08-10T01:05:39Z, timed out after 900.0s
  output:
  | (node:56968) [MODULE_TYPELESS_PACKAGE_JSON] Warning: Module type of file:///N:/aigent-place/.agent-foundry/agent-headless/cli.js is not specified and it doesn't parse as CommonJS.
  | Reparsing as ES module because module syntax was detected. This incurs a performance overhead.
  | To eliminate this warning, add "type": "module" to N:\aigent-place\package.json.
  | (Use `node --trace-warnings ...` to show where the warning was created)
