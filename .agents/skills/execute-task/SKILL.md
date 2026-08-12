---
name: execute-task
description: >-
  Use when the operator asks to work on a named board task, pick up the next
  task, or continue a task selected or claimed through task-tracker. Use
  task-tracker instead for board and CLI operations without task execution.
---

# Execute Task

This skill governs work from task selection through the task-scoped commit.
`docs/SDLC.md` is the authority for commit authority, cold-review ladder,
agent boundaries, and mid-task ADRs. `task-tracker` owns board columns,
dependencies, and command behavior.

## Before editing

1. Read the task, its log, linked decisions, and affected code:

   ```bash
   node .agents/skills/task-tracker/scripts/task.mjs show task-NNN
   ```

2. If the objective conflicts with repository evidence or you cannot make it
   checkable, stop. Surface the concrete ambiguity.
3. Write a 3-6 line rubric of observable outcomes **before claiming**. Write
   each line so a cold reviewer can check it without interpretation. If you
   cannot make a line observable, that line is a question for the operator,
   not a rubric line — surface it before you claim:

   ```bash
   node .agents/skills/task-tracker/scripts/task.mjs note task-NNN "rubric: (1) ... (2) ..."
   ```

4. Claim without bypassing dependency guards:

   ```bash
   node .agents/skills/task-tracker/scripts/task.mjs move task-NNN in_progress
   ```

If no task ID was assigned, use `task.mjs next`. Empty output means no
claimable task. Inspect `board` and blockers. Do not invent work.

## Implement

- On the **first code-writing task of this session**, read
  `docs/REVIEW-STANDARDS.md` and the applicable
  `docs/ENGINEERING-STANDARDS.md` sections. Later tasks in the same session
  reuse that read unless those docs or the task's standards surface changed.
  Meet the STANDARDS axis at the source instead of discovering it as findings.
- Keep the diff task-scoped. File out-of-scope discoveries as separate tasks.
- When the task creates a new interface, public signature set, or module
  boundary, outline the types and signatures first — no bodies. Log the
  outline and the choices you are least confident about as a task note. A
  reader must be able to say "right" or "wrong" from the outline in seconds.
  Implement only after the outline is logged; a signature is cheap to change,
  an implementation is not.
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
- Before requesting review, list the behaviors this change adds or alters. For
  each behavior, name a change that leaves the code compiling and running but
  removes that behavior. Confirm a test fails on it. A behavior with no such
  test is untested. A test that only fails when the code is deleted or no
  longer compiles proves execution, not behavior.
- When the change adds gates, probes, or checks, record one run per new
  check where that check rejects a seeded defect (`task.mjs run`). A check
  you cannot make fail — for example, a pattern match over a serialized
  artifact — is unsound by construction: say so in the review packet instead
  of hardening it for another round.

Before you request review, run a **warm self-pass** over the frozen diff:
read the diff line by line against the rubric, then a second time against
the `docs/REVIEW-STANDARDS.md` lenses. Fix what you find. This pass does not
replace cold review; it removes the mechanical findings that waste the first
cold round.

When the implementation, initial checks, and documentation are ready:

```bash
node .agents/skills/task-tracker/scripts/task.mjs move task-NNN review
```

## Cold review

Before the **first** review of a session, read `references/cold-review.md`
completely. Later reviews in the same session may follow its session
checklist unless the packet shape or ladder rung changed. That file defines
the two independent axes, the `review-packet.mjs` / `cold-review.mjs`
dispatch preset, findings-only output, complete packet, review ladder,
triage, re-review cap, DISTILL, and the trivial-diff fast path pointer to
`docs/SDLC.md`.

Do not promote work merely because review ran. Verify and adjudicate findings
against live repository evidence. Fix confirmed defects. Re-review task-scoped
changes made after the latest review.

### Report results to the operator

Apply `docs/SDLC.md` → "Operator communication" (ASD-STE100) for review and
validation reports alike. Record findings, adjudications, and gate outcomes
in the task log. The operator receives the result and an STE summary of each
material problem, its practical effect, and the recommendation. Provide the
technical record only when it helps a decision or the operator asks for it.

## Validate

Before the **first** validation of a session, read `docs/SDLC.md` →
"Validation" completely. Later tasks reuse that read unless the change is
high-risk or cross-cutting (then re-read). Apply its gate-selection and
invalidation rules. Apply the testing requirements in
`docs/ENGINEERING-STANDARDS.md` and the project's lint, type, or static gates.
Record every command-expressible signal through the tracker:

```bash
node .agents/skills/task-tracker/scripts/task.mjs run task-NNN -- <exact command>
```

Use `task.mjs note` only for evidence a command cannot express, such as a
browser observation. A hand-written claim that a runnable check passed is not
validation.

When a recorded command needs quoting or shell metacharacters, write it to
a temporary script file and record the run of that file, because inline
one-liners with metacharacters fail or truncate at shell boundaries.

Evidence follows the edit. After the last edit of any round, re-record the
applicable gates on the final tree before you request or re-enter review.
Evidence recorded before that edit does not count.
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

If acceptance needs an authorized post-merge deploy, follow
`docs/SDLC.md` → "Deploy-dependent acceptance": deliver the branch, move the
card to `blocked` (or close an implementation card and keep a separate
acceptance card), and do not mark the acceptance card `done` without deploy
evidence.

Then, when the task may reach `done`:

```bash
node .agents/skills/task-tracker/scripts/task.mjs move task-NNN done
git add <named task paths>
git commit -m "task-NNN: <why>"
```

Do not use `git add -A`, `--amend`, or `--no-verify`. Under the default
`docs/SDLC.md` policy, the local task-scoped commit is autonomous. Push,
publish, deploy, tags, and shared-history rewrites require explicit authority.
A project `AGENTS.md` may tighten that boundary.

Leave recent work visible in `done`. Archive in one session-close sweep.
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
