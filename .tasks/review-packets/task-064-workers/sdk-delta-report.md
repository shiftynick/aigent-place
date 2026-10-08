SDK follow-up delta — task-064

Apply only round1-sdk-delta.patch to the already imported original SDK freeze.
SHA256: 88a7f3baf3c1bc5ef1af197c9b4b48ff05ab17ae641632846979e60786a9ef0b
Changed files: packages/aigent-sdk/scripts/scripted-move.mjs (two comments); packages/aigent-sdk/test/scripted-move.test.mjs (fixture fields).
No README, production behavior, public SDK API, protocol schema, dependency or enforcement change.

Assessment: protocol/v1/CONTRACT.md lines221-223 requires exact32-byte generation_digest, so omission was invalid. Lines45-52 require command-capable mode with a non-empty opaque session epoch; omitting mode produced UNSPECIFIED and was invalid. An empty selectedFeatures is correct when no features were offered. Lines230-233 explicitly allow an absent ShapeTree; omission was valid. Existing non-empty opaque connection/session IDs and non-zero entity/revision IDs were valid.

Correction: full/delta fixture payloads now have a32-byte SHA256 digest derived from fixture x/revision state. ServerHello explicitly supplies COMMAND_CAPABLE and selectedFeatures=[]. Records now include a generated ShapeTree matching the listen demo's valid root box:1000x1800x1000mm, zero translation, unit identity quaternion and RGBA. No additional SDK protocol validation was introduced. Route comment now describes the measured fresh default first-spawn route without a general obstacle guarantee. Default lease TTL is10s; the single150ms renewal covers the8s bounded tracer.

Final validation through own copied task CLI:
- npm run test -w @aigent-place/aigent-sdk: exit0,8/8,27.3s
- node --check packages/aigent-sdk/scripts/scripted-move.mjs: exit0
- git diff --check: exit0
All eight prior semantic mutation reds repeated with the conformant fixture: each syntax check exit0 and actual-entry behavioral test exit1; mutations restored before final checks. Results: round1-sdk-delta-mutations.json; detailed per-mutation logs: round1-sdk-red-*.log. Full copied task CLI record: round1-sdk-delta-task064-log.md.

Root still owns fresh rebuilt-server/Chromium integration, full gate, cold reviews and task completion. No worker runtime process remains; baseline services were not touched.
