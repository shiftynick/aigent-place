# Task070 CODE review and decisions

Separate SPEC and STANDARDS calls completed at SDLC rung1 through the
Foundry preset, using the Claude CLI against the frozen complete packet.
The implementers used Codex. Both axes returned substantial CHECKED lists,
actual exit0, and no high or medium finding. SPEC took60.089s;
STANDARDS took74.853s. Root read both complete reports and verified24
review/packet artifacts plus all eight non-log scope files. Task-card
differences are the tracker timestamp and appended execution records.

The requested model was `claude-fable-5`. The adapter's modelObserved field
reports `claude-haiku-5-5`; session and assistant events report
`claude-fable-5`, and usage lists both. These literal fields are retained.
No claim about the underlying route is made. Both are Claude-family
metadata, separate from the Codex implementers.

The six low notes were adjudicated against the live tree:

- SPEC1: commit, remote checks, merge and cleanup remain required after
  review. This is a delivery boundary, not a pre-delivery implementation
  defect. No delivery credit is assigned by this review.
- SPEC2 and STANDARDS1: the19 viewer variants fail executed assertions.
  Those outputs require successful parsing, loading and test execution.
  Neither the rubric nor the standard requires a separate syntax command;
  compilation alone would not establish the behavioral failures. The
  absence of a separate syntax receipt is already disclosed. No defect
  was confirmed and no product change is required.
- SPEC3: real browser fixtures cover narrow, stale and reconnect cases;
  the fresh clean spectator covers default, Select, Follow and Reset.
  This satisfies their collective rubric coverage. The spectator's
  individual limits remain explicit; no unobserved coverage is credited.
- STANDARDS2: the answer-only reviewers cannot re-run private runtime
  evidence. Root's prior executed readback verified48 artifact records and
  198 bound viewer/producer sources; the separate warm audit joined22,926
  body positions. This disclosed review boundary is not a code defect.
- STANDARDS3: the local `admitted` boolean reports wrapper success, while
  the pure helper's separate admission flag controls envelope growth.
  They represent different facts in different scopes, not duplicate
  mutable ownership of one fact. Behavior and installed-control tests
  match the contract. A naming preference does not establish a violation
  of the cited one-source-of-truth standard; no defect was confirmed.

The complete reports, raw events, exact packet, hashes and root readback
are retained privately under `task070-code-cold-r1` and
`task070-root-code-custody-r1-retry1` in the program evidence directory.
This record changes prose only. The reviewed product bytes, tests and
measurement producers remain unchanged. Protected delivery is pending.
