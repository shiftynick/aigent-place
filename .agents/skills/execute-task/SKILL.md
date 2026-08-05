---
name: execute-task
description: >-
  Execute one board task end-to-end: rubric, claim, implementation, cold
  review, validation, completion, and local commit. Use for "work on
  task-NNN", "pick up the next task", or after task-tracker `next` or `move
  ... in_progress` identifies a task. This skill owns lifecycle execution;
  task-tracker owns board and CLI semantics.
---

# Execute Task

This is the lifecycle authority for work between selecting a task and
delivering its task-scoped commit. `docs/SDLC.md` remains authoritative for
commit authority, cold-review ladder, agent boundaries, and mid-task ADRs.
`task-tracker` owns board columns, dependencies, and command behavior.

## Before editing

1. Read the task, its log, linked decisions, and affected code:

   ```bash
   node .agents/skills/task-tracker/scripts/task.mjs show task-NNN
   ```

2. If the objective conflicts with repository evidence or cannot be made
   checkable, stop and surface the concrete ambiguity.
3. Write a 3-6 line rubric of observable outcomes **before claiming**:

   ```bash
   node .agents/skills/task-tracker/scripts/task.mjs note task-NNN "rubric: (1) ... (2) ..."
   ```

4. Claim without bypassing dependency guards:

   ```bash
   node .agents/skills/task-tracker/scripts/task.mjs move task-NNN in_progress
   ```

If no task ID was assigned, use `task.mjs next`. Empty output means no
claimable task; inspect `board` and blockers rather than inventing work.

## Implement

- Keep the diff task-scoped. File out-of-scope discoveries as separate tasks.
- Record non-obvious choices and workflow waste as they occur:

  ```bash
  task.mjs note task-NNN "chose X because Y"
  task.mjs note task-NNN "friction: <process waste and where it occurred>"
  ```

- Use an ADR for architecture-significant choices before they harden into
  code. When a decision or blocker appears, read
  `references/decisions-and-blockers.md` completely and follow it.
- Update task-relevant product or operator documentation with the code. If no
  documentation change is needed, record that check.
- Run focused checks while implementing. Do not call compilation alone
  behavioral validation.

When the implementation, initial checks, and documentation are ready:

```bash
node .agents/skills/task-tracker/scripts/task.mjs move task-NNN review
```

## Cold review

Before constructing or running any review, read
`references/cold-review.md` completely. It defines the two independent axes,
concurrent dispatch, findings-only output, complete packet, review ladder,
triage, re-review cap, and DISTILL rule.

Do not promote work merely because review ran. Verify and adjudicate findings
against live repository evidence, fix confirmed defects, and re-review
task-scoped changes made after the latest review.

### Report review results

Apply `docs/SDLC.md` → "Operator communication" when reporting review results.
Record each finding and its adjudication in the task log; the operator receives
the result and a plain-language account of each material problem, its practical
effect, and the recommendation. Provide the technical record only when it
helps a decision or the operator asks for it.

## Validate

Before validating, read `docs/SDLC.md` → "Validation" completely and apply
its gate-selection and invalidation rules. Apply the testing requirements in
`docs/ENGINEERING-STANDARDS.md` and the project's lint, type, or static gates.
Record every command-expressible signal through the tracker:

```bash
node .agents/skills/task-tracker/scripts/task.mjs run task-NNN -- <exact command>
```

Use `task.mjs note` only for evidence a command cannot express, such as a
browser observation. A hand-written claim that a runnable check passed is not
validation.

### Report validation results

Apply `docs/SDLC.md` → "Operator communication" to validation results too. State
what passed or failed and what that means; keep raw output in the task log
unless the operator needs it to decide or asks to see it.

## Complete and commit

Before completion, verify:

- the rubric is satisfied;
- applicable focused and full gates pass;
- both review axes are adjudicated and their ladder rung is logged;
- documentation and ADRs are current;
- follow-ups are separate;
- the diff contains only this task;
- the task log contains real validation evidence; and
- any changed shared skill has its counterpart copy in the same commit, with
  `node .agent-foundry/check-skill-sync.mjs` recorded.

Then:

```bash
node .agents/skills/task-tracker/scripts/task.mjs move task-NNN done
git add <named task paths>
git commit -m "task-NNN: <why>"
```

Do not use `git add -A`, `--amend`, or `--no-verify`. Under the default
`docs/SDLC.md` policy, the local task-scoped commit is autonomous. Push,
publish, deploy, tags, and shared-history rewrites require explicit authority.
A project `AGENTS.md` may tighten that boundary.

Leave recent work visible in `done`; archive in one session-close sweep.
Before moving on, reconcile queued tasks invalidated by what this task
revealed. If milestone scope changed, use `plan-milestone`. Refresh
`HANDOFF.md` only when direction, phase, or the next execution step materially
changed.

## Context discipline

One substantial task should fit one fresh context: understand, implement,
review, validate, document, and commit. Keep rubric through implementation in
one coherent stretch. Batch only small follow-ups.

## Related

- `task-tracker` - board and CLI authority
- `references/cold-review.md` - required before review
- `references/decisions-and-blockers.md` - required when either condition occurs
- `adr` - architecture decision records
- `efficient-orchestration` - delegated implementation within this lifecycle
- `docs/SDLC.md` - project lifecycle policy
