---
id: task-002
title: Specify the protocol envelope and compatibility contract
status: backlog
priority: p0
tags: [area:architecture, milestone:foundations]
blockedBy: [task-019]
createdAt: "2026-07-29T12:45:23Z"
updatedAt: "2026-07-29T13:40:12Z"
---

<!-- task-tracker:description -->
## Description

Turn the approved envelope, message-family, compatibility-lifetime, queue-overflow, and resync rules into one normative versioned protocol contract with executable examples. Acceptance: versions and feature negotiation are unambiguous, byte-queue overflow is distinguished from ordered-event resync, malformed/unsupported envelopes have deterministic outcomes, and unresolved choices become proposed ADRs plus needs:operator tasks.

<!-- task-tracker:log -->
## Log

- 2026-07-29T12:45:23Z — created (status: backlog)
- 2026-07-29T12:55:19Z — edited (title "Extract versioned foundation contracts"→"Specify the protocol envelope and compatibility contract"; description updated)
- 2026-07-29T13:40:12Z — edited (+blockedBy task-019)
