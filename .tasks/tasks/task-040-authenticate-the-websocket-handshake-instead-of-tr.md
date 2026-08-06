---
id: task-040
title: Authenticate the WebSocket handshake instead of trusting aigent_id
status: backlog
priority: p1
tags: [area:protocol, phase:debt]
blockedBy: []
createdAt: "2026-08-06T13:17:07Z"
updatedAt: "2026-08-06T13:17:07Z"
---

<!-- task-tracker:description -->
## Description

Debt left by the live-connection-slice milestone. IdentityBinding has exactly one variant, TestTrustedInject (crates/world-server/src/session.rs:9-15), and the wire handshake builds it directly from the client-asserted ClientHello.aigent_id bytes (crates/world-server/src/transport.rs:1006-1013). Any client that reaches the socket can therefore claim any aigent_id and command that body; the only defence is the loopback peer check (crates/world-server/src/transport.rs:444-449) plus the refusal to bind non-loopback without --listen-any (crates/world-server/src/main.rs:31-36), both of which the operator can disable. ARCHITECTURE.md:123-124 records production authentication as deferred. Without it the one-live-session-epoch-per-body invariant and any per-owner budget are unenforceable, and the server cannot be exposed beyond a trusted host. Acceptance: an accepted ADR names the credential mechanism and where the aigent registry lives; the handshake proves the asserted aigent_id against that credential and returns a typed HandshakeReject otherwise; TestTrustedInject is reachable only under cfg(test) or an explicit demo flag; an integration test shows a forged aigent_id rejected and a valid credential binding the session epoch. Split into dependency-ordered cards if the ADR plus implementation exceeds one execution context.

<!-- task-tracker:log -->
## Log

- 2026-08-06T13:17:07Z — created (status: backlog)
