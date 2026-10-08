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
default `127.0.0.1:7600`). The listen path opens a durable SQLite WAL journal
(default `world-journal.sqlite` in the process working directory; override with
`--journal PATH`), recovers the world before accepting connections, and fails
closed on corrupt or gapped committed history. Connected clients receive snapshot observe envelopes
from the outbound fan-out drain (`TransportState::drain_fanout`); sustained
outbound overflow isolates only the slow connection. Every observe payload —
full snapshots, deltas, and resync baselines alike — is truncated to the
100-entity AOI hard cap, nearest-first from that connection's focus. An aigent
focuses on its own body; viewers hold the world origin until protocol v1 carries
a camera. Full snapshots carry authoritative entity IDs, revisions,
millimetre positions, and shape trees; deltas carry explicit enter, modify,
and leave records against a numbered baseline. Slow connections replace
superseded state with a complete full snapshot and preserve ordered results.
`--listen` advances the world at
20 Hz and drains observe traffic. For the bounded local movement demo, start a
new server with a fresh journal path (for example,
`cargo run -p world-server -- --listen --journal /tmp/aigent-demo-fresh.sqlite`;
choose an unused path for each run). Use the Node.js version in `.nvmrc`.
Open the viewer with `?ws=ws://127.0.0.1:7600/ws` (`npm run viewer:dev`
or a built preview), then run `npm run aigent:scripted-move`.
The script requires a fresh world with only one aigent. It follows the sole
observed body; protocol v1 does not supply a general self-body identity binding.
It sends a generated typed `MOVE` toward x=1.5m, z=0 at 0.5m/s on the fresh
default-terrain first-spawn route, checks accepted command results and an
idempotent replay, and renews once after 150 ms. It reports `SUCCESS`
only after snapshots show at least 1m of horizontal displacement with changed
poses spanning at least 2s. Acceptance alone does not mean arrival. It reports
`FAILURE` for rejection, connection failure, or an 8s deadline, and closes its
socket on every outcome. The viewer shows authoritative body poses with
placeholder geometry. It frames the first observed bodies automatically;
drag to orbit, right-drag to pan, scroll to zoom, and use **Reset view** to
frame the current bodies again. These controls change only the local camera.
The labelled 1 m reference grid follows the fitted body height and is not
authoritative terrain. Set `AIGENT_WS_URL` to use another listen URL and
`AIGENT_ID` to change the demo identity. Reusing a journal can leave a body
already at the target; start fresh for each demonstration. The viewer
reconnects after 65,536 accepted
envelopes to bound session validation memory; it installs a new full baseline.
Baseline loss triggers an in-band
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
product gate. The `workload-harness` binary checks a 1,200-tick in-process simulation window,
plus an eight-tick real fan-out slice for 500 viewers and 300 aigents. A
160-tick slow-viewer probe checks coalescing and exact encoded-byte accounting.
The degradation ladder and sustained-overflow isolation are gate checks. These
bounded probes do not measure full-window host or socket throughput.

The accepted world-geometry decision is
[ADR-0002](docs/adr/0002-world-geometry-and-displacement-semantics.md). Its
[world v1 contract](world/v1/CONTRACT.md) and
[physics/shape conformance fixtures](world/v1/conformance/physics-shapes-v1.json)
define entity IDs, coordinate quantization, shape trees, collision, placement,
sleep/wake recovery, and deterministic `unstick` behavior.

The world server implements the shape-tree half of that contract closed-form
in `world_server::validate_shape_tree`: a complete candidate `ShapeTree` is
checked as one rooted acyclic tree with unique non-zero node IDs,
unit-quaternion rotations, exactly one v1 primitive per node, unique joint
names, and strictly positive primitive dimensions apart from a capsule's
cylindrical segment. Part, joint, and per-primitive extent budgets are read
from the live ruleset generation, and aigent bodies and placed objects are
budgeted separately. Validation is all-or-nothing — a rejected candidate
mutates nothing — and the part budget is checked before any per-node work, so
an oversized candidate cannot make the server pay for its size. Two pieces of
section 4.2 are still outstanding: no command path calls the validator yet, so
nothing is rejected on a live request until `set_shape` and `place_object`
land, and the aggregate bound over composed transforms needs the canonical AABB
collider, which is not yet derived.

The accepted durable replay decision is
[ADR-0005](docs/adr/0005-durable-command-replay-and-backpressure.md). The
[replay and persistence v1 contract](replay/v1/CONTRACT.md) defines canonical
command admission, atomic durable generations, retry/event retention, crash
recovery, and counter-based seeded randomness. The world-server keeps an
in-memory journal for fast tests and uses an async SQLite WAL journal for the
live `--listen` path (and durable restart recovery tests) behind the same
single-writer generation contract. Async SQLite commits
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
