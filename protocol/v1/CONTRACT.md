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

[ADR-0011](../../docs/adr/0011-snapshot-self-binding-and-public-aims.md) adds
optional physical movement aims and private self binding without changing
inner version 1. Each record's optional `MoveAim` is projected from that same
immutable generation's active movement lease. It carries a horizontal target
within the inclusive ±100 km bound and positive speed in millimetres per
second. Aims are public to every observer in the entity's AOI. No owner identity
or client-written name/goal text is published. A target-only change or lease
removal is a record modification even when position and revision are unchanged.
Absent aim means only that this generation has no active movement lease; it
does not assert arrival, blockage, sleep, disconnect or brain motivation.

Every full and delta restates optional `self_body_id` for its receiving aigent
connection, looked up from the same generation's aigent/body bindings. The ID
is nonzero when present; absence means unbound as of this generation, including
before first MOVE creates the demo body. Viewer frames omit it. The field is
retained in canonical full/delta state, including resync and coalesced full
replacement. It is not inferred from AOI focus, body order, a sole body or an
identity hash. An entity's absence from a delta still does not mean leave;
binding restatement is an independent field rule.

A client clears its binding on a new handshake or entry into snapshot recovery,
and adopts binding only after applying a complete valid full/delta transition.
It holds self-dependent decisions until the binding and that body's position
are observed. An initial MOVE to a known bounded plaza target may bootstrap
server-owned creation without a body guess. A displaced old connection can
briefly receive state for the same identity until its socket closes; command
authority remains governed by the session epoch. Trusted-inject identity is
still the local demo authentication limitation tracked by task-040. These
state fields do not repair or weaken the durable command-result contract.

Unknown fields remain compatible. A decoder that understands aims rejects
out-of-bound targets, non-positive speeds or a present zero self ID through
snapshot recovery, with no partial state installation. No expiry countdown is
defined: deltas still carry no current authoritative tick.

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

### Optional ephemeral demo activity

[ADR-0014](../../docs/adr/0014-shared-ephemeral-demo-activity.md) defines an
explicit opt-in, ephemeral two-participant cooperative activity. Full field6 and
delta field7 carry `DemoActivitySnapshot` version1 as a complete replacement from
the same immutable generation as bodies and aims. Absence clears the previous
activity. Body/delta version1 remains unchanged; older consumers may ignore the
additive fields. New consumers validate activity and body transition before
installing either. Invalid, unknown-version or oversized activity requires
snapshot recovery with no partial body/activity commit.

The non-auth `run_id` is a 16-byte nonzero token minted once at startup; restart
changes it and clears earned rounds. The state has exactly two ordered numeric
participant slots. Present body IDs are nonzero, distinct and ordered ascending;
unbound slots follow bound slots.
Availability is explicit. Owner identities, connection IDs and command epochs
are private. Global participant references do not expand the AOI: an omitted
body has no invented pose and is described as absent from that observation.

The world alone advances READY, SEPARATE, REGROUP, COMPLETE and SUSPENDED. READY
forms a safe inner band without earning movement credit or a completed round.
SEPARATE starts below its separation threshold and requires both participants'
new own outward leased-motion path and signed net directed contribution before
an observed crossing. REGROUP resets both proofs, requires both new inward
contributions, then safe consecutive dwell. COMPLETE adds one earned round and
holds it briefly. A phase-earned proof stays valid while current net contribution
and exact private presence/identity/shape remain valid. Intentional arrival or
STOP may hold for a slower peer. STOP still cancels its lease; continuous recent
movement and lease renewal are not required after earning proof.

Initial v1 rules are inner distance1800–2200mm, separation5500mm, minimum own
path1000mm and signed contribution1000mm per movement phase,8 consecutive dwell
ticks,20 COMPLETE/recovery hold ticks, and400 phase-timeout ticks. Rules are
published explicitly. Formation centre and horizontal axis freeze during setup,
persist across completed rounds, and refreeze after reset recovery. Horizontal
anchors stay within ±8000mm. The horizontal axis is scaled to1000mm length with
integer-rounding tolerance2mm. Coordinates retain canonical world bounds.
Travel progress caps at its minimum; signed net progress is bounded ±32000mm.
An earned tick is within this attempt's credit interval and cannot be inferred
from a command result. COMPLETE retains REGROUP's `credit_started_tick`, so its
proof ticks may precede COMPLETE's phase-entry tick. READY/SUSPENDED clear credit,
phase origins, earned ticks and dwell; SUSPENDED also clears formation anchors.

Participant loss or epoch/body/shape replacement, actual outstanding lease
expiry/invalidation, unsafe geometry or timeout suspends before completion and
clears partial credit. Recovery goes through READY even without active leases.
Unsafe overlap does not promise automatic displacement. A connected stationary
participant without this phase's contribution cannot qualify. An externally
paused brain that already earned valid proof may permit later completion within
the bounded phase lifetime; the server cannot instantly infer process state.

Reset, transition and completed-round IDs are checked uint64 counters. Reset
preserves the run's earned total and monotonic transition IDs. Up to eight typed
recent transitions carry ordered IDs/ticks/reset/counts. Latest retained ID is
the state's transition ID and latest target phase is current phase. Counter
exhaustion fails closed as SUSPENDED/COUNTER_EXHAUSTED with cleared credit and
retained IDs/count/history; only that terminal condition permits latest target
phase to differ. No completion or transition key is reused. Encoded activity is
bounded to2048bytes, including retained history. No arbitrary narrative strings
are included. Normal-world absent-state generation digest bytes stay unchanged.

Full, delta, newest coalesced full, ordered-pressure promoted full and explicit
resync retain this complete current state/history from their frozen generation.
Activity-only changes must not be suppressed by an entity-only diff. Initial
or recovery FULL establishes the presentation watermark without celebrating
historical transitions. Fresh subsequent DELTAs may cue new IDs once. Same-run
memory can retain its watermark through reconnect; reload adopts a new baseline
and promises no exactly-once effect across memory loss. A missing retained
transition range is disclosed. Stale/recovery presentation is last-observed
state and produces no live completion cue.

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
