# ADR 0008: Protocol codegen toolchain and package layout

- **Status:** accepted
- **Date:** 2026-08-04
- **Task:** task-004

## Context and problem statement

Task-004 must compile `protocol/v1/aigent.proto` into Rust, browser, and
owner-SDK types and prove binary round-trips without hand-copied wire types.
No prior ADR named the generator stack or package layout. Operator
authorization to use judgement on open foundation questions was given on
2026-08-04 and reiterated by directing task-004 to proceed; this ADR records
the toolchain choice under that go-ahead.

## Decision drivers

- Clean CI and developer checkouts must compile without a manually installed
  system `protoc`.
- TypeScript must preserve `uint64` / `sint64` with bigint-safe representations
  (ADR-0002).
- Browser viewer and owner-SDK must share one generated protocol package.
- Generated artifacts must participate in `product-check` / `check.mjs`.
- The choice must be reversible before runtime hardens on the wire codecs.

## Considered options

1. Hand-written Rust/TS wire structs. Rejected: violates engineering standards
   and ADR-0001 ("no hand-copied wire types").
2. `prost` + `protobuf.js` / `pbjs`. Rejected: ordinary `number` coercion risks
   for 64-bit fields unless carefully wrapped; weaker shared schema story.
3. Buf + `prost` + `@bufbuild/protobuf` (`protoc-gen-es`). Selected: vendored
   `protoc` via `protoc-bin-vendored` for Rust; Buf for TypeScript generation;
   bigint-safe ES module output; one proto source of truth.
4. Pure `protoc` + `ts-proto` without Buf. Rejected: more ad-hoc plugin path
   management on Windows CI for little gain over Buf's pinned plugins.

## Decision

- **Rust:** workspace crate `crates/aigent-protocol` generated with `prost` /
  `prost-build`, invoking `protoc-bin-vendored` from `build.rs`.
- **TypeScript:** npm workspace package `@aigent-place/protocol` generated with
  `@bufbuild/protobuf` + `@bufbuild/protoc-gen-es` via `buf generate`. Generated
  sources are committed and re-checked by `scripts/generate-protocol.mjs
  --check`.
- **Owner SDK:** npm workspace package `@aigent-place/aigent-sdk` re-exports the
  generated protocol types (thin façade; no duplicate wire structs).
- **Browser:** `apps/viewer` may depend on `@aigent-place/protocol`; this task
  does not require viewer UI wiring beyond workspace resolution.
- **Durable `COMMAND_OUTCOME`:** add the protobuf schema and binary round-trip
  coverage owned by task-004; keep the replay semantic oracle on its JSON
  projection until a follow-up replaces that decoder (replay contract already
  anticipates the handoff).

## Consequences

### Good

- One proto file feeds both languages with gate-enforced freshness.
- 64-bit fields stay bigint-safe in TypeScript.
- No host `protoc` install required for Rust or Buf-driven TS generation.

### Bad

- Two generator ecosystems (Cargo build-script + Buf) to keep version-aligned.
- Committed generated TypeScript can drift if contributors edit outputs by hand;
  `--check` mitigates but does not prevent local mistakes before push.
- Full replay-oracle migration off JSON is deferred, so two projections coexist
  briefly.

## Validation

- `cargo test -p aigent-protocol` encodes/decodes shared binary fixtures,
  including malformed-byte and unknown-field cases (workspace membership via
  root `Cargo.toml` `members = ["crates/*"]`).
- Node tests in `@aigent-place/protocol` and `@aigent-place/aigent-sdk` decode
  the same fixture bytes / re-export generated schemas.
- `node scripts/generate-protocol.mjs --check` fails on stale generated TS.
- `node scripts/check.mjs` reaches those suites transitively through
  `scripts/product-check.mjs`.

## Follow-up

- Replace replay semantic JSON `payload_hex` application with the generated
  `COMMAND_OUTCOME` protobuf decoder when wiring recovery binaries.
- Optional later ADR if the project standardizes on Buf for Rust as well.
