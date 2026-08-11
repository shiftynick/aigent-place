---
id: task-062
title: "Upgrade Agent Foundry 0.30.1 -> 0.30.3"
status: done
priority: p1
tags: [area:process, phase:upgrade]
blockedBy: []
createdAt: "2026-08-11T21:41:16Z"
updatedAt: "2026-08-11T21:52:35Z"
---

<!-- task-tracker:description -->
## Description



<!-- task-tracker:log -->
## Log

- 2026-08-11T21:41:16Z — created (status: backlog)
- 2026-08-11T21:41:22Z — moved to in_progress (claimed by shift@Shiftor)
- 2026-08-11T21:41:22Z — note: rubric: (1) every upgrade action from every intervening release applied or explicitly justified as a no-op; (2) every seed file restored and re-merged, none left as template; (3) every mold divergence from the step-1 report re-applied, retired, or recorded in LOCAL-CHANGES.md, file by file; (4) each retirement verified against the installed file rather than trusted from the changelog; (5) post-upgrade drift is fully explainable line by line; (6) run-checks passes
- 2026-08-11T21:41:22Z — note: from 0.30.1; source N:\agent-foundry 0.30.3; default branch main, clean, tracking origin/main. Unsent upstream: none (LOCAL-CHANGES has no live mold entries).
- 2026-08-11T21:41:22Z — run: node .agent-foundry/check-foundry-drift.mjs
  started 2026-08-11T21:41:22Z, exit 0 in 0.1s
  output:
  | foundry-drift: installed from Agent Foundry 0.30.1 on 2026-08-10T21:54:59.845Z
  |
  | Locally modified (seed) (6)
  |   Expected: the project owns these. An upgrade must not overwrite them.
  |   - AGENTS.md
  |   - CONTRIBUTING.md
  |   - HANDOFF.md
  |   - docs/ENGINEERING-STANDARDS.md
  |   - docs/REVIEW-STANDARDS.md
  |   - docs/adr/README.md
  |
  | 114 unchanged, 6 diverged. Record intentional divergence in .agent-foundry/LOCAL-CHANGES.md
  | so the next upgrade does not silently revert it.
- 2026-08-11T21:42:24Z — note: install: --force from N:\agent-foundry; backup N:\aigent-place\.agent-foundry-backups\20260811T214128253Z. seeds: restore-from-head restored 8; stock-to-stock 0.30.1->0.30.3 changed no seed templates. mold: pre-upgrade drift had zero mold files. Upgrade actions 0.30.2+0.30.3 are mold replacements applied by --force.
- 2026-08-11T21:42:56Z — run: node .agent-foundry/run-checks.mjs
  started 2026-08-11T21:42:24Z, exit 0 in 32.2s
  output tail (truncated to last 30 lines):
  | ▶ task edit
  |   ✔ changes title and priority and logs the diff (257.0327ms)
  |   ✔ adds and removes tags (185.9098ms)
  |   ✔ rejects cyclic --add-blocked-by (exit 2) (357.3217ms)
  |   ✔ rejects nonexistent and deleted blockers (470.8403ms)
  |   ✔ allows adding a live blocker when an existing blocker was deleted (638.3009ms)
  |   ✔ does not allow editing the reserved tombstone tag (274.961ms)
  | ✔ task edit (2184.6745ms)
  | ▶ task rm
  |   ✔ soft-deletes by setting status=done and adding deleted:true tag (294.6158ms)
  |   ✔ keeps dependents blocked when their blocker is soft-deleted (833.287ms)
  | ✔ task rm (1128.0586ms)
  | ▶ task help
  |   ✔ prints usage and exits 0 for help (43.7026ms)
  |   ✔ prints usage and exits 0 for --help (44.62ms)
  |   ✔ prints usage and exits 0 for -h (48.6468ms)
  |   ✔ prints usage and exits 0 with no arguments (48.681ms)
  |   ✔ points at a reference file that exists in this tree (0.2687ms)
  |   ✔ still rejects an unknown verb with exit 2 (46.0061ms)
  | ✔ task help (232.3567ms)
  | ℹ tests 419
  | ℹ suites 72
  | ℹ pass 419
  | ℹ fail 0
  | ℹ cancelled 0
  | ℹ skipped 0
  | ℹ todo 0
  | ℹ duration_ms 31983.1458
  |
  | run-checks: PASS (skill-sync + 18 suites)
- 2026-08-11T21:43:04Z — run: node .agent-foundry/check-foundry-drift.mjs
  started 2026-08-11T21:43:04Z, exit 0 in 0.1s
  output:
  | foundry-drift: installed from Agent Foundry 0.30.3 on 2026-08-11T21:41:28.253Z
  |
  | Locally modified (seed) (6)
  |   Expected: the project owns these. An upgrade must not overwrite them.
  |   - AGENTS.md
  |   - CONTRIBUTING.md
  |   - HANDOFF.md
  |   - docs/ENGINEERING-STANDARDS.md
  |   - docs/REVIEW-STANDARDS.md
  |   - docs/adr/README.md
  |
  | 114 unchanged, 6 diverged. Record intentional divergence in .agent-foundry/LOCAL-CHANGES.md
  | so the next upgrade does not silently revert it.
- 2026-08-11T21:49:43Z — run: C:\Users\shift\AppData\Local\nvm\v22.22.2\node.exe scripts/check.mjs
  started 2026-08-11T21:48:59Z, exit 0 in 44.0s
  output tail (truncated to last 30 lines):
  |      Running tests\ruleset_persist_behavior.rs (target\debug\deps\ruleset_persist_behavior-20763967ad007f17.exe)
  |      Running tests\scripted_aigent_behavior.rs (target\debug\deps\scripted_aigent_behavior-868f771fe2f3b29c.exe)
  |      Running tests\session_behavior.rs (target\debug\deps\session_behavior-5b3200c9a1bae821.exe)
  |      Running tests\shape_budget_catalog_contract.rs (target\debug\deps\shape_budget_catalog_contract-a0488f49834a77ed.exe)
  |      Running tests\shape_validation_behavior.rs (target\debug\deps\shape_validation_behavior-887d963556dfabd7.exe)
  |      Running tests\shape_validation_bounded_cost.rs (target\debug\deps\shape_validation_bounded_cost-f5eb5f21bc801b3b.exe)
  |      Running tests\snapshot_behavior.rs (target\debug\deps\snapshot_behavior-38ee57e411957cb0.exe)
  |      Running tests\snapshot_resync_behavior.rs (target\debug\deps\snapshot_resync_behavior-9021b8921bdbaa8b.exe)
  |      Running tests\transport_behavior.rs (target\debug\deps\transport_behavior-514083eccfaa7205.exe)
  |    Doc-tests aigent_protocol
  |    Doc-tests protocol_conformance
  |    Doc-tests workload_harness
  |    Doc-tests world_server
  | npm notice run @aigent-place/protocol@0.1.0 test
  | npm notice run node --test ./test/binary-conformance.test.mjs
  | npm notice run @aigent-place/aigent-sdk@0.1.0 test
  | npm notice run node --test ./test/sdk-exports.test.mjs
  | npm notice run aigent-place@0.1.0 viewer:build
  | npm notice run npm run build -w @aigent-place/viewer
  | npm notice run @aigent-place/viewer@0.1.0 build
  | npm notice run vite build
  |
  | (!) Some chunks are larger than 500 kB after minification. Consider:
  | - Using dynamic import() to code-split the application
  | - Use build.rollupOptions.output.manualChunks to improve chunking: https://rollupjs.org/configuration-options/#output-manualchunks
  | - Adjust chunk size limit for this warning via build.chunkSizeWarningLimit.
  | npm notice run aigent-place@0.1.0 viewer:smoke
  | npm notice run npm run smoke -w @aigent-place/viewer
  | npm notice run @aigent-place/viewer@0.1.0 smoke
  | npm notice run node ./scripts/smoke.mjs
- 2026-08-11T21:51:37Z — note: warm self-pass: diff is version/manifest + 0.30.2/0.30.3 molds only. Dual trees mirrored. Zero mold re-apply. Seeds absent from diff (restored). No [CUSTOMIZE] markers. Project gate recorded under Node 22.22.2 (.nvmrc); Cursor Node 24 fails the nvmrc assert and is not the project runtime.
- 2026-08-11T21:51:37Z — moved to review
- 2026-08-11T21:52:27Z — run: node .agent-foundry/cold-review.mjs --provider codex --packet .tasks/review-packets/task-062-r1 --cwd . --model gpt-5.6-sol
  started 2026-08-11T21:51:47Z, exit 0 in 40.0s
  output tail (truncated to last 30 lines):
  |                 "cached_input_tokens": 9984,
  |                 "cache_write_input_tokens": 0,
  |                 "output_tokens": 1902,
  |                 "reasoning_output_tokens": 1661
  |               }
  |             }
  |           }
  |         ],
  |         "exitCode": 0,
  |         "sessionId": "019ff2cf-6dec-75b2-a2ed-3b8872de1897",
  |         "modelRequested": "gpt-5.6-sol",
  |         "usage": {
  |           "inputTokens": 31544,
  |           "cachedInputTokens": 9984,
  |           "outputTokens": 1902,
  |           "reasoningOutputTokens": 1661
  |         },
  |         "warnings": [],
  |         "workspace": {
  |           "cwd": "N:\\aigent-place",
  |           "access": "answer-only"
  |         },
  |         "stderr": "",
  |         "durationMs": 39878
  |       },
  |       "finalText": "PASS\n\nCHECKED\n\n- Upgrade actions: matched 0.30.2 and 0.30.3 actions to installed, byte-identical mold files.\n- Seeds and drift: verified HEAD restoration, unchanged seed templates, zero pre/post-upgrade mold divergence, and explainable six-file seed drift.\n- Retirement verification: confirmed no retirements were required from the live pre-upgrade drift report.\n- Behavioral validation: confirmed new review-packet behavior has executed tests; 419/419 Foundry checks passed.\n- Documentation: checked modified commands, paths, round behavior, and stated limitations against the implementation and tests.\n- Security and scope: confirmed explicit local source and target, authorized task branch, backup creation, and no credential or external-write changes.\n- Version control: changes are task-scoped, mirrored skill files remain synchronized, and no hooks, checks, history, or unrelated files were bypassed.\n- Project invariants: no architecture, protocol, persistence, simulation, viewer, dependency, toolchain, or lockfile contracts changed.\n- Repository gate: verified `node scripts/check.mjs` passed under the pinned Node 22.22.2 environment."
  |     }
  |   },
  |   "incomplete": []
  | }
- 2026-08-11T21:52:35Z — note: r1 rung 1: Codex gpt-5.6-sol via cold-review.mjs. SPEC PASS. STANDARDS PASS. No findings.
- 2026-08-11T21:52:35Z — moved to done
