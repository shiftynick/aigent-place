---
id: task-064
title: Restore a visible bounded live movement demonstration
status: in_progress
priority: p1
tags: [milestone:five-round-live-demo, area:product, phase:audit]
blockedBy: []
createdAt: "2026-10-08T14:07:36Z"
updatedAt: "2026-10-08T14:34:01Z"
claimedBy: round1-orchestrator
claimedAt: "2026-10-08T14:08:05Z"
---

<!-- task-tracker:description -->
## Description

Round 1 selected after fresh live critique and independent proposal challenge under the operator-confirmed five-round program. Repair the actual documented Node MOVE demo with generated typed payloads, authoritative displacement observation, preserved idempotent replay, bounded duration and socket cleanup on all outcomes. Frame observed bodies in the spectator with orbit/zoom/reset and a clearly labelled scale reference, including elevated first bodies and useful connection/empty states. This is a local one-aigent tracer, not a reactive cast or completion of task-055. Acceptance: against a fresh rebuilt listening server and fresh journal, the documented command produces at least one metre of observed displacement spread over at least two seconds, visible in real Chromium; success and rejection/closed-port paths exit cleanly within ten seconds; spectators can navigate and reset framing without camera jumps on every delta; focused behavioral checks and the full gate pass.

<!-- task-tracker:log -->
## Log

- 2026-10-08T14:07:36Z — created (status: backlog)
- 2026-10-08T14:08:05Z — note: rubric: (1) The actual documented Node entry uses generated typed MOVE, preserves accepted/replayed outcomes, measures at least 1m authoritative displacement over at least 2s in a fresh single-aigent demo, and exits successfully within 10s. (2) Rejection, timeout and closed-port paths fail clearly, release the socket/listeners, and exit within 10s without manual termination. (3) Real Chromium shows elevated and separated bodies; orbit/zoom/reset work, a scale reference is labelled, and ordinary deltas do not override manual framing. Empty and disconnected states are useful. (4) Spectators remain read-only; no terrain/self-binding/shape-completion/emergence claim. Behavioral mutation reds, focused checks, full gate, separate cold SPEC/STANDARDS and exact runtime evidence complete the packet.
- 2026-10-08T14:08:05Z — moved to in_progress (claimed by round1-orchestrator)
- 2026-10-08T14:11:01Z — note: viewer interface outline before bodies: camera.js exports observedBounds(positions: Iterable<{x,y,z}>): THREE.Box3|null and fitObservedBounds(camera: PerspectiveCamera, controls: {target: Vector3, update(): void}, bounds: Box3): void; main startLiveViewer returns {resetView(): void, dispose(): void}. First non-empty trusted snapshot frames placeholder cube bounds; full/delta updates keep a manual view; reset and resize of the last automatic fit reframe. OrbitControls owns local orbit/pan/zoom only. GridHelper is an explicitly labelled 1m reference grid, not terrain. State text distinguishes connecting, waiting, empty, live and disconnected stale display. Least-confident choices: first-body view distance/movement margin (bounded 1m tracer), resize policy after manual input (preserve manual target), and fixed 20m grid span at fitted center. No wire/server/SDK changes or shape-completion claims.
- 2026-10-08T14:14:40Z — run: npm run test:real-snapshot -w @aigent-place/viewer
  started 2026-10-08T14:14:39Z, exit 0 in 1.3s
  output tail (truncated to last 30 lines):
  |   duration_ms: 0.353142
  |   type: 'test'
  |   ...
  | # Subtest: legal unknown protobuf groups and nested groups remain preserved
  | ok 56 - legal unknown protobuf groups and nested groups remain preserved
  |   ---
  |   duration_ms: 0.307555
  |   type: 'test'
  |   ...
  | # Subtest: malformed unknown groups reject oversized varints and invalid boundaries
  | ok 57 - malformed unknown groups reject oversized varints and invalid boundaries
  |   ---
  |   duration_ms: 1.139157
  |   type: 'test'
  |   ...
  | # Subtest: unknown protobuf groups retain a bounded nesting depth
  | ok 58 - unknown protobuf groups retain a bounded nesting depth
  |   ---
  |   duration_ms: 0.847313
  |   type: 'test'
  |   ...
  | 1..58
  | # tests 58
  | # suites 0
  | # pass 58
  | # fail 0
  | # cancelled 0
  | # skipped 0
  | # todo 0
  | # duration_ms 1149.208285
- 2026-10-08T14:15:57Z — run: npm run test:real-snapshot -w @aigent-place/viewer
  started 2026-10-08T14:15:56Z, exit 1 in 1.0s
  output tail (truncated to last 30 lines):
  |   type: 'test'
  |   ...
  | # Subtest: malformed unknown groups reject oversized varints and invalid boundaries
  | ok 60 - malformed unknown groups reject oversized varints and invalid boundaries
  |   ---
  |   duration_ms: 0.436674
  |   type: 'test'
  |   ...
  | # Subtest: unknown protobuf groups retain a bounded nesting depth
  | ok 61 - unknown protobuf groups retain a bounded nesting depth
  |   ---
  |   duration_ms: 0.555767
  |   type: 'test'
  |   ...
  | 1..61
  | # tests 61
  | # suites 0
  | # pass 60
  | # fail 1
  | # cancelled 0
  | # skipped 0
  | # todo 0
  | # duration_ms 845.74644
  | npm error Lifecycle script `test:real-snapshot` failed with error:
  | npm error code 1
  | npm error path /home/shifty/Work/aigent-place-task064-viewer/apps/viewer
  | npm error workspace @aigent-place/viewer@0.1.0
  | npm error location /home/shifty/Work/aigent-place-task064-viewer/apps/viewer
  | npm error command failed
  | npm error command sh -c node --test ./test/real-snapshot.test.mjs ./test/live-viewer.test.mjs ./test/camera.test.mjs
- 2026-10-08T14:16:13Z — run: npm run test:real-snapshot -w @aigent-place/viewer
  started 2026-10-08T14:16:11Z, exit 0 in 1.4s
  output tail (truncated to last 30 lines):
  |   duration_ms: 0.389151
  |   type: 'test'
  |   ...
  | # Subtest: legal unknown protobuf groups and nested groups remain preserved
  | ok 59 - legal unknown protobuf groups and nested groups remain preserved
  |   ---
  |   duration_ms: 0.292538
  |   type: 'test'
  |   ...
  | # Subtest: malformed unknown groups reject oversized varints and invalid boundaries
  | ok 60 - malformed unknown groups reject oversized varints and invalid boundaries
  |   ---
  |   duration_ms: 1.582176
  |   type: 'test'
  |   ...
  | # Subtest: unknown protobuf groups retain a bounded nesting depth
  | ok 61 - unknown protobuf groups retain a bounded nesting depth
  |   ---
  |   duration_ms: 1.098939
  |   type: 'test'
  |   ...
  | 1..61
  | # tests 61
  | # suites 0
  | # pass 61
  | # fail 0
  | # cancelled 0
  | # skipped 0
  | # todo 0
  | # duration_ms 1238.290831
- 2026-10-08T14:16:43Z — run: npm run viewer:build
  started 2026-10-08T14:16:41Z, exit 0 in 2.0s
  output:
  |
  | > aigent-place@0.1.0 viewer:build
  | > npm run build -w @aigent-place/viewer
  |
  |
  | > @aigent-place/viewer@0.1.0 build
  | > vite build
  |
  | vite v7.3.6 building client environment for production...
  | transforming...
  | ✓ 75 modules transformed.
  | rendering chunks...
  | computing gzip size...
  | dist/index.html                   1.08 kB │ gzip:   0.58 kB
  | dist/assets/index-YVzYYDZH.css    0.99 kB │ gzip:   0.55 kB
  | dist/assets/index-DpdjR3C4.js   594.35 kB │ gzip: 153.55 kB │ map: 3,135.95 kB
  | ✓ built in 1.48s
  |
  | (!) Some chunks are larger than 500 kB after minification. Consider:
  | - Using dynamic import() to code-split the application
  | - Use build.rollupOptions.output.manualChunks to improve chunking: https://rollupjs.org/configuration-options/#output-manualchunks
  | - Adjust chunk size limit for this warning via build.chunkSizeWarningLimit.
- 2026-10-08T14:17:59Z — run: npm run viewer:smoke
  started 2026-10-08T14:17:59Z, exit 0 in 0.3s
  output:
  |
  | > aigent-place@0.1.0 viewer:smoke
  | > npm run smoke -w @aigent-place/viewer
  |
  |
  | > @aigent-place/viewer@0.1.0 smoke
  | > node ./scripts/smoke.mjs
  |
  | viewer: smoke ok
- 2026-10-08T14:25:21Z — run: python3 /home/shifty/.local/state/aigent-place/improvement-loop-2026-10-08/round1-viewer/viewer-mutations.py
  started 2026-10-08T14:25:19Z, exit 0 in 2.3s
  output:
  | RED compiled/running behavior: initial-fit exit 1
  | RED compiled/running behavior: delta-jump exit 1
  | RED compiled/running behavior: narrow-resize exit 1
  | RED compiled/running behavior: manual-resize-jump exit 1
  | RED compiled/running behavior: reset-button exit 1
  | RED compiled/running behavior: empty-state exit 1
  | RED compiled/running behavior: stale-state exit 1
  | RED compiled/running behavior: timer-cleanup exit 1
  | RED compiled/running behavior: placeholder-bounds exit 1
  | RED compiled/running behavior: fixed-fit-distance exit 1
  | RED compiled/running behavior: constant-color exit 1
  | PASS 11 behavioral mutations rejected; original sources restored
- 2026-10-08T14:27:08Z — run: python3 /home/shifty/.local/state/aigent-place/improvement-loop-2026-10-08/round1-viewer/browser-mutations.py
  started 2026-10-08T14:26:25Z, exit 0 in 42.0s
  output:
  | RED actual Three/Chromium: orbit disabled; exit 1
  | RED actual Three/Chromium: pan disabled; exit 1
  | RED actual Three/Chromium: zoom disabled; exit 1
  | PASS real-render oracle rejected disabled orbit/pan/zoom; original source restored
- 2026-10-08T14:28:38Z — note: viewer choices: camera bounds track the existing one-metre placeholders, not decoded 1.8m body shape geometry; 3m minimum radius leaves room for the bounded tracer. Initial discovery/reset repositions the reference grid at the fitted lower bound; its fixed 20m span and 1m squares are labelled as a reference, not terrain. Normal deltas and post-input resizes preserve manual framing. Stable IDs hash to a finite 12-color palette; global unique colors are not claimed. OrbitControls uses immediate input without damping so reset has no retained orbit/pan momentum. Added bodyColor(entityId: bigint|string): Color to the camera helper. No wire/API/persistence decision beyond viewer-local presentation.
- 2026-10-08T14:29:01Z — note: viewer warm self-pass on frozen apps/viewer diff: read every source/test/markup/style change against rubric 3-4 and REVIEW-STANDARDS/ENGINEERING-STANDARDS. Fixed late-error callback after dispose and removed disposed meshes/grid from scene ownership. Strict generated wire guard tests remain in the same actual-main suite. No dependencies, server/protocol/SDK edits, terrain or task-055 completion. Root owns full gate and cold axes. Documentation: visible controls/scale/help text updated in viewer; root owns README update outside delegated scope. Runtime friction: npm root-script forwarding dropped custom Vite port; used established workspace dev command with explicit -- separator. Browser Use cdp requires keyword params, and wheel CDP acknowledgments sometimes time out; actual image difference verifies zoom rather than treating event delivery as proof.
- 2026-10-08T14:29:02Z — run: npm run test:real-snapshot -w @aigent-place/viewer
  started 2026-10-08T14:29:01Z, exit 0 in 1.2s
  output tail (truncated to last 30 lines):
  |   duration_ms: 0.3897
  |   type: 'test'
  |   ...
  | # Subtest: legal unknown protobuf groups and nested groups remain preserved
  | ok 59 - legal unknown protobuf groups and nested groups remain preserved
  |   ---
  |   duration_ms: 0.321368
  |   type: 'test'
  |   ...
  | # Subtest: malformed unknown groups reject oversized varints and invalid boundaries
  | ok 60 - malformed unknown groups reject oversized varints and invalid boundaries
  |   ---
  |   duration_ms: 0.753744
  |   type: 'test'
  |   ...
  | # Subtest: unknown protobuf groups retain a bounded nesting depth
  | ok 61 - unknown protobuf groups retain a bounded nesting depth
  |   ---
  |   duration_ms: 0.605112
  |   type: 'test'
  |   ...
  | 1..61
  | # tests 61
  | # suites 0
  | # pass 61
  | # fail 0
  | # cancelled 0
  | # skipped 0
  | # todo 0
  | # duration_ms 985.737541
- 2026-10-08T14:29:02Z — run: npm run viewer:build
  started 2026-10-08T14:29:01Z, exit 0 in 1.8s
  output:
  |
  | > aigent-place@0.1.0 viewer:build
  | > npm run build -w @aigent-place/viewer
  |
  |
  | > @aigent-place/viewer@0.1.0 build
  | > vite build
  |
  | vite v7.3.6 building client environment for production...
  | transforming...
  | ✓ 75 modules transformed.
  | rendering chunks...
  | computing gzip size...
  | dist/index.html                   1.08 kB │ gzip:   0.58 kB
  | dist/assets/index-YVzYYDZH.css    0.99 kB │ gzip:   0.55 kB
  | dist/assets/index-B6IhkfwV.js   594.39 kB │ gzip: 153.56 kB │ map: 3,136.21 kB
  | ✓ built in 1.32s
  |
  | (!) Some chunks are larger than 500 kB after minification. Consider:
  | - Using dynamic import() to code-split the application
  | - Use build.rollupOptions.output.manualChunks to improve chunking: https://rollupjs.org/configuration-options/#output-manualchunks
  | - Adjust chunk size limit for this warning via build.chunkSizeWarningLimit.
- 2026-10-08T14:30:02Z — run: python3 /home/shifty/.local/state/aigent-place/improvement-loop-2026-10-08/round1-viewer/viewer-mutations.py
  started 2026-10-08T14:29:59Z, exit 0 in 2.8s
  output:
  | RED compiled/running behavior: initial-fit exit 1
  | RED compiled/running behavior: delta-jump exit 1
  | RED compiled/running behavior: narrow-resize exit 1
  | RED compiled/running behavior: manual-resize-jump exit 1
  | RED compiled/running behavior: reset-button exit 1
  | RED compiled/running behavior: empty-state exit 1
  | RED compiled/running behavior: stale-state exit 1
  | RED compiled/running behavior: timer-cleanup exit 1
  | RED compiled/running behavior: late-error exit 1
  | RED compiled/running behavior: scene-release exit 1
  | RED compiled/running behavior: placeholder-bounds exit 1
  | RED compiled/running behavior: fixed-fit-distance exit 1
  | RED compiled/running behavior: constant-color exit 1
  | PASS 13 behavioral mutations rejected; original sources restored
- 2026-10-08T14:30:35Z — run: npm run test:real-snapshot -w @aigent-place/viewer
  started 2026-10-08T14:30:34Z, exit 0 in 1.0s
  output tail (truncated to last 30 lines):
  |   duration_ms: 0.206893
  |   type: 'test'
  |   ...
  | # Subtest: legal unknown protobuf groups and nested groups remain preserved
  | ok 59 - legal unknown protobuf groups and nested groups remain preserved
  |   ---
  |   duration_ms: 0.148167
  |   type: 'test'
  |   ...
  | # Subtest: malformed unknown groups reject oversized varints and invalid boundaries
  | ok 60 - malformed unknown groups reject oversized varints and invalid boundaries
  |   ---
  |   duration_ms: 0.810784
  |   type: 'test'
  |   ...
  | # Subtest: unknown protobuf groups retain a bounded nesting depth
  | ok 61 - unknown protobuf groups retain a bounded nesting depth
  |   ---
  |   duration_ms: 0.414869
  |   type: 'test'
  |   ...
  | 1..61
  | # tests 61
  | # suites 0
  | # pass 61
  | # fail 0
  | # cancelled 0
  | # skipped 0
  | # todo 0
  | # duration_ms 829.841162
- 2026-10-08T14:30:56Z — run: npm run viewer:smoke
  started 2026-10-08T14:30:56Z, exit 0 in 0.3s
  output:
  |
  | > aigent-place@0.1.0 viewer:smoke
  | > npm run smoke -w @aigent-place/viewer
  |
  |
  | > @aigent-place/viewer@0.1.0 smoke
  | > node ./scripts/smoke.mjs
  |
  | viewer: smoke ok
- 2026-10-08T14:31:22Z — run: sh /home/shifty/.local/state/aigent-place/improvement-loop-2026-10-08/round1-viewer/browser-controls.sh
  started 2026-10-08T14:30:56Z, exit 0 in 25.2s
  output:
  | CDP wheel response timed out; checking the actual rendered effect
  | /home/shifty/.local/state/aigent-place/improvement-loop-2026-10-08/round1-viewer/narrow-full.png
  | PASS actual Three/Chromium: orbit, pan, zoom, manual framing across deltas, reset, narrow resize
  | {'status': 'viewer: delta baseline tick=15353 bodies=2 (real bodies, +0/~0/-0)', 'stateHidden': True, 'resetDisabled': False}
- 2026-10-08T14:31:51Z — run: sh /home/shifty/.local/state/aigent-place/improvement-loop-2026-10-08/round1-viewer/browser-disconnected.sh
  started 2026-10-08T14:31:51Z, exit 0 in 0.3s
  output:
  | {'status': 'viewer: socket closed — reconnecting', 'text': 'Disconnected. Any visible bodies are the last observation. Retrying in 1 second.', 'hidden': False}
  | /home/shifty/.local/state/aigent-place/improvement-loop-2026-10-08/round1-viewer/disconnected.png
  | PASS real Chromium reports stopped server/retry state
- 2026-10-08T14:34:01Z — note: viewer observed evidence: real Chromium isolated CDP19223/BU_NAME task064-viewer against loopback Vite15184 and world-server17611 with fresh private viewer.sqlite. Server encoder emitted entity1 (0,8905,0)mm and entity2 (2000,8905,0)mm after typed MOVE/STOP fixture clients; observed-bodies.png shows both, narrow-full.png shows both at 360px. browser-controls.sh command asserts actual rendered pixel change for orbit/pan/zoom, stable manual frame across deltas, reset restoring fitted viewport and narrow resize; exit0 recorded. Chromium stopped-server evidence showed Disconnected / last observation / retry state, exit0 recorded. 13 compiled/running logic mutation reds and 3 real-Chromium disable-controls mutation reds recorded; restored final source suite61/61/build/smoke pass. Full product gate + cold SPEC/STANDARDS + fresh rebuilt single-aigent moving-demo finish line remain root-owned. Limitation: this viewer-specific runtime reused existing target/debug server executable, so it is not fresh-rebuild movement acceptance. Wheel CDP response timeout is explicit despite proven rendered effect. Cleanup stopped own clients/server/Vite/Chromium and own BU_NAME daemon; ports17611/15184/19223 verified free. No commit, push, claim or status move by viewer worker.
