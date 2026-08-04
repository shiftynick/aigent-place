import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import {
  OVERFLOW_TICK_OBSERVATIONS as PROTOCOL_OVERFLOW_TICKS,
  QUEUE_LIMIT_BYTES as PROTOCOL_QUEUE_LIMIT_BYTES,
} from "./protocol-contract.mjs";
import {
  AOI_HARD_CAP,
  aoiCapForRole,
  canonicalize,
  classifyWindows,
  DEGRADE_OVERRUN_RATE,
  DEGRADE_WINDOW_TICKS,
  evaluateFixtureCase,
  evaluateScenario,
  loadFixture,
  maxDegradationLevel,
  OVERFLOW_DISCONNECT_TICKS,
  PASS_OVERRUN_RATE,
  PASS_WINDOW_TICKS,
  policyFromLevel,
  QUEUE_LIMIT_BYTES,
  truncateAoi,
  validateFixture,
  VIEWER_CADENCE_STEPS_HZ,
  VIEWER_REFUSAL_CODE,
} from "./workload-contract.mjs";

const fixture = loadFixture();
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

test("all workload v1 semantic fixtures match their expected state and trace", () => {
  validateFixture(fixture);
  for (const scenario of fixture.cases) {
    assert.deepEqual(
      evaluateFixtureCase(fixture, scenario),
      canonicalize(scenario.expect),
      scenario.id,
    );
  }
});

test("policy levels walk cadence before AOI before refuse before aigent floor", () => {
  assert.deepEqual(policyFromLevel(0).viewer_cadence_hz, 10);
  assert.equal(policyFromLevel(0).aigent_percept_floor_hz, null);
  assert.deepEqual(policyFromLevel(1).viewer_cadence_hz, 5);
  assert.deepEqual(policyFromLevel(2).viewer_cadence_hz, 2);
  assert.equal(policyFromLevel(2).viewer_aoi_cap, 100);
  assert.equal(policyFromLevel(3).viewer_aoi_cap, 50);
  assert.equal(policyFromLevel(4).viewer_aoi_cap, 25);
  assert.equal(policyFromLevel(4).refuse_new_viewers, false);
  assert.equal(policyFromLevel(5).refuse_new_viewers, true);
  assert.equal(policyFromLevel(5).aigent_percept_floor_hz, null);
  assert.equal(policyFromLevel(6).aigent_percept_floor_hz, 5);
  assert.equal(policyFromLevel(7).aigent_percept_floor_hz, 2);
  assert.equal(policyFromLevel(8).aigent_percept_floor_hz, 1);
  assert.equal(maxDegradationLevel(), 8);
  assert.deepEqual([...VIEWER_CADENCE_STEPS_HZ], [10, 5, 2]);
  assert.equal(aoiCapForRole(policyFromLevel(4), "viewer"), 25);
  assert.equal(aoiCapForRole(policyFromLevel(4), "aigent"), AOI_HARD_CAP);
});

test("undegraded configured percept may reach 20 Hz", () => {
  const result = evaluateScenario(
    {},
    [{ op: "effective_percept", configured_hz: 20 }],
  );
  assert.deepEqual(result.trace[0], {
    configured_hz: 20,
    effective_hz: 20,
    floor_hz: null,
    type: "effective_percept",
  });
});

test("pass and degrade windows use the published rates and lengths", () => {
  const healthy = Array(PASS_WINDOW_TICKS).fill(0);
  assert.equal(classifyWindows(healthy).pass_healthy, true);
  assert.equal(PASS_OVERRUN_RATE, 0.01);
  assert.equal(DEGRADE_OVERRUN_RATE, 0.05);
  assert.equal(PASS_WINDOW_TICKS, 1200);
  assert.equal(DEGRADE_WINDOW_TICKS, 600);

  const partial = Array(DEGRADE_WINDOW_TICKS - 1).fill(1);
  assert.equal(classifyWindows(partial).degrade_triggers, false);

  const triggering = [];
  for (let i = 0; i < DEGRADE_WINDOW_TICKS; i += 1) {
    triggering.push((i + 1) % 19 === 0 ? 1 : 0);
  }
  assert.equal(classifyWindows(triggering).degrade_triggers, true);
});

test("AOI truncation is nearest-first with ascending entity-id ties", () => {
  const kept = truncateAoi(
    [
      { id: "9", x: 0, y: 0, z: 2 },
      { id: "3", x: 0, y: 0, z: 1 },
      { id: "2", x: 0, y: 0, z: 1 },
      { id: "10", x: 0, y: 0, z: 5 },
    ],
    { x: 0, y: 0, z: 0 },
    3,
  );
  assert.deepEqual(kept, ["2", "3", "9"]);
  assert.equal(AOI_HARD_CAP, 100);
  assert.throws(() =>
    truncateAoi(
      [
        { id: "1", x: 0, y: 0, z: 0 },
        { id: "1", x: 1, y: 0, z: 0 },
      ],
      { x: 0, y: 0, z: 0 },
      1,
    ),
  );
});

test("queue disconnect constants are imported from the protocol contract", () => {
  assert.equal(QUEUE_LIMIT_BYTES, PROTOCOL_QUEUE_LIMIT_BYTES);
  assert.equal(OVERFLOW_DISCONNECT_TICKS, PROTOCOL_OVERFLOW_TICKS);
  assert.equal(VIEWER_REFUSAL_CODE, "VIEWERS_DEGRADED");
});

test("CONTRACT.md relative links resolve and README cites the workload contract", () => {
  const contractPath = path.join(root, "workload/v1/CONTRACT.md");
  const contract = fs.readFileSync(contractPath, "utf8");
  const linkPattern = /\[[^\]]+\]\(([^)]+)\)/g;
  let match;
  while ((match = linkPattern.exec(contract)) !== null) {
    const target = match[1];
    if (target.startsWith("http")) {
      continue;
    }
    const resolved = path.resolve(path.dirname(contractPath), target);
    assert.ok(fs.existsSync(resolved), `missing link target: ${target}`);
  }

  const readme = fs.readFileSync(path.join(root, "README.md"), "utf8");
  assert.match(readme, /workload\/v1\/CONTRACT\.md/);
  assert.match(readme, /ADR-0006/);
});

test("evaluator source does not use localeCompare for ordering", () => {
  const source = fs.readFileSync(
    path.join(root, "scripts/workload-contract.mjs"),
    "utf8",
  );
  assert.equal(source.includes("localeCompare"), false);
});
