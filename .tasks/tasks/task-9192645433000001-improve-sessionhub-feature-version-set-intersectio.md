---
id: task-9192645433000001
title: Improve SessionHub feature version set intersection
status: backlog
priority: p3
tags: [area:network, phase:follow-up]
blockedBy: []
createdAt: "2026-08-04T21:19:04Z"
updatedAt: "2026-08-04T21:19:04Z"
---

<!-- task-tracker:description -->
## Description

SessionHub FeatureOffer carries a single version; wire FeatureOffer.supported_versions cannot intersect correctly when the client offers a non-contiguous set. Acceptance: negotiation selects the highest mutually supported version from the full client set without false acceptance of unsupported mid values.

<!-- task-tracker:log -->
## Log

- 2026-08-04T21:19:04Z — created (status: backlog)
