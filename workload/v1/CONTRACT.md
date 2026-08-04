# Workload and degradation contract v1

This document is the normative Step 0 contract for v1 workload targets,
measurement windows, cadence decoupling, AOI truncation, and the ordered
degradation ladder. It implements
[ARCHITECTURE.md](../../ARCHITECTURE.md) §1 and
[ADR-0006](../../docs/adr/0006-workload-targets-and-degradation-ladder.md).

It composes with the
[protocol v1 contract](../../protocol/v1/CONTRACT.md) (per-connection queue
and disconnect window), the
[world v1 contract](../../world/v1/CONTRACT.md) (entity identity and
geometry), and the
[replay v1 contract](../../replay/v1/CONTRACT.md) (durable generations must
not stall the tick). The future ruleset constitution cites these targets as
non-votable. Runtime servers, the load harness, and generated bindings are
outside this contract.

The words **MUST**, **MUST NOT**, **SHOULD**, and **MAY** are normative.

## 1. Design targets

These are v1 design targets. A deployment that cannot meet them is out of
compliance for that target; they are not aspirations.

| Target | Value | Owner |
| --- | --- | --- |
| Concurrent aigents | 300 | workload |
| Concurrent viewers | 500; degraded admission beyond | workload |
| Max entities in one connection AOI | 100 hard cap | workload |
| Sim tick | 20 Hz / 50 ms | workload |
| Aigent percept cadence | 5 Hz default; configurable up to 20 Hz | workload |
| Viewer snapshot cadence | 10 Hz default | workload |
| Per-connection outbound queue | 256 KiB; coalesce over limit; 2 s sustained overflow → disconnect | protocol (referenced) |
| Tick overrun budget | pass < 1% / 60 s; degrade > 5% / 30 s | workload |

Cadences are decoupled from the sim tick. Nothing in this contract requires
every consumer to be fed at 20 Hz. Simulation and serialization MUST remain
separate stages: a slow client MUST NOT stall the simulation stage.

## 2. Measurement definitions

All windows are counted in simulation ticks at 20 Hz unless noted.

### 2.1 Overrun and sim-tick rate

A tick is an **overrun** when the simulation stage alone exceeds 50 ms.
Serialization, persistence, and socket work are outside that measurement.

The **sim-tick rate** target passes when both are true over the pass window:

1. the simulation stage completes within 50 ms on enough ticks that the pass
   window stays healthy (§2.2); and
2. the authoritative tick index advances by exactly one per scheduled
   simulation step (no skipped or doubled indexes).

Wall-clock scheduling jitter is a load-harness measurement, not a semantic
oracle input. The harness MUST also assert that 1,200 scheduled ticks occupy
wall time within `[59.0, 61.0]` seconds on the target host; that wall-clock
band is outside this evaluator and is recorded by task-009.

### 2.2 Pass window

The pass window is the trailing **1,200** ticks (60 s). Let `p` be the number
of overruns in that window. The window is **healthy** when
`p / 1200 < 0.01`. A partial window shorter than 1,200 ticks MUST NOT be used
for recovery decisions.

### 2.3 Degrade window

The degrade window is the trailing **600** ticks (30 s). Let `d` be the number
of overruns in that window. The window **triggers degradation** when
`d / 600 > 0.05`. A partial window shorter than 600 ticks MUST NOT advance
degradation.

### 2.4 Evaluation boundary

Degradation state MAY change only when the authoritative tick index is a
positive multiple of 600 (ticks 600, 1200, 1800, …), using tick 0 as the fixed
origin. At each such boundary the server MUST apply exactly one of:

1. **advance** one substep if the just-closed degrade window triggers and the
   ladder is not already at its deepest level;
2. else **retreat** one substep if the pass window ending at that boundary is
   healthy and the ladder is not already at level 0;
3. else **hold**.

Hold covers both “no threshold crossed” and “threshold crossed but already at
the corresponding bound.” Fixtures MAY surface an `at_bound` boolean on the
evaluation event; it is diagnostic and does not create a fourth action.

### 2.5 Capacity targets

Concurrent-aigent and concurrent-viewer targets are sustained-capacity claims
over the pass window length (**1,200** ticks). A deployment tracks consecutive
ticks during which the live session count is at or above the target. Those
counters reset to zero on any tick below target.

| Target | Pass | Fail |
| --- | --- | --- |
| Concurrent aigents = 300 | `aigent_sustain_ticks ≥ 1200`, the pass window is healthy, and live aigents ≥ 300 | Any of those conditions false. The ladder MUST NOT refuse aigent sessions. |
| Concurrent viewers = 500 | `viewer_sustain_ticks ≥ 1200`, the pass window is healthy, live viewers ≥ 500, and the refuse-new-viewers rung is inactive | Any of those conditions false |

**Degraded admission beyond 500** means viewer counts may exceed 500 while the
refuse-new-viewers rung is inactive. That is allowed and is not itself a
capacity failure. Once the refuse-new-viewers rung is active, new viewer
admissions MUST fail closed; existing viewers remain; the viewer capacity
target cannot pass while that rung is active.

### 2.6 Cadence targets

Effective viewer snapshot cadence and effective aigent percept cadence are
measured over the pass window. Let `expected_hz` be the active effective rate
from §3–§4. The expected interval in ticks is `20 / expected_hz`. A delivery
stream **passes** when every observed inter-delivery interval in the window
differs from that expectation by at most **1** tick. Missed deliveries that
stretch an interval beyond that tolerance fail the cadence target for that
consumer class.

### 2.7 AOI hard cap

The AOI target passes when, for every connection over the pass window, the
delivered interest set never exceeds the active AOI cap from §5. Exceeding the
cap is a fail regardless of degradation level.

### 2.8 Queue target

Queue pass/fail is owned by protocol v1: limit 262,144 bytes; exactly-at-limit
is not over; over-limit coalesces; 40 consecutive over-limit observations at
20 Hz disconnect with `SUSTAINED_OUTBOUND_OVERFLOW`. Workload MUST import those
constants rather than redefine them.

## 3. Effective cadences and caps

Default effective values while undegraded:

- viewer snapshot cadence = 10 Hz;
- viewer AOI cap = 100;
- new viewer connections accepted (including counts ≥ 500) while the
  refuse-new-viewers rung is inactive;
- aigent percept cadence = the aigent's configured rate, clamped to
  `[1, 20]` Hz and defaulting to 5 Hz when unset, with **no** degradation
  floor applied.

Under degradation, configured aigent percept rates are additionally clamped
by the active aigent percept floor from §4 when that floor is non-null.

## 4. Degradation ladder

Rungs apply in order. Within a rung, listed substeps apply before the next
rung. Aigents are always prioritized over viewers: viewer refusal MUST precede
any aigent percept-floor drop, and this ladder MUST NOT refuse aigent command
sessions.

| Order | Rung | Substeps |
| --- | --- | --- |
| 1 | Viewer cadence | 10 → 5 → 2 Hz |
| 2 | Viewer AOI cap | 100 → 50 → 25 |
| 3 | Refuse new viewers | single step; existing viewers remain; refusals use typed workload-owned code `VIEWERS_DEGRADED` with `retry_hint=true` |
| 4 | Aigent percept floor | null → 5 → 2 → 1 Hz |

Before rung 4 the aigent percept floor is **null** (no extra clamp). The first
advance into rung 4 sets the floor to 5 Hz; further advances walk 2 Hz then
1 Hz.

Advance walks this table top-to-bottom, left-to-right. Retreat walks it in
reverse. Leaving rung 3 re-enables new viewer admission at the current
cadence and AOI substeps.

While rung 3 is active, attempts to open a new viewer connection MUST fail
closed with `VIEWERS_DEGRADED` and a retry hint and MUST NOT displace an
existing viewer. `VIEWERS_DEGRADED` is owned by this workload contract until a
protocol enum publishes it; it is not imported from protocol v1.

## 5. AOI truncation

Every connection has an active AOI cap:

- **aigent** connections always use the hard cap **100**;
- **viewer** connections use `min(viewer_aoi_cap, 100)` from the active
  degradation policy.

Interest-set entity IDs MUST be unique. When the interest set exceeds the
active cap it MUST be truncated nearest-first. Distance is the Euclidean
distance in canonical world coordinates from the connection's focus point to
the entity origin. Ties break by ascending unsigned entity ID only.
Truncation MUST NOT change authoritative world state.

## 6. Outbound queue (protocol reference)

Workload defers to protocol v1 for the per-connection outbound queue and
imports its executable constants. Workload MUST NOT define a second
disconnect threshold. System-wide degradation in §4 is the response to tick
overrun, not to a single slow client.

## 7. Harness consumption

A load harness MUST treat the tables in §1 and §4 and the windows and
pass/fail rules in §2 as the sole source of numeric thresholds for v1
compliance claims. It MUST NOT invent alternate cadence ladders, AOI caps,
overrun windows, capacity sustain durations, or cadence tolerances.

## 8. Conformance boundary

[`conformance/workload-v1.json`](conformance/workload-v1.json) supplies
example scenarios. The evaluator derives traces and effective policy from this
contract. Fixtures MUST NOT supply oracle fields that replace derived
degradation decisions, AOI survivor sets, cadence assessments, or window
classifications.

Authentication, billing, per-origin admission control, and spatial sharding
remain outside this contract.
