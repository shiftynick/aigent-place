# Task067 owner brains worker packet

Observed: implementation is complete in the worker scope and the frozen owner runtime passed the bounded physical checks below. Root owns formal cold SPEC/STANDARDS reviews, documentation, the full product gate, and integration. Nothing was committed, staged, pushed, merged, or marked complete by this worker.

## Frozen mode rules

Runner visits `[2200,-1200]`, `[2200,1200]`, `[-200,1200]`, `[-200,-1200]` millimetres, at500mm/s. Authoritative own target distance <=150mm starts1200ms dwell. Arrival plus dwell advances the finite route. These are finite default-demo targets within the observed support plateau, not a navigation service.

Seeker alternates meeting and retreat goals, at900mm/s. A fresh meeting requires observed separation >=1800mm during the pursuit, >=300mm own displacement from its start, and CURRENT peer distance <=1500mm at arrival and after500ms dwell. Peer retargeting preserves its own travel/progress evidence. A successful meeting starts a retreat; already-near cast starts a retreat instead of counting proximity. Retreat chooses a finite anchor from the current own/peer poses, requires >=400mm own displacement plus target distance <=150mm and1200ms dwell, and is logged distinctly as `goalKind: retreat`; it never increments meetings. A separated retreat rearms a new pursuit. Axis gap below1100mm yields STOP until observed clearance permits a retreat. No elapsed timer alone advances a goal. All goals include explicit selfID, observed own/peer revisions and poses, local receipt `wallTime`/`elapsedMs`, own travel, and separation evidence.

MOVE renewal remains3000ms. Own authoritative progress >=100mm resets a7000ms travel watchdog; mere peer retargeting does not reset it. Typed BLOCKED can replan after1000ms without progress. Typed termination hints are advisory; arrival/watchdog work without them. Cleanup sends STOP only at a confirmed next session sequence, then waits boundedly. Snapshot recovery remains atomic and clears self binding until restated.

## Recorded reds and diagnostics

Observed stationary90s deterministic reproduction failed before the revision: fixed own `[1457,235]` and nearby runner movement falsely produced30 completed meetings. The same test now produces zero completions and chooses physical retreat. Earlier recorded reds covered peer retarget masking own stall, current peer leaving a meeting below the700mm retarget threshold, and cleanup STOP during resync-cleared binding.

Probe1 (`round2-runtime/brains-probe1`) failed physically: smaller0..2m/0..1m runner rectangle kept a central yielded seeker below the1100mm axis clearance. Its owned world/observer/brain groups were stopped after PID/start-time verification; cleanup receipt is preserved. Probe2 (`brains-probe2`) was diagnostic only: widened perimeter with1005mm clearance and1200ms meeting dwell travelled, but those loaded parameters were superseded. It is not the frozen acceptance run. Neither failed/diagnostic run was described as final readiness.

## Frozen actual probe3

Exact executed command recorded in the worker card:

`PATH=/home/shifty/.local/share/mise/installs/node/22.22.2/bin:$PATH node .agents/skills/task-tracker/scripts/task.mjs run task-067 -- python3 /home/shifty/.local/state/aigent-place/improvement-loop-2026-10-08/round2-brains-probe3.py brains-probe3`

It starts only owned processes: published world binary on17632 with fresh unique SQLite journal; independent generated-protocol VIEWER collector112s; actual ROOT npm runner105s and seeker90s commands with distinct IDs; owned runner group SIGSTOP40s/SIGCONT48s. `processes.json` records exact commands, PID/PGID/start ticks and launch receipts. `source-hashes.json` was captured before brain launch. It matches frozen production files: policy `2c351918403c2e4afce25d70627527b3ce105f53d957fb9f167f6781aef5ad3b`, client `7cd32df77cd8efd419c5bbacd230c2682018a0880a17fb68769a5532c93760b2`. Binary/process-exe SHA256 both `1cf6d93f54915b1889869bc853e5c58430181b6ca80389c8ba966de7cc14e777`.

First90s observer window: runner32.100m/1238 pose changes/13 waypoint completions; seeker41.207m/890 changes/13 fresh meetings plus13 retreats. Longest fixed poses runner9.152s during controlled pause; seeker8.452s, next8.001s. No fixed pose >10s. All pose records remained atY8905mm, with runner X[-200,2196]/Z[-1195,1200] and seeker X[-170,2173]/Z[-1175,1167], no terrain descent.

Every decision/binding own pose and policy peer pose joined by exact bodyID/revision to the independent authoritative observer:51 runner and108 seeker events. Each completed meeting had own travel >=385mm, prior separation >=1975mm, and current distance <=1493.415mm. Runner recovered body1 with a second hello and first new command sequence1. First post-resume seeker position decision `peer-cleared` was5.930s; explicit `peer-moved` was10.378s. After seeker STOP accepted sequence64, runner independently travelled5.751m. Runner STOP accepted sequence30. Both brain exits and observer exit0; owned worldPID761790 was terminated with `world-stop.json` receipt. No typed BLOCKED occurred in this frozen runtime; live BLOCKED reaction is NOT claimed. Deterministic policy tests cover typed blockers and missing termination hints.

Artifact files: `round2-runtime/brains-probe3/{runner,seeker,observer}.log`, `processes.json`, `source-hashes.json`, `perturbation.json`, `exits.json`, `world-stop.json`, `metrics.json`, `verification.json`. Exact metrics and validation commands are recorded by taskCLI and their scripts are in this private program directory. The collector window starts when the second body appears; seeker duration starts slightly before its first snapshot, so do not infer an additional90s of two live command sessions after cast adoption.

## Focused validation and delivery

Observed pinned Node22.22.2 `npm ci` passed. Final frozen command `npm test -w @aigent-place/aigent-sdk` passed46/46 (~27.7s), including actual direct/root-npm CLI WebSocket fixtures, original scripted-move tests, and10 compiling behavior mutants rejected by meaningful checks. Policy/observation focused19/19 passed. Runtime verifier passed exact binding/pose joins, current-distance meeting truth, same-body reconnect seq1, <=15s response, STOP results and independent continuation. Warm helper source review found no substantiated revised-policy defects; this is NOT formal cold review. Full gate was not run by the worker.

Apply ONLY incremental `round2-brains-fix4.patch` to root current preliminary+fix1+wrapper+fix2+test-delta+fix3 state: five EXISTING SDK paths,24114bytes, SHA256 `bb83cea08155dd1d8e0a238a02a6e77df6e7b88813a95539943ba96a8b6fd2e7`. Full binary HEAD packet `round2-brains.patch` is82955bytes, SHA256 `43a390d82cb9d870a854cd84159b4ccca3221d6b7f2da9a6aeb544f7efb748ba`. Named12-file SHA manifest: `round2-brains-manifest.json`; complete10 new scoped files: `round2-brains-untracked.tar.gz`; owncard copy: `round2-brains-task-log.md`. Generated protocol JS/d.ts and copied ADR/task inputs are excluded from the brains patch/manifest. Root package wrapper already includes the trailing `--`; fix4 does not resend it or any already-applied client production change.

Reported prerequisite: root protocol worker published generated optional selfBodyId and physical MoveAim fields. Inference: finite anchors work for this default demo seed because the frozen trace confirms supported traversal; no claim covers arbitrary worlds, casts larger than two, navigation, persistent plans, names, semantic goals, lifecycle channels, or disconnect cancelling leases.
