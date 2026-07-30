# Durable task authoring

Read this file completely before filing work that will remain in the backlog.

- Describe behavior, interfaces, and concepts rather than current file paths
  or line numbers. Paths are acceptable only for work claimed immediately.
- Size a task to one fresh execution context: understand, implement, review,
  validate, document, and commit.
- Split larger work into dependency-ordered cards using `--blocked-by`.
- State observable acceptance outcomes that a cold reader can verify; avoid
  “clean up” or “improve” without a measurable result.
- Assign `milestone:<name>` only when the card belongs to an
  operator-approved front. Use `phase:<name>` for kind or provenance.

Example:

```bash
node .claude/skills/task-tracker/scripts/task.mjs add \
  "Reject invalid settings on every write path" \
  --priority p1 \
  --tag area:core \
  --blocked-by task-007 \
  --description "All settings mutation interfaces share validation; invalid input returns the documented failure and leaves persisted state unchanged."
```
