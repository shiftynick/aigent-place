## The Fool

### Target
Select two round 1 improvements: make the authoritative live tracer visible with stable camera controls, and repair the owner-side MOVE sample so a fresh local world shows a short, measured move and the process exits on every outcome.

### Assumptions Holding This Up
- **Existing evidence:** I read the finished, narrowed `round1-critique.md`, the approved program brief, baseline handoff and logs, viewer and sample source, server spawn/observation code, and relevant architecture/task records. I viewed the actual `typed-live-body.png`: its status reports one body but the viewport is blank. This is proposal review, not code review; I made no repository or board changes.
- **Existing evidence:** The baseline typed probe moved an authoritative body from x=75 mm to x=2475 mm at y=8905 mm. A short route to x=1500 mm is therefore a credible experiment. Fourteen accepted commands followed by stalled position do **not** establish arrival or sustained navigation.
- **Existing evidence:** The advertised sample sends an empty MOVE payload and fails; its socket remains open after failure. The viewer has a fixed origin camera. Both selected changes address demonstrated defects, rather than presumed demand for another feature.
- **Unevidenced:** The checked-out source, freshly built, will reproduce the probe's walkable short route. The baseline used an existing debug binary. Validation must close this gap before delivery.
- **Required boundary:** Sample displacement claims apply to a fresh journal with exactly one aigent. Bodies are created after the first MOVE, not at handshake. The wire does not identify an aigent's own body, so arbitrary-journal or multi-aigent attribution remains unsolved.
- **Required dependency:** Camera fitting uses observed body positions and a bounded placeholder extent. It does not require task-055 terrain transmission, six-primitive rendering, rebasing, or interpolation. A scale grid must say that it is a coordinate reference; it cannot imply collision terrain. The body must remain in the server's origin-focused viewer interest set.
- **Required dependency:** The sample must retain session/sequence/idempotency behavior while encoding the generated MOVE payload. Its runtime evidence must come from authoritative position observations, independent of its accepted-command log.

### Claim and Counter-Claim
- Claim: The pair can turn two proven failures into a repeatable end-to-end demonstration: a normal viewer URL shows an elevated real body, the documented owner-side command moves it far enough and slowly enough to watch, and the sample terminates without manual cleanup. This is the strongest claim; it is narrow and falsifiable.
- Strongest counter: This is a prettier diagnostic exercise, not a lively world. A moving cube and valid leases do not create goals or stories. Automatic fitting may conceal the world scale, and a known short route may conceal terrain navigation failure. The five-round program can spend all its time on foundations while never reaching its stated product goal.
- Synthesis (or why none holds): Proceed as a foundation repair with an honest closeout. The viewer cannot communicate real activity until it displays a body, and later owner brains need a valid, terminating sample. Do not market this round as goal-driven behavior, route finding, arrival guarantees, or emergence. The next independent critique must judge the remaining product gap; proposal 3 is not selected now.
- Disconfirming evidence / kill criteria: Run the documented path against a **freshly built server**, a fresh journal, pinned Node 22.22.2, one aigent, and real Chromium. Require at least 1000 mm of authoritative displacement spread across at least two seconds, with the body visible during that motion. Require process exit within a declared bound of no more than ten seconds on success, command rejection, and unavailable endpoint; no manual kill or lingering sample socket is acceptable. Repeat the success case with three fresh journals. Failure in any case kills the claim of a reliable demonstration until corrected; changing the world generator or adding identity/navigation APIs is a scope change, not a hidden repair. For the viewer, an elevated body near the observed y=8.905 m must be visible on first discovery; manual orbit/pan/zoom must retain control, and reset must recover the body. A separated-body scene must remain usable without camera jumps on every update. A screenshot with `bodies=1` and no visible body disproves success even if unit tests pass.

### Pre-Mortem
- [Warning] Six months later, commands still report success while the demo body is blocked -> accepted/replayed logs pass but independent positions do not change by the required amount. Avoidable: gate on displacement, not acknowledgements.
- [Warning] Camera fitting keeps overriding the spectator or puts the body outside the frustum after an update -> camera pose changes after manual input without a reset request, or browser frames lose the body. Avoidable: fit on initial discovery/reset, with an explicit policy for loss from interest.
- [Warning] The two branches pass alone but the documented combined path fails -> a fresh browser/server/sample run needs the old probe, a special URL, or manual process termination. Avoidable: perform the combined run after integration; individual gates cannot substitute for it.
- [Warning] The sample is rerun against a used journal and silently takes another spawn or starts already at its target -> zero observed displacement or a different body is credited to the sample. Avoidable: state the fresh, single-aigent demo condition and fail visibly when its measured condition is unmet. General journals remain an acceptable deferred risk only when this boundary is clear.
- [Watch] All five rounds end with a polished tracer but no reactive inhabitants -> later critiques still find no goal completions or state-dependent choices. This round may accept that product gap; the whole program may not. Do not preselect another camera/presentation round to avoid the harder activity work.

### Red Team
- [Warning] A skeptical spectator can invalidate the demo by following the ordinary instructions, seeing an empty canvas, and reading a success log. Capture the exact documented path and measure both the authoritative position and the rendered result.
- [Warning] A reviewer can game the rubric by counting renewals, counting the same replay twice as movement, or asserting a target was reached after a fixed sleep. Distinct position observations must establish progress; idempotent replay must not become a second displacement claim.
- [Warning] A demo runner can hide bad cleanup by calling process exit while leaving error paths untested. Closed-port and rejection runs must finish under the same time bound, with owned socket cleanup verified.
- [Watch] A spectator can orbit beyond the server's origin-focused interest and reasonably expect new bodies to appear. Free camera is currently a local viewing control, not a remote interest update. Do not claim unlimited follow or world navigation from this camera task.
- [Watch] Stable colors and a reference grid can make placeholder geometry look authoritative. Keep the reference and placeholder limits clear; do not present a fictitious floor as the surface that constrained movement.

### Blind Spots
- The hard part of the sample is the truth of its success report, not encoding one protobuf message. A valid MOVE result is admission, not proof that the body arrived.
- The demo's fixed nearby target is justified by one measured initial spawn, not by terrain connectivity. Do not extend that evidence to a reactive cast or general exploration.
- Fresh-world attribution is a validation convenience, not an owner-body binding contract. The broader cast still needs authoritative self identity after durable spawn/reconnect, walkability or bounded navigation, and readable facts about goals/outcomes.
- The round improves world activity through the owner-client path; it does not yet improve simulation behavior. Equal viewer/world attention is credible here only if the motion outcome receives the same strict runtime proof as the camera.
- Broader task-055 and recovery work remains on the existing board. Pulling any of it into these two scopes would destroy the fresh-context bounds and postpone the first visible result.

### Verdict
`Proceed`

Proceed with the two narrowed scopes and the runtime criteria above. Defer the sustained reactive cast. The earlier combined cast/terrain proposal was too dependent and too broad for this round; the finished proposal resolves that problem.

### Highest-Leverage Next Step
- Select the viewer visibility task first because it makes later motion evidence inspectable. The viewer and sample workers may implement in parallel in separate task branches, but validate the pair together. Freeze scope A to initial/reset framing, bounded camera navigation, stable body distinction, a labelled reference, and useful viewport states. Freeze scope B to typed MOVE, preserved idempotent replay, visibly sustained short motion in the declared fresh single-aigent world, truthful outcome evidence, bounded duration, and socket cleanup. Use the fresh rebuilt end-to-end run as the selection's proof; do not add terrain, self-binding wire changes, server-hosted brains, or a cast to rescue a failing rubric.
