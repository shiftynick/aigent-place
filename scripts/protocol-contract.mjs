import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const QUEUE_LIMIT_BYTES = 256 * 1024;
export const OVERFLOW_TICK_OBSERVATIONS = 40;

function clone(value) {
  return structuredClone(value);
}

function compareCodeUnits(left, right) {
  return left < right ? -1 : left > right ? 1 : 0;
}

function sortedUniquePositiveIntegers(values, label) {
  if (!Array.isArray(values) || values.length === 0) {
    throw new Error(`${label} must be a non-empty array`);
  }
  const unique = new Set(values);
  if (
    unique.size !== values.length ||
    values.some((value) => !Number.isSafeInteger(value) || value <= 0)
  ) {
    throw new Error(`${label} must contain unique positive integers`);
  }
  return [...unique].sort((left, right) => right - left);
}

function normalizedState(initial) {
  const state = {
    compatibility: clone(initial.compatibility ?? []),
    features: clone(initial.features ?? {}),
    connection: clone(initial.connection ?? null),
    session: clone(
      initial.session ?? {
        active_epoch: null,
        next_sequence: 1,
        sequences: {},
      },
    ),
    closed: initial.closed ?? false,
    idempotency: clone(initial.idempotency ?? {}),
    queue: {
        state_bytes: 0,
        state_items: [],
        event_bytes: 0,
        over_limit_ticks: 0,
        ...clone(initial.queue ?? {}),
    },
    event_stream: {
        epoch: "event-epoch-1",
        expected_sequence: 1,
        highest_sent_sequence: 0,
        last_ack: 0,
        status: "live",
        journal: [],
        ...clone(initial.event_stream ?? {}),
    },
    snapshot: {
        baseline_id: null,
        retained_baselines: [],
        status: "live",
        ...clone(initial.snapshot ?? {}),
    },
  };
  if (
    state.queue.state_items.length === 0 &&
    state.queue.state_bytes > 0
  ) {
    state.queue.state_items = [state.queue.state_bytes];
  }
  return state;
}

function selectFeatures(serverFeatures, offers) {
  const selected = [];
  const offeredIds = new Set();
  for (const offer of offers ?? []) {
    if (offeredIds.has(offer.feature_id)) {
      throw new Error(`duplicate feature offer: ${offer.feature_id}`);
    }
    offeredIds.add(offer.feature_id);
    const offered = sortedUniquePositiveIntegers(
      offer.supported_versions,
      `feature ${offer.feature_id} versions`,
    );
    if (!Object.hasOwn(serverFeatures, offer.feature_id)) {
      continue;
    }
    const supported = new Set(serverFeatures[offer.feature_id]);
    const selectedVersion = offered.find((version) => supported.has(version));
    if (selectedVersion !== undefined) {
      selected.push({
        feature_id: offer.feature_id,
        version: selectedVersion,
      });
    }
  }
  return selected.sort((left, right) =>
    compareCodeUnits(left.feature_id, right.feature_id),
  );
}

function handshake(state, step) {
  if (!state.compatibility.every(compatibilityRecordValid)) {
    throw new Error("invalid compatibility registry");
  }
  if (state.connection && step.new_connection !== true) {
    return {
      state,
      outputs: [
        {
          type: "protocol_error",
          code: "invalid_envelope",
          effect: "none",
        },
      ],
    };
  }
  let offeredMajors;
  try {
    offeredMajors = sortedUniquePositiveIntegers(
      step.offered_majors,
      "offered_majors",
    );
  } catch {
    return {
      state,
      outputs: [
        { type: "handshake_rejected", code: "invalid_envelope" },
      ],
    };
  }
  if (step.role !== "aigent" && step.role !== "viewer") {
    return {
      state,
      outputs: [
        { type: "handshake_rejected", code: "invalid_envelope" },
      ],
    };
  }
  if (
    (step.role === "aigent" && !step.aigent_id) ||
    (step.role === "viewer" && step.aigent_id)
  ) {
    return {
      state,
      outputs: [
        { type: "handshake_rejected", code: "invalid_envelope" },
      ],
    };
  }
  const offeredSet = new Set(offeredMajors);
  const commandMajor = state.compatibility
    .filter(
      (record) =>
        offeredSet.has(record.major) &&
        record.command_capable === true &&
        record.decoder === true &&
        (!record.deprecated_at_unix_ms ||
          (Number.isSafeInteger(step.evaluation_time_unix_ms) &&
            step.evaluation_time_unix_ms <=
              record.command_support_until_unix_ms)),
    )
    .sort((left, right) => right.major - left.major)[0];
  const retiredMajor = state.compatibility
    .filter(
      (record) =>
        offeredSet.has(record.major) &&
        record.decoder === true &&
        record.spectator_projection === true &&
        record.deprecated_at_unix_ms > 0 &&
        Number.isSafeInteger(step.evaluation_time_unix_ms) &&
        step.evaluation_time_unix_ms >=
          record.command_support_until_unix_ms,
    )
    .sort((left, right) => right.major - left.major)[0];
  const selected = commandMajor ?? retiredMajor;

  if (!selected) {
    return {
      state,
      outputs: [
        {
          type: "handshake_rejected",
          code: "unsupported_protocol",
        },
      ],
    };
  }

  const mode =
    commandMajor && step.role === "aigent"
      ? "command_capable"
      : "spectate_only";
  if (
    typeof step.connection_id !== "string" ||
    step.connection_id.length === 0 ||
    (mode === "command_capable" &&
      (typeof step.session_epoch !== "string" ||
        step.session_epoch.length === 0))
  ) {
    return {
      state,
      outputs: [
        { type: "handshake_rejected", code: "invalid_envelope" },
      ],
    };
  }
  const availableFeatures =
    state.features?.[String(selected.major)]?.[mode] ?? {};
  let features;
  try {
    features = selectFeatures(availableFeatures, step.offered_features);
  } catch {
    return {
      state,
      outputs: [
        { type: "handshake_rejected", code: "invalid_envelope" },
      ],
    };
  }
  const output = {
    type: "handshake_accepted",
    mode,
    protocol_major: selected.major,
    connection_id: step.connection_id,
    features,
  };
  if (mode === "command_capable") {
    output.session_epoch = step.session_epoch;
  }
  if (!commandMajor) {
    output.notice = "upgrade_required";
  }
  if (commandMajor && commandMajor.deprecated_at_unix_ms > 0) {
    output.deprecation_notice = {
      deprecated_at_unix_ms: commandMajor.deprecated_at_unix_ms,
      command_support_until_unix_ms:
        commandMajor.command_support_until_unix_ms,
    };
  }
  state.connection = {
    mode,
    protocol_major: selected.major,
    role: step.role,
    connection_id: step.connection_id,
    aigent_id: step.role === "aigent" ? step.aigent_id : null,
    selected_features: Object.fromEntries(
      features.map(({ feature_id, version }) => [feature_id, version]),
    ),
  };
  const previousEpoch = state.session.active_epoch;
  if (mode === "command_capable") {
    state.session = {
      active_epoch: step.session_epoch,
      next_sequence: 1,
      sequences: {},
    };
  }
  return {
    state,
    outputs: [
      output,
      ...(previousEpoch && mode === "command_capable"
        ? [
            {
              type: "connection_displaced",
              replaced_session_epoch: previousEpoch,
            },
          ]
        : []),
    ],
  };
}

function sixCalendarMonthsAfter(timestamp) {
  const date = new Date(timestamp);
  if (!Number.isFinite(date.valueOf())) {
    return Number.NaN;
  }
  const day = date.getUTCDate();
  const result = new Date(date.valueOf());
  result.setUTCDate(1);
  result.setUTCMonth(result.getUTCMonth() + 6);
  const lastDay = new Date(
    Date.UTC(result.getUTCFullYear(), result.getUTCMonth() + 1, 0),
  ).getUTCDate();
  result.setUTCDate(Math.min(day, lastDay));
  return result.valueOf();
}

function compatibilityRecordValid(record) {
  if (!record.deprecated_at_unix_ms) {
    return record.command_capable === true;
  }
  return (
    Number.isSafeInteger(record.command_support_until_unix_ms) &&
    record.command_support_until_unix_ms >=
      sixCalendarMonthsAfter(record.deprecated_at_unix_ms)
  );
}

function idempotencyRecord(state, aigentId, major, key) {
  return state.idempotency?.[aigentId]?.[String(major)]?.[key];
}

function setIdempotencyRecord(state, aigentId, major, key, record) {
  state.idempotency[aigentId] ??= {};
  state.idempotency[aigentId][String(major)] ??= {};
  state.idempotency[aigentId][String(major)][key] = record;
}

function authoritativeResultValid(result) {
  if (!result || typeof result.accepted !== "boolean") {
    return false;
  }
  if (!result.accepted) {
    return typeof result.code === "string" && result.code.length > 0;
  }
  return (
    Array.isArray(result.affected_entities) &&
    result.affected_entities.every(
      (entity) =>
        typeof entity.entity_id === "string" &&
        entity.entity_id.length > 0 &&
        Number.isSafeInteger(entity.revision) &&
        entity.revision > 0,
    )
  );
}

function command(state, step) {
  const reject = (code) => ({
    state,
    outputs: [
      {
        type: "command_rejected",
        code,
        command_message_id: step.message_id,
        sequence: step.sequence,
        idempotency_key: step.idempotency_key,
      },
    ],
  });
  const protocolError = (code) => ({
    state,
    outputs: [
      {
        type: "protocol_error",
        code,
        related_message_id:
          Number.isSafeInteger(step.message_id) && step.message_id > 0
            ? step.message_id
            : null,
        effect: "none",
      },
    ],
  });
  const recordExactRejection = (code) => {
    const result = { accepted: false, code };
    state.session.sequences[String(step.sequence)] = {
      content_digest: step.content_digest,
      idempotency_key: step.idempotency_key,
      result: clone(result),
    };
    state.session.next_sequence += 1;
    return {
      state,
      outputs: [
        {
          type: "command_rejected",
          code,
          command_message_id: step.message_id,
          sequence: step.sequence,
          idempotency_key: step.idempotency_key,
        },
      ],
    };
  };
  if (
    !state.connection ||
    step.protocol_major !== state.connection.protocol_major ||
    step.connection_id !== state.connection.connection_id ||
    !Number.isSafeInteger(step.message_id) ||
    step.message_id <= 0 ||
    !Number.isSafeInteger(step.sequence) ||
    step.sequence <= 0 ||
    typeof step.idempotency_key !== "string" ||
    step.idempotency_key.length === 0 ||
    typeof step.kind !== "string"
  ) {
    return protocolError("invalid_envelope");
  }
  if (state.connection.mode !== "command_capable") {
    return reject("spectate_only");
  }
  if (step.session_epoch !== state.session.active_epoch) {
    return reject("stale_session_epoch");
  }

  const priorSequence = state.session.sequences[String(step.sequence)];
  if (step.sequence < state.session.next_sequence) {
    if (
      priorSequence?.content_digest === step.content_digest &&
      priorSequence?.idempotency_key === step.idempotency_key
    ) {
      return {
        state,
        outputs: [
          {
            type: "command_result_replayed",
            command_message_id: step.message_id,
            sequence: step.sequence,
            idempotency_key: step.idempotency_key,
            result: clone(priorSequence.result),
          },
        ],
      };
    }
    return reject("sequence_content_conflict");
  }
  if (step.sequence > state.session.next_sequence) {
    return reject("sequence_gap");
  }
  if (step.kind !== "cancel_intent" && step.kind !== "stop") {
    return recordExactRejection("unsupported_message");
  }

  const priorKey = idempotencyRecord(
    state,
    state.connection.aigent_id,
    state.connection.protocol_major,
    step.idempotency_key,
  );
  let result;
  let type;
  if (priorKey) {
    if (priorKey.content_digest !== step.content_digest) {
      return recordExactRejection("idempotency_conflict");
    }
    result = clone(priorKey.result);
    type = "command_result_replayed";
  } else {
    if (!authoritativeResultValid(step.result)) {
      return protocolError("invalid_envelope");
    }
    result = clone(step.result);
    type = "command_result";
    setIdempotencyRecord(
      state,
      state.connection.aigent_id,
      state.connection.protocol_major,
      step.idempotency_key,
      {
        content_digest: step.content_digest,
        result: clone(result),
      },
    );
  }

  state.session.sequences[String(step.sequence)] = {
    content_digest: step.content_digest,
    idempotency_key: step.idempotency_key,
    result: clone(result),
  };
  state.session.next_sequence += 1;
  return {
    state,
    outputs: [
      {
        type,
        command_message_id: step.message_id,
        sequence: step.sequence,
        idempotency_key: step.idempotency_key,
        result,
      },
    ],
  };
}

export function transition(previousState, step) {
  const state = clone(previousState);

  if (state.closed) {
    throw new Error("fixture attempted a transition after connection close");
  }

  switch (step.op) {
    case "validate_compatibility":
      return {
        state,
        outputs: [
          {
            type: "compatibility_policy",
            valid: state.compatibility.every(compatibilityRecordValid),
          },
        ],
      };
    case "handshake":
      return handshake(state, step);
    case "decode_failure": {
      const reason =
        step.encoded_bytes > step.frame_limit_bytes
          ? "frame_too_large"
          : "undecodable_frame";
      state.closed = true;
      return {
        state,
        outputs: [
          {
            type: "connection_closed",
            reason,
          },
        ],
      };
    }
    case "envelope": {
      const requiredFieldsValid =
        Number.isSafeInteger(step.protocol_major) &&
        step.protocol_major > 0 &&
        step.protocol_major === state.connection?.protocol_major &&
        typeof step.connection_id === "string" &&
        step.connection_id.length > 0 &&
        step.connection_id === state.connection?.connection_id &&
        Number.isSafeInteger(step.message_id) &&
        step.message_id > 0 &&
        typeof step.body === "string";
      const clientBodies = new Set([
        "command",
        "snapshot_resync_request",
        "event_acknowledgement",
        "event_resume_request",
      ]);
      const serverBodies = new Set([
        "command_result",
        "protocol_error",
        "percept",
        "full_snapshot",
        "snapshot_delta",
        "snapshot_resync_required",
        "ordered_event",
        "event_resync_required",
        "event_stream_reset",
        "connection_displaced",
      ]);
      const legalBodies =
        step.direction === "client_to_server"
          ? clientBodies
          : step.direction === "server_to_client"
            ? serverBodies
            : null;
      let code = null;
      if (!requiredFieldsValid || !legalBodies?.has(step.body)) {
        code = "invalid_envelope";
      } else if (step.available === false) {
        code = "unsupported_message";
      } else {
        const selected = state.connection?.selected_features ?? {};
        const unsupported = (step.required_features ?? []).some(
          ({ feature_id, version }) => selected[feature_id] !== version,
        );
        if (unsupported) {
          code = "unsupported_feature";
        }
      }
      return {
        state,
        outputs: code
          ? [
              {
                type: "protocol_error",
                code,
                related_message_id:
                  Number.isSafeInteger(step.message_id) &&
                  step.message_id > 0
                    ? step.message_id
                    : null,
                effect: "none",
              },
            ]
          : [{ type: "envelope_accepted", body: step.body }],
      };
    }
    case "command":
      return command(state, step);
    case "enqueue_state": {
      state.queue.state_items ??= state.queue.state_bytes > 0
        ? [state.queue.state_bytes]
        : [];
      const candidateItems = [...state.queue.state_items, step.encoded_bytes];
      const candidateBytes =
        candidateItems.reduce((total, size) => total + size, 0) +
        state.queue.event_bytes;
      const coalesced =
        candidateBytes > QUEUE_LIMIT_BYTES &&
        candidateItems.length > 1;
      state.queue.state_items = coalesced
        ? [step.encoded_bytes]
        : candidateItems;
      state.queue.state_bytes = state.queue.state_items.reduce(
        (total, size) => total + size,
        0,
      );
      const queuedBytes = state.queue.state_bytes + state.queue.event_bytes;
      return {
        state,
        outputs: [
          {
            type: coalesced ? "state_coalesced" : "state_enqueued",
            queued_bytes: queuedBytes,
            over_limit: queuedBytes > QUEUE_LIMIT_BYTES,
          },
        ],
      };
    }
    case "observe_queue": {
      const observations = step.observations ?? 1;
      const queuedBytes = state.queue.state_bytes + state.queue.event_bytes;
      for (let index = 0; index < observations; index += 1) {
        state.queue.over_limit_ticks =
          queuedBytes > QUEUE_LIMIT_BYTES
            ? state.queue.over_limit_ticks + 1
            : 0;
        if (state.queue.over_limit_ticks >= OVERFLOW_TICK_OBSERVATIONS) {
          state.closed = true;
          break;
        }
      }
      return {
        state,
        outputs: [
          state.closed
            ? {
                type: "connection_closed",
                reason: "sustained_outbound_overflow",
                over_limit_ticks: state.queue.over_limit_ticks,
              }
            : {
                type: "queue_observed",
                over_limit_ticks: state.queue.over_limit_ticks,
              },
        ],
      };
    }
    case "enqueue_event": {
      state.queue.state_items ??= state.queue.state_bytes > 0
        ? [state.queue.state_bytes]
        : [];
      let queuedBytes =
        state.queue.state_bytes +
        state.queue.event_bytes +
        step.encoded_bytes;
      let stateCoalesced = false;
      if (
        queuedBytes > QUEUE_LIMIT_BYTES &&
        state.queue.state_items.length > 1
      ) {
        const latestState =
          state.queue.state_items[state.queue.state_items.length - 1];
        state.queue.state_items = [latestState];
        state.queue.state_bytes = latestState;
        queuedBytes =
          state.queue.state_bytes +
          state.queue.event_bytes +
          step.encoded_bytes;
        stateCoalesced = true;
      }
      if (queuedBytes > QUEUE_LIMIT_BYTES) {
        state.event_stream.journal.push({
          sequence: step.sequence,
        });
        state.event_stream.status = "event_resync_required";
        return {
          state,
          outputs: [
            {
              type: "event_resync_required",
              reason: "event_not_admitted",
              state_coalesced: stateCoalesced,
            },
          ],
        };
      }
      state.queue.event_bytes += step.encoded_bytes;
      state.event_stream.journal.push({
        sequence: step.sequence,
      });
      state.event_stream.highest_sent_sequence = Math.max(
        state.event_stream.highest_sent_sequence,
        step.sequence,
      );
      return {
        state,
        outputs: [
          {
            type: "event_enqueued",
            queued_event_bytes: state.queue.event_bytes,
            state_coalesced: stateCoalesced,
          },
        ],
      };
    }
    case "acknowledge_event":
      if (
        step.stream_epoch !== state.event_stream.epoch ||
        step.sequence > state.event_stream.highest_sent_sequence
      ) {
        return {
          state,
          outputs: [
            {
              type: "protocol_error",
              code: "invalid_envelope",
              related_message_id: step.message_id ?? null,
              effect: "none",
            },
          ],
        };
      }
      if (step.sequence <= state.event_stream.last_ack) {
        return {
          state,
          outputs: [
            {
              type: "event_acknowledgement_ignored",
              sequence: step.sequence,
            },
          ],
        };
      }
      state.event_stream.last_ack = step.sequence;
      state.event_stream.journal = state.event_stream.journal.filter(
        (event) => event.sequence > step.sequence,
      );
      return {
        state,
        outputs: [{ type: "events_acknowledged", sequence: step.sequence }],
      };
    case "receive_event":
      if (step.stream_epoch !== state.event_stream.epoch) {
        state.event_stream.status = "event_resync_required";
        return {
          state,
          outputs: [
            {
              type: "event_resync_required",
              reason: "epoch_mismatch",
              expected_sequence: state.event_stream.expected_sequence,
              received_sequence: step.sequence,
            },
          ],
        };
      }
      if (step.sequence < state.event_stream.expected_sequence) {
        return {
          state,
          outputs: [
            { type: "event_duplicate_ignored", sequence: step.sequence },
          ],
        };
      }
      if (step.sequence > state.event_stream.expected_sequence) {
        state.event_stream.status = "event_resync_required";
        return {
          state,
          outputs: [
            {
              type: "event_resync_required",
              reason: "client_detected_gap",
              expected_sequence: state.event_stream.expected_sequence,
              received_sequence: step.sequence,
            },
          ],
        };
      }
      state.event_stream.expected_sequence += 1;
      state.event_stream.highest_sent_sequence = Math.max(
        state.event_stream.highest_sent_sequence,
        step.sequence,
      );
      return {
        state,
        outputs: [{ type: "event_received", sequence: step.sequence }],
      };
    case "resume_events": {
      if (step.stream_epoch !== state.event_stream.epoch) {
        return {
          state,
          outputs: [
            {
              type: "event_resync_required",
              reason: "epoch_mismatch",
            },
          ],
        };
      }
      if (
        state.event_stream.status !== "event_resync_required" ||
        step.last_ack > state.event_stream.highest_sent_sequence
      ) {
        return {
          state,
          outputs: [
            {
              type: "protocol_error",
              code: "invalid_envelope",
              related_message_id: step.message_id ?? null,
              effect: "none",
            },
          ],
        };
      }
      const start = Math.max(
        step.last_ack,
        state.event_stream.last_ack,
      ) + 1;
      const retained = state.event_stream.journal
        .filter((event) => event.sequence >= start)
        .sort((left, right) => left.sequence - right.sequence);
      if (
        (retained.length === 0 &&
          start > state.event_stream.highest_sent_sequence) ||
        (retained.length > 0 &&
          retained[0].sequence === start &&
          retained.every(
            (event, index) => event.sequence === start + index,
          ))
      ) {
        state.event_stream.status = "live";
        if (retained.length > 0) {
          state.event_stream.expected_sequence =
            retained[retained.length - 1].sequence + 1;
          state.event_stream.highest_sent_sequence = Math.max(
            state.event_stream.highest_sent_sequence,
            retained[retained.length - 1].sequence,
          );
        }
        return {
          state,
          outputs: [
            {
              type: "events_replayed",
              sequences: retained.map((event) => event.sequence),
            },
          ],
        };
      }
      const journalHigh = state.event_stream.journal.reduce(
        (highest, event) => Math.max(highest, event.sequence),
        0,
      );
      const unavailableThrough = Math.max(
        state.event_stream.highest_sent_sequence,
        state.event_stream.expected_sequence - 1,
        journalHigh,
      );
      const previousEpoch = state.event_stream.epoch;
      state.event_stream = {
        epoch: step.server_new_stream_epoch,
        expected_sequence: 1,
        highest_sent_sequence: 0,
        last_ack: 0,
        status: "live",
        journal: [],
      };
      return {
        state,
        outputs: [
          {
            type: "event_stream_reset",
            previous_stream_epoch: previousEpoch,
            unavailable_from: start,
            unavailable_through: unavailableThrough,
            new_stream_epoch: step.server_new_stream_epoch,
          },
        ],
      };
    }
    case "deliver_delta": {
      const retained = new Set(state.snapshot.retained_baselines);
      if (
        state.snapshot.baseline_id !== step.baseline_id ||
        !retained.has(step.baseline_id)
      ) {
        const reason =
          step.baseline_id == null
            ? "baseline_missing"
            : state.snapshot.baseline_id !== step.baseline_id
              ? "baseline_mismatched"
              : "baseline_expired";
        state.snapshot.status = "snapshot_resync_required";
        return {
          state,
          outputs: [
            {
              type: "snapshot_resync_required",
              reason,
              baseline_id: step.baseline_id,
            },
          ],
        };
      }
      return {
        state,
        outputs: [
          { type: "delta_delivered", baseline_id: step.baseline_id },
        ],
      };
    }
    case "expire_baseline":
      state.snapshot.retained_baselines =
        state.snapshot.retained_baselines.filter(
          (baseline) => baseline !== step.baseline_id,
        );
      return {
        state,
        outputs: [
          { type: "baseline_expired", baseline_id: step.baseline_id },
        ],
      };
    case "snapshot_resync": {
      state.snapshot = {
        baseline_id: step.new_baseline_id,
        retained_baselines: [step.new_baseline_id],
        status: "live",
      };
      return {
        state,
        outputs: [
          {
            type: "full_snapshot",
            baseline_id: step.new_baseline_id,
          },
        ],
      };
    }
    default:
      throw new Error(`unsupported fixture operation: ${step.op}`);
  }
}

export function evaluateScenario(initial, steps, inspect = []) {
  let state = normalizedState(initial);
  const trace = [];
  for (const step of steps) {
    const result = transition(state, step);
    state = result.state;
    trace.push(...result.outputs);
  }
  const result = { trace };
  if (inspect.length > 0) {
    result.final_state = Object.fromEntries(
      inspect.map((key) => [key, clone(state[key])]),
    );
  }
  return result;
}

export function canonicalize(value) {
  if (Array.isArray(value)) {
    return value.map(canonicalize);
  }
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value)
        .sort(([left], [right]) => compareCodeUnits(left, right))
        .map(([key, child]) => [key, canonicalize(child)]),
    );
  }
  return value;
}

export function validateFixture(fixture) {
  if (
    fixture?.fixture_format !== "aigent.protocol.semantic-fixtures" ||
    fixture?.fixture_version !== 1
  ) {
    throw new Error("unsupported semantic fixture format");
  }
  if (
    fixture?.limits?.outbound_queue_bytes !== QUEUE_LIMIT_BYTES ||
    fixture?.limits?.overflow_tick_observations !==
      OVERFLOW_TICK_OBSERVATIONS
  ) {
    throw new Error("fixture limits do not match protocol v1");
  }
  if (!Array.isArray(fixture.cases) || fixture.cases.length === 0) {
    throw new Error("fixture cases must be a non-empty array");
  }
  const ids = new Set();
  for (const scenario of fixture.cases) {
    if (
      typeof scenario.id !== "string" ||
      !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(scenario.id) ||
      ids.has(scenario.id)
    ) {
      throw new Error(`invalid or duplicate fixture id: ${scenario.id}`);
    }
    ids.add(scenario.id);
    if (
      !scenario.initial ||
      !Array.isArray(scenario.steps) ||
      scenario.steps.length === 0 ||
      !Array.isArray(scenario.expect?.trace)
    ) {
      throw new Error(`invalid fixture case: ${scenario.id}`);
    }
  }
}

export function loadFixture(
  fixturePath = path.resolve(
    path.dirname(fileURLToPath(import.meta.url)),
    "../protocol/v1/conformance/envelope-v1.json",
  ),
) {
  return JSON.parse(fs.readFileSync(fixturePath, "utf8"));
}
