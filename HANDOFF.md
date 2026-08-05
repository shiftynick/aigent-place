# HANDOFF — Aigent Place, 2026-08-04 (evening)

Cold-start checkpoint after finishing the `live-connection-slice` milestone
and clearing the remaining claimable follow-ups. Checkout is clean on `main`
except untracked local `.tasks/review-packets/` (never commit those).

---

## TL;DR

The vertical demo works: listen server + scripted aigent MOVE leases + viewer
placeholder spectate. Async durable writer, in-band snapshot resync, feature
version-set intersection, and task-ID namespace hardening all landed on `main`.
The board has **one** backlog card left: `task-021` (derived-oracle review
lens), which needs **operator approval** before work. Next product work is a
new milestone plan, not more claimable board burn-down.

---

## To pick up tomorrow

```powershell
Set-Location N:\aigent-place
git status -sb
git pull --ff-only
node .claude/skills/task-tracker/scripts/task.mjs board
```

**Immediate human decision:** approve or reject `task-021` (governance edit to
`docs/REVIEW-STANDARDS.md`). Until then, do **not** claim it.

**If continuing product work:** run `plan-milestone` for the next front after
`live-connection-slice` (shape grammar / terrain / auth / Postgres are still
out of the demo slice). Operator must approve the plan before filing tasks.

**Demo path (smoke the slice):**

```powershell
# Terminal A
cargo run -p world-server -- --listen

# Terminal B
npm run aigent:scripted-move

# Terminal C
npm run viewer:dev
# open http://127.0.0.1:5173/?ws=ws://127.0.0.1:7600/ws
```

## What's where

| Thing | Location |
| --- | --- |
| Product architecture and build order | `ARCHITECTURE.md` |
| Agent operating contract | `AGENTS.md` |
| Task lifecycle / cold-review ladder | `docs/SDLC.md` |
| Task board | `.tasks/` (`node .claude/skills/task-tracker/scripts/task.mjs board`) |
| ADRs | `docs/adr/` (incl. ADR-0010 tokio+axum WebSocket) |
| World server | `crates/world-server/` |
| Async durable writer | `crates/world-server/src/persist/async_writer.rs` |
| WS transport + sim loop | `crates/world-server/src/transport.rs` |
| Protocol crate | `crates/aigent-protocol/` |
| Viewer | `apps/viewer/` |
| Scripted aigent | `packages/aigent-sdk/scripts/scripted-move.mjs` |
| Unified gate | `node scripts/check.mjs` |
| Fast pre-commit subset | `node scripts/product-check.mjs --fast` |
| Planning journal (milestone notes) | `PLANNING-JOURNAL.md` |

## Mental model (don't lose this)

- World server is authoritative; aigents submit intents; browsers are
  spectators only.
- Fixed **20 Hz** tick. Simulation stage must not await SQLite, sockets, or
  locks a network task can contend. Use `advance_tick_nonblocking` +
  `poll_durable` on the listen path; sync `advance_tick` may wait (tests).
- **Durable-before-apply (ADR-0005):** draft → submit/commit → install.
  Tentative mutations are not authoritative until durable success.
- Async SQLite: `DurableJournal::async_sqlite`, queue cap 1, dedicated writer
  thread. Listen demo still uses in-memory world by default; async path is
  API + tests.
- Snapshot resync: client sends `SnapshotResyncRequest`; server
  `deliver_client_resync` via `fanout.client_resync` without reconnect;
  `hold_observe` prevents delta race ahead of the full snapshot.
- Feature negotiation (ADR-0001): client `supported_versions[]` intersects
  server catalog `1..=N`; do not collapse the client set to max before
  intersect.
- Task IDs: compact `task-NNN` on default branch; 16-digit
  `task-<10-digit-ns><6-digit-counter>` off-main. Detached namespaces include
  absolute worktree root so same-commit worktrees cannot collide.
- Cold reviews: Codex rung 1 from Claude; separate SPEC + STANDARDS packets;
  do not commit `.tasks/review-packets/`.
- One task / one branch / one PR; squash-merge when `process-gate` is green.
- `aigent` = world inhabitant; reserve `agent` for the industry term.

## What was finished this session

Milestone **`live-connection-slice`** (already on `main` before late session)
plus follow-ups burned down today:

| Task | PR | Substance |
| --- | --- | --- |
| 031–036 | #32–#37 | ADR-0010, SQLite WAL, WS sessions, outbound drain, scripted MOVE, viewer spectate |
| **250444** | [#38](https://github.com/shiftynick/aigent-place/pull/38) | Async durable writer + durable-before-apply |
| **951113** | [#39](https://github.com/shiftynick/aigent-place/pull/39) | `SnapshotResyncRequest` without reconnect |
| **919264** | [#40](https://github.com/shiftynick/aigent-place/pull/40) | Full feature `supported_versions` intersection |
| **986341** | [#41](https://github.com/shiftynick/aigent-place/pull/41) | Task-ID namespace diagnostics + detached uniqueness |

`HEAD` / `origin/main`: `23b5c40`.

## What's in progress / half-done

Nothing claimed. No open task branches.

Untracked only: `.tasks/review-packets/` (local cold-review scratch; leave
uncommitted or delete locally if desired).

## Open questions for the human

1. **`task-021`** — Add derived-oracle lens to cold-review standards.
   Requires explicit operator approval (governance). Approve / reject /
   rewrite?
2. **Next milestone** — After the live-connection demo, what front should
   `plan-milestone` target (shape grammar, terrain, identity, Postgres, …)?
3. Optional: accept/delete retained Foundry upgrade backups under
   `.agent-foundry-backups/` (still noted from earlier workflow sessions).

## Validation state

Last session ran `node scripts/check.mjs` green on each completed task before
PR; GitHub `process-gate` green on PRs #38–#41. Working tree currently has no
product diffs to re-validate.

## Worktree and operational state

- Public remote: `git@github.com:shiftynick/aigent-place.git`
- Branch: `main` (clean vs `origin/main`)
- Protected `main`, ruleset requires `process-gate`, squash-only, no bypass
- Single checkout: `N:\aigent-place`
- Open PRs: none
- Hooks: `git config core.hooksPath .githooks`
- Agent Foundry 0.15.0 installed; Cursor cold-review stays operator-selected
  (`CURSOR_AGENT_BIN` documented in `AGENTS.md`)

## Known blockers and risks

- Board is exhausted of autonomous work until `task-021` is approved or a
  new milestone is planned and filed.
- Listen path still uses in-memory journal; wire `--listen` to
  `async_sqlite` when durable demo restart matters.
- SessionHub / transport still demo trusted-inject identity (loopback).
- Do not treat untracked `.tasks/review-packets/` as deliverables.

## Recent commit history

```text
23b5c40 task-986341: harden task-ID namespace fallbacks (#41)
0fceda5 task-919264: SessionHub feature version set intersection (#40)
39adfe4 task-951113: SnapshotResyncRequest without reconnect (#39)
ed08fe9 task-250444: async durable writer and durable-before-apply (#38)
8f116b3 task-036: viewer spectates placeholder bodies from live snapshots (#37)
4f2d68d task-035: scripted aigent move-lease path over WebSocket (#36)
f46b5ea task-034: drain outbound observe traffic to WebSocket clients (#35)
3bd1d90 task-033: WebSocket session handshake bridge (#34)
27191b4 task-032: SQLite WAL durable journal (#33)
a81102c task-031: ADR-0010 tokio+axum WebSocket stack (#32)
2c23aa1 task-009: workload load harness for §1 targets (#31)
5f7f6b8 task-016: interest management and AOI truncation (#30)
7ad0bd0 docs: refresh AGENTS status and product-gate smoke list (#29)
a8a1bc0 task-015: protocol conformance client (#28)
2ec035b task-008: crash recovery and slow-client isolation (#27)
cb15460 task-007: ruleset activation and ordered persistence (#26)
0ed5e03 task-006: snapshot baselines and outbound queue pressure (#25)
6dfec74 task-017: ADR-0009 v1 product open-question answers (#24)
daa3139 task-018: connection sessions and authoritative command results (#23)
f758817 task-005: deterministic fixed-tick world core skeleton (#22)
07ef35e task-352658: bind replay recovery to COMMAND_OUTCOME protobuf (#21)
ce78646 task-004: generate protocol types and binary conformance fixtures (#20)
2a6f3cb task-014: wire unified product gate into CI and pre-commit (#19)
bcb2f92 task-003: scaffold pinned product workspace and quality gate (#18)
2a242fe task-012: ruleset schema and constitution boundary contract (#17)
```

## Frequently-needed commands

```powershell
Set-Location N:\aigent-place
git pull --ff-only
node .claude/skills/task-tracker/scripts/task.mjs board
node .claude/skills/task-tracker/scripts/task.mjs show task-021

# Gate
node scripts/check.mjs
node scripts/product-check.mjs --fast

# Demo
cargo run -p world-server -- --listen
npm run aigent:scripted-move
npm run viewer:dev

# Skill sync after editing mirrored skills
node .agent-foundry/check-skill-sync.mjs

# Cold review (Codex from Claude)
node .agent-foundry/agent-headless/cli.js capabilities codex
```

## Common pitfalls

- **Long task IDs** (`task-250444…`) are branch-namespaced allocations, not
  corruption. Prefer filing new tasks on `main` for compact `task-NNN` IDs.
- **Do not commit** `.tasks/review-packets/`.
- **PowerShell:** use `$msg = @"..."@` for commits; bash heredocs fail.
- **Async writer:** `advance_tick` may wait; the 20 Hz loop must use
  nonblocking submit/poll. Preserve commands enqueued during in-flight
  commit when installing/discarding tentative state.
- **Resync:** install full snapshot before clearing `hold_observe`; require
  envelope metadata and reject duplicate `message_id` with
  `INVALID_ENVELOPE`.
- **Feature offers:** never collapse `supported_versions` to max before
  `select_features`.
- **Cold review:** answer-only reviewers cannot run the gate; record
  `task.mjs run` evidence yourself before promoting.
- Standing authority this session: attack-the-board through claimable work
  with commit/push/PR/squash-merge when checks green; governance surfaces
  and `needs:operator` still ask first.
