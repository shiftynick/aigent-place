# Automatic spectator framing contract

Round 4 pairs task-069's wider physical journeys with task-070's spectator
framing. Task-069 is delivered through protected PR #74: squash
`77cf0598cd82050b926e1a20c7955cdd9e76318c`, reviewed tree
`10303a1952fbaf5f717825f88f3fc3f40ae7c09a`, sole parent
`c06dd7a87f81aac9412131b4a85d0c3998369572`. Its required PR check passed;
the exact main push check also passed on 2026-10-10 at 00:21:48 UTC. The
source branch is deleted. Recovery archives preserve its local task commit
and worker changes; root verified them before removing owned worktrees.

Independent design review R1 requested revision. R2 re-derived the fixed
camera math, checked the control and geometry seams, and approved proceeding
with four pre-claim bindings. All four are adopted below. These are design
decisions, not implementation, code-review or runtime acceptance. The full
private reports retain findings, corrections and their evidence limits.

## Signatures selected before implementation

Use existing Three.js types and JavaScript/JSDoc. Helpers return clones,
never mutate arguments, and do not access cameras, controls, clocks, DOM,
sockets or I/O. Keep corner/depth/validation helpers private.

```text
FitGoal = { target: Vector3, distance: number, radius: number }
FitState = { target: Vector3, distance: number }
Projection = { fovDeg: number, aspect: number }
GrowthTuning = { paddingMetres: number, minimumGrowthMetres: number }
CameraTuning = { timeConstantSeconds: number, maxStepSeconds: number,
                 margin: number, minDistance: number,
                 nearMinimum: number, depthFloor: number }
AutomaticFrame = { state: FitState, near: number, far: number }

admitObservedBounds(history: Box3|null, envelope: Box3|null,
                    appliedBounds: Box3|null, tuning: GrowthTuning):
    { history: Box3|null, envelope: Box3|null, admitted: boolean }
planObservedFit(projection: Projection, envelope: Box3): FitGoal
minimumContainingDistance(projection: Projection, target: Vector3,
                          displayedBoxes: readonly Box3[],
                          tuning: {margin:number, depthFloor:number,
                                   minDistance:number}): number
stepAutomaticFit(input: {
    state: FitState|null, goal: FitGoal, projection: Projection,
    displayedBoxes: readonly Box3[], elapsedSeconds: number,
    snap: boolean, ease: boolean, tuning: CameraTuning
}): AutomaticFrame
```

Keep the existing `observedBounds`, `fitObservedBounds` and `bodyColor`
interfaces compatible. The live viewer uses the new pure helpers and owns
one automatic pose-write site in its render loop. No new dependency or
general camera framework is needed.

## Geometry and numerical bounds

Main supplies only fully validated, applied composed shape bounds to H,
the geometry history. Explicitly skip `record.shape === undefined`: the
existing absent-shape plan has a nonempty zero box. Aim markers, trails,
grid and labels never supply framing geometry. Continue growing H during
manual/follow mode. Departures do not shrink it. A new socket clears
history; same-session resync retains it. Reset reseeds from current shaped
records rather than keeping past departures.

Pad H once to form a candidate. Compare its outward faces to the admitted
envelope E, admitting when any face grows by at least the threshold. Union
admitted candidates with E; never pad E again. Small updates accumulate
against E. Require padding >= positive growth threshold so an unapplied
camera admission cannot leave newly applied geometry outside E.

The goal uses E's center and bounding-sphere radius R >= 3 m. Its distance
is `1.15 * R / sin(min(verticalHalf, horizontalHalf))`. Automatic direction
is `d = normalize(1,sqrt(6),1)`, with Y-up, centered perspective and zoom 1.
Let camera-right r and camera-up u be the corresponding lookAt basis. For
each corner q of each composed shape box at its actual interpolated root,
write v = q - c. Minimum containing distance is the maximum of minDistance
and all:

```text
v.dot(d) + max(depthFloor,
    abs(v.dot(r)) / (margin * tan(horizontalHalf)),
    abs(v.dot(u)) / (margin * tan(verticalHalf)))
```

The display guard changes eased distance state only, never goal or H/E.
Finite displayed replacement boxes may exceed canonical +/-100 km while a
root lags behind a valid applied replacement. Do not apply a second world
cap to presentation bounds or loosen the existing applied validators.

All nonnull inputs and computed results must be finite and valid. Reject
malformed boxes, invalid projection/tuning/dt or unrepresentable results
with RangeError before returning a partial result. Empty display input
returns minDistance from the minimum helper. With an existing goal but no
displayed boxes, return a finite conservative fallback plane pair; with no
goal, retain the previous/startup pose. Main commits complete helper results
together. An unexpected numerical error must retain the last finite pose,
report framing failure, and avoid installing partial history or consuming a
pending snap. It does not imply containment for invalid data.

Clip planes use actual displayed depths about the returned target/distance.
Near must be positive, >= nearMinimum, and < minimum displayed depth;
far must exceed maximum displayed depth and near. A half-depth near cap
and padded far are suitable, with lower-floor/rounding checks. Do not copy
the old unconditional `distance/10000` near rule: a nearly axial body can
be clipped by it. Real matrices must test floating-point boundaries.

Initial candidate tuning is padding 1 m, growth .25 m, tau .25 s, maximum
step .1 s, margin .95, minDistance .5 m, nearMinimum .01 m and depthFloor
.02 m. Keep these in one tuning object. Require depthFloor >= 2*nearMinimum.
The settled goal must contain display geometry within E without activating
the guard, at all four test aspects. These values are unvalidated runtime
choices until the live trial; no visual quality claim follows from algebra.

## Timing and authority

Use one elapsed-time alpha `-expm1(-min(dt,maxStep)/tau)` for target and
distance. Snap requests and null state seed from a valid goal, not from an
arbitrary manual/follow camera. Stale pauses ordinary goal easing but keeps
the automatic displayed guard. Reset the elapsed clock on snap and
stale/resume so a stale interval cannot be integrated.

Handlers update history, goals, modes and snap requests. Render interpolates
body roots, uses current aspect, applies existing follow translation, and
calls `controls.update()` before the automatic write. Then, only when
automatic and not following, install the guarded state: copy c to
`controls.target`, write `camera.position = c + D*d`, lookAt c, and update
planes/projection/matrices before labels/render. Never update controls after
this final automatic write. This keeps the orbit pivot equal to the eased
target for manual takeover.

Manual input before the first shaped observation suppresses that first fit.
Manual mode survives reconnect/history reset. Follow/manual resize never
receives an automatic pose. Automatic resize replans and snaps on the next
rendered frame through the same guard; smooth resize is outside this task.
Manual takeover preserves the current pose/pivot. Follow engagement retains
its existing intentional translation `selectedCenter - currentPivot` and
relative offset/orientation; it adds no jump from a stale pivot.

Reset enables automatic mode and clears follow before checking shaped
bounds, including an empty/shapeless observation. A later first shape can
then fit. Explicit Reset's snap is not freshness-gated: it fits last applied
shapes while subsequent easing waits for freshness. Shapeless-only views
do not frame identity points, labels or aims; keep their status truthful.

## Checkable acceptance and limits

Independent real-Three corner and actual mesh-vertex NDC x/y/z tests use
16:9, 4:3, .5 and .25 aspects. Cover near/far, behind-camera points, render
lag/replacements, coupled easing, projection changes, settled goals,
invalid inputs and state-only guard write-back. Exercise real installed
OrbitControls for ordering and takeover; the existing fake only calls
lookAt and cannot prove those seams. Test small-growth accumulation,
first-discovery/manual reconnect, stale/resume, shapeless and stale Reset,
manual/follow resize, and aim exclusion. Compiling behavioral mutants must
fail assertions and restore exact sources.

A fresh >=190 s multi-identity plaza/wide trial, physical observation joins,
real browser and clean cold spectator must assess default/select/follow/
Reset/narrow/stale/reconnect behavior and whether the wider journeys are
worth watching. Counts alone cannot establish interest or private motives.
Separate fresh SPEC/STANDARDS, final unified gate, normal task commit and
protected PR delivery remain required.

The coupled easing convexity claim applies to fixed geometry/orientation/
aspect and conservative planes. It does not cover new endpoint geometry or
resize; the per-frame guard supplies containment there. A controlled
fixed-goal/decaying-outlier test checks recovery and no history/goal leak;
there is no general monotone distance/no-chatter proof for moving bodies.
Existing body interpolation remains frame-dependent. Far outliers persist
in H/E until Reset. Frustum containment does not remove occlusion or ensure
large screen size. Shapeless-only populations retain their previous/startup
pose and can have off-screen labels. Float32, far-world rebasing and terrain
remain task-055 limits. Keyboard OrbitControls is currently inactive; future
enablement must acquire manual authority because its input emits no start
event. No server, protocol, SDK, governance, credential or deployment change
belongs to this task.
