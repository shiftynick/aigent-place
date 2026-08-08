---
name: diagnosing-bugs
description: >-
  Feedback-loop-first diagnosis discipline for hard bugs and performance
  regressions. Use when the user says "diagnose" / "debug this", or reports
  something broken, throwing, failing, flaky, or slow — before reading code
  to build a theory. Not for trivial fixes where the cause is already known.
---

# Diagnosing Bugs

A discipline for hard bugs. Skip phases only when explicitly justified.
(Adapted from Matt Pocock's `diagnosing-bugs` skill, tuned to this repo.)

Before exploring, read `AGENTS.md`, the active task and its log, relevant
ADRs, and any authoritative product or architecture contract. A "bug" that
contradicts a recorded decision may be by design. Verify the contract before
changing behavior.

## Phase 1 — Build a feedback loop

**This is the skill.** Everything else is mechanical.

If you have a **tight** pass/fail signal — one command that goes **red** on
*this* bug — you will find the cause. Bisection, hypothesis-testing, and
instrumentation all consume that signal. If you do not have one, no amount of
staring at code will save you.

Spend disproportionate effort here. Be aggressive. Be creative. Refuse to give
up.

### Ways to construct one — try them in roughly this order

1. **Failing test** at whatever seam reaches the bug. Target the test suite
   that actually contains the code path. Check where tests live for the
   component or package in question.
2. **HTTP script** against a running dev server. Use `curl` or the project's
   standard HTTP client, with whatever auth the dev setup uses.
3. **CLI invocation** with a fixture input. Diff output against a known-good
   snapshot.
4. **Browser script** — for UI bugs, drive a real browser and assert on
   DOM/console/network. Rebuild first if the server embeds assets. Otherwise
   you will browser-verify stale code.
5. **Replay a captured trace.** Save a real request / payload / WS event log
   to disk. Replay it through the code path in isolation.
6. **Throwaway harness.** A test-only helper or minimal script that exercises
   the bug code path with one function call against a temporary fixture or
   isolated data store.
7. **Property / fuzz loop.** If the bug is "sometimes wrong output", run many
   random inputs and look for the failure mode.
8. **Bisection harness.** If the bug appeared between two known states,
   automate "boot at state X, check, repeat" so `git bisect run` can consume
   it.
9. **Differential loop.** Run the same input through old vs new version (or
   two configs) and diff outputs.
10. **HITL script.** Last resort. If a human must click, drive *them* with
    `node .claude/skills/diagnosing-bugs/scripts/hitl-loop.template.mjs` so the
    loop is still structured and the captured output feeds back to you.

If the project has an end-to-end smoke script, it is a ready-made loop for
bugs in boot/seed/smoke territory. Narrow it: a smoke pass that goes red on
*anything* is not a signal for *this* bug.

### Tighten the loop

Treat the loop as a product. Once you have *a* loop, tighten it:

- **Faster** — cache setup, skip unrelated init, narrow the test filter.
- **Sharper** — assert on the specific symptom, not "didn't crash".
- **More deterministic** — pin time, seed RNG, isolate the DB file, freeze
  network.

A 30-second flaky loop is barely better than no loop. A 2-second deterministic
one is tight — a debugging superpower.

### Non-deterministic bugs

The goal is not a clean repro. The goal is a **higher reproduction rate**.
Loop the trigger 100×. Parallelise. Add stress. Narrow timing windows. Inject
sleeps. A 50%-flake bug is debuggable. A 1% bug is not. Keep raising the rate
until it is debuggable.

### When you genuinely cannot build a loop

Stop and say so explicitly. List what you tried. Ask the user for:

- (a) access to whatever environment reproduces it,
- (b) a captured artifact (HAR, log dump, DB copy, screen recording with
  timestamps), or
- (c) permission to add temporary instrumentation.

Do **not** proceed to hypothesise without a loop.

### Completion criterion — a tight loop that goes red

Phase 1 is done when you can name **one command** you have **already run at
least once**. Paste the invocation and its output. That command must be:

- [ ] **Red-capable** — it drives the actual bug code path and asserts the
  **user's exact symptom**, so it can go red on this bug and green once
  fixed. Not "runs without erroring".
- [ ] **Deterministic** — same verdict every run (flaky bugs: a pinned, high
  reproduction rate).
- [ ] **Fast** — seconds, not minutes.
- [ ] **Agent-runnable** — unattended; a human only via the HITL template.

If you catch yourself reading code to build a theory before this command
exists, **stop.** Jumping straight to a hypothesis is the exact failure this
skill prevents. No red-capable command, no Phase 2.

## Phase 2 — Reproduce + minimise

Run the loop. Watch it go red. Confirm:

- [ ] The loop produces the failure mode the **user** described — not a
  different failure that happens to be nearby. Wrong bug = wrong fix.
- [ ] The failure reproduces across runs (or at a high enough rate).
- [ ] You captured the exact symptom (error message, wrong output, timing).
  Later phases can verify the fix addresses *it*.

Then shrink the repro to the **smallest scenario that still goes red**. Cut
inputs, callers, config, data, and steps one at a time. Re-run the loop after
each cut. You are done when **every remaining element is load-bearing** —
removing any one makes the loop go green. A minimal repro shrinks the Phase 3
hypothesis space. It becomes the Phase 5 regression test.

## Phase 3 — Hypothesise

Generate **3–5 ranked hypotheses** before testing any of them. Single-hypothesis
generation anchors on the first plausible idea.

Each hypothesis must be **falsifiable**: "If \<X\> is the cause, then
\<changing Y\> will make the bug disappear / \<changing Z\> will make it
worse." If you cannot state the prediction, the hypothesis is a vibe. Discard
or sharpen it.

**Show the ranked list to the user before testing.** They often re-rank
instantly ("we just changed #3 yesterday") or have already ruled some out.
Do not block on it. Proceed with your ranking if the user is AFK.

## Phase 4 — Instrument

Each probe must map to a specific Phase 3 prediction. **Change one variable
at a time.**

- Prefer targeted logs at the boundaries that distinguish hypotheses. Never
  "log everything and grep".
- **Tag every debug log** with a unique prefix, e.g. `[DEBUG-a4f2]`. Cleanup
  becomes a single grep. Untagged logs survive; tagged logs die.
- **Perf branch.** For performance regressions, logs are usually wrong.
  Establish a baseline measurement with the applicable timing harness,
  profiler, or query-planner output. Then bisect. Measure first, fix second.

## Phase 5 — Fix + regression test

Write the regression test **before the fix** — but only if a **correct seam**
exists. The test must exercise the real bug pattern as it occurs at the call
site. If the only available seam is too shallow (a unit test that cannot
replicate the chain that triggered the bug), a regression test there gives false
confidence.

**If no correct seam exists, that itself is the finding.** Document it. File a
follow-up task with the `task-tracker` skill for the structural fix.

If a correct seam exists:

1. Turn the minimised repro into a failing test at that seam.
2. Watch it fail.
3. Apply the fix.
4. Watch it pass.
5. Re-run the Phase 1 loop against the original, un-minimised scenario.

## Phase 6 — Cleanup + post-mortem

Required before declaring done:

- [ ] Original repro no longer reproduces (re-run the Phase 1 loop).
- [ ] Regression test passes (or the absence of a seam is documented + tasked).
- [ ] All `[DEBUG-...]` instrumentation removed (grep the prefix).
- [ ] Throwaway harnesses deleted.
- [ ] The winning hypothesis is stated in the commit message. The next
  debugger learns from it.

**Then ask: what would have prevented this bug?** If the finding generalizes to
a defect *class*, DISTILL it into `docs/REVIEW-STANDARDS.md` (per that file's
format). If the answer is architectural (no good seam, tangled callers, hidden
coupling), file a board task — after the fix is in, not before. You know more
now.
