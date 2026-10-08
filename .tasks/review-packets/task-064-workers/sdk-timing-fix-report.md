# Task-064 SDK timing repair

Completed bounded work in `/home/shifty/Work/aigent-place-task064-sdk`. Root worktree, product behavior, README, package metadata, shared target, commit history, board status, and root claim were not changed. The SDK worktree taskcard records the actual validations and retains its original root `round1-orchestrator` claim. No new worktree, commits, or board moves.

## Frozen delta

- Baseline index tree: `c4a015a85e8f516e2fa9b50cea424f6694c03833`.
- Final index tree: `88fc22e1a8f03cef53340e1b9465008cc0fccfe0`.
- Named delta path: `packages/aigent-sdk/test/scripted-move.test.mjs` only.
- Patch: `/home/shifty/.local/state/aigent-place/improvement-loop-2026-10-08/round1-sdk-timing-fix.patch`.
- Patch SHA-256: `e74ee823fa227636710dd5fa15d9ad8dc5f88b4a234f805973c6981f220ce53a`.
- Final test SHA-256: `92274eedcf6d2571ef00b1aceca2adfee141011555b6bec33f328bd59ebde55b`.
- Product script SHA-256 before/after all probes and mutations: `99c542fa6432e1cbbaaec4c742d2851701ecaefe586ed104af589cbc9b94b882`.

The exported patch compares the final staged test against the captured baseline index tree. It does not repeat the earlier SDK script/test/package/README changes already staged at baseline. `git diff --cached --name-only BASELINE` confirmed exactly one path. `git diff --cached --check BASELINE -- packages/aigent-sdk/test/scripted-move.test.mjs` passed through taskCLI.

## Implemented six edits

1. Remove captured command receive timestamps and the arbitrary >=100 ms renewal gap assertion, including the stale `renewal follows tick advance` message. Ordered three-command/replay/renewal checks remain.
2. First-rejection test checks exactly one command instead of child process elapsed <2 s.
3. Replay-rejection test checks exactly two commands, so rejection must prevent renewal.
4. Closed-port test uses <=10 s and its name states that bound.
5. Shared fixture assertion uses <=10 s, matching the rubric literally.
6. Hang watchdog is11 s instead of9.5 s. The process still must exit itself within10 s with null signal; the watchdog no longer rejects otherwise allowed9.5–10 s exits.

No product timer changes: the actual entry still has8 s deadline,150 ms renewal,250 ms close grace, monotonic observed-time measurement, >=1 m displacement and >=2 s changed-pose span. Fixture50 ms motion and both negative motion cases remain. No host-load stability claim is made.

## Real red before repair, green after repair

Private harness `round1-sdk-timing-check.py` temporarily changes only the SDK test entry path to `round1-sdk-delayed-entry.mjs`, whose top-level await waits2100 ms before dynamically importing the unchanged actual product entry. It also temporarily prints measured child results. Every temporary test edit is restored in `finally`; script hashes match. Selected tests are first MOVE rejection and closed port.

Exact recorded commands (Node pinned via PATH to `/home/shifty/.local/share/mise/installs/node/22.22.2/bin`; versionv22.22.2 verified):

```
node .agents/skills/task-tracker/scripts/task.mjs run task-064 -- python3 /home/shifty/.local/state/aigent-place/improvement-loop-2026-10-08/round1-sdk-timing-check.py before
node .agents/skills/task-tracker/scripts/task.mjs run task-064 -- python3 /home/shifty/.local/state/aigent-place/improvement-loop-2026-10-08/round1-sdk-timing-check.py after
```

- Before: taskCLI exit1, selected tests0/2. Both fail exactly at `assert.ok(result.elapsed <2_000)`. Children return expected failure exit1 with null signal at 2234.315 ms and 2506.862 ms. Shared <=10 s behavior and first-rejection CLOSE/error/output assertions passed before that arbitrary assertion.
- After: taskCLI exit0, selected tests2/2. Same2100 ms startup stimulus; children return expected failure exit1 with null signal at 2291.421 ms and 2482.529 ms. First-rejection causal count1 also passes.

These are controlled startup delays, not a host-load experiment. Full child output and timings are in `round1-sdk-timing-before.log/.json` and `round1-sdk-timing-after.log/.json`.

## Compiling behavioral mutation reds

The existing SDK private runner was copied to `round1-sdk-timing-mutations.py`, with separate new artifact names and pinned Node. All old semantic mutations were rerun against the repaired tests; product source restored in `finally`. One additional mutation sends a valid extra MOVE on a rejected result, without changing pending-result identity or the expected rejection output. This fails exactly the new command counts: first rejection actual2 versus expected1; replay rejection actual3 versus expected2. Other prior assertions passed up to these counts.

| Mutation | Syntax exit | Behavioral taskCLI exit |
| --- | --- | --- |
| send-command-after-rejection | 0 | 1 |
| omit-envelope-metadata | 0 | 1 |
| empty-MOVE-payload | 0 | 1 |
| skip-idempotent-replay | 0 | 1 |
| ignore-rejected-result | 0 | 1 |
| drop-displacement-threshold | 0 | 1 |
| drop-movement-duration-threshold | 0 | 1 |
| omit-socket-CLOSE | 0 | 1 |
| extend-global-deadline | 0 | 1 |

All executable syntax and test checks above use taskCLI. For the extra-command mutation the final behavioral command is:

```
node .agents/skills/task-tracker/scripts/task.mjs run task-064 -- python3 /home/shifty/.local/state/aigent-place/improvement-loop-2026-10-08/round1-sdk-rejection-count-test.py
```

The private helper passes the compound test-name regex as a direct subprocess argument. An initial selector accidentally reached the taskCLI shell as a pipe; that command failure is excluded as behavioral evidence, retained in `round1-sdk-timing-shell-friction.log`, and recorded as friction. The rerun produced two actual test assertion failures and is the final mutation result. The reusable mutation runner now routes this selector through the helper.

Details: `round1-sdk-timing-mutations.json`; one `round1-sdk-timing-red-MUTATION.log` per mutation. Displacement/duration removals still fail their corresponding small-motion/instant-motion cases; omission of CLOSE and extension of the deadline remain red.

## Final validation after source restoration and last test edit

```
node .agents/skills/task-tracker/scripts/task.mjs run task-064 -- npm run test -w @aigent-place/aigent-sdk
```

Exit0;8/8;27.5 s taskCLI duration (TAP27.315662 s). Actual entry success case2.191047 s, first rejection0.096605 s, replay rejection0.109199 s, silent timeout8.107971 s, instant-motion timeout8.187110 s, insufficient-motion timeout8.116291 s, closed port0.350566 s, SDK export case0.002159 s. These are observed test durations, not future runtime guarantees. The real >=1 m/>=2 s positive assertions pass unchanged. Full output: `round1-sdk-timing-full-suite.log`.

Warm pass checked the frozen named diff against the approved rubric and review standards. No product/operator documentation change is needed for test-only checks. Root still owns full gate, separate cold review, board transitions, and protected PR delivery. Copied taskCLI evidence: `round1-sdk-timing-task064-log.md`; machine-readable delta metadata: `round1-sdk-timing-fix-manifest.json`.
