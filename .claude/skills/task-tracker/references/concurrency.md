# Task tracker concurrency

Read this file completely before parallel agent work, worktree creation, or
claim takeover.

## Model

The board is advisory under concurrency. `.tasks/` is tracked in Git, so a
claim made in one worktree is invisible elsewhere until committed, merged,
and pulled. The repository lock prevents partial board-file writes. It does
not coordinate ownership across worktrees.

Set `FOUNDRY_AGENT` to a distinct session name so owners are distinguishable.

## One agent per worktree

Two agents must never share one working directory. They share `HEAD`, index,
and files. Give each task a worktree from an explicit current start point:

```bash
git fetch origin
git worktree add ../<project>-task-NNN -b <project-task-branch> <remote-default-ref>
```

Resolve `<remote-default-ref>` from remote HEAD or project policy. Do not
assume its name. The explicit start ref prevents branching accidentally from
another task's branch.

Preflight:

1. The operator assigns tasks. Parallel agents do not run `next`.
2. Pull before claiming so board state is current.
3. Each agent edits only its task card.
4. Coordinate shared-document edits through the operator, or sequence them.

Prefer filing tasks on the current default branch before you create
worktrees. If a task must be added independently on another branch, the CLI
uses a stable numeric namespace derived from that branch, so stale and
concurrent branches do not mint the same sequential ID. The filename,
frontmatter, and dependency syntax remain `task-<digits>`.

Detached HEAD namespaces also include the absolute worktree root. Thus, two
detached worktrees at the same commit cannot mint colliding IDs. If
`.agent-foundry.json` cannot name the default branch and
`refs/remotes/origin/HEAD` is missing, allocation uses a namespaced ID and
prints a `task-tracker: warning` on stderr.

The board CLI works in linked worktrees. Shared `core.hooksPath` applies
without per-worktree setup.

## Stale claims

Claims do not expire. Before takeover:

1. Check whether `claimedAt` is older than roughly 24 hours.
2. Check the task log for recent activity.
3. Inspect the old worktree for uncommitted in-scope work.
4. Read and salvage its evidence.
5. Log the takeover, move through `blocked` or `ready`, then re-claim.

Do not use `--force` only to erase a stale owner.
