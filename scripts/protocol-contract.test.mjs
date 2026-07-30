import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import {
  canonicalize,
  evaluateScenario,
  loadFixture,
  validateFixture,
} from "./protocol-contract.mjs";

const fixture = loadFixture();
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

test("all protocol v1 semantic fixtures match their expected trace", () => {
  validateFixture(fixture);
  for (const scenario of fixture.cases) {
    assert.deepEqual(
      canonicalize(
        evaluateScenario(
          scenario.initial,
          scenario.steps,
          scenario.inspect,
        ),
      ),
      canonicalize(scenario.expect),
      scenario.id,
    );
  }
});

test("major and feature offer order cannot change negotiation", () => {
  const scenario = fixture.cases.find(
    ({ id }) => id === "negotiates-highest-major-and-feature-versions",
  );
  assert.ok(scenario);

  const reversed = structuredClone(scenario);
  reversed.initial.compatibility.reverse();
  reversed.steps[0].offered_majors.reverse();
  reversed.steps[0].offered_features.reverse();
  for (const offer of reversed.steps[0].offered_features) {
    offer.supported_versions.reverse();
  }

  assert.deepEqual(
    canonicalize(evaluateScenario(scenario.initial, scenario.steps)),
    canonicalize(evaluateScenario(reversed.initial, reversed.steps)),
  );
});

test("malformed offers and missing command epochs produce typed handshake rejection", () => {
  const scenario = fixture.cases.find(
    ({ id }) => id === "negotiates-highest-major-and-feature-versions",
  );
  assert.ok(scenario);

  const duplicateMajor = structuredClone(scenario.steps[0]);
  duplicateMajor.offered_majors = [2, 2];
  assert.deepEqual(
    evaluateScenario(scenario.initial, [duplicateMajor]).trace,
    [{ type: "handshake_rejected", code: "invalid_envelope" }],
  );

  const duplicateFeature = structuredClone(scenario.steps[0]);
  duplicateFeature.offered_features.push(
    structuredClone(duplicateFeature.offered_features[0]),
  );
  assert.deepEqual(
    evaluateScenario(scenario.initial, [duplicateFeature]).trace,
    [{ type: "handshake_rejected", code: "invalid_envelope" }],
  );

  const malformedUnknownFeature = structuredClone(scenario.steps[0]);
  malformedUnknownFeature.offered_features = [
    { feature_id: "unknown_feature", supported_versions: [0] },
  ];
  assert.deepEqual(
    evaluateScenario(scenario.initial, [malformedUnknownFeature]).trace,
    [{ type: "handshake_rejected", code: "invalid_envelope" }],
  );

  const missingEpoch = structuredClone(scenario.steps[0]);
  delete missingEpoch.session_epoch;
  assert.deepEqual(
    evaluateScenario(scenario.initial, [missingEpoch]).trace,
    [{ type: "handshake_rejected", code: "invalid_envelope" }],
  );
});

test("a deprecated major becomes spectate-only after its support horizon", () => {
  const initial = {
    compatibility: [
      {
        major: 1,
        command_capable: true,
        decoder: true,
        spectator_projection: true,
        deprecated_at_unix_ms: 1769817600000,
        command_support_until_unix_ms: 1785456000000,
      },
    ],
    features: { 1: { spectate_only: {} } },
  };
  const result = evaluateScenario(initial, [
    {
      op: "handshake",
      role: "aigent",
      aigent_id: "aigent-1",
      offered_majors: [1],
      offered_features: [],
      connection_id: "connection-1",
      evaluation_time_unix_ms: 1785542400000,
    },
  ]);
  assert.deepEqual(result.trace, [
    {
      type: "handshake_accepted",
      mode: "spectate_only",
      protocol_major: 1,
      connection_id: "connection-1",
      features: [],
      notice: "upgrade_required",
    },
  ]);
});

test("a second handshake frame on one negotiated connection is invalid", () => {
  const scenario = fixture.cases.find(
    ({ id }) => id === "negotiates-highest-major-and-feature-versions",
  );
  assert.ok(scenario);
  const result = evaluateScenario(scenario.initial, [
    scenario.steps[0],
    scenario.steps[0],
  ]);
  assert.deepEqual(result.trace.at(-1), {
    type: "protocol_error",
    code: "invalid_envelope",
    effect: "none",
  });
});

test("stale event epochs require event resync instead of envelope rejection", () => {
  const result = evaluateScenario(
    {
      event_stream: {
        epoch: "event-epoch-2",
        expected_sequence: 3,
        highest_sent_sequence: 2,
        last_ack: 1,
        status: "event_resync_required",
        journal: [{ sequence: 2 }],
      },
    },
    [
      {
        op: "resume_events",
        stream_epoch: "event-epoch-1",
        last_ack: 1,
        server_new_stream_epoch: "event-epoch-3",
      },
    ],
  );
  assert.deepEqual(result.trace, [
    { type: "event_resync_required", reason: "epoch_mismatch" },
  ]);
});

test("fixture validation rejects duplicate case IDs and limit drift", () => {
  const duplicate = structuredClone(fixture);
  duplicate.cases[1].id = duplicate.cases[0].id;
  assert.throws(() => validateFixture(duplicate), /duplicate fixture id/);

  const changedLimit = structuredClone(fixture);
  changedLimit.limits.outbound_queue_bytes += 1;
  assert.throws(
    () => validateFixture(changedLimit),
    /limits do not match protocol v1/,
  );
});

test("the authored proto has unique message field numbers and reserved gaps", () => {
  const source = fs.readFileSync(
    path.join(root, "protocol/v1/aigent.proto"),
    "utf8",
  );
  assert.match(source, /^syntax = "proto3";/);
  assert.match(source, /package aigent\.protocol\.v1;/);
  assert.match(source, /message Envelope \{/);
  assert.match(source, /reserved 5 to 9;/);
  assert.match(source, /reserved 14 to 19;/);
  for (const additivePersistenceSurface of [
    "PROTOCOL_ERROR_CODE_PERSISTENCE_BACKPRESSURE = 6;",
    "PROTOCOL_ERROR_CODE_PERSISTENCE_RECORD_TOO_LARGE = 7;",
    "PROTOCOL_ERROR_CODE_PERSISTENCE_UNAVAILABLE = 8;",
    "PROTOCOL_CLOSE_REASON_PERSISTENCE_RECORD_TOO_LARGE = 4;",
    "PROTOCOL_CLOSE_REASON_PERSISTENCE_UNAVAILABLE = 5;",
    "optional uint32 retry_after_ticks = 4;",
  ]) {
    assert.ok(source.includes(additivePersistenceSurface));
  }

  const messageStarts = [...source.matchAll(/^message ([A-Za-z0-9_]+) \{/gm)];
  for (const match of messageStarts) {
    const start = match.index + match[0].length;
    let depth = 1;
    let end = start;
    for (; end < source.length && depth > 0; end += 1) {
      if (source[end] === "{") depth += 1;
      if (source[end] === "}") depth -= 1;
    }
    const body = source.slice(start, end - 1);
    const fieldNumbers = [...body.matchAll(/=\s*(\d+)\s*;/g)].map(
      ([, number]) => Number(number),
    );
    assert.equal(
      new Set(fieldNumbers).size,
      fieldNumbers.length,
      `${match[1]} has duplicate field numbers`,
    );
  }

  const enumStarts = [...source.matchAll(/^enum ([A-Za-z0-9_]+) \{/gm)];
  for (const match of enumStarts) {
    const start = match.index + match[0].length;
    const end = source.indexOf("}", start);
    const values = [...source.slice(start, end).matchAll(/=\s*(\d+)\s*;/g)].map(
      ([, number]) => Number(number),
    );
    assert.equal(
      new Set(values).size,
      values.length,
      `${match[1]} has duplicate numeric values`,
    );
  }

  const envelope = source.slice(source.indexOf("message Envelope {"));
  const envelopeFields = Object.fromEntries(
    [...envelope.matchAll(/^\s+[A-Za-z0-9_.<>]+\s+([a-z0-9_]+)\s*=\s*(\d+);/gm)]
      .map(([, name, number]) => [name, Number(number)]),
  );
  assert.deepEqual(
    Object.fromEntries(
      Object.entries(envelopeFields).filter(([, number]) =>
        number >= 10 && number <= 13),
    ),
    {
      command: 10,
      snapshot_resync_request: 11,
      event_acknowledgement: 12,
      event_resume_request: 13,
    },
  );
  assert.ok(
    Object.values(envelopeFields).every(
      (number) =>
        !(number >= 5 && number <= 9) &&
        !(number >= 14 && number <= 19),
    ),
  );
});

test("protocol documentation links resolve and canonical ordering is locale-free", () => {
  const contractPath = path.join(root, "protocol/v1/CONTRACT.md");
  const contract = fs.readFileSync(contractPath, "utf8");
  for (const relativeLink of [
    "aigent.proto",
    "conformance/envelope-v1.json",
    "../../docs/adr/0001-protocol-v1-compatibility-and-recovery.md",
    "../../replay/v1/CONTRACT.md",
  ]) {
    assert.ok(
      fs.existsSync(path.resolve(path.dirname(contractPath), relativeLink)),
      relativeLink,
    );
  }
  for (const [document, relativeLinks] of [
    [
      path.join(root, "README.md"),
      [
        "docs/adr/0001-protocol-v1-compatibility-and-recovery.md",
        "docs/adr/0005-durable-command-replay-and-backpressure.md",
        "protocol/v1/CONTRACT.md",
        "protocol/v1/aigent.proto",
        "replay/v1/CONTRACT.md",
      ],
    ],
    [
      path.join(root, "docs/adr/README.md"),
      ["0001-protocol-v1-compatibility-and-recovery.md"],
    ],
  ]) {
    for (const relativeLink of relativeLinks) {
      assert.ok(
        fs.existsSync(path.resolve(path.dirname(document), relativeLink)),
        `${document}: ${relativeLink}`,
      );
    }
  }
  const evaluator = fs.readFileSync(
    path.join(root, "scripts/protocol-contract.mjs"),
    "utf8",
  );
  assert.doesNotMatch(evaluator, /localeCompare/);
});
