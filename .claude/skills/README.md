# Project-local skills

`.claude/skills/` is the project's Claude Code mirror of the reusable
workflows installed by Agent Foundry.

## Included

| Skill | Role |
| --- | --- |
| `task-tracker` | Durable file-based kanban and dependency graph. |
| `plan-milestone` | Operator-approved decomposition of goals into task fronts. |
| `execute-task` | Rubric through implementation, review, validation and commit. |
| `attack-the-board` | Front-loaded question harvest, then an autonomous multi-task run. |
| `adr` | MADR-style architecture decision workflow. |
| `diagnosing-bugs` | Feedback-loop-first diagnosis. |
| `codebase-audit` | Periodic sweep for accumulated quality drift. |
| `retrospective` | Periodic mining of process friction into corrected guidance. |
| `efficient-orchestration` | Top-tier model orchestrates; workhorse tiers do bounded slices. |
| `handoff-writer` | Cold-start session handoff. |
| `the-fool` | Adversarial review of ideas and plans. |
| `grill-me` | Deliberate one-question-at-a-time decision interview. |
| `agent-headless` | Unified safe Claude, Codex, and operator-selected Cursor invocation. |
| `upgrade-agent-foundry` | Guided in-place upgrade of the installed workflow kit. |
| `agent-foundry-feedback` | Package kit defects and upstream-worthy fixes into feedback packets. |

## Rules

- Shared workflow skills must remain semantically synchronized with the
  counterpart harness tree; only harness-specific invocation paths should
  differ. Edit both copies in the same commit and verify with
  `node .agent-foundry/check-skill-sync.mjs`.
- Shared workflow skills must be model- and vendor-neutral.
- Shared scripts should remain byte-equivalent where they do not embed a
  harness path.
- Skills may reference only repository paths that exist, plus external CLIs
  whose verification contract is documented by `agent-headless`.
- A skill change is reviewed like code: trigger accuracy, instructions,
  repository references, and a real invocation when scripts are involved.
- Provider mechanics belong exclusively to `agent-headless`.
- Do not add orchestration or dashboard skills until a concrete project need
  justifies their maintenance cost.
