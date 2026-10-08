SDK worker handoff — task-064 round 1

Worktree: /home/shifty/Work/aigent-place-task064-sdk
Owned changed files:
- packages/aigent-sdk/scripts/scripted-move.mjs
- packages/aigent-sdk/test/scripted-move.test.mjs (new)
- packages/aigent-sdk/package.json
- README.md (existing demo subsection only)

Frozen patch: round1-sdk.patch
SHA256: 631c72974d53fdddef28f3d81884f229e275040c68bfeb7db25799d6d474912f
The patch is a staged/named-path git diff HEAD --binary and excludes .tasks.
No commits, pushes, board claims or task-state transitions were made by this worker.

Behavior:
Generated MovePayload encodes target x1500/z0mm, speed500mm/s. First command, exact same-sequence/key replay with a new envelope message ID, then renewal sequence2 are correlated and must all be accepted. A generated full/delta observer follows the sole body, preserves the numbered baseline, measures horizontal displacement from its initial observed position and time between changed positions. Success requires >=1000mm displacement and >=2000ms between changed-pose observations. Initial full tick is printed; deltas contain no tick, so elapsed span is honest monotonic observed time. Accepted does not mean arrival. One 8000ms deadline covers connection, handshake, results and observation. Finally removes message/open/error/close listeners and both timers, sends CLOSE and waits for native close up to250ms. Explicit CLI exit then prevents an uncooperative close peer from keeping the command alive. Failure remains status1.

Final checks, recorded through own task CLI:
- npm ci: exit0 (no dependency changes)
- npm run test -w @aigent-place/aigent-sdk: exit0;8/8 tests;27.3s
- node --check packages/aigent-sdk/scripts/scripted-move.mjs: exit0
- git diff HEAD --check: exit0
The actual Node entry is spawned for real loopback WebSocket fixtures, not imported helpers. Success ran2.165s; first/replay rejection0.117/0.128s; timeout/immediate jump/below1m motion8.10-8.16s; closed port0.323s. Every cooperative fixture saw a client CLOSE frame. Existing product gate already runs the SDK test command; it now names both test files, with no workflow/gate-script edits.

Warm self-pass:
Read frozen diff against rubric and REVIEW-STANDARDS. Fixed omitted required envelope metadata and added a wire assertion + mutation red before handoff. Initial test byte-container equality was corrected (Buffer versus Uint8Array); no runtime defect was concealed. All mutations were restored before the final suite. No new architecture/public SDK/protocol API or dependency.

Limits and integration:
Fresh journal, default terrain and only one aigent are explicit demo prerequisites. This is not a general self-body binding or arbitrary-world pathfinder. It intentionally fails rather than claim ownership if more than one body is observed. Snapshot delta wire does not provide authoritative ticks. Script success proves displacement, not destination arrival or shape completion. Root must run the documented npm command against a fresh rebuilt listening server and fresh journal, validate real Chromium together with viewer changes, run the full gate and separate cold SPEC/STANDARDS reviews. No worker server/browser was started; no worker process remains. Root baseline services were not touched.

Evidence:
- round1-sdk-task064-log.md: own copied CLI evidence/note record
- round1-sdk-mutations.json: all syntax0/behavior1 results
- round1-sdk-red-*.log: per-mutation exact output
- round1-sdk-mutations.py: reproducible seeded mutation runner, restores source in finally

Mutation results:
- omit-envelope-metadata: syntax 0; behavior 1; pattern actual entry sends typed MOVE
- empty-MOVE-payload: syntax 0; behavior 1; pattern actual entry sends typed MOVE
- skip-idempotent-replay: syntax 0; behavior 1; pattern actual entry sends typed MOVE
- ignore-rejected-result: syntax 0; behavior 1; pattern actual entry fails and closes on first
- drop-displacement-threshold: syntax 0; behavior 1; pattern two seconds of small motion
- drop-movement-duration-threshold: syntax 0; behavior 1; pattern a large immediate displacement
- omit-socket-CLOSE: syntax 0; behavior 1; pattern actual entry fails and closes on first
- extend-global-deadline: syntax 0; behavior 1; pattern accepted commands without observe
