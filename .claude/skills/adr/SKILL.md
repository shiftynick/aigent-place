---
name: adr
description: >-
  Create, supersede, or reject an Architecture Decision Record in
  docs/adr/ (MADR-style, one file per decision, indexed). Use when a
  decision shapes system structure, is expensive to reverse, or a future
  contributor would ask "why is it like this?" — including when such a
  decision surfaces mid-task, when the user says "write an ADR", "record
  this decision", or when a review flags an undocumented architecture
  choice. Not for small in-task choices (those go in the task log).
---

# ADR

One decision, one file, in `docs/adr/`. Process authority is
[docs/adr/README.md](../../../docs/adr/README.md); this skill is the
executable recipe.

## Is it ADR-worthy?

Yes if any of: it constrains future work across more than one module; it
would be expensive to reverse; two reasonable engineers would plausibly
have chosen differently; a reviewer or newcomer would ask "why?". No if
it's a local implementation choice — that's a task-log note
(`task.mjs note task-NNN "chose X over Y because Z"`). When genuinely
unsure, write the ADR — an unnecessary ADR costs minutes; an undocumented
architecture decision costs a re-litigation later.

## Creating an ADR

1. Find the next number: highest `NNNN-*.md` in `docs/adr/` plus one,
   zero-padded to 4 digits.
2. Copy `docs/adr/template.md` to `docs/adr/NNNN-short-kebab-title.md`
   and fill every section. Honesty requirements:
   - **Considered options** lists only options genuinely weighed.
   - **Consequences → Bad** must be non-empty; every real decision costs
     something.
   - Date = today; link the originating task if there is one.
3. Agent-authored ADRs start as `proposed`. Only explicit operator
   agreement changes a decision to `accepted`. When the user has already
   made the decision explicitly, record it as `accepted` and cite that
   context.

   A `proposed` ADR does not automatically halt the task that produced it.
   Apply the reversibility test in `docs/SDLC.md` → "When a decision surfaces
   mid-task": if the decision is reversible inside the current task,
   implement against it provisionally and log that it awaits acceptance; if
   it is expensive to reverse — persisted schema, published contract, a
   dependency the project must live with, or module shape beyond this task —
   move the task to `blocked` citing the ADR and surface it rather than
   implementing. When unsure, treat it as expensive to reverse.
4. Add the row to the index table in `docs/adr/README.md` **in the same
   commit**.
5. If code embodies the decision non-obviously, cite it at the site:
   `// see ADR-NNNN`.

## Superseding

Never rewrite an accepted ADR. Instead:

1. Write a new ADR whose Context section names the old one and what
   changed since it was accepted.
2. Edit the old ADR's status line only: `superseded by ADR-NNNN`.
3. Update both index rows.

## Rejected proposals

A formally-considered-and-declined proposal keeps its write-up with
status `rejected` — it prevents re-litigation. For cheaper concept-level
rejections with a revisit condition, use `docs/out-of-scope/` instead
(see its README for the boundary).

## Pitfalls

- Writing the ADR after the code has shipped and back-filling the
  "options" — record at decision time, while alternatives are honest.
- Padding Considered Options with straw men.
- Editing an accepted ADR "just to update it" — that's a supersession.
- Forgetting the index row (the reviewer checks).
- Numbering collisions when two tasks add ADRs in parallel — re-check
  the next free number at commit time.
