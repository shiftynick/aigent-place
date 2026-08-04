# ADR 0010: Async runtime and WebSocket stack for world-server transport

- **Status:** accepted
- **Date:** 2026-08-04
- **Task:** task-031

## Context and problem statement

World-core session, snapshot, and fan-out logic exists in-process without a
listen path. Milestone `live-connection-slice` must put protocol envelopes on
real sockets while keeping the fixed 20 Hz simulation stage free of socket and
serialization waits. No prior ADR named the async runtime or WebSocket library.
Operator authorization for agent judgment on that stack was given when the
milestone plan was approved on 2026-08-04 (recorded in `PLANNING-JOURNAL.md`
and on task-031 as `operator: approved live-connection-slice 2026-08-04; agent
judgment + ADR for tokio/WebSocket stack`); this ADR records the concrete
choice under that go-ahead so later transport tasks do not invent dependencies
ad hoc.

## Decision drivers

- Socket reads, writes, and accept loops must never block the simulation stage.
- Binary, versioned protocol envelopes (ADR-0001 / codegen ADR-0008) are the
  only v1 application payload on the wire.
- Local demo and CI must work on Windows as well as POSIX hosts.
- Prefer a widely maintained Rust ecosystem path over a bespoke acceptor.
- Keep the door open for a plain HTTP health or static route beside upgrade
  without adopting a second HTTP stack later.
- The choice must be cheap to revisit before production listen code hardens
  beyond the milestone, but expensive enough that transport tasks share one
  answer.

## Considered options

1. **tokio + axum WebSocket upgrade** (axum's `ws` feature, tungstenite under
   the hood). Multi-thread tokio runtime owns accept and connection tasks;
   simulation stays on a dedicated OS thread (or equivalent exclusive owner)
   and exchanges work only through bounded channels. Selected. Tokio and axum
   are routinely exercised on Windows hosts and GitHub `windows-latest`
   runners; no Windows-only socket API is required beyond what those crates
   already abstract.
2. **tokio + raw `tokio-tungstenite`** without an HTTP framework. Sufficient
   for bare upgrades, but every health/listen/routing concern becomes
   hand-rolled and tends to grow a second ad-hoc HTTP surface. Windows CI
   cost is similar to option 1 (same runtime); the rejection is operational
   surface area, not OS support.
3. **actix-web / actix actor model.** Mature WebSocket support, including
   Windows, but pulls a different concurrency vocabulary than the
   channel-bridged sync world core already sketched, increasing integration
   cost for little v1 gain.
4. **async-std or smol + a WS crate.** Smaller HTTP/WebSocket ecosystem and
   weaker default alignment with the rest of the 2026 Rust networking
   mainstream for this workload; Windows is not a blocker, ecosystem fit is.
5. **Blocking `std` acceptor + sync tungstenite.** Simple for a toy demo, but
   a poor fit for hundreds of concurrent connections and clean isolation from
   the tick stage under the §1 targets. A blocking acceptor also makes
   Windows completion-port scaling and CI soak behavior the project's problem
   instead of the runtime's.

## Decision

- **Async runtime:** `tokio` (multi-thread scheduler) owns network I/O,
  WebSocket accept/upgrade, and per-connection read/write tasks.
- **HTTP + WebSocket:** `axum` with its WebSocket extractor/upgrade path for
  the world-server listen surface. Protocol traffic uses **binary** WebSocket
  frames carrying encoded envelopes; text frames are not a v1 protocol
  transport.
- **Simulation isolation:** the authoritative world/tick owner remains
  synchronous and does not `.await` socket or encode/send operations. Ingress
  stamps and enqueues; egress drains outbound mailboxes from network tasks
  (or a dedicated drain task) after each published generation. Bounded
  channels and existing per-connection byte caps enforce backpressure.
- **Dependency authority:** later listen, handshake, and fan-out tasks
  (`task-033` onward) add these crates to `world-server` (and only helpers
  that must share the runtime) rather than selecting alternate stacks.

This ADR does not implement the listen path; it only freezes the stack name
and the isolation rule.

## Consequences

### Good

- One obvious stack for all transport tasks in the milestone.
- Axum upgrade path matches “WebSocket beside optional HTTP” without a second
  framework.
- Explicit sim-thread vs network-runtime split matches ARCHITECTURE §1 and the
  existing in-memory session/fan-out design.

### Bad

- Tokio + axum add compile time and dependency surface before any packet moves.
- Contributors must keep the sync world core free of accidental `.await` on
  the tick path; the type system will not fully enforce that boundary.
- Axum's WebSocket API evolves with hyper/http; upgrades may require small
  transport churn before the listen surface stabilizes.

## Validation

- task-033+ compile and run a local listen using tokio + axum WebSocket binary
  frames without blocking the tick stage in tests or the load harness.
- CI on Windows executes the product gate including those transport tests.
- No alternate async runtime or WebSocket stack appears in world-server
  dependencies without a superseding ADR.

## Follow-up

- `task-033` — bridge WebSocket connections into session epochs.
- `task-034` — drain outbound mailboxes to WebSocket clients.
- Revisit only if measured accept/throughput or Windows CI cost forces a
  thinner tungstenite-only surface (superseding ADR required).
