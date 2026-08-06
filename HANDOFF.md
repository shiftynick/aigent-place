# HANDOFF — Aigent Place, 2026-08-06 (late)

You are picking up mid-milestone with a **clean, unblocked board**. The
`shape-collision-slice` front is operator-approved, its two roots are merged,
and `task-048` is the next card. Nothing is waiting on a human.

---

## TL;DR

`live-connection-slice` is finished, its technical debt is captured as board
cards, and the next milestone — **`shape-collision-slice`, giving the world
real spatial bodies** — is approved and underway. Its risk probe (`task-046`,
the entity store) came back clean, so **the front stands as planned; no re-plan
is needed**. Eight of its ten cards remain.

Everything that was in flight has landed. `main` is `2f4206d`, no open PRs, no
claimed tasks, nothing blocked.

---

## To pick up tomorrow

```powershell
Set-Location N:\aigent-place
git checkout main
git pull --ff-only
node .claude/skills/task-tracker/scripts/task.mjs board
```

**Next card is `task-048`** — derive the canonical AABB collider from a
validated shape tree. It is the only unblocked milestone card, and it gates
both `task-049` (heightfield/grounding) and `task-050` (broadphase), which are
genuinely parallel with each other once it lands. That pair is the next real
fan-out opportunity.

```powershell
node .claude/skills/task-tracker/scripts/task.mjs show task-048
node .claude/skills/task-tracker/scripts/task.mjs move task-048 ready
```

**Before claiming**, decide whether to take `task-2929451841000001` first (p1,
from `task-047`'s review: apply the aggregate shape extent bound where the
collider is derived). It is arguably a prerequisite for `task-048` rather than
a follow-up — read it and judge.

## What's where

| Thing | Location |
| --- | --- |
| Product architecture and build order | `ARCHITECTURE.md` |
| Agent operating contract | `AGENTS.md` |
| Task lifecycle / cold-review ladder | `docs/SDLC.md` |
| Review lenses | `docs/REVIEW-STANDARDS.md` |
| Task board | `.tasks/` (`node .claude/skills/task-tracker/scripts/task.mjs board`) |
| Approved milestone plans | `PLANNING-JOURNAL.md` (latest entry = current direction) |
| ADRs | `docs/adr/` — **0002 and 0003 are the spec for this whole milestone** |
| Entity store | `crates/world-server/src/entity.rs` |
| Shape validation | `crates/world-server/src/shape.rs` |
| World core / tick | `crates/world-server/src/world.rs` |
| WS transport + sim loop | `crates/world-server/src/transport.rs` |
| AOI + fan-out | `crates/world-server/src/aoi.rs`, `fanout.rs` |
| Viewer | `apps/viewer/` |
| Unified gate | `node scripts/check.mjs` |
| Fast pre-commit subset | `node scripts/product-check.mjs --fast` |

## Mental model (don't lose this)

- World server is authoritative; aigents submit intents; browsers are
  spectators only. Fixed **20 Hz** tick.
- The simulation stage must not await SQLite, sockets, or locks a network task
  can contend. Use `advance_tick_nonblocking` + `poll_durable` on the listen
  path; sync `advance_tick` may wait (tests only).
- **Durable-before-apply (ADR-0005):** draft → submit/commit → install.
  Entity ids and revisions allocated in a tentative tick are **not**
  authoritative and may be reused if the transaction never commits.
- **This milestone implements decisions that are already made.** ADR-0002 and
  ADR-0003 fix the shape grammar, the AABB collider union, the overlap rule
  (positive extent on all three axes; face/edge/point contact is legal), swept
  movement, placement and enclosure rejection, the deterministic displacement
  lattice, terrain columns, and grounding. `protocol/v1/aigent.proto` already
  schematizes `ShapeTree` and the six primitives; `ruleset/v1/CONTRACT.md`
  already carries `shape.*` and `physics.*`. **Do not re-decide any of it.** If
  an ADR looks wrong, stop and surface it.
- **`Axis` is one type, in `shape.rs`,** shared by shape-extent and entity
  position-boundary rejections. Both name the same ADR-0002 right-handed axis.
  Do not reintroduce a second one.
- Budgets always come from the **live ruleset generation**, never constants,
  and bodies and placed objects carry different limits.
- Task IDs: compact `task-NNN` on the default branch; 16-digit
  `task-<10-digit-ns><6-digit-counter>` off-main. **Long ids are correct
  behavior, not corruption.**
- `aigent` = world inhabitant; reserve `agent` for the industry term.
- One task / one branch / one PR; squash-merge when `process-gate` is green.

## What was finished this session

| Commit | PR | Substance |
| --- | --- | --- |
| `0fd4931` | [#44](https://github.com/shiftynick/aigent-place/pull/44) | Filed the approved front (`task-046`–`055`) + seven debt cards (`task-039`–`045`); recorded the plan in `PLANNING-JOURNAL.md` |
| `89314a6` | [#45](https://github.com/shiftynick/aigent-place/pull/45) | **`task-021`** — derived-oracle lens, with `scripts/derived-oracle-lens.test.mjs` proving a fixture-echoing oracle passes a deliberately broken implementation while a derived oracle fails it |
| `c4b2df9` | [#46](https://github.com/shiftynick/aigent-place/pull/46) | Promoted the roots; filed `task-056` |
| `4327d98` | [#47](https://github.com/shiftynick/aigent-place/pull/47) | **`task-044`** — AOI truncation now actually applies on the live path; aigents rank from their own body |
| `bfc9994` | [#49](https://github.com/shiftynick/aigent-place/pull/49) | **`task-047`** — closed-form shape-tree validation against live ruleset budgets |
| `f4280e1` | [#48](https://github.com/shiftynick/aigent-place/pull/48) | **`task-046`** — the authoritative entity store (the milestone's risk probe) |
| `e8ce224` | [#51](https://github.com/shiftynick/aigent-place/pull/51) | **`task-041`** — outbound pressure charged from real encoded frames |
| `2f4206d` | [#52](https://github.com/shiftynick/aigent-place/pull/52) | **`task-057`** — Agent Foundry 0.16.0 → **0.18.0** (from a parallel session) |

Also: the Foundry upgrade backups from earlier sessions were deleted, closing a
standing open question.

## What's in progress / half-done

**Nothing.** No claimed tasks, no open PRs, no open branches, clean tree.

## The three findings worth carrying forward

The cold-review protocol earned its cost repeatedly. Don't weaken the two-axis
+ CHECKED-section discipline:

1. **`task-046`'s digest claim was unfalsifiable.** The rubric asserted the
   entity table was covered by the durable integrity digest. The SPEC reviewer
   deleted the entity block from `compute_integrity_hex` **and**
   `ImmutableGeneration::digest`, re-ran everything, and it all passed — because
   `integrity_ok()` recomputes with the same function it sealed with, so an
   omitted field is self-consistent and invisible. Fixed with
   `entity_state_tamper_fails_integrity` and a digest test covering every field
   and the allocator.
2. **`task-044`'s inherited oracle was tautological** — it computed its
   expectation by calling the production `truncate_nearest`, so it could not
   have failed if the ranking were wrong.
3. **A vacuous assertion**: `len() <= AOI_HARD_CAP` against an *empty world*
   passes even if the handler sends everything.

## Follow-ups now on the board

The merged tasks filed real follow-ups. Two are p1 and worth reading before
picking up `task-048`:

- `task-2929451841000001` — apply the aggregate shape extent bound where the
  collider is derived (may be a `task-048` prerequisite).
- `task-2748472262000002` — the pre-commit hook validates the main checkout
  rather than the worktree being committed from.
- `task-3618552301000001` — explicit AOI enter/leave records in the stub payload.
- Plus `task-2748472262000001` (ADR-0004 terminal-revision forced sleep) and a
  cluster of outbound-queue follow-ups from `task-041`'s review
  (`task-7210989894...`), including one confirming what can still trigger the
  sustained-overflow disconnect.

## Validation state

`main` @ `2f4206d`: every merged PR passed a real CI `process-gate`. Local
`node scripts/check.mjs` green on the last integration.

## Worktree and operational state

- Remote: `git@github.com:shiftynick/aigent-place.git` (public)
- Protected `main`; ruleset requires **strict** `process-gate`, squash-only, no
  bypass actors, conversations resolved
- Single checkout at `N:\aigent-place`; no open PRs or task branches
- Hooks: `git config core.hooksPath .githooks`
- **Agent Foundry 0.18.0** installed
- Operator granted **merge authority**: push, PR, and squash-merge when
  `process-gate` is green. Governance surfaces and `needs:operator` still ask
  first.

## Frequently-needed commands

```powershell
Set-Location N:\aigent-place
node .claude/skills/task-tracker/scripts/task.mjs board
node .claude/skills/task-tracker/scripts/task.mjs show task-048

# Gates
node scripts/check.mjs
node scripts/product-check.mjs --fast

# Demo
cargo run -p world-server -- --listen
npm run aigent:scripted-move
npm run viewer:dev   # http://127.0.0.1:5173/?ws=ws://127.0.0.1:7600/ws

# PR flow
gh pr checks <n>
gh pr update-branch <n> --rebase
gh pr merge <n> --squash --delete-branch

# Is a CI failure real, or infrastructure?
gh api repos/shiftynick/aigent-place/check-runs/<job-id>/annotations
```

## Common pitfalls

- **Worktrees fork from `origin/main`, NOT local `HEAD`.** This cost real work
  today. Board state committed locally but unpushed is *invisible* to a worktree
  agent — one found no card for its task id and **invented a duplicate card**,
  and another filed a duplicate follow-up. **Land board state on `origin/main`
  via PR before forking task branches.**
- **Parallel branches compile alone and break together.** `task-046` and
  `task-047` each independently defined an identical `Axis{X,Y,Z}`, colliding
  (`E0252`) only once both were on one base; and every test that builds
  `ImmutableGeneration` as a struct literal broke (`E0063`) when the entity
  store added fields. Both were invisible until rebase. **Expect an integration
  pass after any parallel wave**, and prefer constructors over struct literals
  in fixtures.
- **A CI `failure` conclusion may not be a test failure.** Check the annotation.
  `The job was not acquired by Runner of type hosted` means no step ever ran.
  Check https://www.githubstatus.com before diagnosing — an Actions outage today
  produced hours of wedged, un-rerunnable, un-cancellable queued runs.
- **A `CANCELLED` conclusion is usually a superseded run**, not a failure.
- **`BEHIND` blocks merges.** Strict `process-gate` requires the branch be
  current. `gh pr update-branch <n> --rebase` re-triggers the gate; don't
  force-push. Note this rewrites the *remote* branch, so a local copy of that
  branch goes stale and GitKraken will draw both — reset the local one.
- **Leftover `.claude/worktrees/` breaks `node scripts/check.mjs`** —
  `check-skill-sync.mjs` walks the nested checkouts and reports their skills as
  drift. Tracked as `task-056`. `git worktree remove` often fails with
  *Directory not empty*; follow with `Remove-Item -Recurse -Force` and
  `git worktree prune`.
- **This board parallelizes worse than the card count suggests.** Shared files,
  a deep dependency chain, serialized squash-merges, and a file-based board that
  concurrent agents diverge. Fan out only on genuinely independent cards, and
  budget for the integration pass.
- **Do not commit `.tasks/review-packets/`.**
- **PowerShell:** use `$msg = @"..."@` for commit messages; bash heredocs fail
  in that shell.
- **Async writer:** `advance_tick` may wait; the 20 Hz loop must use
  nonblocking submit/poll.
- **Cold review:** a `PASS` with a thin CHECKED section means the review did not
  cover the work — re-run it, don't treat silence as a pass.
