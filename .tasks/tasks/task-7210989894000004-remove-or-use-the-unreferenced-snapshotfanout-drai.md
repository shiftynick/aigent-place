---
id: task-7210989894000004
title: "Remove or use the unreferenced SnapshotFanout::drain_mailbox"
status: backlog
priority: p3
tags: [area:network, phase:debt]
blockedBy: []
createdAt: "2026-08-06T15:47:52Z"
updatedAt: "2026-08-06T15:47:52Z"
---

<!-- task-tracker:description -->
## Description

Discovered while fixing task-041. SnapshotFanout::drain_mailbox (crates/world-server/src/fanout.rs) is public and has no caller anywhere in the workspace: the live path drives PublicationMailbox::take and SnapshotFanout::publish_interest_to directly from TransportState::drain_fanout. It is a second, untested way to fan a generation out to every connection, which is exactly where a future caller could reintroduce the byte-accounting defect task-041 fixed. Either delete it or make the live drain use it.

<!-- task-tracker:log -->
## Log

- 2026-08-06T15:47:52Z — created (status: backlog)
