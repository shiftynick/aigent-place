# ADR 0006: Workload targets and degradation ladder

- **Status:** accepted
- **Date:** 2026-08-04
- **Task:** task-013

## Context and problem statement

ARCHITECTURE §1 locks the v1 concurrent-connection targets, cadence
defaults, AOI hard cap, outbound queue bound, and the ordered degradation
ladder. It does not fix measurement windows, degradation substep sizes, or
recovery rules. Those choices must be fixed before a load harness or server
can consume the contract without guessing, and before the ruleset
constitution can treat §1 targets as a non-votable envelope.

Operator authorization for these judgments was given on 2026-08-04
("use your judgement on all" open Step 0 questions). That authorization
covers the substance of this ADR; status is `accepted` under that explicit
operator go-ahead.

## Decision drivers

- Every §1 threshold must have a measurement window and pass/fail definition.
- Overload transitions must be deterministic and fixture-checkable.
- Aigents remain prioritized over viewers.
- Protocol already owns the 256 KiB outbound queue and 2 s disconnect window;
  workload must reference those without inventing a second disconnect rule.
- Substep sizes should be few, reversible, and obvious to a future harness.

## Considered options

1. Leave substeps and windows to implementation. Rejected: task-013
   acceptance requires the harness can consume the contract without guessing.
2. Collapse each ladder rung to a single jump (for example cadence 10 → 2).
   Rejected: ARCHITECTURE already names intermediate cadence values, and
   abrupt jumps make soak/recovery harder to reason about.
3. Publish continuous functions of overrun rate. Rejected: harder to test and
   harder for governance envelopes to cite.
4. Fix discrete substeps, rolling tick windows at 20 Hz, and one-step
   advance/retreat evaluation. Selected.

## Decision

### Targets and ownership

The v1 design targets are:

| Target | Value |
| --- | --- |
| Concurrent aigents | 300 |
| Concurrent viewers | 500 (degraded admission beyond) |
| Max entities in one connection AOI | 100 hard cap; nearest-first truncation |
| Sim tick | 20 Hz / 50 ms |
| Aigent percept cadence | 5 Hz default; per-aigent configurable up to 20 Hz |
| Viewer snapshot cadence | 10 Hz nominal |
| Per-connection outbound queue | 256 KiB; coalesce when over; 2 s sustained overflow → disconnect (protocol-owned constants) |
| Tick overrun budget | pass when overrun rate < 1% over rolling 60 s; degrade when overrun rate > 5% sustained for 30 s |

Workload owns system-wide measurement, cadence/AOI/admission degradation, and
AOI truncation policy. Protocol owns the per-connection queue byte limit and
disconnect observation window already fixed in the protocol contract.

### Measurement

At 20 Hz:

- A tick is an overrun when its simulation stage exceeds 50 ms.
- The **pass window** is the trailing 1,200 ticks (60 s). The system is
  healthy for recovery purposes when `overrun_count / 1200 < 0.01`.
- The **degrade window** is the trailing 600 ticks (30 s). Degradation
  advances when `overrun_count / 600 > 0.05`.
- Evaluation runs once per degrade-window boundary (every 600 ticks) using
  only those closed windows. Partial windows do not change rung state.

### Degradation ladder and substeps

Rungs apply in order. Within a rung, substeps apply before the next rung:

1. **Viewer cadence:** `10 → 5 → 2` Hz.
2. **Viewer AOI cap:** `100 → 50 → 25` entities (still nearest-first). Aigent
   AOI remains the hard cap 100.
3. **Refuse new viewer connections** with typed code `VIEWERS_DEGRADED` and a
   retry hint. Existing viewers stay.
4. **Aigent percept floor:** after refuse, clamp through `5 → 2 → 1` Hz.
   Before this rung the floor is null and configured rates may reach 20 Hz.
   Command sessions remain accepted.

Aigents are never refused by this ladder. Viewer refusal precedes any aigent
percept drop.

### Capacity, cadence, and AOI pass/fail

- Capacity targets (300 aigents / 500 viewers) pass when sustained for the
  1,200-tick pass window with a healthy overrun pass window; viewers may
  exceed 500 until refuse-new-viewers activates.
- Cadence streams pass when inter-delivery intervals stay within 1 tick of
  `20 / effective_hz` over that window.
- AOI passes when no connection's delivered set exceeds its role-specific
  active cap.
- Queue pass/fail remains protocol-owned; workload imports protocol
  constants.

### Recovery

At each evaluation boundary:

- if the degrade window triggers, advance exactly one substep;
- else if the pass window is healthy, retreat exactly one substep;
- else hold.

Retreat restores the previous substep in reverse ladder order. Leaving the
terminal refuse-viewers rung re-allows new viewers at the current AOI/cadence
substeps.

### AOI truncation

Any connection whose interest set exceeds the active AOI cap keeps the nearest
entities first, breaking distance ties by ascending unsigned entity ID. The
hard cap 100 applies even when not degraded.

## Consequences

### Good

- The future load harness has numeric windows and substeps to assert.
- Constitution/workload coupling is explicit: §1 targets are citation-stable.
- Priority of aigents over viewers is encoded in rung order.

### Bad

- Discrete substeps cannot express fine-grained continuous load shaping.
- Fixed 30 s / 60 s windows can oscillate near the threshold; that is an
  accepted v1 trade for determinism.
- AOI halves (100/50/25) are judgment defaults, not measured optima.

## Validation

`workload/v1` semantic fixtures must prove healthy hold, each ladder advance
through the deepest aigent floor, viewer refusal before aigent percept drop,
retreat that re-admits viewers after refuse, one-step recovery, nearest-first
AOI truncation with role-specific caps, cadence tolerance failure, capacity
sustain pass/fail, slow-client queue overflow that disconnects without
advancing degradation, and that queue disconnect constants remain the
protocol values.

## Follow-up

- task-009 consumes these thresholds in the load harness.
- task-012 cites these targets inside the non-votable constitution envelope.
