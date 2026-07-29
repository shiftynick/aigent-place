# Protocol v1 envelope and compatibility contract

This is the normative semantic contract for the public v1 connection
envelope. [`aigent.proto`](aigent.proto) is the sole authority for wire fields,
field numbers, and enums. This document defines behavior protobuf cannot
express: negotiation, direction, correlation, failure boundaries, sequencing,
and recovery state transitions. The JSON conformance document is example data,
not another wire schema.

This contract implements
[ADR-0001](../../docs/adr/0001-protocol-v1-compatibility-and-recovery.md).
Domain payload schemas, authentication, persistence retention periods,
generated bindings, and binary protobuf conformance are deliberately outside
task-002.

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

An exact-next, well-formed command produces and records one authoritative
accepted or rejected `CommandResult`, then advances the expected sequence.
Retries replay that recorded result. Accepted results identify every affected
entity and its resulting non-zero revision; revision zero is invalid at the
protocol boundary. Durable publication ordering, canonical
content digesting, idempotency retention, and replay-journal retention are
owned by the replay and persistence contract.

`CANCEL_INTENT` and bare `STOP` are base v1 commands with empty payloads and
may be accepted before domain payload contracts exist. Every other command kind whose
`payload` does not yet have an accepted typed schema is unavailable and
returns `UNSUPPORTED_MESSAGE`. The bytes field is a reserved transport slot,
not permission to define private hand-copied payload types. The semantic
fixtures use `CANCEL_INTENT` when exercising accepted-result behavior.

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

## Semantic examples

[`conformance/envelope-v1.json`](conformance/envelope-v1.json) contains
deterministic logical transitions for the rules above.
`scripts/protocol-contract.mjs` evaluates them without networking, clocks,
randomness, or protobuf serialization. Supplied `encoded_bytes` and
`content_digest` values are test facts, not alternate encodings.

Task-004 owns generated Rust and TypeScript bindings, raw protobuf
unknown-field and malformed-byte tests, and cross-target binary round trips.

`ProtocolCloseReason` supplies the stable symbolic reason used by server
implementations and diagnostics. The WebSocket close code and the transport
encoding of that reason are owned by the transport/workload contract.
