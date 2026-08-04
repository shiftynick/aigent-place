import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  CONCURRENT_AIGENTS_TARGET,
  CONCURRENT_VIEWERS_TARGET,
  DEGRADE_OVERRUN_RATE,
  DEGRADE_WINDOW_TICKS,
} from "./workload-contract.mjs";

export const SOAK_ERROR_RATE_LIMIT = 0.01;

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const fixturePath = path.join(root, "ruleset/v1/conformance/ruleset-v1.json");

/** @typedef {"grandfather"|"clamp"|"evict"} Migration */

/**
 * @type {Record<string, {
 *   type: "int"|"number",
 *   min: number,
 *   max: number,
 *   default: number,
 *   meta: boolean,
 *   migration: Migration
 * }>}
 */
export const PARAMETER_CATALOG = Object.freeze({
  "movement.lease_ttl_ms": {
    type: "int",
    min: 1000,
    max: 60000,
    default: 10000,
    meta: false,
    migration: "clamp",
  },
  "movement.max_speed_mm_per_s": {
    type: "int",
    min: 1,
    max: 50000,
    default: 5000,
    meta: false,
    migration: "clamp",
  },
  "movement.blocked_lease_ticks": {
    type: "int",
    min: 1,
    max: 200,
    default: 20,
    meta: false,
    migration: "clamp",
  },
  "movement.displacement_step_mm": {
    type: "int",
    min: 1,
    max: 1000,
    default: 50,
    meta: false,
    migration: "clamp",
  },
  "movement.max_displacement_radius_mm": {
    type: "int",
    min: 0,
    max: 100000,
    default: 5000,
    meta: false,
    migration: "clamp",
  },
  "movement.unstick_blocked_ticks": {
    type: "int",
    min: 1,
    max: 2000,
    default: 40,
    meta: false,
    migration: "clamp",
  },
  "movement.unstick_rate_per_minute": {
    type: "int",
    min: 1,
    max: 60,
    default: 6,
    meta: false,
    migration: "clamp",
  },
  "shape.body_max_parts": {
    type: "int",
    min: 1,
    max: 256,
    default: 32,
    meta: false,
    migration: "grandfather",
  },
  "shape.body_max_joints": {
    type: "int",
    min: 0,
    max: 256,
    default: 32,
    meta: false,
    migration: "grandfather",
  },
  "shape.object_max_parts": {
    type: "int",
    min: 1,
    max: 256,
    default: 64,
    meta: false,
    migration: "grandfather",
  },
  "shape.object_max_joints": {
    type: "int",
    min: 0,
    max: 256,
    default: 64,
    meta: false,
    migration: "grandfather",
  },
  "shape.max_extent_mm": {
    type: "int",
    min: 1,
    max: 100000,
    default: 10000,
    meta: false,
    migration: "clamp",
  },
  "budget.objects_per_aigent": {
    type: "int",
    min: 0,
    max: 10000,
    default: 100,
    meta: false,
    migration: "evict",
  },
  "budget.area_mm2_per_aigent": {
    type: "int",
    min: 0,
    max: 1e12,
    default: 25000000,
    meta: false,
    migration: "evict",
  },
  "budget.chunk_touches_per_hour": {
    type: "int",
    min: 1,
    max: 100000,
    default: 500,
    meta: false,
    migration: "clamp",
  },
  "lifecycle.despawn_timeout_ms": {
    type: "int",
    min: 1000,
    max: 86400000,
    default: 300000,
    meta: false,
    migration: "clamp",
  },
  "speech.radius_mm": {
    type: "int",
    min: 0,
    max: 100000,
    default: 30000,
    meta: false,
    migration: "clamp",
  },
  "speech.rate_per_minute": {
    type: "int",
    min: 0,
    max: 600,
    default: 60,
    meta: false,
    migration: "clamp",
  },
  "channel.post_rate_per_minute": {
    type: "int",
    min: 0,
    max: 600,
    default: 30,
    meta: false,
    migration: "clamp",
  },
  "action.submission_rate_per_second": {
    type: "int",
    min: 1,
    max: 100,
    default: 20,
    meta: false,
    migration: "clamp",
  },
  "physics.min_object_thickness_mm": {
    type: "int",
    min: 1,
    max: 1000,
    default: 10,
    meta: false,
    migration: "clamp",
  },
  "physics.sweep_max_mm": {
    type: "int",
    min: 1,
    max: 100000,
    default: 5000,
    meta: false,
    migration: "clamp",
  },
  "governance.quorum_ratio": {
    type: "number",
    min: 0.01,
    max: 1,
    default: 0.1,
    meta: true,
    migration: "clamp",
  },
  "governance.pass_threshold": {
    type: "number",
    min: 0.5,
    max: 1,
    default: 0.5,
    meta: true,
    migration: "clamp",
  },
  "governance.vote_duration_ticks": {
    type: "int",
    min: 1200,
    max: 2592000,
    default: 72000,
    meta: true,
    migration: "clamp",
  },
  "governance.soak_delay_ticks": {
    type: "int",
    min: 200,
    max: 120000,
    default: 1200,
    meta: true,
    migration: "clamp",
  },
  "governance.meta_quorum_ratio": {
    type: "number",
    min: 0.01,
    max: 1,
    default: 0.2,
    meta: true,
    migration: "clamp",
  },
  "governance.meta_pass_threshold": {
    type: "number",
    min: 0.5,
    max: 1,
    default: 2 / 3,
    meta: true,
    migration: "clamp",
  },
  "governance.meta_vote_duration_ticks": {
    type: "int",
    min: 1200,
    max: 2592000,
    default: 216000,
    meta: true,
    migration: "clamp",
  },
  "governance.meta_soak_delay_ticks": {
    type: "int",
    min: 200,
    max: 120000,
    default: 6000,
    meta: true,
    migration: "clamp",
  },
});

export const VOTER_MIN_ACCOUNT_AGE_DAYS = 7;

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

export function defaultParameters() {
  return Object.fromEntries(
    Object.entries(PARAMETER_CATALOG).map(([path, spec]) => [path, spec.default]),
  );
}

export function envelopeCost(parameters) {
  const bodyParts = parameters["shape.body_max_parts"];
  const objectParts = parameters["shape.object_max_parts"];
  const objects = parameters["budget.objects_per_aigent"];
  const speechRadiusM = parameters["speech.radius_mm"] / 1000;
  const speechRate = parameters["speech.rate_per_minute"];
  const channelRate = parameters["channel.post_rate_per_minute"];
  return (
    CONCURRENT_AIGENTS_TARGET +
    CONCURRENT_VIEWERS_TARGET +
    (bodyParts + objectParts) * objects +
    speechRadiusM * speechRate +
    channelRate
  );
}

export const CONSTITUTION_COST_CEILING = envelopeCost(defaultParameters());

function isInt(value) {
  return Number.isSafeInteger(value);
}

function typeOk(spec, value) {
  if (spec.type === "int") {
    return isInt(value);
  }
  return typeof value === "number" && Number.isFinite(value);
}

export function validateCrossFields(parameters) {
  const failures = [];
  const radius = parameters["movement.max_displacement_radius_mm"];
  const step = parameters["movement.displacement_step_mm"];
  if (radius > 0 && radius < step) {
    failures.push("displacement_radius_below_step");
  }
  if (
    parameters["governance.meta_pass_threshold"] <
    parameters["governance.pass_threshold"]
  ) {
    failures.push("meta_pass_below_ordinary");
  }
  if (
    parameters["governance.meta_quorum_ratio"] <
    parameters["governance.quorum_ratio"]
  ) {
    failures.push("meta_quorum_below_ordinary");
  }
  if (
    parameters["governance.meta_soak_delay_ticks"] <
    parameters["governance.soak_delay_ticks"]
  ) {
    failures.push("meta_soak_below_ordinary");
  }
  if (
    parameters["governance.meta_vote_duration_ticks"] <
    parameters["governance.vote_duration_ticks"]
  ) {
    failures.push("meta_vote_duration_below_ordinary");
  }
  if (
    parameters["shape.body_max_joints"] > parameters["shape.body_max_parts"]
  ) {
    failures.push("body_joints_exceed_parts");
  }
  if (
    parameters["shape.object_max_joints"] > parameters["shape.object_max_parts"]
  ) {
    failures.push("object_joints_exceed_parts");
  }
  return failures;
}

export function validateCandidate(parameters, touchedPaths = Object.keys(parameters)) {
  for (const pathKey of touchedPaths) {
    const spec = PARAMETER_CATALOG[pathKey];
    if (!spec) {
      return { ok: false, reason: "UNKNOWN_PATH", path: pathKey };
    }
    if (!spec.migration) {
      return { ok: false, reason: "MISSING_MIGRATION", path: pathKey };
    }
    const value = parameters[pathKey];
    if (!typeOk(spec, value)) {
      return { ok: false, reason: "TYPE_ERROR", path: pathKey };
    }
    if (value < spec.min || value > spec.max) {
      return { ok: false, reason: "OUT_OF_RANGE", path: pathKey };
    }
  }
  for (const pathKey of Object.keys(PARAMETER_CATALOG)) {
    if (!(pathKey in parameters)) {
      return { ok: false, reason: "INCOMPLETE_CANDIDATE", path: pathKey };
    }
  }
  const cross = validateCrossFields(parameters);
  if (cross.length > 0) {
    return { ok: false, reason: "CROSS_FIELD", failures: cross };
  }
  const cost = envelopeCost(parameters);
  if (cost > CONSTITUTION_COST_CEILING) {
    return {
      ok: false,
      reason: "ENVELOPE_EXCEEDED",
      cost,
      ceiling: CONSTITUTION_COST_CEILING,
    };
  }
  return { ok: true, cost, ceiling: CONSTITUTION_COST_CEILING };
}

export function isEligibleVoter(voter) {
  return (
    Number.isFinite(voter.account_age_days) &&
    voter.account_age_days >= VOTER_MIN_ACCOUNT_AGE_DAYS &&
    Boolean(voter.has_command_handshake)
  );
}

function normalizedState(initial = {}) {
  const live = {
    ...defaultParameters(),
    ...clone(initial.live ?? {}),
  };
  const liveValidation = validateCandidate(live);
  if (!liveValidation.ok) {
    throw new Error(`invalid live generation: ${liveValidation.reason}`);
  }
  return {
    tick: Number.isSafeInteger(initial.tick) ? initial.tick : 0,
    live: {
      generation_id: initial.live_generation_id ?? 1,
      activated_tick: initial.activated_tick ?? 0,
      parameters: live,
    },
    pending: clone(initial.pending ?? null),
    proposal: clone(initial.proposal ?? null),
    voted_accounts: clone(initial.voted_accounts ?? []),
    track_b_backlog: clone(initial.track_b_backlog ?? []),
    soak_overruns: clone(initial.soak_overruns ?? []),
    soak_commands: Number.isSafeInteger(initial.soak_commands)
      ? initial.soak_commands
      : 0,
    soak_errors: Number.isSafeInteger(initial.soak_errors)
      ? initial.soak_errors
      : 0,
    durable: clone(
      initial.durable ?? {
        live_generation_id: initial.live_generation_id ?? 1,
        pending: clone(initial.pending ?? null),
      },
    ),
  };
}

function appendTrace(trace, event) {
  trace.push(canonicalize(event));
}

function touchesMeta(changes) {
  return Object.keys(changes).some((pathKey) => PARAMETER_CATALOG[pathKey]?.meta);
}

function soakHealthy(state) {
  const overruns = state.soak_overruns;
  if (overruns.length >= DEGRADE_WINDOW_TICKS) {
    const slice = overruns.slice(overruns.length - DEGRADE_WINDOW_TICKS);
    const rate = slice.reduce((sum, flag) => sum + flag, 0) / DEGRADE_WINDOW_TICKS;
    if (rate > DEGRADE_OVERRUN_RATE) {
      return false;
    }
  }
  if (state.soak_commands > 0) {
    const errorRate = state.soak_errors / state.soak_commands;
    if (errorRate > SOAK_ERROR_RATE_LIMIT) {
      return false;
    }
  }
  return true;
}

export function evaluateScenario(initial, steps, inspect) {
  const state = normalizedState(initial);
  const trace = [];

  for (const step of steps ?? []) {
    if (!step || typeof step.op !== "string") {
      throw new Error("each step requires an op string");
    }
    switch (step.op) {
      case "propose": {
        const changes = step.changes ?? {};
        const candidate = {
          ...state.live.parameters,
          ...changes,
        };
        const touched = Object.keys(changes);
        if (touched.length === 0) {
          appendTrace(trace, {
            type: "proposal_rejected",
            reason: "EMPTY_PROPOSAL",
          });
          break;
        }
        const result = validateCandidate(candidate, touched);
        if (!result.ok) {
          appendTrace(trace, {
            type: "proposal_rejected",
            ...result,
          });
          break;
        }
        const meta = touchesMeta(changes);
        const duration = meta
          ? state.live.parameters["governance.meta_vote_duration_ticks"]
          : state.live.parameters["governance.vote_duration_ticks"];
        state.proposal = {
          kind: "track_a",
          changes,
          candidate,
          meta,
          votes_for: 0,
          votes_against: 0,
          ballots: 0,
          eligible_snapshot: step.eligible_voters ?? 0,
          opened_at_tick: state.tick,
          closes_at_tick: state.tick + duration,
          voters: [],
        };
        state.voted_accounts = [];
        appendTrace(trace, {
          type: "proposal_accepted",
          kind: "track_a",
          meta,
          cost: result.cost,
          ceiling: result.ceiling,
          paths: touched.sort(compareCodeUnits),
          closes_at_tick: state.proposal.closes_at_tick,
        });
        break;
      }
      case "propose_track_b": {
        const duration =
          state.live.parameters["governance.vote_duration_ticks"];
        state.proposal = {
          kind: "track_b",
          title: step.title ?? "capability",
          id: step.id ?? `b-${state.track_b_backlog.length + 1}`,
          meta: false,
          votes_for: 0,
          votes_against: 0,
          ballots: 0,
          eligible_snapshot: step.eligible_voters ?? 0,
          opened_at_tick: state.tick,
          closes_at_tick: state.tick + duration,
          voters: [],
        };
        state.voted_accounts = [];
        appendTrace(trace, {
          type: "proposal_accepted",
          kind: "track_b",
          id: state.proposal.id,
          closes_at_tick: state.proposal.closes_at_tick,
        });
        break;
      }
      case "vote": {
        if (!state.proposal) {
          appendTrace(trace, {
            type: "vote_rejected",
            reason: "NO_PROPOSAL",
          });
          break;
        }
        const voter = step.voter ?? {};
        if (!isEligibleVoter(voter)) {
          appendTrace(trace, {
            type: "vote_rejected",
            reason: "INELIGIBLE_VOTER",
          });
          break;
        }
        if (!voter.account_id) {
          appendTrace(trace, {
            type: "vote_rejected",
            reason: "MISSING_ACCOUNT_ID",
          });
          break;
        }
        if (state.voted_accounts.includes(voter.account_id)) {
          appendTrace(trace, {
            type: "vote_rejected",
            reason: "DUPLICATE_VOTE",
          });
          break;
        }
        state.voted_accounts.push(voter.account_id);
        state.proposal.ballots += 1;
        if (step.support) {
          state.proposal.votes_for += 1;
        } else {
          state.proposal.votes_against += 1;
        }
        appendTrace(trace, {
          type: "vote_cast",
          support: Boolean(step.support),
          account_id: voter.account_id,
          ballots: state.proposal.ballots,
        });
        break;
      }
      case "close_vote": {
        if (!state.proposal) {
          appendTrace(trace, {
            type: "vote_closed",
            passed: false,
            reason: "NO_PROPOSAL",
          });
          break;
        }
        if (state.tick < state.proposal.closes_at_tick) {
          appendTrace(trace, {
            type: "vote_closed",
            passed: false,
            reason: "VOTE_STILL_OPEN",
            closes_at_tick: state.proposal.closes_at_tick,
            tick: state.tick,
          });
          break;
        }
        const live = state.live.parameters;
        const meta = state.proposal.meta;
        const quorum = meta
          ? live["governance.meta_quorum_ratio"]
          : live["governance.quorum_ratio"];
        const threshold = meta
          ? live["governance.meta_pass_threshold"]
          : live["governance.pass_threshold"];
        const soakDelay = meta
          ? live["governance.meta_soak_delay_ticks"]
          : live["governance.soak_delay_ticks"];
        const eligible = state.proposal.eligible_snapshot;
        const turnout =
          eligible > 0 ? state.proposal.ballots / eligible : 0;
        const approval =
          state.proposal.ballots > 0
            ? state.proposal.votes_for / state.proposal.ballots
            : 0;
        const passesThreshold = meta
          ? approval >= threshold
          : approval > threshold;
        const passes = turnout >= quorum && passesThreshold;
        if (!passes) {
          appendTrace(trace, {
            type: "vote_closed",
            passed: false,
            kind: state.proposal.kind,
            turnout,
            approval,
            quorum,
            threshold,
          });
          state.proposal = null;
          break;
        }
        if (state.proposal.kind === "track_b") {
          const item = {
            id: state.proposal.id,
            title: state.proposal.title,
          };
          state.track_b_backlog.push(item);
          appendTrace(trace, {
            type: "vote_closed",
            passed: true,
            kind: "track_b",
            item,
            live_generation_id: state.live.generation_id,
            pending_generation_id: state.pending?.generation_id ?? null,
          });
          state.proposal = null;
          break;
        }
        state.pending = {
          generation_id: state.live.generation_id + 1,
          parameters: state.proposal.candidate,
          activate_at_tick: state.tick + soakDelay,
          meta,
          changes: state.proposal.changes,
        };
        state.durable.pending = clone(state.pending);
        state.soak_overruns = [];
        state.soak_commands = 0;
        state.soak_errors = 0;
        appendTrace(trace, {
          type: "vote_closed",
          passed: true,
          kind: "track_a",
          turnout,
          approval,
          quorum,
          threshold,
          pending_generation_id: state.pending.generation_id,
          activate_at_tick: state.pending.activate_at_tick,
        });
        state.proposal = null;
        break;
      }
      case "advance_ticks": {
        const count = step.count;
        if (!Number.isSafeInteger(count) || count <= 0) {
          throw new Error("advance_ticks.count must be a positive integer");
        }
        state.tick += count;
        break;
      }
      case "observe_soak": {
        if (!state.pending) {
          appendTrace(trace, {
            type: "soak_ignored",
            reason: "NO_PENDING",
          });
          break;
        }
        const overruns = step.overruns ?? [];
        for (const flag of overruns) {
          state.soak_overruns.push(flag ? 1 : 0);
          state.tick += 1;
          if (step.commands_per_tick) {
            state.soak_commands += step.commands_per_tick;
          }
          if (step.errors_per_tick) {
            state.soak_errors += step.errors_per_tick;
          }
          if (state.tick >= state.pending.activate_at_tick) {
            if (soakHealthy(state)) {
              const previous = state.live.parameters;
              const next = state.pending.parameters;
              const migrations = [];
              for (const pathKey of Object.keys(PARAMETER_CATALOG)) {
                if (previous[pathKey] !== next[pathKey]) {
                  migrations.push({
                    path: pathKey,
                    migration: PARAMETER_CATALOG[pathKey].migration,
                    from: previous[pathKey],
                    to: next[pathKey],
                  });
                }
              }
              state.live = {
                generation_id: state.pending.generation_id,
                activated_tick: state.tick,
                parameters: next,
              };
              state.durable.live_generation_id = state.live.generation_id;
              state.durable.pending = null;
              appendTrace(trace, {
                type: "ruleset_activated",
                generation_id: state.live.generation_id,
                tick: state.tick,
                migrations,
              });
            } else {
              appendTrace(trace, {
                type: "ruleset_rolled_back",
                pending_generation_id: state.pending.generation_id,
                live_generation_id: state.live.generation_id,
                tick: state.tick,
              });
              state.durable.pending = null;
            }
            state.pending = null;
            break;
          }
        }
        break;
      }
      case "recover_crash": {
        state.live.generation_id = state.durable.live_generation_id;
        state.pending = clone(state.durable.pending);
        appendTrace(trace, {
          type: "crash_recovered",
          live_generation_id: state.live.generation_id,
          pending_generation_id: state.pending?.generation_id ?? null,
        });
        break;
      }
      case "inspect": {
        appendTrace(trace, {
          type: "inspect",
          live_generation_id: state.live.generation_id,
          pending_generation_id: state.pending?.generation_id ?? null,
          lease_ttl_ms: state.live.parameters["movement.lease_ttl_ms"],
          backlog_len: state.track_b_backlog.length,
        });
        break;
      }
      default:
        throw new Error(`unknown op: ${step.op}`);
    }
  }

  const result = { trace };
  if (inspect) {
    result.final_state = canonicalize({
      tick: state.tick,
      live_generation_id: state.live.generation_id,
      pending_generation_id: state.pending?.generation_id ?? null,
      lease_ttl_ms: state.live.parameters["movement.lease_ttl_ms"],
      backlog: state.track_b_backlog,
      ceiling: CONSTITUTION_COST_CEILING,
    });
  }
  return canonicalize(result);
}

export function evaluateFixtureCase(_fixture, scenario) {
  return evaluateScenario(scenario.initial, scenario.steps, scenario.inspect);
}

export function validateFixture(fixture) {
  if (fixture.fixture_format !== "aigent.ruleset.semantic-fixtures") {
    throw new Error("unexpected fixture_format");
  }
  if (fixture.fixture_version !== 1) {
    throw new Error("unexpected fixture_version");
  }
  if (fixture.contract !== "ruleset/v1/CONTRACT.md") {
    throw new Error("unexpected contract pointer");
  }
  if (fixture.constitution_cost_ceiling !== CONSTITUTION_COST_CEILING) {
    throw new Error("fixture ceiling must match evaluator ceiling");
  }
  if (!Array.isArray(fixture.cases) || fixture.cases.length === 0) {
    throw new Error("cases must be a non-empty array");
  }
  const ids = new Set();
  for (const scenario of fixture.cases) {
    if (!scenario.id || ids.has(scenario.id)) {
      throw new Error(`bad case id: ${scenario.id}`);
    }
    ids.add(scenario.id);
    if (!scenario.expect?.trace) {
      throw new Error(`${scenario.id} missing expect.trace`);
    }
  }
  const catalogPaths = Object.keys(PARAMETER_CATALOG).sort(compareCodeUnits);
  const fixturePaths = [...(fixture.catalog_paths ?? [])].sort(compareCodeUnits);
  if (JSON.stringify(catalogPaths) !== JSON.stringify(fixturePaths)) {
    throw new Error("fixture catalog_paths must list every PARAMETER_CATALOG path");
  }
}

export function loadFixture() {
  return JSON.parse(fs.readFileSync(fixturePath, "utf8"));
}
