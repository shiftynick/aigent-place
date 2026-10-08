# Round 1 bounded admission design challenge

Read-only source review against the frozen task-064 source. No product source edits, target writes, or tests were run. This report is the only write. Recommendation: proceed with the proposed synchronous admission callback and atomic enqueue batch, with the conditions below. This is a bounded fix for the new batching collision and terminal error semantics. It does not finish task-042 or provide durable-before-result delivery.

## Lock order and callback boundary

Acquire `sessions` and then `world` in transport. The callback must be synchronous and receive an already borrowed `&mut World` through its closure. Existing production paths do not nest World and SessionHub locks in either order: drain_fanout samples fanout, sessions and world in distinct blocks (transport.rs:346-369); handshake releases SessionHub before socket/fanout work (772-808); the old apply_world_effect releases SessionHub before World (1164-1171); simulation uses only World (657-680); resync releases World before sockets/fanout (254-283). Existing nested socket paths consistently acquire sockets -> fanout (279-283, 398-402, 513-518, 573-577, 790-794, 927-929). There is therefore no current reverse World -> Sessions edge to form a cycle.

Make Sessions -> World explicit in the new code, and remove the async apply_world_effect helper that reacquires SessionHub. Do not invoke that helper from the callback. Drop both guards before frame encoding/delivery, diagnostics, stamped_arrivals locking, or any socket/fanout operation. The callback must neither await nor run storage or socket I/O. Prefer acquiring Sessions first rather than holding World while awaiting SessionHub, because World is also the simulation-stage lock.

## Classification and cache order

The correct insertion point is the existing novel-key branch after admit_domain_command succeeds and before self.idempotency.insert (session.rs:571-585). Invoke no callback for invalid envelope/features, spectators, stale epochs, below/above cursor classifications, unavailable kinds, invalid decoded payloads, same-epoch replay, cross-epoch replay, or cross-epoch idempotency conflict. These classifications retain their current results and ordering.

Callback Ok retains the admitted Accepted result. Callback domain rejection replaces that result with AuthoritativeResult::Rejected, then follows the same new-key idempotency insertion and sequence-result storage as Ok. In particular, do not route callback rejection through record_exact_rejection: that existing helper stores only the sequence index (599-612), so cross-epoch replay would otherwise attempt the world effect again. Cache digest, kind, key, and rejection together. Same-key/digest/kind retry must replay the original Conflict even after the colliding pending batch disappears; a caller who wants another attempt uses a new sequence/key. The existing cross-epoch lookup then advances the new epoch sequence without invoking the callback (565-570, 589).

Callback fatal close returns before insertion into either index and before sequence advance. A retry must still see the exact-next sequence and a novel key. The callback itself must have made no world mutation on any Err outcome; atomic batch enqueue is what makes this true. Avoid cloning and replacing the entire SessionHub as an ad hoc rollback transaction.

## API and error shape

A crate-private admission enum is clearer than nested Result values: admit, typed rejection(CommandRejectionCode), or closed(AdmissionClosed). An equivalent Result<(), AdmissionFailure> is also clear if AdmissionFailure has explicit Rejected and Closed variants. The public submit_command wrapper uses the same implementation with an always-admit closure; it must retain its CommandOutcome return type and existing conformance behavior. Keep closure inputs borrowed: aigent identity, CommandSubmit, and DecodedCommandPayload. Avoid coupling session.rs to WorldError solely to carry a diagnostic; AdmissionClosed can carry a small internal diagnostic string, or a generic error type if that stays simple. Do not use expect/unwrap on an inhabited fatal error in the public wrapper.

WorldError::DuplicateCommandTuple can map to the existing generic Conflict code 15 (aigent.proto:87). WorldError::TickExhausted maps to internal close with a diagnostic, without PERSISTENCE_UNAVAILABLE. StaleArrivalTick is impossible when reservation and batch validation occur under one World guard; treat it as an internal failure with diagnostics rather than retaining a swallowed retry. Do not map every future WorldError to Conflict. There is no live Rust global persistence-unavailable helper; introducing one is outside this patch.

## Atomic batch and skeleton scope

Use a crate-private enqueue_batch that validates the entire supplied batch against the earliest unstarted tick, all pending keys, and earlier keys in that batch before extending pending. Check duplicate keys within the batch as well as against pending. A failure must leave pending byte-for-byte unchanged. Reservation is a pure tick lookup, not an enqueue mutation. Existing public enqueue can delegate a single-item batch if the error precedence stays earliest-tick/stale validation before duplicate tuple, as today. A two-effect demo batch needs no general transaction engine or persisted-schema change.

Build the optional demo spawn and actual MOVE/STOP/CANCEL effect in memory, then enqueue once. Do not enqueue spawn before constructing/validating the second effect. No available demo spawn slot must produce an explicit Conflict rather than Ok: the existing world contract maps NO_FREE_POSITION to generic Conflict (world/v1/CONTRACT.md:327). Diagnostics should state that this is demo-body placement, not a new physics implementation.

Dispatch kinds explicitly. MOVE plus decoded Move queues movement; STOP/CANCEL plus decoded None queues cancellation. PLACE_OBJECT, SET_SHAPE and UNSTICK remain the existing accepted no-effect skeletons (session.rs:649-651, 671-673). Return Ok for those kinds without allocating a body or adding geometry behavior. Avoid changing them to unsupported-message rejections as incidental cleanup. If the callback is named admission, document that it is local effect admission only, not the complete ADR-0005 durable generation pipeline.

The stamped_arrivals field is optional diagnostic evidence, not a second reservation. Capture an admitted tick in the synchronous closure and append it after dropping both guards, or keep a non-failing sample that never determines admission. Do not call a fallible world admission lookup before role/replay classification. Update the seam test to assert the new combined lock boundary, rather than preserving a now-unused diagnostic parameter.

## Minimum meaningful validation

- The actual stalled-writer E1 MOVE sequence 1 / reconnect E2 STOP sequence 1 with a new key gets correlated Conflict, never Accepted; pending MOVE remains and no partial extra spawn appears. A subsequent eligible STOP must still cancel normally.
- That callback rejection replays in the same epoch and a later epoch with no callback/world re-entry; changed content still gives IdempotencyConflict.
- Fatal admission writes neither cache nor sequence; after a test-controlled admissible state is restored, the same sequence/key can be admitted normally.
- Terminal World state still closes a valid novel mutation without PERSISTENCE_UNAVAILABLE, while spectator classification and cached replay resolve normally.
- A batch whose second element collides with pending, and a batch with an internal duplicate, leaves pending unchanged.
- Existing public SessionHub conformance, busy admission, failed-write retry ordering, and pressure tests remain green.

Do not add durable result queues, journal format changes, global persistence failure state, session cleanup/sleep lifecycle, allocator changes, or implemented geometry commands. Record that this patch resolves the affected admission subset of task-042 while the listen-loop writer lifecycle and durable-before-result debt remain open.
