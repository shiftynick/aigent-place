# Foundry-allowed models

Exact `--model` IDs for `agent-headless`. The runner prints these lists
and rejects anything outside them. Do not invent IDs or paste one
provider's spelling into another.

```text
node .agent-foundry/agent-headless/cli.js models claude
node .agent-foundry/agent-headless/cli.js models codex
node .agent-foundry/agent-headless/cli.js models cursor
```

## Claude (`--provider claude`)

| Role | Exact `--model` | Effort |
| --- | --- | --- |
| Fable | `claude-fable-5` | Defaults to **`low`** when omitted; set higher only when the operator asks |
| Opus | `claude-opus-5` | Separate `--effort` |
| Sonnet | `claude-sonnet-5` | Separate `--effort` |

Aliases `fable`, `opus`, and `sonnet` are accepted; prefer the full IDs above
in recorded commands. Never use Cursor spellings such as
`claude-fable-5-thinking-high` or `claude-opus-5-high`.

## Codex (`--provider codex`)

| Role | Exact `--model` |
| --- | --- |
| Sol | `gpt-5.6-sol` |
| Terra | `gpt-5.6-terra` |
| Luna | `gpt-5.6-luna` |

Effort is separate (`none` / `low` / `medium` / `high` / `xhigh`). These IDs
are Codex-only.

## Cursor (`--provider cursor`)

| Exact `--model` | Notes |
| --- | --- |
| `cursor-grok-4.5-medium` | **Default** when `--model` is omitted (`modelDefaulted`) |
| `cursor-grok-4.5-low` | |
| `cursor-grok-4.5-high` | |
| `composer-2.5` | |
| `composer-2.5-fast` | Composer only |

Grok **fast** variants (`…-fast`) are rejected. Cursor may expose many other
catalog IDs; Foundry does not allow them.

## Operator shorthand

| Said | Provider | Pass |
| --- | --- | --- |
| Cursor / Grok | cursor | `cursor-grok-4.5-medium` (or `-high` / `-low` if named) |
| Composer | cursor | `composer-2.5` |
| Codex Sol / Terra / Luna | codex | `gpt-5.6-sol` / `gpt-5.6-terra` / `gpt-5.6-luna` |
| Claude Fable / Opus / Sonnet | claude | `claude-fable-5` / `claude-opus-5` / `claude-sonnet-5` |
