# Task 072: selected shared demo activity contract

Status: selected after two fresh independent adversarial proposal reviews.
Task072 is claimed under the user's explicit selection and architecture delegation.
ADR0014 records the accepted optional semantic contract. This is ONE cohesive improvement:
server-proved cooperative activity, phase-following owner brains, and a public
activity strip. Defer the separate label-layout proposal.

## Product result and boundary

Spectators see what the two aigents are working toward, what each has contributed,
and when the shared round completes. Both first move apart, then return to a
safe meeting formation. Different speeds and delays visibly affect progress.
Completed rounds and recent phase changes accumulate. The server proves the
result from actual motion; owner-side brains select and submit ordinary intents.
This is a repeatable cooperative demonstration, not a claim of model reasoning
or deep open-ended emergent society.

Server `--demo-activity` requires `--demo-plaza` and forbids a journal. SDK
`--activity` requires the fresh two-body plaza setup; it is a NEW optional policy
mode. Plain plaza, compact/wide policies, ordinary worlds and owner-run real
brains keep their current interfaces. There are no new mutation commands,
owner-written narratives, inferred motives or role labels. No auth, durable
activity, general lifecycle, terrain or workflow enforcement change.

## One world phase authority and both-body proof

Five bounded states: READY, SEPARATE, REGROUP, COMPLETE, SUSPENDED.
READY brings both participants into the safe inner band before arming. It awards
no round and no movement credit. Far initial placement cannot arm SEPARATE.
Spawning must preserve the existing reservation of footprints of
already bound participants even when they are unleased. The first owner may
STOP while waiting for the second; ordinary sleeping-body spawn exclusion must
not create a coincident second body and deadlock setup. Keep existing ordinary
and plain-plaza collision/spawn behavior. Test sequential bootstrap with the
first body stopped before the second connects.
SEPARATE starts below the separation threshold; both must earn fresh own
outward contribution and travel before the observed threshold crossing advances.
REGROUP resets BOTH credits/paths/proofs at entry; both must earn fresh own
inward contribution and travel, then stay in the inner band for consecutive
world ticks with both sessions present and BOTH phase-earned proofs valid.
Proof is earned by that body's actual leased motion during THIS phase. It stays
earned while its current net contribution remains sufficient and its epoch/body/
shape remains unchanged. Intentional stillness after contribution is valid;
continuous recent motion is not a dwell condition.
COMPLETE increments the run's count once and holds the visible result briefly.
Then start SEPARATE if still safely formed, otherwise READY. SUSPENDED clears
the failed attempt, holds a truthful reason, and recovers through READY when
both bodies/sessions return. It never resumes saved partial credit.

At first available setup, freeze a shared formation centre and horizontal axis
from the explicit pair; keep them for the attempt. Public rule anchors are
geometry, not commands. Brains derive their own outward and safe stand-off
targets around THIS fixed centre, rather than repeatedly using an unequal-speed
phase-entry midpoint (which would drift across rounds). The centre/axis persist across COMPLETE-to-SEPARATE rounds. A reset followed
by SUSPENDED-to-READY refreezes them from current valid positions within the
bounded setup area. Reject/handle coincident or unsupported anchors explicitly.
Target derivation is bounded within the plaza and leaves margin beyond each
server threshold; reaching a bound must not silently promise impossible credit.

On each movement phase entry, freeze separate per-body starting poses and its
directed axis. Sum only the body's actual horizontal lease-execution path for
travel/proof. Directed contribution is SIGNED NET own displacement along
the phase direction, never accumulated positive wiggles or peer movement.
Each body must satisfy both travel and direction. Non-lease relocation, body
or shape replacement invalidates the attempt. All predicates are evaluated on
the actual post-movement tick draft before that same generation is published.
Accepted/replayed command results, private policy counters and old motion are
not evidence.

Candidate rules for implementation validation: safe centre-distance inner band
[1800,2200] mm for the two approved 1x1m demo footprints; separation >=5500 mm;
both own travel and directed contribution >=1000 mm EACH PHASE; 8 dwell ticks;
20 COMPLETE/recovery-hold ticks; movement/setup progress timeout 400 ticks. There is no continuous
fresh-motion deadline for an already credited, intentionally holding body. New owner outward targets deliberately
overshoot, e.g. 6500mm pair spacing; inward target spacing 2000mm. These are new
design inputs, not claims proven by the old wide policy. Actual geometry must
be safe for the authoritative shapes; unsupported changes suspend the attempt.
Phase-earned proof permits unequal-speed arrival and delays without requiring
keep-alive jiggle. It cannot grant old-phase credit.

## Lifecycle contract

A narrow DEMO-ONLY presence input captures the two private active
owner/connection/command-epoch triples at the tick boundary. Delayed attach must
not replace a newer epoch; cleanup removes only its own matching triple. Never
publish owner identities or session epochs. New epoch invalidates partial credit
even with the same body. Completed run count remains earned until world restart.

| Condition in any phase | Result before completion evaluation |
| --- | --- |
| Slot unbound, body absent, disconnected, or authoritative epoch/body/shape changed | SUSPENDED; clear attempt credit, anchors and dwell; one reset/transition per actual invalidation |
| Observed lease expiry/invalidation | SUSPENDED with inactivity reason; it does not assert cognition or connectivity |
| Natural arrival or STOP after valid contribution, including a motion-stale intentional hold | Preserve phase-earned proof while current net contribution and exact presence remain valid; require safe dwell. STOP cancels its lease as before, so that cancelled lease cannot later expire. Do not renew or keep a STOP lease alive. |
| Connected stationary participant without this phase's credit | No phase success; show missing progress, eventually suspend on timeout |
| Recovered same or replacement sessions and valid bodies | After short recovery hold, READY with zero credit, even without active leases; no recovery deadlock |
| Present bodies have overlapping/unsupported geometry at wake | SUSPENDED with unsafe-geometry reason; no success and no silent promise of automatic displacement. READY may resume only after actual safe geometry is restored. General unstick/displacement remains task052. |
| Counter/token exhaustion | Fail optional activity closed; no duplicated completion or transition key |

Existing explicit force-sleep/despawn work is unfinished. This task adds no
general lifecycle and makes no false claim to test it. Any current transport
forced-close follows the disconnected row. A future explicit inactive-body input
must take the unavailable row before completion. Aim absence alone is not sleep.

External pause BEFORE regroup contribution cannot earn that participant's new
inward credit. Pause AFTER valid contribution can legally permit completion
within the bounded phase lifetime while exact presence, current contribution
and safe geometry remain valid.
The server cannot instantly observe SIGSTOP or cognition. Tests must cover both
cases and a 20-second no-contribution pause without claiming the impossible
blanket “every pause instant prevents a completion.”

## Typed observation and viewer recovery

Add optional DemoActivity v1 to FULL field6 and DELTA field7. BOTH contain a
complete replacement; absence clears activity. Old protobuf clients may ignore
the additive field; retain existing body/delta versions. New consumers validate
the activity atomically with the body transition before committing either.

State includes a non-auth fresh run token, checked reset/transition/round IDs,
observed tick and phase-entry tick, explicit numeric participant slots and
availability, setup/phase anchors, bounded per-body travel/contribution and explicit phase-earned proof tick,
bounded rules and <=8 recent typed transitions. No arbitrary strings. The
startup run token is input to the optional ephemeral world, not tick-time random
or durable state. New run clears rounds; reset preserves earned run count and
monotonic transition IDs. A malformed/unknown activity fails recovery safely.
Counter bounds, ID order, coordinate bounds and phase-state combinations are
contractual. Published progress must not overstate the canonical predicates.

Immutable generation/digest includes activity. Normal absent-state digest bytes
remain unchanged. Full, delta, newest coalesced full, ordered-pressure promoted
full and explicit resync all carry the SAME bounded latest state/history from
their frozen generation. No event-only completion and no entity-only diff filter.
Global objective state does not bypass AOI caps or fabricate body poses; a viewer
with an omitted participant labels it “body not in this observation.”

Compact public activity strip shows demo rules, phase, both IDs/progress,
completed total and bounded recent transitions without selection. Existing
movement inspection and camera controls remain available. Stale/recovery state
marks activity last-observed/unavailable and stops cues. An initial or recovery
FULL seeds the cue watermark at its latest transition ID and renders state/history
without celebrating old transitions. Only subsequent fresh delta IDs above that
watermark may cue. Same-run in-memory watermark survives reconnect; browser
memory loss/reload adopts a fresh baseline, not a cross-reload exactly-once claim.
If transition retention misses a range, disclose the history gap instead of
inventing entries. Essential state must fit 780x493 and 1280x800 without hiding
the canvas or requiring body selection. No camera-stealing or label-placement
subproject is included.

New owner mode consumes public phase/reset/anchors and keeps only local route,
retry and typed blockage handling. It does NOT privately promote phases or
announce authoritative completion. It holds on observation gaps, follows READY
setup and phase geometry through ordinary MOVE, and STOPs in COMPLETE/SUSPENDED.
Recovery returns through READY; foreign/absent activity fails clearly.

## Finish line and falsification

One cohesive task may touch ~25–35 source/generated/test/doc paths; do not split
it into separately “done” layers with an inert scoreboard. Estimate comparable
to the delivered round4 pair (5182 inserted lines including process/test records),
not guaranteed. Defer a general activity framework and separate staging polish.
If a minimal coherent slice cannot fit, reconsider the lower-ranked proposal.

Acceptance needs targeted adversarial cases for each contract condition plus
fresh SPEC/STANDARDS CODE review, full repository gate, and three fresh >=180s
new-mode runs with >=3 server-proved completed rounds each. For EVERY completion,
record both per-phase directed/path contributions and proof ticks, prior below-to-above separation
crossing, and safe REGROUP geometry/dwell from actual world data.
Exercise disconnect/reconnect/old cleanup and slow/coalesced/resync paths across
completion; current count/phase must recover without replaying history as live
success. A NEW cold spectator must identify phase, participants and earned count
from the public page at 30/90/150s. Failure of either body's actual contribution,
recovery truth, or public comprehension blocks delivery.

## Paper liveness trace (design reasoning, not an executed runtime test)

In REGROUP, A earns its new inward proof and STOPs at t=0. B finishes its
new inward motion at t=5 seconds, before the 20-second phase timeout. Both
epochs/bodies/shapes remain present and unchanged, current directed contribution
still qualifies, and pair geometry stays in band from t=5 through t=5.4.
The earlier continuously-recent rule would refuse A's credit. The selected rule
completes after 8 dwell ticks without another A movement. STOP removed A's lease;
there is no cancelled lease to expire. Actual outstanding lease expiry still
suspends. A paused before earning the new inward proof cannot qualify.
