---
name: handoff-writer
description: >-
  Writes a thorough, restart-from-cold HANDOFF.md at the repo root,
  pulling from git state, the current conversation, project journals,
  and the task board. Use when the user says "create a handoff",
  "write the handoff", "wrap up the session", "checkpoint where we
  are", "leave notes before I step away", or any phrasing meaning
  "leave a complete catch-up document before I close this session."
  Overwrites HANDOFF.md in place after preserving the exact prior bytes as a
  recoverable Git blob.
---

# Handoff Writer

The one job of this skill is to produce a HANDOFF.md good enough that
**a fresh agent (or you, two weeks from now) can fully resume work from
a cold start** by reading this single file.

HANDOFF.md is the restart-from-cold entry point for a new agent or a human
returning to the project. A thin or hand-wavy handoff means the next session
wastes its first hour rediscovering context that should have been
written down. A thorough handoff means the next session opens the file
and starts working.

Treat this skill as "write a letter to the next person who opens this
repo." Sometimes that person is you in two weeks; sometimes it's an
agent with no memory of this conversation. Both have to be able to
pick up cold.

## When to trigger

This skill is invoked explicitly. The user is signaling the end of a
work session and wants a fresh catch-up document. Common phrasings:

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
   hard way. Mental model details that aren't obvious from the code.

If a section you're tempted to write doesn't help answer one of those,
cut it. If one of those goes unanswered, the handoff is incomplete.

## Sources to consult

Always pull from these before writing. The conversation alone is not
enough — it captures _what we talked about_, but the journals and git
state capture _what's actually true in the repo right now_.

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
  What decisions were made? What did they ask for that's still open?
  Read your own message history with the user as a primary source.
- **The prior `HANDOFF.md`** (if it exists). Read it before
  overwriting. Two reasons: (a) it likely contains _enduring_ context
  (mental model, pitfalls, frequently-needed commands) that should be
  carried forward, not lost; (b) it tells you what the previous
  session expected to happen, which is useful for the "what changed
  since last handoff" framing.

### If they exist in the repo

- **`.tasks/tasks/`** — the `task-tracker` board. Run:
  ```bash
  node .agents/skills/task-tracker/scripts/task.mjs list
  ```
  to see what's in_progress, ready, blocked, review. The in_progress
  and blocked tasks are the most important — they tell the next
  session what's actively underway and what's stuck.
- **`docs/adr/`** — accepted and proposed architecture decisions explain
  why the system has its current shape.
- **`PLANNING-JOURNAL.md`** — the most recent entry records the current
  planning direction and unresolved sequencing choices.
- **`BLOCKED-JOURNAL.md`** — open blockers belong in the new HANDOFF
  too, so the next session knows what to unstick.

Gracefully degrade. None of these are required to exist — many repos
won't have them. If they're absent, just rely on git + conversation.

## Structure to follow

The shape that works in this repo, in order. The installed `HANDOFF.md` seed
already uses these section names — this skill is their authority, so keep them
stable across rewrites. Adapt or drop a section when it genuinely doesn't
apply (don't write empty sections to satisfy a template), and add
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
invariants that aren't enforced by types. Skip if the codebase is
self-explanatory.

## What was finished this session

Bulleted list of concrete things shipped. Reference commits where
useful. This is the "since last handoff" delta.

## What's in progress / half-done

What was started but not finished. Why it's not done. Where the work
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

These are why some handoffs work and others don't.

**Be specific, not summative.** "Refactored validation" is useless.
"Moved `validate_request()` from the transport adapter into the domain
boundary because policy and transport were mixed; the adapter now only
translates inputs" tells the next session what changed, where to look, and why.

**Quote, don't paraphrase, when commands matter.** A reader copying
from your handoff cannot run "start the server with the usual flags."
They can run the exact command you paste, flags and all.

**Capture the *why* behind in-flight work.** "Task-140 in progress"
is fine for the board. The handoff should say *why* it's in flight,
*what approach* is being tried, and *what evidence* would resolve the
open question. The next session has to be able to pick up the thread
of reasoning, not just the file pointers.

**Carry forward enduring context.** Mental model, common pitfalls,
frequently-needed commands — these usually outlive the specific
session. Read them out of the prior HANDOFF.md and bring them forward
(updating where they've drifted), rather than re-deriving every time.

**Surface, don't bury, the things that block progress.** Blockers
and open questions go *up* in the document, not at the bottom. If
the next session has to read 800 lines to find out the loop is
waiting on a human decision, the handoff failed.

## How to write the file

1. **Read the sources** listed above (git, conversation, prior
   HANDOFF, journals, task board). Do the git commands in parallel.
2. **Draft mentally** before writing. Ask yourself: "If I closed this
   session right now and opened the repo in two weeks, what would I
   need to read in HANDOFF.md to start working in five minutes?"
   That's your TL;DR and "To pick up tomorrow."
3. **Preserve, then write.** If `HANDOFF.md` exists, store its bytes with
   `git hash-object -w -- HANDOFF.md`, then point a unique UTC-stamped ref such
   as `refs/agent-handoff-backups/20260727T131500Z` at that blob with
   `git update-ref <backup-ref> <blob-id>`. Retain the ref name. The reachable
   ref protects uncommitted and first-commit handoffs from garbage collection.
   Then write the full file in one pass using the active harness's normal
   editing mechanism.
4. **Don't write planning, decision, or analysis docs as side files.**
   Everything goes into HANDOFF.md. Side files defeat the "one place
   to look" guarantee.
5. **Report back briefly.** One or two sentences: "Wrote HANDOFF.md.
   N sections covering <highlights>. Prior version recoverable with
   `git show <backup-ref>`." If there was no prior file, say so. Don't
   re-summarize the contents in chat — the file is the artifact.

## What NOT to do

- **Don't ask "should I overwrite?"** The user knows. Asking adds
  friction to the one moment they're trying to wrap up.
- **Don't archive the prior file to `HANDOFF.archive/` or similar.**
  Commit history or the dedicated reachable backup ref is the archive.
  Adding extra worktree files clutters the repo and contradicts the "one
  place to look" guarantee.
- **Don't write a HANDOFF that's just a git log.** Git log is one
  *input* to the handoff. A handoff that's just a list of commits
  could have been produced without you.
- **Don't omit pitfalls because they feel embarrassing.** "Spent
  three hours on X because Y" is exactly the kind of thing the next
  session needs to read. Phrase it as a pitfall, not a confession.
- **Don't speculate.** If you don't know whether a test passes or
  whether the server is currently running, say "unverified" or run
  the check. Speculative claims in a handoff get repeated as fact by
  the next session.

## Related skills

- `execute-task` — records task decisions and blockers as it works.
- `task-tracker` — owns `.tasks/`; this skill reads the board
  state when summarizing in-progress and blocked work.
