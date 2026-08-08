---
name: handoff-writer
description: >-
  Write a restart-from-cold HANDOFF.md at the repo root from git state,
  the current conversation, project journals, and the task board. Use when
  the user says "create a handoff", "write the handoff", "wrap up the
  session", "checkpoint where we are", "leave notes before I step away",
  or any phrasing that means leave a complete catch-up document before
  the session ends. Overwrites HANDOFF.md in place after preserving the
  exact prior bytes as a recoverable Git blob.
---

# Handoff Writer

This skill has one job. Produce a HANDOFF.md that is good enough for
**a fresh agent (or you, two weeks from now) to fully resume work from
a cold start** by reading this single file.

HANDOFF.md is the restart-from-cold entry point for a new agent or a human
returning to the project. A thin handoff wastes the next session's first
hour. The next session rediscovers context that should be written down.
A thorough handoff lets the next session open the file and start working.

Treat this skill as "write a letter to the next person who opens this
repo." Sometimes that person is you in two weeks. Sometimes it is an
agent with no memory of this conversation. Both have to be able to
pick up cold.

## When to trigger

This skill is invoked explicitly. The user signals the end of a work
session and wants a fresh catch-up document. Common phrasings:

- "create a handoff" / "write the handoff" / "do a handoff"
- "wrap up the session" / "end-of-session notes"
- "checkpoint where we are" / "leave notes before I step away"

If the user asks something adjacent — "summarize what we did today",
"give me a status update", a quick verbal recap — that is **not** a
handoff. Those are conversational answers. A handoff is a written
artifact intended to survive the conversation ending.

## What the output must contain

The new HANDOFF.md must let a cold reader answer three questions
without searching the repo:

1. **Where are we?** What phase / problem / area is active. What was
   just shipped. What is half-done.
2. **What do I do next?** The concrete first commands to run, the
   first file to open, the immediate decision to make.
3. **What will trip me up?** Pitfalls the current session learned the
   hard way. Mental model details that are not obvious from the code.

If a section does not help answer one of those, cut it. If one of those
goes unanswered, the handoff is incomplete.

## Sources to consult

Always pull from these before writing. The conversation alone is not
enough. It captures _what we talked about_. The journals and git state
capture _what is actually true in the repo right now_.

### Always

- **Git state.** First check whether `HEAD` exists with
  `git rev-parse --verify HEAD`. Then run:
  - `git status` — uncommitted changes (these are the half-done work)
  - `git diff --stat` — scope of uncommitted changes
  - `git ls-files --others --exclude-standard` — untracked work omitted by
    `git diff`
  - `git log --oneline -25` — recent history, only when `HEAD` exists
  - `git branch --show-current` — current branch
- **The current conversation.** What was the user actually working on?
  What decisions were made? What did they ask for that is still open?
  Read your own message history with the user as a primary source.
- **The prior `HANDOFF.md`** (if it exists). Read it before
  overwriting. Two reasons: (a) it likely contains _enduring_ context
  (mental model, pitfalls, frequently-needed commands) that should be
  carried forward, not lost; (b) it tells you what the previous
  session expected to happen. That is useful for the "what changed
  since last handoff" framing.

### If they exist in the repo

- **`.tasks/tasks/`** — the `task-tracker` board. Run:
  ```bash
  node .claude/skills/task-tracker/scripts/task.mjs list
  ```
  to see what is in_progress, ready, blocked, review. The in_progress
  and blocked tasks are the most important. They tell the next
  session what is actively underway and what is stuck.
- **`docs/adr/`** — accepted and proposed architecture decisions explain
  why the system has its current shape.
- **`PLANNING-JOURNAL.md`** — the most recent entry records the current
  planning direction and unresolved sequencing choices.
- **`BLOCKED-JOURNAL.md`** — open blockers belong in the new HANDOFF
  too, so the next session knows what to unstick.

Gracefully degrade. None of these are required to exist. Many repos
will not have them. If they are absent, rely on git + conversation.

## Structure to follow

The shape that works in this repo, in order. The installed `HANDOFF.md` seed
already uses these section names — this skill is their authority, so keep them
stable across rewrites. Adapt or drop a section when it genuinely does not
apply (do not write empty sections to satisfy a template), and add
`Validation state`, `Worktree and operational state`, and `Known blockers and
risks` when the project tracks them:

````markdown
# HANDOFF — <project>, <YYYY-MM-DD>

<one-line orientation: who you are, what you're picking up>

---

## TL;DR

2-4 sentences. Phase / area, what's done, what's next. A reader who
only reads this section should still know which direction to head.

---

## To pick up tomorrow

Exact commands or steps to resume. Code-fenced and copy-pasteable.
Include the _first_ thing to do, not a generic "set up your env."

## What's where

Table of repo-significant paths a fresh agent needs to navigate.

| Thing | Location        |
| ----- | --------------- |
| ...   | `path/to/thing` |

## Mental model (don't lose this)

The non-obvious framing that took this session time to figure out.
Architecture intuition, naming conventions that mean something,
invariants that are not enforced by types. Skip if the codebase is
self-explanatory.

## What was finished this session

Bulleted list of concrete things shipped. Reference commits where
useful. This is the "since last handoff" delta.

## What's in progress / half-done

What was started but not finished. Why it is not done. Where the work
lives (branch / file / WIP commit / staged changes).

## Open questions for the human

Anything that requires a human call before the loop can keep going.
Specific question, specific options. Skip if there are none.

## Recent commit history (last 15-25)

```text
<hash> <subject>
...
```
## Frequently-needed commands

The 5-10 commands the next session will actually want to run. Tailored
to _this_ repo, not generic ones like `npm install`.

## Common pitfalls

Things this session got bitten by. Cite the specific failure mode
(error message, symptom) so the next session recognizes it fast.
````

## Writing principles

These are why some handoffs work and others do not.

**Be specific, not summative.** "Refactored validation" is useless.
"Moved `validate_request()` from the transport adapter into the domain
boundary because policy and transport were mixed; the adapter now only
translates inputs" tells the next session what changed, where to look, and why.

**Quote, do not paraphrase, when commands matter.** A reader copying
from your handoff cannot run "start the server with the usual flags."
They can run the exact command you paste, flags and all.

**Capture the *why* behind in-flight work.** "Task-140 in progress"
is fine for the board. The handoff should say *why* it is in flight,
*what approach* is being tried, and *what evidence* would resolve the
open question. The next session has to be able to pick up the thread
of reasoning, not just the file pointers.

**Carry forward enduring context.** Mental model, common pitfalls,
frequently-needed commands — these usually outlive the specific
session. Read them out of the prior HANDOFF.md and bring them forward
(updating where they have drifted), rather than re-deriving every time.

**Surface, do not bury, the things that block progress.** Blockers
and open questions go *up* in the document, not at the bottom. If
the next session has to read 800 lines to find out the loop is
waiting on a human decision, the handoff failed.

## How to write the file

1. **Read the sources** listed above (git, conversation, prior
   HANDOFF, journals, task board). Do the git commands in parallel.
2. **Draft mentally** before writing. Ask yourself: "If I closed this
   session right now and opened the repo in two weeks, what would I
   need to read in HANDOFF.md to start working in five minutes?"
   That is your TL;DR and "To pick up tomorrow."
3. **Preserve, then write.** If `HANDOFF.md` exists, store its bytes with
   `git hash-object -w -- HANDOFF.md`, then point a unique UTC-stamped ref such
   as `refs/agent-handoff-backups/20260727T131500Z` at that blob with
   `git update-ref <backup-ref> <blob-id>`. Retain the ref name. The reachable
   ref protects uncommitted and first-commit handoffs from garbage collection.
   Then write the full file in one pass using the active harness's normal
   editing mechanism.
4. **Do not write planning, decision, or analysis docs as side files.**
   Everything goes into HANDOFF.md. Side files defeat the "one place
   to look" guarantee.
5. **Report back briefly.** One or two sentences: "Wrote HANDOFF.md.
   N sections covering <highlights>. Prior version recoverable with
   `git show <backup-ref>`." If there was no prior file, say so. Do not
   re-summarize the contents in chat — the file is the artifact.

## What NOT to do

- **Do not ask "should I overwrite?"** The user knows. Asking adds
  friction to the one moment they are trying to wrap up.
- **Do not archive the prior file to `HANDOFF.archive/` or similar.**
  Commit history or the dedicated reachable backup ref is the archive.
  Adding extra worktree files clutters the repo and contradicts the "one
  place to look" guarantee.
- **Do not write a HANDOFF that is just a git log.** Git log is one
  *input* to the handoff. A handoff that is just a list of commits
  could have been produced without you.
- **Do not omit pitfalls because they feel embarrassing.** "Spent
  three hours on X because Y" is exactly the kind of thing the next
  session needs to read. Phrase it as a pitfall, not a confession.
- **Do not speculate.** If you do not know whether a test passes or
  whether the server is currently running, say "unverified" or run
  the check. Speculative claims in a handoff get repeated as fact by
  the next session.

## Related skills

- `execute-task` — records task decisions and blockers as it works.
- `task-tracker` — owns `.tasks/`; this skill reads the board
  state when summarizing in-progress and blocked work.
