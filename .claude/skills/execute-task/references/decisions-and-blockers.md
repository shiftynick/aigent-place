# Decisions and blockers

Read this file completely when an `execute-task` task encounters an
architecture decision or cannot continue safely.

## Decision

1. Inspect surrounding code, accepted ADRs, and prior task logs.
2. If still unclear, get a cold second opinion stating the decision, options,
   and ruled-out alternatives.
3. Record the choice:
   - For an architecture-significant choice, create a `proposed` ADR with the
     `adr` skill and apply `docs/SDLC.md`'s reversibility test. Reversible
     within this task may proceed provisionally with a log note. Expensive to
     reverse moves the task to `blocked` pending acceptance.
   - For a minor choice, add a concise task note.
   - When rejecting a direction for reusable reasons, also add a
     `docs/out-of-scope/` record with a revisit condition.

## Blocker

1. Try a cold second opinion; some apparent blockers are missing context.
2. If still blocked, log the exact condition and attempted alternatives, then
   move the task to `blocked`.
3. For a human decision, credential, or approval, add `needs:operator`.
   A `proposed` ADR awaiting acceptance gets a companion `needs:operator`
   task citing the ADR. The operator queue is
   `task.mjs list --tag needs:operator`.
4. Append to `BLOCKED-JOURNAL.md` using its format, especially `Resume:`.
5. Surface one concise line naming the missing input and journal reference.

An escalation across an agent boundary follows `docs/SDLC.md`: reason, viable
options, recommendation, and resume condition.
