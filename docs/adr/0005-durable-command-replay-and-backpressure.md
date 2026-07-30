# ADR 0005: Durable command replay and persistence backpressure

**Status:** proposed  
**Date:** 2026-07-29  
**Task:** task-011

## Context and problem statement

The architecture requires a single bounded persistence writer that never
blocks the 20 Hz simulation tick, while also requiring durable commit before
in-memory application, authoritative result delivery, and ordered-event
publication. ADR-0001 additionally requires retry safety across session epochs
and visible ordered-event loss, but deliberately leaves retention periods to
task-011.

Those constraints leave several coupled questions unanswered:

- when a command becomes authoritative if the writer is busy;
- which state changes share one atomic commit;
- how a crash before or after commit is distinguished;
- how long idempotency results and ordered events remain replayable;
- how corrupt committed records are handled; and
- how seeded randomness remains reproducible without depending on incidental
  call order.

The answers affect the public retry contract, the persisted representation,
the protocol schema, and several future server modules. They must be fixed
before the replay and persistence contract is encoded.

## Decision drivers

- A simulation tick must never await storage.
- No accepted result, sequence advance, ID, revision, RNG draw, mutation, or
  event may become authoritative before its durable commit.
- Queue saturation and storage failure must have explicit no-effect outcomes.
- An identical retry within the published window must return the original
  authoritative result, including after restart.
- Ordered-event loss must be visible and bounded on a hobby-scale SQLite
  deployment.
- Same-build replay must not depend on socket scheduling, hash iteration, or
  hidden mutable RNG consumption.
- SQLite WAL is the initial store, but the semantic transaction boundary must
  survive a future repository-backed Postgres port.

## Considered options

1. Block the tick until each write commits. This is simple, but violates the
   fixed-tick and slow-storage isolation requirements.
2. Apply or acknowledge first and persist later. This improves apparent
   latency, but a crash can lose an acknowledged mutation and makes
   idempotent recovery impossible.
3. Permit several speculative dependent generations in flight. This can
   improve write throughput, but one failed generation invalidates every
   dependent generation and substantially complicates rollback and result
   publication.
4. Admit one canonical generation at a time, commit its complete result
   packet atomically, and expose typed transient backpressure before admission.
5. Retain idempotency and events indefinitely, use sliding expiry, or use
   fixed time and byte bounds. Indefinite and sliding policies let clients or
   attackers grow storage without a predictable ceiling.
6. Trust SQLite transactions alone, add versioned application framing inside
   SQLite, or introduce a separate append-only log. A separate log duplicates
   SQLite WAL machinery for v1; SQLite alone does not detect semantic record
   misordering or application-payload corruption.
7. Use mutable per-subsystem PRNG streams or counter-based named draws. Mutable
   streams are fast, but an added draw in one branch shifts every later value.

## Decision

### Canonical admission and durable generations

The network ingress stamps a fully decoded command with the earliest
not-yet-started `arrival_tick`. At that tick, commands are sorted by
`(arrival_tick, aigent_id, sequence)` exactly as required by the architecture.
Duplicate tuples are invalid.

V1 permits at most one uncommitted world generation. A generation is one
canonical tick batch containing at most 4,096 command records and 16 MiB of
encoded durable record bytes. Both limits are checked. The values are
non-votable deployment defaults and may be lowered or raised only within hard
bounds later owned by the workload and constitution contracts; the admission
semantics do not change.

When the writer slot is available, the server admits the longest canonical
prefix that fits both limits. Commands outside that prefix have not entered
the authoritative sequence machine. When the slot is occupied, no command is
admitted.

A non-admitted command receives a correlated transient
`PERSISTENCE_BACKPRESSURE` protocol error with a positive
`retry_after_ticks`. It consumes no sequence, idempotency key, ID, revision,
RNG draw, mutation, or event. The client retries the same sequence and
idempotency key. This is not a `CommandResult`, because an authoritative
command rejection would itself have to be durable. Task-011 will add the
additive protocol error code and retry field.

If a single already frame-valid command cannot fit an empty generation, the
server returns a distinct no-effect `PERSISTENCE_RECORD_TOO_LARGE` protocol
error and closes that command-capable connection. Normal frame limits should
make this unreachable, but the boundary is explicit.

### Atomic commit and publication

One SQLite transaction atomically records:

- the generation number and server build/replay-contract identifiers;
- canonical command metadata and semantic content digest;
- the accepted or rejected authoritative `CommandResult`;
- session sequence advancement and the cross-epoch idempotency mapping;
- every ID/revision allocator change, world mutation, ruleset activation, and
  recovery-generation stamp;
- every ordered event and its stream cursor; and
- every named RNG draw input and output needed to audit replay.

Domain rejections and semantic no-ops are durable command results even when
they contain no world mutation. Tentative IDs, revisions, sequence advances,
and RNG draws are not authoritative allocation and may be reused if the
transaction does not commit.

After writer success, the server installs that committed generation at the
next tick boundary, publishes the immutable world generation, sends
authoritative command results, and then broadcasts its ordered events.
Publication follows canonical command order.

A writer error after admission publishes nothing. The server discards the
failed tentative generation, stops admitting commands, closes
command-capable connections with `PERSISTENCE_UNAVAILABLE`, and continues
read-only spectator service from the last committed generation while recovery
is attempted. It must reload and verify the last committed generation before
command capability resumes.

### Durable framing and crash recovery

Application records inside the SQLite transaction use a versioned frame with
magic bytes, format version, record type, generation-local ordinal, payload
length, payload, and CRC32C. SHA-256 is used separately for canonical semantic
command-content digests; CRC32C is only an accidental-corruption check.

The semantic digest excludes transport-only message ID, session epoch,
sequence, and idempotency key. It covers protocol major, command kind,
selected feature version, and a versioned canonical encoding of the typed
command payload. Available typed payloads are decoded, validated, and
canonically re-encoded before hashing. Unavailable command kinds hash their
exact payload bytes so their recorded `UNSUPPORTED_MESSAGE` result can still
be replayed consistently.

SQLite decides transaction atomicity. An interrupted or uncommitted WAL tail
has no effect and the same sequence/key may retry. A committed generation with
a missing ordinal, invalid length, checksum mismatch, or unknown mandatory
record version fails startup closed and is quarantined for operator recovery;
the server never silently truncates a committed or acknowledged generation.

Recovery loads the newest verified checkpoint and replays the contiguous
committed suffix in generation and ordinal order. A checkpoint, its world
state, allocator state, ruleset state, idempotency index, event cursors, and
RNG contract version share one generation stamp. Mismatched components are
not combined.

Crash outcomes are therefore:

- before commit: no authoritative effect; retry executes normally;
- after commit but before in-memory installation: recovery installs the
  committed generation and retry replays its stored result;
- after installation but before result or event delivery: recovery retains
  the installed state and retry/event resume replays durable output; and
- after a partially written but uncommitted tail: SQLite rollback makes it
  equivalent to pre-commit.

### Retention

Cross-epoch idempotency records retain the complete authoritative result for
24 hours from durable commit and for at least the lifetime of any live session
epoch that references the sequence, whichever is longer. The 24-hour period
is the published retry-safe window. It is fixed, not refreshed by retries.
After the promise expires and no live epoch requires the record, the key may
be treated as unseen.

Unacknowledged ordered events are retained until acknowledged, subject to the
earliest of:

- 24 hours from durable commit;
- 4 MiB of encoded durable event bytes per stream; or
- 512 MiB of encoded durable event bytes across all streams.

Eviction is by lowest durable commit ordinal, then unsigned stream ID, then
event sequence. Every affected stream records the exact unavailable inclusive
range and follows ADR-0001's visible `EventStreamReset` behavior. Events are
never silently dropped or coalesced. Acknowledged events may be removed
immediately.

### Seeded randomness

The world seed is 256 bits. Random values use counter-based HMAC-SHA-256
draws, not mutable implicit streams. The canonical length-prefixed input tuple
contains:

`(rng_contract_version, subsystem, purpose, generation or stable spatial
coordinates, canonical_command_index, entity_id when applicable, draw_index)`.

Integer fields use fixed-width unsigned big-endian encoding; strings use
length-prefixed UTF-8 bytes. Bounded integers use rejection sampling so modulo
bias is not introduced. Rejected and non-admitted branches request no draws.
The replay metadata stores the RNG contract version and server build ID.
Terrain generation uses its stable spatial-coordinate tuple rather than a
generation number.

The minimum promise remains same-build replay. Changing the RNG contract
version or canonical semantic encoding requires an explicit migration or a new
world/replay boundary; a deployment may not reinterpret an existing log.

## Consequences

### Good

- The tick never waits for storage, while clients never observe an undurable
  authoritative result.
- Queue-full, oversize-record, storage-fault, and each crash boundary have
  distinct testable outcomes.
- A single failed write cannot require rollback of already published or later
  speculative generations.
- Retry and event storage have published, deterministic bounds suitable for
  the initial SQLite deployment.
- Counter-based draws isolate unrelated randomness changes and make replay
  differences easier to audit.
- Application framing detects corrupt committed content independently of
  SQLite page integrity.

### Bad

- One uncommitted generation at a time limits durable command throughput and
  may produce transient backpressure when commits exceed one tick.
- The protocol needs additive backpressure, oversize-record, and persistence
  failure surfaces.
- A 24-hour idempotency promise means a much later retry can execute again;
  SDKs must expose the retry-safe deadline clearly.
- Event caps can force a visible stream reset before 24 hours during a burst.
- Checksums, canonical encoding, and HMAC draw tuples add implementation and
  conformance-test complexity.
- Fail-closed corruption handling may require operator intervention even when
  most of the database remains readable.

## Validation

Task-011 must provide versioned executable examples for:

- canonical input permutations and duplicate-order rejection;
- admission at each item/byte boundary and deterministic prefix selection;
- queue occupied, oversize record, and writer failure with no sequence or
  mutation effect;
- success, identical retry, content conflict, and expiry;
- crashes before commit, after commit, after installation, and across an
  uncommitted tail;
- committed ordinal/checksum corruption failing closed;
- per-stream, global, age, and acknowledgement event eviction;
- checkpoint generation mismatch; and
- counter-based draw invariance when unrelated commands or branches change.

The full repository gate must retain the process gate and run these focused
examples. Task-009 must benchmark the one-generation writer against the
published durable-write workload before launch; throughput failure triggers a
new ADR rather than silently weakening durability.

## Follow-up

- Task-011 encodes the accepted contract and semantic fixtures.
- Task-004 adds generated/binary protobuf coverage for the new additive
  protocol fields.
- Task-005 implements the generation pipeline.
- Task-009 benchmarks sustained writer throughput and retention storage.
- Task-013 owns hard configuration bounds and degradation thresholds.
