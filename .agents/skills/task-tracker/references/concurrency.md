# Task tracker concurrency

Read this file completely before parallel agent work, worktree creation, or
claim takeover.

## Model

The board is advisory under concurrency. `.tasks/` is tracked in Git, so a
claim made in one worktree is invisible elsewhere until committed, merged,
and pulled. The repository lock prevents partial board-file writes; it does
not coordinate ownership across worktrees.

Set `FOUNDRY_AGENT` to a distinct session name so owners are distinguishable.

## One agent per worktree

Two agents must never share one working directory: they share `HEAD`, index,
and files. Give each task a worktree from an explicit current start point:

```bash
git fetch origin
git worktree add ../<project>-task-NNN -b task-NNN-short-slug origin/main
```

The explicit `origin/main` prevents branching accidentally from another
task's branch.

Preflight:

1. The operator assigns tasks; parallel agents do not run `next`.
2. Pull before claiming so board state is current.
3. Each agent edits only its task card.
4. Coordinate shared-document edits through the operator or sequence them.

The board CLI works in linked worktrees, and shared `core.hooksPath` applies
without per-worktree setup.

## Stale claims

Claims do not expire. Before takeover:

1. Check whether `claimedAt` is older than roughly 24 hours.
2. Check the task log for recent activity.
3. Inspect the old worktree for uncommitted in-scope work.
4. Read and salvage its evidence.
5. Log the takeover, move through `blocked` or `ready`, then re-claim.

Do not use `--force` merely to erase a stale owner.
