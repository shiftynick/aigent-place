# Replay and persistence contract v1

This document is the normative Step 0 contract for durable command ordering,
idempotent result replay, ordered-event retention, crash recovery, and seeded
randomness. It implements the locked architecture and
[ADR-0005](../../docs/adr/0005-durable-command-replay-and-backpressure.md),
and composes with the
[protocol v1 contract](../../protocol/v1/CONTRACT.md) and
[world v1 contract](../../world/v1/CONTRACT.md).

The protocol contract owns envelopes, session/sequence validation, public
error carriers, and event-resume messages. The world contract owns geometry,
entity revisions, and domain outcomes. This contract owns the durable
admission cut point, canonical content digest, atomic generation record,
publication order, retention, checkpoint recovery, and replay oracle.

## 1. Canonical command input

### 1.1 Arrival tick

After a complete envelope passes decoding, frame limits, authenticated
identity binding, direction, protocol-major, feature-use, and command-metadata
shape validation, ingress stamps it with the earliest simulation tick whose
input cutoff has not started. That unsigned 64-bit `arrival_tick` is internal
authoritative metadata. Socket-read completion, worker scheduling, wall-clock
timestamps, and connection iteration order never break ties.

Within a tick, commands are ordered by:

1. unsigned `arrival_tick`;
2. unsigned lexicographic bytes of the authenticated `aigent_id`; then
3. unsigned `CommandMetadata.sequence`.

The full tuple is unique. A duplicate tuple is invalid internal input and
fails the generation before admission. Entity IDs and idempotency keys are not
fallback tie-breakers.

Commands for one aigent are evaluated in sequence order against the tentative
session cursor, world effects, and idempotency mappings produced by earlier
commands in the same batch. Thus identical or conflicting reuse of a key has
the same result whether the prior command is in the current generation or an
earlier durable generation. Entity collections and multi-entity results retain
their separately defined unsigned entity-ID order.

The sequence cursor is scoped by `(authenticated aigent_id, session_epoch)`.
Every admitted command carries an explicit non-empty session epoch; v1 has no
implicit or default epoch.
Every newly activated epoch begins at sequence `1`; reconnecting never carries
the prior epoch's numeric cursor forward. The cross-epoch idempotency index in
section 7 remains scoped independently of that session cursor.
All identity fields in this scope are opaque protocol bytes. In semantic JSON
fixtures, plain strings are UTF-8 shorthand and a `hex:` prefix carries
arbitrary bytes losslessly; ordering and durable keys operate on decoded bytes,
never on the fixture spelling.

### 1.2 Canonical semantic content

The idempotency scope is `(authenticated aigent_id, protocol_major,
idempotency_key)`. The stored SHA-256 content digest has the ASCII domain
prefix `aigent.command.semantic.v1` followed by a zero byte. It excludes
transport
`message_id`, `connection_id`, session epoch, sequence, idempotency key, and
arrival tick. It includes:

- digest-contract version `1`;
- negotiated protocol major;
- command kind;
- the count of command-required features and each effective feature ID/version,
  ordered by unsigned UTF-8 feature-ID bytes; and
- one-byte payload mode, payload length, and payload bytes.

Feature-use input order is non-semantic. Duplicate feature IDs are invalid.
The payload modes are `0 = canonical_typed` and `1 = exact_unavailable`.
Malformed or domain-invalid bytes of an available kind are rejected as
`INVALID_ENVELOPE` before durable admission under protocol v1 and therefore
have no semantic command digest. For a valid available typed command, the
server decodes and validates the payload,
discards unknown protobuf fields as required by v1, applies the owning
contract's canonicalization rules, and deterministically re-encodes the known
fields before hashing. Empty typed payloads canonicalize to zero bytes.
For an unavailable command kind, the exact payload bytes are hashed so its
durable `UNSUPPORTED_MESSAGE` result can be replayed.

Counts and enum values are unsigned 32-bit big-endian; payload lengths are
unsigned 64-bit big-endian. String components are unsigned-32-bit-length-
prefixed UTF-8 byte strings. Canonical protobuf projection uses ascending
field number, minimal varints, exactly one selected oneof arm, and the owning
domain contract's non-semantic ordering/presence normalization.
Changing this encoding requires a new digest-contract version; stored rows are
never reinterpreted.

## 2. Validation and admission precedence

Checks that cannot create an authoritative exact-next result run before writer
admission:

1. envelope and authenticated identity validity;
2. connection mode and active session epoch;
3. sequence classification; and
4. replay of a previously durable sequence/key result.

A below-cursor identical retry is served from durable state without a writer
slot. When the original exact-next command is earlier in the current canonical
batch, the tentative session-result view attaches that retry to the original
outcome; it creates no second durable record and is emitted only after the
original result becomes durable. A gap, stale epoch, spectate-only command, or
conflicting reuse of an already consumed sequence has no world effect and
follows protocol v1.

An active exact-next command requires admission before kind availability,
cross-epoch idempotency conflict, domain validation, authoritative rejection,
or sequence advancement. Those outcomes are durable and therefore cannot be
manufactured while persistence is unavailable.
After admission, identical retained semantic content aliases its original
result. For non-identical content, kind availability is classified before
cross-epoch idempotency conflict: an unavailable message produces
`UNSUPPORTED_MESSAGE`, while another differing retained command produces
`IDEMPOTENCY_CONFLICT`. Structural invalidity was already rejected as
`INVALID_ENVELOPE` before this durable admission boundary.

## 3. Bounded writer generation

V1 permits one uncommitted generation. Its two inclusive limits are:

- 4,096 command records; and
- 16,777,216 encoded durable bytes.

A generation exactly at both limits fits. The byte count is the complete
versioned application frames stored by section 5, not websocket bytes,
database page size, or an implementation estimate.

When the writer slot is free, the server speculatively evaluates the canonical
tick batch and admits the longest prefix whose complete encoded durable record
set fits both limits. Tentative work used to measure a non-admitted suffix is
discarded. The prefix choice must be identical for every permutation of the
same canonical inputs.

When the writer slot is occupied, no exact-next command enters the sequence
machine. Each receives `ProtocolError` with:

- `PROTOCOL_ERROR_CODE_PERSISTENCE_BACKPRESSURE`;
- `related_message_id` equal to its envelope message ID; and
- `retry_after_ticks = 1`.

This error is transient and non-authoritative. It consumes no command
sequence, idempotency key, ID, revision, RNG draw, mutation, or ordered event.
The client retries the same sequence and idempotency key.
This occupied-slot result is unconditional: even a command that would be too
large for an empty generation receives transient backpressure because no
durable-size classification occurs while the slot is occupied.

When a single otherwise frame-valid command cannot fit an empty generation,
the server sends
`PROTOCOL_ERROR_CODE_PERSISTENCE_RECORD_TOO_LARGE` correlated to the command,
then closes that command-capable connection with
`PROTOCOL_CLOSE_REASON_PERSISTENCE_RECORD_TOO_LARGE`. It has no authoritative
effect and the sequence/key remain unconsumed.

After finding the admitted prefix, the server still classifies every command
in the complete non-admitted suffix. A command larger than the empty-generation
byte limit receives `PERSISTENCE_RECORD_TOO_LARGE` even when an earlier suffix
command was merely excluded by the current generation's remaining capacity.
Every other suffix command receives `PERSISTENCE_BACKPRESSURE`.

Persistence backpressure is independent of the protocol's per-connection
outbound byte-pressure state. Neither counter or recovery path changes the
other.

## 4. Atomic generation and publication

One repository transaction atomically commits:

- generation number, build ID, replay version, and prior generation;
- canonical command metadata and semantic digest;
- the authoritative accepted or rejected `CommandResult`;
- sequence cursor advancement and idempotency mapping;
- ID/revision allocator changes and every world/ruleset mutation;
- recovery-generation stamps and diagnostics;
- ordered-event payloads, stream cursors, and one globally monotonic durable
  event commit ordinal; and
- named RNG draw inputs and outputs.

Writer completion is one-shot. Once a pending generation is marked committed,
any duplicate completion signal is ignored and cannot advance cursors, append
frames or events, or apply effects again. Before the transaction begins, the
writer validates the persisted commit clock, authoritative result/effect
shapes, complete durable event descriptors, RNG evidence, and every allocator
capacity. A failure in this preflight has no authoritative effect.

Generation numbers cover the full unsigned 64-bit range. Semantic JSON uses a
number only while the value is within JSON's safe integer range and otherwise
uses a canonical unsigned decimal string. Admission allocates and validates
the next generation before it creates pending state. Generation
`2^64 - 1` may commit, but once it is current the allocator is exhausted and
the server fails any later admission before authoritative or tentative
mutation; it never wraps.

Each exact-next command in the admitted prefix records exactly one result and
advances its session sequence exactly once, including domain rejections and
semantic no-ops. Only accepted changes allocate IDs or increment revisions as
defined by the owning domain contract. A transaction rollback makes every
tentative allocation and draw reusable because none became authoritative.

The transaction also records a session-result row keyed by
`(authenticated aigent_id, session_epoch, sequence)`. That row contains the
semantic digest, idempotency key, and complete result returned for that
sequence. Below-cursor replay consults this row; it does not infer the result
from the cross-epoch idempotency index. An exact-next command whose retained
cross-epoch key and digest match records an alias to the original result and
advances the current session cursor, but it does not re-run domain logic,
reapply mutations, allocate IDs/revisions, emit the original events, or
consume RNG draws.
Replay independently derives these transitions from the retained cross-epoch
row: an identical retained digest must be a no-effect alias with the original
result; a different retained digest follows the availability/validity/conflict
precedence above. An unseen key may not claim either transition. Recovery
verifies a suffix outcome's recorded `preserve_idempotency` decision against
the prior mapping because a cold restart intentionally disconnects the live
epoch references that justified the historical decision; the flag records
that decision but never creates a missing prior mapping.

After commit succeeds:

1. the completed generation waits for the next tick boundary;
2. the server installs it and publishes the immutable world generation;
3. command results are emitted in canonical command order; then
4. ordered events are emitted in their durable sequence order.

The next writer generation is not admitted until the prior generation's
commit outcome is known. Simulation ticks, snapshot serialization, and
spectator reads continue without waiting for the writer.

If the writer reports failure after admission, the server publishes none of
that tentative generation. It discards the generation, stops command
admission, sends best-effort correlated
`PROTOCOL_ERROR_CODE_PERSISTENCE_UNAVAILABLE` for commands in the failed
generation, closes every command-capable connection with
`PROTOCOL_CLOSE_REASON_PERSISTENCE_UNAVAILABLE`, and serves spectators from
the last committed immutable generation. Command capability resumes only
after recovery reloads and verifies that generation. An implementation must
not convert a writer failure into an authoritative rejection.

## 5. Durable records

### 5.1 Frame

Every application record in a generation transaction is the following
big-endian byte frame:

1. four ASCII magic bytes `AIGR`;
2. unsigned 16-bit format version `1`;
3. unsigned 16-bit mandatory record type;
4. unsigned 64-bit generation;
5. unsigned 32-bit generation-local ordinal beginning at zero and contiguous;
6. unsigned 64-bit payload length;
7. payload bytes; and
8. unsigned 32-bit CRC32C over every preceding frame byte.

V1 defines one mandatory record type: unsigned value `1`,
`COMMAND_OUTCOME`. There is exactly one such frame for each command in
canonical admitted-prefix order. Its payload is the versioned durable command
outcome bundle named by section 4: generation/build/prior-generation metadata,
command metadata and digest, session-result row, idempotency-index operation,
allocator/world/ruleset effects, ordered events, and named RNG evidence.
Rejected commands carry empty effect lists. Task-004 owns the protobuf schema
and deterministic binary projection for this bundle; adding another mandatory
record type requires a replay-contract version change.

Every `COMMAND_OUTCOME` payload also carries the generation's unsigned
32-bit `generation_record_count`. The value is identical in every frame of
that generation, is in `1..4096`, and equals the number of outcome frames
atomically committed for the generation. Recovery verifies both contiguous
ordinals and this count, so removing a terminal frame is detectable rather
than indistinguishable from a smaller successful transaction.

The command portion contains the digest preimage needed for replay: protocol
major, kind, sorted required feature IDs/versions, payload mode, and canonical
payload bytes, in addition to arrival/session/sequence metadata. The digest is
an integrity identity, not a substitute for this content.
The payload mode is one of the two v1-defined values `0..1`, and the
canonical payload is lowercase, even-length hexadecimal. Invalid modes,
non-hex characters, uppercase characters, and odd-length hex are rejected
before admission rather than normalized into a colliding digest preimage.

CRC32C detects accidental record corruption. It is not the semantic command
digest and is not used for identity or security. Unknown mandatory record
versions/types, duplicate or missing ordinals, length mismatch, and checksum
failure make a committed generation invalid.

### 5.2 Transaction and tail outcomes

SQLite transaction/WAL recovery is the v1 atomicity boundary. The repository
abstraction must provide the same all-or-nothing boundary on another store.

- Crash before commit: the generation has no authoritative effect.
- Crash after commit but before installation: recovery installs it and an
  identical retry returns its stored result.
- Crash after installation but before result delivery: state remains and the
  retry returns the stored result.
- Crash after result but before event delivery: event resume replays the
  durable suffix.
- Partial or interrupted uncommitted WAL tail: SQLite rollback makes it
  equivalent to pre-commit.

Tail conformance input is raw hex bytes plus the repository transaction's
committed/uncommitted state. The evaluator parses frame length from those bytes:
an uncommitted partial tail is classified as rolled back, while a committed
partial frame fails recovery. A committed tail that contains one complete,
well-formed frame is classified as complete only when it is byte-identical to
the final frame in the supplied committed record set. A complete committed
tail absent from that set, or conflicting with its final record, fails closed
rather than silently dropping or duplicating a committed outcome. Fixtures may
not provide the expected tail classification as a boolean shortcut.

A corrupt committed generation is never silently truncated or skipped.
Startup fails closed, quarantines the database for operator recovery, and
does not expose command capability. No later generation may bridge a gap.

## 6. Checkpoints and restart

A verified checkpoint contains one generation stamp shared by:

- authoritative world and sleeping-body state;
- next entity ID and every revision;
- active and pending ruleset state;
- per-session sequence cursors;
- the idempotency result index;
- event stream epochs, sent/acknowledged cursors, and retained journal ranges;
- replay/digest/RNG contract versions; and
- world seed and required generation metadata.

The semantic checkpoint requires every named component stamp, the replay,
digest, and RNG contract versions, the world seed, the non-decreasing last
commit time, the build ID, the next stream epoch (or the exhausted `null`
sentinel), and the next global event ordinal. These allocator fields remain
mandatory even when no event is currently retained, so restart cannot reuse a
historical value. Unsigned 64-bit generations are decimal strings when they
exceed JSON's safe integer range.

Checkpoint sequence cursors, idempotency rows, and durable session-result rows
are structurally validated before any suffix is applied. Their composite keys
must use canonical byte identities and unsigned decimal sequences; cursors
must be canonical nonzero unsigned decimal strings or the exhausted `null`
sentinel; digests, result shapes, retention references, and commit times must
be valid and mutually consistent. `last_commit_hour` is mandatory and must be
at least every retained row's commit time. Invalid checkpoint maps fail closed
without partially replacing live state.
When a referenced cross-epoch idempotency row is still retained, the
session-result digest normally matches it. A durable
`IDEMPOTENCY_CONFLICT` or `UNSUPPORTED_MESSAGE` on a reused retained key is an
intentional exception: its session-result digest records the later command
while its key reference retains the original cross-epoch mapping. A
session-result row may outlive that independently expiring key row; checkpoint
validation preserves the session result without requiring the expired row.
When both rows exist, checkpoint and suffix recovery accept exactly the same
exception set.

Recovery selects the newest internally consistent checkpoint, then applies a
contiguous verified committed suffix in ascending generation and ordinal
order. Components from different generation stamps are never combined.
The first suffix generation names the checkpoint generation as
`prior_generation`; every later generation names its immediate predecessor.
Generation numbers may not repeat, decrease, or bridge a gap. Within each
generation, `COMMAND_OUTCOME` frames begin at ordinal zero and are contiguous.
Recovery validates the complete suffix into detached scratch state and swaps
it into service only after every semantic record and RNG audit passes. Failure
cannot expose a partially rebuilt generation. The independently supplied
running build ID must match the checkpoint and every suffix record.
The checksummed outcome payload carries `prior_generation`; an unchecksummed
fixture convenience field cannot authorize a generation link. A successfully
reconstructed suffix remains the committed suffix for a later cold restart,
so repeated recovery from the same checkpoint is idempotent.
Restore, terminal-revision repair, and displacement follow world v1 after the
durable state is reconstructed.

The build ID stored by the checkpoint and suffix must name the replaying
server build. V1 promises deterministic replay only with the same build.
A different build requires an explicit compatible migration or a checkpoint
boundary produced by that build; it may not claim raw-log equivalence.

## 7. Idempotency retention

The durable row for an exact-next command contains its scope, semantic digest,
complete authoritative result, original sequence, commit generation, and
commit time.

It is retained until both are true:

- 24 hours have elapsed from durable commit; and
- no live session epoch still requires its per-sequence result.

The fixed 24-hour interval is the published cross-epoch retry-safe window and
is not refreshed by reads or retries. Within the window, identical semantic
content returns the original result without domain execution. Different
content follows section 2 precedence: unavailable messages retain that
authoritative rejection, and other differing content returns
`IDEMPOTENCY_CONFLICT`. After expiry and live-epoch release, the key may be
treated as unseen; SDKs must not promise safe automatic retry past that
deadline.

Retention uses the persisted non-decreasing commit time. A clock rollback
cannot shorten an already recorded deadline. Commit timestamps and each
committed outcome's `preserve_idempotency` decision are durable replay inputs;
replay consumes those recorded values and never consults current wall time for
a historical decision. Physical cleanup and session-release operations are
derived operational maintenance, not application frames. A cold restart
disconnects all historical session epochs, but it does not retroactively
change a retention decision already recorded in a suffix outcome.
Every checkpoint timestamp covers its retained idempotency rows,
session-result rows, and journal events. Each recovered suffix outcome must
carry a commit time at least as large as the reconstructed durable clock;
recovery rejects a decreasing value instead of preserving the visible clock
while installing an older retention timestamp.

The per-session result row and cross-epoch key index are distinct durable
views. A live epoch retains every result below its current cursor even after
the cross-epoch window elapses. Once that epoch is released and the 24-hour
condition is satisfied, both views may evict the row together.
Every durable use of a retained idempotency key, including a conflicting use,
registers the current live epoch as a retention reference to the original key
mapping. Releasing an epoch removes that reference; age-eligible rows in both
views may then be evicted. Every supplied maintenance clock is a non-negative
safe integer, is clamped to the durable non-decreasing clock, and can never
move that clock backward.

## 8. Ordered-event journal retention

`EventCursor.stream_epoch` is the nonzero unsigned stream identifier. It is
server-issued, globally unique within a world/replay history, and never reused;
a reset allocates a new value. Events are stored per stream in contiguous
sequence order and are never coalesced. Encoded durable event bytes include
their application frame.
The durable allocator is strictly monotonic above every epoch ever issued; it
does not fill gaps. Acknowledgement and resume always carry the complete epoch
and sequence cursor. Between acknowledged-through and greatest-sent, every
sequence is represented exactly once as retained or explicitly unavailable.
Semantic JSON represents epochs, event sequences, acknowledgements, and the
next-epoch allocator as canonical unsigned decimal strings so the full
`uint64` range remains lossless; `null` represents only an exhausted
next-value allocator. After value `2^64 - 1` is allocated, the corresponding
allocator is exhausted; it never wraps or reuses a value, and an operation
requiring another value fails deterministically before durable mutation.
Numeric JSON cursor values are invalid even when they happen to be exactly
representable.
Acknowledgement and resume request fields are validated before an unknown
stream can be created or a server-issued epoch allocated. Missing or malformed
cursors therefore have no durable allocator or journal effect.
A well-formed request for an unknown stream returns `UNKNOWN_STREAM` and has
the same no-allocation property.

The globally monotonic durable event commit ordinal follows the same canonical
decimal-string boundary and `null` exhaustion rule as stream allocators.
Before committing, the writer preflights the complete generation's event count
against remaining ordinal capacity. Ordinal `2^64 - 1` may be allocated once;
an event requiring a later ordinal fails the generation before any sequence,
event, idempotency, or world mutation.
Each durable outcome stores every event's assigned stream epoch, per-stream
sequence, and global commit ordinal alongside its payload, commit time, and
encoded byte size. Recovery verifies those exact values against the checkpoint
allocators and prior suffix events. It never synthesizes missing cursor or
ordinal assignments from a cursor-less event descriptor.
Acknowledged events may be deleted immediately. Unacknowledged events remain
eligible for replay until the first of:

- 24 hours after durable commit;
- retained bytes for that stream exceeding 4,194,304; or
- retained bytes across all streams exceeding 536,870,912.

A journal exactly at a byte limit is within the limit. To restore a limit,
evict whole events by lowest globally monotonic durable event commit ordinal,
then unsigned stream ID, then event sequence. Eviction never removes a newer
event while an older eligible event remains.

For every affected stream, durability records the unavailable inclusive range
through the greatest sequence sent in the old epoch. Resume then follows
protocol v1: replay only when the full missing suffix remains; otherwise emit
`EventStreamReset` and start a new server-issued epoch at sequence 1. Snapshot
recovery does not alter this state.

## 9. Counter-based seeded randomness

The world seed is exactly 32 bytes. Each draw is HMAC-SHA-256 keyed by that
seed over a canonical length-prefixed tuple:

`(rng_contract_version, subsystem, purpose, generation_or_spatial_scope,
canonical_command_index, entity_id_or_zero, draw_index)`.

`rng_contract_version` is unsigned 16-bit value `1`. Strings are
unsigned-32-bit-length-prefixed UTF-8 bytes. The scope begins with one byte:
`0` followed by an unsigned 64-bit durable generation, or `1` followed by
two signed 64-bit two's-complement global sample coordinates `(x, z)`.
Canonical command index and draw index are unsigned 32-bit; entity ID is
unsigned 64-bit. All integers are big-endian. Subsystem and purpose are
non-empty stable identifiers. Terrain generation uses spatial scope. Entity
zero means "not applicable" and is never a real world entity.
Semantic JSON may represent signed spatial coordinates as safe integral
numbers or canonical signed decimal strings; unsafe numeric values are
rejected rather than rounded before HMAC encoding.
Every draw supplies exactly one scope: either an explicit durable generation
or explicit stable spatial coordinates. Missing both or supplying both is
invalid input; v1 never defaults a missing generation to zero.

The 32-byte HMAC output is the raw draw. For a bound in `1..2^64`, let
`limit = floor(2^64 / bound) * bound`. Read the output as four unsigned
64-bit big-endian candidates. The first candidate below `limit` maps to
`candidate mod bound`. If none qualifies, append an unsigned 32-bit
big-endian rejection-block counter to the tuple and derive another HMAC block.
The first appended counter is `1` and each subsequent block increments it by
one; block zero is the base tuple with no appended counter.
Modulo reduction without this rejection is forbidden. Floating results, when
an owning contract permits them, are derived from a published fixed-width
integer mapping rather than host RNG APIs.

Non-admitted commands, rejected branches that do not semantically request
randomness, and semantic no-ops consume no draw. A draw is addressed by its
full tuple, so adding an unrelated draw cannot shift later results. The
generation record stores each requested tuple and output for replay audit.
That audit always stores every derived HMAC block, including the four
unsigned candidates in an accepted block-zero draw and every rejected block.
Before committing a generation, the writer re-derives every supplied audit
from the durable world seed, rejects incomplete or mismatched evidence, and
persists only the derived complete output. This validation occurs before any
sequence, event, idempotency, or world mutation becomes durable.
Each generation-scoped audit's generation must equal the pending generation,
and every audit's canonical command index must equal the owning command's
index in that generation. Spatially scoped audits omit generation but remain
bound to that owning canonical command index.
Replay enforces the same ownership checks, re-derives the HMAC result, and
fails verification when it differs; the stored output is evidence, never a
replacement random source.

## 10. Conformance boundary

The versioned fixture is a semantic persistence oracle, not a SQLite file or
protobuf wire fixture. It uses explicit integer clocks, capacities, encoded
byte counts, crash points, and corruption flags. The evaluator performs no
network, filesystem, database, wall-clock, locale, scheduler, or random work.
`encoded_frame_bytes` is the authoritative complete application-frame size
projected by the future task-004 encoder; the semantic oracle consumes that
projection rather than synthesizing multi-megabyte padding. The committed
semantic frame records the same size, so admission and durable evidence cannot
use different estimates.

For recovery cases, fixture records provide both exact frame fields/bytes and
the decoded semantic `COMMAND_OUTCOME` projection. Exact payload bytes use
lowercase even-length `payload_hex` carrying the generated protobuf encoding of
the durable outcome (see `scripts/replay-command-outcome.mjs`). Declared
length, CRC32C, and `payload_sha256` operate on those decoded bytes, never the
hex text. The decoded projection remains independently bound by
`projection_sha256` over canonical UTF-8 JSON of the semantic projection.
Recovery validates that `payload_hex` decodes as protobuf, that the decoded
durable fields match the wire-representable subset of the supplied semantic
`payload` (RNG audits stay projection-only and empty on the wire), that
re-encoding both the decoded outcome and the supplied projection yields the
same `payload_hex` bytes, then applies the semantic `payload` object
(including projection-only fields). Arbitrary non-UTF-8 frame bytes remain
representable for corruption and integrity vectors but cannot be applied as a
semantic outcome without a successful protobuf decode.
The evaluator independently encodes and validates magic, version, type,
generation, ordinal, declared payload length, payload bytes, and CRC32C before
it may apply that projection to a checkpoint. Supplying the decoded projection
does not authorize expected reconstructed state in fixture input.

Expected output may state trace and final durable state, but may not supply:

- canonical command order;
- admitted prefix;
- semantic digest equality;
- eviction victims or reset ranges;
- crash-tail classification; or
- RNG output/tie selection.

The evaluator derives those outcomes from fixture input. Task-004 owns binary
protobuf round trips; task-003 and task-005 own the product workspace and
runtime implementation. Their behavior must preserve these semantic results.
