# Task-064 STANDARDS finding 2 adjudication

**Disposition: partially confirmed, low severity.** The smallest repair is test-only: remove unapproved timing thresholds, preserve the real time contract, and correct the stale renewal claim. No source, board, worktree, or target changes were made. This is a static adjudication; no tests were run.

## Evidence and causality

- **Observed:** approved task-064 rubric requires the actual documented Node entry to observe >=1 m displacement over >=2 s, then exit successfully within 10 s. Rejection, timeout, and closed-port failures must clean up and exit within 10 s. It does not require rejection/closed-port exit within 2 s, renewal after a tick advance, or a specific renewal delay.
- **Observed:** the entry uses `performance.now()` for the observed changed-pose span, an 8,000 ms deadline, a 150 ms renewal timer after accepted replay, and a 250 ms close grace. The observer has no authoritative tick in deltas. The full snapshot's tick is fixed at123 in this fixture.
- **Observed:** test lines217 and262 impose `<2_000` process elapsed limits; these include child startup and host scheduling. They add a stricter contract than the approved <=10 s limit and are unnecessary.
- **Observed:** line208 says `renew.at - replay.at >=100`, with message `renewal follows tick advance`. The fixture does not advance a tick; it sends one full tick123 followed by tickless deltas. That assertion/message cannot prove tick advance.
- **Inferred:** the >=100 ms gap is arbitrary but is not itself sensitive to a slow scheduler in the way finding2 claims. The parent records `replay.at` before sending acceptance; the child starts its150 ms timer only after receiving that acceptance. Scheduling delay increases the receive gap. This finding should not be reported as a demonstrated load flake without a reproduction.
- **Observed/inferred:** the50 ms fixture interval produces real changed poses; it is an integration stimulus, not an assertion that each callback occurs on schedule. Its callback-count displacement can require40 callbacks to reach1 m, so severe host starvation can consume the8 s deadline. However, replacing every time measurement with fake time would stop this actual-entry integration test from proving the explicitly approved real>=2 s/<=10 s contract. Keep one real-clock integration check. A deterministic observer extraction is a possible later improvement, not necessary for this bounded repair.

## Exact smallest proposed edits

Only `packages/aigent-sdk/test/scripted-move.test.mjs` needs changes:

1. Change the command capture to `state.commands.push({ envelope, command });`. Delete line208's >=100 ms assertion and its stale tick-advance message. The existing ordered three-command, replay identity, sequence2, new key, and accepted-result checks still prove replay and renewal. No product renewal timer change is needed.
2. Delete the first-rejection `result.elapsed <2_000` assertion. Its `runFixture` wrapper already checks the ten-second contract. Add `state` to that callback and `assert.equal(state.commands.length, 1)` to retain causal coverage that rejection stops the command sequence.
3. In the replay-rejection callback, add `state` and `assert.equal(state.commands.length, 2)` to prove rejection prevents renewal rather than merely preventing SUCCESS.
4. Replace the closed-port `<2_000` assertion with `assert.ok(result.elapsed <=10_000, result.output)`. Rename its test to `actual entry fails and exits within ten seconds on a closed port`.
5. Change the shared `runFixture` bound from `<10_000` to `<=10_000` to match the rubric literally. Keep `signal===null`, the expected failure/success exit code, fixture errors empty, CLOSE observed, and no SUCCESS on failures.
6. Change the harness watchdog from9,500 ms to11,000 ms. The current watchdog rejects a naturally exiting9.6 s process which the rubric allows. The <=10,000 assertion remains the contract oracle;11,000 is solely a kill guard for hangs. This does not relax the allowed runtime.

Leave the fixture50 ms stimulus, actual-entry `performance.now()`, >=1 m and >=2 s success assertions,8 s product deadline,150 ms renewal, and250 ms close grace unchanged. The `instant` negative fixture must remain: only one changed pose must not satisfy the>=2 s condition. The `insufficient` negative fixture must remain: time alone must not satisfy>=1 m. Removing either threshold must still make its corresponding negative test fail.

Suggested focused verification after implementation: run the complete SDK suite; repeat compiling mutations which remove the displacement threshold, movement-duration threshold, rejection failure handling, CLOSE call, or product deadline. Confirm each relevant behavioral test is red, restore source, then repeat the suite green. Do not claim host-load stability without a separate controlled-load reproduction.

Sources: approved `.tasks/review-packets/task-064-r1/rubric.txt`; current task064 card; `docs/ENGINEERING-STANDARDS.md` testing rule; current SDK script and test; reported SDK mutation evidence in `.tasks/review-packets/task-064-workers/sdk-report.md` and `sdk-delta-report.md`.
