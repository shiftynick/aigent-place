/**
 * Semantic JSON ↔ CommandOutcome protobuf for the replay oracle.
 * projection_sha256 continues to hash canonical semantic JSON;
 * payload_hex carries protobuf bytes (ADR-0008 follow-up / task-352658…).
 */
import { create, fromBinary, toBinary } from "@bufbuild/protobuf";
import {
  CommandAcceptedSchema,
  CommandKind,
  CommandOutcomeSchema,
  CommandRejectedSchema,
  CommandRejectionCode,
  DurableCommandDescriptorSchema,
  DurableCommandResultSchema,
  DurableOrderedEventSchema,
  DurablePayloadMode,
  RequiredFeatureSchema,
} from "@aigent-place/protocol";

function utf8(value) {
  return Buffer.from(String(value ?? ""), "utf8");
}

function fromHex(value) {
  if (typeof value !== "string" || value.length % 2 !== 0 || !/^[0-9a-f]*$/i.test(value)) {
    throw new Error("invalid hex");
  }
  return Buffer.from(value, "hex");
}

function toHex(bytes) {
  return Buffer.from(bytes).toString("hex");
}

function u64String(value) {
  if (typeof value === "bigint") return value.toString(10);
  if (typeof value === "number") return BigInt(value).toString(10);
  return String(value);
}

function encodeResult(result) {
  if (!result || typeof result !== "object") {
    throw new Error("missing command outcome result");
  }
  if (result.outcome === "accepted") {
    return create(DurableCommandResultSchema, {
      outcome: {
        case: "accepted",
        value: create(CommandAcceptedSchema, {
          affectedEntities: [],
          payload: utf8(JSON.stringify({ mutation_delta: result.mutation_delta ?? 0 })),
          affectedWorldEntities: [],
        }),
      },
    });
  }
  if (result.outcome === "rejected") {
    return create(DurableCommandResultSchema, {
      outcome: {
        case: "rejected",
        value: create(CommandRejectedSchema, {
          code: CommandRejectionCode.UNSPECIFIED,
          message: String(result.reason ?? result.message ?? "rejected"),
          payload: new Uint8Array(),
        }),
      },
    });
  }
  throw new Error(`unsupported semantic result outcome: ${result.outcome}`);
}

function decodeResult(result) {
  if (!result?.outcome) {
    throw new Error("missing durable result");
  }
  if (result.outcome.case === "accepted") {
    let mutation_delta = 0;
    try {
      const parsed = JSON.parse(
        Buffer.from(result.outcome.value.payload ?? []).toString("utf8") || "{}",
      );
      if (Number.isFinite(parsed.mutation_delta)) mutation_delta = parsed.mutation_delta;
    } catch {
      mutation_delta = 0;
    }
    return { outcome: "accepted", mutation_delta };
  }
  if (result.outcome.case === "rejected") {
    return {
      outcome: "rejected",
      reason: result.outcome.value.message || "rejected",
    };
  }
  throw new Error("unsupported durable result oneof");
}

function encodeCommand(command) {
  const payloadHex = command.canonical_payload_hex ?? "";
  const hasBytes = payloadHex.length > 0;
  return create(DurableCommandDescriptorSchema, {
    commandId: String(command.command_id ?? ""),
    arrivalTick: BigInt(command.arrival_tick ?? 0),
    aigentId: utf8(command.aigent_id),
    sessionEpoch: utf8(command.session_epoch),
    sequence: BigInt(command.sequence ?? 0),
    idempotencyKey: utf8(command.idempotency_key),
    protocolMajor: Number(command.protocol_major ?? 1),
    kind: Number(command.kind ?? CommandKind.UNSPECIFIED),
    requiredFeatures: (command.required_features ?? []).map((feature) =>
      create(RequiredFeatureSchema, {
        featureId: String(feature.feature_id ?? feature.id ?? ""),
        version: Number(feature.version ?? 0),
      }),
    ),
    payloadMode: hasBytes
      ? DurablePayloadMode.BYTES
      : DurablePayloadMode.EMPTY,
    canonicalPayload: hasBytes ? fromHex(payloadHex) : new Uint8Array(),
  });
}

function decodeCommand(command) {
  return {
    command_id: command.commandId,
    arrival_tick: u64String(command.arrivalTick),
    aigent_id: Buffer.from(command.aigentId).toString("utf8"),
    session_epoch: Buffer.from(command.sessionEpoch).toString("utf8"),
    sequence: u64String(command.sequence),
    idempotency_key: Buffer.from(command.idempotencyKey).toString("utf8"),
    protocol_major: command.protocolMajor,
    kind: Number(command.kind),
    required_features: (command.requiredFeatures ?? []).map((feature) => ({
      feature_id: feature.featureId,
      version: feature.version,
    })),
    payload_mode:
      command.payloadMode === DurablePayloadMode.BYTES ? 1 : 0,
    canonical_payload_hex: toHex(command.canonicalPayload ?? []),
  };
}

function encodeEvents(events) {
  return (events ?? []).map((event) =>
    create(DurableOrderedEventSchema, {
      streamId: utf8(event.stream_id),
      streamEpoch: BigInt(event.stream_epoch ?? 0),
      sequence: BigInt(event.sequence ?? 0),
      ordinal: BigInt(event.ordinal ?? 0),
      encodedBytes: BigInt(event.bytes ?? event.encoded_bytes ?? 0),
      committedAt: BigInt(event.committed_at ?? 0),
      payload: utf8(event.payload ?? ""),
    }),
  );
}

function decodeEvents(events) {
  return (events ?? []).map((event) => ({
    stream_id: Buffer.from(event.streamId).toString("utf8"),
    stream_epoch: u64String(event.streamEpoch),
    sequence: u64String(event.sequence),
    ordinal: u64String(event.ordinal),
    bytes: Number(event.encodedBytes),
    committed_at: Number(event.committedAt),
    payload: Buffer.from(event.payload ?? []).toString("utf8"),
  }));
}

export function semanticToCommandOutcome(payload) {
  if (!payload || typeof payload !== "object") {
    throw new Error("missing semantic COMMAND_OUTCOME payload");
  }
  return create(CommandOutcomeSchema, {
    buildId: String(payload.build_id ?? ""),
    replayVersion: Number(payload.replay_version ?? 1),
    priorGeneration: BigInt(payload.prior_generation ?? 0),
    command: encodeCommand(payload.command ?? {}),
    digest: fromHex(String(payload.digest ?? "").toLowerCase()),
    result: encodeResult(payload.result),
    encodedFrameBytes: BigInt(payload.encoded_frame_bytes ?? 0),
    generationRecordCount: Number(payload.generation_record_count ?? 1),
    alias: payload.alias === true,
    preserveIdempotency: payload.preserve_idempotency === true,
    committedAt: BigInt(payload.committed_at ?? 0),
    events: encodeEvents(payload.events),
    // RNG audits stay oracle-side in the projection for this migration;
    // empty on the wire until a dedicated mapping lands.
    rngAudit: [],
  });
}

export function commandOutcomeToSemantic(message) {
  return {
    build_id: message.buildId,
    replay_version: message.replayVersion,
    prior_generation: u64String(message.priorGeneration),
    command: decodeCommand(message.command ?? {}),
    digest: toHex(message.digest ?? []),
    result: decodeResult(message.result),
    encoded_frame_bytes: Number(message.encodedFrameBytes),
    generation_record_count: message.generationRecordCount,
    alias: message.alias === true,
    preserve_idempotency: message.preserveIdempotency === true,
    committed_at: Number(message.committedAt),
    events: decodeEvents(message.events),
    rng_audit: [],
  };
}

/**
 * Wire-representable semantic projection for a COMMAND_OUTCOME.
 * Built from the typed message path (no fromBinary), so broken decoders cannot
 * self-certify. Projection-only fields such as rng_audit are empty here.
 */
export function wireSemanticProjection(payload) {
  return commandOutcomeToSemantic(semanticToCommandOutcome(payload ?? {}));
}

export function encodeCommandOutcomeHex(payload) {
  return Buffer.from(toBinary(CommandOutcomeSchema, semanticToCommandOutcome(payload))).toString(
    "hex",
  );
}

export function decodeCommandOutcomeHex(payloadHex) {
  if (
    typeof payloadHex !== "string" ||
    payloadHex.length % 2 !== 0 ||
    !/^[0-9a-f]*$/.test(payloadHex)
  ) {
    throw new Error("invalid frame payload hex");
  }
  const bytes = Buffer.from(payloadHex, "hex");
  const message = fromBinary(CommandOutcomeSchema, bytes);
  return commandOutcomeToSemantic(message);
}
