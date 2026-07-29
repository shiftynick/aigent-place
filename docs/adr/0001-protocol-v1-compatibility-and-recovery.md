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
