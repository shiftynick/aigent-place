# agent-headless compatibility matrix

Runtime probes add executable availability and version to these static
capabilities. Unsupported combinations fail before provider invocation.

| Capability | Claude | Codex | Cursor |
| --- | --- | --- | --- |
| Answer-only | yes, tools disabled | yes, read-only sandbox | yes, ask mode |
| Read-only inspection | yes | yes | yes, plan mode |
| In-place workspace edits | yes | yes | unsupported |
| Isolated worktree edits | yes | unsupported | yes |
| Ephemeral sessions | yes | yes | unavailable |
| Resume | yes | yes, inherits original access | yes |
| Effort | native flag | config override except `max` | exact model variant |
| JSON Schema output | yes | file-based | unavailable |
| Per-run budget | yes | unavailable | unavailable |
| Model listing | unavailable | unavailable | yes |

Cursor's worktree does not sandbox arbitrary shell effects on Windows.
Cursor rejects `auto`; when no model is named it falls back to a documented
default and reports `modelDefaulted`, so a caller can tell whether the operator
chose the model. Name one explicitly for cold review.
