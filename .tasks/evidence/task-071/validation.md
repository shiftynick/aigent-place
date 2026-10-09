# Task071 fixture validation

The operator approved the exact independently reviewed test-only repair. The
only changed tracked source is `.githooks/pre-commit.test.mjs`, copied byte for
byte from the approved candidate. The production hook, Node pin and all506
other baseline tracked files remain byte/mode unchanged. No index entries
were staged. This is warm validation, with no cold-review credit. Root owns
fresh cold review and protected delivery.

The original missing-Node fixture gave the hook the shell directory as PATH.
That directory contains host Node22.23.2 while the repository pins22.22.2, so
its negative case reached version enforcement rather than missing-Node
enforcement. The host/pinned mismatch was recorded before the original real
suite, ensuring this reproduction stopped before Cargo/npm.

The approved fixture resolves an absolute shell and creates a helper-only PATH
containing owned `dirname` and `cat` forwarding scripts. It preserves all six
cases/assertions and the success/failure Node stubs. Forwarders execute their
original absolute paths with quoted arguments; cleanup removes only the two
owned helper files and their own directory. Production enforcement is unchanged.

All runnable checks used `task.mjs run task-071`. Exact argv, UTC intervals,
raw output, child exits and before/after source hashes are retained privately.
The table uses child wall times, distinct from rounded tracker timing.

| Check | Actual result | Wall seconds |
| --- | --- | --- |
| Original real six-case suite | exit1;5 pass/1 ERR_ASSERTION at missing-Node case |0.164763|
| Approved real six-case suite | exit0;6 pass/0 fail |0.131785|
| Private probe driver | exit0; expected guard-removal assertion red and exact forwarding pass |0.204816|
| First unified gate, fresh checkout | exit1;75/76 process checks before product |0.176844|
| Pinned own-checkout `npm ci` prerequisite | exit0;package manifests/lock unchanged |1.855009|
| Exact complete unified gate rerun | **exit0;PASS** |**123.069092**|

Focused suites ran pinned Node22.22.2 with `--test
.githooks/pre-commit.test.mjs`. The weakened PRIVATE hook copy passes shell
syntax, and the copied repaired test passes JavaScript syntax. Removing only
the Node guard makes the actual repaired missing-Node assertion fail with
`ERR_ASSERTION`, child exit1/0.089114s. The real hook was never mutated.

The forwarding probe extracts the actual installed helper function and uses
an explicitly synthetic discovery seam pointing to owned executables whose
paths contain spaces/apostrophes. Both helper invocations preserve seven exact
arguments, including spaces, apostrophe, empty value, shell-literal text and
newline. Helper-only cleanup preserves an outside owned sentinel. This is
fixture behavior evidence, not production or Windows runtime evidence.

The first gate failure is preserved: the clean worktree lacked
`@bufbuild/protobuf`, imported by the replay-contract process module before
the product stage's `npm ci`. All six repaired hook cases passed in that run.
The worker stopped/reported, then root explicitly authorized routine pinned
`npm ci` in this isolated checkout and an exact gate rerun. No test was skipped,
no script/package source changed and no gate was bypassed. The task log records
the checkout-prerequisite friction; the failed receipt remains historical.

The first review-packet preparation also failed: its private inventory named
`final-audit.json`, while the real receipt is `final-scope-audit.json`. The
filename was corrected and preparation actually exited0 at
2026-10-09T22:59:43Z, before review started at23:00:14Z. The packet captured
the task log before that successful run appended its own result, so reviewers
could see only the historical failure. The current task log retains both runs;
the final-scope-audit receipt and successful gate were present in the packet.
This reporting gap is corrected here and receives a scoped cold delta check.

The final unified command was pinned Node22.22.2 `scripts/check.mjs`, with
Rust1.85.0 on PATH and the isolated worktree's own target and node_modules.
Actual UTC interval:2026-10-09T22:52:26.319855+00:00 to
2026-10-09T22:54:29.388941+00:00. Raw results are96 process tests,517 Foundry
tests,321 Cargo test passes across the workspace,9 protocol tests,47 SDK tests
and121 viewer tests. Every TAP suite has0 failures and0 skips. Formatting,
clippy, smoke, protocol conformance, workload, freshness and viewer build also
passed. This gate uses base task071 product source; it is not task069 runtime
or cold-review evidence. Own output directories are not symlinks; root/shared
build and dependency outputs were not used.

Frozen source SHA256:

- Test: `e853cbec56211a4ef592129a1962c44c398d0ba4e4ed552a2d7b1adc0b98e4af`.
- Unchanged hook: `903ec2939bdd9b753ed4ab84635ed1004944dad76b68fd357244b42663be0c77`.
- Unchanged `.nvmrc`: `4c42fb8d6334c5cdcac68b93f96c581fb83b1f58cda898cff115e5e941ef717d`.
- Final full raw gate log: `8d0532b54b71375e35014882bf8998da853ba5ffc2b755541ce180d2cf611a22`.

Warm frozen self-pass read the exact diff line by line against all four rubric
items and review/engineering standards, then checked final source identity;
no material warm finding. Product/hook operator docs need no change because
only the test fixture changes. **Windows was not executed**; portability is
static-only and still requires a functioning POSIX/Git shell and original
helper executables. Complete cold axes and protected delivery remain pending.
