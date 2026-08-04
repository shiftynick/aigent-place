---
name: agent-headless
description: >-
  Invoke Claude Code, Codex CLI, or Cursor Agent through the Foundry's unified
  safe headless runner for cold reviews, second opinions, research, or bounded
  delegated work. Cursor and its exact model remain operator-selected.
---

# Agent Headless

Use the Foundry-owned Node entry point:

```text
node .agent-foundry/agent-headless/cli.js <command>
```

`docs/SDLC.md` remains authoritative for model-family selection, the separate
SPEC/STANDARDS reviews, packet completeness, permissions, and adjudication.
This skill owns only safe, consistent provider invocation.

## Preflight

Executable/version probes were rechecked on 3 August 2026. Flag contracts were
last verified against help for Claude Code 2.1.220 and Codex CLI 0.145.0 on
27 July, and Cursor Agent 2026.07.23-e383d2b on 30 July 2026. Run the capability
probe and re-check help before relying on version-sensitive flags; an
unknown-flag failure means the adapter aged.

Probe the selected provider before constructing a costly call:

```text
node .agent-foundry/agent-headless/cli.js capabilities claude
node .agent-foundry/agent-headless/cli.js capabilities codex
node .agent-foundry/agent-headless/cli.js capabilities cursor
node .agent-foundry/agent-headless/cli.js models cursor
```

Require `availability: "available"`. Report a `missing` or `unusable` reason
instead of silently substituting another model. Set `CLAUDE_BIN`, `CODEX_BIN`,
or `CURSOR_AGENT_BIN` for nonstandard installs. Windows `.cmd` shims work.

## Provider selection

Follow `docs/SDLC.md` for provider/model-family selection and review-axis
separation. Once selected, pass that provider to `--provider`. Model and effort
are optional transport inputs except that Cursor requires an exact model ID
and rejects `auto`; inherit defaults unless the operator or workflow chose
otherwise. See `.agent-foundry/agent-headless/COMPATIBILITY.md` for the static
provider matrix.

## Safe calls

Put non-trivial prompts and complete packets in UTF-8 files:

```text
node .agent-foundry/agent-headless/cli.js run --provider claude --cwd <repo> --access answer-only --session ephemeral --prompt-file <review.md> --timeout-ms 1200000 --max-budget-usd 3
node .agent-foundry/agent-headless/cli.js run --provider codex --cwd <repo> --access answer-only --session ephemeral --prompt-file <review.md> --timeout-ms 1200000
node .agent-foundry/agent-headless/cli.js run --provider cursor --cwd <repo> --model <exact-id> --access answer-only --prompt-file <review.md> --timeout-ms 1200000 --trust-workspace
```

For cold review, follow `../execute-task/references/cold-review.md` when building
the packet. An `answer-only` reviewer cannot inspect omitted files or execute
tests; it reasons only from the supplied packet and recorded evidence.

`--trust-workspace` is an explicit assertion. Use it only after resolving and
checking the intended workspace.

For bounded implementation, request write access explicitly:

```text
node .agent-foundry/agent-headless/cli.js run --provider claude --cwd <repo> --access edit-isolated --prompt-file <task.md>
node .agent-foundry/agent-headless/cli.js run --provider codex --cwd <repo> --access edit-workspace --prompt-file <task.md>
node .agent-foundry/agent-headless/cli.js run --provider cursor --cwd <repo> --model <exact-id> --access edit-isolated --prompt-file <task.md> --trust-workspace
```

Before every write call, confirm the source checkout is clean, state the
mutation ceiling and writable root, and inspect every resulting caller/worktree
diff before keeping it. A worktree isolates checkout edits, not arbitrary host
shell effects.

Cursor write work requires the operator's explicit request. Codex has no
portable isolated-worktree mode here, so scope and inspect its workspace diff.
On Windows, Cursor's worktree isolates checkout edits but does not sandbox
arbitrary shell effects; do not delegate the write when that residual risk is
unacceptable. Never compensate for a failure with dangerous bypass flags.

## Sessions and output

- Claude and Codex default to ephemeral sessions; Cursor persists because its
  CLI has no ephemeral mode.
- Resume only when requested. Codex resume must use `--access inherit-session`.
- Add `--json` for the normalized result. Library events preserve raw provider
  data and add stable lifecycle kinds.
- Treat responses as delegated evidence. Verify findings and record provider,
  selected model, and cold-review rung in the task log.

## Safety boundary

The runner never emits dangerous flags that disable approval or sandbox
systems. Explicit write modes use the provider's normal noninteractive write
policy, so they still carry real write authority. The runner sends prompts on
stdin, validates capability combinations, pins workspace roots, and terminates
provider process trees on timeout or cancellation. Do not call a raw provider
CLI merely to evade a rejected combination.
