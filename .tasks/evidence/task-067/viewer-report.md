# Task 067 viewer patch evidence

## Observed implementation

The read-only viewer presents local `Body <ID>` labels, a compact body list,
selection, follow and a selected movement-target inspector before collapsed
protocol diagnostics. It draws each server-provided physical aim as a colored
line and target ring projected at the body's observed height. The legend
states that projection; the grid and cubes remain placeholders.

Trails contain up to 64 authoritative position samples. Unchanged/aim-only
records and movements under 2 mm do not add samples; smoothed render frames never
add history. Graphics buffers/materials are reused and disposed on departure,
reconnect or shutdown. Fully validated AOI replacements release departures
before allocating arrivals, retaining at most 100 body graphics even transiently.

Selection uses the exact numeric ID string, including IDs beyond JavaScript's
safe integer range. Follow survives full/resync for an observed ID, pauses
while the observation is stale, and ends on explicit departure, manual camera
input or Reset. Reset still frames current bodies. Reconnect clears the old
observation. The inspector says `No active movement aim` for absence; it makes
no arrival, block, sleep, motivation or expiry claim. An optional target-to-peer
horizontal distance is derived solely from the installed records.

The decoder validates optional aim signed integer coordinate bounds and
positive uint32 speed before applying an entire transition. Invalid aims
request the existing read-only full resync without partial graphics/UI changes.
An understood present-zero optional self-body ID is also rejected in both full
and delta payloads; absence and nonzero generic aigent fixtures remain accepted.
The viewer does not use that private identity field. Old fixtures and legal
unknown fields remain supported. The full-snapshot
clock diagnostic now explicitly identifies its tick as a baseline tick.

Initial and Reset framing now use a 60-degree fitted camera elevation. This
exposes close horizontal separation without changing world positions, the
extent fit or manual navigation. A real Three regression uses two disjoint
one-metre cubes 1.56 m apart along the horizontal viewing diagonal: the old
view hides the farther body's center, while the new view exposes it and
keeps all observed bounds visible at five narrow/wide aspect ratios.

## Executed checks

All commands were recorded through the task tracker in the assigned viewer
worktree, with Node 22.22.2. No dependencies were added.

- `npm ci` — exit 0.
- Baseline `npm run test:real-snapshot -w @aigent-place/viewer` — 61/61 passed.
- Final same focused suite — 76/76 passed; all new tests join its existing files.
- 23 compiling behavior-removal mutants — syntax check exit 0 for each, focused
  behavioral test exit 1 for each, then source restored. Cases cover aim-only
  update/removal, authoritative trail sampling/cap/jitter, exact ID selection,
  follow movement/resync/leave/manual/reset, stale disconnect, graphics release,
  aim validation/atomicity, final/transient 100-body limits, physical peer
  proximity, baseline-clock wording and both present-zero self-ID guards. The
  boundary fix first reproduced three failing zero-field tests against the
  delivered decoder, then passed them after adding the two guards; each guard
  removal compiled and restored the behavioral failure before exact restoration.
  The camera follow-up first reproduced the hidden far-center regression on the
  existing shallow fit, then passed it with the steeper fit. Restoring only the
  old elevation compiled and reproduced that failure before exact restoration.
- `npm run viewer:build` — exit 0; CSS and JavaScript assets emitted.
- `npm run viewer:smoke` — exit 0.
- `git diff --check` — exit 0.

## Reported prerequisites and limits

Generated `MoveAim` and optional snapshot fields came from the separate
protocol worker and were copied only as test/build prerequisites. They are
excluded from this viewer patch. ADR0011, contracts and repository documentation
are owned by the orchestrator.

Real Chromium desktop/mobile rendering, the live two-brain scene, cold
spectator comprehension, separate cold reviews and the unified repository gate
remain orchestrator acceptance work. This patch report does not claim those
signals passed. Pointer picking is not implemented; the body list is the
selection path. No existing browser, world server or journal was operated.
