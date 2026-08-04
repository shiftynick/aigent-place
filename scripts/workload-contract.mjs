import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  OVERFLOW_TICK_OBSERVATIONS,
  QUEUE_LIMIT_BYTES as PROTOCOL_QUEUE_LIMIT_BYTES,
} from "./protocol-contract.mjs";

export const SIM_TICK_HZ = 20;
export const SIM_TICK_MS = 50;
export const CONCURRENT_AIGENTS_TARGET = 300;
export const CONCURRENT_VIEWERS_TARGET = 500;
export const AOI_HARD_CAP = 100;
export const AIGENT_PERCEPT_DEFAULT_HZ = 5;
export const AIGENT_PERCEPT_MAX_HZ = 20;
export const VIEWER_CADENCE_STEPS_HZ = Object.freeze([10, 5, 2]);
export const VIEWER_AOI_STEPS = Object.freeze([100, 50, 25]);
export const AIGENT_PERCEPT_FLOOR_STEPS_HZ = Object.freeze([5, 2, 1]);
export const PASS_WINDOW_TICKS = 1200;
export const DEGRADE_WINDOW_TICKS = 600;
export const PASS_OVERRUN_RATE = 0.01;
export const DEGRADE_OVERRUN_RATE = 0.05;
export const QUEUE_LIMIT_BYTES = PROTOCOL_QUEUE_LIMIT_BYTES;
export const OVERFLOW_DISCONNECT_TICKS = OVERFLOW_TICK_OBSERVATIONS;
export const VIEWER_REFUSAL_CODE = "VIEWERS_DEGRADED";
export const CAPACITY_SUSTAIN_TICKS = PASS_WINDOW_TICKS;
export const CADENCE_TOLERANCE_TICKS = 1;

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const fixturePath = path.join(root, "workload/v1/conformance/workload-v1.json");

function clone(value) {
  return structuredClone(value);
}

function compareCodeUnits(left, right) {
  return left < right ? -1 : left > right ? 1 : 0;
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

function assertPositiveInt(value, label) {
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new Error(`${label} must be a positive safe integer`);
  }
}

/**
 * Deepest linear level (0 = healthy defaults).
 * Cadence and AOI use length-1 advances from their defaults. Refuse is one
 * step. Aigent floors then walk the full floor table (first entry is the
 * first drop after refuse).
 */
export function maxDegradationLevel() {
  return (
    VIEWER_CADENCE_STEPS_HZ.length -
    1 +
    (VIEWER_AOI_STEPS.length - 1) +
    1 +
    AIGENT_PERCEPT_FLOOR_STEPS_HZ.length
  );
}

/** Linear index 0 = healthy defaults; max = deepest aigent floor. */
export function policyFromLevel(level) {
  if (!Number.isSafeInteger(level) || level < 0) {
    throw new Error("level must be a non-negative safe integer");
  }
  const max = maxDegradationLevel();
  const clamped = Math.min(max, level);
  let remaining = clamped;

  let viewerCadenceIndex = 0;
  if (remaining > 0) {
    const advance = Math.min(remaining, VIEWER_CADENCE_STEPS_HZ.length - 1);
    viewerCadenceIndex = advance;
    remaining -= advance;
  }

  let viewerAoiIndex = 0;
  if (remaining > 0) {
    const advance = Math.min(remaining, VIEWER_AOI_STEPS.length - 1);
    viewerAoiIndex = advance;
    remaining -= advance;
  }

  let refuseViewers = false;
  if (remaining > 0) {
    refuseViewers = true;
    remaining -= 1;
  }

  // null means no degradation floor: configured rates may reach max Hz.
  let aigentPerceptFloorHz = null;
  if (remaining > 0) {
    const advance = Math.min(remaining, AIGENT_PERCEPT_FLOOR_STEPS_HZ.length);
    aigentPerceptFloorHz = AIGENT_PERCEPT_FLOOR_STEPS_HZ[advance - 1];
  }

  return {
    level: clamped,
    viewer_cadence_hz: VIEWER_CADENCE_STEPS_HZ[viewerCadenceIndex],
    viewer_aoi_cap: VIEWER_AOI_STEPS[viewerAoiIndex],
    refuse_new_viewers: refuseViewers,
    aigent_percept_floor_hz: aigentPerceptFloorHz,
  };
}

function normalizedState(initial = {}) {
  const overrunHistory = clone(initial.overrun_history ?? []);
  if (!Array.isArray(overrunHistory)) {
    throw new Error("overrun_history must be an array");
  }
  for (const flag of overrunHistory) {
    if (flag !== 0 && flag !== 1 && flag !== false && flag !== true) {
      throw new Error("overrun_history entries must be 0/1 or boolean");
    }
  }
  return {
    tick: Number.isSafeInteger(initial.tick) ? initial.tick : 0,
    level: Number.isSafeInteger(initial.level) ? initial.level : 0,
    overrun_history: overrunHistory.map((flag) => (flag ? 1 : 0)),
    viewers: Number.isSafeInteger(initial.viewers) ? initial.viewers : 0,
    aigents: Number.isSafeInteger(initial.aigents) ? initial.aigents : 0,
    viewer_sustain_ticks: Number.isSafeInteger(initial.viewer_sustain_ticks)
      ? initial.viewer_sustain_ticks
      : 0,
    aigent_sustain_ticks: Number.isSafeInteger(initial.aigent_sustain_ticks)
      ? initial.aigent_sustain_ticks
      : 0,
    focus: clone(initial.focus ?? { x: 0, y: 0, z: 0 }),
    queue_over_limit_ticks: Number.isSafeInteger(initial.queue_over_limit_ticks)
      ? initial.queue_over_limit_ticks
      : 0,
    connection_closed: Boolean(initial.connection_closed),
  };
}

function updateSustainCounters(state) {
  if (state.viewers >= CONCURRENT_VIEWERS_TARGET) {
    state.viewer_sustain_ticks += 1;
  } else {
    state.viewer_sustain_ticks = 0;
  }
  if (state.aigents >= CONCURRENT_AIGENTS_TARGET) {
    state.aigent_sustain_ticks += 1;
  } else {
    state.aigent_sustain_ticks = 0;
  }
}

function windowRate(history, windowTicks) {
  if (history.length < windowTicks) {
    return null;
  }
  const slice = history.slice(history.length - windowTicks);
  let overruns = 0;
  for (const flag of slice) {
    overruns += flag;
  }
  return overruns / windowTicks;
}

export function classifyWindows(history) {
  const passRate = windowRate(history, PASS_WINDOW_TICKS);
  const degradeRate = windowRate(history, DEGRADE_WINDOW_TICKS);
  return {
    pass_rate: passRate,
    degrade_rate: degradeRate,
    pass_healthy: passRate !== null && passRate < PASS_OVERRUN_RATE,
    degrade_triggers: degradeRate !== null && degradeRate > DEGRADE_OVERRUN_RATE,
  };
}

function distanceSquared(focus, entity) {
  const dx = Number(entity.x) - Number(focus.x);
  const dy = Number(entity.y) - Number(focus.y);
  const dz = Number(entity.z) - Number(focus.z);
  return dx * dx + dy * dy + dz * dz;
}

function compareEntityId(left, right) {
  const a = BigInt(left);
  const b = BigInt(right);
  return a < b ? -1 : a > b ? 1 : 0;
}

export function truncateAoi(entities, focus, cap) {
  assertPositiveInt(cap, "aoi cap");
  if (!Array.isArray(entities)) {
    throw new Error("entities must be an array");
  }
  const seen = new Set();
  const ranked = entities.map((entity) => {
    if (entity == null || typeof entity !== "object") {
      throw new Error("entity must be an object");
    }
    if (entity.id === undefined || entity.id === null || entity.id === "") {
      throw new Error("entity.id is required");
    }
    const id = String(entity.id);
    if (seen.has(id)) {
      throw new Error(`duplicate entity.id in interest set: ${id}`);
    }
    seen.add(id);
    return {
      id,
      distance_sq: distanceSquared(focus, entity),
    };
  });
  ranked.sort((left, right) => {
    if (left.distance_sq !== right.distance_sq) {
      return left.distance_sq < right.distance_sq ? -1 : 1;
    }
    return compareEntityId(left.id, right.id);
  });
  return ranked.slice(0, cap).map((entry) => entry.id);
}

export function aoiCapForRole(policy, role) {
  if (role !== "viewer" && role !== "aigent") {
    throw new Error('role must be "viewer" or "aigent"');
  }
  if (role === "aigent") {
    return AOI_HARD_CAP;
  }
  return Math.min(policy.viewer_aoi_cap, AOI_HARD_CAP);
}

function effectivePerceptHz(configuredHz, floorHz) {
  const configured =
    configuredHz === undefined || configuredHz === null
      ? AIGENT_PERCEPT_DEFAULT_HZ
      : configuredHz;
  if (!Number.isFinite(configured) || configured <= 0) {
    throw new Error("configured percept Hz must be a positive finite number");
  }
  const clampedConfig = Math.min(AIGENT_PERCEPT_MAX_HZ, Math.max(1, configured));
  if (floorHz === null || floorHz === undefined) {
    return clampedConfig;
  }
  return Math.min(clampedConfig, floorHz);
}

export function classifyCapacityTarget(count, target) {
  if (!Number.isSafeInteger(count) || count < 0) {
    throw new Error("count must be a non-negative integer");
  }
  return {
    count,
    target,
    meets_target: count >= target,
    over_target: count > target,
  };
}

export function classifyCadenceDelivery(expectedHz, observedIntervalTicks) {
  if (!Number.isFinite(expectedHz) || expectedHz <= 0) {
    throw new Error("expectedHz must be positive");
  }
  assertPositiveInt(observedIntervalTicks, "observedIntervalTicks");
  const expectedInterval = SIM_TICK_HZ / expectedHz;
  const delta = Math.abs(observedIntervalTicks - expectedInterval);
  return {
    expected_hz: expectedHz,
    expected_interval_ticks: expectedInterval,
    observed_interval_ticks: observedIntervalTicks,
    within_tolerance: delta <= CADENCE_TOLERANCE_TICKS,
    tolerance_ticks: CADENCE_TOLERANCE_TICKS,
  };
}

function appendTrace(trace, event) {
  trace.push(canonicalize(event));
}

function evaluateBoundary(state, trace) {
  const windows = classifyWindows(state.overrun_history);
  const before = policyFromLevel(state.level);
  let action = "hold";
  if (windows.degrade_triggers) {
    const max = maxDegradationLevel();
    if (state.level < max) {
      state.level += 1;
      action = "advance";
    } else {
      action = "hold";
    }
  } else if (windows.pass_healthy) {
    if (state.level > 0) {
      state.level -= 1;
      action = "retreat";
    } else {
      action = "hold";
    }
  }
  const after = policyFromLevel(state.level);
  appendTrace(trace, {
    type: "degradation_evaluated",
    action,
    at_bound:
      (windows.degrade_triggers && before.level === maxDegradationLevel()) ||
      (windows.pass_healthy && before.level === 0 && action === "hold"),
    pass_rate: windows.pass_rate,
    degrade_rate: windows.degrade_rate,
    before,
    after,
  });
  return after;
}

export function evaluateScenario(initial, steps, inspect) {
  const state = normalizedState(initial);
  const trace = [];
  const stepsList = steps ?? [];

  for (const step of stepsList) {
    if (step == null || typeof step !== "object" || typeof step.op !== "string") {
      throw new Error("each step requires an op string");
    }
    switch (step.op) {
      case "observe_ticks": {
        const overruns = step.overruns;
        if (!Array.isArray(overruns) || overruns.length === 0) {
          throw new Error("observe_ticks.overruns must be a non-empty array");
        }
        for (const flag of overruns) {
          state.overrun_history.push(flag ? 1 : 0);
          state.tick += 1;
          updateSustainCounters(state);
          if (state.tick % DEGRADE_WINDOW_TICKS === 0) {
            evaluateBoundary(state, trace);
          }
        }
        break;
      }
      case "observe_ticks_pattern": {
        const count = step.count;
        assertPositiveInt(count, "observe_ticks_pattern.count");
        const overrunEvery = step.overrun_every;
        assertPositiveInt(overrunEvery, "observe_ticks_pattern.overrun_every");
        for (let i = 0; i < count; i += 1) {
          const overrun = (i + 1) % overrunEvery === 0 ? 1 : 0;
          state.overrun_history.push(overrun);
          state.tick += 1;
          updateSustainCounters(state);
          if (state.tick % DEGRADE_WINDOW_TICKS === 0) {
            evaluateBoundary(state, trace);
          }
        }
        break;
      }
      case "set_counts": {
        if (step.viewers !== undefined) {
          if (!Number.isSafeInteger(step.viewers) || step.viewers < 0) {
            throw new Error("viewers must be a non-negative integer");
          }
          state.viewers = step.viewers;
        }
        if (step.aigents !== undefined) {
          if (!Number.isSafeInteger(step.aigents) || step.aigents < 0) {
            throw new Error("aigents must be a non-negative integer");
          }
          state.aigents = step.aigents;
        }
        break;
      }
      case "admit_viewer": {
        const policy = policyFromLevel(state.level);
        if (policy.refuse_new_viewers) {
          appendTrace(trace, {
            type: "viewer_admission",
            accepted: false,
            reason: VIEWER_REFUSAL_CODE,
            retry_hint: true,
            viewers: state.viewers,
          });
        } else {
          state.viewers += 1;
          appendTrace(trace, {
            type: "viewer_admission",
            accepted: true,
            viewers: state.viewers,
            capacity: classifyCapacityTarget(
              state.viewers,
              CONCURRENT_VIEWERS_TARGET,
            ),
          });
        }
        break;
      }
      case "admit_aigent": {
        state.aigents += 1;
        appendTrace(trace, {
          type: "aigent_admission",
          accepted: true,
          aigents: state.aigents,
          capacity: classifyCapacityTarget(
            state.aigents,
            CONCURRENT_AIGENTS_TARGET,
          ),
        });
        break;
      }
      case "assess_capacity": {
        const role = step.role;
        const windows = classifyWindows(state.overrun_history);
        if (role === "viewer") {
          const capacity = classifyCapacityTarget(
            state.viewers,
            CONCURRENT_VIEWERS_TARGET,
          );
          const refuse = policyFromLevel(state.level).refuse_new_viewers;
          const sustained =
            state.viewer_sustain_ticks >= CAPACITY_SUSTAIN_TICKS;
          const passed =
            capacity.meets_target &&
            sustained &&
            windows.pass_healthy &&
            !refuse;
          appendTrace(trace, {
            type: "capacity_assessment",
            role,
            sustain_ticks_required: CAPACITY_SUSTAIN_TICKS,
            sustain_ticks: state.viewer_sustain_ticks,
            sustained,
            pass_window_healthy: windows.pass_healthy,
            refuse_new_viewers: refuse,
            passed,
            ...capacity,
          });
        } else if (role === "aigent") {
          const capacity = classifyCapacityTarget(
            state.aigents,
            CONCURRENT_AIGENTS_TARGET,
          );
          const sustained =
            state.aigent_sustain_ticks >= CAPACITY_SUSTAIN_TICKS;
          const passed =
            capacity.meets_target && sustained && windows.pass_healthy;
          appendTrace(trace, {
            type: "capacity_assessment",
            role,
            sustain_ticks_required: CAPACITY_SUSTAIN_TICKS,
            sustain_ticks: state.aigent_sustain_ticks,
            sustained,
            pass_window_healthy: windows.pass_healthy,
            passed,
            ...capacity,
          });
        } else {
          throw new Error('assess_capacity.role must be "viewer" or "aigent"');
        }
        break;
      }
      case "truncate_aoi": {
        const policy = policyFromLevel(state.level);
        const role = step.role ?? "viewer";
        const cap = aoiCapForRole(policy, role);
        const kept = truncateAoi(step.entities ?? [], state.focus, cap);
        appendTrace(trace, {
          type: "aoi_truncated",
          role,
          cap,
          kept_ids: kept,
        });
        break;
      }
      case "effective_percept": {
        const policy = policyFromLevel(state.level);
        const hz = effectivePerceptHz(
          step.configured_hz,
          policy.aigent_percept_floor_hz,
        );
        appendTrace(trace, {
          type: "effective_percept",
          configured_hz: step.configured_hz ?? AIGENT_PERCEPT_DEFAULT_HZ,
          floor_hz: policy.aigent_percept_floor_hz,
          effective_hz: hz,
        });
        break;
      }
      case "assess_cadence": {
        const policy = policyFromLevel(state.level);
        const role = step.role;
        let expected;
        if (role === "viewer") {
          expected = policy.viewer_cadence_hz;
        } else if (role === "aigent") {
          expected = effectivePerceptHz(
            step.configured_hz,
            policy.aigent_percept_floor_hz,
          );
        } else {
          throw new Error('assess_cadence.role must be "viewer" or "aigent"');
        }
        appendTrace(trace, {
          type: "cadence_assessment",
          role,
          ...classifyCadenceDelivery(expected, step.observed_interval_ticks),
        });
        break;
      }
      case "observe_queue": {
        const bytes = step.bytes;
        if (!Number.isSafeInteger(bytes) || bytes < 0) {
          throw new Error("observe_queue.bytes must be a non-negative integer");
        }
        if (state.connection_closed) {
          appendTrace(trace, {
            type: "queue_observation",
            ignored: true,
            reason: "connection_closed",
          });
          break;
        }
        if (bytes > QUEUE_LIMIT_BYTES) {
          state.queue_over_limit_ticks += 1;
        } else {
          state.queue_over_limit_ticks = 0;
        }
        let disconnected = false;
        if (state.queue_over_limit_ticks >= OVERFLOW_DISCONNECT_TICKS) {
          state.connection_closed = true;
          disconnected = true;
        }
        appendTrace(trace, {
          type: "queue_observation",
          bytes,
          over_limit: bytes > QUEUE_LIMIT_BYTES,
          over_limit_ticks: state.queue_over_limit_ticks,
          coalesced: bytes > QUEUE_LIMIT_BYTES,
          disconnected,
          limit_bytes: QUEUE_LIMIT_BYTES,
          disconnect_ticks: OVERFLOW_DISCONNECT_TICKS,
        });
        break;
      }
      case "inspect_policy": {
        appendTrace(trace, {
          type: "policy",
          ...policyFromLevel(state.level),
        });
        break;
      }
      default:
        throw new Error(`unknown op: ${step.op}`);
    }
  }

  const result = { trace };
  if (inspect) {
    const finalState = {
      tick: state.tick,
      level: state.level,
      policy: policyFromLevel(state.level),
      viewers: state.viewers,
      aigents: state.aigents,
      viewer_sustain_ticks: state.viewer_sustain_ticks,
      aigent_sustain_ticks: state.aigent_sustain_ticks,
      connection_closed: state.connection_closed,
      queue_over_limit_ticks: state.queue_over_limit_ticks,
    };
    if (inspect === true || inspect.include_history) {
      finalState.overrun_history_length = state.overrun_history.length;
      const windows = classifyWindows(state.overrun_history);
      finalState.windows = windows;
    }
    result.final_state = canonicalize(finalState);
  }
  return canonicalize(result);
}

export function evaluateFixtureCase(fixture, scenario) {
  return evaluateScenario(scenario.initial, scenario.steps, scenario.inspect);
}

export function validateFixture(fixture) {
  if (fixture.fixture_format !== "aigent.workload.semantic-fixtures") {
    throw new Error("unexpected fixture_format");
  }
  if (fixture.fixture_version !== 1) {
    throw new Error("unexpected fixture_version");
  }
  if (fixture.contract !== "workload/v1/CONTRACT.md") {
    throw new Error("unexpected contract pointer");
  }
  const limits = fixture.limits;
  if (!limits || typeof limits !== "object") {
    throw new Error("limits object required");
  }
  const expected = {
    concurrent_aigents: CONCURRENT_AIGENTS_TARGET,
    concurrent_viewers: CONCURRENT_VIEWERS_TARGET,
    aoi_hard_cap: AOI_HARD_CAP,
    sim_tick_hz: SIM_TICK_HZ,
    sim_tick_ms: SIM_TICK_MS,
    aigent_percept_default_hz: AIGENT_PERCEPT_DEFAULT_HZ,
    aigent_percept_max_hz: AIGENT_PERCEPT_MAX_HZ,
    viewer_cadence_steps_hz: [...VIEWER_CADENCE_STEPS_HZ],
    viewer_aoi_steps: [...VIEWER_AOI_STEPS],
    aigent_percept_floor_steps_hz: [...AIGENT_PERCEPT_FLOOR_STEPS_HZ],
    pass_window_ticks: PASS_WINDOW_TICKS,
    degrade_window_ticks: DEGRADE_WINDOW_TICKS,
    pass_overrun_rate: PASS_OVERRUN_RATE,
    degrade_overrun_rate: DEGRADE_OVERRUN_RATE,
    queue_limit_bytes: QUEUE_LIMIT_BYTES,
    overflow_disconnect_ticks: OVERFLOW_DISCONNECT_TICKS,
    viewer_refusal_code: VIEWER_REFUSAL_CODE,
    capacity_sustain_ticks: CAPACITY_SUSTAIN_TICKS,
    cadence_tolerance_ticks: CADENCE_TOLERANCE_TICKS,
  };
  if (JSON.stringify(canonicalize(limits)) !== JSON.stringify(canonicalize(expected))) {
    throw new Error("fixture limits must match exported workload constants");
  }
  if (!Array.isArray(fixture.cases) || fixture.cases.length === 0) {
    throw new Error("cases must be a non-empty array");
  }
  const ids = new Set();
  for (const scenario of fixture.cases) {
    if (!scenario.id || typeof scenario.id !== "string") {
      throw new Error("each case requires a string id");
    }
    if (ids.has(scenario.id)) {
      throw new Error(`duplicate case id: ${scenario.id}`);
    }
    ids.add(scenario.id);
    if (!scenario.expect || !Array.isArray(scenario.expect.trace)) {
      throw new Error(`${scenario.id} requires expect.trace`);
    }
  }
}

export function loadFixture() {
  return JSON.parse(fs.readFileSync(fixturePath, "utf8"));
}
