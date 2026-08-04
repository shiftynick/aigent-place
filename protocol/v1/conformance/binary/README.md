# Binary protobuf fixtures

Shared hex payloads for cross-target encode/decode checks. Each file is a
single protobuf message body (not an AIGR frame) encoded as lowercase hex.

| File | Message |
| --- | --- |
| `envelope-protocol-error.hex` | `Envelope` with `protocol_error` |
| `handshake-reject.hex` | `HandshakeFrame` with `handshake_reject` |
| `command-outcome.hex` | `CommandOutcome` durable payload |

Regenerate from the Rust samples with:

```text
cargo run -p aigent-protocol --example write_fixtures
```

Rust tests in `crates/aigent-protocol` and TypeScript tests in
`packages/protocol/test` must both accept these bytes.
