# HANDOFF — Aigent Place, 2026-10-08

The operator confirmed a five-round improvement program after a six-decision
interview. Improve the viewer and world activity equally. Aim for lively,
goal-driven aigents and emergent stories; demo brains are sufficient and the
owner-run brain integration must remain available. The orchestrator selects
all proposals, including product/architecture changes, after independent
adversarial review. Each round selects one or two strong improvements and
finishes implementation, cold review, runtime validation and protected PR
delivery before a new critique.

## Current delivery state

PR #69 was fixed and squash-merged into main as
`4e3e070fd2e6eb990a44f9a01390855cd1ac0816`; its source branch was deleted.
The accidental local main merge was preserved outside the repository and
removed. The final source tree and required remote gate were verified.

Round 1 is `task-064`, restoring a visible bounded live movement demo. Two
isolated workers handle the Node sample and camera visibility; a third fixes
the admission-clock defect found during validation. The root owns
integration and delivery. Consult that card for current implementation,
review, gate and PR status. After it is delivered, run a fresh critique for
round 2. Do not preselect the remaining four rounds. The accepted front and
proposal records are linked in `PLANNING-JOURNAL.md`.

The live baseline proved that the documented Node sample sent an invalid
empty MOVE and stayed alive after failure. A typed external probe moved a
real body, but Chromium showed an empty viewport even with bodies=1 because
of the fixed framing. Round 1 requires a rebuilt server, fresh journal, one
aigent, at least 1 m observed displacement over at least 2 seconds, actual
browser visibility, and bounded clean exits. This is a tracer, not emergence.

## Product facts and remaining work

The live path carries real shapes, position records and explicit full/delta
transitions. Server movement consumes typed MOVE leases; STOP/CANCEL have
real effects. The current viewer rendering and demo are task-064's scope.
Six-primitive rendering, authoritative terrain transport, origin rebasing and
full interpolation acceptance remain `task-055`. Sleep/wake/restore/unstick
is `task-052`; atomic set_shape is `task-053`. Those cards are unfinished.
Snapshots still lack terrain, general self-body binding and activity goals.

The cadence audit and retrospective ran before this program. Their findings,
existing-card mapping and follow-ups (`task-065`, `task-066`) are recorded in
the planning journal. `task-066` is a deferred operator decision about process
wording; it is not a prerequisite for app improvements.

## Restart commands and safeguards

Use Node from `.nvmrc` and Rust from `rust-toolchain.toml`:

```sh
node .agents/skills/task-tracker/scripts/task.mjs board
node .agents/skills/task-tracker/scripts/task.mjs show task-064
node scripts/check.mjs
```

Use an up-to-date `origin/main` for task branches. Keep one board task per PR;
run the lifecycle and separate cold SPEC/STANDARDS reviews. Configure
`core.hooksPath=.githooks`. Squash-merge only after required remote checks are
verified green on the current head; do not bypass hooks or protections.
Never commit to main or rewrite shared history.

Local evidence and private recovery are outside the repository under
`~/.local/state/aigent-place/`. No deployment or live-model connection is
needed for this program. Runtime tests use disposable local journals; stop
only processes created by the test.
