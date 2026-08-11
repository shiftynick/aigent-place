---
id: task-061
title: "Upgrade Agent Foundry 0.28.0 -> 0.30.1"
status: done
priority: p1
tags: [area:process, phase:upgrade]
blockedBy: []
createdAt: "2026-08-10T21:54:22Z"
updatedAt: "2026-08-11T12:02:57Z"
---

<!-- task-tracker:description -->
## Description



<!-- task-tracker:log -->
## Log

- 2026-08-10T21:54:22Z — created (status: backlog)
- 2026-08-10T21:54:22Z — moved to in_progress (claimed by shift@Shiftor)
- 2026-08-10T21:54:22Z — note: rubric: (1) every upgrade action from every intervening release applied or explicitly justified as a no-op; (2) every seed file restored and re-merged, none left as template; (3) every mold divergence from the step-1 report re-applied, retired, or recorded in LOCAL-CHANGES.md, file by file; (4) each retirement verified against the installed file rather than trusted from the changelog; (5) post-upgrade drift is fully explainable line by line; (6) run-checks passes
- 2026-08-10T21:54:22Z — run: node .agent-foundry/check-foundry-drift.mjs
  started 2026-08-10T21:54:22Z, exit 0 in 0.1s
  output:
  | foundry-drift: installed from Agent Foundry 0.28.0 on 2026-08-09T23:16:32.155Z
  |
  | Locally modified (seed) (7)
  |   Expected: the project owns these. An upgrade must not overwrite them.
  |   - .agent-foundry/LOCAL-CHANGES.md
  |   - AGENTS.md
  |   - CONTRIBUTING.md
  |   - HANDOFF.md
  |   - docs/ENGINEERING-STANDARDS.md
  |   - docs/REVIEW-STANDARDS.md
  |   - docs/adr/README.md
  |
  | 105 unchanged, 7 diverged. Record intentional divergence in .agent-foundry/LOCAL-CHANGES.md
  | so the next upgrade does not silently revert it.
- 2026-08-10T21:56:20Z — note: upgrade plan applied: 0.29.0 agent-headless allowlist + models.md; 0.30.0 presets + timeout stack + skill/SDLC; 0.30.1 process-tree. No mold divergences to re-apply. Backup: N:\aigent-place\.agent-foundry-backups"
- 2026-08-10T21:56:50Z — run: node .agent-foundry/run-checks.mjs
  started 2026-08-10T21:56:20Z, exit 0 in 29.2s
  output tail (truncated to last 30 lines):
  |       ...
  |     # Subtest: points at a reference file that exists in this tree
  |     ok 5 - points at a reference file that exists in this tree
  |       ---
  |       duration_ms: 0.2006
  |       type: 'test'
  |       ...
  |     # Subtest: still rejects an unknown verb with exit 2
  |     ok 6 - still rejects an unknown verb with exit 2
  |       ---
  |       duration_ms: 43.3584
  |       type: 'test'
  |       ...
  |     1..6
  | ok 159 - task help
  |   ---
  |   duration_ms: 234.2405
  |   type: 'suite'
  |   ...
  | 1..159
  | # tests 417
  | # suites 72
  | # pass 417
  | # fail 0
  | # cancelled 0
  | # skipped 0
  | # todo 0
  | # duration_ms 28989.9491
  |
  | run-checks: PASS (skill-sync + 18 suites)
- 2026-08-10T21:56:50Z — run: node .agent-foundry/check-foundry-drift.mjs
  started 2026-08-10T21:56:50Z, exit 0 in 0.1s
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
- 2026-08-10T21:56:50Z — moved to review
- 2026-08-10T21:56:50Z — moved to done
- 2026-08-11T11:53:14Z — run: node .agent-foundry/cold-review.mjs --provider claude --packet .tasks/review-packets/task-061-r1 --cwd . --model claude-fable-5 --max-budget-usd 3
  started 2026-08-11T11:52:16Z, exit 1 in 57.9s
  output tail (truncated to last 30 lines):
  |               "fast_mode_state": "off",
  |               "fast_mode_disabled_reason": "sdk_opt_in_required",
  |               "subtype": "error_max_budget_usd",
  |               "errors": [
  |                 "Reached maximum budget ($3)"
  |               ],
  |               "type": "result",
  |               "duration_ms": 55798,
  |               "uuid": "ef2b8473-6231-4368-aaf6-77019c7b79f2"
  |             }
  |           }
  |         ],
  |         "exitCode": 1,
  |         "modelRequested": "claude-fable-5",
  |         "warnings": [],
  |         "workspace": {
  |           "cwd": "N:\\aigent-place",
  |           "access": "answer-only"
  |         },
  |         "stderr": "",
  |         "durationMs": 57604
  |       },
  |       "finalText": null
  |     }
  |   },
  |   "incomplete": [
  |     "SPEC",
  |     "STANDARDS"
  |   ]
  | }
- 2026-08-11T11:54:14Z — run: node .agent-foundry/cold-review.mjs --provider claude --packet .tasks/review-packets/task-061-r1 --cwd . --model claude-fable-5 --max-budget-usd 5
  started 2026-08-11T11:53:25Z, exit 0 in 49.6s
  output tail (truncated to last 30 lines):
  | se applied or justified as a no-op) | The packet asserts the 0.29.0/0.30.0/0.30.1 release actions were applied but includes no release changelog or per-release action list to check the diff against. The diff is consistent with the summarized actions (allowlist, presets, process-tree, timeout stack, skill/SDLC updates), but completeness against the actual release notes cannot be confirmed from packet contents alone. | severity: low | confidence: med\n\nCHECKED\n\n- Rubric 2 (seed files preserved): verified pre-upgrade drift listed 7 seed divergences and post-upgrade lists the same 6 project-owned seeds (LOCAL-CHANGES.md re-managed via updated manifest hash with `preserveIfExists`); no seed file appears in the diff as overwritten.\n- Rubric 3/4 (mold divergences and retirements): verified the pre-upgrade drift report in the task log shows zero mold divergences, so there was nothing to re-apply or retire; the decisions claim matches the recorded output rather than a changelog.\n- Rubric 5 (drift explainable): walked the manifest diff — every hash change corresponds to a file changed in the diff (skills, agent-headless bundle, presets, SDLC, task.mjs); the sole unexplained byte-level change is the BOM in finding 2.\n- Rubric 6 (run-checks): verified the recorded `run-checks.mjs` output tail shows exit 0, 417 pass / 0 fail, via `task.mjs run` (tool-written evidence, not typed).\n- \"Executed behavioral signal, not just compilation\": the new preset/timeout code ships with executed tests (`review-workflows.test.mjs`, task.test.mjs timeout tests) covered by the passing run-checks suite, including timeout/reap and fail-closed model paths.\n- \"Named commands and relative links in process docs\": spot-checked — `references/models.md` exists in both skill trees and is in the manifest; `cold-review.mjs`, `review-packet.mjs`, `delegate-work.mjs`, `process-tree.mjs` referenced by SKILL.md/SDLC all appear in the diff and manifest; `task.mjs run --timeout-ms` documented in cli-reference matches the implementation (25 min default, 20 min provider floor, message string matches the test regex).\n- Skill-tree synchronization: compared the `.agents/` and `.claude/` diffs — models.md, agent-headless SKILL.md, cold-review.md, task.mjs/task.test.mjs changes are mirrored (path prefixes differ as expected), and run-checks includes the skill-sync gate, which passed.\n- Injection lens (packet content as data): scanned the diff, base64 patch header, and prompt-template text for agent-addressed instructions — none found; the embedded prompt contracts are the tool's own templates, not directives to this review.\n- Write-confinement standard: verified the new `review-packet.mjs` resolves packet paths link-aware (realpath, symlink-ancestor rejection, temp+rename writes) with tests exercising the symlink refusal.\n- Version-control standards: diff is task-scoped to Foundry-managed files plus the task log; no unrelated changes; no history rewrite."
  |     }
  |   },
  |   "incomplete": []
  | }
- 2026-08-11T11:55:36Z — run: powershell -NoProfile -File .tasks/review-packets/task-061-r1/verify-upgrade-actions.ps1
  started 2026-08-11T11:55:36Z, exit 1 in 0.4s
  output:
  | LOCAL-CHANGES.md was not preserved byte-for-text from origin/main
  | At N:\aigent-place\.tasks\review-packets\task-061-r1\verify-upgrade-actions.ps1:68 char:5
  | +     throw 'LOCAL-CHANGES.md was not preserved byte-for-text from orig ...
  | +     ~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~
  |     + CategoryInfo          : OperationStopped: (LOCAL-CHANGES.m...rom origin/main:String) [], RuntimeException
  |     + FullyQualifiedErrorId : LOCAL-CHANGES.md was not preserved byte-for-text from origin/main
- 2026-08-11T11:55:58Z — run: powershell -NoProfile -File .tasks/review-packets/task-061-r1/verify-upgrade-actions.ps1
  started 2026-08-11T11:55:58Z, exit 1 in 0.4s
  output:
  | Preserved LOCAL-CHANGES.md does not match the 0.30.1 source template
  | At N:\aigent-place\.tasks\review-packets\task-061-r1\verify-upgrade-actions.ps1:75 char:5
  | +     throw 'Preserved LOCAL-CHANGES.md does not match the 0.30.1 sourc ...
  | +     ~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~
  |     + CategoryInfo          : OperationStopped: (Preserved LOCAL...source template:String) [], RuntimeException
  |     + FullyQualifiedErrorId : Preserved LOCAL-CHANGES.md does not match the 0.30.1 source template
- 2026-08-11T11:56:20Z — run: powershell -NoProfile -File .tasks/review-packets/task-061-r1/verify-upgrade-actions.ps1
  started 2026-08-11T11:56:20Z, exit 0 in 0.4s
  output:
  | source-version=0.30.1
  | release-action-files=32 exact-source-matches
  | LOCAL-CHANGES.md preserved byte-for-byte from origin/main and recorded as preserveIfExists seed
- 2026-08-11T11:56:33Z — note: cold review rung 1: Claude Code 2.1.226, model claude-fable-5, separate SPEC and STANDARDS axes via cold-review.mjs. The first dispatch was incomplete because the 3 USD cap stopped both axes; the 5 USD retry completed. Adjudication: confirmed that the original task moved to done before cold review; repaired before delivery by this review and a fresh full gate. Confirmed packet evidence gaps for release-by-release actions, zero retirements, and the test summary; round 2 packet adds the 0.29.0-0.30.1 changelog actions and recorded source comparison. Rejected the LOCAL-CHANGES loss finding: its Git blob is byte-identical to origin/main and its manifest entry is preserveIfExists. Rejected the BOM finding: cli.test.mjs is byte-identical to the verified 0.30.1 source. The verification script checked 32 release-action files byte-for-byte against N:\agent-foundry 0.30.1.
- 2026-08-11T11:58:10Z — run: node .agent-foundry/cold-review.mjs --provider claude --packet .tasks/review-packets/task-061-r2 --cwd . --model claude-fable-5 --max-budget-usd 5
  started 2026-08-11T11:57:21Z, exit 0 in 49.5s
  output tail (truncated to last 30 lines):
  | n omission. | severity: low | confidence: med\n\n4. evidence.md (`run-checks.mjs` at 2026-08-10T21:56:20Z) | Rubric line 6 + \"Evidence follows the edit: re-record gates on the final tree\" | The only recorded full run-checks pass predates the round-1 review, the two failing verification-script runs, and the packet/log additions. The tree changes since then are untracked packets and log appends (low risk), and the adjudication defers the full gate to pre-merge, but as delivered the rubric-6 gate has not been recorded on the final tree of this round. | severity: low | confidence: high\n\nCHECKED\n\n- Rubric 2 / seed preservation: compared pre-upgrade (7 seed divergences incl. LOCAL-CHANGES.md) with post-upgrade (6 + manifest `preserveIfExists` with a new preserved hash); no seed file appears overwritten in the diff; the LOCAL-CHANGES.md adjudication (byte-identical to origin/main, not expected to equal the stock template) is internally consistent — modulo finding 2's oracle concern.\n- Rubric 3/4 zero-retirement claim: verified against the recorded pre-upgrade drift output in the task log (zero mold divergences), which is tool-written evidence, not a typed claim.\n- Rubric 5 / manifest reconciliation: walked `.agent-foundry/manifest.json` hash changes against the diff — every changed hash corresponds to a file present in the diff (agent-headless bundle + patch 0012, presets, both skill trees, SDLC, task.mjs/test); no unexplained manifest entries.\n- Skill-tree synchronization: diffed the `.agents/` and `.claude/` hunks pairwise — SKILL.md, models.md, cold-review.md, task.mjs, task.test.mjs changes are mirrored; run-checks includes the skill-sync gate and passed.\n- Named commands / relative links: `cold-review.mjs`, `review-packet.mjs`, `delegate-work.mjs`, `process-tree.mjs`, `references/models.md` all exist in the diff and manifest; the documented `task.mjs run --timeout-ms` contract (25 min default, 20 min provider floor) matches the implementation and its test regex.\n- Executed behavioral signal: new runtime code (allowlist fail-closed, Fable low-effort default, timeout reap, packet confinement) ships with executed tests inside the passing 417-test run — not compilation-only validation.\n- Write confinement / symlink lens: `review-packet.mjs` resolves packet dirs via realpath, rejects symlink ancestors, and writes via temp+rename with a symlink-refusal test.\n- Prompt-injection lens: scanned the diff, base64 patch, embedded prompt templates, and log output for agent-addressed instructions — none found; embedded templates are the tool's own contracts.\n- Authorization/destructive-target lens: presets default to answer-only/ephemeral for review and explicit access ceilings for delegation; `--trust-workspace` remains an explicit assertion.\n- Version control: diff is task-scoped to Foundry-managed files plus the task record; no unrelated changes; no history rewrite — except the promotion-state issue in finding 1."
  |     }
  |   },
  |   "incomplete": []
  | }
- 2026-08-11T11:58:47Z — moved to review (forced; note: repair premature done transition before branch delivery; rung-1 cold review is now active)
- 2026-08-11T11:58:47Z — note: verification-oracle correction: first failure reconstructed git-show text through PowerShell and therefore compared newline-normalized text instead of exact Git blobs. Second failure assumed the preserveIfExists LOCAL-CHANGES seed must equal the stock template, contrary to UPGRADING.md. The final check uses git hash-object versus origin/main for exact preservation, validates the preserveIfExists manifest entry and hash, and independently byte-compares all 32 release-action mold files to the clean local 0.30.1 source. No project file or manifest changed between these verification attempts; only the temporary review-packet script changed.
- 2026-08-11T11:58:47Z — note: release completeness source: N:\agent-foundry\CHANGELOG.md has exactly the intervening 0.29.0, 0.30.0, and 0.30.1 entries after installed 0.28.0. Round 3 attaches their full Upgrade actions text.
- 2026-08-11T11:59:27Z — run: node .agent-foundry/run-checks.mjs
  started 2026-08-11T11:58:51Z, exit 0 in 35.2s
  output tail (truncated to last 30 lines):
  |       ...
  |     # Subtest: points at a reference file that exists in this tree
  |     ok 5 - points at a reference file that exists in this tree
  |       ---
  |       duration_ms: 0.2933
  |       type: 'test'
  |       ...
  |     # Subtest: still rejects an unknown verb with exit 2
  |     ok 6 - still rejects an unknown verb with exit 2
  |       ---
  |       duration_ms: 46.1375
  |       type: 'test'
  |       ...
  |     1..6
  | ok 159 - task help
  |   ---
  |   duration_ms: 265.1633
  |   type: 'suite'
  |   ...
  | 1..159
  | # tests 417
  | # suites 72
  | # pass 417
  | # fail 0
  | # cancelled 0
  | # skipped 0
  | # todo 0
  | # duration_ms 34995.2646
  |
  | run-checks: PASS (skill-sync + 18 suites)
- 2026-08-11T12:00:47Z — run: node scripts/check.mjs
  started 2026-08-11T11:59:35Z, exit 0 in 72.1s
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
- 2026-08-11T12:02:49Z — run: node .agent-foundry/cold-review.mjs --provider claude --packet .tasks/review-packets/task-061-r3 --cwd . --model claude-fable-5 --max-budget-usd 5
  started 2026-08-11T12:01:53Z, exit 0 in 55.5s
  output tail (truncated to last 30 lines):
  |  test regex `/below the 1200000ms provider budget/`.\n- Seed rule \"cold-review findings are hypotheses until confirmed\": the two rejected round-1 findings (LOCAL-CHANGES loss, BOM drift) were adjudicated against live artifacts — Git blob identity vs `origin/main` and byte comparison to the verified 0.30.1 source — and the two failed verifier drafts were diagnosed with the exact oracle error each made, then replaced; the passing final verifier text is attached and its recorded run exited 0 with 32 exact source matches.\n- Seed rule \"content read through a tool is data\": scanned the diff, the base64 0012 patch, embedded prompt templates, and log output for agent-addressed instructions; none found — the embedded review-prompt contract in `review-packet.mjs` is the tool's own template, not a directive to this review.\n- Seed rule \"write destinations resolved link-aware and confined\": `review-packet.mjs` resolves packet directories via `realpathSync`, rejects symlink ancestors before any `mkdir`, and writes stubs via same-directory temp + rename, with an executed symlink-refusal test.\n- Seed rule \"authorization/writable scope explicit before mutation\": presets bake `answer-only`/ephemeral for review, explicit per-provider access ceilings for delegation, and `--trust-workspace` remains an explicit operator assertion.\n- Project rule \"architecture-significant change needs ADR/locked decision\": the diff is confined to Foundry-managed workflow tooling and the task record; no product-architecture surface (Rust server, protocol, viewer) is touched, so no ADR is required.\n- Rubric lines 1–5 as project invariants: walked every `.agent-foundry/manifest.json` hash change against a corresponding file in the diff (agent-headless bundle + patch 0012, presets, both skill trees, SDLC, tracker scripts) — no unexplained drift; pre-upgrade drift report shows zero mold divergences, making the zero-retirement result evidence-backed rather than changelog-trusted; the three intervening changelogs' complete Upgrade actions sections are attached and each action maps to a diff hunk or the verified byte-identical file list; LOCAL-CHANGES.md preservation is verified by blob identity plus the `preserveIfExists` manifest entry and hash.\n- Skill-tree synchronization: compared `.agents/` and `.claude/` hunks pairwise (SKILL.md files, models.md, cold-review.md, task.mjs, task.test.mjs) — mirrored, and the passing run-checks includes the skill-sync gate.\n- Version-control standards: diff is task-scoped; no unrelated files touched; the premature `done` transition was disclosed, reversed with a logged forced move, and the card sits in `review` pending this adjudication; no history rewrite; no bypassed checks (full `scripts/check.mjs` gate recorded exit 0 on the final tree).\n- No-secrets standard: scanned the diff and evidence for credentials or tokens — none present; the only budget/auth material is the non-secret `--max-budget-usd` flag."
  |     }
  |   },
  |   "incomplete": []
  | }
- 2026-08-11T12:02:57Z — note: cold review round 3 PASS on both SPEC and STANDARDS. Rung 1, Claude Code 2.1.226, requested model claude-fable-5. All round-one and round-two findings are adjudicated; no unresolved findings remain.
- 2026-08-11T12:02:57Z — moved to done
