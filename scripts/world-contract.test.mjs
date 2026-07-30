import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import {
  canonicalize,
  entityAabbs,
  evaluateFixtureCase,
  evaluateScenario,
  loadFixture,
  quantizeMeters,
  TERMINAL_REVISION_PREDECESSOR,
  UINT64_MAX,
  validateFixture,
  validateShape,
} from "./world-contract.mjs";

const fixture = loadFixture();
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

test("all world v1 semantic fixtures match their expected state and trace", () => {
  validateFixture(fixture);
  for (const scenario of fixture.cases) {
    assert.deepEqual(
      evaluateFixtureCase(fixture, scenario),
      canonicalize(scenario.expect),
      scenario.id,
    );
  }
});

test("non-finite coordinates and values just beyond the bound reject", () => {
  for (const value of [NaN, Infinity, -Infinity, "NaN", "Infinity"]) {
    assert.deepEqual(quantizeMeters(value), {
      ok: false,
      reason: "invalid_coordinate",
    });
  }
  assert.deepEqual(quantizeMeters("100000.0004"), {
    ok: false,
    reason: "out_of_world_bounds",
  });
  assert.deepEqual(quantizeMeters("-100000.0004"), {
    ok: false,
    reason: "out_of_world_bounds",
  });
});

test("signed half-way quantization is ties-to-even", () => {
  const cases = new Map([
    ["0.0005", 0n],
    ["0.0015", 2n],
    ["0.0025", 2n],
    ["-0.0005", 0n],
    ["-0.0015", -2n],
    ["-0.0025", -2n],
  ]);
  for (const [value, millimeters] of cases) {
    assert.deepEqual(quantizeMeters(value), { ok: true, millimeters });
  }
});

test("primitive transforms derive rotated conservative AABBs", () => {
  const halfTurn = Math.sqrt(0.5);
  const entity = {
    id: "1",
    kind: "object",
    lifecycle: "active",
    revision: "1",
    position: { x: 100, y: 200, z: 300 },
    shape: {
      nodes: [
        {
          id: 1,
          parent_id: 0,
          translation: { x: 10, y: 20, z: 30 },
          rotation: { x: 0, y: 0, z: halfTurn, w: halfTurn },
          primitive: {
            kind: "box",
            size_x_mm: 200,
            size_y_mm: 400,
            size_z_mm: 600,
          },
        },
      ],
    },
  };
  const [bounds] = entityAabbs(entity);
  assert.equal(bounds.node_id, 1);
  for (const [actual, expected] of [
    [bounds.min.x, -90],
    [bounds.min.y, 120],
    [bounds.min.z, 30],
    [bounds.max.x, 310],
    [bounds.max.y, 320],
    [bounds.max.z, 630],
  ]) {
    assert.ok(Math.abs(actual - expected) < 1e-9, `${actual} != ${expected}`);
  }
});

test("shape validation rejects cycles, duplicate IDs, and invalid quaternions", () => {
  const identity = { x: 0, y: 0, z: 0, w: 1 };
  const primitive = { kind: "sphere", radius_mm: 1 };
  assert.deepEqual(
    validateShape({
      nodes: [
        {
          id: 1,
          parent_id: 2,
          translation: { x: 0, y: 0, z: 0 },
          rotation: identity,
          primitive,
        },
        {
          id: 2,
          parent_id: 1,
          translation: { x: 0, y: 0, z: 0 },
          rotation: identity,
          primitive,
        },
      ],
    }),
    { ok: false, reason: "invalid_shape" },
  );
  assert.deepEqual(
    validateShape({
      nodes: [
        {
          id: 1,
          parent_id: 0,
          translation: { x: 0, y: 0, z: 0 },
          rotation: identity,
          primitive,
        },
        {
          id: 1,
          parent_id: 0,
          translation: { x: 0, y: 0, z: 0 },
          rotation: identity,
          primitive,
        },
      ],
    }),
    { ok: false, reason: "invalid_shape" },
  );
  assert.deepEqual(
    validateShape(fixture.shape_catalog["invalid-quaternion"]),
    { ok: false, reason: "invalid_shape" },
  );
  assert.deepEqual(
    validateShape({
      nodes: [
        { id: 1, parent_id: 2, translation: { x: 0, y: 0, z: 0 }, rotation: identity, primitive },
        { id: 2, parent_id: 999, translation: { x: 0, y: 0, z: 0 }, rotation: identity, primitive },
        { id: 3, parent_id: 0, translation: { x: 0, y: 0, z: 0 }, rotation: identity, primitive },
      ],
    }),
    { ok: false, reason: "invalid_shape" },
  );
});

test("all six primitive kinds have closed-form canonical bounds", () => {
  const primitiveCases = [
    [
      { kind: "box", size_x_mm: 200, size_y_mm: 400, size_z_mm: 600 },
      { x: 100, y: 200, z: 300 },
    ],
    [{ kind: "sphere", radius_mm: 125 }, { x: 125, y: 125, z: 125 }],
    [
      { kind: "capsule", radius_mm: 100, segment_length_mm: 200 },
      { x: 100, y: 200, z: 100 },
    ],
    [
      { kind: "cylinder", radius_mm: 100, height_mm: 400 },
      { x: 100, y: 200, z: 100 },
    ],
    [
      { kind: "cone", radius_mm: 100, height_mm: 400 },
      { x: 100, y: 200, z: 100 },
    ],
    [
      { kind: "panel", width_mm: 200, height_mm: 400, thickness_mm: 50 },
      { x: 100, y: 200, z: 25 },
    ],
  ];
  for (const [primitive, half] of primitiveCases) {
    const [bounds] = entityAabbs({
      id: "1",
      kind: "object",
      lifecycle: "active",
      revision: "1",
      position: { x: 0, y: 0, z: 0 },
      shape: {
        nodes: [
          {
            id: 1,
            parent_id: 0,
            translation: { x: 0, y: 0, z: 0 },
            rotation: { x: 0, y: 0, z: 0, w: 1 },
            primitive,
          },
        ],
      },
    });
    assert.deepEqual(bounds.min, {
      x: -half.x,
      y: -half.y,
      z: -half.z,
    });
    assert.deepEqual(bounds.max, half);
  }
});

test("entity and move input order cannot change simultaneous resolution", () => {
  const scenario = fixture.cases.find(
    ({ id }) => id === "simultaneous-moves-resolve-by-command-order",
  );
  assert.ok(scenario);
  const reversed = structuredClone(scenario);
  reversed.initial.entities.reverse();
  reversed.steps[0].moves.reverse();
  assert.deepEqual(
    evaluateFixtureCase(fixture, scenario),
    evaluateFixtureCase(fixture, reversed),
  );
});

test("shape node input order cannot change collider or enclosure outcomes", () => {
  const scenario = fixture.cases.find(
    ({ id }) => id === "placement-rejects-a-hollow-enclosure",
  );
  assert.ok(scenario);
  const reorderedFixture = structuredClone(fixture);
  reorderedFixture.shape_catalog.cage.nodes.reverse();
  assert.deepEqual(
    evaluateFixtureCase(fixture, scenario),
    evaluateFixtureCase(reorderedFixture, scenario),
  );
});

test("set_shape rejects terrain penetration and treats omitted and empty material tags as one canonical shape", () => {
  const terrainPenetration = evaluateScenario(
    {
      rules: {
        heightfield_y_mm: 0,
        heightfield_cell_size_mm: 1000,
        heightfield_samples: [{ sample_x: 0, sample_z: 0, height_mm: 1000 }],
        displacement_step_mm: 1000,
        max_displacement_radius_mm: 2000,
        unstick_blocked_ticks: 3,
      },
      shape_catalog: fixture.shape_catalog,
      entities: [{
        id: "1",
        kind: "aigent",
        lifecycle: "active",
        revision: "1",
        position: { x: 0, y: 1500, z: 500 },
        shape: "cube",
      }],
      next_entity_id: "2",
    },
    [{
      op: "set_shape",
      entity_id: "1",
      shape: {
        nodes: [{
          id: 1,
          parent_id: 0,
          translation: { x: 0, y: -1000, z: 0 },
          rotation: { x: 0, y: 0, z: 0, w: 1 },
          primitive: { kind: "box", size_x_mm: 1000, size_y_mm: 1000, size_z_mm: 1000 },
        }],
      },
    }],
    { entity_ids: ["1"] },
  );
  assert.deepEqual(terrainPenetration.trace, [{
    type: "set_shape",
    entity_id: "1",
    outcome: "rejected",
    reason: "overlap",
  }]);
  assert.equal(terrainPenetration.final_state.entities[0].revision, "1");

  const emptyTags = structuredClone(fixture.shape_catalog.cube);
  emptyTags.nodes[0].material_tags = [];
  const noOp = evaluateScenario(
    {
      rules: { heightfield_y_mm: 0, displacement_step_mm: 1000, max_displacement_radius_mm: 1000, unstick_blocked_ticks: 3 },
      shape_catalog: fixture.shape_catalog,
      entities: [{ id: "1", kind: "aigent", lifecycle: "active", revision: "7", position: { x: 0, y: 500, z: 0 }, shape: "cube" }],
      next_entity_id: "2",
    },
    [{ op: "set_shape", entity_id: "1", shape: emptyTags }],
    { entity_ids: ["1"] },
  );
  assert.deepEqual(noOp.trace, [{
    type: "set_shape",
    entity_id: "1",
    outcome: "accepted",
    no_op: true,
    revision: "7",
  }]);
});

test("restore at the reserved predecessor preserves an exact pose but refuses a required displacement", () => {
  const exact = evaluateScenario(
    {
      rules: { heightfield_y_mm: 0, displacement_step_mm: 1000, max_displacement_radius_mm: 1000, unstick_blocked_ticks: 3 },
      shape_catalog: fixture.shape_catalog,
      entities: [{ id: "1", kind: "aigent", lifecycle: "sleeping", revision: TERMINAL_REVISION_PREDECESSOR.toString(), position: { x: 0, y: 500, z: 0 }, shape: "cube" }],
      next_entity_id: "2",
    },
    [{ op: "restore", entity_id: "1" }],
    { entity_ids: ["1"] },
  );
  assert.deepEqual(exact.trace, [{
    type: "restore",
    entity_id: "1",
    outcome: "accepted",
    displaced: false,
    position: { x: 0, y: 500, z: 0 },
    revision: TERMINAL_REVISION_PREDECESSOR.toString(),
  }]);

  const displaced = evaluateScenario(
    {
      rules: { heightfield_y_mm: 0, displacement_step_mm: 1000, max_displacement_radius_mm: 1000, unstick_blocked_ticks: 3 },
      shape_catalog: fixture.shape_catalog,
      entities: [
        { id: "1", kind: "aigent", lifecycle: "sleeping", revision: TERMINAL_REVISION_PREDECESSOR.toString(), position: { x: 0, y: 500, z: 0 }, shape: "cube" },
        { id: "2", kind: "object", lifecycle: "active", revision: "1", position: { x: 0, y: 500, z: 0 }, shape: "cube" },
      ],
      next_entity_id: "3",
    },
    [{ op: "restore", entity_id: "1" }],
    { entity_ids: ["1"] },
  );
  assert.deepEqual(displaced.trace, [{
    type: "restore",
    entity_id: "1",
    outcome: "rejected",
    reason: "revision_exhausted",
  }]);
  assert.equal(displaced.final_state.entities[0].lifecycle, "sleeping");
});

test("restore_batch fixture is independent of its supplied entity order", () => {
  const scenario = fixture.cases.find(
    ({ id }) => id === "restore-batch-orders-numeric-entity-ids",
  );
  assert.ok(scenario);
  const reversed = structuredClone(scenario);
  reversed.steps[0].entity_ids.reverse();
  reversed.initial.entities.reverse();
  assert.deepEqual(
    evaluateFixtureCase(fixture, scenario),
    evaluateFixtureCase(fixture, reversed),
  );
});

test("swept contact is derived from obstacle thickness", () => {
  const scenario = fixture.cases.find(
    ({ id }) => id === "swept-movement-stops-at-a-thin-obstacle",
  );
  assert.ok(scenario);
  const thickerFixture = structuredClone(fixture);
  thickerFixture.shape_catalog["thin-wall"].nodes[0].primitive.size_x_mm = 1000;
  const result = evaluateFixtureCase(thickerFixture, scenario);
  assert.equal(result.trace[0].position.x, -1000);
  assert.notEqual(result.trace[0].position.x, scenario.expect.trace[0].position.x);
});

test("entity-ID and terminal revision boundaries reject without ordinary mutation", () => {
  const result = evaluateScenario(
    {
      rules: {
        heightfield_y_mm: 0,
        displacement_step_mm: 1000,
        max_displacement_radius_mm: 1000,
        unstick_blocked_ticks: 3,
      },
      shape_catalog: fixture.shape_catalog,
      entities: [
        {
          id: "1",
          kind: "aigent",
          lifecycle: "active",
          revision: UINT64_MAX.toString(),
          position: { x: 0, y: 500, z: 0 },
          shape: "cube",
        },
      ],
      next_entity_id: (UINT64_MAX + 1n).toString(),
    },
    [
      { op: "place", x_mm: 2000, z_mm: 0, shape: "cube" },
      {
        op: "resolve_moves",
        moves: [
          {
            entity_id: "1",
            arrival_tick: "0",
            aigent_id: "aigent-1",
            sequence: "1",
            target: { x: 100_000_000, y: 500, z: 0 },
          },
        ],
      },
      { op: "set_shape", entity_id: "1", shape: "small-sphere" },
    ],
    { entity_ids: ["1"], include_next_entity_id: true },
  );
  assert.deepEqual(result.trace, [
    {
      entity_id: "1",
      outcome: "repaired",
      reason: "terminal_revision_forced_sleep",
      type: "recovery_diagnostic",
    },
    {
      outcome: "rejected",
      reason: "entity_id_exhausted",
      type: "place_object",
    },
    {
      entity_id: "1",
      outcome: "rejected",
      reason: "revision_exhausted",
      type: "move",
    },
    {
      entity_id: "1",
      outcome: "rejected",
      reason: "revision_exhausted",
      type: "set_shape",
    },
  ]);
  assert.deepEqual(result.final_state.entities[0].position, {
    x: 0,
    y: 500,
    z: 0,
  });
  assert.equal(result.final_state.entities[0].lifecycle, "sleeping");
});

test("transform bounds, allocation precedence, and canonical semantic no-ops are explicit", () => {
  const outOfBoundsShape = structuredClone(fixture.shape_catalog.cube);
  outOfBoundsShape.nodes[0].translation.x = 100_000_001;
  assert.deepEqual(validateShape(outOfBoundsShape), {
    ok: false,
    reason: "invalid_shape",
  });

  const precedence = evaluateScenario(
    {
      rules: { heightfield_y_mm: 0, displacement_step_mm: 1000, max_displacement_radius_mm: 1000, unstick_blocked_ticks: 1 },
      shape_catalog: fixture.shape_catalog,
      entities: [{ id: "1", kind: "aigent", lifecycle: "active", revision: "1", position: { x: 0, y: 500, z: 0 }, shape: "cube" }],
      next_entity_id: (UINT64_MAX + 1n).toString(),
    },
    [
      { op: "place", x_mm: 0, z_mm: 0, shape: "cube" },
      { op: "place", x_mm: 0, z_mm: 0, shape: outOfBoundsShape },
      {
        op: "place",
        x_mm: 100_000_001,
        z_mm: 0,
        shape: outOfBoundsShape,
      },
    ],
    {},
  );
  assert.deepEqual(precedence.trace.map(({ reason }) => reason), [
    "overlap",
    "invalid_shape",
    "out_of_world_bounds",
  ]);

  const noOps = evaluateScenario(
    {
      rules: { heightfield_y_mm: 0, displacement_step_mm: 1000, max_displacement_radius_mm: 1000, unstick_blocked_ticks: 1 },
      shape_catalog: fixture.shape_catalog,
      entities: [{ id: "1", kind: "aigent", lifecycle: "active", revision: "5", position: { x: 0, y: 500, z: 0 }, shape: "cube" }],
      next_entity_id: "2",
    },
    [
      {
        op: "resolve_moves",
        moves: [{
          entity_id: "1",
          arrival_tick: "0",
          aigent_id: "aigent-1",
          sequence: "1",
          target: { x: 0, z: 0 },
        }],
      },
      { op: "sleep", entity_id: "1" },
      { op: "sleep", entity_id: "1" },
      { op: "set_shape", entity_id: "1", shape: "cube" },
    ],
    { entity_ids: ["1"] },
  );
  assert.deepEqual(noOps.trace.map(({ no_op, revision }) => ({ no_op, revision })), [
    { no_op: true, revision: undefined },
    { no_op: undefined, revision: "6" },
    { no_op: true, revision: "6" },
    { no_op: true, revision: "6" },
  ]);
});

test("move commands use the full arrival-tick, aigent-ID, sequence order independent of input order", () => {
  const initial = {
    rules: { heightfield_y_mm: 0, displacement_step_mm: 1000, max_displacement_radius_mm: 1000, unstick_blocked_ticks: 1 },
    shape_catalog: fixture.shape_catalog,
    entities: [
      { id: "2", kind: "aigent", lifecycle: "active", revision: "1", position: { x: 1000, y: 500, z: 0 }, shape: "cube" },
      { id: "1", kind: "aigent", lifecycle: "active", revision: "1", position: { x: -2000, y: 500, z: 0 }, shape: "cube" },
    ],
    next_entity_id: "3",
  };
  const moves = [
    { entity_id: "2", aigent_id: "aigent-2", arrival_tick: "1", sequence: "1", target: { x: 0, z: 0 } },
    { entity_id: "1", aigent_id: "aigent-1", arrival_tick: "0", sequence: "2", target: { x: 0, z: 0 } },
    { entity_id: "1", aigent_id: "aigent-1", arrival_tick: "0", sequence: "1", target: { x: -1000, z: 0 } },
  ];
  const ordered = evaluateScenario(initial, [{ op: "resolve_moves", moves }], {});
  const permuted = evaluateScenario(initial, [{ op: "resolve_moves", moves: [...moves].reverse() }], {});
  assert.deepEqual(ordered, permuted);
  assert.deepEqual(ordered.trace.map(({ entity_id, outcome }) => [entity_id, outcome]), [
    ["1", "reached"],
    ["1", "blocked"],
    ["2", "blocked"],
  ]);
});

test("move ordering rejects non-canonical metadata and duplicate command tuples", () => {
  const initial = {
    rules: { heightfield_y_mm: 0, displacement_step_mm: 1000, max_displacement_radius_mm: 1000, unstick_blocked_ticks: 1 },
    shape_catalog: fixture.shape_catalog,
    entities: [{ id: "1", kind: "aigent", lifecycle: "active", revision: "1", position: { x: 0, y: 500, z: 0 }, shape: "cube" }],
    next_entity_id: "2",
  };
  assert.throws(
    () => evaluateScenario(initial, [{
      op: "resolve_moves",
      moves: [{ entity_id: "1", arrival_tick: 0, aigent_id: "aigent-1", sequence: "1", target: { x: 0, z: 0 } }],
    }], { entity_ids: ["1"] }),
    /invalid move command metadata/,
  );
  assert.throws(
    () => evaluateScenario(initial, [{
      op: "resolve_moves",
      moves: [
        { entity_id: "1", arrival_tick: "0", aigent_id: "aigent-1", sequence: "1", target: { x: -1000, z: 0 } },
        { entity_id: "1", arrival_tick: "0", aigent_id: "aigent-1", sequence: "1", target: { x: 1000, z: 0 } },
      ],
    }], { entity_ids: ["1"] }),
    /duplicate move command order/,
  );
});

test("terminal revision reserves forced sleep and recovery repairs active terminal state", () => {
  const terminal = evaluateScenario(
    {
      rules: { heightfield_y_mm: 0, displacement_step_mm: 1000, max_displacement_radius_mm: 1000, unstick_blocked_ticks: 1 },
      shape_catalog: fixture.shape_catalog,
      entities: [{ id: "1", kind: "aigent", lifecycle: "active", revision: TERMINAL_REVISION_PREDECESSOR.toString(), position: { x: 0, y: 500, z: 0 }, shape: "cube" }],
      next_entity_id: "2",
    },
    [
      { op: "set_shape", entity_id: "1", shape: "small-sphere" },
      {
        op: "resolve_moves",
        moves: [{
          entity_id: "1",
          arrival_tick: "0",
          aigent_id: "aigent-1",
          sequence: "1",
          target: { x: 0, z: 0 },
        }],
      },
      { op: "sleep", entity_id: "1" },
      { op: "sleep", entity_id: "1" },
      { op: "wake", entity_id: "1" },
      { op: "restore", entity_id: "1" },
      { op: "unstick", entity_id: "1" },
    ],
    { entity_ids: ["1"] },
  );
  assert.deepEqual(terminal.trace.map(({ type, outcome, reason, no_op, revision }) => ({ type, outcome, reason, no_op, revision })), [
    { type: "set_shape", outcome: "rejected", reason: "revision_exhausted", no_op: undefined, revision: undefined },
    { type: "move", outcome: "reached", reason: undefined, no_op: true, revision: undefined },
    { type: "sleep", outcome: "accepted", reason: undefined, no_op: undefined, revision: UINT64_MAX.toString() },
    { type: "sleep", outcome: "accepted", reason: undefined, no_op: true, revision: UINT64_MAX.toString() },
    { type: "wake", outcome: "rejected", reason: "revision_exhausted", no_op: undefined, revision: undefined },
    { type: "restore", outcome: "rejected", reason: "revision_exhausted", no_op: undefined, revision: undefined },
    { type: "unstick", outcome: "rejected", reason: "revision_exhausted", no_op: undefined, revision: undefined },
  ]);

  const recovered = evaluateScenario(
    {
      rules: { heightfield_y_mm: 0, displacement_step_mm: 1000, max_displacement_radius_mm: 1000, unstick_blocked_ticks: 1 },
      shape_catalog: fixture.shape_catalog,
      entities: [{ id: "1", kind: "aigent", lifecycle: "active", revision: UINT64_MAX.toString(), position: { x: 0, y: 500, z: 0 }, shape: "cube" }],
      next_entity_id: "2",
    },
    [{ op: "place", x_mm: 0, z_mm: 0, shape: "cube" }],
    { entity_ids: ["1", "2"] },
  );
  assert.equal(recovered.trace[0].reason, "terminal_revision_forced_sleep");
  assert.equal(recovered.trace[1].outcome, "accepted");
  assert.equal(recovered.final_state.entities[0].lifecycle, "sleeping");
});

test("integer heightfield samples use conservative shared-column maxima, order-invariant grounding, and wake support validation", () => {
  const terrain = fixture.cases.find(
    ({ id }) => id === "non-flat-columns-ground-a-spanning-footprint",
  );
  assert.ok(terrain);
  const reordered = structuredClone(terrain);
  reordered.initial.rules.heightfield_samples.reverse();
  assert.deepEqual(
    evaluateFixtureCase(fixture, terrain),
    evaluateFixtureCase(fixture, reordered),
  );

  const edgeContact = evaluateScenario(
    {
      rules: {
        heightfield_y_mm: 0,
        heightfield_cell_size_mm: 1000,
        heightfield_samples: [{ sample_x: 0, sample_z: 0, height_mm: 1000 }],
        displacement_step_mm: 1000,
        max_displacement_radius_mm: 2000,
        unstick_blocked_ticks: 1,
      },
      shape_catalog: fixture.shape_catalog,
      entities: [],
      next_entity_id: "1",
    },
    [{ op: "place", x_mm: -400, z_mm: 500, shape: "small-sphere" }],
    { entity_ids: ["1"] },
  );
  assert.equal(edgeContact.final_state.entities[0].position.y, 1400);

  const wake = evaluateScenario(
    {
      rules: {
        heightfield_y_mm: 0,
        heightfield_cell_size_mm: 1000,
        heightfield_samples: [{ sample_x: 0, sample_z: 0, height_mm: 1000 }],
        displacement_step_mm: 1000,
        max_displacement_radius_mm: 2000,
        unstick_blocked_ticks: 1,
      },
      shape_catalog: fixture.shape_catalog,
      entities: [{ id: "1", kind: "aigent", lifecycle: "sleeping", revision: "1", position: { x: 0, y: 500, z: 500 }, shape: "cube" }],
      next_entity_id: "2",
    },
    [{ op: "wake", entity_id: "1" }],
    { entity_ids: ["1"] },
  );
  assert.deepEqual(wake.trace[0].position, { x: 0, y: 500, z: 1500 });
  assert.equal(wake.trace[0].displaced, true);
});

test("displacement and swept-contact oracle comparisons stay exact rather than numeric-sort based", () => {
  const evaluator = fs.readFileSync(path.join(root, "scripts/world-contract.mjs"), "utf8");
  assert.match(evaluator, /compareBigInts\(a\.distance, b\.distance\)/);
  assert.match(evaluator, /fractionCompare\(time, best\.time\)/);
  assert.doesNotMatch(evaluator, /a\.distance - b\.distance/);
});

test("fixture validation rejects duplicate IDs and malformed headers", () => {
  const duplicate = structuredClone(fixture);
  duplicate.cases[1].id = duplicate.cases[0].id;
  assert.throws(() => validateFixture(duplicate), /duplicate fixture id/);

  const malformed = structuredClone(fixture);
  malformed.fixture_version = 2;
  assert.throws(() => validateFixture(malformed), /invalid world fixture header/);
});

test("scenario evaluation rejects invalid initial active overlap before any step", () => {
  assert.throws(
    () => evaluateScenario({
      rules: { heightfield_y_mm: 0, displacement_step_mm: 1000, max_displacement_radius_mm: 1000, unstick_blocked_ticks: 1 },
      shape_catalog: fixture.shape_catalog,
      entities: [
        { id: "1", kind: "object", lifecycle: "active", revision: "1", position: { x: 0, y: 500, z: 0 }, shape: "cube" },
        { id: "2", kind: "aigent", lifecycle: "active", revision: "1", position: { x: 0, y: 500, z: 0 }, shape: "cube" },
      ],
      next_entity_id: "3",
    }, [], { entity_ids: ["1", "2"] }),
    /active entities 1 and 2 overlap/,
  );
});

test("world contract links resolve and protobuf owns typed geometry messages", () => {
  const contractPath = path.join(root, "world/v1/CONTRACT.md");
  for (const relativeLink of [
    "../../docs/adr/0002-world-geometry-and-displacement-semantics.md",
    "../../docs/adr/0003-heightfield-sampling-and-terrain-collision.md",
    "../../docs/adr/0004-terminal-revision-and-forced-sleep.md",
    "../../protocol/v1/aigent.proto",
    "../../protocol/v1/CONTRACT.md",
    "conformance/physics-shapes-v1.json",
  ]) {
    assert.ok(
      fs.existsSync(path.resolve(path.dirname(contractPath), relativeLink)),
      relativeLink,
    );
  }
  const readme = fs.readFileSync(path.join(root, "README.md"), "utf8");
  for (const relativeLink of [
    "docs/adr/0002-world-geometry-and-displacement-semantics.md",
    "world/v1/CONTRACT.md",
    "world/v1/conformance/physics-shapes-v1.json",
  ]) {
    assert.ok(readme.includes(relativeLink), relativeLink);
    assert.ok(fs.existsSync(path.join(root, relativeLink)), relativeLink);
  }

  const proto = fs.readFileSync(
    path.join(root, "protocol/v1/aigent.proto"),
    "utf8",
  );
  for (const definition of [
    "COMMAND_KIND_UNSTICK = 15;",
    "message Vector3Millimeters {",
    "message ShapeTree {",
    "message PlaceObjectPayload {",
    "message SetShapePayload {",
    "message UnstickPayload {}",
    "message PhysicsCommandResult {",
    "message WorldEntityReference {",
    "PERCEPT_KIND_WORLD_RECOVERY_DIAGNOSTIC = 5;",
    "repeated WorldEntityReference affected_world_entities = 3;",
    "sint64 size_x_mm = 1;",
  ]) {
    assert.match(proto, new RegExp(definition.replace(/[{}]/g, "\\$&")));
  }
  assert.match(
    proto,
    /message EntityReference \{[\s\S]*?bytes entity_id = 1;[\s\S]*?uint64 revision = 2;[\s\S]*?\}/,
  );
  assert.match(
    proto,
    /message PhysicsCommandResult \{[\s\S]*?reserved 1;[\s\S]*?optional Vector3Millimeters authoritative_position = 2;[\s\S]*?bool displaced = 3;[\s\S]*?\}/,
  );
  assert.match(
    proto,
    /enum WorldRecoveryDiagnosticCode \{[\s\S]*?WORLD_RECOVERY_DIAGNOSTIC_CODE_TERMINAL_REVISION_FORCED_SLEEP = 1;[\s\S]*?\}[\s\S]*?message WorldRecoveryDiagnostic \{[\s\S]*?WorldRecoveryDiagnosticCode code = 1;[\s\S]*?uint64 entity_id = 2;[\s\S]*?\}/,
  );
  assert.match(
    proto,
    /enum PerceptKind \{[\s\S]*?PERCEPT_KIND_HEARD = 1;[\s\S]*?\}[\s\S]*?message Percept \{[\s\S]*?PerceptKind kind = 1;[\s\S]*?bytes payload = 2;[\s\S]*?\}/,
  );

  const evaluator = fs.readFileSync(
    path.join(root, "scripts/world-contract.mjs"),
    "utf8",
  );
  assert.doesNotMatch(evaluator, /localeCompare/);
});
