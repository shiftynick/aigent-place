---
name: project-orientation
description: >-
  Use when the operator asks for current project status, direction, active or
  recent work, changes since the last look, or a visual overview, or when an
  agent resumes without enough current context. Use task-tracker instead to
  inspect or change individual board records.
---

# Project Orientation

Use the Foundry status projection for a concise view of project direction,
Git state, active work, recent completions, and the latest recorded checks.
It is a read-only projection of project sources, not another task store.

## Choose the view

For a short human-facing view:

```text
node .agent-foundry/project-status.mjs
```

For a stable generated-data consumer:

```text
node .agent-foundry/project-status.mjs --json
```

For a self-contained visual overview:

```text
node .agent-foundry/project-overview.mjs
```

The overview command refreshes the Git-ignored
`.agent-foundry/project-overview.html` file. Use `--stdout` when a consumer
needs the complete HTML without writing that file.

## Since the last look

Use this only when the operator asks to establish a new comparison point or
has received the status that will become that point:

```text
node .agent-foundry/project-status.mjs --mark-seen
```

It prints the same status and writes the Git-ignored
`.agent-foundry/project-status-seen.json` marker. Do not mark a cold-start
inspection as seen before the operator receives it.

## Interpret the projection

- The task board remains the source of task truth. Use `task-tracker` for task
  details, selection, and mutations.
- The planning journal remains the source of the approved milestone front.
- Git remains the source of branch, commit, and worktree state.
- Recorded task runs remain the source of validation evidence.
- Treat `null`, `unknown`, truncation flags, and warnings as missing or limited
  evidence. Do not turn them into a healthy-state claim.
- Regenerate the overview on demand. Its generated timestamp shows staleness;
  do not hand-edit it or treat it as maintained project state.

Report the result in operator language. Lead with the practical status and the
next decision or executable task. Give raw JSON only when requested or when a
tool consumes it.

## Related

- `task-tracker` - individual board records and board mutations
- `plan-milestone` - approved direction and task-front creation
- `handoff-writer` - durable restart-from-cold session handoff
- `.agent-foundry/README.md` - project-status schema and installed tool details
