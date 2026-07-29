---
name: retrospective
description: >-
  Periodic mining of the task archive, logs, and journals for repeated process
  mistakes and workflow friction — then turning each confirmed pattern into a
  correction of the specific skill, standard, or contract that governs the
  behavior. Use when the user says "retrospective", "retro", "why do we keep
  hitting this", "improve the workflow", or on the recorded cadence. Distinct
  from codebase-audit, which examines the code; this examines how the work
  itself went. Corrections land as edits to existing documents through normal
  tasks — never as a new lessons file.
---

# Retrospective

The framework improves the product two ways already: per-diff review catches
defects, and DISTILL turns recurring *code* defect classes into permanent
review lenses. This skill closes the remaining loop: recurring *process*
defects — the workflow mistakes and friction that waste context, cause
rework, or bypass the discipline — become corrections to the documents that
govern the behavior.

The output is never a report and never a new file. It is **edits**: a
checklist item added to the skill that kept being misapplied, a rule added to
`AGENTS.md`, a lens added to `docs/REVIEW-STANDARDS.md` — or guidance
**removed** because it stopped earning its keep. Growth in quality, not
length.

## Where the signal comes from

The board archive is a complete behavioral record. Mine it, don't recall it:

```bash
node .agents/skills/retrospective/scripts/process-signals.mjs
node .agents/skills/retrospective/scripts/process-signals.mjs --since 2026-07-01
```

It reports four classes across active and archived tasks: `friction:` notes
flagged in the moment (the highest-value signal), forced transitions
(discipline bypassed), review churn (tasks that re-entered `in_progress`), and
failed recorded runs. `--json` emits the same data for further slicing.

(The helper exists so this step runs identically on every shell. Recursive
`grep` is GNU-only, and the PowerShell equivalent — `Select-String` — is
case-insensitive by default, which would quietly widen the `friction:`
convention to match `Friction:` and `FRICTION:` too.)

Plus: `BLOCKED-JOURNAL.md` (what kinds of things block, and how often the
`Resume:` line was actually enough), `PLANNING-JOURNAL.md` (how many re-plans,
and what assumption kept breaking), and `.agent-foundry/LOCAL-CHANGES.md`
(corrections already made — the baseline this retro builds on).

The `friction:` convention feeds this: whenever the *process* rather than the
code causes waste — a skill's instruction was ambiguous at the moment of use,
two documents disagreed, a step was done twice because the log didn't show it
was done — the working agent records it immediately:

```bash
node .agents/skills/task-tracker/scripts/task.mjs note task-NNN "friction: <what the process made harder and where>"
```

Log it at the moment it bites. A retro can only fix what got written down.

## Procedure

### 1. Scope

Cover the window since the last retrospective (the journal entry names it) —
default: the archive added since, plus both journals. Record the window.

### 2. Mine for repetition

Run the sweeps above and read the hits **in context**. A retro finding is a
*pattern*, so the unit of evidence is repetition:

- The same friction note category from independent tasks.
- The same review-axis finding class recurring across tasks *after* it was
  supposedly distilled (the lens exists but doesn't work — a correction to
  the lens, not a new one).
- The same skill step repeatedly skipped, misread, or force-bypassed.
- The same kind of task repeatedly mis-sized (epics discovered mid-flight).
- The same blocker class recurring because its root cause was never filed.

### 3. Apply the evidence bar

A pattern is real only when **all** of these hold — drop it otherwise:

1. **Three or more occurrences**, each cited by task ID. Two is a
   coincidence to watch, not a pattern to legislate.
2. **A named governing document** — the specific skill section, standard, or
   contract line that either caused the behavior or should have prevented it.
   If no document governs it, the finding is a *missing* rule; say so.
3. **A stated cost** — context burned, rework rounds, discipline bypassed.
   Annoyance without cost is not a finding.
4. **A correction expressible as a small edit** — one checklist item, one
   rule, one reworded step. If the correction needs a page, the real problem
   is the document's design; file that as a task instead.

### 4. Correct at the source

For each surviving pattern, file one normal board task (this is a `mold`
change — the full lifecycle applies: rubric, cold review, validation):

- The task names the pattern, cites the occurrences, and contains the
  **exact proposed edit** to the governing document.
- Corrections to shared skills change **both harness trees** and are recorded
  in `.agent-foundry/LOCAL-CHANGES.md` with `Upstream: yes` when the lesson
  is generic — a process fix that would help any project belongs in the
  Foundry, not in one install's copy.
- Wording discipline for added guidance: name the failure it prevents, in
  one sentence, at the point in the document where the failure happens.
  Guidance nobody encounters at the moment of the mistake is decoration.

### 5. Prune

Read the guidance added by previous retrospectives (they're in
`LOCAL-CHANGES.md`) and the seed rules in `docs/REVIEW-STANDARDS.md`. For
each: has it fired since it was added? A rule that has prevented nothing in
two retro windows is a maintenance cost — merge it, sharpen it, or delete it,
per that file's own "retire rules that stop earning their cost" policy.
**A retro that only adds is doing half the job.**

### 6. Record

Append to `PLANNING-JOURNAL.md`: the window, patterns confirmed (with task
IDs), corrections filed, guidance pruned, and patterns *watched* (one or two
occurrences — next retro checks whether they matured into patterns). The
watch list is what makes the next retro cheaper than this one.

## Anti-slop rules

A self-improvement mechanism is the single easiest place for a framework to
manufacture busywork. These rules are load-bearing:

- **A quiet retro is a good retro.** "No pattern cleared the bar; two items
  on watch" is a complete result. Never legislate from one incident.
- **Never create a new guidance file.** Every correction lands in an existing
  document at the point of use. A LESSONS.md graveyard is how guidance goes
  to die.
- **Cap: five corrections per retro.** More than that means the framework
  itself has a structural problem — surface that to the operator instead.
- **Net-length watch.** If three consecutive retros grew the documents
  without pruning anything, the loop is bloating, not improving — say so.
- **No blame archaeology.** The unit is the pattern and its governing
  document, never which session made the mistake.
- **Corrections are hypotheses.** A rule added here can be pruned by the
  next retro if it doesn't fire. That is the loop working, not failing.

## Related

- `docs/SDLC.md` → "Self-improvement" — how this loop and DISTILL divide the
  territory
- `codebase-audit` — the same discipline aimed at the code instead
- `execute-task` — DISTILL (step 5) handles code-defect lessons inline
- `task-tracker` — the `friction:` note convention that feeds this
- `.agent-foundry/LOCAL-CHANGES.md` — where corrections are recorded and
  flagged for upstreaming
