---
id: task-7210989894000007
title: Measure the outbound drain against the tick budget at workload scale
status: backlog
priority: p2
tags: [area:network, phase:debt]
blockedBy: []
createdAt: "2026-08-06T16:26:40Z"
updatedAt: "2026-08-06T16:26:40Z"
---

<!-- task-tracker:description -->
## Description

Raised by cold review during task-041 and adjudicated as harness work rather than integration-test work. spawn_simulation_loop (crates/world-server/src/transport.rs) awaits drain_fanout between ticks, so the serialization stage spends tick budget; task-041 increased its cost by sizing each state item from a real encoded frame (the delta path encodes the stub payload for the delta size, again for the promotion size, and once more for the frame it writes). crates/world-server/tests/outbound_pressure_accounting.rs bounds twenty drains with four stuck writers by the twenty ticks of 50 ms they represent, which catches a systematic breach at small scale only. ARCHITECTURE section 1 says the workload targets are measured by the load harness, not assumed, and the targets are 300 aigents and 500 viewers with under 1 percent of ticks over 50 ms. crates/workload-harness does not drive drain_fanout at all today; it calls SnapshotFanout::publish_to with a fixed logical size. Drive the real drain from the harness at the documented connection counts, report per-pass serialization time against the tick budget, and decide from that measurement whether the redundant sizing encodes need removing (which would mean turning OutboundQueue::enqueue_state's full_encoded_bytes parameter into a closure so the promotion size is only computed when a coalesce actually promotes).

<!-- task-tracker:log -->
## Log

- 2026-08-06T16:26:40Z — created (status: backlog)
