# Task 064 full cold round 2 fix verification

## STANDARDS finding 2: unapproved SDK timing thresholds

The named delta changes only
`packages/aigent-sdk/test/scripted-move.test.mjs`. It removes the arbitrary
renewal gap and sub-two-second failure limits, keeps the approved ten-second
outcome bound, uses an eleven-second hang guard, and asserts that first/replay
rejection stops after one/two commands. The real motion oracle and product
timers are unchanged.

Before the fix, the worker recorded through task CLI:

```text
python3 /home/shifty/.local/state/aigent-place/improvement-loop-2026-10-08/round1-sdk-timing-check.py before
```

This controlled 2100 ms child-start delay ran the unchanged real entry. Both
tests failed specifically at `<2_000`, despite correct failure exit 1,
null termination signal, and observed elapsed 2234.315/2506.862 ms within the
approved ten-second limit. After the six test edits, the identical `after`
command passed 2/2 at 2291.421/2482.529 ms. This is a startup-delay reproduction,
not a claim that host-load stability was measured.

New causal checks are red-capable: a compiling mutation that sends an extra
command after rejection failed exactly at counts 2 != 1 and 3 != 2. Eight
existing semantic mutations also remained red, including removing distance,
duration, CLOSE or deadline behavior. Sources were restored. The final full
SDK suite passed 8/8 after the last edit (27.5 s).

Root checked and applied only the exported one-path delta
`e74ee823fa227636710dd5fa15d9ad8dc5f88b4a234f805973c6981f220ce53a`.
Final test SHA-256:
`92274eedcf6d2571ef00b1aceca2adfee141011555b6bec33f328bd59ebde55b`.
Unchanged product script SHA-256:
`99c542fa6432e1cbbaaec4c742d2851701ecaefe586ed104af589cbc9b94b882`.
Full worker report and recorded commands are copied into
`.tasks/review-packets/task-064-workers/sdk-timing-fix-report.md` and
`sdk-timing-fix-evidence-log.md`.

## STANDARDS finding 1: reconnect collision and partial local effect

Root checked and integrated the four-path delta
`52d715369143426bbdad75de689afa25da8f8f2ca150483e6078dadfa1b366ac`
against frozen worker tree `324e21f056dd5105144de5c0e526388f7b280ca9`.
SessionHub now invokes synchronous local queue admission before caching a
novel decoded result. A collision becomes Conflict15 and enters both sequence
and idempotency indexes. Fatal admission writes neither index/cursor. World
preflights complete spawn/effect batches against pending, tentative remaining
pending and internal duplicate keys before extending pending. Transport owns
Sessions then World and releases both before diagnostics/delivery. This fixes
local admission; full durable-before-result delivery remains task 042 debt.

Before production edits, recorded worker task-CLI commands were:

```text
cargo test -p world-server --test listen_journal_behavior reconnect_during
cargo test -p world-server --test listen_journal_behavior rejected_move_batch_does_not_leave_partial_spawn
```

The first exited101 at15:49:03Z: both actual WebSocket reconnect tests compiled
and failed because STOP seq1 returned correlated Accepted rather than Conflict,
including a failed-generation retry Busy case. The second exited101 at
15:49:38Z: MOVE batch collision also falsely returned Accepted. These are
executed behavioral failures, not compile failures.

Final tests require Conflict/rejection replay in E2, original MOVE and exactly
one body at tick2, fresh seq2 STOP cancellation, and E3 rejection/acceptance
replay with no duplicate effect. Partial-batch tests require no orphan entity
or binding, unchanged original pending effects and value9. The full-grid
case rejects without a spawn; existing geometry skeletons remain no-effect.

Fourteen compiling mutations failed their intended tests and were restored.
They include ignoring local rejection, dropping the rejected-key cache,
consuming cursor/caching key on fatal, invoking callbacks on replays/invalid
decode, ignoring tentative remaining duplicates, partial-batch insertion and
internal duplicate acceptance. Exact commands and assertions are in the
public arrival-followup report/log/manifest. Final fmt, clippy and all279
world-server tests passed after restoration and the last edit.

## STANDARDS finding 4: terminal semantics and classification

The same four-path delta removes the early fallible tick lookup and both
terminal PERSISTENCE_UNAVAILABLE branches. No-effect classifications and
cached replay resolve before the novel-command callback. A terminal novel
effect logs connection/message correlation and takes a generic transport
close, with no result/cache/cursor mutation and no global writer-failure claim.

Before production edits, the worker recorded:

```text
cargo test -p world-server --lib terminal_world_preserves
```

It exited101 at15:49:16Z. Both real WebSocket tests compiled and failed on
`terminal state must retain role/replay classification: Close(None)`.
Final tests instead require SpectateOnly for Viewer and cached Accepted
replay for Aigent, followed by a generic close for a novel terminal STOP.
After a controlled admissible-state restoration, the same fatal seq/key
must remain novel and retryable. Separate SessionHub checks assert empty
caches and unchanged cursor on fatal.

Behavior-removing mutations that reinstated preclassification exhaustion and
published terminal exhaustion as a storage error compiled and failed these
tests. The final crate check passed after restoring the correct source.

## Frozen integrated source and live acceptance

The four worker source hashes match the integrated root and the fresh runtime
manifest. Current world-server binary SHA-256 is
`191c4ff4c7fd07178d7df8217411c218ead1d9ca0c01bebfcbdabefc52ab0869`.
The root-recorded fresh demo exited0 in23.2s overall; its actual SDK process
exited0 in2.422298s. Follow-on real Chromium controls, read-only network,
synthetic elevated/separated fixture and closed-port analyses exited0 in
18.6s. The same rebuilt binary repeated the released9s storage-lock probe:
SDK exit0 in2.572862s with1.025m over2.000s after durability resumed1→12.
The full root gate and independent final artifact verification are recorded
in the fresh task log/evidence; a round-2 packet is dispatched only once those
terminal results have been inspected.
