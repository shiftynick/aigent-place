# Task067 bootstrap recovery follow-up

Observed implementation: `DemoBrainClient` no longer records bootstrap delivery
with a process-wide boolean before admission. Each negotiated session may send
one identity-free bootstrap only while `SnapshotView.expectedSelfBodyId` is
undefined. That existing field remembers an explicit self binding across active
binding clearance, resync and reconnect. No identity is guessed and no pending
command is replayed across epochs; the session creates sequence1 and a new
idempotency key.

Observed regression: the actual CLI's first connection received a generated
unbound observation, sent MOVE and lost the socket before admission/body
assignment. Its healthy second connection received advancing generated unbound
full snapshots but sent no bootstrap; after5s it logged `BINDING_TIMEOUT`.
With the fix, the second connection sends a fresh-epoch sequence1 bootstrap,
receives explicit binding to ID9007199254740993, emits its correctly bound policy
MOVE at sequence2 and cleanup STOP at sequence3. A second actual CLI check first
adopts binding, then clears it before connection loss: reconnect sends a policy
MOVE, not another bootstrap, and preserves the exact previously adopted ID.

Executed in the isolated brains tree with pinned Node22.22.2, recorded through
its own task067 card:

- Initial actual CLI regression: exit1; output includes healthy-reconnect
  `BINDING_TIMEOUT`. Two focused recovery checks then passed.
- Restoring the lifetime bootstrap guard compiles and fails the lost-bootstrap
  test; gating on active instead of ever-adopted binding compiles and fails the
  known-binding reconnect test. Both exact source restores verified.
- `npm test -w @aigent-place/aigent-sdk`:47/47 passed, including the10 existing
  compiling mutants, direct/root-npm actual CLI cases and original MOVE tracer.
- Patch reverse check, baseline applicability/strict whitespace check and
  `git diff --check`: exit0.

Warm source pass found no additional material issue in this two-file delta.
The policy/observation/fixture/wrapper sources and all viewer files are untouched.
Only incremental `round2-brains-bootstrap.patch` is delivered, with12-file
before/after manifests and private mutation logs/task-card copy.

Historical versus pending evidence: the probe3 runtime and source hashes in
`round2-brains-report.md` describe the pre-bootstrap-fix client7cd32df77... . They
remain unchanged historical facts. Current client SHA256 is
`f78e40201fdbbec092e96e9f4ca33fab3d5e490259a8347c45e4310ffa9796d9`;
policy remains `2c351918403c2e4afce25d70627527b3ce105f53d957fb9f167f6781aef5ad3b`.
Root reported it will run fresh actual acceptance against this client; that is
pending and is not claimed here. No worlds, browsers, journals or root tree were
operated or written, and nothing was staged, committed, pushed or marked done.
