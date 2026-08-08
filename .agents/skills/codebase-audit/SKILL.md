---
name: codebase-audit
description: >-
  Periodic whole-repository sweep for quality drift — duplication past a
  threshold, modules that outgrew comprehension, dead code, eroded boundaries,
  inconsistent solutions to one problem. Use when the user says "audit the
  codebase", "code health check", "technical debt review", "is this getting
  messy", or when a cadence trigger fires (every N completed tasks, before a
  milestone). Distinct from the fresh-eyes review in `execute-task`, which
  judges one diff; this judges what many correct diffs added up to. Files
  tasks; never blocks work.
---

# Codebase Audit

Per-task review reads a diff. That is the right unit for correctness. It cannot
see one class of defect: **every individual change was reasonable, but the
accumulation is not.**

When someone reviews the third near-duplicate helper, they see a small correct
addition — not a third copy. When a module grows by forty lines each task, no
one notices the day it stopped fitting in one reading. This skill finds that
class of defect. That is its only purpose.

It produces **tasks**, not a verdict. It never gates a commit, a task, or a
release.

## When to run

- Every 15-20 completed tasks, or whatever cadence `AGENTS.md` records.
- Before a milestone, a public release, or handing the codebase to new people.
- When a symptom shows up: "where does this logic actually live?", repeated
  bugs in one area, a change that needed edits in five parallel places.
- On request.

Do **not** run it per task. Do **not** run it on a subsystem scheduled for
deletion. Do **not** run it on code younger than a few tasks — accumulation
needs time to accumulate.

## Procedure

### 1. Scope and baseline

Pick the whole repository or one subsystem. Record the commit you audited
(`git rev-parse --short HEAD`). An audit without a recorded scope cannot be
compared to the next one.

### 2. Gather evidence before forming opinions

Let the repository nominate its own suspects. Do not read top-down.

```bash
node .agents/skills/codebase-audit/scripts/churn-report.mjs --limit 30
node .agents/skills/codebase-audit/scripts/churn-report.mjs --since "6 months ago" --limit 20
```

Churn concentrates debt. The files edited most often are where accumulation
happens and where it costs the most. Cross-reference with the largest files.
Cross-reference with areas that appear repeatedly in bug-fix commit messages.

The helper exists so this step runs identically on every shell. The obvious
`git log … | sort | uniq -c | sort -rn` pipeline is GNU-only. Its PowerShell
equivalent is case-insensitive by default. It would silently merge paths that
differ only in case.

Then read those files. Findings must come from reading code, not from metrics.
Churn only chooses where to look.

### 3. Sweep for accumulation classes

Look for defects that only exist in aggregate:

- **Duplication past threshold.** Three or more real instances of the same
  logic. A change to one would have to be made in all.
- **Modules that outgrew comprehension.** A file or function no longer
  explainable in one reading. It got there incrementally.
- **Abstractions that no longer fit.** A parameter every caller passes the same
  value for. An interface with one real implementation and three shims. An
  extension point nothing extended.
- **Dead and orphaned code.** Unreferenced exports. Flags never flipped.
  Branches unreachable since some earlier change. Fixtures for deleted tests.
- **Eroded boundaries.** Policy leaking into transport, persistence, or
  presentation. A layer reaching around its own interface.
- **Divergent solutions to one problem.** Three ways to validate input. Two
  error-handling conventions. Parallel retry implementations.
- **Test-suite decay.** Tests asserting implementation rather than behavior.
  Duplicated setup. Suites slow enough that people skip them. Long-skipped
  tests.
- **Knowledge decay.** Orientation documents rot on the same curve as the code.
  Commands in `AGENTS.md` and `CONTRIBUTING.md` that no longer execute — verify
  with `task.mjs run` against the audit's own task. Relative links that no
  longer resolve. An ADR index that disagrees with the directory. A `HANDOFF.md`
  describing a state several milestones old. `[CUSTOMIZE]` markers that crept
  back into authoritative documents. Bootstrap verified all of this once, at
  install. Nothing else re-verifies it.

### 4. Apply the evidence bar

A finding is only real when **all four** of these hold. Drop it otherwise.
Dropping is the normal outcome and costs nothing:

1. **Locations.** Concrete paths and symbols. More than one where the class
   requires it.
2. **Accumulation evidence.** Why this is aggregate drift and not a one-off:
   the count, the history, the span it crosses.
3. **Cost, stated concretely.** What it makes worse — e.g. "any change to the
   retry policy has to be made in four files and one will be missed." If you
   cannot name a cost beyond aesthetics, there is no finding.
4. **A first step.** A specific, bounded action — not "refactor this."

### 5. File tasks, do not write a report

Each surviving finding becomes one board task. Size it to a single fresh
context. Set priority by the cost in step 4:

```bash
node .agents/skills/task-tracker/scripts/task.mjs add "<the defect, not the fix>" --priority p2 --tag area:quality --tag phase:audit --description "<locations, accumulation evidence, cost, first step>"
```

Write the description so it survives drift. Name behaviors and interfaces, not
line numbers (see `task-tracker` on durable descriptions).

**Cap: seven tasks per audit.** If more clear the bar, the codebase has a
structural problem that individual cleanup tasks will not fix. Say that plainly
to the operator. Propose scoping work instead of filing an eighth.

### 6. Distill and record

If a finding reveals a defect pattern likely to recur, add a one-bullet lens to
`docs/REVIEW-STANDARDS.md`. Per-task review will then catch it at the source.
That is how an audit reduces the need for the next audit.

Append the audit to `PLANNING-JOURNAL.md`: date, scope, commit, how many
findings cleared the bar, and the task IDs filed.

## Anti-slop rules

This skill's failure mode is manufacturing work to look useful. Every rule
below prevents that:

- **A clean audit is a real result.** "Nothing cleared the bar; here is what I
  examined" is a complete, valuable answer. Never pad to justify the run.
- **No style, formatting, or naming preferences.** If a formatter or linter
  could decide it, it is not an audit finding.
- **No "consider refactoring X".** Name the defect and its cost, or drop it.
- **No rewrite proposals without a migration path** that keeps the system
  working at every step.
- **Duplication is not automatically a defect.** Two similar things that change
  for different reasons should stay separate. Coupling them is the worse bug.
- **Do not file what you cannot size.** A task too big for one context is an
  epic. An epic filed from an audit is usually a disguised rewrite.
- **Judge the code that exists,** not the architecture you would have chosen.

## Output

Report to the operator in this shape. Keep it brief — the tasks carry the
detail:

```markdown
## Codebase audit — <scope> @ <commit>

Examined: <what was read, and what the churn signal pointed at>

### Findings above the bar
- **<defect>** — <locations> · cost: <concrete consequence> → task-NNN

### Considered and dropped
- <finding> — <which bar it failed>

### Distilled
- <new REVIEW-STANDARDS lens, or "none">
```

The "considered and dropped" section is not padding. It tells the next audit
what has already been weighed. The same non-findings will not be re-litigated
every cycle.

## Related

- `execute-task` — per-diff SPEC/STANDARDS review; the complement to this
- `retrospective` — the same periodic discipline aimed at the workflow
  instead of the code
- `task-tracker` — where findings land, and how to write durable descriptions
- `docs/REVIEW-STANDARDS.md` — where distilled patterns go
- `docs/ENGINEERING-STANDARDS.md` — the conventions this audit measures against
- `the-fool` — for stress-testing a proposed direction, not existing code
