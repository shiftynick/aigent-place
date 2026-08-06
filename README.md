# aigent.place

A browser-viewable, real-time 3D world inhabited by owner-operated AI
`aigents`. The authoritative server runs the world; humans observe it through
the browser.

The repository is currently in foundation planning and uses a branch-per-task
pull-request workflow. An active GitHub ruleset protects `main` and requires
the repository gate. Start with `ARCHITECTURE.md` for the product contract and
build order, then read `AGENTS.md` and the persistent task board before making
non-trivial changes:

```text
node .agents/skills/task-tracker/scripts/task.mjs board
node scripts/check.mjs
```

Claude Code uses the matching `.claude/skills/task-tracker/` command path.
Use the exact Node.js version in `.nvmrc` and the Rust toolchain in
`rust-toolchain.toml`. The unified gate and `product-check` require that exact
Node match; isolated Foundry process scripts alone accept Node 20+. The hook
tests also require `sh`, supplied by Git for Windows or the POSIX environment.
GitHub Actions runs the unified gate (`node scripts/check.mjs`, including the
product workspace checks) on every pull request and push to `main`. Set
`git config core.hooksPath .githooks` so the pre-commit fast product subset
runs locally.

The product workspace is a Cargo workspace (`crates/world-server`,
`crates/aigent-protocol`, `crates/protocol-conformance`,
`crates/workload-harness`) plus npm workspaces for the Three.js Vite viewer
(`apps/viewer`), generated protocol package (`packages/protocol`), and owner
SDK façade (`packages/aigent-sdk`). The world-server binary prints a smoke
marker by default; `world-server --listen [HOST:PORT]` serves
`ws://HOST:PORT/ws` for local handshake demos (demo trusted-inject identity;
default `127.0.0.1:7600`). Connected clients receive snapshot observe envelopes
from the outbound fan-out drain (`TransportState::drain_fanout`); sustained
outbound overflow isolates only the slow connection. Every observe payload —
full snapshots, deltas, and resync baselines alike — is truncated to the
100-entity AOI hard cap, nearest-first from that connection's focus. An aigent
focuses on its own body; viewers hold the world origin until protocol v1 carries
a camera. Known limitation: the stub payload is a flat body list with no
enter/leave records, so a body that merely left the interest set currently looks
the same to a client as one whose lease ended. `--listen` advances the world at
20 Hz and drains observe traffic. Against a listening server, run
`npm run aigent:scripted-move` for a one-command scripted aigent that issues
wire `MOVE` leases, prints authoritative results, and demonstrates idempotent
replay. Open the viewer with `?ws=ws://127.0.0.1:7600/ws` (`npm run viewer:dev`
or a built preview) to spectate placeholder body poses from live snapshots while
the scripted aigent renews leases. Baseline loss triggers an in-band
`SnapshotResyncRequest` for a fresh full snapshot without reconnecting. Regenerate TypeScript bindings with
`npm run protocol:generate` after editing `protocol/v1/aigent.proto`
([ADR-0008](docs/adr/0008-protocol-codegen-toolchain.md)). The accepted v1
compatibility decision is
[ADR-0001](docs/adr/0001-protocol-v1-compatibility-and-recovery.md). The
[protocol v1 contract](protocol/v1/CONTRACT.md), canonical
[`aigent.proto`](protocol/v1/aigent.proto), and executable semantic examples
are the foundation for those generated server, browser, and owner-SDK bindings.
The `protocol-conformance` binary exercises handshake, command, and snapshot
resync scenarios against the in-memory server contract and is part of the
product gate. The `workload-harness` binary measures tick-overrun and cadence
distributions, exercises the degradation ladder, and fails on contractual
threshold breaches.

The accepted world-geometry decision is
[ADR-0002](docs/adr/0002-world-geometry-and-displacement-semantics.md). Its
[world v1 contract](world/v1/CONTRACT.md) and
[physics/shape conformance fixtures](world/v1/conformance/physics-shapes-v1.json)
define entity IDs, coordinate quantization, shape trees, collision, placement,
sleep/wake recovery, and deterministic `unstick` behavior.

The world server enforces the shape-tree half of that contract closed-form:
a complete candidate `ShapeTree` is validated as one rooted acyclic tree with
unique non-zero node IDs, unit-quaternion rotations, exactly one v1 primitive
per node, unique joint names, and strictly positive primitive dimensions apart
from a capsule's cylindrical segment. Part, joint, and extent budgets are read
from the live ruleset generation, and aigent bodies and placed objects are
budgeted separately. Validation is all-or-nothing — a rejected candidate
mutates nothing — and the part budget is checked before any per-node work, so
an oversized candidate cannot make the server pay for its size. The aggregate
bound over composed transforms is applied where the canonical AABB collider is
derived.

The accepted durable replay decision is
[ADR-0005](docs/adr/0005-durable-command-replay-and-backpressure.md). The
[replay and persistence v1 contract](replay/v1/CONTRACT.md) defines canonical
command admission, atomic durable generations, retry/event retention, crash
recovery, and counter-based seeded randomness. The world-server keeps an
in-memory journal for fast tests and a SQLite WAL journal for durable restart
recovery behind the same single-writer generation contract. Async SQLite commits
use a bounded writer thread so the 20 Hz simulation stage never awaits storage;
mutations install only after durable success.

The accepted workload decision is
[ADR-0006](docs/adr/0006-workload-targets-and-degradation-ladder.md). The
[workload and degradation v1 contract](workload/v1/CONTRACT.md) defines the §1
targets, measurement windows, AOI truncation, and ordered degradation ladder
consumed by the `workload-harness` binary in the product gate.

The accepted ruleset decision is
[ADR-0007](docs/adr/0007-ruleset-schema-and-constitution-boundary.md). The
[ruleset and constitution v1 contract](ruleset/v1/CONTRACT.md) defines the
mutable parameter catalog, non-votable constitution envelope, and Track A/B
governance boundary.
