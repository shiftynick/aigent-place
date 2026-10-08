# task-067 protocol/server worker delivery

**Observed result:** Assigned backend/protocol behavior is implemented and validated. No new blocker found. Worktree `aigent-place-task067-protocol`, branch `task-067-protocol-worker`, baseline `9274ffe63876fbb95879ac905178575426f1fdf0`. No staging, commit, push, merge, completion transition, running-server operation, SDK/viewer source edit, governance edit or contract-document edit.

## Implemented behavior

- `protocol/v1/aigent.proto`: additive MoveAim signed horizontal target fields 1/2 and unsigned speed field 3; optional record aim field 5, full self binding field 5 and delta self binding field 6. Inner versions remain 1. Generated JS/d.ts use pinned existing generator.
- `wire/snapshot.rs:78`: existing `from_snapshot(snapshot)` API delegates to an additional lease-aware projector. It verifies same entity, bounded target and positive speed. Canonical records and both carriers retain optional aim/binding; full-record equality includes aim. Both decoders reject zero present binding or invalid aim.
- `fanout.rs:670`: binding is looked up solely by stored opaque identity in supplied `generation.aigent_bodies`; aims come from that generation's `active_leases`. Neither mutable world nor focus/hash is a binding source. Both pressure promotion routes, retained canonical body and resync retain these fields. Every delta restates binding, including absence.
- `transport.rs:768,804`: accepted hello identity is stored at attach. Existing viewer-hello validation rejects an identity, so viewer storage remains None. There is no new push channel, result modification, expiry disclosure, countdown or delta tick.

## Behavioral evidence

New `snapshot_binding_behavior.rs:102` uses real ephemeral WebSockets for a/b/viewer. It publishes an older unbound generation while mutable world has a newer a→9 binding, then verifies absent old binding, correct private a→7/b→9 binding, public aim, metadata-only target replacement/removal, current-generation resync, empty-generation transport fallback and reconnect full. The deterministic tick test at line 217 creates a real body and exercises both natural arrival and expiry, requiring aim removal in delta and resync. Fanout unit tests cover both independent pressure promotions, retained state, unchanged-revision aim deltas and fail-closed invalid projection.

New full/delta hexadecimal fixtures are shared by generated Rust/JS tests. The test-only frozen generated descriptor equals the **actual baseline 9274ffe descriptor byte for byte**, verified separately. Its old decoder reads positions from new aim/self-bearing frames and treats both fields as unknown. Both original snapshot fixtures remain byte-identical. This proves old protobuf decoder compatibility; actual browser acceptance remains root-owned.

## Executed commands and results

All command evidence was recorded with own-card `task.mjs run task-067 -- ...`. `run.sh` pins Node 22.22.2/Rust 1.85 and exports private `CARGO_TARGET_DIR=.../round2-protocol-target`, `CARGO_INCREMENTAL=0`, and dev/test debug=0. The final recorded aggregate is `python3 .../round2-protocol/final-checks.py` (exit 0, 22.6 s); exact child argv, durations and full outputs are in `final-check-results.json` and `final-check-01..08.log`.

| Exact child command after run.sh | Final result |
| --- | --- |
| `cargo fmt --all -- --check` | exit 0, 0.36 s |
| `cargo clippy -p world-server --all-targets -- -D warnings` | exit 0, 3.37 s |
| `cargo test -p world-server` | exit 0, 286 passed, 17.58 s |
| `env WRITE_BINDING_AIM_FIXTURES=1 cargo test -p world-server --lib wire::snapshot::tests::binding_aim_conformance_variants -- --exact` | exit 0, 1 passed, 0.14 s; only new fixtures regenerated |
| `node scripts/generate-protocol.mjs --check` | exit 0, 0.87 s |
| `node --test packages/protocol/test/binary-conformance.test.mjs` | exit 0, 9/9 passed, 0.20 s |
| `python3 .../round2-protocol/compatibility.py` | exit 0, baseline descriptor/old fixtures verified, 0.05 s |
| `git diff --check HEAD` | exit 0, 0.01 s |

Setup `npm ci` and protocol generation passed earlier in this own worktree. Initial compile coordination failures, an expiry-fixture target that naturally arrived too soon, a broad import replacement typo, private harness quoting preparation, and clippy Copy/format warnings were corrected and recorded candidly. None counts as a behavioral mutant.

## Compiling mutations and restoration

Recorded `mutate.py` passed its rejection oracle: **23 compiling mutants**, each cargo exit 101 with `Finished test profile`, exactly one executed test, and assertion/test failure. Each mutant restored its original file before the next. `mutation-results.json` records every exact argv/duration and named full log; `mutation-restore.json` proves byte-exact restoration of fanout/transport/wire.

Mutants independently broke focus-versus-generation binding, mutable-world substitution, negotiated identity, viewer privacy, full/delta encoding, every-delta binding, current-lease projection, aim-only equality, stale aim removal, both pressure promotion routes, resync freshness, each carrier's zero-ID rejection, aim speed/bounds, lease/body correspondence, invalid projection, aim encode/decode, binding decode and inner version 1. After lint cleanup switched equivalent Copy fields to direct copies, two additional final encode/decode aim-omission mutants compiled and failed; `final-wire-mutation-results.json` proves final wire restoration. **25 behavioral reds total.** Final checks followed all restorations and final source edits.

Warm self-pass checked the scoped implementation/schema/tests against rubric, accepted ADR0011 and standards. It corrected test helper roles, redundant blank space and lint findings; no feature or authority expansion resulted.

## Exports and changed-file manifest

Root already applied preliminary packet. Apply only `round2-protocol/final-delta.patch` next: 4 named paths, including the already-new Rust test. Do not reapply the full patch over preliminary. Full canonical exports are `../round2-protocol.patch` (tracked `git diff --binary HEAD`) and `../round2-protocol-untracked.tar.gz` (all 4 named new files). `final-manifest.json` contains per-file and export SHA-256; `task-067-worker-card.md` privately exports the CLI log. Copied task/ADR are excluded from source exports.

Tracked changed files:

- `protocol/v1/aigent.proto`
- `packages/protocol/src/gen/aigent_pb.js`
- `packages/protocol/src/gen/aigent_pb.d.ts`
- `packages/protocol/test/binary-conformance.test.mjs`
- `crates/world-server/src/wire/snapshot.rs`
- `crates/world-server/src/fanout.rs`
- `crates/world-server/src/transport.rs`

New files, all archived:

- `crates/world-server/tests/snapshot_binding_behavior.rs`
- `packages/protocol/test/fixtures/snapshot-v1-before-aim.js`
- `protocol/v1/conformance/binary/world-snapshot-body-aim.hex`
- `protocol/v1/conformance/binary/world-snapshot-delta-aim.hex`

## Scope, uncertainty and remaining risks

**Reported:** Root has integrated preliminary backend and companion workers and retains actual runtime/browser acceptance, root documentation, full repository gate and independent cold SPEC/STANDARDS review. Those are not worker PASS claims.

**Inferred from the diff:** Serialization remains in existing fanout/drain stage; simulation, journal, Accepted-result and storage behavior are unchanged. Existing exact frame-size measurement receives the canonical aim/binding fields, so accounting charges their emitted bytes. The package suite includes off-tick mailbox, slow-writer and pressure regressions; no new performance guarantee is claimed.

Inherited trusted-inject authentication and unresolved durable command outcomes remain open. Binding outside the AOI still requires a client to wait for its own observed pose. Aim absence only means no active lease in this generation; it establishes no arrival/blockage/sleep/brain motivation. Rich controller and spectator acceptance belongs to the companion work. No crash-stable outcomes claim is introduced.
