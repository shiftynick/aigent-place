---
id: task-3618552301000002
title: Return a typed resync failure instead of an untyped None from client_resync
status: backlog
priority: p2
tags: [area:network, phase:debt]
blockedBy: []
createdAt: "2026-08-06T14:38:15Z"
updatedAt: "2026-08-06T14:45:54Z"
---

<!-- task-tracker:description -->
## Description

SnapshotFanout::client_resync (crates/world-server/src/fanout.rs) returns Option, so 'connection is gone', 'outbound queue is closed', and 'the AOI policy rejected the interest refresh' all collapse into None. TransportState::deliver_client_resync collapses those into a bool, and the SnapshotResyncRequest handler discards even that, so a client whose resync cannot be built waits forever with no answer. task-044 fixed the sibling case on the drain path (DrainReport.interest_unavailable now carries the connection and its typed AoiError) but could not finish this one: telling the client anything requires a ProtocolErrorCode that does not exist. protocol/v1/aigent.proto has UNSUPPORTED_PROTOCOL, UPGRADE_REQUIRED, INVALID_ENVELOPE, UNSUPPORTED_MESSAGE, UNSUPPORTED_FEATURE, and three PERSISTENCE codes; none describes a server-side interest-policy failure, and adding one is a versioned wire-contract change. Widening only the Rust return type without it would leave the client just as silent. Acceptance: a protocol error code for a resync the server cannot build is added to protocol/v1 with regenerated bindings; client_resync returns a typed outcome distinguishing missing connection, closed queue, and interest-policy failure; deliver_client_resync propagates it; the socket handler answers with that typed error; a test asserts the client receives it instead of waiting. Note the state is currently unreachable in production because nothing sets a zero viewer AOI cap and the degradation ladder's minimum is 25.

<!-- task-tracker:log -->
## Log

- 2026-08-06T14:38:15Z — created (status: backlog)
- 2026-08-06T14:45:54Z — edited (description updated)
