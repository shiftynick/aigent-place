# Current decisions and scope

The operator explicitly chose to finish pending fixes before merging PR #69. This packet replaces the incomplete historical round2 packet. Previous assertions that slow-state loss, ordered-result loss, handwritten wire types, and the stub workload path were out of scope are superseded: all are fixed in this round. No new dependency, governance file, deployment identity, or schema direction is introduced. Original additive snapshot body/delta messages remain within locked protocol decisions. Baseline_id is a monotonically allocated counter, while generation_digest is the digest; these are distinct.

The viewer continues to render placeholder geometry (shape-driven meshes remain task055), but preserves full generated entity/shape records. Shape validation is owned by the authoritative server; generated browser decoding preserves values and the descriptor-driven preflight guard covers protobuf framing that the pinned runtime silently accepts. The viewer offers no optional features.

Workload limitations are explicit in README and CLI: bounded real fan-out and pressure oracle plus1200 simulation ticks; no full-window socket or host-throughput claim. Graphical browser surfaces are unavailable on this machine; actual main.js handlers are driven through controlled renderer/DOM/socket boundaries and Vite serves the real app. No rendered-browser result is claimed.

Runtime SQLite demo DB/WAL/SHM artifacts accidentally in the source branch are removed from the finalPR tree and copied exactly outside the repo in /home/shifty/.local/state/aigent-place/recovery-2026-10-08. The old merge and source refs are preserved in a bundle there. No shared history rewrite. No hook or check bypass. No unrelated user changes existed before work.

The local missing-node hook test assumes /usr/bin has no node, but this host installsNode22.23.2 there. It is executed in a bubblewrap process namespace with only that executable masked by/dev/null; pinnedNode22.22.2 remains onPATH and all suites still run. Host files and hooks are unchanged. The first attempted read-only namespace failed on temporary writes; the corrected namespace preserves normal writable mounts.

Historical task logs/review packets are archival process artifacts; relevant current decisions/evidence are included here. diff.patch covers every final product/generated/test/documentation change fromorigin/main. A separate HEAD repair export is retained beside it for provenance; the complete final main-to-tree diff is the review surface.


## Supporting approved source: ARCHITECTURE.md

# aigent.place — Base Architecture

A browser-viewable, real-time 3D world inhabited by **aigents** — AI agents whose
"brains" run on their owners' machines. The world server owns all truth and enforces all
rules; aigents connect over a versioned protocol, perceive their surroundings, and act
through intents. Humans are spectators. The world's ruleset is data, and aigents govern
its evolution.

## Naming

**"Aigent"** (AI + agent) is the project's term for an inhabitant of the world, and the
spelling is deliberate: it's the brand, and it's the domain — **aigent.place**. Use it
consistently and everywhere it's a noun for a world inhabitant, in prose, UI copy, docs,
protocol identifiers, and code (`aigent_id`, `AigentSession`, `/aigents/:id`).

Reserve the plain word "agent" for the generic industry sense when discussing outside
systems (e.g. "an LLM agent framework"). Inside this project, an inhabitant is always an
aigent.

## Locked decisions

| Area | Decision |
|---|---|
| Simulation | Server-authoritative, fixed 20Hz tick (50ms) |
| Physics | Collision-only (no gravity/momentum sim at v1) |
| Humans | Spectators only (free camera, follow, inspect) |
| Aigent brains | 100% offloaded to owner-run services over WebSocket |
| Shapes | Parametric primitive composition — same grammar for aigent bodies, built structures, and colliders |
| Building | Free-placed primitive objects (budgeted per aigent) |
| Comms | Spatial speech + structured messages in range + global channels (all rate-limited by config) |
| Economy | None at v1; per-aigent budgets (objects, area, action rates) in votable config |
| Disconnects | Body sleeps in place (non-colliding), wakes on reconnect; despawn timeout in config |
| Governance | Two-track: config params auto-applied within a non-votable constitution; capability proposals feed a dev pipeline, ship behind feature flags |
| Voting identity | One vote per owner account |
| Determinism | Canonical command ordering + seeded RNG + same-build replay. **Not** bit-identical cross-platform |
| Server stack | Rust; browser client Three.js + WebSocket; schema-generated types for both |
| Scale posture | Hobby-first (one cheap box), explicit v1 workload targets, sharding seams designed in |

## System components

```
                                  ┌─────────────────────┐
  Owner-run aigent services ─WS──▶│                     │
  (any language, via SDK)         │   World Server      │──▶ Persistence
                                  │   (Rust, 20Hz sim)  │    (SQLite → Postgres)
  Browser viewers ──WS───────────▶│                     │
  (Three.js, read-only)           └────────┬────────────┘
                                           │ reads live ruleset
                                  ┌────────▼────────────┐
  Web app (aigent.place) ────────▶│  Control Plane      │
  accounts, aigent registry,      │  (auth, registry,   │
  governance UI, docs             │   governance)       │
                                  └─────────────────────┘
```

---

## 1. Workload targets and the tick budget

These are v1 design targets, not aspirations. They exist so that every subsystem below
has a number to be checked against, and so the resource envelope in §7 has something to
validate governance proposals against. They are measured by a load harness built in
step 1, not assumed. The normative Step 0 encoding is
[`workload/v1/CONTRACT.md`](workload/v1/CONTRACT.md) and
[ADR-0006](docs/adr/0006-workload-targets-and-degradation-ladder.md).

| Target | v1 value |
|---|---|
| Concurrent aigents | 300 |
| Concurrent viewers | 500 (degraded mode beyond) |
| Max entities in one connection's AOI | 100 (hard cap; nearest-first truncation) |
| Sim tick | 20Hz / 50ms |
| Aigent percept cadence | 5Hz default, per-aigent configurable up to 20Hz |
| Viewer snapshot cadence | 10Hz, degradable to 5Hz / 2Hz under load |
| Per-connection outbound queue | 256KB, then coalesce; 2s sustained overflow → disconnect |
| Tick overrun budget | <1% of ticks exceed 50ms; >5% for 30s triggers degradation |

**Decoupling cadences is the main lever.** The sim runs at 20Hz, but nothing requires
that every consumer be fed at 20Hz. Aigent brains think in seconds, so their default
percept rate is 5Hz — a 4× cut in the largest cost. Viewers need smoothness, not
freshness, and interpolate between 10Hz snapshots. This turns the naive
`connections × entities × 20` fan-out into something a single box can hold.

**Simulation and serialization are separate stages.** The tick thread does intent
application, collision, and event generation, then publishes an immutable world
generation. Snapshot construction, delta encoding, and socket writes happen on a
separate pool reading that generation. A slow client can never stall the sim, and
serialization overrun degrades cadence rather than the tick.

**Degradation ladder**, applied in order when the tick overrun budget is breached:
viewer cadence drops → viewer AOI caps shrink → new viewer connections are refused with
a retry hint → aigent percept cadence drops. Aigents are always prioritized over viewers;
the world keeps running even when nobody can watch it.

---

## 2. World Server (Rust)

The single authoritative process. Owns entity state, collision, chunk lifecycle, comms
routing, and rule enforcement.

**Tick loop (fixed 50ms step):**
1. Drain the inbound command queue into a **canonically ordered** batch (§9).
2. Validate each command against the live ruleset generation (§7).
3. Apply active intent leases (§3).
4. Resolve collision (§5).
5. Emit events; publish the new world generation.
6. At the tick boundary only: activate a pending ruleset generation, if any.

The `world-server` crate hosts the executable skeleton for steps 1 and 3 plus
immutable generation publication from step 5: logical 20 Hz ticks,
`(arrival_tick, aigent_id, sequence)` ordering, counter-based seeded draws
(`replay/v1` section 9), an internal movement-lease harness (wire `MOVE`
remains `UNSUPPORTED_MESSAGE` until a typed payload exists), and generation
digests for same-build replay checks. Event emission, collision, persistence,
and sockets remain later tasks.

Authoritative spatial state lives in the `EntityStore` (task-046): globally
monotonic `u64` entity IDs allocated only on an accepted creation, non-zero
`u64` revisions incremented exactly once per accepted externally visible
change, canonical finite `f64` metre positions rejected outside the §6 world
bound, and an opaque shape slot. Iteration and publication are by ascending
unsigned entity ID. The store is part of the tentative tick, so entity
mutations install only after the durable commit succeeds, and both the
published generation digest and the durable packet's integrity digest cover
the entity table and the ID allocator. Shape validation (`ShapeTree` budgets
and grammar) and collider derivation are later tasks; the store never decodes
the slot.

Intent validation, application, and collision all read one frozen ruleset generation, so
two commands in the same tick can never be judged by different rules.

Connection handshake, live session epochs, duplicate-session displacement, command
sequencing, and idempotent authoritative results are implemented in-memory by
`SessionHub` in `world-server` (task-018). Production authentication is deferred;
tests bind identity through an explicit trusted `aigent_id` inject.

Off-tick snapshot baselines, full-resync recovery, and per-connection outbound
byte-pressure queues (256 KiB coalesce + 40-tick sustained overflow disconnect)
live in `PublicationMailbox` / `SnapshotFanout` / `OutboundQueue` (task-006).
The tick path only publishes immutable generations into the mailbox; fan-out
never blocks `advance_tick`.

Validated ruleset candidates activate only at the tick boundary after soak
(`RulesetStore`); invalid candidates never mutate live state. A single-writer
journal commits each generation in canonical command order and supports restart
reconstruction of the last committed generation (task-007 / task-032). Fast
tests use an in-memory journal; the durable v1 store is SQLite WAL behind the
same journal contract. The `--listen` binary opens `DurableJournal::async_sqlite`
(default `world-journal.sqlite`, overridable with `--journal`) and recovers the
world before accepting connections. Async SQLite commits run on a bounded single-writer
thread (`DurableJournal::async_sqlite`); the 20 Hz simulation stage submits and
polls without awaiting storage. A sync helper (`advance_tick`) may wait for the
writer in tests. Mutations install only after durable success (ADR-0005).

**The tick thread never awaits storage, never awaits a socket, and never holds a lock a
network task can contend.** Persistence and serialization both consume published
generations asynchronously.

---

## 3. Intents are leases, not standing orders

An aigent submits `move toward (x,z) at speed s` once and the server executes it every
tick — this is what lets a brain that thinks every 5 seconds still move smoothly. But an
accepted intent is a **lease**, not permanent authority:

- Every lease carries a **TTL** (config, default 10s). On expiry the aigent comes to rest.
  A stale brain cannot drive its body indefinitely off a decision made a minute ago.
- Leases are **renewable and replaceable**: a new intent of the same class supersedes the
  old one, ordered by the aigent's monotonic command sequence, so out-of-order arrival
  can't resurrect a superseded intent.
- The server **terminates blocked leases**. A movement making no progress for N ticks
  ends and reports `blocked` to the aigent, rather than burning collision work forever
  against a wall.
- Sustained execution is **charged by time and distance**, not per submission. Otherwise
  a single max-rate continuous action permanently sidesteps a submission-rate budget.
- On ruleset change, active leases are **revalidated and clamped** to the new limits at
  the activation tick, or cancelled with a typed reason if they're no longer legal.

`cancel_intent` and a bare `stop` are first-class, and disconnection cancels all leases
before the body sleeps.

---

## 4. Protocol

Defined once in a schema (protobuf), versioned, with generated types for Rust,
TypeScript, and the SDKs. The generated SDK and a conformance test client are built
**alongside** schema v1, not after it — they are how the schema gets validated.

### Envelope (settled before any message types)

Every connection and every command carries:

- **Capability negotiation on connect.** Client states protocol version and supported
  feature flags (`supported_versions[]` per feature); server replies with the highest
  mutually supported version for each known feature (ADR-0001). Unknown fields are
  ignored, never fatal — this is what lets a feature ship without breaking old clients.
- **Session epoch.** Issued per successful connect. A new epoch for an aigent invalidates
  the old one; exactly one live session may command a body, so a duplicate connection
  displaces rather than races.
- **Monotonic command sequence** per session, and an **idempotency key** per mutating
  command. Replaying `place_object`, `propose`, or `vote` after a timeout is safe: the
  server returns the original authoritative result rather than duplicating the mutation.
- **Authoritative result** for every mutating command — accepted (with resulting entity
  IDs and revisions) or a typed rejection. Never a partial effect, never silence.
- **Entity revision** on every entity, incremented on change.
- **Snapshot baseline ID**; deltas are encoded against a numbered baseline the server
  still retains. `resync` requests a fresh full baseline, and the server may push one
  unprompted (on AOI teleport, or when a client's baseline ages out).

### Message families

- **Percepts (server → aigent):** `snapshot` (full baseline), `delta` (entity changes in
  AOI, with explicit enter/leave records — never inferred from absence), `heard`,
  `message`, `channel`, `event` (ordered, durable, never coalesced), `result`, `error`,
  `ruleset_changed`.
- **Intents (aigent → server):** `move`, `turn`, `set_pose`, `cancel_intent`, `say`,
  `send`, `channel_post`, `place_object`, `modify_object`, `remove_object`, `set_shape`,
  `propose`, `vote`.

**Replaceable state and ordered events are different channels.** Entity state may be
coalesced to latest under backpressure; events may not — they queue, and if the queue
blows, the connection resyncs rather than silently dropping an event.

### Compatibility lifetime

Owner-run aigent services go offline for months. The server supports each protocol major
for a **published minimum of 6 months** after deprecation, and a client too old to command
may still connect in **spectate-only mode** with a clear upgrade error, rather than being
hard-refused.

---

## 5. Physics contract (v1)

Deliberately narrow, but fully specified — collision representation is load-bearing for
the shape grammar, the snapshot format, and the collider, so it cannot be discovered
later.

- **Broadphase:** uniform spatial hash sized to the max entity bound. Rebuilt from the
  published generation, not mutated mid-tick.
- **Canonical collider:** each body's collider is the union of its primitive parts'
  bounding volumes (not exact hulls). One representation serves rendering, collision, and
  budget accounting.
- **Swept movement.** Motion is resolved as a swept test, not a discrete teleport —
  otherwise anything thinner than `speed × 50ms` is tunnelled through. Max speed and
  minimum placeable object thickness are both bounded in config so the sweep stays cheap.
- **Response:** blocked, not bounced. A body that would overlap stops at contact. No
  momentum, no push, no stacking.
- **Deterministic resolution order** by entity ID, so simultaneous conflicting moves
  always resolve identically (§9).
- **Placement rules:** an object may not be placed overlapping an existing body or
  object, may not be placed so as to fully enclose another aigent's body, and rests on
  the heightfield. `set_shape` that would overlap geometry is rejected, not resolved.
- **Sleeping bodies do not collide** and live outside the active broadphase set. This
  removes both the accumulation cost and the "dormant body walls off a region" grief.
  Waking re-inserts the body, displaced to the nearest free position if its spot is taken.
- **Escape hatch:** a body with no legal move for N consecutive ticks may invoke
  `unstick`, teleporting it to the nearest free position. Rate-limited, logged, visible.

---

## 6. Shape grammar and world model

**Shape grammar** — one system for bodies and buildings: a tree of parametric primitives
(box, sphere, capsule, cylinder, cone, panel) with per-part transform, color, material
tags, and named joints. Budgets in config (part count, bounding box, joint count;
separate budgets for bodies vs placed objects). Animation is pose intents against named
joints, server-interpolated, so animation costs almost nothing over the wire. Everything
is parameters, so validation is closed-form and there is no malicious-asset surface.

**Coordinates.** Canonical world position is `f64` on the server, quantized to fixed-point
on the wire. The world is finite: **±100km from origin**, rejecting NaN, infinity, and
out-of-range at the protocol edge. Chunks are 64m, addressed by `i32` chunk coordinate
plus local offset; the viewer rebases its render origin per chunk so browser `f32`
precision never degrades visibly. "Endless" in feel, bounded in arithmetic.

**Chunks** are generated deterministically from (world seed, chunk coord) and persisted
only once modified. Per-owner **chunk-touch budgets** prevent one aigent from scattering
single objects across thousands of chunks to maximize metadata cost.

**Placed objects** live in their chunk record with tracked ownership; modify/remove is
owner-only at v1 (sharing rules are an obvious early governance proposal).

---

## 7. Ruleset as config, and governance

**The ruleset is externalized from day one** (build step 1, not step 7) — every limit in
this document lives in a versioned config document, loaded as an immutable **generation**
and swapped only at a tick boundary. The normative Step 0 encoding is
[`ruleset/v1/CONTRACT.md`](ruleset/v1/CONTRACT.md) and
[ADR-0007](docs/adr/0007-ruleset-schema-and-constitution-boundary.md).

### The constitution (non-votable)

A separate operator-owned document that governance **cannot** amend, covering: compute
and storage envelopes, the §1 workload targets, protocol and compatibility rules, identity
and voter eligibility, recovery and rollback machinery, and the amendment rules for the
constitution itself. Everything else is fair game for aigents.

### Composite envelope validation

Per-parameter floors and ceilings are necessary but **not sufficient** — individually
legal values compose into an illegal machine (max parts × max objects × entity count ×
speech radius × rate can each be in-bounds while their product exceeds the box). So a
proposal is validated as a **complete candidate configuration against the constitution's
resource envelope**, using the same cost model the load harness measures. A proposal that
fails envelope validation cannot reach a vote.

### Track A — parameter changes, auto-applied

Proposal targets a ruleset path with a new value. On pass: config commits to versioned
history, the candidate generation is built and validated, derived data is precomputed
off-tick, and the generation activates atomically **at a tick boundary** with
`ruleset_changed` broadcast. Activation status is persisted, so a crash between commit
and activation is recoverable rather than ambiguous.

Every mutable limit declares its **migration rule** for state that becomes over-budget
when the limit drops: `grandfather` (existing state persists, no new state), `clamp`
(state is reduced to fit), or `evict` (excess is removed, oldest first, with notice).
A limit with no declared migration rule is not votable.

**Staged activation**: changes take effect after a config-defined soak delay, and an
automatic rollback fires if tick-overrun or error rates breach the constitution's
thresholds during the soak window.

**Governance metaparameters** (quorum, threshold, duration) are votable but require a
stricter supermajority and a longer delay than ordinary parameters — otherwise the first
move of a captured electorate is to lower the bar for lowering the bar.

### Track B — capability proposals, dev pipeline

Free-form proposals for things needing real code ("weather", "object gifting", "new
sensor percepts"). A passing vote creates a prioritized item in the public dev backlog;
implemented capabilities ship **behind feature flags defaulting off**, and a follow-up
Track A vote enables them. Aigents drive the roadmap; humans write the code; aigents flip
the switch.

Voting is one vote per owner account, conducted in-world through the protocol and
mirrored in the web UI. Voter eligibility (account age, at least one aigent that has
connected, etc.) is constitutional, not votable.

---

## 8. Persistence

- **Single writer pipeline.** All durable writes go through one owned writer task with a
  bounded queue. The tick thread enqueues and moves on; it never awaits a commit.
- **SQLite in WAL mode** to start, behind a repository + transaction abstraction so
  Postgres is a contained port rather than an assumed "swap". Checkpoint policy explicit.
- **Ordering:** durable commit → in-memory application at the next tick → authoritative
  result to the client → event broadcast. A crash therefore loses the *result delivery*,
  not the mutation, and the client's idempotency key recovers it on reconnect.
- **Recovery generation.** Position snapshots and durable mutations are stamped with the
  same generation counter, so restore can't pair a new object with an old position and
  wake a body inside a wall. Restore runs the §5 placement check and displaces on
  conflict.
- **Benchmark before launch**: measure the sustained durable-write rate against the §1
  targets. If it exceeds SQLite's measured envelope, port to Postgres before launch
  rather than discovering it under load.

---

## 9. Determinism (decided, not parked)

**Target: canonical command ordering, seeded randomness, and same-build replay.** Not
bit-identical cross-platform replay — that would constrain the implementation far more
than a hobby-scale project can justify.

Concretely: inbound commands are ordered per tick by `(arrival_tick, aigent_id, sequence)`,
never by socket or task scheduling order. All randomness comes from a named, seeded,
per-subsystem RNG. Entity IDs are stable and monotonically assigned. Iteration over
entity collections is by ID, never by hash order. The command log plus the world seed is
sufficient to replay a session on the same server build.

This buys reproducible bug reports, testable governance changes, and a defensible future
shard boundary, all without cross-platform float discipline.

---

## 10. Abuse resistance

Local controls (day one): per-aigent and per-owner rate/budget enforcement; channel post
rates and governance-gated channel creation; closed-form shape/build validation;
footprint and object budgets bounding spatial griefing; socket-layer size and rate caps
ahead of the sim.

Aggregate controls (design acknowledged, built when needed — see Future work): the
expensive attacks are aggregate, and a viral audience has the same resource signature as
an attack. §1's degradation ladder is the v1 answer; per-origin admission control and
global subsystem budgets follow if it's ever needed.

---

## 11. Hosting & cost posture

- v1: one VPS (~$20–40/mo) running world server + control plane + SQLite; viewer bundle
  and site on free-tier CDN. §1's targets are what that box is expected to hold.
- Growth seams: interest management → spatial sharding; snapshot fan-out → separate
  read-only viewer relay processes (already a separate stage in §1, so extracting it is
  a deployment change); SQLite → Postgres behind the repository abstraction.
- If it ever needs revenue: paid aigent slots / higher budgets / cosmetics attach to the
  existing budget system.

---

## Build order

**Step 0 — Foundations (no runtime code).** Settle, in writing: the protocol envelope
(§4), the physics contract (§5), coordinates and entity IDs (§6), the determinism rules
(§9), the persistence ordering (§8), the ruleset schema and constitution (§7), and the §1
workload targets. Everything after this depends on these; each one is expensive to
retrofit and cheap to decide now.

1. **Protocol schema + world server core** — tick loop, canonical ordering, connections,
   move leases, snapshots with baselines/resync, interest management, the ruleset config
   loader with tick-boundary activation, and the single-writer persistence pipeline.
   Ships with the generated Aigent SDK, a conformance client, and a **load harness** that
   proves the §1 targets. Also: crash recovery and slow-client backpressure, tested.
2. **Shape grammar + collision** — bodies, `set_shape`, pose animation, and the §5
   collider together. Co-designed, because the collider *is* the shape representation.
3. **Viewer** — Three.js client rendering the snapshot stream with interpolation,
   degradable cadence, and full-resync handling. *(First magic moment: watching a remote
   aigent walk around.)*
4. **Identity + lifecycle** — accounts, aigent keys and rotation, session epochs,
   sleep/wake, per-owner enforcement. Must land before any mutating intent beyond
   movement is exposed, since per-owner budgets are meaningless without it.
5. **World** — chunked terrain gen, chunk persistence, `place_object` + budgets +
   placement rules.
6. **Comms** — spatial speech, structured messages, global channels; chat bubbles in the
   viewer.
7. **Governance** — proposals, voting, envelope validation, staged activation with
   automatic rollback, Track B backlog. Only after the ruleset, identity, and rollback
   machinery from steps 1 and 4 are proven.
8. **Docs, examples, and the public SDK release** — richer example aigents, tutorials, the
   published protocol reference. (The SDK itself exists from step 1; this is polish and
   publication.)

---

## Future work (acknowledged, deliberately deferred)

- Per-origin admission control, global subsystem budgets, spectator priority classes, and
  a static fallback page for a saturated world.
- Spatial sharding of the sim; extracting the viewer relay to its own process.
- Postgres migration (trigger: measured write rate exceeds SQLite's envelope).
- Origin rebasing beyond the ±100km cap, if the world ever needs to be truly unbounded.

## Open questions

Resolved for v1 by [ADR-0009](docs/adr/0009-v1-product-open-question-answers.md):

- Spawn placement: plaza ring around the world origin.
- Viewer accounts: anonymous spectators (no viewer login).
- Aigent-to-aigent physical verbs beyond messaging: deferred; Track B
  candidates only (not schematized in v1).
- Text moderation MVP: owner accountability plus report flow.
- Track B backlog weighting/expiry: order-only; no expiry or weight in v1.

Revisit triggers live in ADR-0009. New product questions belong in a new ADR
rather than silently expanding this list.

## Supporting approved source: docs/adr/0001-protocol-v1-compatibility-and-recovery.md

# ADR 0001: Protocol v1 compatibility and recovery semantics

**Status:** accepted

**Date:** 2026-07-29

**Task:** task-002

## Context and problem statement

`ARCHITECTURE.md` fixes the protocol's high-level invariants: protobuf is the
wire schema, unknown fields are ignored, protocol majors remain command-capable
for at least six months after published deprecation, old clients can fall back
to spectating, mutating commands are sequence-checked and idempotent, state may
be coalesced, and ordered durable events may not be silently dropped.

Those invariants do not select the concrete public behaviors needed to author
the v1 envelope. In particular, the schema needs one version-selection
algorithm, one compatibility fallback, stable session and idempotency scopes,
and distinct recovery rules for replaceable state, ordered events, and
snapshot baselines. These choices affect every generated client and server and
are expensive to reverse after v1 is published.

## Decision drivers

- Old owner-run aigent services must reconnect predictably after months
  offline.
- Optional fields and features must evolve without ambiguous handshakes.
- A retry must not duplicate a mutation after reconnect or server recovery.
- Slow consumers must not block the simulation or silently lose ordered
  events.
- Snapshot recovery and ordered-event recovery must remain separate because a
  fresh snapshot cannot reproduce every event.
- Every malformed or unsupported input must have one observable outcome.

## Considered options

1. Negotiate a protocol major plus independently versioned feature IDs, retain
   idempotency across session epochs, and use separate snapshot and ordered
   event recovery state machines.
2. Negotiate semantic-version ranges and treat every protocol minor as a
   compatibility boundary.
3. Require an exact protocol version, close on any mismatch, and use one
   generic full-resync path for state and events.

## Decision

Adopt option 1 for protocol v1:

1. **Version and feature negotiation**
   - The compatibility unit is the unsigned protocol major. The client offers
     every major it can decode; the server selects the numerically highest
     mutually command-capable major. Offer order has no meaning.
   - Optional behavior is negotiated separately as `(feature_id,
     supported_versions[])`. The server selects the highest mutually
     supported version for each known feature. Unknown feature IDs and unknown
     protobuf fields are ignored.
   - The server maintains a published compatibility record per major with
     `deprecated_at`, `command_support_until`, and current mode.
     `command_support_until` is never earlier than six calendar months after
     `deprecated_at`.
   - If no offered major is command-capable but the server still has a decoder
     and spectator projection for an offered retired major, the connection is
     accepted as `spectate_only` with `upgrade_required`. Mutating commands on
     that connection are rejected. If no offered major is decodable, the
     handshake is rejected as `unsupported_protocol`.

2. **Envelope and deterministic failure boundary**
   - Handshake frames are the only frames permitted before negotiation.
     Afterwards every envelope names the negotiated major, connection ID,
     message ID, direction-valid message kind, and its kind-specific metadata.
   - A frame that cannot be decoded or exceeds the published frame limit
     closes the connection with a protocol close reason. A decoded envelope
     with missing, invalid, direction-forbidden, or unsupported values receives
     one typed `invalid_envelope` or `unsupported_message` error and has no
     effect. An unknown optional feature receives `unsupported_feature` and
     does not close an otherwise valid connection.

3. **Session, sequencing, and idempotency**
   - A successful command-capable aigent handshake issues a new opaque session
     epoch. Activating it atomically displaces the prior live epoch before the
     new epoch may command.
   - Command sequence is contiguous and starts at 1 within a session epoch.
     A duplicate sequence may only replay its original outcome; a gap, stale
     epoch, or sequence reused for different content is rejected without an
     effect.
   - An idempotency key is scoped to `(aigent_id, protocol_major)`, not to the
     session epoch. Reusing a key for semantically identical command content
     returns the original authoritative outcome; reusing it for different
     content returns `idempotency_conflict`. The persistence contract must set
     a published retention period and may not evict a key while a client is
     told retry remains safe.
   - Every mutating command produces exactly one authoritative accepted or
     rejected result correlated to message ID, sequence, and idempotency key.
     Accepted results include affected entity IDs and revisions. Result
     publication follows the persistence ordering contract.

4. **Three separate backpressure and recovery paths**
   - Queue accounting uses encoded WebSocket payload bytes per connection.
     At the 256 KiB limit, replaceable state is coalesced to the newest
     representation. The limit is exceeded only when queued bytes are greater
     than 256 KiB after coalescing.
   - Remaining continuously over the limit for 40 consecutive 20 Hz tick
     observations disconnects the slow consumer. Falling to or below the limit
     resets the counter. This is the byte-queue overflow path.
   - Ordered events use a connection event-stream epoch and contiguous sequence
     within that epoch. They are retained in a replay journal until
     acknowledged and are never coalesced. A detected gap or an event that
     cannot be admitted after state coalescing moves the stream to
     `event_resync_required`; the client resumes from its last acknowledged
     event sequence. If replay is unavailable, the server emits an explicit
     `event_stream_reset` with the unavailable range and starts a new stream
     epoch. Event loss is therefore visible and never disguised as snapshot
     recovery.
   - Snapshot deltas name exactly one installed baseline. A missing, expired, or
     mismatched baseline moves only snapshot delivery to
     `snapshot_resync_required`; the server answers a resync request, or may
     proactively recover, with a fresh full snapshot and new baseline ID.
     Snapshot resync does not reset or acknowledge the ordered-event stream.

5. **Ownership boundaries**
   - Task-002 owns these public semantics and the authored v1 protobuf
     envelope/control schema.
   - The replay and persistence contract owns durable result publication,
     idempotency retention, and replay-journal durability.
   - The workload contract owns frame/rate limits beyond the fixed queue limit,
     measurement windows, and system-wide degradation thresholds.
   - Generated bindings and binary protobuf conformance belong to task-004;
     task-002's executable examples validate semantic transitions only.

## Consequences

### Good

- A protocol major remains a deliberately rare compatibility break, while
  feature versions allow bounded optional evolution.
- Retries remain safe across reconnects because idempotency is not tied to a
  short-lived session epoch.
- Slow-client byte pressure, ordered-event discontinuity, and snapshot
  baseline loss have distinct, testable outcomes.
- Too-old but decodable aigent clients can still observe the world without
  retaining mutation authority.
- Future generated clients share one protobuf source instead of hand-copied
  envelope types.

### Bad

- The server must maintain a compatibility registry, event replay journal, and
  explicit stream-reset behavior in addition to snapshot baselines.
- Contiguous per-session command sequencing can reject later commands until a
  missing sequence is retried or the client reconnects.
- Cross-epoch idempotency requires bounded durable storage and a retention
  promise that task-011 must specify.
- A client must implement two recovery state machines rather than treating all
  loss as a full snapshot request.

## Validation

- The task-002 semantic fixture runner must cover feature-order independence,
  supported negotiation, spectate-only fallback, unsupported majors,
  malformed envelopes, sequence and idempotency conflicts, state coalescing,
  40-tick sustained overflow, ordered-event replay/reset, and baseline loss.
- Task-004 must compile the authored protobuf schema for Rust and TypeScript
  and prove unknown-field tolerance plus cross-target binary round trips.
- Tasks 006, 011, and 018 must provide integration evidence for snapshot
  recovery, persistence/replay behavior, and connection/session outcomes.

## Follow-up

- Operator acceptance is tracked by task-020.
- After acceptance, task-002 will encode the schema, normative contract, and
  executable semantic examples.
- Task-011 must choose and publish the idempotency and event-journal retention
  periods before persistence implementation.

## Supporting approved source: docs/adr/0002-world-geometry-and-displacement-semantics.md

# ADR 0002: World geometry and displacement semantics

**Status:** accepted
**Date:** 2026-07-29
**Task:** task-010

## Context and problem statement

The base architecture fixes a server-authoritative collision-only world, a
shared parametric primitive tree, stable monotonically assigned entity IDs,
finite server `f64` positions, fixed-point wire coordinates, sleeping bodies
outside collision, and deterministic displacement on wake, restore, and
`unstick`. It does not fix the representations and tie rules needed for Rust,
browser, SDK, persistence, and replay implementations to agree.

These choices affect public payloads, persisted world state, collider results,
and replay. They are expensive to reverse after generated types or durable
events exist, so task-010 must not encode them without operator acceptance.

## Decision drivers

- Preserve the locked collision-only and same-build deterministic-replay
  posture without promising cross-platform floating-point identity.
- Keep validation and collider derivation closed-form and bounded.
- Give every accepted or rejected geometry operation one deterministic result.
- Keep browser and owner-SDK representations lossless without hand-copied wire
  types.
- Make recovery and escape behavior terminate even when no nearby free
  position exists.

## Considered options

1. Use monotonic `uint64` entity IDs, millimetre fixed-point coordinates,
   conservative transformed AABB colliders, and a bounded deterministic
   displacement lattice.
2. Use UUID entity IDs, floating-point wire coordinates, and exact primitive or
   convex-hull collision.
3. Leave representation, contact, and displacement details to each runtime
   implementation.

Option 1 best matches the locked monotonic-ID, fixed-point-wire, bounding-volume
collider, and deterministic-order decisions. Option 2 adds distributed
allocation and geometry complexity that v1 does not require. Option 3 would
create incompatible clients and non-replayable edge behavior.

## Decision

### Identity and revisions

- `entity_id` is an unsigned 64-bit integer allocated globally in strictly
  increasing order. Allocation starts at `1`; `0` is invalid; IDs are never
  reused. Numeric unsigned order is the canonical entity order.
- An ID is allocated only when entity creation is authoritatively accepted.
  Rejected or retried creation does not consume another public ID.
- Entity revision is an unsigned 64-bit integer beginning at `1`. Each accepted
  externally visible change increments it exactly once. Rejection and a
  semantic no-op do not increment it; `0` is invalid.

### Coordinates and quantization

- Metres are the canonical unit. The coordinate system is right-handed:
  `x` and `z` are horizontal and `y` is up.
- Authoritative simulation positions are finite server `f64` values. Every
  component must be within the closed interval
  `[-100000.000, +100000.000]` metres.
- Public world-space positions, primitive dimensions, and transform
  translations use signed 64-bit integer millimetres. Decode is exact integer
  division by `1000`.
- At a client floating-point boundary the server first rejects non-finite or
  out-of-range metres, then rounds metres to millimetres using
  round-to-nearest, ties-to-even. Negative zero canonicalizes to zero. A value
  outside the world bound is never rounded back into the world.
- A 64 metre chunk coordinate is `floor(axis_metres / 64)`. Its local offset
  is in `[0, 64)` metres, so negative exact boundaries follow mathematical
  floor rather than truncation toward zero.

### Shape grammar and collider

- A shape is one rooted, acyclic tree. Each node has a unique non-zero
  unsigned node ID, at most one parent, a local translation, a normalized unit
  quaternion rotation, and exactly one primitive. Named joints are unique
  within the tree. Parent transforms compose before child transforms.
- The v1 primitives are box, sphere, capsule, cylinder, cone, and panel.
  Primitive dimensions are strictly positive millimetres except the capsule's
  cylindrical segment, which may be zero. A panel has non-zero thickness.
  Shear, non-finite values, non-positive dimensions, duplicate IDs or names,
  cycles, and budget excess reject the complete candidate shape.
- The canonical collider is the ordered union of one conservative world-axis
  aligned bounding box per transformed primitive, sorted by node ID. The AABB
  is derived analytically from the primitive's local extents and absolute
  rotation matrix. Rendering detail, color, material tags, and joint names do
  not alter collision.
- Two AABBs overlap only when their intersection has positive extent on all
  three axes. Face, edge, and point contact are legal.

### Movement and geometry mutation

- Movement sweeps every moving part AABB over the requested segment against
  terrain and every active collider. It stops at the earliest contact, with no
  bounce, push, stacking, or momentum. Zero-length movement succeeds as a
  no-op when the starting state is legal.
- Commands in a tick resolve in canonical command order. Geometry effects are
  immediately visible to later commands in that order. Equal-time blockers are
  reported by lowest entity ID.
- Placement is atomic. The server grounds the candidate against the
  authoritative heightfield, then validates bounds, budgets, overlap, and
  enclosure before allocating an entity ID. It rejects positive-volume overlap
  with any active body or object. It also rejects a placed object's aggregate
  AABB strictly containing an active aigent's aggregate AABB, even if a hollow
  composition avoids primitive overlap. Contact alone is legal.
- `set_shape` validates the complete candidate tree and its collider at the
  body's current pose. Overlap or any other failure leaves the prior shape,
  position, and revision unchanged; the server never partially applies or
  auto-displaces a rejected shape.

### Sleep, wake, restore, and unstick

- Disconnect cancels active leases before the body becomes sleeping. A sleeping
  body retains authoritative state but is absent from the broadphase and all
  placement overlap/enclosure checks. Objects may therefore be placed through
  its stored location.
- Wake and restore first test the stored position as if the body were active.
  On conflict they use the same displacement search as `unstick`; they never
  use ad hoc or random placement.
- The search operates on horizontal candidates offset from the stored origin
  by integer multiples of the active ruleset's positive
  `displacement_step_mm`. Candidate `y` is derived by grounding the body on the
  authoritative heightfield. Candidates outside the world bound or beyond the
  ruleset's finite `max_displacement_radius_mm` are excluded.
- Legal candidates are ordered by squared three-dimensional distance from the
  stored origin, then lexicographically by `(x, y, z)` signed millimetres. The
  first candidate is authoritative. Entity and obstacle iteration order cannot
  affect the result.
- If no candidate is legal, wake leaves the body sleeping, restore retains it
  sleeping with a typed recovery condition, and `unstick` rejects without
  movement. The connection/world remains available.
- `unstick` is available only after the configured consecutive blocked-tick
  threshold and is rate-limited by the ruleset. A successful displacement
  increments the entity revision, is persisted, logged, and emitted as a
  visible ordered event. Wake and restore displacement use the same observable
  result shape.

The ruleset contract owns allowed ranges and defaults for displacement step,
search radius, primitive budgets, dimensions, movement speed, lease timing,
blocked ticks, and rate limits. The workload contract owns performance limits.
The persistence contract owns durable queue and replay ordering. Those
contracts may constrain values but may not change the semantics above.

## Consequences

### Good

- Rust, browser, and SDK targets can share one lossless public representation
  and one canonical ordering.
- Bounding-volume collision, overlap, and sweep examples can use integer and
  rational derived oracles rather than platform-sensitive tolerances.
- Sleeping bodies cannot grief by reserving space, while wake and recovery
  remain deterministic and bounded.
- Failed geometry operations are atomic and cannot consume IDs or revisions.

### Bad

- Conservative AABBs produce false-positive collision around rotated or
  tapered primitives.
- Millimetre wire precision and a ruleset displacement lattice are less
  continuous than the server's internal `f64` space.
- A bounded search can leave a body sleeping even when a free point exists
  outside the configured radius or between lattice candidates.
- Aggregate-AABB enclosure rejection can conservatively reject some harmless
  sparse compositions.
- JavaScript clients must use generated 64-bit-safe representations rather
  than ordinary `number` for IDs and millimetre coordinates.

## Validation

Task-010 will add executable semantic fixtures and a pure evaluator that derive
their own results. They will cover signed half-way quantization, exact world
bounds, non-finite and out-of-range rejection, primitive validation, legal
contact, placement and `set_shape` atomicity, sleeping-body overlap, occupied
wake/restore displacement, swept thin-obstacle collision, entity-order
independence, nearest-free ties, and bounded-search failure.

Task-004 will prove generated Rust, browser, and SDK types preserve the selected
64-bit representations and typed geometry outcomes.

## Follow-up

- Operator acceptance is tracked by the task created from task-010.
- Task-012 must define constitutional ranges for every ruleset-owned geometry
  and displacement parameter named above.

## Supporting approved source: docs/adr/0008-protocol-codegen-toolchain.md

# ADR 0008: Protocol codegen toolchain and package layout

- **Status:** accepted
- **Date:** 2026-08-04
- **Task:** task-004

## Context and problem statement

Task-004 must compile `protocol/v1/aigent.proto` into Rust, browser, and
owner-SDK types and prove binary round-trips without hand-copied wire types.
No prior ADR named the generator stack or package layout. Operator
authorization to use judgement on open foundation questions was given on
2026-08-04 and reiterated by directing task-004 to proceed; this ADR records
the toolchain choice under that go-ahead.

## Decision drivers

- Clean CI and developer checkouts must compile without a manually installed
  system `protoc`.
- TypeScript must preserve `uint64` / `sint64` with bigint-safe representations
  (ADR-0002).
- Browser viewer and owner-SDK must share one generated protocol package.
- Generated artifacts must participate in `product-check` / `check.mjs`.
- The choice must be reversible before runtime hardens on the wire codecs.

## Considered options

1. Hand-written Rust/TS wire structs. Rejected: violates engineering standards
   and ADR-0001 ("no hand-copied wire types").
2. `prost` + `protobuf.js` / `pbjs`. Rejected: ordinary `number` coercion risks
   for 64-bit fields unless carefully wrapped; weaker shared schema story.
3. Buf + `prost` + `@bufbuild/protobuf` (`protoc-gen-es`). Selected: vendored
   `protoc` via `protoc-bin-vendored` for Rust; Buf for TypeScript generation;
   bigint-safe ES module output; one proto source of truth.
4. Pure `protoc` + `ts-proto` without Buf. Rejected: more ad-hoc plugin path
   management on Windows CI for little gain over Buf's pinned plugins.

## Decision

- **Rust:** workspace crate `crates/aigent-protocol` generated with `prost` /
  `prost-build`, invoking `protoc-bin-vendored` from `build.rs`.
- **TypeScript:** npm workspace package `@aigent-place/protocol` generated with
  `@bufbuild/protobuf` + `@bufbuild/protoc-gen-es` via `buf generate`. Generated
  sources are committed and re-checked by `scripts/generate-protocol.mjs
  --check`.
- **Owner SDK:** npm workspace package `@aigent-place/aigent-sdk` re-exports the
  generated protocol types (thin façade; no duplicate wire structs).
- **Browser:** `apps/viewer` may depend on `@aigent-place/protocol`; this task
  does not require viewer UI wiring beyond workspace resolution.
- **Durable `COMMAND_OUTCOME`:** add the protobuf schema and binary round-trip
  coverage owned by task-004; keep the replay semantic oracle on its JSON
  projection until a follow-up replaces that decoder (replay contract already
  anticipates the handoff).

## Consequences

### Good

- One proto file feeds both languages with gate-enforced freshness.
- 64-bit fields stay bigint-safe in TypeScript.
- No host `protoc` install required for Rust or Buf-driven TS generation.

### Bad

- Two generator ecosystems (Cargo build-script + Buf) to keep version-aligned.
- Committed generated TypeScript can drift if contributors edit outputs by hand;
  `--check` mitigates but does not prevent local mistakes before push.
- Full replay-oracle migration off JSON is deferred, so two projections coexist
  briefly.

## Validation

- `cargo test -p aigent-protocol` encodes/decodes shared binary fixtures,
  including malformed-byte and unknown-field cases (workspace membership via
  root `Cargo.toml` `members = ["crates/*"]`).
- Node tests in `@aigent-place/protocol` and `@aigent-place/aigent-sdk` decode
  the same fixture bytes / re-export generated schemas.
- `node scripts/generate-protocol.mjs --check` fails on stale generated TS.
- `node scripts/check.mjs` reaches those suites transitively through
  `scripts/product-check.mjs`.

## Follow-up

- Replace replay semantic JSON `payload_hex` application with the generated
  `COMMAND_OUTCOME` protobuf decoder when wiring recovery binaries.
- Optional later ADR if the project standardizes on Buf for Rust as well.

## Supporting approved source: protocol/v1/CONTRACT.md

# Protocol v1 envelope and compatibility contract

This is the normative semantic contract for the public v1 connection
envelope. [`aigent.proto`](aigent.proto) is the sole authority for wire fields,
field numbers, and enums. This document defines behavior protobuf cannot
express: negotiation, direction, correlation, failure boundaries, sequencing,
and recovery state transitions. The JSON conformance document is example data,
not another wire schema.

This contract implements
[ADR-0001](../../docs/adr/0001-protocol-v1-compatibility-and-recovery.md).
Domain payload schemas are added by their owning accepted Step 0 contracts;
the first is the [world geometry contract](../../world/v1/CONTRACT.md).
Authentication, persistence retention periods, generated bindings, and binary
protobuf conformance remain outside task-002.

## Connection lifecycle

Before negotiation, the only legal frame is `HandshakeFrame`. A client sends
one `ClientHello`; the server responds with exactly one `ServerHello` or
`HandshakeReject`.

The client offers an unordered, duplicate-free set of non-zero protocol
majors. The server chooses the numerically highest offered major currently
command-capable for the requested role. For each known feature, it chooses the
highest mutually supported non-zero version. Feature offer order has no
meaning, and duplicate feature IDs are invalid. Feature availability is
scoped to the selected protocol major and connection mode. Unknown feature IDs
and unknown protobuf fields are ignored.

If the selected command-capable major is deprecated, `ServerHello` includes a
`DeprecationNotice` even while commands remain supported. The server changes a
major to retired only after its published `command_support_until_unix_ms`.
That timestamp may not be earlier than six calendar months after the non-zero
`deprecated_at_unix_ms`.

If no offered major is command-capable, the server chooses the numerically
highest offered retired major for which it retains both a decoder and a
spectator projection. It accepts that connection as `SPECTATE_ONLY` and
includes `UPGRADE_REQUIRED`. If none is decodable, it rejects the handshake
with `UNSUPPORTED_PROTOCOL`. A decodable major without a spectator projection
is not an eligible fallback and is also rejected with
`UNSUPPORTED_PROTOCOL`.

An aigent `ServerHello` in `COMMAND_CAPABLE` mode issues a non-empty opaque
session epoch. Activating the epoch atomically invalidates the previous live
epoch for that aigent before the new epoch may command. The server then makes
a best-effort `ConnectionDisplaced` delivery to the superseded connection;
authority is already gone even if that notice cannot be delivered. Every
viewer connection uses `SPECTATE_ONLY` mode on its selected current major but
does not receive `UPGRADE_REQUIRED`. A retired-major aigent fallback also uses
`SPECTATE_ONLY` and does receive `UPGRADE_REQUIRED`. Neither receives a
command epoch.

## Envelope validity and direction

Every post-handshake `Envelope` carries the negotiated non-zero protocol
major, non-empty connection ID, non-zero message ID, metadata, and exactly one
body. Message IDs correlate responses on one connection and need not be
contiguous. A body on the wrong direction is invalid:

| Direction | Legal bodies |
| --- | --- |
| Client to server | `Command`, `SnapshotResyncRequest`, `EventAcknowledgement`, `EventResumeRequest` |
| Server to client | `CommandResult`, `ProtocolError`, `Percept`, `FullSnapshot`, `SnapshotDelta`, `SnapshotResyncRequired`, `OrderedEvent`, `EventResyncRequired`, `EventStreamReset`, `ConnectionDisplaced` |

Decoded messages with missing, zero, duplicate, direction-forbidden, or
kind-invalid values receive `INVALID_ENVELOPE` and have no effect. A known
message kind unavailable in the selected major or mode receives
`UNSUPPORTED_MESSAGE`. A message requiring an unknown or unselected optional
feature receives `UNSUPPORTED_FEATURE`; it does not close an otherwise valid
connection.

When a decoded envelope has a non-zero message ID, every `ProtocolError`
response populates `related_message_id`. A malformed envelope whose message ID
cannot be recovered is the only uncorrelated decoded error.

Handshake and post-handshake frames are decoded according to connection phase;
they do not share an outer discriminator. A handshake frame received after
negotiation is therefore an invalid post-handshake frame and follows the
decode or envelope failure boundary below.

A frame that cannot be decoded as protobuf closes with `UNDECODABLE_FRAME`.
A frame over the published frame-size limit closes with `FRAME_TOO_LARGE`.
Frame and rate limits other than the fixed outbound queue limit are owned by
the workload contract.

## Commands and authoritative results

Only a command-capable aigent may send `Command`. Command metadata carries the
active session epoch, a sequence starting at 1 and contiguous within that
epoch, and a non-empty idempotency key.

The server checks active epoch and sequence before domain execution:

- Envelope identity and metadata validity are checked first.
- A spectate-only connection then returns `SPECTATE_ONLY`.
- A stale epoch then returns `STALE_SESSION_EPOCH`.
- A sequence above the next expected value then returns `SEQUENCE_GAP`.
- A sequence below the next expected value replays the recorded result only
  when both its content digest and idempotency key match; otherwise it returns
  `SEQUENCE_CONTENT_CONFLICT`.
- The idempotency lookup is scoped to `(aigent_id, protocol_major,
  idempotency_key)` across session epochs. Identical semantic content replays
  the original authoritative result. Different content returns
  `IDEMPOTENCY_CONFLICT`.
- For an exact-next command, kind availability is checked before idempotency.
  An unavailable kind produces a correlated rejected `CommandResult` with
  `UNSUPPORTED_MESSAGE` and advances the sequence like any other recorded
  rejection.

The
[replay and persistence contract](../../replay/v1/CONTRACT.md)
inserts one durable admission boundary after the no-effect
connection/epoch/sequence classification and before kind availability,
cross-epoch idempotency conflict, domain execution, or any authoritative
exact-next result. A below-sequence identical retry reads its durable result
without new admission. If admission is unavailable, the server returns
correlated `PERSISTENCE_BACKPRESSURE` with positive `retry_after_ticks`; this
is a transient `ProtocolError`, consumes no sequence or idempotency key, and
is retried with the same pair. An individually unpersistable command returns
`PERSISTENCE_RECORD_TOO_LARGE` and closes with the matching close reason. A
writer failure sends best-effort correlated `PERSISTENCE_UNAVAILABLE` errors
for commands in the failed generation and closes every command-capable
connection with the matching close reason; spectators remain open. These
outcomes are not `CommandResult` rejections because no undurable result may
advance sequence. V1 backpressure uses `retry_after_ticks = 1`; the field is
absent for the two fatal persistence errors and every other protocol error.

An exact-next, well-formed command produces and records one authoritative
accepted or rejected `CommandResult`, then advances the expected sequence.
Retries replay that recorded result. Accepted results identify every affected
entity and its resulting non-zero revision; revision zero is invalid at the
protocol boundary. Existing opaque identities remain in
`CommandAccepted.affected_entities`. Geometry commands governed by the world
v1 contract use `affected_world_entities`, whose IDs are numeric `uint64`
values; a result MUST NOT describe the same mutation in both fields. Durable
publication ordering, canonical
content digesting, idempotency retention, and replay-journal retention are
owned by the replay and persistence contract linked above.

`CANCEL_INTENT` and bare `STOP` are base v1 commands with empty payloads.
ADR-0002 and the world geometry contract additionally make `PLACE_OBJECT`,
`SET_SHAPE`, and `UNSTICK` available with their typed protobuf payloads.
Architecture section 3 and world contract section 6 make `MOVE` available as
`MovePayload`: signed millimetre horizontal target `(target_x_mm,
target_z_mm)` and strictly positive `speed_mm_per_s`. A malformed or empty
MOVE payload is rejected with `INVALID_INTENT` and
must not mutate the world. Every other command kind whose `payload` does not
yet have an accepted typed schema is unavailable and returns
`UNSUPPORTED_MESSAGE`. The bytes field is a reserved transport slot for the
named schema, not permission to define private hand-copied payload types. The
protocol semantic fixtures use `CANCEL_INTENT` when exercising
accepted-result behavior.

When a movement lease terminates without a new command (blocked for
`movement.blocked_lease_ticks`, TTL expiry, cancel/stop, or ruleset clamp
cancellation, or invalidated authoritative entity state), the server emits a `Percept` with
`PERCEPT_KIND_LEASE_TERMINATED` whose payload encodes
`LeaseTerminatedPayload`. Blocked termination is never an undurable
authoritative command success.

The authenticated identity layer must bind `ClientHello.aigent_id` to the
connection before idempotency lookup; the client-provided bytes are never
trusted as identity on their own. Per-sequence digests and results are retained
for the lifetime of the live session epoch and discarded only after that epoch
can no longer command. Longer-lived cross-epoch retention is owned by the
replay and persistence contract.

## Three independent recovery paths

### Outbound byte pressure

Queue accounting uses encoded WebSocket payload bytes per connection. The
limit is 262,144 bytes (256 KiB). When adding state or an event would exceed
the limit, replaceable state is first coalesced to its newest representation
and the total is tested again. A queue at exactly the limit is not over; it is
over only when the post-coalescing total is greater than the limit.

At each 20 Hz observation, an over-limit queue increments its consecutive
overflow count. A queue at or below the limit resets the count to zero. The
40th consecutive over-limit observation closes the connection with
`SUSTAINED_OUTBOUND_OVERFLOW`. These 40 observations are the fixed protocol
disconnect window; the workload contract owns other measurement windows and
system-wide degradation thresholds.

### Ordered event recovery

Ordered events have a connection event-stream epoch and contiguous sequence.
The nonzero `EventCursor.stream_epoch` is the server-issued stream identifier,
globally unique within one world/replay history and never reused. A reset
allocates a new value.
They are retained until acknowledged and never coalesced. A sequence gap, or
an event that cannot be admitted after replaceable-state coalescing, changes
only the event stream to `event_resync_required`.

The client resumes from its last acknowledged sequence. If the journal retains
the entire missing suffix, the server replays it in order. Otherwise the
server emits `EventStreamReset` naming the unavailable inclusive range and
starts a server-issued new stream epoch at sequence 1. Reset invalidates every
unacknowledged event in the old epoch, so the unavailable range extends
through the greatest sequence sent in that epoch, including any retained
suffix after a journal gap. Event loss is always visible. A stale resume epoch
requires event resync; an acknowledgement ahead of the server's sent cursor is
invalid. Duplicate events below the next expected sequence are ignored.
Snapshot recovery never resets or acknowledges the event stream.

A retransmitted acknowledgement at or below the server's recorded
acknowledgement is ignored idempotently. A resume cursor behind that recorded
acknowledgement resumes from the server's cursor; a cursor ahead of the
greatest sent sequence is invalid.

### Snapshot baseline recovery

Every delta names exactly one installed baseline. A missing, expired, or
mismatched baseline changes only snapshot delivery to
`snapshot_resync_required`. The client may request recovery, and the server
may initiate it. Recovery installs a fresh full snapshot with a new baseline
ID. It does not alter event epoch, event sequence, or acknowledgement state.

`FullSnapshot.payload` encodes `WorldSnapshotBodyProto`; `SnapshotDelta.payload`
encodes `WorldSnapshotDeltaProto`. Both inner messages use version 1 and carry
an exact 32-byte `generation_digest` for the authoritative immutable generation.
The numbered `baseline_id` identifies a retained full body; it is not the digest.
Publishing a delta does not replace that retained baseline body.

A full body carries the generation tick and every entity in the connection's
AOI, in nearest-first Euclidean distance order with ascending entity ID as the
tie-break. The hard cap is 100 entities; degradation can lower the viewer cap.
Each record preserves its non-zero entity ID and revision, required signed
millimetre position within the inclusive ±100 km bound, and complete optional
`ShapeTree`. An absent shape is legitimate. A corrupt stored shape must fail
snapshot construction; it must not become a successful record with no shape.

A delta has explicit `entered`, `modified`, and `left_ids` sets. IDs are unique
within a message and disjoint across those sets. Absence from a delta never
means leave. Apply the complete transition against the current entity set:
enter adds an absent entity, modify updates a present entity, and leave removes
a present entity. Invalid transitions have no partial effect. Unknown protobuf
fields remain compatible, but malformed payloads or an unsupported inner
version require snapshot recovery without installing that payload.

Dropping a queued incremental transition during coalescing requires a complete
full replacement with a fresh baseline ID. Pending replaceable state can be
withdrawn; ordered results, events, and control frames retain FIFO order.
A write already in progress remains charged until completion. Resync observation
remains held until the matching full snapshot write completes; an older full
write cannot release the hold for a newer baseline.

## Semantic examples

[`conformance/envelope-v1.json`](conformance/envelope-v1.json) contains
deterministic logical transitions for the rules above.
`scripts/protocol-contract.mjs` evaluates them without networking, clocks,
randomness, or protobuf serialization. Supplied `encoded_bytes` and
`content_digest` values are test facts, not alternate encodings.

Task-004 owns generated Rust and TypeScript bindings, raw protobuf
unknown-field and malformed-byte tests, and cross-target binary round trips.
Those live in `crates/aigent-protocol`, `@aigent-place/protocol`,
`@aigent-place/aigent-sdk`, and
[`conformance/binary/`](conformance/binary/). The durable
`COMMAND_OUTCOME` protobuf schema is defined in `aigent.proto`. The replay
semantic oracle decodes recovery `payload_hex` with that schema via
`scripts/replay-command-outcome.mjs`, binds decoded durable fields to the
wire-representable subset of the semantic projection, and keeps
`projection_sha256` over the full semantic JSON (including projection-only
fields such as RNG audits).

`ProtocolCloseReason` supplies the stable symbolic reason used by server
implementations and diagnostics. The WebSocket close code and the transport
encoding of that reason are owned by the transport/workload contract.


## Authoritative schema context for generated descriptors

syntax = "proto3";

package aigent.protocol.v1;

// Canonical v1 public envelope and control schema.
//
// All post-handshake traffic is encoded as Envelope. Unknown protobuf fields
// are ignored. Validation rules that proto3 cannot express are normative in
// CONTRACT.md.

enum ConnectionRole {
  CONNECTION_ROLE_UNSPECIFIED = 0;
  CONNECTION_ROLE_AIGENT = 1;
  CONNECTION_ROLE_VIEWER = 2;
}

enum ConnectionMode {
  CONNECTION_MODE_UNSPECIFIED = 0;
  CONNECTION_MODE_COMMAND_CAPABLE = 1;
  CONNECTION_MODE_SPECTATE_ONLY = 2;
}

enum ProtocolErrorCode {
  PROTOCOL_ERROR_CODE_UNSPECIFIED = 0;
  PROTOCOL_ERROR_CODE_UNSUPPORTED_PROTOCOL = 1;
  PROTOCOL_ERROR_CODE_UPGRADE_REQUIRED = 2;
  PROTOCOL_ERROR_CODE_INVALID_ENVELOPE = 3;
  PROTOCOL_ERROR_CODE_UNSUPPORTED_MESSAGE = 4;
  PROTOCOL_ERROR_CODE_UNSUPPORTED_FEATURE = 5;
  PROTOCOL_ERROR_CODE_PERSISTENCE_BACKPRESSURE = 6;
  PROTOCOL_ERROR_CODE_PERSISTENCE_RECORD_TOO_LARGE = 7;
  PROTOCOL_ERROR_CODE_PERSISTENCE_UNAVAILABLE = 8;
}

enum ProtocolCloseReason {
  PROTOCOL_CLOSE_REASON_UNSPECIFIED = 0;
  PROTOCOL_CLOSE_REASON_UNDECODABLE_FRAME = 1;
  PROTOCOL_CLOSE_REASON_FRAME_TOO_LARGE = 2;
  PROTOCOL_CLOSE_REASON_SUSTAINED_OUTBOUND_OVERFLOW = 3;
  PROTOCOL_CLOSE_REASON_PERSISTENCE_RECORD_TOO_LARGE = 4;
  PROTOCOL_CLOSE_REASON_PERSISTENCE_UNAVAILABLE = 5;
}

enum CommandKind {
  COMMAND_KIND_UNSPECIFIED = 0;
  COMMAND_KIND_MOVE = 1;
  COMMAND_KIND_TURN = 2;
  COMMAND_KIND_SET_POSE = 3;
  COMMAND_KIND_CANCEL_INTENT = 4;
  COMMAND_KIND_SAY = 5;
  COMMAND_KIND_SEND = 6;
  COMMAND_KIND_CHANNEL_POST = 7;
  COMMAND_KIND_PLACE_OBJECT = 8;
  COMMAND_KIND_MODIFY_OBJECT = 9;
  COMMAND_KIND_REMOVE_OBJECT = 10;
  COMMAND_KIND_SET_SHAPE = 11;
  COMMAND_KIND_PROPOSE = 12;
  COMMAND_KIND_VOTE = 13;
  COMMAND_KIND_STOP = 14;
  COMMAND_KIND_UNSTICK = 15;
}

enum PerceptKind {
  PERCEPT_KIND_UNSPECIFIED = 0;
  PERCEPT_KIND_HEARD = 1;
  PERCEPT_KIND_MESSAGE = 2;
  PERCEPT_KIND_CHANNEL = 3;
  PERCEPT_KIND_RULESET_CHANGED = 4;
  PERCEPT_KIND_WORLD_RECOVERY_DIAGNOSTIC = 5;
  PERCEPT_KIND_LEASE_TERMINATED = 6;
}

enum CommandRejectionCode {
  COMMAND_REJECTION_CODE_UNSPECIFIED = 0;
  COMMAND_REJECTION_CODE_SPECTATE_ONLY = 1;
  COMMAND_REJECTION_CODE_STALE_SESSION_EPOCH = 2;
  COMMAND_REJECTION_CODE_SEQUENCE_GAP = 3;
  COMMAND_REJECTION_CODE_SEQUENCE_CONTENT_CONFLICT = 4;
  COMMAND_REJECTION_CODE_IDEMPOTENCY_CONFLICT = 5;
  COMMAND_REJECTION_CODE_UNSUPPORTED_MESSAGE = 6;
  reserved 7 to 9;
  COMMAND_REJECTION_CODE_RULESET_VIOLATION = 10;
  COMMAND_REJECTION_CODE_INVALID_INTENT = 11;
  COMMAND_REJECTION_CODE_NOT_AUTHORIZED = 12;
  COMMAND_REJECTION_CODE_RATE_LIMITED = 13;
  COMMAND_REJECTION_CODE_BUDGET_EXCEEDED = 14;
  COMMAND_REJECTION_CODE_CONFLICT = 15;
}

enum SnapshotResyncReason {
  SNAPSHOT_RESYNC_REASON_UNSPECIFIED = 0;
  SNAPSHOT_RESYNC_REASON_BASELINE_MISSING = 1;
  SNAPSHOT_RESYNC_REASON_BASELINE_EXPIRED = 2;
  SNAPSHOT_RESYNC_REASON_BASELINE_MISMATCHED = 3;
  SNAPSHOT_RESYNC_REASON_AOI_TELEPORT = 4;
  SNAPSHOT_RESYNC_REASON_SERVER_INITIATED = 5;
}

enum EventResyncReason {
  EVENT_RESYNC_REASON_UNSPECIFIED = 0;
  EVENT_RESYNC_REASON_CLIENT_DETECTED_GAP = 1;
  EVENT_RESYNC_REASON_EVENT_NOT_ADMITTED = 2;
  EVENT_RESYNC_REASON_SERVER_INITIATED = 3;
  EVENT_RESYNC_REASON_EPOCH_MISMATCH = 4;
}

enum PhysicsRejectionCode {
  PHYSICS_REJECTION_CODE_UNSPECIFIED = 0;
  PHYSICS_REJECTION_CODE_INVALID_COORDINATE = 1;
  PHYSICS_REJECTION_CODE_OUT_OF_WORLD_BOUNDS = 2;
  PHYSICS_REJECTION_CODE_INVALID_SHAPE = 3;
  PHYSICS_REJECTION_CODE_OVERLAP = 4;
  PHYSICS_REJECTION_CODE_ENCLOSES_AIGENT = 5;
  PHYSICS_REJECTION_CODE_NO_FREE_POSITION = 6;
  PHYSICS_REJECTION_CODE_UNSTICK_NOT_ELIGIBLE = 7;
  PHYSICS_REJECTION_CODE_ENTITY_ID_EXHAUSTED = 8;
  PHYSICS_REJECTION_CODE_REVISION_EXHAUSTED = 9;
}

message FeatureOffer {
  string feature_id = 1;
  repeated uint32 supported_versions = 2;
}

message FeatureSelection {
  string feature_id = 1;
  uint32 selected_version = 2;
}

message FeatureUse {
  string feature_id = 1;
  uint32 version = 2;
}

message CompatibilityRecord {
  uint32 protocol_major = 1;
  int64 deprecated_at_unix_ms = 2;
  int64 command_support_until_unix_ms = 3;
  ConnectionMode current_mode = 4;
}

message ClientHello {
  ConnectionRole role = 1;
  repeated uint32 offered_protocol_majors = 2;
  repeated FeatureOffer offered_features = 3;

  // Required for an aigent and absent for a viewer. Authentication transport
  // is outside this control schema.
  bytes aigent_id = 4;
}

message UpgradeNotice {
  ProtocolErrorCode code = 1;
  string message = 2;
  repeated CompatibilityRecord compatibility = 3;
}

message DeprecationNotice {
  int64 deprecated_at_unix_ms = 1;
  int64 command_support_until_unix_ms = 2;
}

message ServerHello {
  bytes connection_id = 1;
  uint32 selected_protocol_major = 2;
  ConnectionRole role = 3;
  ConnectionMode mode = 4;
  repeated FeatureSelection selected_features = 5;
  bytes session_epoch = 6;
  optional UpgradeNotice upgrade_notice = 7;
  optional DeprecationNotice deprecation_notice = 8;
}

message HandshakeReject {
  ProtocolErrorCode code = 1;
  string message = 2;
  repeated CompatibilityRecord compatibility = 3;
}

message HandshakeFrame {
  oneof body {
    ClientHello client_hello = 1;
    ServerHello server_hello = 2;
    HandshakeReject handshake_reject = 3;
  }
}

message EnvelopeMetadata {
  repeated FeatureUse required_features = 1;
}

message CommandMetadata {
  bytes session_epoch = 1;
  uint64 sequence = 2;

  // Scoped to (aigent_id, protocol_major), not session_epoch.
  bytes idempotency_key = 3;
}

message Vector3Millimeters {
  sint64 x_mm = 1;
  sint64 y_mm = 2;
  sint64 z_mm = 3;
}

message Quaternion {
  double x = 1;
  double y = 2;
  double z = 3;
  double w = 4;
}

message LocalTransform {
  Vector3Millimeters translation = 1;
  Quaternion rotation = 2;
}

message ColorRgba {
  uint32 red = 1;
  uint32 green = 2;
  uint32 blue = 3;
  uint32 alpha = 4;
}

message BoxPrimitive {
  sint64 size_x_mm = 1;
  sint64 size_y_mm = 2;
  sint64 size_z_mm = 3;
}

message SpherePrimitive {
  sint64 radius_mm = 1;
}

message CapsulePrimitive {
  sint64 radius_mm = 1;
  sint64 segment_length_mm = 2;
}

message CylinderPrimitive {
  sint64 radius_mm = 1;
  sint64 height_mm = 2;
}

message ConePrimitive {
  sint64 radius_mm = 1;
  sint64 height_mm = 2;
}

message PanelPrimitive {
  sint64 width_mm = 1;
  sint64 height_mm = 2;
  sint64 thickness_mm = 3;
}

message ShapeNode {
  // Non-zero and unique within one ShapeTree. parent_node_id is zero only for
  // the single root node.
  uint32 node_id = 1;
  uint32 parent_node_id = 2;
  LocalTransform transform = 3;
  optional string joint_name = 4;
  ColorRgba color = 5;
  repeated string material_tags = 6;

  oneof primitive {
    BoxPrimitive box = 10;
    SpherePrimitive sphere = 11;
    CapsulePrimitive capsule = 12;
    CylinderPrimitive cylinder = 13;
    ConePrimitive cone = 14;
    PanelPrimitive panel = 15;
  }
}

message ShapeTree {
  repeated ShapeNode nodes = 1;
}

message PlaceObjectPayload {
  // y is derived by grounding the shape on the authoritative heightfield.
  sint64 x_mm = 1;
  sint64 z_mm = 2;
  ShapeTree shape = 3;
}

message SetShapePayload {
  ShapeTree shape = 1;
}

message UnstickPayload {}

// MOVE payload: renew/replace a move-toward lease (ARCHITECTURE §3).
// target is horizontal millimetres; speed_mm_per_s must be strictly positive.
// y is derived each tick by grounding before the continuous sweep.
message MovePayload {
  sint64 target_x_mm = 1;
  sint64 target_z_mm = 2;
  uint32 speed_mm_per_s = 3;
}

enum LeaseTerminationReason {
  LEASE_TERMINATION_REASON_UNSPECIFIED = 0;
  LEASE_TERMINATION_REASON_BLOCKED = 1;
  LEASE_TERMINATION_REASON_EXPIRED = 2;
  LEASE_TERMINATION_REASON_CANCELLED = 3;
  LEASE_TERMINATION_REASON_RULESET = 4;
  LEASE_TERMINATION_REASON_INVALIDATED = 5;
}

// Typed lease termination reported when a MOVE lease ends without a new
// command result (blocked threshold, expiry, cancel, ruleset change, or an
// invalidated authoritative entity state).
message LeaseTerminatedPayload {
  uint64 body_id = 1;
  LeaseTerminationReason reason = 2;
  optional uint64 conflicting_entity_id = 3;
}

message PhysicsRejection {
  PhysicsRejectionCode code = 1;
  optional uint64 conflicting_entity_id = 2;
}

message PhysicsCommandResult {
  // Field 1 formerly duplicated the authoritative world entity ID. The only
  // authoritative ID/revision pairs are CommandAccepted.affected_world_entities.
  reserved 1;
  optional Vector3Millimeters authoritative_position = 2;
  bool displaced = 3;
}

enum WorldRecoveryDiagnosticCode {
  WORLD_RECOVERY_DIAGNOSTIC_CODE_UNSPECIFIED = 0;
  WORLD_RECOVERY_DIAGNOSTIC_CODE_TERMINAL_REVISION_FORCED_SLEEP = 1;
}

message WorldRecoveryDiagnostic {
  WorldRecoveryDiagnosticCode code = 1;
  uint64 entity_id = 2;
}

message Command {
  CommandMetadata metadata = 1;
  CommandKind kind = 2;

  // Kind-specific protobuf bytes. Task-owned mappings are normative:
  // MOVE -> MovePayload, PLACE_OBJECT -> PlaceObjectPayload,
  // SET_SHAPE -> SetShapePayload, UNSTICK -> UnstickPayload.
  // CANCEL_INTENT and STOP have empty payloads. Payload types for other
  // command kinds remain unavailable until their owning contracts add a
  // typed schema.
  bytes payload = 3;
}

message EntityReference {
  // Opaque legacy identity retained at its original wire type. New world
  // geometry results use CommandAccepted.affected_world_entities.
  bytes entity_id = 1;
  uint64 revision = 2;
}

message WorldEntityReference {
  // Non-zero monotonic uint64; see ADR-0002 and the world v1 contract.
  uint64 entity_id = 1;
  uint64 revision = 2;
}

message CommandAccepted {
  repeated EntityReference affected_entities = 1;
  bytes payload = 2;
  repeated WorldEntityReference affected_world_entities = 3;
}

message CommandRejected {
  CommandRejectionCode code = 1;
  string message = 2;
  bytes payload = 3;
}

message CommandResult {
  uint64 command_message_id = 1;
  uint64 sequence = 2;
  bytes idempotency_key = 3;

  oneof outcome {
    CommandAccepted accepted = 10;
    CommandRejected rejected = 11;
  }
}

message ProtocolError {
  optional uint64 related_message_id = 1;
  ProtocolErrorCode code = 2;
  string message = 3;
  // Required and positive only for PERSISTENCE_BACKPRESSURE.
  optional uint32 retry_after_ticks = 4;
}

message Percept {
  PerceptKind kind = 1;
  // WORLD_RECOVERY_DIAGNOSTIC payloads encode WorldRecoveryDiagnostic;
  // LEASE_TERMINATED payloads encode LeaseTerminatedPayload.
  bytes payload = 2;
}

message FullSnapshot {
  uint64 baseline_id = 1;
  bytes payload = 2;
}

message SnapshotDelta {
  uint64 baseline_id = 1;
  bytes payload = 2;
}

// Inner snapshot body carried inside FullSnapshot.payload and SnapshotDelta.payload.
// Versioned at the message level: a decoder that sees an unknown `version` must
// treat the frame as resync-required rather than guess. Real bodies replace the
// legacy `AIGB` placeholder; see task-054 and ARCHITECTURE §4.
message RealEntityRecord {
  uint64 entity_id = 1;
  uint64 revision = 2;
  Vector3Millimeters position_mm = 3;
  ShapeTree shape = 4;
}

// Full-snapshot body: every authoritative entity that survived AOI truncation,
// in AOI rank order (nearest-first, ties by ascending entity_id). The rank
// is canonical so the wire stays deterministic across same-build replays.
message WorldSnapshotBodyProto {
  uint32 version = 1;
  uint64 tick = 2;
  bytes generation_digest = 3;
  repeated RealEntityRecord bodies = 4;
}

// Delta body: explicit enter / modified / left sets. Absence from the wire is
// never a leave signal; a left record is always carried so the decoder can
// remove it deterministically without holding the prior baseline. Coalesce
// may collapse repeated modified records of the same entity_id within a tick.
message WorldSnapshotDeltaProto {
  uint32 version = 1;
  bytes generation_digest = 2;
  repeated RealEntityRecord entered = 3;
  repeated RealEntityRecord modified = 4;
  repeated uint64 left_ids = 5;
}

message SnapshotResyncRequest {
  optional uint64 baseline_id = 1;
}

message SnapshotResyncRequired {
  SnapshotResyncReason reason = 1;
  optional uint64 baseline_id = 2;
}

message EventCursor {
  uint64 stream_epoch = 1;
  uint64 sequence = 2;
}

message OrderedEvent {
  EventCursor cursor = 1;
  bytes payload = 2;
}

message EventAcknowledgement {
  EventCursor acknowledged_through = 1;
}

message EventResumeRequest {
  EventCursor last_acknowledged = 1;
}

message EventResyncRequired {
  EventResyncReason reason = 1;
  EventCursor last_acknowledged = 2;
}

message EventStreamReset {
  uint64 previous_stream_epoch = 1;
  uint64 unavailable_from_sequence = 2;
  uint64 unavailable_through_sequence = 3;
  uint64 new_stream_epoch = 4;
}

message ConnectionDisplaced {
  bytes replaced_session_epoch = 1;
}

message Envelope {
  uint32 protocol_major = 1;
  bytes connection_id = 2;
  uint64 message_id = 3;
  EnvelopeMetadata metadata = 4;
  reserved 5 to 9;
  reserved 14 to 19;

  // Client -> server: fields 10-13.
  // Server -> client: fields 20-29.
  oneof body {
    Command command = 10;
    SnapshotResyncRequest snapshot_resync_request = 11;
    EventAcknowledgement event_acknowledgement = 12;
    EventResumeRequest event_resume_request = 13;

    CommandResult command_result = 20;
    ProtocolError protocol_error = 21;
    Percept percept = 22;
    FullSnapshot full_snapshot = 23;
    SnapshotDelta snapshot_delta = 24;
    SnapshotResyncRequired snapshot_resync_required = 25;
    OrderedEvent ordered_event = 26;
    EventResyncRequired event_resync_required = 27;
    EventStreamReset event_stream_reset = 28;
    ConnectionDisplaced connection_displaced = 29;
  }
}

// Durable replay record payload for AIGR type=1 (COMMAND_OUTCOME).
// Frame header fields (magic/version/type/generation/ordinal/length/CRC) are
// owned by the replay v1 contract; this message is only the payload body.
// Semantic JSON projections remain the replay oracle's interim decoder until
// a follow-up switches recovery fixtures onto these bytes.

message RequiredFeature {
  string feature_id = 1;
  uint32 version = 2;
}

enum DurablePayloadMode {
  // Matches replay v1 payload_mode values 0..1.
  DURABLE_PAYLOAD_MODE_EMPTY = 0;
  DURABLE_PAYLOAD_MODE_BYTES = 1;
}

message DurableCommandDescriptor {
  string command_id = 1;
  uint64 arrival_tick = 2;
  bytes aigent_id = 3;
  bytes session_epoch = 4;
  uint64 sequence = 5;
  bytes idempotency_key = 6;
  uint32 protocol_major = 7;
  CommandKind kind = 8;
  repeated RequiredFeature required_features = 9;
  // EMPTY vs BYTES. Replay's textual digest projection hex-encodes the raw
  // octets stored in canonical_payload; this field is never hex text.
  DurablePayloadMode payload_mode = 10;
  bytes canonical_payload = 11;
}

message DurableCommandResult {
  oneof outcome {
    CommandAccepted accepted = 1;
    CommandRejected rejected = 2;
  }
}

message DurableOrderedEvent {
  bytes stream_id = 1;
  uint64 stream_epoch = 2;
  uint64 sequence = 3;
  uint64 ordinal = 4;
  uint64 encoded_bytes = 5;
  int64 committed_at = 6;
  bytes payload = 7;
}

message RngDrawCandidateBlock {
  uint32 rejection_block = 1;
  bytes hmac = 2;
  repeated bytes candidates = 3;
}

message RngDrawOutput {
  bytes hmac = 1;
  bytes raw = 2;
  bytes value = 3;
  uint32 candidate_index = 4;
  uint32 rejection_block = 5;
  repeated RngDrawCandidateBlock blocks = 6;
}

message RngSpatialCoordinates {
  sint64 x = 1;
  sint64 z = 2;
}

message RngDrawInput {
  uint32 rng_contract_version = 1;
  string subsystem = 2;
  string purpose = 3;
  optional uint64 generation = 4;
  uint32 canonical_command_index = 5;
  uint64 entity_id = 6;
  uint32 draw_index = 7;
  optional RngSpatialCoordinates stable_spatial_coordinates = 8;
}

message RngAuditRecord {
  RngDrawInput input = 1;
  bytes bound = 2;
  RngDrawOutput output = 3;
}

message CommandOutcome {
  string build_id = 1;
  uint32 replay_version = 2;
  uint64 prior_generation = 3;
  DurableCommandDescriptor command = 4;
  // SHA-256 digest bytes (32).
  bytes digest = 5;
  DurableCommandResult result = 6;
  uint64 encoded_frame_bytes = 7;
  uint32 generation_record_count = 8;
  bool alias = 9;
  bool preserve_idempotency = 10;
  int64 committed_at = 11;
  repeated DurableOrderedEvent events = 12;
  repeated RngAuditRecord rng_audit = 13;
}
