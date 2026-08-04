---
id: task-004
title: Generate protocol types and conformance fixtures
status: done
priority: p0
tags: [area:protocol, milestone:foundations]
blockedBy: [task-002, task-003, task-014]
createdAt: "2026-07-29T12:45:23Z"
updatedAt: "2026-08-04T17:39:41Z"
---

<!-- task-tracker:description -->
## Description

Generate Rust, browser, and owner-SDK types from the versioned protocol contract and publish shared conformance fixtures. Acceptance: envelope versions and compatibility failures round-trip across generated targets, malformed and unsupported messages fail deterministically, and hand-copied wire types are absent.

<!-- task-tracker:log -->
## Log

- 2026-07-29T12:45:23Z — created (status: backlog)
- 2026-07-29T13:07:05Z — edited (+blockedBy task-014)
- 2026-08-04T17:26:51Z — note: rubric: (1) Rust crate + TS packages generate from protocol/v1/aigent.proto with no hand-copied wire types (2) binary fixtures prove Envelope/Handshake round-trip Rust<->TS with bigint-safe uint64/sint64 (3) malformed bytes and unsupported/unknown cases fail deterministically (4) product gate builds/tests generated crates/packages (5) owner-SDK package exports generated protocol types
- 2026-08-04T17:26:51Z — note: judgement: prost+protoc-bin-vendored for Rust; @bufbuild/protobuf (protobuf-es) for TS/browser/SDK; packages/protocol + packages/aigent-sdk; crates/aigent-protocol; commit generated TS, verify in gate; COMMAND_OUTCOME schema included as task-004-owned per replay contract if sized for this PR else follow-up filed; ADR-0008 proposed for codegen stack
- 2026-08-04T17:26:51Z — moved to in_progress (claimed by shift@Shiftor)
- 2026-08-04T17:34:55Z — note: chose ADR-0008: prost+protoc-bin-vendored; buf+protoc-gen-es; packages/protocol + aigent-sdk façade; committed JS+DTS gen; COMMAND_OUTCOME schema+binary fixture now; replay JSON projection decoder deferred to follow-up
- 2026-08-04T17:35:15Z — moved to review
- 2026-08-04T17:36:08Z — run: node scripts/check.mjs
  started 2026-08-04T17:35:32Z, exit 1 in 36.3s
  output tail (truncated to last 30 lines):
  | +        hex::encode(envelope.encode_to_vec()),
  | +    )
  | +    .unwrap();
  | +    fs::write(
  | +        out.join("handshake-reject.hex"),
  | +        hex::encode(handshake.encode_to_vec()),
  | +    )
  | +    .unwrap();
  | +    fs::write(
  | +        out.join("command-outcome.hex"),
  | +        hex::encode(outcome.encode_to_vec()),
  | +    )
  | +    .unwrap();
  |      println!("wrote fixtures to {}", out.display());
  |  }
  |
  | Diff in \\?\N:\aigent-place\crates\aigent-protocol\src\lib.rs:76:
  |                  payload_mode: 1,
  |                  canonical_payload: b"{\"value\":4}".to_vec(),
  |              }),
  | -            digest: hex::decode(
  | -                "22e4bcda0cc31c4e93636633f291fa68135e4ed41ed48794f9a03bd4be27f87c",
  | -            )
  | -            .unwrap(),
  | +            digest: hex::decode("22e4bcda0cc31c4e93636633f291fa68135e4ed41ed48794f9a03bd4be27f87c")
  | +                .unwrap(),
  |              result: Some(DurableCommandResult {
  |                  outcome: Some(durable_command_result::Outcome::Accepted(CommandAccepted {
  |                      affected_entities: vec![],
  | product-check: FAIL (cargo fmt --all -- --check)
- 2026-08-04T17:37:15Z — run: node scripts/check.mjs
  started 2026-08-04T17:36:29Z, exit 0 in 45.9s
  output tail (truncated to last 30 lines):
  | dist/assets/index-Bz14P-qO.css    0.40 kB │ gzip:   0.29 kB
  | dist/assets/index-C7wmcl1-.js   470.97 kB │ gzip: 118.45 kB │ map: 2,654.73 kB
  | ✓ built in 1.17s
  |
  | > aigent-place@0.1.0 viewer:smoke
  | > npm run smoke -w @aigent-place/viewer
  |
  |
  | > @aigent-place/viewer@0.1.0 smoke
  | > node ./scripts/smoke.mjs
  |
  | viewer: smoke ok
  | product-check: PASS
  |     Checking aigent-protocol v0.1.0 (N:\aigent-place\crates\aigent-protocol)
  |     Finished `dev` profile [unoptimized + debuginfo] target(s) in 1.08s
  |     Finished `test` profile [unoptimized + debuginfo] target(s) in 0.12s
  |      Running unittests src\lib.rs (target\debug\deps\aigent_protocol-7322e4ed8557c9aa.exe)
  |      Running unittests src\main.rs (target\debug\deps\world_server-cb84350f17519398.exe)
  |    Doc-tests aigent_protocol
  | ▲ [WARNING] Duplicate key "devDependencies" in object literal [duplicate-object-key]
  |
  |     ../../package.json:25:2:
  |       25 │   "devDependencies": {
  |          ╵   ~~~~~~~~~~~~~~~~~
  |
  |   The original key "devDependencies" is here:
  |
  |     ../../package.json:18:2:
  |       18 │   "devDependencies": {
  |          ╵   ~~~~~~~~~~~~~~~~~
- 2026-08-04T17:38:54Z — note: cold-review rung1: Codex SPEC PASS; Claude STANDARDS findings fixed: duplicate package.json key, DurablePayloadMode enum, SDK package test in gate, ADR validation wording. Packet-missing-tests finding was incomplete packet not code defect. crates/* membership confirmed.
- 2026-08-04T17:39:32Z — run: node scripts/check.mjs
  started 2026-08-04T17:38:54Z, exit 0 in 38.5s
  output tail (truncated to last 30 lines):
  |
  |
  | > @aigent-place/viewer@0.1.0 build
  | > vite build
  |
  | vite v7.3.6 building client environment for production...
  | transforming...
  | ✓ 6 modules transformed.
  | rendering chunks...
  | computing gzip size...
  | dist/index.html                   0.54 kB │ gzip:   0.33 kB
  | dist/assets/index-Bz14P-qO.css    0.40 kB │ gzip:   0.29 kB
  | dist/assets/index-C7wmcl1-.js   470.97 kB │ gzip: 118.45 kB │ map: 2,654.73 kB
  | ✓ built in 1.05s
  |
  | > aigent-place@0.1.0 viewer:smoke
  | > npm run smoke -w @aigent-place/viewer
  |
  |
  | > @aigent-place/viewer@0.1.0 smoke
  | > node ./scripts/smoke.mjs
  |
  | viewer: smoke ok
  | product-check: PASS
  |    Compiling aigent-protocol v0.1.0 (N:\aigent-place\crates\aigent-protocol)
  |     Finished `dev` profile [unoptimized + debuginfo] target(s) in 0.93s
  |     Finished `test` profile [unoptimized + debuginfo] target(s) in 0.12s
  |      Running unittests src\lib.rs (target\debug\deps\aigent_protocol-7322e4ed8557c9aa.exe)
  |      Running unittests src\main.rs (target\debug\deps\world_server-cb84350f17519398.exe)
  |    Doc-tests aigent_protocol
- 2026-08-04T17:39:41Z — moved to done
