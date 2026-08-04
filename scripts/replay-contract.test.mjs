import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import {
  crc32cHex,
  deterministicDraw,
  evaluateFixtureCase,
  evaluateScenario,
  loadFixture,
  MAX_COMMANDS_PER_GENERATION,
  MAX_DURABLE_BYTES_PER_GENERATION,
  recoveryFrame,
  semanticCommandDigest,
  validateFixture,
} from "./replay-contract.mjs";
import { encodeCommandOutcomeHex } from "./replay-command-outcome.mjs";

const fixture = loadFixture();
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function completeTailHex(frame) {
  const payload = Buffer.from(frame.payload_hex, "hex");
  const header = Buffer.alloc(28);
  header.write("AIGR", 0, "ascii");
  header.writeUInt16BE(1, 4);
  header.writeUInt16BE(1, 6);
  header.writeBigUInt64BE(BigInt(frame.generation), 8);
  header.writeUInt32BE(frame.ordinal, 16);
  header.writeBigUInt64BE(BigInt(payload.length), 20);
  const committed = Buffer.concat([header, payload]);
  return Buffer.concat([committed, Buffer.from(crc32cHex(committed), "hex")]).toString("hex");
}

test("all replay v1 semantic fixtures match derived state and trace", () => {
  validateFixture(fixture);
  for (const scenario of fixture.cases) {
    assert.deepEqual(evaluateFixtureCase(fixture, scenario), scenario.expect, scenario.id);
  }
});

test("admission limits are exact and duplicate canonical tuples never enter state", () => {
  assert.equal(MAX_COMMANDS_PER_GENERATION, 4096);
  assert.equal(MAX_DURABLE_BYTES_PER_GENERATION, 16 * 1024 * 1024);
  const result = evaluateScenario({}, [{
    op: "admit",
    commands: [
      { command_id: "one", arrival_tick: "0", aigent_id: "a", session_epoch: "1", sequence: "1", idempotency_key: "a", kind: 1, payload: {}, encoded_frame_bytes: 1 },
      { command_id: "two", arrival_tick: "0", aigent_id: "a", session_epoch: "1", sequence: "1", idempotency_key: "b", kind: 1, payload: {}, encoded_frame_bytes: 1 },
    ],
  }]);
  assert.deepEqual(result.trace, [{ type: "admission_rejected", reason: "duplicate_order_tuple" }]);
  assert.equal(result.final_state.generation, 0);

  const commands = Array.from({ length: MAX_COMMANDS_PER_GENERATION + 1 }, (_, index) => ({
    command_id: `command-${index + 1}`,
    arrival_tick: "0",
    aigent_id: `aigent-${String(index + 1).padStart(4, "0")}`,
    session_epoch: "1",
    sequence: "1",
    idempotency_key: `key-${index + 1}`,
    kind: 1,
    payload: {},
    encoded_frame_bytes: 1,
  }));
  const capped = evaluateScenario({}, [{ op: "admit", commands }]);
  assert.equal(capped.trace[0].command_ids.length, MAX_COMMANDS_PER_GENERATION);
  assert.deepEqual(capped.trace.at(-1), {
    type: "protocol_error",
    command_id: "command-4097",
    code: "PERSISTENCE_BACKPRESSURE",
    retry_after_ticks: 1,
  });
});

test("committed sequence outcomes precede writer occupancy and semantic feature order is stable", () => {
  const original = {
    command_id: "original",
    arrival_tick: "1",
    aigent_id: "a",
    session_epoch: "1",
    sequence: "1",
    idempotency_key: "stable-key",
    protocol_major: 1,
    kind: 1,
    required_features: [
      { feature_id: "zeta", version: 2 },
      { feature_id: "alpha", version: 1 },
    ],
    payload: { amount: 1 },
    encoded_frame_bytes: 32,
  };
  const result = evaluateScenario({}, [
    { op: "admit", commands: [original] },
    { op: "commit" },
    {
      op: "admit",
      commands: [
        {
          ...original,
          command_id: "retry",
          arrival_tick: "2",
          required_features: [...original.required_features].reverse(),
        },
        { ...original, command_id: "conflict", arrival_tick: "3", idempotency_key: "other-key" },
        { ...original, command_id: "gap", arrival_tick: "4", sequence: "3", idempotency_key: "gap-key" },
      ],
    },
  ]);
  assert.deepEqual(result.trace.slice(-3), [
    {
      type: "command_result_replayed",
      command_id: "retry",
      result: { mutation_delta: 0, outcome: "accepted" },
    },
    {
      type: "command_result",
      command_id: "conflict",
      outcome: "rejected",
      reason: "SEQUENCE_CONTENT_CONFLICT",
    },
    {
      type: "command_result",
      command_id: "gap",
      outcome: "rejected",
      reason: "SEQUENCE_GAP",
    },
  ]);
});

test("invalid protocol majors and unavailable writers fail before speculative evaluation", () => {
  const command = {
    command_id: "one",
    arrival_tick: "0",
    aigent_id: "a",
    session_epoch: "1",
    sequence: "1",
    idempotency_key: "key",
    kind: 1,
    payload: {},
    encoded_frame_bytes: 1,
  };
  assert.deepEqual(evaluateScenario({}, [{
    op: "admit",
    commands: [{ ...command, protocol_major: -1 }],
  }]).trace, [{ type: "admission_rejected", reason: "invalid_command_metadata" }]);
  for (const unavailableCommand of [
    command,
    { ...command, command_id: "oversized", encoded_frame_bytes: MAX_DURABLE_BYTES_PER_GENERATION + 1 },
  ]) {
    assert.deepEqual(evaluateScenario({ writer_unavailable: true }, [{
      op: "admit",
      commands: [unavailableCommand],
    }]).trace, [{
      type: "protocol_error",
      command_id: unavailableCommand.command_id,
      code: "PERSISTENCE_UNAVAILABLE",
      connection_closed: true,
    }]);
  }
});

test("tentative session cursors, aliases, and uint64 capacity edges are deterministic", () => {
  const command = (id, sequence, overrides = {}) => ({ command_id: id, arrival_tick: "0", aigent_id: "a", session_epoch: "7", sequence, idempotency_key: id, kind: 1, payload: {}, encoded_frame_bytes: 1, ...overrides });
  const sequential = evaluateScenario({}, [{ op: "admit", commands: [command("one", "1", { mutation_delta: 1 }), command("two", "2", { mutation_delta: 2 })] }, { op: "commit" }, { op: "install" }, { op: "deliver" }]);
  assert.equal(sequential.final_state.world_value, 3);
  assert.deepEqual(sequential.trace.at(-2).command_id, "one");
  assert.deepEqual(sequential.trace.at(-1).command_id, "two");

  const original = command("original", "1", {
    session_epoch: "1",
    idempotency_key: "shared",
    payload: { value: 1 },
    mutation_delta: 3,
  });
  const alias = evaluateScenario({}, [
    { op: "admit", commands: [original] }, { op: "commit" }, { op: "install" }, { op: "deliver" },
    { op: "admit", commands: [{ ...original, command_id: "alias", arrival_tick: "1", session_epoch: "2", mutation_delta: 99 }] },
    { op: "commit" }, { op: "install" }, { op: "deliver" },
  ]);
  assert.equal(alias.final_state.world_value, 3);
  assert.deepEqual(alias.trace.at(-1), { type: "command_result", command_id: "alias", outcome: "accepted", mutation_delta: 3 });

  const oversized = evaluateScenario({}, [{ op: "admit", commands: [command("fits", "1", { encoded_frame_bytes: MAX_DURABLE_BYTES_PER_GENERATION }), command("too-large", "2", { encoded_frame_bytes: MAX_DURABLE_BYTES_PER_GENERATION + 1 })] }]);
  assert.equal(oversized.trace[0].command_ids[0], "fits");
  assert.deepEqual(oversized.trace.at(-1), { type: "protocol_error", command_id: "too-large", code: "PERSISTENCE_RECORD_TOO_LARGE", connection_closed: true });
  assert.deepEqual(evaluateScenario({}, [{ op: "admit", commands: [command("bad-u64", "18446744073709551616")] }]).trace, [{ type: "admission_rejected", reason: "invalid_command_metadata" }]);

  const maximum = "18446744073709551615";
  const maximumCommand = command("maximum", maximum);
  const maximumSession = evaluateScenario({
    expected_sequences: { '["1:61","1:37"]': maximum },
  }, [
    { op: "admit", commands: [maximumCommand] }, { op: "commit" }, { op: "install" }, { op: "deliver" },
    { op: "admit", commands: [maximumCommand] },
  ]);
  assert.equal(maximumSession.trace.at(-1).type, "command_result_replayed");
});

test("same-generation idempotency uses tentative alias and conflict state through recovery", () => {
  const checkpoint = {
    generation: 0,
    build_id: "same-build",
    replay_version: 1,
    digest_contract_version: 1,
    rng_contract_version: 1,
    world_seed: "00".repeat(32),
    next_stream_epoch: "1",
    next_ordinal: "1",
    last_commit_hour: 0,
    component_generations: { world: 0, allocator: 0, ruleset: 0, sessions: 0, idempotency: 0, events: 0, rng: 0 },
  };
  const command = (id, sequence, payload, mutationDelta) => ({
    command_id: id,
    arrival_tick: "0",
    aigent_id: "a",
    session_epoch: "1",
    sequence,
    idempotency_key: "shared",
    kind: 1,
    payload,
    encoded_frame_bytes: 1,
    mutation_delta: mutationDelta,
  });
  const sameBatchRetry = evaluateScenario({}, [
    {
      op: "admit",
      commands: [
        command("original", "1", { value: 1 }, 3),
        { ...command("next", "2", { value: 2 }, 2), idempotency_key: "next" },
        { ...command("retry", "1", { value: 1 }, 99), arrival_tick: "1" },
      ],
    },
    { op: "commit" },
    { op: "install" },
    { op: "deliver" },
    { op: "cold_restart", checkpoint, running_build_id: "same-build" },
  ]);
  assert.deepEqual(sameBatchRetry.trace.filter(({ type }) =>
    type === "command_result" || type === "command_result_replayed"
  ), [
    { type: "command_result", command_id: "original", outcome: "accepted", mutation_delta: 3 },
    { type: "command_result", command_id: "next", outcome: "accepted", mutation_delta: 2 },
    {
      type: "command_result_replayed",
      command_id: "retry",
      result: { outcome: "accepted", mutation_delta: 3 },
    },
  ]);
  assert.equal(sameBatchRetry.trace.find(({ type }) => type === "generation_committed").command_count, 2);
  assert.equal(sameBatchRetry.trace.at(-1).type, "recovery_reconstructed");
  assert.equal(sameBatchRetry.final_state.world_value, 5);

  const alias = evaluateScenario({}, [
    {
      op: "admit",
      commands: [
        command("original", "1", { value: 1 }, 3),
        command("alias", "2", { value: 1 }, 99),
      ],
    },
    { op: "commit" },
    { op: "install" },
    { op: "deliver" },
    { op: "cold_restart", checkpoint, running_build_id: "same-build" },
  ]);
  assert.deepEqual(alias.trace.filter(({ type }) => type === "command_result"), [
    { type: "command_result", command_id: "original", outcome: "accepted", mutation_delta: 3 },
    { type: "command_result", command_id: "alias", outcome: "accepted", mutation_delta: 3 },
  ]);
  assert.equal(alias.trace.at(-1).type, "recovery_reconstructed");
  assert.equal(alias.final_state.world_value, 3);

  const conflict = evaluateScenario({}, [
    {
      op: "admit",
      commands: [
        command("original", "1", { value: 1 }, 3),
        command("conflict", "2", { value: 2 }, 99),
      ],
    },
    { op: "commit" },
    { op: "install" },
    { op: "deliver" },
    { op: "cold_restart", checkpoint, running_build_id: "same-build" },
  ]);
  assert.deepEqual(conflict.trace.filter(({ type }) => type === "command_result"), [
    { type: "command_result", command_id: "original", outcome: "accepted", mutation_delta: 3 },
    { type: "command_result", command_id: "conflict", outcome: "rejected", reason: "IDEMPOTENCY_CONFLICT" },
  ]);
  assert.equal(conflict.trace.at(-1).type, "recovery_reconstructed");
  assert.equal(conflict.final_state.world_value, 3);

  const availability = evaluateScenario({}, [
    {
      op: "admit",
      commands: [
        { ...command("unavailable-first", "1", {}, 0), available: false, payload_bytes: "wire-a" },
        command("normal-after-unavailable", "2", { value: 2 }, 99),
        { ...command("normal-first", "3", { value: 3 }, 2), idempotency_key: "second" },
        {
          ...command("unavailable-after-normal", "4", {}, 0),
          idempotency_key: "second",
          available: false,
          payload_bytes: "wire-b",
        },
      ],
    },
    { op: "commit" },
    { op: "install" },
    { op: "deliver" },
    { op: "cold_restart", checkpoint, running_build_id: "same-build" },
  ]);
  assert.deepEqual(availability.trace.filter(({ type }) => type === "command_result"), [
    { type: "command_result", command_id: "unavailable-first", outcome: "rejected", reason: "UNSUPPORTED_MESSAGE" },
    { type: "command_result", command_id: "normal-after-unavailable", outcome: "rejected", reason: "IDEMPOTENCY_CONFLICT" },
    { type: "command_result", command_id: "normal-first", outcome: "accepted", mutation_delta: 2 },
    { type: "command_result", command_id: "unavailable-after-normal", outcome: "rejected", reason: "UNSUPPORTED_MESSAGE" },
  ]);
  assert.equal(availability.trace.at(-1).type, "recovery_reconstructed");
  assert.equal(availability.final_state.world_value, 2);
});

test("unavailable exact-next commands precede cross-epoch key conflicts", () => {
  const base = { command_id: "first", arrival_tick: "0", aigent_id: "a", session_epoch: "1", sequence: "1", idempotency_key: "key", kind: 1, payload: {}, encoded_frame_bytes: 1 };
  const result = evaluateScenario({}, [
    { op: "admit", commands: [base] }, { op: "commit" }, { op: "install" }, { op: "deliver" },
    { op: "admit", commands: [{ ...base, command_id: "unavailable", arrival_tick: "1", session_epoch: "2", available: false, payload_bytes: "raw" }] },
    { op: "commit" }, { op: "install" }, { op: "deliver" },
  ]);
  assert.deepEqual(result.trace.at(-1), { type: "command_result", command_id: "unavailable", outcome: "rejected", reason: "UNSUPPORTED_MESSAGE" });
});

test("cold recovery validates exact frames and rebuilds durable state from a checkpoint suffix", () => {
  const command = {
    command_id: "restored",
    arrival_tick: "1",
    aigent_id: "a",
    session_epoch: "9",
    sequence: "1",
    idempotency_key: "restore-key",
    protocol_major: 1,
    kind: 1,
    payload: { value: 4 },
    encoded_frame_bytes: 1,
  };
  const payload = {
    build_id: "build-a",
    replay_version: 1,
    prior_generation: 0,
    command: {
      command_id: command.command_id,
      arrival_tick: command.arrival_tick,
      aigent_id: command.aigent_id,
      session_epoch: command.session_epoch,
      sequence: command.sequence,
      idempotency_key: command.idempotency_key,
      protocol_major: command.protocol_major,
      kind: command.kind,
      required_features: [],
      payload_mode: 0,
      canonical_payload_hex: "7b2276616c7565223a347d",
    },
    digest: semanticCommandDigest(command),
    result: { outcome: "accepted", mutation_delta: 4 },
    encoded_frame_bytes: 1,
    generation_record_count: 1,
    alias: false,
    preserve_idempotency: false,
    committed_at: 3,
    events: [{
      stream_id: "7",
      stream_epoch: "1",
      sequence: "1",
      ordinal: "1",
      bytes: 5,
      committed_at: 3,
      payload: "event",
    }],
    rng_audit: [{
      input: { rng_contract_version: 1, subsystem: "world", purpose: "spawn", generation: 1, canonical_command_index: 0, entity_id: "9", draw_index: 0 },
      bound: "1000",
      output: {
        hmac: "1747bf75114b2685734010db1b19476c1acf94a843002996e00b63b78188bc8d",
        raw: "1677519895741015685",
        value: "685",
        candidate_index: 0,
        rejection_block: 0,
        blocks: [{
          rejection_block: 0,
          hmac: "1747bf75114b2685734010db1b19476c1acf94a843002996e00b63b78188bc8d",
          candidates: ["1677519895741015685", "8304656246109718380", "1931926215564732822", "16144106929043061901"],
        }],
      },
    }],
  };
  const frame = recoveryFrame({ payload, generation: 1 });
  const checkpoint = {
    generation: 0,
    build_id: "build-a",
    replay_version: 1,
    digest_contract_version: 1,
    rng_contract_version: 1,
    world_seed: "000102030405060708090a0b0c0d0e0f101112131415161718191a1b1c1d1e1f",
    next_stream_epoch: "1",
    next_ordinal: "1",
    last_commit_hour: 0,
    component_generations: { world: 0, allocator: 0, ruleset: 0, sessions: 0, idempotency: 0, events: 0, rng: 0 },
  };
  const opaquePayloadFrame = recoveryFrame({ payload, generation: 1, payload_hex: "ff00fe807f" });
  assert.equal(evaluateScenario({}, [{
    op: "recover",
    checkpoint,
    running_build_id: "build-a",
    records: [opaquePayloadFrame],
  }]).trace[0].type, "recovery_failed");
  assert.equal(opaquePayloadFrame.declared_length, 5);
  assert.equal(opaquePayloadFrame.payload_sha256, "a1201331fda4a32376bf0d7d759864c4443a47f6ab8ccb78dbf7331d68c251ff");
  const recovered = evaluateScenario({}, [
    { op: "recover", checkpoint, running_build_id: "build-a", records: [frame], tail: { transaction_committed: false, bytes_hex: "41494752" } },
    { op: "admit", now_hour: 4, commands: [{ ...command, command_id: "retry", arrival_tick: "2" }] },
  ]);
  assert.deepEqual(recovered.trace, [
    {
      type: "recovery_reconstructed",
      generation: 1,
      world_value: 4,
      session_cursors: { "[\"1:61\",\"1:39\"]": "2" },
      idempotency_count: 1,
      durable_result_count: 1,
      event_count: 1,
      rng_audit_count: 1,
      tail_outcome: "uncommitted_tail_rolled_back",
    },
    {
      type: "command_result_replayed",
      command_id: "retry",
      result: { outcome: "accepted", mutation_delta: 4 },
    },
  ]);
  assert.equal(crc32cHex("123456789"), "e3069283");

  const invalidFrames = [
    recoveryFrame({ payload, generation: 1, magic: "NOPE" }),
    recoveryFrame({ payload, generation: 1, version: 2 }),
    recoveryFrame({ payload, generation: 1, type: 99 }),
    recoveryFrame({ payload, generation: 1, declared_length: 999 }),
    recoveryFrame({ payload, generation: 1, checksum: "00000000" }),
    { ...frame, encoded_frame_bytes: 2 },
    recoveryFrame({ payload, generation: 1, ordinal: 1 }),
    recoveryFrame({ payload: { ...payload, prior_generation: 1 }, generation: 2, prior_generation: 1 }),
  ];
  for (const invalid of invalidFrames) {
    assert.equal(evaluateScenario({}, [{ op: "recover", checkpoint, running_build_id: "build-a", records: [invalid] }]).trace[0].type, "recovery_failed");
  }
  assert.equal(evaluateScenario({}, [{
    op: "recover",
    checkpoint,
    running_build_id: "build-a",
    records: [{ ...frame, payload_hex: "ff0" }],
  }]).trace[0].type, "recovery_failed");
  assert.equal(evaluateScenario({}, [{
    op: "recover",
    checkpoint,
    running_build_id: "build-a",
    records: [recoveryFrame({ payload, generation: 1, payload_hex: "ffffffff" })],
  }]).trace[0].type, "recovery_failed");
  assert.equal(evaluateScenario({}, [{
    op: "recover",
    checkpoint,
    running_build_id: "build-a",
    records: [recoveryFrame({
      payload,
      generation: 1,
      payload_hex: encodeCommandOutcomeHex({ ...payload, build_id: "evil-build" }),
    })],
  }]).trace[0].type, "recovery_failed");
  const nonCanonicalHex = `${frame.payload_hex}1800`;
  assert.equal(evaluateScenario({}, [{
    op: "recover",
    checkpoint,
    running_build_id: "build-a",
    records: [recoveryFrame({ payload, generation: 1, payload_hex: nonCanonicalHex })],
  }]).trace[0].type, "recovery_failed");
  const corruptAudit = structuredClone(payload);
  corruptAudit.rng_audit[0].output.hmac = "00".repeat(32);
  assert.equal(evaluateScenario({}, [{
    op: "recover",
    checkpoint,
    running_build_id: "build-a",
    records: [recoveryFrame({ payload: corruptAudit, generation: 1 })],
  }]).trace[0].type, "recovery_failed");
  assert.deepEqual(evaluateScenario({}, [{ op: "recover", checkpoint, running_build_id: "build-a", records: [frame], tail: { transaction_committed: true, bytes_hex: "41494752" } }]).trace, [
    { type: "recovery_failed", reason: "committed_record_corruption" },
  ]);
  assert.equal(evaluateScenario({}, [{
    op: "recover",
    checkpoint,
    running_build_id: "build-a",
    records: [frame],
    tail: { transaction_committed: true, bytes_hex: completeTailHex(frame) },
  }]).trace[0].tail_outcome, "committed_tail_complete");
  const unrelatedComplete = recoveryFrame({ payload: { ...payload, prior_generation: 1 }, generation: 2 });
  assert.equal(evaluateScenario({}, [{
    op: "recover",
    checkpoint,
    running_build_id: "build-a",
    records: [frame],
    tail: { transaction_committed: true, bytes_hex: completeTailHex(unrelatedComplete) },
  }]).trace[0].type, "recovery_failed");
});

test("durable conflict retries, live-epoch retention, and release are distinct", () => {
  const base = {
    command_id: "first",
    arrival_tick: "0",
    aigent_id: "a",
    session_epoch: "1",
    sequence: "1",
    idempotency_key: "key",
    kind: 1,
    payload: { value: 1 },
    encoded_frame_bytes: 1,
    mutation_delta: 1,
  };
  const result = evaluateScenario({}, [
    { op: "admit", now_hour: 0, commands: [base] }, { op: "commit" }, { op: "install" }, { op: "deliver" },
    { op: "admit", now_hour: 25, commands: [{ ...base, command_id: "conflict", arrival_tick: "1", session_epoch: "2", payload: { value: 2 } }] },
    { op: "commit" }, { op: "install" }, { op: "deliver" },
    { op: "admit", now_hour: 25, commands: [{ ...base, command_id: "conflict-retry", arrival_tick: "2", session_epoch: "2", payload: { value: 2 } }] },
    { op: "release_session", now_hour: 25, aigent_id: "a", session_epoch: "1" },
    { op: "release_session", now_hour: 25, aigent_id: "a", session_epoch: "2" },
    { op: "expire_retention", now_hour: 49 },
    { op: "inspect_retention" },
    { op: "admit", now_hour: 25, commands: [{ ...base, command_id: "after-release", arrival_tick: "3", session_epoch: "3", payload: { value: 2 }, mutation_delta: 5 }] },
    { op: "commit" }, { op: "install" }, { op: "deliver" },
  ]);
  assert.deepEqual(result.trace.filter(({ command_id }) => ["conflict", "conflict-retry", "after-release"].includes(command_id)), [
    { type: "command_result", command_id: "conflict", outcome: "rejected", reason: "IDEMPOTENCY_CONFLICT" },
    { type: "command_result_replayed", command_id: "conflict-retry", result: { outcome: "rejected", reason: "IDEMPOTENCY_CONFLICT" } },
    { type: "command_result", command_id: "after-release", outcome: "accepted", mutation_delta: 5 },
  ]);
  assert.equal(result.final_state.world_value, 6);
  assert.deepEqual(result.trace.find(({ type }) => type === "retention_state"), {
    type: "retention_state",
    idempotency_count: 0,
    durable_result_count: 0,
  });
});

test("cold recovery preserves committed retention decisions but disconnects historical sessions", () => {
  const checkpoint = {
    generation: 0,
    build_id: "same-build",
    replay_version: 1,
    digest_contract_version: 1,
    rng_contract_version: 1,
    world_seed: "00".repeat(32),
    next_stream_epoch: "1",
    next_ordinal: "1",
    last_commit_hour: 0,
    component_generations: { world: 0, allocator: 0, ruleset: 0, sessions: 0, idempotency: 0, events: 0, rng: 0 },
  };
  const base = {
    command_id: "original",
    arrival_tick: "0",
    aigent_id: "a",
    session_epoch: "1",
    sequence: "1",
    idempotency_key: "key",
    kind: 1,
    payload: { value: 1 },
    encoded_frame_bytes: 1,
    mutation_delta: 1,
  };
  const conflict = {
    ...base,
    command_id: "conflict",
    arrival_tick: "1",
    session_epoch: "2",
    payload: { value: 2 },
  };
  const recovered = evaluateScenario({}, [
    { op: "admit", now_hour: 0, commands: [base] }, { op: "commit" }, { op: "install" }, { op: "deliver" },
    { op: "admit", now_hour: 25, commands: [conflict] }, { op: "commit" }, { op: "install" }, { op: "deliver" },
    { op: "cold_restart", checkpoint, running_build_id: "same-build" },
    { op: "cold_restart", checkpoint, running_build_id: "same-build" },
    { op: "expire_retention", now_hour: 49 },
    { op: "inspect_retention" },
  ]);
  assert.equal(recovered.trace.filter(({ type }) => type === "recovery_reconstructed").length, 2);
  assert.equal(recovered.trace.filter(({ type, reason }) => type === "command_result" && reason === "IDEMPOTENCY_CONFLICT").length, 1);
  assert.deepEqual(recovered.trace.at(-1), {
    type: "retention_state",
    idempotency_count: 0,
    durable_result_count: 0,
  });
  assert.equal(recovered.final_state.world_value, 1);

  const unavailable = evaluateScenario({}, [
    { op: "admit", now_hour: 0, commands: [base] }, { op: "commit" }, { op: "install" }, { op: "deliver" },
    {
      op: "admit",
      now_hour: 1,
      commands: [{
        ...base,
        command_id: "unavailable",
        arrival_tick: "1",
        session_epoch: "2",
        available: false,
        payload_bytes: "different-wire-payload",
      }],
    },
    { op: "commit" }, { op: "install" }, { op: "deliver" },
    { op: "cold_restart", checkpoint, running_build_id: "same-build" },
  ]);
  assert.equal(unavailable.trace.at(-1).type, "recovery_reconstructed");
  assert.equal(unavailable.final_state.world_value, 1);
});

test("results precede resumable events across the post-result crash boundary", () => {
  const command = {
    command_id: "eventful",
    arrival_tick: "0",
    aigent_id: "a",
    session_epoch: "1",
    sequence: "1",
    idempotency_key: "eventful",
    kind: 1,
    payload: {},
    encoded_frame_bytes: 1,
    events: [{ stream_id: "7", bytes: 1, payload: "hello" }],
  };
  const delivered = evaluateScenario({}, [
    { op: "admit", commands: [command] }, { op: "commit" }, { op: "install" },
    { op: "deliver_results" },
    { op: "crash", phase: "post_result" },
    {
      op: "cold_restart",
      running_build_id: "same-build",
      checkpoint: {
        generation: 0,
        build_id: "same-build",
        replay_version: 1,
        digest_contract_version: 1,
        rng_contract_version: 1,
        world_seed: "00".repeat(32),
        next_stream_epoch: "1",
        next_ordinal: "1",
        last_commit_hour: 0,
        component_generations: { world: 0, allocator: 0, ruleset: 0, sessions: 0, idempotency: 0, events: 0, rng: 0 },
      },
    },
    { op: "resume", stream_id: "7", stream_epoch: "1", last_acknowledged: "0" },
  ]);
  assert.deepEqual(delivered.trace.slice(-4).map(({ type }) => type), [
    "command_result",
    "crashed",
    "recovery_reconstructed",
    "events_replayed",
  ]);

  const initial = {
    next_stream_epoch: "6",
    streams: {
      "7": {
        epoch: "5",
        next_sequence: "4",
        acknowledged: "0",
        events: [
          { sequence: "2", bytes: 1, committed_at: 0, ordinal: "2" },
          { sequence: "3", bytes: 1, committed_at: 0, ordinal: "3" },
        ],
        evicted: [{ sequence: "1", reason: "age" }],
      },
    },
  };
  assert.deepEqual(evaluateScenario(initial, [{ op: "resume", stream_id: "7", stream_epoch: "5", last_acknowledged: "0" }]).trace, [{
    type: "event_stream_reset", stream_id: "7", unavailable_from: "1", unavailable_through: "3", epoch: "6",
  }]);
  assert.deepEqual(evaluateScenario(initial, [{ op: "resume", stream_id: "7", stream_epoch: "5", last_acknowledged: "4" }]).trace, [{
    type: "event_resume_rejected", stream_id: "7", sequence: "4", reason: "CURSOR_AHEAD",
  }]);
  assert.deepEqual(evaluateScenario(initial, [{ op: "resume", stream_id: "7", stream_epoch: "4", last_acknowledged: "0" }]).trace, [{
    type: "event_cursor_resync", stream_id: "7", epoch: "5",
  }]);
});

test("writer completion is one-shot and malformed durable inputs never enter pending state", () => {
  const base = {
    command_id: "validated",
    arrival_tick: "0",
    aigent_id: "a",
    session_epoch: "1",
    sequence: "1",
    idempotency_key: "validated",
    kind: 1,
    payload: {},
    encoded_frame_bytes: 1,
    events: [{ stream_id: "7", bytes: 1 }],
  };
  const duplicate = evaluateScenario({}, [
    { op: "admit", commands: [base] },
    { op: "commit" },
    { op: "commit" },
    { op: "install" },
    { op: "deliver" },
  ]);
  assert.equal(duplicate.trace.filter(({ type }) => type === "generation_committed").length, 1);
  assert.deepEqual(duplicate.final_state.streams["7"].retained_sequences, ["1"]);
  assert.deepEqual(evaluateScenario({}, [{
    op: "admit", now_hour: 1.5, commands: [base],
  }]).trace, [{ type: "admission_rejected", reason: "invalid_commit_clock" }]);
  assert.deepEqual(evaluateScenario({ writer_occupied: true }, [{
    op: "admit",
    commands: [{ ...base, encoded_frame_bytes: MAX_DURABLE_BYTES_PER_GENERATION + 1 }],
  }]).trace, [{
    type: "protocol_error",
    command_id: "validated",
    code: "PERSISTENCE_BACKPRESSURE",
    retry_after_ticks: 1,
  }]);
  for (const invalid of [
    { ...base, mutation_delta: Number.MAX_SAFE_INTEGER + 1 },
    { ...base, events: [{ stream_id: "-1", bytes: 1 }] },
    { ...base, events: [{ stream_id: "7", bytes: -5 }] },
  ]) {
    assert.deepEqual(evaluateScenario({}, [{ op: "admit", commands: [invalid] }]).trace, [
      { type: "admission_rejected", reason: "invalid_command_metadata" },
    ]);
  }
  assert.throws(() => evaluateScenario({ world_value: Number.MAX_SAFE_INTEGER }, [
    { op: "admit", commands: [{ ...base, mutation_delta: 1 }] },
    { op: "commit" },
  ]), /world value exceeds safe semantic range/);
  assert.throws(() => evaluateScenario({}, [
    { op: "admit", commands: [{ ...base, domain: "rejected", reason: 42 }] },
    { op: "commit" },
  ]), /invalid authoritative command result/);
});

test("counter-based draws are deterministic and distinguish named input", () => {
  const seed = "000102030405060708090a0b0c0d0e0f101112131415161718191a1b1c1d1e1f";
  const input = { rng_contract_version: 1, subsystem: "world", purpose: "spawn", generation: 7, canonical_command_index: 2, entity_id: "9", draw_index: 0 };
  assert.deepEqual(deterministicDraw(seed, input, 1000), deterministicDraw(seed, input, 1000));
  assert.notEqual(deterministicDraw(seed, input, 1000).raw, deterministicDraw(seed, { ...input, draw_index: 1 }, 1000).raw);
  const draw = deterministicDraw(seed, input, 1000);
  assert.deepEqual(evaluateScenario({}, [{ op: "rng", world_seed: seed, input, bound: 1000, stored: draw }]).trace, [{
    type: "rng_draw_verified", verified: true, ...draw,
  }]);
  assert.equal(evaluateScenario({}, [{ op: "rng", world_seed: seed, input, bound: 1000, stored: { ...draw, value: draw.value + 1 } }]).trace[0].verified, false);
  const rejectionSeed = "1e".padStart(64, "0");
  const rejectionInput = { ...input, purpose: "reject", generation: 1, canonical_command_index: 0, entity_id: "0" };
  const rejected = deterministicDraw(rejectionSeed, rejectionInput, "9223372036854775809");
  assert.equal(rejected.rejection_block, 1);
  assert.equal(rejected.blocks.length, 2);
  assert.equal(rejected.blocks[0].hmac, "a97dd788ae6c9a85e9e76b3865f5abafc8054ea588cf56ecd2cf3ac2f4588d1e");
  assert.equal(evaluateScenario({}, [{ op: "rng", world_seed: rejectionSeed, input: rejectionInput, bound: "9223372036854775809", stored: { ...rejected, blocks: [{ ...rejected.blocks[0], hmac: "00".repeat(32) }, rejected.blocks[1]] } }]).trace[0].verified, false);
  const spatial = deterministicDraw(seed, { ...input, generation: undefined, stable_spatial_coordinates: { x: "-2", z: "3" } }, "18446744073709551616");
  assert.equal(spatial.hmac, "e5415d1a31dae57d44e39557cd43ee22d1d5972872a9e43a7acf9c779746c598");
  assert.deepEqual(deterministicDraw(seed, input, 1000), draw);
  assert.throws(() => deterministicDraw(seed, input, "18446744073709551617"), /invalid RNG/);
  assert.throws(() => deterministicDraw(seed, { ...input, generation: undefined }, 1000), /invalid RNG/);
  assert.throws(() => deterministicDraw(seed, { ...input, stable_spatial_coordinates: { x: "0", z: "0" } }, 1000), /invalid RNG/);
  assert.throws(() => deterministicDraw(seed, {
    ...input,
    generation: undefined,
    stable_spatial_coordinates: { x: 9007199254740993, z: "0" },
  }, 1000), /invalid RNG/);
  assert.throws(() => deterministicDraw(seed, {
    ...input,
    generation: undefined,
    stable_spatial_coordinates: { x: "-0", z: "0" },
  }, 1000), /invalid RNG/);
});

test("commit re-derives complete RNG audits before any authoritative mutation", () => {
  const seed = "000102030405060708090a0b0c0d0e0f101112131415161718191a1b1c1d1e1f";
  const input = { rng_contract_version: 1, subsystem: "world", purpose: "spawn", generation: 1, canonical_command_index: 0, entity_id: "1", draw_index: 0 };
  const output = deterministicDraw(seed, input, 1000);
  const command = {
    command_id: "rng-commit",
    arrival_tick: "0",
    aigent_id: "a",
    session_epoch: "1",
    sequence: "1",
    idempotency_key: "rng-commit",
    kind: 1,
    payload: {},
    encoded_frame_bytes: 1,
    rng_audit: [{ input, bound: "1000", output }],
  };
  const committed = evaluateScenario({ world_seed: seed }, [{ op: "admit", commands: [command] }, { op: "commit" }]);
  assert.equal(committed.trace.at(-1).type, "generation_committed");
  assert.throws(() => evaluateScenario({ world_seed: seed }, [
    { op: "admit", commands: [{ ...command, rng_audit: [{ input, bound: "1000", output: { ...output, blocks: [] } }] }] },
    { op: "commit" },
  ]), /invalid RNG audit evidence/);
  for (const mismatchedInput of [
    { ...input, generation: 2 },
    { ...input, canonical_command_index: 1 },
  ]) {
    assert.throws(() => evaluateScenario({ world_seed: seed }, [
      { op: "admit", commands: [{
        ...command,
        rng_audit: [{
          input: mismatchedInput,
          bound: "1000",
          output: deterministicDraw(seed, mismatchedInput, 1000),
        }],
      }] },
      { op: "commit" },
    ]), /does not belong to committed command/);
  }
});

test("stream epochs are nonzero and event sequences are unique within an epoch", () => {
  assert.throws(() => evaluateScenario({ streams: { "1": { epoch: "0" } } }, []), /event cursor/);
  assert.throws(() => evaluateScenario({ streams: { "1": { events: [
    { sequence: "1", bytes: 1, committed_at: 0, ordinal: "1" },
    { sequence: "1", bytes: 1, committed_at: 0, ordinal: "2" },
  ] } } }, []), /invalid stream event sequence/);
  assert.throws(() => evaluateScenario({ streams: { "1": {
    epoch: "1",
    next_sequence: "4",
    acknowledged: "0",
    events: [
      { sequence: "1", bytes: 1, committed_at: 0, ordinal: "1" },
      { sequence: "3", bytes: 1, committed_at: 0, ordinal: "3" },
    ],
  } } }, []), /non-contiguous stream history/);
});

test("opaque byte identities, canonical oversize cuts, and monotonic clocks are executable", () => {
  const opaque = {
    command_id: "opaque",
    arrival_tick: "0",
    aigent_id: "hex:00ff",
    session_epoch: "hex:deadbeef",
    sequence: "1",
    idempotency_key: "hex:0001",
    kind: 1,
    payload: {},
    encoded_frame_bytes: 1,
  };
  assert.equal(evaluateScenario({}, [{ op: "admit", commands: [opaque] }]).trace[0].type, "generation_admitted");

  const command = (id, sequence, size) => ({
    command_id: id,
    arrival_tick: "1",
    aigent_id: "a",
    session_epoch: "opaque-epoch",
    sequence,
    idempotency_key: id,
    kind: 1,
    payload: {},
    encoded_frame_bytes: size,
  });
  const cut = evaluateScenario({}, [{
    op: "admit",
    commands: [
      command("fit", "1", 1),
      command("huge", "2", MAX_DURABLE_BYTES_PER_GENERATION + 1),
      command("later", "3", 1),
    ],
  }]);
  assert.deepEqual(cut.trace, [
    { type: "generation_admitted", generation: 1, command_ids: ["fit"], bytes: 1 },
    { type: "protocol_error", command_id: "huge", code: "PERSISTENCE_RECORD_TOO_LARGE", connection_closed: true },
    { type: "protocol_error", command_id: "later", code: "PERSISTENCE_BACKPRESSURE", retry_after_ticks: 1 },
  ]);
  assert.equal(evaluateScenario({}, [{ op: "admit", commands: [command("exact", "1", MAX_DURABLE_BYTES_PER_GENERATION)] }]).trace[0].bytes, MAX_DURABLE_BYTES_PER_GENERATION);
  const suffixClassification = evaluateScenario({}, [{
    op: "admit",
    commands: [
      command("fills-generation", "1", MAX_DURABLE_BYTES_PER_GENERATION),
      command("capacity-cut", "2", 1),
      command("intrinsically-oversized", "3", MAX_DURABLE_BYTES_PER_GENERATION + 1),
    ],
  }]);
  assert.deepEqual(suffixClassification.trace.slice(1), [
    { type: "protocol_error", command_id: "capacity-cut", code: "PERSISTENCE_BACKPRESSURE", retry_after_ticks: 1 },
    { type: "protocol_error", command_id: "intrinsically-oversized", code: "PERSISTENCE_RECORD_TOO_LARGE", connection_closed: true },
  ]);
  for (const invalidDigestInput of [
    { payload_mode: 256, canonical_payload_hex: "" },
    { payload_mode: 1 },
    { payload_mode: 2 },
    { payload_mode: 0, available: false },
    { payload_mode: 0, invalid: true },
    { payload_mode: 0, canonical_payload_hex: "zz" },
    { payload_mode: 0, canonical_payload_hex: "0f0" },
  ]) {
    assert.deepEqual(evaluateScenario({}, [{
      op: "admit",
      commands: [{ ...command("invalid-digest-input", "1", 1), ...invalidDigestInput }],
    }]).trace, [{ type: "admission_rejected", reason: "invalid_command_metadata" }]);
  }
  assert.throws(() => evaluateScenario({
    generation: "18446744073709551615",
    installed_generation: "18446744073709551615",
    published_generation: "18446744073709551615",
  }, [{ op: "admit", commands: [command("after-generation-max", "1", 1)] }]), /generation allocator exhausted/);

  const clocked = evaluateScenario({}, [
    { op: "admit", now_hour: 10, commands: [command("first", "1", 1)] }, { op: "commit" }, { op: "install" }, { op: "deliver" },
    { op: "admit", now_hour: 5, commands: [command("second", "2", 1)] }, { op: "commit" },
    { op: "inspect_clock" },
  ]);
  assert.deepEqual(clocked.trace.at(-1), { type: "commit_clock", hour: 10 });
  const maintenanceAdvanced = evaluateScenario({}, [
    { op: "admit", now_hour: 0, commands: [command("pending", "1", 1)] },
    { op: "evict_events", now_hour: 50 },
    { op: "commit" },
    { op: "inspect_clock" },
  ]);
  assert.deepEqual(maintenanceAdvanced.trace.at(-1), { type: "commit_clock", hour: 50 });
});

test("recovery is atomic, build-bound, u64-safe, and rejects incomplete checkpoints", () => {
  const checkpoint = {
    generation: 0,
    build_id: "build-a",
    replay_version: 1,
    digest_contract_version: 1,
    rng_contract_version: 1,
    world_seed: "00".repeat(32),
    next_stream_epoch: "1",
    next_ordinal: "1",
    last_commit_hour: 0,
    component_generations: { world: 0, allocator: 0, ruleset: 0, sessions: 0, idempotency: 0, events: 0, rng: 0 },
  };
  const outcome = (sequence, prior, delta) => {
    const command = {
      command_id: `recovered-${sequence}`,
      arrival_tick: "1",
      aigent_id: "a",
      session_epoch: "epoch",
      sequence,
      idempotency_key: `key-${sequence}`,
      protocol_major: 1,
      kind: 1,
      required_features: [],
      payload_mode: 0,
      canonical_payload_hex: "",
    };
    return {
      build_id: "build-a",
      replay_version: 1,
      prior_generation: prior,
      command,
      digest: semanticCommandDigest(command),
      result: { outcome: "accepted", mutation_delta: delta },
      encoded_frame_bytes: 1,
      generation_record_count: 1,
      alias: false,
      preserve_idempotency: false,
      committed_at: 1,
      events: [],
      rng_audit: [],
    };
  };
  const first = recoveryFrame({ payload: outcome("1", 0, 1), generation: 1 });
  const gap = recoveryFrame({ payload: outcome("3", 1, 2), generation: 2 });
  const failed = evaluateScenario({ world_value: 99 }, [{ op: "recover", checkpoint, running_build_id: "build-a", records: [first, gap] }]);
  assert.equal(failed.trace[0].type, "recovery_failed");
  assert.equal(failed.final_state.world_value, 99);
  assert.deepEqual(evaluateScenario({}, [{ op: "recover", checkpoint, running_build_id: "build-b", records: [first] }]).trace, [
    { type: "recovery_failed", reason: "checkpoint_incompatible" },
  ]);
  assert.equal(evaluateScenario({}, [{ op: "recover", checkpoint: { ...checkpoint, component_generations: {} }, running_build_id: "build-a", records: [] }]).trace[0].type, "recovery_failed");
  assert.equal(evaluateScenario({}, [{ op: "recover", checkpoint: { ...checkpoint, next_stream_epoch: undefined }, running_build_id: "build-a", records: [] }]).trace[0].type, "recovery_failed");
  assert.equal(evaluateScenario({}, [{ op: "recover", checkpoint: { ...checkpoint, next_ordinal: undefined }, running_build_id: "build-a", records: [] }]).trace[0].type, "recovery_failed");
  assert.deepEqual(evaluateScenario({}, [{ op: "recover", checkpoint: { ...checkpoint, last_commit_hour: undefined }, running_build_id: "build-a", records: [] }]).trace, [
    { type: "recovery_failed", reason: "checkpoint_incompatible" },
  ]);
  assert.equal(evaluateScenario({}, [{
    op: "recover",
    checkpoint: { ...checkpoint, expected_sequences: { malformed: "1" } },
    running_build_id: "build-a",
    records: [],
  }]).trace[0].type, "recovery_failed");
  assert.equal(evaluateScenario({}, [{
    op: "recover",
    checkpoint: { ...checkpoint, idempotency: { malformed: {} } },
    running_build_id: "build-a",
    records: [],
  }]).trace[0].type, "recovery_failed");
  const conflictKey = '["1:61",1,"1:6b"]';
  const conflictCheckpoint = {
    ...checkpoint,
    idempotency: {
      [conflictKey]: {
        digest: "a".repeat(64),
        result: { outcome: "accepted", mutation_delta: 1 },
        committed_at: 0,
        live_epochs: ['["1:61","1:31"]', '["1:61","1:32"]'],
      },
    },
    durable_results: {
      '["1:61","1:32","1"]': {
        key: conflictKey,
        digest: "b".repeat(64),
        result: { outcome: "rejected", reason: "IDEMPOTENCY_CONFLICT" },
        committed_at: 0,
        live_epoch: true,
      },
    },
  };
  assert.equal(evaluateScenario({}, [{
    op: "recover", checkpoint: conflictCheckpoint, running_build_id: "build-a", records: [],
  }]).trace[0].type, "recovery_reconstructed");
  const normalCommand = {
    command_id: "normal",
    arrival_tick: "0",
    aigent_id: "a",
    session_epoch: "1",
    sequence: "1",
    idempotency_key: "key",
    kind: 1,
    payload: {},
    encoded_frame_bytes: 1,
  };
  const orphanedSessionResultCheckpoint = {
    ...checkpoint,
    expected_sequences: { '["1:61","1:31"]': "2" },
    durable_results: {
      '["1:61","1:31","1"]': {
        key: '["1:61",1,"3:6b6579"]',
        digest: semanticCommandDigest(normalCommand),
        result: { outcome: "accepted", mutation_delta: 0 },
        committed_at: 0,
        live_epoch: false,
      },
    },
  };
  const orphanedSessionResult = evaluateScenario({}, [
    {
      op: "recover",
      checkpoint: orphanedSessionResultCheckpoint,
      running_build_id: "build-a",
      records: [],
    },
    { op: "admit", commands: [normalCommand] },
  ]);
  assert.equal(orphanedSessionResult.trace[0].type, "recovery_reconstructed");
  assert.deepEqual(orphanedSessionResult.trace.at(-1), {
    type: "command_result_replayed",
    command_id: "normal",
    result: { outcome: "accepted", mutation_delta: 0 },
  });
  const unavailableCommand = {
    ...normalCommand,
    command_id: "unavailable",
    sequence: "2",
    available: false,
    payload_bytes: "wire",
  };
  const availabilityKey = '["1:61",1,"3:6b6579"]';
  const availabilityCheckpoint = {
    ...checkpoint,
    generation: 2,
    component_generations: Object.fromEntries(Object.keys(checkpoint.component_generations).map((key) => [key, 2])),
    last_commit_hour: 1,
    expected_sequences: { '["1:61","1:31"]': "3" },
    idempotency: {
      [availabilityKey]: {
        digest: semanticCommandDigest(normalCommand),
        result: { outcome: "accepted", mutation_delta: 0 },
        committed_at: 0,
        live_epochs: [],
      },
    },
    durable_results: {
      '["1:61","1:31","2"]': {
        key: availabilityKey,
        digest: semanticCommandDigest(unavailableCommand),
        result: { outcome: "rejected", reason: "UNSUPPORTED_MESSAGE" },
        committed_at: 1,
        live_epoch: false,
      },
    },
  };
  assert.equal(evaluateScenario({}, [{
    op: "recover",
    checkpoint: availabilityCheckpoint,
    running_build_id: "build-a",
    records: [],
  }]).trace[0].type, "recovery_reconstructed");
  assert.equal(evaluateScenario({}, [{
    op: "recover",
    checkpoint: {
      ...checkpoint,
      next_ordinal: "2",
      streams: {
        "1": {
          epoch: "1",
          next_sequence: "2",
          acknowledged: "0",
          events: [{ sequence: "1", ordinal: "1", bytes: 1, committed_at: 100 }],
        },
      },
    },
    running_build_id: "build-a",
    records: [],
  }]).trace[0].type, "recovery_failed");
  const checkpointOne = { ...checkpoint, generation: 1, component_generations: Object.fromEntries(Object.keys(checkpoint.component_generations).map((key) => [key, 1])) };
  assert.equal(evaluateScenario({}, [{ op: "recover", checkpoint: checkpointOne, running_build_id: "build-a", records: [first] }]).trace[0].type, "recovery_failed");

  const maxPrior = "18446744073709551614";
  const maximum = "18446744073709551615";
  const highCheckpoint = {
    ...checkpoint,
    generation: maxPrior,
    component_generations: Object.fromEntries(Object.keys(checkpoint.component_generations).map((key) => [key, maxPrior])),
  };
  const highPayload = outcome("1", maxPrior, 1);
  const highFrame = recoveryFrame({ payload: highPayload, generation: maximum, prior_generation: maxPrior });
  assert.equal(evaluateScenario({}, [{ op: "recover", checkpoint: highCheckpoint, running_build_id: "build-a", records: [highFrame] }]).trace[0].generation, maximum);

  const invalidResult = outcome("1", 0, 1);
  invalidResult.result = { outcome: "not-a-command-result" };
  assert.equal(evaluateScenario({}, [{
    op: "recover",
    checkpoint,
    running_build_id: "build-a",
    records: [recoveryFrame({ payload: invalidResult, generation: 1 })],
  }]).trace[0].type, "recovery_failed");
  assert.equal(evaluateScenario({}, [{
    op: "recover",
    checkpoint: { ...checkpoint, last_commit_hour: 2 },
    running_build_id: "build-a",
    records: [first],
  }]).trace[0].type, "recovery_failed");
  const wrongRngInput = {
    rng_contract_version: 1,
    subsystem: "world",
    purpose: "spawn",
    generation: 999,
    canonical_command_index: 0,
    entity_id: "1",
    draw_index: 0,
  };
  const wrongRng = outcome("1", 0, 1);
  wrongRng.rng_audit = [{
    input: wrongRngInput,
    bound: "10",
    output: deterministicDraw(checkpoint.world_seed, wrongRngInput, "10"),
  }];
  assert.equal(evaluateScenario({}, [{
    op: "recover",
    checkpoint,
    running_build_id: "build-a",
    records: [recoveryFrame({ payload: wrongRng, generation: 1 })],
  }]).trace[0].type, "recovery_failed");

  const firstOfTwo = { ...outcome("1", 0, 1), generation_record_count: 2 };
  const secondOfTwo = { ...outcome("2", 0, 2), generation_record_count: 2 };
  const twoRecordGeneration = [
    recoveryFrame({ payload: firstOfTwo, generation: 1, ordinal: 0 }),
    recoveryFrame({ payload: secondOfTwo, generation: 1, ordinal: 1 }),
  ];
  assert.equal(evaluateScenario({}, [{
    op: "recover", checkpoint, running_build_id: "build-a", records: twoRecordGeneration.slice(0, 1),
  }]).trace[0].type, "recovery_failed");
  const inconsistentCount = structuredClone(twoRecordGeneration);
  inconsistentCount[1] = recoveryFrame({
    payload: { ...secondOfTwo, generation_record_count: 1 },
    generation: 1,
    ordinal: 1,
  });
  assert.equal(evaluateScenario({}, [{
    op: "recover", checkpoint, running_build_id: "build-a", records: inconsistentCount,
  }]).trace[0].type, "recovery_failed");
  assert.equal(evaluateScenario({}, [{
    op: "recover", checkpoint, running_build_id: "build-a", records: twoRecordGeneration,
  }]).trace[0].world_value, 3);

  const incompleteEvent = structuredClone(outcome("1", 0, 1));
  incompleteEvent.events = [{ stream_id: "7", bytes: 1, payload: "missing-cursors" }];
  assert.equal(evaluateScenario({}, [{
    op: "recover",
    checkpoint,
    running_build_id: "build-a",
    records: [recoveryFrame({ payload: incompleteEvent, generation: 1 })],
  }]).trace[0].type, "recovery_failed");

  const retainedKey = '["1:61",1,"1:6b"]';
  const retainedCheckpoint = {
    ...checkpoint,
    idempotency: {
      [retainedKey]: {
        digest: "a".repeat(64),
        result: { outcome: "accepted", mutation_delta: 1 },
        committed_at: 0,
        live_epochs: ['["1:61","1:31"]'],
      },
    },
  };
  const impossibleConflict = outcome("1", 0, 99);
  impossibleConflict.command.session_epoch = "2";
  impossibleConflict.command.idempotency_key = "k";
  impossibleConflict.command.canonical_payload_hex = "01";
  impossibleConflict.digest = semanticCommandDigest(impossibleConflict.command);
  impossibleConflict.preserve_idempotency = true;
  assert.equal(evaluateScenario({}, [{
    op: "recover",
    checkpoint: retainedCheckpoint,
    running_build_id: "build-a",
    records: [recoveryFrame({ payload: impossibleConflict, generation: 1 })],
  }]).trace[0].type, "recovery_failed");
  const canonicalConflict = structuredClone(impossibleConflict);
  canonicalConflict.result = { outcome: "rejected", reason: "IDEMPOTENCY_CONFLICT" };
  assert.equal(evaluateScenario({}, [{
    op: "recover",
    checkpoint: retainedCheckpoint,
    running_build_id: "build-a",
    records: [recoveryFrame({ payload: canonicalConflict, generation: 1 })],
  }]).trace[0].world_value, 0);

  const wrongEventCursor = structuredClone(outcome("1", 0, 1));
  wrongEventCursor.events = [{
    stream_id: "7",
    stream_epoch: "1",
    sequence: "1",
    ordinal: "2",
    bytes: 1,
    committed_at: 1,
    payload: "wrong-ordinal",
  }];
  assert.equal(evaluateScenario({}, [{
    op: "recover",
    checkpoint,
    running_build_id: "build-a",
    records: [recoveryFrame({ payload: wrongEventCursor, generation: 1 })],
  }]).trace[0].type, "recovery_failed");
});

test("event epochs are mandatory and reset allocation never fills historical gaps", () => {
  assert.deepEqual(evaluateScenario({}, [{ op: "ack", stream_id: "99", sequence: "0" }]).final_state.streams, {});
  assert.deepEqual(evaluateScenario({}, [{
    op: "resume", stream_id: "99", stream_epoch: 1, last_acknowledged: "0",
  }]).final_state.streams, {});
  assert.deepEqual(evaluateScenario({}, [{
    op: "ack", stream_id: "99", stream_epoch: "1", sequence: "0",
  }]).trace, [{ type: "event_cursor_invalid", stream_id: "99", reason: "UNKNOWN_STREAM" }]);
  const initial = {
    streams: {
      "1": { epoch: "1", next_sequence: "2", events: [], evicted: [{ sequence: "1", reason: "age" }] },
      "2": { epoch: "3", next_sequence: "2", events: [], evicted: [{ sequence: "1", reason: "age" }] },
    },
  };
  assert.deepEqual(evaluateScenario(initial, [{ op: "resume", stream_id: "1", last_acknowledged: "0" }]).trace, [
    { type: "event_cursor_invalid", stream_id: "1", reason: "MISSING_EPOCH" },
  ]);
  const resets = evaluateScenario(initial, [
    { op: "resume", stream_id: "1", stream_epoch: "1", last_acknowledged: "0" },
    { op: "resume", stream_id: "2", stream_epoch: "3", last_acknowledged: "0" },
  ]);
  assert.deepEqual(resets.trace.map(({ epoch }) => epoch), ["4", "5"]);

  const acknowledged = evaluateScenario({
    streams: {
      "1": {
        epoch: "1",
        next_sequence: "3",
        acknowledged: "0",
        events: [
          { sequence: "1", stream_epoch: "1", ordinal: "1", bytes: 1, committed_at: 0 },
          { sequence: "2", stream_epoch: "1", ordinal: "2", bytes: 1, committed_at: 0 },
        ],
      },
    },
    next_ordinal: "3",
  }, [
    { op: "ack", stream_id: "1", stream_epoch: "1", sequence: "1" },
    { op: "ack", stream_id: "1", stream_epoch: "1", sequence: "1" },
    { op: "ack", stream_id: "1", stream_epoch: "1", sequence: "3" },
  ]);
  assert.deepEqual(acknowledged.trace, [
    { type: "event_acknowledged", stream_id: "1", sequence: "1" },
    { type: "event_acknowledged", stream_id: "1", sequence: "1" },
    { type: "event_ack_rejected", stream_id: "1", sequence: "3", reason: "ACK_AHEAD" },
  ]);
  assert.deepEqual(acknowledged.final_state.streams["1"].retained_sequences, ["2"]);
});

test("event cursors cover uint64 maxima and allocator exhaustion is deterministic", () => {
  const maximum = "18446744073709551615";
  const predecessor = "18446744073709551614";
  const maxState = {
    next_stream_epoch: null,
    streams: {
      "7": {
        epoch: maximum,
        next_sequence: null,
        acknowledged: predecessor,
        events: [{ sequence: maximum, stream_epoch: maximum, bytes: 1, committed_at: 0, ordinal: "1" }],
      },
    },
  };
  assert.deepEqual(evaluateScenario(maxState, [{
    op: "resume", stream_id: "7", stream_epoch: maximum, last_acknowledged: predecessor,
  }]).trace, [{ type: "events_replayed", stream_id: "7", sequences: [maximum] }]);
  assert.throws(() => evaluateScenario({ streams: { "1": { epoch: "18446744073709551616" } } }, []), /event cursor/);

  const exhaustedReset = structuredClone(maxState);
  exhaustedReset.streams["7"].events = [];
  exhaustedReset.streams["7"].evicted = [{ sequence: maximum, reason: "age" }];
  assert.throws(() => evaluateScenario(exhaustedReset, [{
    op: "resume", stream_id: "7", stream_epoch: maximum, last_acknowledged: predecessor,
  }]), /stream epoch allocator exhausted/);

  const eventful = {
    command_id: "event-at-max-epoch",
    arrival_tick: "0",
    aigent_id: "a",
    session_epoch: "1",
    sequence: "1",
    idempotency_key: "event-at-max-epoch",
    kind: 1,
    payload: {},
    encoded_frame_bytes: 1,
    events: [{ stream_id: "9", bytes: 1 }],
  };
  const allocatedMaximum = evaluateScenario({ next_stream_epoch: maximum }, [
    { op: "admit", commands: [eventful] }, { op: "commit" }, { op: "install" },
  ]);
  assert.equal(allocatedMaximum.final_state.streams["9"].epoch, maximum);

  assert.throws(() => evaluateScenario({
    streams: { "9": { epoch: "1", next_sequence: null, acknowledged: maximum, events: [] } },
  }, [{ op: "admit", commands: [eventful] }, { op: "commit" }]), /event sequence allocator exhausted/);

  const ordinalAtMaximum = evaluateScenario({ next_ordinal: maximum }, [
    { op: "admit", commands: [eventful] }, { op: "commit" }, { op: "install" }, { op: "deliver" },
  ]);
  assert.equal(ordinalAtMaximum.trace.at(-1).ordinal, maximum);
  assert.throws(() => evaluateScenario({ next_ordinal: maximum }, [
    { op: "admit", commands: [{ ...eventful, events: [{ stream_id: "9", bytes: 1 }, { stream_id: "9", bytes: 1 }] }] },
    { op: "commit" },
  ]), /event ordinal allocator exhausted/);
  assert.deepEqual(evaluateScenario({ streams: { "1": { epoch: "1" } } }, [{
    op: "ack", stream_id: "1", stream_epoch: 1, sequence: "0",
  }]).trace, [{ type: "event_cursor_invalid", stream_id: "1", reason: "INVALID_UINT64" }]);
  assert.deepEqual(evaluateScenario({ streams: { "1": { epoch: "1" } } }, [{
    op: "resume", stream_id: "1", stream_epoch: "1", last_acknowledged: 0,
  }]).trace, [{ type: "event_cursor_invalid", stream_id: "1", reason: "INVALID_UINT64" }]);
});

test("semantic oracle has no wall-clock, network, or ambient-random dependency", () => {
  const source = fs.readFileSync(path.join(root, "scripts/replay-contract.mjs"), "utf8");
  assert.doesNotMatch(source, /Date\.now|new Date|Math\.random|fetch\(|https?:\/\//);
  assert.match(source, /createHmac\("sha256"/);
});

test("replay contract relative links resolve", () => {
  const contractPath = path.join(root, "replay/v1/CONTRACT.md");
  const contract = fs.readFileSync(contractPath, "utf8");
  const links = [...contract.matchAll(/\]\(([^)#]+)(?:#[^)]+)?\)/g)].map(([, link]) => link);
  assert.ok(links.length > 0);
  for (const link of links) {
    assert.ok(fs.existsSync(path.resolve(path.dirname(contractPath), link)), link);
  }
});
