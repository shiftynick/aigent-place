# Task069 focused validation

Both isolated patches were integrated on the task branch with named paths and
an untouched index. The server packet contains ten Rust files; the SDK packet
contains five JavaScript files. Protocol, viewer and movement-kernel files are
unchanged. Accepted ADR0013 and the task log record the decisions before bodies.

Root executed these checks on the integrated source:

| Check | Result | Wall time |
| --- | --- | --- |
| `cargo test --package world-server --lib demo_plaza_tests` | nine pass, exit0 | 37.971s |
| `cargo test --package world-server --test demo_plaza_behavior` | five pass, exit0 | 4.990s |
| `cargo build --package world-server` | exit0 | 0.091s |
| Node test runner, all eight SDK test modules | 69 pass, exit0 | 27.144s |

Commands used pinned Node22.22.2 and the repository Rust toolchain. Exact argv,
UTC times, failures and source hashes are retained in the task log and private
receipts. Worker supplemental checks report 321 world-server tests, formatting
and clippy passing. These are distinct from the root focused checks.

Root verified all 22 Rust mutation cases compiled and executed one test that
failed an assertion. All 39 JavaScript cases passed syntax checking, failed with
`ERR_ASSERTION`, and restored the exact original source hash. A separate warm
record audit verified all133 server artifact sizes/hashes, every mutation log
and restoration, both integration source arrays, and the final SDK archive.
Earlier compile, fixture and non-assertion attempts remain historical and do
not count as these behavioral reds. Raw records remain outside Git.

The geometry tests cover both demo shapes, movement in both directions and
dense inset sweeps. They do not prove live coupled policy behavior. That requires
the registered three fresh live pairs and independent decoded observations.
Current-peer avoidance does not predict future movement; general unleased-body
collision and lifecycle work remains separate. These checks do not claim a
complete cold review, full repository gate or protected delivery.

Frozen server patch SHA256:
`669453d5a6f29d558c5cfdc1a508775fefe31671798d9b1332e178241a357c3e`.
Frozen SDK patch SHA256:
`23a66869e1109907e788901041153873cc1ba9a14d27d3ef98be791c7ded7fe5`.
Warm record-audit summary SHA256:
`710cbd682a0a6b3e81999be1187f44a0b39ecf3e6ce5525b8218adca2f025a89`.
