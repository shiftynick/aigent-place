---
id: task-055
title: Render shape trees and terrain in the viewer
status: backlog
priority: p1
tags: [milestone:shape-collision-slice, area:viewer]
blockedBy: [task-054]
createdAt: "2026-08-06T13:25:52Z"
updatedAt: "2026-10-08T19:51:08Z"
---

<!-- task-tracker:description -->
## Description

The viewer renders placeholder geometry at snapshot positions. Render authoritative shape trees as actual Three.js primitives covering all six v1 primitives with per-part transform, color, and material tags, plus the terrain surface as bilinear patches over the heightfield lattice per ADR-0003. The render surface is descriptive, not authoritative collision geometry. The viewer rebases its render origin per 64 metre chunk so browser f32 precision never degrades visibly across the world bound. Spectators remain anonymous and read-only. Acceptance: a multi-part body renders with correct part transforms and composed parent-then-child rotation; terrain renders smoothly across a chunk seam with no visible crack or lighting discontinuity; a body at the far edge of the world bound renders without visible precision artifacts; interpolation between 10Hz snapshots stays smooth and degrades cleanly to 5Hz and 2Hz; product gate green.

<!-- task-tracker:log -->
## Log

- 2026-08-06T13:25:52Z — created (status: backlog)
- 2026-10-08T19:51:08Z — note: Round2 task067 fresh live spectator and root images verify close-position label overlap remains a low presentation issue after60degree initial camera correction. Record label de-overlap or an occlusion-visible selected-body mark in viewer presentation follow-up; keep coordinates authoritative and make no fake world separation. Current body list still selects correct ID, so task067 acceptance passes. This is not approval to start task055 or a world collision fix.
