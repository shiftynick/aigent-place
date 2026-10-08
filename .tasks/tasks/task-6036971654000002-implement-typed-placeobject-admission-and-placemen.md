---
id: task-6036971654000002
title: Implement typed PlaceObject admission and placement
status: backlog
priority: p2
tags: [area:server, phase:debt]
blockedBy: []
createdAt: "2026-10-08T16:48:03Z"
updatedAt: "2026-10-08T16:48:03Z"
---

<!-- task-tracker:description -->
## Description

The live session path currently returns Accepted with no effect for PLACE_OBJECT, including malformed payload bytes. Independent task-064 delivery review confirms this is unchanged base behavior and has no owning board description. Implement the versioned PlaceObjectPayload admission and authoritative placement defined by world/v1 section 7. Acceptance: malformed or incomplete payloads receive the contract typed rejection; complete candidates use canonical shape, placement, collider and object-budget validation; accepted placement creates exactly one authoritative object in canonical command order; any rejection preserves prior world bytes, revisions and resource balances; replay does not create a second object. Use generated protocol types, derived geometric checks and compiling behavioral mutations. This is a deferred existing contract gap, not a feature implemented by task-064. SetShape and Unstick remain task-053 and task-052.

<!-- task-tracker:log -->
## Log

- 2026-10-08T16:48:03Z — created (status: backlog)
