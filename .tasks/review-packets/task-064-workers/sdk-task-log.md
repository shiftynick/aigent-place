---
id: task-064
title: Restore a visible bounded live movement demonstration
status: in_progress
priority: p1
tags: [milestone:five-round-live-demo, area:product, phase:audit]
blockedBy: []
createdAt: "2026-10-08T14:07:36Z"
updatedAt: "2026-10-08T14:25:06Z"
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
- 2026-10-08T14:10:46Z — note: SDK interface outline before bodies: internal encodeMove(hello: generated ServerHello, messageId: bigint, sequence: bigint, idempotencyKey: string): Uint8Array encodes generated MovePayload(targetX=1500mm,targetZ=0,speed=500mm/s); main(): Promise<void> owns one native WebSocket with one bounded 8s deadline and listener cleanup. A single message dispatcher handles handshake, correlated accepted/replay/renew outcomes, and full/delta generated snapshot records. observeBodies(records: generated RealEntityRecord[], full: boolean): void follows the sole fresh-demo body and measures horizontal displacement from its first authoritative pose, with movement samples spanning >=2s before success. No exported SDK API or protocol changes. Least-confident choices: fixed target is valid only for the fresh default-terrain first spawn; ownership is a documented one-aigent condition, not a general identity binding; native WebSocket has no terminate, so CLI closure gets a short grace period then explicit exit to bound an uncooperative peer. Tests execute the actual Node entry against a dependency-free loopback WebSocket fixture and check close frames, typed commands, replay correlation, and motion/failure output.
- 2026-10-08T14:15:32Z — run: npm run test -w @aigent-place/aigent-sdk
  started 2026-10-08T14:15:12Z, exit 1 in 19.5s
  output tail (truncated to last 30 lines):
  |   type: 'test'
  |   ...
  | # Subtest: actual entry fails promptly on a closed port
  | ok 6 - actual entry fails promptly on a closed port
  |   ---
  |   duration_ms: 393.832629
  |   type: 'test'
  |   ...
  | # Subtest: SDK re-exports EnvelopeSchema usable for encode/decode
  | ok 7 - SDK re-exports EnvelopeSchema usable for encode/decode
  |   ---
  |   duration_ms: 1.971726
  |   type: 'test'
  |   ...
  | 1..7
  | # tests 7
  | # suites 0
  | # pass 6
  | # fail 1
  | # cancelled 0
  | # skipped 0
  | # todo 0
  | # duration_ms 19291.121901
  | npm error Lifecycle script `test` failed with error:
  | npm error code 1
  | npm error path /home/shifty/Work/aigent-place-task064-sdk/packages/aigent-sdk
  | npm error workspace @aigent-place/aigent-sdk@0.1.0
  | npm error location /home/shifty/Work/aigent-place-task064-sdk/packages/aigent-sdk
  | npm error command failed
  | npm error command sh -c node --test ./test/*.test.mjs
- 2026-10-08T14:16:58Z — run: npm run test -w @aigent-place/aigent-sdk
  started 2026-10-08T14:16:31Z, exit 0 in 27.5s
  output tail (truncated to last 30 lines):
  |   duration_ms: 8165.48702
  |   type: 'test'
  |   ...
  | # Subtest: two seconds of small motion cannot substitute for one metre of displacement
  | ok 6 - two seconds of small motion cannot substitute for one metre of displacement
  |   ---
  |   duration_ms: 8089.324121
  |   type: 'test'
  |   ...
  | # Subtest: actual entry fails promptly on a closed port
  | ok 7 - actual entry fails promptly on a closed port
  |   ---
  |   duration_ms: 391.92475
  |   type: 'test'
  |   ...
  | # Subtest: SDK re-exports EnvelopeSchema usable for encode/decode
  | ok 8 - SDK re-exports EnvelopeSchema usable for encode/decode
  |   ---
  |   duration_ms: 2.271451
  |   type: 'test'
  |   ...
  | 1..8
  | # tests 8
  | # suites 0
  | # pass 8
  | # fail 0
  | # cancelled 0
  | # skipped 0
  | # todo 0
  | # duration_ms 27309.217534
- 2026-10-08T14:18:02Z — run: node --check packages/aigent-sdk/scripts/scripted-move.mjs
  started 2026-10-08T14:18:02Z, exit 0 in 0.0s
  output:
  | (no output)
- 2026-10-08T14:18:05Z — run: node --test --test-name-pattern=actual entry sends typed MOVE packages/aigent-sdk/test/scripted-move.test.mjs
  started 2026-10-08T14:18:02Z, exit 1 in 3.0s
  output tail (truncated to last 30 lines):
  |     async Test.run (node:internal/test_runner/test:1054:7)
  |     async startSubtestAfterBootstrap (node:internal/test_runner/harness:296:3)
  |   ...
  | # Subtest: actual entry fails and closes on first MOVE rejection
  | ok 2 - actual entry fails and closes on first MOVE rejection
  |   ---
  |   duration_ms: 157.57918
  |   type: 'test'
  |   ...
  | # Subtest: actual entry requires accepted replay and closes on replay rejection
  | ok 3 - actual entry requires accepted replay and closes on replay rejection
  |   ---
  |   duration_ms: 105.812414
  |   type: 'test'
  |   ...
  | # Subtest: actual entry fails promptly on a closed port
  | ok 4 - actual entry fails promptly on a closed port
  |   ---
  |   duration_ms: 378.502137
  |   type: 'test'
  |   ...
  | 1..4
  | # tests 4
  | # suites 0
  | # pass 3
  | # fail 1
  | # cancelled 0
  | # skipped 0
  | # todo 0
  | # duration_ms 2926.273696
- 2026-10-08T14:18:05Z — run: node --check packages/aigent-sdk/scripts/scripted-move.mjs
  started 2026-10-08T14:18:05Z, exit 0 in 0.0s
  output:
  | (no output)
- 2026-10-08T14:18:08Z — run: node --test --test-name-pattern=actual entry sends typed MOVE packages/aigent-sdk/test/scripted-move.test.mjs
  started 2026-10-08T14:18:05Z, exit 1 in 3.0s
  output tail (truncated to last 30 lines):
  |     scripted-aigent: connecting to ws://127.0.0.1:36403/ws (fresh single-aigent demo)
  |     scripted-aigent: hello protocol=1 role=aigent
  |     scripted-aigent: baseline=1 authoritative tick=123
  |     scripted-aigent: first MOVE seq=1 message=1 outcome=accepted
  |     scripted-aigent: FAILURE renew MOVE rejected code=11 message=seeded rejection
  |
  |   operator: 'match'
  |   stack: |-
  |     file:///home/shifty/Work/aigent-place-task064-sdk/packages/aigent-sdk/test/scripted-move.test.mjs:209:12
  |     runFixture (file:///home/shifty/Work/aigent-place-task064-sdk/packages/aigent-sdk/test/scripted-move.test.mjs:162:11)
  |     process.processTicksAndRejections (node:internal/process/task_queues:103:5)
  |     async TestContext.<anonymous> (file:///home/shifty/Work/aigent-place-task064-sdk/packages/aigent-sdk/test/scripted-move.test.mjs:207:3)
  |     async Test.run (node:internal/test_runner/test:1054:7)
  |     async Test.processPendingSubtests (node:internal/test_runner/test:744:7)
  |   ...
  | # Subtest: actual entry fails promptly on a closed port
  | ok 4 - actual entry fails promptly on a closed port
  |   ---
  |   duration_ms: 400.415593
  |   type: 'test'
  |   ...
  | 1..4
  | # tests 4
  | # suites 0
  | # pass 2
  | # fail 2
  | # cancelled 0
  | # skipped 0
  | # todo 0
  | # duration_ms 2978.68013
- 2026-10-08T14:18:08Z — run: node --check packages/aigent-sdk/scripts/scripted-move.mjs
  started 2026-10-08T14:18:08Z, exit 0 in 0.0s
  output:
  | (no output)
- 2026-10-08T14:18:27Z — run: node --test --test-name-pattern=actual entry fails and closes on first packages/aigent-sdk/test/scripted-move.test.mjs
  started 2026-10-08T14:18:08Z, exit 1 in 19.0s
  output tail (truncated to last 30 lines):
  |     scripted-aigent: baseline=1 authoritative tick=123
  |     scripted-aigent: first MOVE seq=1 message=1 outcome=accepted
  |     scripted-aigent: idempotent replay seq=1 message=2 outcome=accepted
  |     scripted-aigent: renew MOVE seq=2 message=3 outcome=accepted
  |     scripted-aigent: FAILURE timeout: no complete accepted/replayed/renewed MOVE and >=1m observed movement over >=2s within 8s
  |
  |   operator: 'match'
  |   stack: |-
  |     file:///home/shifty/Work/aigent-place-task064-sdk/packages/aigent-sdk/test/scripted-move.test.mjs:209:12
  |     runFixture (file:///home/shifty/Work/aigent-place-task064-sdk/packages/aigent-sdk/test/scripted-move.test.mjs:162:11)
  |     process.processTicksAndRejections (node:internal/process/task_queues:103:5)
  |     async TestContext.<anonymous> (file:///home/shifty/Work/aigent-place-task064-sdk/packages/aigent-sdk/test/scripted-move.test.mjs:207:3)
  |     async Test.run (node:internal/test_runner/test:1054:7)
  |     async Test.processPendingSubtests (node:internal/test_runner/test:744:7)
  |   ...
  | # Subtest: actual entry fails promptly on a closed port
  | ok 4 - actual entry fails promptly on a closed port
  |   ---
  |   duration_ms: 389.905175
  |   type: 'test'
  |   ...
  | 1..4
  | # tests 4
  | # suites 0
  | # pass 2
  | # fail 2
  | # cancelled 0
  | # skipped 0
  | # todo 0
  | # duration_ms 18968.033086
- 2026-10-08T14:18:27Z — run: node --check packages/aigent-sdk/scripts/scripted-move.mjs
  started 2026-10-08T14:18:27Z, exit 0 in 0.0s
  output:
  | (no output)
- 2026-10-08T14:18:38Z — run: node --test --test-name-pattern=two seconds of small motion packages/aigent-sdk/test/scripted-move.test.mjs
  started 2026-10-08T14:18:28Z, exit 1 in 10.4s
  output tail (truncated to last 30 lines):
  |     scripted-aigent: observe body=1 x=155mm y=8905mm z=0mm displacement=0.155m movement=1.503s
  |     scripted-aigent: observe body=1 x=180mm y=8905mm z=0mm displacement=0.180m movement=1.754s
  |     scripted-aigent: observe body=1 x=205mm y=8905mm z=0mm displacement=0.205m movement=2.006s
  |     scripted-aigent: SUCCESS body=1 observed displacement=0.205m movement=2.006s (accepted, idempotent replay, renewed)
  |
  |
  |     0 !== 1
  |
  |   code: 'ERR_ASSERTION'
  |   name: 'AssertionError'
  |   expected: 1
  |   actual: 0
  |   operator: 'strictEqual'
  |   stack: |-
  |     file:///home/shifty/Work/aigent-place-task064-sdk/packages/aigent-sdk/test/scripted-move.test.mjs:232:12
  |     runFixture (file:///home/shifty/Work/aigent-place-task064-sdk/packages/aigent-sdk/test/scripted-move.test.mjs:162:11)
  |     process.processTicksAndRejections (node:internal/process/task_queues:103:5)
  |     async TestContext.<anonymous> (file:///home/shifty/Work/aigent-place-task064-sdk/packages/aigent-sdk/test/scripted-move.test.mjs:231:3)
  |     async Test.run (node:internal/test_runner/test:1054:7)
  |     async Test.processPendingSubtests (node:internal/test_runner/test:744:7)
  |   ...
  | 1..2
  | # tests 2
  | # suites 0
  | # pass 1
  | # fail 1
  | # cancelled 0
  | # skipped 0
  | # todo 0
  | # duration_ms 10397.2186
- 2026-10-08T14:18:38Z — run: node --check packages/aigent-sdk/scripts/scripted-move.mjs
  started 2026-10-08T14:18:38Z, exit 0 in 0.0s
  output:
  | (no output)
- 2026-10-08T14:18:58Z — run: node --test --test-name-pattern=a large immediate displacement packages/aigent-sdk/test/scripted-move.test.mjs
  started 2026-10-08T14:18:38Z, exit 1 in 19.3s
  output tail (truncated to last 30 lines):
  |   operator: 'strictEqual'
  |   stack: |-
  |     file:///home/shifty/Work/aigent-place-task064-sdk/packages/aigent-sdk/test/scripted-move.test.mjs:224:12
  |     runFixture (file:///home/shifty/Work/aigent-place-task064-sdk/packages/aigent-sdk/test/scripted-move.test.mjs:162:11)
  |     process.processTicksAndRejections (node:internal/process/task_queues:103:5)
  |     async TestContext.<anonymous> (file:///home/shifty/Work/aigent-place-task064-sdk/packages/aigent-sdk/test/scripted-move.test.mjs:223:3)
  |     async Test.run (node:internal/test_runner/test:1054:7)
  |     async Test.processPendingSubtests (node:internal/test_runner/test:744:7)
  |   ...
  | # Subtest: two seconds of small motion cannot substitute for one metre of displacement
  | ok 6 - two seconds of small motion cannot substitute for one metre of displacement
  |   ---
  |   duration_ms: 8106.848789
  |   type: 'test'
  |   ...
  | # Subtest: actual entry fails promptly on a closed port
  | ok 7 - actual entry fails promptly on a closed port
  |   ---
  |   duration_ms: 388.743816
  |   type: 'test'
  |   ...
  | 1..7
  | # tests 7
  | # suites 0
  | # pass 5
  | # fail 2
  | # cancelled 0
  | # skipped 0
  | # todo 0
  | # duration_ms 19313.927416
- 2026-10-08T14:18:58Z — run: node --check packages/aigent-sdk/scripts/scripted-move.mjs
  started 2026-10-08T14:18:58Z, exit 0 in 0.0s
  output:
  | (no output)
- 2026-10-08T14:19:02Z — run: node --test --test-name-pattern=actual entry fails and closes on first packages/aigent-sdk/test/scripted-move.test.mjs
  started 2026-10-08T14:18:58Z, exit 1 in 3.7s
  output tail (truncated to last 30 lines):
  |
  |     false !== true
  |
  |   code: 'ERR_ASSERTION'
  |   name: 'AssertionError'
  |   expected: true
  |   actual: false
  |   operator: 'strictEqual'
  |   stack: |-
  |     runFixture (file:///home/shifty/Work/aigent-place-task064-sdk/packages/aigent-sdk/test/scripted-move.test.mjs:161:12)
  |     process.processTicksAndRejections (node:internal/process/task_queues:103:5)
  |     async TestContext.<anonymous> (file:///home/shifty/Work/aigent-place-task064-sdk/packages/aigent-sdk/test/scripted-move.test.mjs:207:3)
  |     async Test.run (node:internal/test_runner/test:1054:7)
  |     async Test.processPendingSubtests (node:internal/test_runner/test:744:7)
  |   ...
  | # Subtest: actual entry fails promptly on a closed port
  | ok 4 - actual entry fails promptly on a closed port
  |   ---
  |   duration_ms: 334.871179
  |   type: 'test'
  |   ...
  | 1..4
  | # tests 4
  | # suites 0
  | # pass 1
  | # fail 3
  | # cancelled 0
  | # skipped 0
  | # todo 0
  | # duration_ms 3624.665523
- 2026-10-08T14:19:02Z — run: node --check packages/aigent-sdk/scripts/scripted-move.mjs
  started 2026-10-08T14:19:02Z, exit 0 in 0.0s
  output:
  | (no output)
- 2026-10-08T14:19:11Z — run: node --test --test-name-pattern=accepted commands without observe packages/aigent-sdk/test/scripted-move.test.mjs
  started 2026-10-08T14:19:02Z, exit 1 in 9.8s
  output tail (truncated to last 30 lines):
  |     scripted-aigent: connecting to ws://127.0.0.1:42915/ws (fresh single-aigent demo)
  |     scripted-aigent: hello protocol=1 role=aigent
  |     scripted-aigent: first MOVE seq=1 message=1 outcome=accepted
  |     scripted-aigent: idempotent replay seq=1 message=2 outcome=accepted
  |     scripted-aigent: renew MOVE seq=2 message=3 outcome=accepted
  |
  |
  |     'SIGKILL' !== null
  |
  |   code: 'ERR_ASSERTION'
  |   name: 'AssertionError'
  |   expected: ~
  |   actual: 'SIGKILL'
  |   operator: 'strictEqual'
  |   stack: |-
  |     runFixture (file:///home/shifty/Work/aigent-place-task064-sdk/packages/aigent-sdk/test/scripted-move.test.mjs:158:12)
  |     process.processTicksAndRejections (node:internal/process/task_queues:103:5)
  |     async TestContext.<anonymous> (file:///home/shifty/Work/aigent-place-task064-sdk/packages/aigent-sdk/test/scripted-move.test.mjs:215:3)
  |     async Test.run (node:internal/test_runner/test:1054:7)
  |     async Test.processPendingSubtests (node:internal/test_runner/test:744:7)
  |   ...
  | 1..2
  | # tests 2
  | # suites 0
  | # pass 1
  | # fail 1
  | # cancelled 0
  | # skipped 0
  | # todo 0
  | # duration_ms 9766.77589
- 2026-10-08T14:20:39Z — run: node --check packages/aigent-sdk/scripts/scripted-move.mjs
  started 2026-10-08T14:20:39Z, exit 0 in 0.0s
  output:
  | (no output)
- 2026-10-08T14:20:41Z — run: node --test --test-name-pattern=actual entry sends typed MOVE packages/aigent-sdk/test/scripted-move.test.mjs
  started 2026-10-08T14:20:40Z, exit 1 in 0.9s
  output tail (truncated to last 30 lines):
  |       handle (file:///home/shifty/Work/aigent-place-task064-sdk/packages/aigent-sdk/test/scripted-move.test.mjs:79:14)
  |       Socket.<anonymous> (file:///home/shifty/Work/aigent-place-task064-sdk/packages/aigent-sdk/test/scripted-move.test.mjs:121:11)
  |       Socket.emit (node:events:519:28)
  |       addChunk (node:internal/streams/readable:561:12)
  |       readableAddChunkPushByteMode (node:internal/streams/readable:512:3)
  |       Readable.push (node:internal/streams/readable:392:5)
  |       TCP.onStreamRead (node:internal/stream_base_commons:189:23)
  |   operator: 'deepStrictEqual'
  |   stack: |-
  |     runFixture (file:///home/shifty/Work/aigent-place-task064-sdk/packages/aigent-sdk/test/scripted-move.test.mjs:161:12)
  |     process.processTicksAndRejections (node:internal/process/task_queues:103:5)
  |     async TestContext.<anonymous> (file:///home/shifty/Work/aigent-place-task064-sdk/packages/aigent-sdk/test/scripted-move.test.mjs:208:3)
  |     async Test.run (node:internal/test_runner/test:1054:7)
  |     async Test.processPendingSubtests (node:internal/test_runner/test:744:7)
  |   ...
  | # Subtest: actual entry fails promptly on a closed port
  | ok 4 - actual entry fails promptly on a closed port
  |   ---
  |   duration_ms: 363.379394
  |   type: 'test'
  |   ...
  | 1..4
  | # tests 4
  | # suites 0
  | # pass 1
  | # fail 3
  | # cancelled 0
  | # skipped 0
  | # todo 0
  | # duration_ms 825.02458
- 2026-10-08T14:20:41Z — run: node --check packages/aigent-sdk/scripts/scripted-move.mjs
  started 2026-10-08T14:20:41Z, exit 0 in 0.0s
  output:
  | (no output)
- 2026-10-08T14:20:44Z — run: node --test --test-name-pattern=actual entry sends typed MOVE packages/aigent-sdk/test/scripted-move.test.mjs
  started 2026-10-08T14:20:41Z, exit 1 in 3.0s
  output tail (truncated to last 30 lines):
  |     async Test.run (node:internal/test_runner/test:1054:7)
  |     async startSubtestAfterBootstrap (node:internal/test_runner/harness:296:3)
  |   ...
  | # Subtest: actual entry fails and closes on first MOVE rejection
  | ok 2 - actual entry fails and closes on first MOVE rejection
  |   ---
  |   duration_ms: 118.613916
  |   type: 'test'
  |   ...
  | # Subtest: actual entry requires accepted replay and closes on replay rejection
  | ok 3 - actual entry requires accepted replay and closes on replay rejection
  |   ---
  |   duration_ms: 148.29813
  |   type: 'test'
  |   ...
  | # Subtest: actual entry fails promptly on a closed port
  | ok 4 - actual entry fails promptly on a closed port
  |   ---
  |   duration_ms: 367.740435
  |   type: 'test'
  |   ...
  | 1..4
  | # tests 4
  | # suites 0
  | # pass 3
  | # fail 1
  | # cancelled 0
  | # skipped 0
  | # todo 0
  | # duration_ms 2972.097574
- 2026-10-08T14:20:44Z — run: node --check packages/aigent-sdk/scripts/scripted-move.mjs
  started 2026-10-08T14:20:44Z, exit 0 in 0.0s
  output:
  | (no output)
- 2026-10-08T14:20:47Z — run: node --test --test-name-pattern=actual entry sends typed MOVE packages/aigent-sdk/test/scripted-move.test.mjs
  started 2026-10-08T14:20:44Z, exit 1 in 2.9s
  output tail (truncated to last 30 lines):
  |   actual: |-
  |     scripted-aigent: connecting to ws://127.0.0.1:37755/ws (fresh single-aigent demo)
  |     scripted-aigent: hello protocol=1 role=aigent
  |     scripted-aigent: baseline=1 authoritative tick=123
  |     scripted-aigent: first MOVE seq=1 message=1 outcome=accepted
  |     scripted-aigent: FAILURE renew MOVE rejected code=11 message=seeded rejection
  |
  |   operator: 'match'
  |   stack: |-
  |     file:///home/shifty/Work/aigent-place-task064-sdk/packages/aigent-sdk/test/scripted-move.test.mjs:210:12
  |     runFixture (file:///home/shifty/Work/aigent-place-task064-sdk/packages/aigent-sdk/test/scripted-move.test.mjs:163:11)
  |     async TestContext.<anonymous> (file:///home/shifty/Work/aigent-place-task064-sdk/packages/aigent-sdk/test/scripted-move.test.mjs:208:3)
  |     async Test.run (node:internal/test_runner/test:1054:7)
  |     async Test.processPendingSubtests (node:internal/test_runner/test:744:7)
  |   ...
  | # Subtest: actual entry fails promptly on a closed port
  | ok 4 - actual entry fails promptly on a closed port
  |   ---
  |   duration_ms: 381.547463
  |   type: 'test'
  |   ...
  | 1..4
  | # tests 4
  | # suites 0
  | # pass 2
  | # fail 2
  | # cancelled 0
  | # skipped 0
  | # todo 0
  | # duration_ms 2886.547884
- 2026-10-08T14:20:47Z — run: node --check packages/aigent-sdk/scripts/scripted-move.mjs
  started 2026-10-08T14:20:47Z, exit 0 in 0.0s
  output:
  | (no output)
- 2026-10-08T14:21:06Z — run: node --test --test-name-pattern=actual entry fails and closes on first packages/aigent-sdk/test/scripted-move.test.mjs
  started 2026-10-08T14:20:47Z, exit 1 in 19.0s
  output tail (truncated to last 30 lines):
  |     scripted-aigent: baseline=1 authoritative tick=123
  |     scripted-aigent: first MOVE seq=1 message=1 outcome=accepted
  |     scripted-aigent: idempotent replay seq=1 message=2 outcome=accepted
  |     scripted-aigent: renew MOVE seq=2 message=3 outcome=accepted
  |     scripted-aigent: FAILURE timeout: no complete accepted/replayed/renewed MOVE and >=1m observed movement over >=2s within 8s
  |
  |   operator: 'match'
  |   stack: |-
  |     file:///home/shifty/Work/aigent-place-task064-sdk/packages/aigent-sdk/test/scripted-move.test.mjs:210:12
  |     runFixture (file:///home/shifty/Work/aigent-place-task064-sdk/packages/aigent-sdk/test/scripted-move.test.mjs:163:11)
  |     process.processTicksAndRejections (node:internal/process/task_queues:103:5)
  |     async TestContext.<anonymous> (file:///home/shifty/Work/aigent-place-task064-sdk/packages/aigent-sdk/test/scripted-move.test.mjs:208:3)
  |     async Test.run (node:internal/test_runner/test:1054:7)
  |     async Test.processPendingSubtests (node:internal/test_runner/test:744:7)
  |   ...
  | # Subtest: actual entry fails promptly on a closed port
  | ok 4 - actual entry fails promptly on a closed port
  |   ---
  |   duration_ms: 324.927516
  |   type: 'test'
  |   ...
  | 1..4
  | # tests 4
  | # suites 0
  | # pass 2
  | # fail 2
  | # cancelled 0
  | # skipped 0
  | # todo 0
  | # duration_ms 18966.10124
- 2026-10-08T14:21:06Z — run: node --check packages/aigent-sdk/scripts/scripted-move.mjs
  started 2026-10-08T14:21:06Z, exit 0 in 0.0s
  output:
  | (no output)
- 2026-10-08T14:21:17Z — run: node --test --test-name-pattern=two seconds of small motion packages/aigent-sdk/test/scripted-move.test.mjs
  started 2026-10-08T14:21:07Z, exit 1 in 10.4s
  output tail (truncated to last 30 lines):
  |     scripted-aigent: observe body=1 x=145mm y=8905mm z=0mm displacement=0.145m movement=1.401s
  |     scripted-aigent: observe body=1 x=170mm y=8905mm z=0mm displacement=0.170m movement=1.652s
  |     scripted-aigent: observe body=1 x=195mm y=8905mm z=0mm displacement=0.195m movement=1.903s
  |     scripted-aigent: SUCCESS body=1 observed displacement=0.205m movement=2.003s (accepted, idempotent replay, renewed)
  |
  |
  |     0 !== 1
  |
  |   code: 'ERR_ASSERTION'
  |   name: 'AssertionError'
  |   expected: 1
  |   actual: 0
  |   operator: 'strictEqual'
  |   stack: |-
  |     file:///home/shifty/Work/aigent-place-task064-sdk/packages/aigent-sdk/test/scripted-move.test.mjs:233:12
  |     runFixture (file:///home/shifty/Work/aigent-place-task064-sdk/packages/aigent-sdk/test/scripted-move.test.mjs:163:11)
  |     process.processTicksAndRejections (node:internal/process/task_queues:103:5)
  |     async TestContext.<anonymous> (file:///home/shifty/Work/aigent-place-task064-sdk/packages/aigent-sdk/test/scripted-move.test.mjs:232:3)
  |     async Test.run (node:internal/test_runner/test:1054:7)
  |     async Test.processPendingSubtests (node:internal/test_runner/test:744:7)
  |   ...
  | 1..2
  | # tests 2
  | # suites 0
  | # pass 1
  | # fail 1
  | # cancelled 0
  | # skipped 0
  | # todo 0
  | # duration_ms 10402.128223
- 2026-10-08T14:21:17Z — run: node --check packages/aigent-sdk/scripts/scripted-move.mjs
  started 2026-10-08T14:21:17Z, exit 0 in 0.0s
  output:
  | (no output)
- 2026-10-08T14:21:39Z — run: node --test --test-name-pattern=a large immediate displacement packages/aigent-sdk/test/scripted-move.test.mjs
  started 2026-10-08T14:21:19Z, exit 1 in 19.3s
  output tail (truncated to last 30 lines):
  |   actual: 0
  |   operator: 'strictEqual'
  |   stack: |-
  |     file:///home/shifty/Work/aigent-place-task064-sdk/packages/aigent-sdk/test/scripted-move.test.mjs:225:12
  |     runFixture (file:///home/shifty/Work/aigent-place-task064-sdk/packages/aigent-sdk/test/scripted-move.test.mjs:163:11)
  |     async TestContext.<anonymous> (file:///home/shifty/Work/aigent-place-task064-sdk/packages/aigent-sdk/test/scripted-move.test.mjs:224:3)
  |     async Test.run (node:internal/test_runner/test:1054:7)
  |     async Test.processPendingSubtests (node:internal/test_runner/test:744:7)
  |   ...
  | # Subtest: two seconds of small motion cannot substitute for one metre of displacement
  | ok 6 - two seconds of small motion cannot substitute for one metre of displacement
  |   ---
  |   duration_ms: 8086.478634
  |   type: 'test'
  |   ...
  | # Subtest: actual entry fails promptly on a closed port
  | ok 7 - actual entry fails promptly on a closed port
  |   ---
  |   duration_ms: 352.513587
  |   type: 'test'
  |   ...
  | 1..7
  | # tests 7
  | # suites 0
  | # pass 5
  | # fail 2
  | # cancelled 0
  | # skipped 0
  | # todo 0
  | # duration_ms 19254.806209
- 2026-10-08T14:21:39Z — run: node --check packages/aigent-sdk/scripts/scripted-move.mjs
  started 2026-10-08T14:21:39Z, exit 0 in 0.0s
  output:
  | (no output)
- 2026-10-08T14:21:43Z — run: node --test --test-name-pattern=actual entry fails and closes on first packages/aigent-sdk/test/scripted-move.test.mjs
  started 2026-10-08T14:21:39Z, exit 1 in 3.7s
  output tail (truncated to last 30 lines):
  |     actual CLI must send CLOSE on all outcomes
  |
  |     false !== true
  |
  |   code: 'ERR_ASSERTION'
  |   name: 'AssertionError'
  |   expected: true
  |   actual: false
  |   operator: 'strictEqual'
  |   stack: |-
  |     runFixture (file:///home/shifty/Work/aigent-place-task064-sdk/packages/aigent-sdk/test/scripted-move.test.mjs:162:12)
  |     async TestContext.<anonymous> (file:///home/shifty/Work/aigent-place-task064-sdk/packages/aigent-sdk/test/scripted-move.test.mjs:208:3)
  |     async Test.run (node:internal/test_runner/test:1054:7)
  |     async Test.processPendingSubtests (node:internal/test_runner/test:744:7)
  |   ...
  | # Subtest: actual entry fails promptly on a closed port
  | ok 4 - actual entry fails promptly on a closed port
  |   ---
  |   duration_ms: 367.808512
  |   type: 'test'
  |   ...
  | 1..4
  | # tests 4
  | # suites 0
  | # pass 1
  | # fail 3
  | # cancelled 0
  | # skipped 0
  | # todo 0
  | # duration_ms 3685.931485
- 2026-10-08T14:21:43Z — run: node --check packages/aigent-sdk/scripts/scripted-move.mjs
  started 2026-10-08T14:21:43Z, exit 0 in 0.0s
  output:
  | (no output)
- 2026-10-08T14:21:53Z — run: node --test --test-name-pattern=accepted commands without observe packages/aigent-sdk/test/scripted-move.test.mjs
  started 2026-10-08T14:21:43Z, exit 1 in 9.8s
  output tail (truncated to last 30 lines):
  |   error: |-
  |     scripted-aigent: connecting to ws://127.0.0.1:36423/ws (fresh single-aigent demo)
  |     scripted-aigent: hello protocol=1 role=aigent
  |     scripted-aigent: first MOVE seq=1 message=1 outcome=accepted
  |     scripted-aigent: idempotent replay seq=1 message=2 outcome=accepted
  |     scripted-aigent: renew MOVE seq=2 message=3 outcome=accepted
  |
  |
  |     'SIGKILL' !== null
  |
  |   code: 'ERR_ASSERTION'
  |   name: 'AssertionError'
  |   expected: ~
  |   actual: 'SIGKILL'
  |   operator: 'strictEqual'
  |   stack: |-
  |     runFixture (file:///home/shifty/Work/aigent-place-task064-sdk/packages/aigent-sdk/test/scripted-move.test.mjs:159:12)
  |     async TestContext.<anonymous> (file:///home/shifty/Work/aigent-place-task064-sdk/packages/aigent-sdk/test/scripted-move.test.mjs:216:3)
  |     async Test.run (node:internal/test_runner/test:1054:7)
  |     async Test.processPendingSubtests (node:internal/test_runner/test:744:7)
  |   ...
  | 1..2
  | # tests 2
  | # suites 0
  | # pass 1
  | # fail 1
  | # cancelled 0
  | # skipped 0
  | # todo 0
  | # duration_ms 9754.632248
- 2026-10-08T14:22:12Z — note: SDK frozen warm self-pass: read owned diff against rubric and then REVIEW-STANDARDS. Found and fixed missing required Envelope.metadata (before MOVE domain validation); fixture now asserts generated metadata presence, with omit-metadata compiling mutation red. Checked typed boundary, fresh sole-body limitation, correlated results/replay, below-1m motion and instantaneous-jump failure, bounded timeout and CLOSE cleanup. Native WS has no terminate; explicit CLI exit occurs only after accepted results plus measured changed poses or a failure, and after normal CLOSE/250ms grace. Tests observe actual CLOSE frames and detect omission even though CLI exit is bounded. Full snapshot tick is logged; deltas have no tick, so movement span uses monotonic observed time without inventing server ticks. Test script lists named files for cross-platform shell behavior. No new dependencies. Full Rust/browser/gate/cold-review work stays with root.
- 2026-10-08T14:22:14Z — run: npm ci
  started 2026-10-08T14:22:12Z, exit 0 in 1.7s
  output:
  |
  | added 26 packages, and audited 30 packages in 2s
  |
  | 5 packages are looking for funding
  |   run `npm fund` for details
  |
  | 2 high severity vulnerabilities
  |
  | To address all issues, run:
  |   npm audit fix
  |
  | Run `npm audit` for details.
- 2026-10-08T14:23:03Z — run: npm run test -w @aigent-place/aigent-sdk
  started 2026-10-08T14:22:35Z, exit 0 in 27.3s
  output tail (truncated to last 30 lines):
  |   duration_ms: 8120.844366
  |   type: 'test'
  |   ...
  | # Subtest: two seconds of small motion cannot substitute for one metre of displacement
  | ok 6 - two seconds of small motion cannot substitute for one metre of displacement
  |   ---
  |   duration_ms: 8100.420083
  |   type: 'test'
  |   ...
  | # Subtest: actual entry fails promptly on a closed port
  | ok 7 - actual entry fails promptly on a closed port
  |   ---
  |   duration_ms: 323.426724
  |   type: 'test'
  |   ...
  | # Subtest: SDK re-exports EnvelopeSchema usable for encode/decode
  | ok 8 - SDK re-exports EnvelopeSchema usable for encode/decode
  |   ---
  |   duration_ms: 2.475578
  |   type: 'test'
  |   ...
  | 1..8
  | # tests 8
  | # suites 0
  | # pass 8
  | # fail 0
  | # cancelled 0
  | # skipped 0
  | # todo 0
  | # duration_ms 27217.317322
- 2026-10-08T14:25:06Z — run: node --check packages/aigent-sdk/scripts/scripted-move.mjs
  started 2026-10-08T14:25:06Z, exit 0 in 0.0s
  output:
  | (no output)
- 2026-10-08T14:25:06Z — run: git diff HEAD --check
  started 2026-10-08T14:25:06Z, exit 0 in 0.0s
  output:
  | (no output)
- 2026-10-08T14:25:06Z — note: SDK worker handoff: restored frozen source after eight compiling/running seeded defects; final npm ci, SDK suite (8/8 actual-entry checks), node --check and git diff HEAD --check passed through own copied CLI. Seeded red behaviors: omitted metadata, empty typed payload, omitted replay, ignored rejection, zero displacement threshold, zero duration threshold, omitted CLOSE, deadline extended to 16s; every syntax check exited 0 and associated real-entry behavioral test exited 1. Final success fixture exited in 2.165s; first/replay rejection in 0.117/0.128s; three non-success observation cases in 8.10-8.16s; closed port in 0.323s. Frozen binary patch excludes .tasks. No runtime server or browser started by SDK worker; child fixture processes exited and sockets/timers stopped. Root retains actual fresh rebuilt server/Chromium/full gate/cold reviews/commit/PR authority.
