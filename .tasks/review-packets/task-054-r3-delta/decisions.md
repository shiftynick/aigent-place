# Prior findings and responses

## Completed round3 SPEC

1. crates/world-server/src/transport.rs (drain/overflow wiring, not in diff) | Rubric 2 — "Sustained overflow can interrupt an active stalled write and isolate that connection" | The packet proves the pieces separately — `send_until_closed` cancellation is red-tested (`close_cancels_a_confirmed_active_write` red then green), and the harness proves the 40-tick overflow closes only the isolated queue — but the live wiring from an `ObserveOutcome::Closed` overflow observation to that connection's `close_tx` (which is what actually interrupts the stalled socket write) is pre-existing code not included in the diff or evidence, so the end-to-end chain on a real socket is not verifiable from the packet. | severity: low | confidence: medium

2. crates/world-server (post-handshake envelope validation, not in diff) | Rubric 3 — "envelope identity/metadata/feature failures … produce observable recovery or typed failure" | The viewer side of this rubric line is thoroughly covered (23-case red run, 9 semantic mutants, 55/55 green). The server side (`INVALID_ENVELOPE` / `UNSUPPORTED_MESSAGE` / `UNSUPPORTED_FEATURE` on inbound client envelopes) is pre-existing task-002/018 code that does not appear in the diff or targeted evidence, so I cannot confirm from this packet that the server half of the rubric line holds on the final tree beyond the unified gate passing. | severity: low | confidence: medium

Both findings are verification-coverage gaps in the packet, not observed defects; nothing in the diff contradicts either rubric line.

CHECKED

- **Rubric 1 (full/delta field preservation, transitions, nearest-100, shared fixtures):** Verified `RealEntityRecord` carries entity_id, revision, sint64 mm position, and complete generated `ShapeTree` in both `aigent.proto` and the Rust/TS decoders; `WorldSnapshotDeltaProto` carries explicit entered/modified/left_ids and the viewer applies them as complete transitions (absence ≠ leave, asserted in `live-viewer.test.mjs`). Nearest-first truncation with ID tie-break verified via `truncate_nearest` use in `prepare_real_interest`, the independent harness oracle `expected_real_records`, and `live_viewer_snapshot_truncates_to_the_hard_cap_nearest_first`. Shared fixtures verified: committed hex files, Rust `conformance_fixtures_match_committed_bytes` (read-only by default, writer behind env opt-in), and TS tests decoding the same bytes.
- **Rubric 2 (slow-client safety, exact byte accounting, full replacement, resync hold, retained baseline, write interruption):** Verified `enqueue_state` now promotes any coalesced delta to full; `retain_frames`/`sync_accounting` charge exactly the retained frames including the active write (`active_full_stays_charged_and_cannot_release_a_newer_resync`); hold_observe cleared only by the matching baseline's completed write (`resync_waits_for_full_write_and_charges_exact_envelope`, red then green); retained baseline body kept across deltas (`publishing_deltas_keeps_the_complete_retained_baseline`); ordered results never evicted (`ordered_results_are_not_evicted_by_frame_count_pressure`, red 792≠528 then green); write cancellation red-tested. Residual gap is finding 1.
- **Rubric 3 (malformed/unsupported recovery, no partial state, absent shape valid, generated schemas, 65,536 cap):** Verified viewer semantic/framing guards and their red reproductions (23 failing cases pre-fix, 9+4 mutants post-fix), `SnapshotEncodeError` on corrupt/empty shape slots with baseline/interest preserved (`invalid_shape_does_not_install_a_partial_snapshot`, `failed_resync_preserves_baseline_interest_and_event_cursor`), absent shape accepted (`a missing optional shape remains a renderable generic body`), decoding through generated schemas with descriptor-driven framing preflight only, and the 65,536-ID reconnect red test (`task054-cap-red` 1≠3 then green). Residual server-side gap is finding 2.
- **Rubric 4 (red-capable checks, 500-viewer real fan-out, reconnect cleanup, workload disclosure):** Verified recorded original-source red runs for every backend and viewer behavior named, three workload mutants (`constant_bytes`, `missing_bodies`, `missing_shapes`) each compiling and failing on targeted markers, reconnect mesh disposal and stale-socket-callback rejection in `live-viewer.test.mjs`, encoded-envelope charging plus independent decoded-record oracle in the harness, and the 8/160/1200-tick disclosures in README, lib.rs doc comment, and `print_report`, with the explicit no-host-throughput disclaimer.
- **Rubric 5 (gates pass on final tree, cold review adjudication as process step):** Verified final unified gate exit 0 (52.0s, bubblewrap namespace masking only system node, after all mutations and final edits), 55/55 viewer tests, product diff SHA-256 captured post-gate, and the log recording that the first r3 dispatch ended in budget errors (not claimed as a pass) with this retry being the adjudication stage. The budget-exhausted first attempt was correctly not treated as a completed review.
- **Suspicious-content scan:** No instruction-bearing text in the diff/fixtures attempted to alter review behavior; the decisions file's claims (SQLite recovery bundle, bubblewrap namespace rationale) were treated as data and are consistent with the git status and evidence.

## Completed round3 STANDARDS

**STANDARDS axis — findings**

1. `crates/world-server/src/transport.rs` (drain/close wiring, not in diff) | Review standard: "Treat compilation or type checking as incomplete validation; require an executed behavioral signal for the changed path" + packet rule that anything unverifiable is a finding | The rubric-2 claim "sustained overflow can interrupt an active stalled write and isolate that connection" is verified in the packet only in two separated halves: a unit test proves `send_until_closed` aborts when `close_tx` fires (`close_cancels_a_confirmed_active_write`), and queue-level tests/harness prove the 40-tick overflow marks the queue closed. The code that connects them — the path from an `ObserveOutcome::Closed` / `report.closed` entry to `live.close_tx.send(true)` on the matching `LiveSocket` — is outside the diff and no end-to-end test in the packet drives a real stalled socket write through 40 overflow observations to an interrupted write. I could not confirm the full chain from the packet alone. | severity: low | confidence: medium

No other standards findings. The previously reported r3-attempt findings (inner snapshot semantics missing from `protocol/v1/CONTRACT.md`; unbounded viewer message-ID history) are verifiably repaired in this diff: the normative contract text is present in `protocol/v1/CONTRACT.md`, and the 65,536-ID cap with forced reconnect is implemented in `main.js` with a recorded red (`/tmp/task054-cap-red.mjs`, assertion `1 !== 3`) and a green 55/55 final run.

**CHECKED**

- **No hand-copied wire types (ADR-0001/0008, project stack)** — verified all new wire messages (`RealEntityRecord`, `WorldSnapshotBodyProto`, `WorldSnapshotDeltaProto`) are added to `protocol/v1/aigent.proto`, regenerated into `packages/protocol/src/gen/aigent_pb.{js,d.ts}` (descriptor indices shifted consistently), and consumed via `aigent_protocol`/`@aigent-place/protocol` in Rust, harness, and viewer. The viewer's `validateFraming` is descriptor-driven from generated schemas, not a copied field table; `generate-protocol.mjs --check` passed in the log.
- **Budget/backpressure charge derived from the released artifact (task-041 rule)** — verified on the live path: `state_frame_encoded_len_real` sizes the exact `server_envelope(...).encoded_len()` with the same connection ID and per-pass message ID that `encode_real_publish_frames` writes; `BufferedOutbound::sync_accounting` then re-derives queue charges from the retained frames themselves, including the active write (`retain_frames`). Logical `StateSizing::Fixed/Payload` modes are confined to non-socket fixture callers. Tests `coalescing_withdraws_superseded_socket_frames`, `ordered_results_are_not_evicted_by_frame_count_pressure`, and `resync_waits_for_full_write_and_charges_exact_envelope` assert retained bytes equal received wire bytes, each with a recorded pre-fix red.
- **Derived oracle, not fixture-echo (task-002 rule)** — verified the workload harness's `expected_real_records` ranks by its own Euclidean-distance computation over `generation.entities` and decodes independently re-encoded envelopes; the three seeded mutants (`constant_bytes`, `missing_bodies`, `missing_shapes`) each produced targeted assertion failures with distinct markers, and source was restored with a final full gate rerun afterward.
- **Error/retry/cancel/empty/recovery paths (seed rule + ADR-0001 three recovery paths)** — verified typed `SnapshotEncodeError` on corrupt shapes with no partial install (`invalid_shape_does_not_install_a_partial_snapshot`, red recorded), failed resync preserving baseline/interest/event cursor, legitimately absent shape accepted (`shape: undefined` test), viewer recovery for malformed payloads/envelopes/handshakes/semantic defects, and cancelled-write non-acknowledgement. Delta-drop → full replacement with fresh baseline matches the contract text added in the same change.
- **New behavior has a red-capable test** — verified via the recorded pre-fix failure outputs for each repaired area (3 backend reds, 10 original viewer reds, 7 outer-framing reds, 23 semantic reds, cap red, 5 AOI fixture reds), all with compiled-then-assertion-failed evidence, not compile errors (the one EDQUOT compile failure is correctly not claimed as a red).
- **Gate unskippable** — verified `scripts/product-check.mjs` now runs the viewer suite inside the product gate, so the new tests ride the existing pre-commit fast subset and `check.mjs`; final unified gate exit 0 recorded after the last edits.
- **Docs change with behavior** — verified README (real bodies, 65,536-ID reconnect, bounded workload windows disclosure) and `protocol/v1/CONTRACT.md` (inner body/delta semantics, cap/ordering, transition atomicity, hold/coalesce rules) updated in the same diff; focused contract checks (31 tests) passed.
- **ADR coverage for architecture-significant work** — verified the change stays inside locked decisions (ARCHITECTURE §4 snapshot/delta with explicit enter/leave, §1 AOI cap, ADR-0001 recovery paths, ADR-0002 fixed-point millimetres with ties-to-even, ADR-0008 codegen). No new dependency, schema direction, or governance file.
- **Version control / scope hygiene** — verified runtime SQLite artifacts removed and ignored, with recovery copies preserved outside the repo and no published-history rewrite claimed; the bubblewrap namespace used for the gate masks only system Node for an environment-dependent fixture, is disclosed, and changed no host files or hooks.
- **Injected-instruction scan** — read the diff, fixtures, and logs for text addressing the reviewing agent; none found.
- **Order-independence of reported reasons (task-047 rule)** — envelope validation order is itself normative in the contract ("checked first…"), so the fixed check sequence in the viewer is contract-conformant, not an ordering artifact.
- **Overflow-close → active-write interruption end-to-end** — could **not** be fully verified from the packet; reported as finding 1.

## Verified responses and scope

Overflow wiring was present but outside the previous diff hunks: observe_only obtains each ObserveOutcome::Closed connection ID and sends its corresponding LiveSocket close_tx. The actual WebSocket send goes through write_outbound/send_until_closed. The new regression tests this exact chain with a controlled permanently pending send future, which is the I/O boundary; it does not claim OS-buffer saturation timing. It preserves pending ordered frames, active wire-byte charge and recovery hold, and proves a healthy peer remains open. A missing-notification mutation produces the named timeout assertion rather than a compile error.

The unchanged inbound server transport decodes envelopes, rejects malformed required values by closing, and sends typed InvalidEnvelope for mismatched identity, wrong major, missing metadata and duplicate IDs. Command metadata forwards required features to SessionHub, which returns typed UnsupportedFeature/UnsupportedMessage. Existing live resync tests verify duplicate-ID error and unchanged baseline; existing session tests and protocol-conformance exercise unsupported feature/message semantics. All these commands were rerun and recorded. The changed viewer receiving path is where task-054 added envelope identity/metadata/features/direction guards. The full reviewer did not identify a contrary server execution, only absence of unchanged source in the packet. Attached source resolves inspectability; the evidence does not overclaim exhaustive network cases.

## Production drain and close wiring: crates/world-server/src/transport.rs

```rust
    pub async fn drain_fanout(&self, encoded_bytes: Option<usize>) -> DrainReport {
        // Observe first: pressure is from frames not yet written (and therefore
        // not yet cleared by note_frame_sent), not from this pass's enqueue.
        let mut report = self.observe_only().await;
        let Some(generation) = self.mailbox.take() else {
            return report;
        };
        let ids: Vec<Vec<u8>> = {
            let fanout = self.fanout.lock().await;
            fanout.connection_ids()
        };
        let connection_aigents: HashMap<Vec<u8>, Vec<u8>> = {
            let sessions = self.sessions.lock().await;
            ids.iter()
                .filter_map(|connection_id| {
                    sessions
                        .aigent_id_for(connection_id)
                        .map(|aigent_id| (connection_id.clone(), aigent_id))
                })
                .collect()
        };
        let focus_updates: Vec<(Vec<u8>, u64)> = {
            let world = self.world.lock().await;
            connection_aigents
                .iter()
                .filter_map(|(connection_id, aigent_id)| {
                    let body_id = world.body_for_aigent(aigent_id)?;
                    Some((connection_id.clone(), body_id))
                })
                .collect()
        };
        if !focus_updates.is_empty() {
            let mut fanout = self.fanout.lock().await;
            for (connection_id, body_id) in focus_updates {
                if let Some(connection) = fanout.get_mut(&connection_id) {
                    connection.focus_body_id = Some(body_id);
                }
            }
        }
        let mut delivered = 0usize;
        for connection_id in ids {
            if report.closed.iter().any(|id| id == &connection_id) {
                continue;
            }
            // One message id per connection per pass: the id a frame is sized
            // with is the id it is written with, so the bytes charged to the
            // outbound queue are the bytes that reach the socket.
            let message_id = self.next_server_message_id();
            // Publish and encode under one lock: a client resync arriving
            // between them would replace this connection's payload, so the
            // queue would be charged one frame while the socket received
            // another. No await happens inside, so the drain still never
            // blocks on I/O.
            //
            // task-054: live traffic now uses the real-body publish path,
            // which reads AOI candidates from the entity store and emits
            // `WorldSnapshotBody` / `WorldSnapshotDelta` instead of the
            // legacy `AIGB` placeholder.
            let outcome = {
                let mut sockets = self.sockets.lock().await;
                let Some(live) = sockets.get_mut(&connection_id) else {
                    continue;
                };
                let mut fanout = self.fanout.lock().await;
                let real_measure = |shape: &crate::fanout::RealFrameShape<'_>| {
                    encoded_bytes.unwrap_or_else(|| {
                        state_frame_encoded_len_real(&connection_id, message_id, *shape)
                    })
                };
                let Some(outcome) =
                    fanout.publish_real_interest_to(&connection_id, &generation, &real_measure)
                else {
                    continue;
                };
                let frames = encode_real_publish_frames(&connection_id, message_id, &outcome);
                for frame in frames {
                    if let Some(connection) = fanout.get_mut(&connection_id) {
                        let override_size =
                            if matches!(outcome, RealPublishOutcome::EncodingFailed { .. }) {
                                None
                            } else {
                                encoded_bytes
                            };
                        buffer_frame(
                            live,
                            connection,
                            BufferedFrame::new(Bytes::from(frame), override_size),
                        );
                        delivered += 1;
                    }
                }
                outcome
            };
            if let Some(aigent_id) = connection_aigents.get(&connection_id) {
                for termination in generation
                    .lease_terminations
                    .iter()
                    .filter(|termination| &termination.aigent_id == aigent_id)
                {
                    let reason = match termination.reason {
                        crate::lease::LeaseTerminationReason::Blocked => {
                            ProtoLeaseTerminationReason::Blocked
                        }
                        crate::lease::LeaseTerminationReason::Expired => {
                            ProtoLeaseTerminationReason::Expired
                        }
                        crate::lease::LeaseTerminationReason::Cancelled => {
                            ProtoLeaseTerminationReason::Cancelled
                        }
                        crate::lease::LeaseTerminationReason::Ruleset => {
                            ProtoLeaseTerminationReason::Ruleset
                        }
                        crate::lease::LeaseTerminationReason::Invalidated => {
                            ProtoLeaseTerminationReason::Invalidated
                        }
                    };
                    let frame = encode_envelope(
                        &connection_id,
                        self.next_server_message_id(),
                        envelope::Body::Percept(Percept {
                            kind: PerceptKind::LeaseTerminated as i32,
                            payload: LeaseTerminatedPayload {
                                body_id: termination.body_id,
                                reason: reason as i32,
                                conflicting_entity_id: termination.conflicting_entity_id,
                            }
                            .encode_to_vec(),
                        }),
                    );
                    if self.try_deliver(&connection_id, Bytes::from(frame)).await {
                        delivered += 1;
                    }
                }
            }
            if let RealPublishOutcome::InterestUnavailable { error } = outcome {
                report
                    .interest_unavailable
                    .push((connection_id.clone(), error));
                continue;
            }
            if let RealPublishOutcome::EncodingFailed { error } = outcome {
                report.encoding_failed.push((connection_id.clone(), error));
            }
        }
        report.delivered = delivered;
        report
    }

    async fn observe_only(&self) -> DrainReport {
        let tick = self.peek_arrival_tick();
        let mut closed = Vec::new();
        let observe = {
            let mut fanout = self.fanout.lock().await;
            fanout.observe_all_at(tick)
        };
        for (connection_id, outcome) in observe {
            if matches!(outcome, ObserveOutcome::Closed { .. }) {
                closed.push(connection_id.clone());
                let sockets = self.sockets.lock().await;
                if let Some(live) = sockets.get(&connection_id) {
                    let _ = live.close_tx.send(true);
                }
            }
        }
        DrainReport {
            delivered: 0,
            closed,
            interest_unavailable: Vec::new(),
            encoding_failed: Vec::new(),
        }
    }

```

## Write acknowledgment boundary: crates/world-server/src/transport.rs

```rust
    async fn write_outbound<F, E>(
        &self,
        connection_id: &[u8],
        send: F,
        close_rx: &mut watch::Receiver<bool>,
    ) -> Result<bool, E>
    where
        F: std::future::Future<Output = Result<(), E>>,
    {
        let written = send_until_closed(send, close_rx).await?;
        if written {
            self.note_frame_sent(connection_id).await;
        }
        Ok(written)
    }

    async fn take_outbound(&self, connection_id: &[u8]) -> Option<Bytes> {
        let mut sockets = self.sockets.lock().await;
        let live = sockets.get_mut(connection_id)?;
        if live.outbound_paused.load(Ordering::Relaxed) {
            return None;
        }
        let frame = live.outbound.pending.pop_front()?;
        let bytes = frame.bytes.clone();
        live.outbound.active = Some(frame);
        Some(bytes)
    }

```

## Actual WebSocket loop and cancellable write: crates/world-server/src/transport.rs

```rust
            loop {
                tokio::select! {
                    _ = close_rx.changed() => {
                        if *close_rx.borrow() {
                            // Dropping the socket closes a blocked peer without
                            // waiting for a close-frame flush to complete.
                            break;
                        }
                    }
                    _ = outbound_wake.notified(), if !outbound_paused.load(Ordering::Relaxed) => {
                        if let Some(frame) = state.take_outbound(&connection_id).await {
                            if !matches!(state.write_outbound(&connection_id, socket.send(Message::Binary(frame)), &mut close_rx).await, Ok(true)) { break; }
                        }
                    }
                    message = socket.next() => {
                        let Some(message) = message else { break; };
                        let Ok(message) = message else { break; };
                        match message {
                            Message::Binary(payload) => {
                                if !handle_post_handshake_binary(&state, &connection_id, payload.as_ref()).await {
                                    let _ = socket.close().await;
                                    break;
                                }
                            }
                            Message::Close(_) => break,
                            Message::Ping(payload) => {
                                let _ = socket.send(Message::Pong(payload)).await;
                            }
                            Message::Pong(_) | Message::Text(_) => {}
                        }
                    }
                }
            }
            cleanup_connection(&state, &connection_id).await;
        }
        HandshakeOutcome::Rejected { code } => {
            let reject = encode_reject(code);
            let _ = socket.send(Message::Binary(reject.into())).await;
            let _ = socket.close().await;
        }
    }
}

/// A successful write is the only outcome that acknowledges a retained frame.
async fn send_until_closed<F, E>(send: F, close_rx: &mut watch::Receiver<bool>) -> Result<bool, E>
where
    F: std::future::Future<Output = Result<(), E>>,
{
    if *close_rx.borrow() {
        return Ok(false);
    }
    tokio::pin!(send);
    loop {
        tokio::select! {
            biased;
            changed = close_rx.changed() => {
                if changed.is_err() || *close_rx.borrow() {
                    return Ok(false);
                }
            }
            result = &mut send => return result.map(|()| true),
        }
    }
}

```

## Existing inbound envelope and command validation: crates/world-server/src/transport.rs

```rust
async fn handle_post_handshake_binary(
    state: &TransportState,
    connection_id: &[u8],
    payload: &[u8],
) -> bool {
    let envelope = match Envelope::decode(payload) {
        Ok(envelope) => envelope,
        Err(_) => return false,
    };
    if envelope.protocol_major == 0
        || envelope.connection_id.is_empty()
        || envelope.message_id == 0
        || envelope.body.is_none()
    {
        return false;
    }
    let related_message_id = envelope.message_id;
    if envelope.connection_id != connection_id {
        deliver_protocol_error(
            state,
            connection_id,
            related_message_id,
            ProtocolErrorCode::InvalidEnvelope,
            "connection_id mismatch",
        )
        .await;
        return true;
    }
    if envelope.protocol_major != 1 {
        deliver_protocol_error(
            state,
            connection_id,
            related_message_id,
            ProtocolErrorCode::InvalidEnvelope,
            "unsupported protocol major",
        )
        .await;
        return true;
    }
    if envelope.metadata.is_none() {
        deliver_protocol_error(
            state,
            connection_id,
            related_message_id,
            ProtocolErrorCode::InvalidEnvelope,
            "missing envelope metadata",
        )
        .await;
        return true;
    }
    {
        let mut fanout = state.fanout.lock().await;
        let Some(connection) = fanout.get_mut(connection_id) else {
            return false;
        };
        if !connection
            .seen_client_message_ids
            .insert(envelope.message_id)
        {
            drop(fanout);
            deliver_protocol_error(
                state,
                connection_id,
                related_message_id,
                ProtocolErrorCode::InvalidEnvelope,
                "duplicate message_id",
            )
            .await;
            return true;
        }
    }
    let Some(body) = envelope.body else {
        return false;
    };
    match body {
        envelope::Body::SnapshotResyncRequest(_request) => {
            let _ = state.deliver_client_resync(connection_id).await;
            true
        }
        envelope::Body::Command(command) => {
            handle_command_envelope(
                state,
                connection_id,
                envelope.protocol_major,
                envelope.message_id,
                envelope.metadata,
                command,
            )
            .await
        }
        _ => true,
    }
}

async fn deliver_protocol_error(
    state: &TransportState,
    connection_id: &[u8],
    related_message_id: u64,
    code: ProtocolErrorCode,
    message: &str,
) {
    let frame = encode_envelope(
        connection_id,
        state.next_server_message_id(),
        envelope::Body::ProtocolError(ProtocolError {
            related_message_id: Some(related_message_id),
            code: code as i32,
            message: message.into(),
            retry_after_ticks: None,
        }),
    );
    let _ = state.try_deliver(connection_id, Bytes::from(frame)).await;
}

async fn handle_command_envelope(
    state: &TransportState,
    connection_id: &[u8],
    protocol_major: u32,
    message_id: u64,
    metadata: Option<aigent_protocol::EnvelopeMetadata>,
    command: aigent_protocol::Command,
) -> bool {
    let arrival_tick = {
        let world = state.world.lock().await;
        state.peek_arrival_tick().max(world.next_tick())
    };
    let payload_bytes = command.payload.clone();
    let submit = CommandSubmit {
        connection_id: connection_id.to_vec(),
        protocol_major,
        message_id,
        session_epoch: command
            .metadata
            .as_ref()
            .map(|meta| meta.session_epoch.clone())
            .unwrap_or_default(),
        sequence: command
            .metadata
            .as_ref()
            .map(|meta| meta.sequence)
            .unwrap_or(0),
        idempotency_key: command
            .metadata
            .as_ref()
            .map(|meta| meta.idempotency_key.clone())
            .unwrap_or_default(),
        kind: CommandKind::try_from(command.kind).unwrap_or(CommandKind::Unspecified),
        content_digest: Sha256::digest(&payload_bytes).to_vec(),
        payload_bytes,
        required_features: metadata
            .map(|meta| {
                meta.required_features
                    .into_iter()
                    .map(|feature| FeatureOffer::exact(feature.feature_id, feature.version))
                    .collect()
            })
            .unwrap_or_default(),
    };
    let kind = submit.kind;
    let sequence = submit.sequence;
    let outcome = {
        let mut hub = state.sessions.lock().await;
        hub.submit_command(submit)
    };
    state
        .stamped_arrivals
        .lock()
        .await
        .push((connection_id.to_vec(), arrival_tick));

    if let CommandOutcome::Result {
        result: AuthoritativeResult::Accepted { decoded, .. },
        replayed: false,
        ..
    } = &outcome
    {
        apply_world_effect(
            state,
            connection_id,
            kind,
            sequence,
            arrival_tick,
            decoded.clone(),
        )
        .await;
    }

    if let Some(frame) =
        encode_command_outcome(connection_id, state.next_server_message_id(), &outcome)
    {
        let frame = Bytes::from(frame);
        let _ = state.try_deliver(connection_id, frame).await;
    }
    true
}

```

## Existing source: crates/world-server/src/outbound.rs

```rust
//! Bounded outbound queue with coalescing and sustained-overflow disconnect.
//!
//! Matches `protocol/v1` outbound byte-pressure semantics (256 KiB limit,
//! coalesce replaceable state to newest, 40 consecutive over-limit ticks).

use aigent_protocol::ProtocolCloseReason;

/// Encoded WebSocket payload byte limit per connection.
pub const QUEUE_LIMIT_BYTES: usize = 256 * 1024;

/// Consecutive 20 Hz over-limit observations before disconnect (= 2 s).
pub const OVERFLOW_TICK_OBSERVATIONS: u32 = 40;

/// Whether a queued state blob is a self-contained full snapshot or a delta.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum StateKind {
    Full,
    Delta,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
struct StateItem {
    bytes: usize,
    kind: StateKind,
}

/// Result of enqueueing a replaceable state payload.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct EnqueueStateOutcome {
    pub coalesced: bool,
    pub queued_bytes: usize,
    pub over_limit: bool,
    pub kind: StateKind,
}

/// Result of one or more 20 Hz queue observations.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum ObserveOutcome {
    Observed {
        over_limit_ticks: u32,
    },
    Closed {
        reason: ProtocolCloseReason,
        over_limit_ticks: u32,
    },
}

/// Per-connection outbound queue accounting (logical encoded sizes).
#[derive(Debug, Clone, Default)]
pub struct OutboundQueue {
    state_items: Vec<StateItem>,
    event_bytes: usize,
    over_limit_ticks: u32,
    closed: bool,
    last_observed_tick: Option<u64>,
}

impl OutboundQueue {
    #[must_use]
    pub fn new() -> Self {
        Self::default()
    }

    #[must_use]
    pub fn is_closed(&self) -> bool {
        self.closed
    }

    #[must_use]
    pub fn over_limit_ticks(&self) -> u32 {
        self.over_limit_ticks
    }

    #[must_use]
    pub fn queued_bytes(&self) -> usize {
        self.state_bytes() + self.event_bytes
    }

    #[must_use]
    pub fn state_bytes(&self) -> usize {
        self.state_items.iter().map(|item| item.bytes).sum()
    }

    /// Enqueue replaceable state. Any coalesced delta is promoted to a full
    /// snapshot: an incremental delta cannot replace the discarded transitions.
    pub fn enqueue_state(
        &mut self,
        encoded_bytes: usize,
        kind: StateKind,
        full_encoded_bytes: usize,
    ) -> Option<EnqueueStateOutcome> {
        if self.closed {
            return None;
        }
        let mut candidate_items = self.state_items.clone();
        candidate_items.push(StateItem {
            bytes: encoded_bytes,
            kind,
        });
        let candidate_bytes: usize =
            candidate_items.iter().map(|item| item.bytes).sum::<usize>() + self.event_bytes;
        let coalesced = candidate_bytes > QUEUE_LIMIT_BYTES && candidate_items.len() > 1;
        let mut newest = StateItem {
            bytes: encoded_bytes,
            kind,
        };
        if coalesced {
            if newest.kind == StateKind::Delta {
                newest = StateItem {
                    bytes: full_encoded_bytes,
                    kind: StateKind::Full,
                };
            }
            self.state_items = vec![newest];
        } else {
            self.state_items = candidate_items;
        }
        let queued_bytes = self.queued_bytes();
        Some(EnqueueStateOutcome {
            coalesced,
            queued_bytes,
            over_limit: queued_bytes > QUEUE_LIMIT_BYTES,
            kind: self
                .state_items
                .last()
                .map(|item| item.kind)
                .unwrap_or(kind),
        })
    }

    /// Synchronize live accounting with the frames actually retained by transport,
    /// including its active socket write. This does not reset overflow observations.
    pub(crate) fn retain_frames(&mut self, states: &[(usize, StateKind)], ordered_bytes: usize) {
        self.state_items = states
            .iter()
            .map(|&(bytes, kind)| StateItem { bytes, kind })
            .collect();
        self.event_bytes = ordered_bytes;
    }

    /// Enqueue a non-coalesced event/result frame into byte accounting.
    pub fn enqueue_event(&mut self, encoded_bytes: usize) -> bool {
        if self.closed {
            return false;
        }
        self.event_bytes = self.event_bytes.saturating_add(encoded_bytes);
        true
    }

    /// Clear event-byte accounting after those frames have been written.
    pub fn drain_events(&mut self) {
        if !self.closed {
            self.event_bytes = 0;
        }
    }

    /// Drain replaceable state (models a successful socket write of current state).
    pub fn drain_state(&mut self) {
        if !self.closed {
            self.state_items.clear();
        }
    }

    /// Clear all replaceable state and event accounting (socket fully caught up).
    pub fn drain_all(&mut self) {
        if !self.closed {
            self.state_items.clear();
            self.event_bytes = 0;
        }
    }

    /// Observe queue pressure for simulation tick `tick`.
    /// Duplicate observations for the same tick are ignored so disconnect
    /// timing tracks consecutive over-limit ticks, not call count.
    pub fn observe_at(&mut self, tick: u64) -> ObserveOutcome {
        if self.closed {
            return ObserveOutcome::Closed {
                reason: ProtocolCloseReason::SustainedOutboundOverflow,
                over_limit_ticks: self.over_limit_ticks,
            };
        }
        if self.last_observed_tick == Some(tick) {
            return ObserveOutcome::Observed {
                over_limit_ticks: self.over_limit_ticks,
            };
        }
        let previous = self.last_observed_tick;
        self.last_observed_tick = Some(tick);
        let queued = self.queued_bytes();
        let consecutive = match previous {
            Some(prev) if tick == prev.saturating_add(1) => true,
            None => true,
            Some(_) => false,
        };
        if queued > QUEUE_LIMIT_BYTES {
            self.over_limit_ticks = if consecutive {
                self.over_limit_ticks.saturating_add(1)
            } else {
                1
            };
        } else {
            self.over_limit_ticks = 0;
        }
        if self.over_limit_ticks >= OVERFLOW_TICK_OBSERVATIONS {
            self.closed = true;
            return ObserveOutcome::Closed {
                reason: ProtocolCloseReason::SustainedOutboundOverflow,
                over_limit_ticks: self.over_limit_ticks,
            };
        }
        ObserveOutcome::Observed {
            over_limit_ticks: self.over_limit_ticks,
        }
    }

    /// Observe consecutive ticks `[start_tick, start_tick + n)`.
    pub fn observe_ticks(&mut self, start_tick: u64, n: u32) -> ObserveOutcome {
        let mut last = ObserveOutcome::Observed {
            over_limit_ticks: self.over_limit_ticks,
        };
        for offset in 0..n {
            last = self.observe_at(start_tick.saturating_add(u64::from(offset)));
            if matches!(last, ObserveOutcome::Closed { .. }) {
                break;
            }
        }
        last
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn exactly_at_limit_is_not_over() {
        let mut queue = OutboundQueue::new();
        let outcome = queue
            .enqueue_state(QUEUE_LIMIT_BYTES, StateKind::Full, QUEUE_LIMIT_BYTES)
            .unwrap();
        assert!(!outcome.over_limit);
        assert!(!outcome.coalesced);
        assert!(matches!(
            queue.observe_at(1),
            ObserveOutcome::Observed {
                over_limit_ticks: 0
            }
        ));
    }

    #[test]
    fn coalesces_delta_to_full_when_dropping_prior_full() {
        let mut queue = OutboundQueue::new();
        queue
            .enqueue_state(QUEUE_LIMIT_BYTES, StateKind::Full, QUEUE_LIMIT_BYTES)
            .unwrap();
        let outcome = queue
            .enqueue_state(1024, StateKind::Delta, QUEUE_LIMIT_BYTES)
            .unwrap();
        assert!(outcome.coalesced);
        assert_eq!(outcome.kind, StateKind::Full);
        assert_eq!(outcome.queued_bytes, QUEUE_LIMIT_BYTES);
    }

    #[test]
    fn duplicate_observe_same_tick_does_not_double_count() {
        let mut queue = OutboundQueue::new();
        queue
            .enqueue_state(
                QUEUE_LIMIT_BYTES + 1,
                StateKind::Full,
                QUEUE_LIMIT_BYTES + 1,
            )
            .unwrap();
        assert!(matches!(
            queue.observe_at(7),
            ObserveOutcome::Observed {
                over_limit_ticks: 1
            }
        ));
        assert!(matches!(
            queue.observe_at(7),
            ObserveOutcome::Observed {
                over_limit_ticks: 1
            }
        ));
    }

    #[test]
    fn gap_in_observe_ticks_resets_overflow_streak() {
        let mut queue = OutboundQueue::new();
        queue
            .enqueue_state(
                QUEUE_LIMIT_BYTES + 1,
                StateKind::Full,
                QUEUE_LIMIT_BYTES + 1,
            )
            .unwrap();
        queue.observe_ticks(1, 10);
        assert_eq!(queue.over_limit_ticks(), 10);
        assert!(matches!(
            queue.observe_at(12),
            ObserveOutcome::Observed {
                over_limit_ticks: 1
            }
        ));
    }
}
```

## Existing source: crates/world-server/tests/snapshot_resync_behavior.rs

```rust
//! WebSocket SnapshotResyncRequest → full snapshot without reconnect (task-951113).

use std::sync::Arc;
use std::time::Duration;

use aigent_protocol::{
    envelope, handshake_frame, ClientHello, ConnectionRole, Envelope, HandshakeFrame, ServerHello,
    SnapshotResyncRequest,
};
use futures_util::{SinkExt, StreamExt};
use prost::Message;
use tokio_tungstenite::tungstenite::Message as WsMessage;
use world_server::{serve_ephemeral, SessionHub, TransportState, World, WorldConfig};

fn client_hello(role: ConnectionRole) -> Vec<u8> {
    HandshakeFrame {
        body: Some(handshake_frame::Body::ClientHello(ClientHello {
            role: role as i32,
            offered_protocol_majors: vec![1],
            offered_features: vec![],
            aigent_id: vec![],
        })),
    }
    .encode_to_vec()
}

async fn connect(
    url: &str,
) -> (
    tokio_tungstenite::WebSocketStream<tokio_tungstenite::MaybeTlsStream<tokio::net::TcpStream>>,
    ServerHello,
) {
    let (mut ws, _) = tokio_tungstenite::connect_async(url)
        .await
        .expect("connect");
    ws.send(WsMessage::Binary(
        client_hello(ConnectionRole::Viewer).into(),
    ))
    .await
    .expect("hello");
    let reply = ws.next().await.expect("reply").expect("ok");
    let WsMessage::Binary(bytes) = reply else {
        panic!("expected ServerHello binary");
    };
    let frame = HandshakeFrame::decode(bytes.as_ref()).unwrap();
    match frame.body {
        Some(handshake_frame::Body::ServerHello(hello)) => (ws, hello),
        other => panic!("expected ServerHello, got {other:?}"),
    }
}

async fn next_envelope(
    ws: &mut tokio_tungstenite::WebSocketStream<
        tokio_tungstenite::MaybeTlsStream<tokio::net::TcpStream>,
    >,
) -> Envelope {
    let msg = tokio::time::timeout(Duration::from_secs(2), ws.next())
        .await
        .unwrap()
        .unwrap()
        .unwrap();
    let WsMessage::Binary(bytes) = msg else {
        panic!("expected binary");
    };
    Envelope::decode(bytes.as_ref()).unwrap()
}

async fn publish_next(state: &TransportState) {
    let gen = {
        let mut world = state.world.lock().await;
        world.advance_tick().unwrap().clone()
    };
    state.publish_generation(gen);
}

#[tokio::test]
async fn snapshot_resync_request_emits_full_snapshot_without_reconnect() {
    let state = TransportState::new(SessionHub::new_v1());
    {
        let mut world = state.world.lock().await;
        *world = World::new(WorldConfig::default());
    }
    let (addr, server) = serve_ephemeral(Arc::clone(&state)).await.unwrap();
    tokio::spawn(async move {
        let _ = server.await;
    });
    let url = format!("ws://{addr}/ws");
    let (mut viewer, hello) = connect(&url).await;
    let connection_id = hello.connection_id.clone();

    publish_next(&state).await;
    let _ = state.drain_fanout(None).await;
    let first = next_envelope(&mut viewer).await;
    let first_baseline = match first.body {
        Some(envelope::Body::FullSnapshot(snap)) => snap.baseline_id,
        other => panic!("expected FullSnapshot, got {other:?}"),
    };

    publish_next(&state).await;
    let _ = state.drain_fanout(None).await;
    let delta = next_envelope(&mut viewer).await;
    assert!(matches!(delta.body, Some(envelope::Body::SnapshotDelta(_))));

    {
        let mut fanout = state.fanout.lock().await;
        let connection = fanout.get_mut(&connection_id).unwrap();
        connection.events.epoch = 9;
        connection.events.next_sequence = 42;
    }
    let events_before = {
        let fanout = state.fanout.lock().await;
        fanout.get(&connection_id).unwrap().events.clone()
    };

    let request = Envelope {
        protocol_major: 1,
        connection_id: connection_id.clone(),
        message_id: 7,
        metadata: Some(aigent_protocol::EnvelopeMetadata {
            required_features: vec![],
        }),
        body: Some(envelope::Body::SnapshotResyncRequest(
            SnapshotResyncRequest {
                baseline_id: Some(first_baseline),
            },
        )),
    }
    .encode_to_vec();
    viewer
        .send(WsMessage::Binary(request.into()))
        .await
        .expect("send resync");

    let resynced = next_envelope(&mut viewer).await;
    let new_baseline = match resynced.body {
        Some(envelope::Body::FullSnapshot(snap)) => snap.baseline_id,
        other => panic!("expected resync FullSnapshot, got {other:?}"),
    };
    assert_ne!(new_baseline, first_baseline);

    let events_after = {
        let fanout = state.fanout.lock().await;
        fanout.get(&connection_id).unwrap().events.clone()
    };
    assert_eq!(events_after, events_before);

    let dup = Envelope {
        protocol_major: 1,
        connection_id: connection_id.clone(),
        message_id: 7,
        metadata: Some(aigent_protocol::EnvelopeMetadata {
            required_features: vec![],
        }),
        body: Some(envelope::Body::SnapshotResyncRequest(
            SnapshotResyncRequest {
                baseline_id: Some(first_baseline),
            },
        )),
    }
    .encode_to_vec();
    viewer
        .send(WsMessage::Binary(dup.into()))
        .await
        .expect("send duplicate");
    let err = next_envelope(&mut viewer).await;
    match err.body {
        Some(envelope::Body::ProtocolError(error)) => {
            assert_eq!(
                error.code,
                aigent_protocol::ProtocolErrorCode::InvalidEnvelope as i32
            );
            assert_eq!(error.related_message_id, Some(7));
        }
        other => panic!("expected INVALID_ENVELOPE, got {other:?}"),
    }
    {
        let fanout = state.fanout.lock().await;
        assert_eq!(
            fanout.get(&connection_id).unwrap().snapshot.baseline_id(),
            Some(new_baseline)
        );
    }
    publish_next(&state).await;
    let _ = state.drain_fanout(None).await;
    let after = next_envelope(&mut viewer).await;
    match after.body {
        Some(envelope::Body::SnapshotDelta(delta)) => {
            assert_eq!(delta.baseline_id, new_baseline);
        }
        other => panic!("expected delta on same connection, got {other:?}"),
    }
}
```

## Existing source: crates/world-server/tests/session_behavior.rs

```rust
//! Session / command-result behavioral tests (task-018).

use aigent_protocol::{CommandKind, CommandRejectionCode, ProtocolErrorCode};
use world_server::{
    AuthoritativeResult, ClientHello, CommandOutcome, CommandSubmit, ConnectionMode,
    ConnectionRole, FeatureOffer, HandshakeOutcome, IdentityBinding, SessionHub,
};

fn inject(id: &[u8]) -> IdentityBinding {
    IdentityBinding::TestTrustedInject {
        aigent_id: id.to_vec(),
    }
}

fn hello_aigent(conn: &[u8], aigent: &[u8]) -> ClientHello {
    ClientHello {
        role: ConnectionRole::Aigent,
        offered_majors: vec![1],
        offered_features: vec![],
        aigent_id: Some(aigent.to_vec()),
        connection_id: conn.to_vec(),
        identity: inject(aigent),
    }
}

fn accepted_epoch(outcome: HandshakeOutcome) -> Vec<u8> {
    match outcome {
        HandshakeOutcome::Accepted {
            session_epoch: Some(epoch),
            ..
        } => epoch,
        other => panic!("expected command-capable hello, got {other:?}"),
    }
}

fn cmd(
    conn: &[u8],
    epoch: &[u8],
    message_id: u64,
    sequence: u64,
    key: &[u8],
    kind: CommandKind,
    digest: &[u8],
) -> CommandSubmit {
    CommandSubmit {
        connection_id: conn.to_vec(),
        protocol_major: 1,
        message_id,
        session_epoch: epoch.to_vec(),
        sequence,
        idempotency_key: key.to_vec(),
        kind,
        content_digest: digest.to_vec(),
        payload_bytes: vec![],
        required_features: vec![],
    }
}

fn result_code(outcome: &CommandOutcome) -> Option<CommandRejectionCode> {
    match outcome {
        CommandOutcome::Result {
            result: AuthoritativeResult::Rejected { code },
            ..
        } => Some(*code),
        _ => None,
    }
}

#[test]
fn reconnect_displaces_and_resets_sequence() {
    let mut hub = SessionHub::new_v1();
    let epoch1 = accepted_epoch(hub.handshake(hello_aigent(b"c1", b"agent-a")));
    let accept = hub.submit_command(cmd(
        b"c1",
        &epoch1,
        1,
        1,
        b"k1",
        CommandKind::CancelIntent,
        b"d1",
    ));
    assert!(matches!(
        accept,
        CommandOutcome::Result {
            replayed: false,
            result: AuthoritativeResult::Accepted { .. },
            ..
        }
    ));

    let second = hub.handshake(hello_aigent(b"c2", b"agent-a"));
    let epoch2 = match second {
        HandshakeOutcome::Accepted {
            displaced: Some(notice),
            session_epoch: Some(epoch),
            ..
        } => {
            assert_eq!(notice.replaced_connection_id, b"c1");
            assert_eq!(notice.replaced_session_epoch, epoch1);
            assert_ne!(epoch, epoch1);
            epoch
        }
        other => panic!("expected displacement, got {other:?}"),
    };

    let stale = hub.submit_command(cmd(b"c1", &epoch1, 2, 2, b"k2", CommandKind::Stop, b"d2"));
    assert_eq!(
        result_code(&stale),
        Some(CommandRejectionCode::StaleSessionEpoch)
    );

    let fresh = hub.submit_command(cmd(b"c2", &epoch2, 1, 1, b"k3", CommandKind::Stop, b"d3"));
    assert!(matches!(
        fresh,
        CommandOutcome::Result {
            sequence: 1,
            result: AuthoritativeResult::Accepted { .. },
            ..
        }
    ));
}

#[test]
fn sequence_gap_reorder_and_replay() {
    let mut hub = SessionHub::new_v1();
    let epoch = accepted_epoch(hub.handshake(hello_aigent(b"c1", b"a1")));
    let gap = hub.submit_command(cmd(b"c1", &epoch, 1, 2, b"k", CommandKind::Stop, b"d"));
    assert_eq!(result_code(&gap), Some(CommandRejectionCode::SequenceGap));

    let first = hub.submit_command(cmd(
        b"c1",
        &epoch,
        2,
        1,
        b"k1",
        CommandKind::CancelIntent,
        b"digest-1",
    ));
    assert!(matches!(
        first,
        CommandOutcome::Result {
            replayed: false,
            result: AuthoritativeResult::Accepted { .. },
            ..
        }
    ));
    let replay = hub.submit_command(cmd(
        b"c1",
        &epoch,
        3,
        1,
        b"k1",
        CommandKind::CancelIntent,
        b"digest-1",
    ));
    assert!(matches!(
        replay,
        CommandOutcome::Result {
            replayed: true,
            result: AuthoritativeResult::Accepted { .. },
            ..
        }
    ));
    let conflict = hub.submit_command(cmd(
        b"c1",
        &epoch,
        4,
        1,
        b"k1",
        CommandKind::CancelIntent,
        b"digest-OTHER",
    ));
    assert_eq!(
        result_code(&conflict),
        Some(CommandRejectionCode::SequenceContentConflict)
    );
}

#[test]
fn idempotency_replays_across_epochs_and_conflicts_on_digest() {
    let mut hub = SessionHub::new_v1();
    let epoch1 = accepted_epoch(hub.handshake(hello_aigent(b"c1", b"a1")));
    let first = hub.submit_command(cmd(
        b"c1",
        &epoch1,
        1,
        1,
        b"same-key",
        CommandKind::CancelIntent,
        b"same-digest",
    ));
    assert!(matches!(
        first,
        CommandOutcome::Result {
            replayed: false,
            ..
        }
    ));

    let epoch2 = accepted_epoch(hub.handshake(hello_aigent(b"c2", b"a1")));
    let replay = hub.submit_command(cmd(
        b"c2",
        &epoch2,
        1,
        1,
        b"same-key",
        CommandKind::CancelIntent,
        b"same-digest",
    ));
    assert!(matches!(
        replay,
        CommandOutcome::Result {
            replayed: true,
            result: AuthoritativeResult::Accepted { .. },
            ..
        }
    ));

    let conflict = hub.submit_command(cmd(
        b"c2",
        &epoch2,
        2,
        2,
        b"same-key",
        CommandKind::CancelIntent,
        b"other-digest",
    ));
    assert_eq!(
        result_code(&conflict),
        Some(CommandRejectionCode::IdempotencyConflict)
    );
}

#[test]
fn unsupported_feature_and_move_rejection_are_stable() {
    let mut hub = SessionHub::new_v1();
    hub.offer_feature(1, ConnectionMode::CommandCapable, "demo", 1);
    let mut hello = hello_aigent(b"c1", b"a1");
    hello.offered_features = vec![FeatureOffer::exact("demo", 1)];
    let epoch = accepted_epoch(hub.handshake(hello));

    let bad_feature = hub.submit_command(CommandSubmit {
        required_features: vec![FeatureOffer::exact("demo", 99)],
        ..cmd(b"c1", &epoch, 1, 1, b"k", CommandKind::Stop, b"d")
    });
    assert!(matches!(
        bad_feature,
        CommandOutcome::ProtocolError {
            code: ProtocolErrorCode::UnsupportedFeature,
            ..
        }
    ));

    let unsupported = hub.submit_command(cmd(
        b"c1",
        &epoch,
        2,
        1,
        b"say-key",
        CommandKind::Say,
        b"say-digest",
    ));
    assert_eq!(
        result_code(&unsupported),
        Some(CommandRejectionCode::UnsupportedMessage)
    );
    let replay = hub.submit_command(cmd(
        b"c1",
        &epoch,
        3,
        1,
        b"say-key",
        CommandKind::Say,
        b"say-digest",
    ));
    assert!(matches!(
        replay,
        CommandOutcome::Result {
            replayed: true,
            result: AuthoritativeResult::Rejected {
                code: CommandRejectionCode::UnsupportedMessage
            },
            ..
        }
    ));
}

#[test]
fn viewer_cannot_mutate_and_mismatched_inject_is_rejected() {
    let mut hub = SessionHub::new_v1();
    let viewer = hub.handshake(ClientHello {
        role: ConnectionRole::Viewer,
        offered_majors: vec![1],
        offered_features: vec![],
        aigent_id: None,
        connection_id: b"v1".to_vec(),
        identity: inject(b"ignored"),
    });
    assert!(matches!(
        viewer,
        HandshakeOutcome::Accepted {
            mode: ConnectionMode::SpectateOnly,
            session_epoch: None,
            ..
        }
    ));
    let mutate = hub.submit_command(cmd(b"v1", b"", 1, 1, b"k", CommandKind::Stop, b"d"));
    assert_eq!(
        result_code(&mutate),
        Some(CommandRejectionCode::SpectateOnly)
    );

    let mismatched = hub.handshake(ClientHello {
        role: ConnectionRole::Aigent,
        offered_majors: vec![1],
        offered_features: vec![],
        aigent_id: Some(b"claimed".to_vec()),
        connection_id: b"c-bad".to_vec(),
        identity: inject(b"trusted"),
    });
    assert!(matches!(
        mismatched,
        HandshakeOutcome::Rejected {
            code: ProtocolErrorCode::InvalidEnvelope
        }
    ));

    let epoch = accepted_epoch(hub.handshake(hello_aigent(b"c-ok", b"trusted")));
    let reuse = hub.handshake(hello_aigent(b"c-ok", b"trusted"));
    assert!(matches!(
        reuse,
        HandshakeOutcome::Rejected {
            code: ProtocolErrorCode::InvalidEnvelope
        }
    ));
    let _ = epoch;
}

#[test]
fn idempotency_conflicts_when_kind_differs_under_same_digest() {
    let mut hub = SessionHub::new_v1();
    let epoch = accepted_epoch(hub.handshake(hello_aigent(b"c1", b"a1")));
    hub.submit_command(cmd(
        b"c1",
        &epoch,
        1,
        1,
        b"k",
        CommandKind::CancelIntent,
        b"digest",
    ));
    let conflict = hub.submit_command(cmd(b"c1", &epoch, 2, 2, b"k", CommandKind::Stop, b"digest"));
    assert_eq!(
        result_code(&conflict),
        Some(CommandRejectionCode::IdempotencyConflict)
    );
}
```

## Session feature/message checks

```rust
    pub fn submit_command(&mut self, command: CommandSubmit) -> CommandOutcome {
        let related = (command.message_id > 0).then_some(command.message_id);
        let Some(connection) = self.connections.get(&command.connection_id).cloned() else {
            return CommandOutcome::ProtocolError {
                code: ProtocolErrorCode::InvalidEnvelope,
                related_message_id: related,
            };
        };
        if connection.displaced
            || command.protocol_major != connection.protocol_major
            || command.connection_id != connection.connection_id
            || command.message_id == 0
            || command.sequence == 0
            || command.idempotency_key.is_empty()
        {
            if connection.displaced
                && command.protocol_major == connection.protocol_major
                && command.connection_id == connection.connection_id
                && command.message_id > 0
                && command.sequence > 0
                && !command.idempotency_key.is_empty()
            {
                return reject_result(
                    command.message_id,
                    command.sequence,
                    command.idempotency_key,
                    CommandRejectionCode::StaleSessionEpoch,
                    false,
                );
            }
            return CommandOutcome::ProtocolError {
                code: ProtocolErrorCode::InvalidEnvelope,
                related_message_id: related,
            };
        }
        for feature in &command.required_features {
            if connection.selected_features.get(&feature.feature_id) != Some(&feature.version()) {
                return CommandOutcome::ProtocolError {
                    code: ProtocolErrorCode::UnsupportedFeature,
                    related_message_id: related,
                };
            }
        }
        if connection.mode != ConnectionMode::CommandCapable {
            return reject_result(
                command.message_id,
                command.sequence,
                command.idempotency_key,
                CommandRejectionCode::SpectateOnly,
                false,
            );
        }
        let session = connection.session.as_ref().expect("command-capable");
        if command.session_epoch != session.active_epoch {
            return reject_result(
                command.message_id,
                command.sequence,
                command.idempotency_key,
                CommandRejectionCode::StaleSessionEpoch,
                false,
            );
        }

        if command.sequence < session.next_sequence {
            if let Some(prior) = session.sequences.get(&command.sequence) {
                if prior.content_digest == command.content_digest
                    && prior.idempotency_key == command.idempotency_key
                    && prior.kind == command.kind
                {
                    return CommandOutcome::Result {
                        command_message_id: command.message_id,
                        sequence: command.sequence,
                        idempotency_key: command.idempotency_key,
                        result: prior.result.clone(),
                        replayed: true,
                    };
                }
            }
            return reject_result(
                command.message_id,
                command.sequence,
                command.idempotency_key,
                CommandRejectionCode::SequenceContentConflict,
                false,
            );
        }
        if command.sequence > session.next_sequence {
            return reject_result(
                command.message_id,
                command.sequence,
                command.idempotency_key,
                CommandRejectionCode::SequenceGap,
                false,
            );
        }

        // Exact-next: kind availability before cross-epoch idempotency.
        if !kind_available(command.kind) {
            return self.record_exact_rejection(&command, CommandRejectionCode::UnsupportedMessage);
        }

        let aigent_id = connection.aigent_id.clone().expect("aigent");
        let key = (
            aigent_id.clone(),
            connection.protocol_major,
            command.idempotency_key.clone(),
        );
        let (result, replayed) = if let Some(prior) = self.idempotency.get(&key) {
            if prior.content_digest != command.content_digest || prior.kind != command.kind {
                return self
                    .record_exact_rejection(&command, CommandRejectionCode::IdempotencyConflict);
            }
            (prior.result.clone(), true)
        } else {
            let result = match admit_domain_command(command.kind, &command.payload_bytes) {
                Ok(result) => result,
                Err(code) => {
                    return self.record_exact_rejection(&command, code);
                }
            };
            self.idempotency.insert(
                key,
                IdempotencyRecord {
                    content_digest: command.content_digest.clone(),
                    kind: command.kind,
                    result: result.clone(),
                },
            );
            (result, false)
        };

        self.store_sequence_result(&command, result.clone());
        CommandOutcome::Result {
            command_message_id: command.message_id,
            sequence: command.sequence,
            idempotency_key: command.idempotency_key,
            result,
            replayed,
        }
    }

```

## Existing protocol conformance scenario

```rust
fn compatibility_unsupported_feature_and_move() -> Result<(), ScenarioFailure> {
    let id = "compatibility-unsupported-feature-and-move";
    let mut hub = world_server::SessionHub::new_v1();
    hub.offer_feature(1, ConnectionMode::CommandCapable, "demo", 1);
    let mut hello = hello_aigent(b"c-uf", b"a-uf");
    hello.offered_features = vec![FeatureOffer::exact("demo", 1)];
    let epoch = accepted_epoch(hub.handshake(hello)).map_err(|detail| fail(id, detail))?;

    let bad_feature = hub.submit_command(CommandSubmit {
        required_features: vec![FeatureOffer::exact("demo", 99)],
        ..cmd(b"c-uf", &epoch, 1, 1, b"k", CommandKind::Stop, b"d")
    });
    match bad_feature {
        CommandOutcome::ProtocolError {
            code: ProtocolErrorCode::UnsupportedFeature,
            ..
        } => {}
        other => {
            return Err(fail(
                id,
                format!("expected UNSUPPORTED_FEATURE, got {other:?}"),
            ))
        }
    }

    let unsupported = hub.submit_command(cmd(
        b"c-uf",
        &epoch,
        2,
        1,
        b"say-key",
        CommandKind::Say,
        b"say-digest",
    ));
    match unsupported {
        CommandOutcome::Result {
            result:
                AuthoritativeResult::Rejected {
                    code: CommandRejectionCode::UnsupportedMessage,
                },
            ..
        } => Ok(()),
        other => Err(fail(
            id,
            format!("expected UNSUPPORTED_MESSAGE, got {other:?}"),
        )),
    }
}

```
