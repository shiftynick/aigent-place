# Task 064, full cold round 1 adjudication

SPEC completed with PASS and a complete CHECKED inventory. STANDARDS completed
with one medium and three low findings. Both used rung 1: separate fresh Claude
Fable 5 CLI calls through the required Foundry preset, dispatched by a T3-owned
child. Neither axis was missing or treated as passing by default.

1. **Confirmed medium: accepted command can miss World admission.** Although
   enqueue error swallowing predates this task and is recorded in task 042,
   independent source adjudication found a newly expanded reachable schedule.
   With generation T sealed and its writer Busy, epoch E1 MOVE sequence 1 and
   reconnect epoch E2 STOP sequence 1 both reserve T+1. Different idempotency
   keys do not prevent their identical canonical tuples. STOP can be cached
   and sent as Accepted while enqueue rejects it. This must be fixed here;
   delivery requires fresh review. The bounded repair now places World queue
   admission before the new result is cached and makes demo spawn/effect
   batches atomic, including tentative remaining pending commands. Executed
   baseline regressions failed before production changes; both reconnect Busy
   cases and partial-spawn integrity pass after the fix. Fourteen compiling
   mutations were red and restored. Full durable-result integration and global
   writer-failure lifecycle remain task 042 work.
2. **Partially confirmed low SDK timing sensitivity: fixed.** A separate
   read-only assessment confirmed the two-second failure limit exceeds the
   approved ten-second requirement. The renewal gap assertion and its tick
   claim are also unnecessary. Slow scheduling raises that gap, so there is
   no demonstrated renewal-gap load flake. The worker reproduced old-test
   failure using a controlled 2100 ms startup delay, then passed the same
   scenario after six test-only edits. Real distance/duration and ten-second
   exit oracles remain; causal rejection command counts replace arbitrary
   bounds. Nine compiling mutations were red and final SDK tests passed 8/8.
   Root verified and integrated only the one-path delta and its hashes.
3. **Runtime provenance: no confirmed missing execution.** Root and a fresh,
   independent runtime validator inspected the real screenshots, source and
   binary hashes, passive observation trace, fixture caveats, and subprocess
   results directly. The public worker/runtime reports and packet carry exact
   recorded commands and results. The required answer-only cold preset reviews
   this recorded evidence; it cannot reopen external binary screenshots. This
   finding identifies that review surface limitation, rather than evidence
   that the runs did not occur. Round 2 will carry the explicit independent
   verification report, artifact paths and hashes, and this adjudication. The
   backend edit invalidated the earlier binary run. Fresh rebuilt runtime and
   browser acceptance now pass, with direct artifact inspection and the same
   current-source/running-binary hashes. The full root gate passes after the
   final edit (105.3 s).
4. **Confirmed low: terminal tick uses the wrong protocol failure code.**
   TickExhausted is not the published global writer failure transition.
   PERSISTENCE_UNAVAILABLE requires closing all command-capable connections
   and preserving spectators. The new early guard also bypasses spectator
   rejection and identical replay. The fix keeps no-wrap admission protection,
   resolves no-effect classifications before World admission, and uses an
   explicit correlated diagnostic plus generic transport closure for terminal
   admission. Both role/replay wire regressions were red before the fix and pass
   after it; reinstating early closure or storage-error reuse produces compiling
   mutation reds. The global writer-failure lifecycle remains deferred.

The medium fix requires a fresh full SPEC and STANDARDS round after targeted
red/green evidence, warm review, and applicable final validation. Current
program progress remains 0/5; no task 064 pull request has been delivered.
