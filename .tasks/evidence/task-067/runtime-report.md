# task-067 final-source sustained runtime

**PASS: all14 measured acceptance criteria.** Actual ROOT npm demo commands ran against a fresh default two-body world on17631 after the bootstrap repair. The earlier final-plaza run and worker probes remain separate historical evidence.

Captured and current policy SHA256: `2c351918403c2e4afce25d70627527b3ce105f53d957fb9f167f6781aef5ad3b`; final client: `f78e40201fdbbec092e96e9f4ca33fab3d5e490259a8347c45e4310ffa9796d9`. Loaded world binary matches captured executable hash `1cf6d93f54915b1889869bc853e5c58430181b6ca80389c8ba966de7cc14e777`.

## Movement observed independently

| Body | Own path in first90s | Active path | Longest active fixed pose |
| --- | ---: | ---: | ---: |
| runner / 1 | 32.674m | 67.831m | 8.403s |
| seeker / 2 | 42.416m | 67.526m | 9.502s |

Runner completed all4 distinct physical waypoints in its first90s. Seeker completed14 independently qualified meetings in its first90s and22 total. Retreats are separate. All completions were matched to current joint observer states and met own-travel, rearmed separation, current peer distance and dwell thresholds. No counter substitutes for travel.

All267 logged own pose/revision claims and264 peer claims match the same independent joint states, with zero own/peer/joint mismatches. No active fixed-pose episode exceeds10s; explicit final STOP tails are excluded. Source capture happened concurrently with isolated mutation checks; temporary mutant hashes in the private capture are not the sources loaded by these ROOT npm processes. The production command/source hashes are verified explicitly.

## Recovery, separate STOP and actual exits

Owned runner pause lasted8.005s. A fresh negotiated session recovered the exact same body and contiguous command sequencing from1; renewed observed motion followed resume in1.613s. Seeker made observation-backed decisions within15s of both pause and resume (post-resume5.864s). This proves response to observed poses, not knowledge of the OS pause flag.

Runner traveled7.577m after seeker STOP, measured from1s after that STOP to exclude cleanup latency. Each final STOP received an Accepted result, its aim cleared, and pose/revision/no-aim stayed stable for at least2s. Both brains and the independent observer have actual supervisor wait receipts exit0. The supervising command returned0 in190.4s; the analyzer returned0 in0.1s.

Independent anonymous VIEWER observed3666 snapshots (1 full/3665 deltas), no failures or private binding, max frame gap1049.000ms. The collector sent only VIEWER hello. Full JSON/wire/log receipts and all interval comparisons remain private; runtime-metrics.json retains aggregate checks and source provenance.

## Limits

This is observed default-plaza behavior, not a guarantee for arbitrary worlds or a durable command-result/restart repair. No live BLOCKED percept is claimed; deterministic policy tests exercise that path. Browser acceptance is separately recorded in spectator-report.md. Both fresh cold axes completed and are adjudicated with no demonstrated code defect; the final-source full gate passed97.2s. The fresh raw-evidence audit and its limits are recorded in cold-review.md. Closeout documentary review, post-closeout gate and protected PR delivery follow in the task log.
