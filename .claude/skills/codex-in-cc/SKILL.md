---
name: codex-in-cc
description: How to call the Codex CLI (GPT-5.x) from Claude Code as a delegated worker or cold-context second opinion — invocation contract, sandbox/safety rules, prompt discipline, and result handling. Reach for it when you want a different model family to implement, review, or research a bounded slice.
---

# Codex in Claude Code

Run the **Codex CLI** (`codex exec`) as a delegated worker from inside Claude
Code — for a cold-context second opinion, an adversarial review, or a bounded
implementation slice handled by a different model family (GPT-5.x) than the
one orchestrating.

This is a **standalone contract built on the raw `codex exec` CLI**. It is
distilled from OpenAI's `codex-plugin-cc` (its `codex-cli-runtime`,
`codex-result-handling`, and `gpt-5-4-prompting` skills) but deliberately does
**not** depend on that plugin's companion runtime or app-server broker. If the
plugin is ever installed, prefer its `/codex:*` commands; otherwise use the
CLI directly as described here.

Verified against `codex-cli 0.144.1`. Confirm with `codex --version`; if a flag
is missing, check `codex exec --help`.

## When to reach for Codex

Good fits:
- **Cold-context fresh eyes.** A reviewer that never saw your reasoning and
  reaches its own conclusion from the artifact alone — the two-axis review
  pattern (spec-vs-impl, standards-vs-code).
- **A different model family** on an implementation or diagnosis slice, so a
  bug or blind spot that one family shares doesn't survive both.
- **A bounded, well-specified unit of work** you can hand off with a clean
  packet and verify from the outside (diff + tests).

Poor fits — keep these local:
- Tiny edits, or work where the *judgment* (not the labor) is the hard part.
- Anything needing live chat context that can't be written into the prompt.

## Core invocation

```bash
codex exec [OPTIONS] "PROMPT"        # prompt as arg, or "-" / piped stdin
codex exec resume --last "PROMPT"    # continue the most recent session
codex exec resume <SESSION_ID> "…"   # continue a specific session
```

Flags that matter (from `codex exec --help`):

| Flag | Use |
| --- | --- |
| `-s, --sandbox <MODE>` | `read-only` (default here), `workspace-write`, `danger-full-access` |
| `-C, --cd <DIR>` | Set the working root (pass the repo path explicitly) |
| `--skip-git-repo-check` | Allow running outside a git repo |
| `-o, --output-last-message <FILE>` | Write Codex's final message to a file — the clean way to capture the answer |
| `--json` | Stream events as JSONL on stdout (progress + structured turns) |
| `--output-schema <FILE>` | Enforce the final message against a JSON Schema |
| `-m, --model <MODEL>` | Pick the model — **leave unset unless asked** |
| `--add-dir <DIR>` | Extra writable dir alongside the workspace |
| `--ephemeral` | Don't persist a session file (no resume afterward) |

`-C` takes the repository root. Resolve it rather than hardcoding a path, so
the call works from any checkout or worktree:

```bash
REPO_ROOT="$(git rev-parse --show-toplevel)"
```

Canonical read-only review call:

```bash
codex exec --skip-git-repo-check -C "$REPO_ROOT" -s read-only \
  -o "$SCRATCH/codex-review.md" "$(cat prompt.txt)"
```

Canonical write-capable implementation call:

```bash
codex exec --skip-git-repo-check -C "$REPO_ROOT" -s workspace-write \
  -o "$SCRATCH/codex-result.md" "$(cat prompt.txt)"
```

Put the prompt in a file and pass it via `"$(cat prompt.txt)"` (or pipe it on
stdin) — long prompts with quotes and newlines don't survive being inlined on
a shell line, especially under PowerShell. Capture the answer with `-o`; poll
`--json` only when you need live progress or the structured turn stream.

## Sandbox and safety

- **Default to `read-only`.** Only escalate to `workspace-write` when the slice
  is explicitly an *implementation* task that must edit files.
- **Never** use `danger-full-access`, `--dangerously-bypass-approvals-and-sandbox`,
  or `--dangerously-bypass-hook-trust`. If a task seems to need them, stop and
  hand it back to the operator.
- Sandbox *enforcement* is platform-dependent (strong on Linux; weaker or
  absent on Windows). So treat every `workspace-write` run as an agent with
  real edit power: know the git tree is clean first, scope the writable root
  with `-C`, and **review the resulting `git diff` before keeping anything.**
- Codex needs auth (`codex login`, or `CODEX_HOME`/API key). If a run reports
  that setup or authentication is required, that is the **operator's** action —
  surface it, don't improvise an alternate auth flow.

## Prompt discipline

Prompt Codex **like an operator, not a collaborator**: compact,
block-structured with XML tags, one clear task per run. State the task, the
output contract, the follow-through default, and only the extra constraints
that matter. Tighten the prompt before you reach for more reasoning or a bigger
model.

Assembly checklist:
1. Define the exact task and scope in `<task>`.
2. Choose the smallest output contract that still makes the answer easy to use.
3. Decide whether Codex keeps going by default or stops for missing high-risk
   details.
4. Add verification / grounding / safety blocks only where the task needs them.
5. Delete redundant instructions before sending.

Which blocks to add, by task type:
- **Coding / debugging:** `completeness_contract`, `verification_loop`,
  `missing_context_gating`.
- **Review / adversarial review:** `grounding_rules`,
  `structured_output_contract`, `dig_deeper_nudge`.
- **Research / recommendation:** `research_mode`, `citation_rules`.
- **Write-capable:** add `action_safety` so Codex stays narrow.

### Reusable blocks

Wrap each in the XML tag shown. Use only the ones the task needs.

```xml
<task>The concrete job, the relevant repo/failure context, and the expected end state.</task>

<structured_output_contract>Return exactly the requested shape and nothing else. Compact. Highest-value findings first.</structured_output_contract>
<compact_output_contract>Keep the final answer compact and structured. No long scene-setting or recap.</compact_output_contract>

<default_follow_through_policy>Default to the most reasonable low-risk interpretation and keep going. Only stop to ask when a missing detail changes correctness, safety, or an irreversible action.</default_follow_through_policy>
<completeness_contract>Resolve the task fully before stopping. Don't stop at the first plausible answer; check for follow-on fixes, edge cases, and cleanup.</completeness_contract>
<verification_loop>Before finalizing, verify the result against the requirements and the changed files/tool outputs. If a check fails, revise instead of reporting the first draft.</verification_loop>

<missing_context_gating>Don't guess missing repo facts. Retrieve them with tools, or state exactly what remains unknown.</missing_context_gating>
<grounding_rules>Ground every claim in provided context or your tool outputs. Don't present inferences as facts; label hypotheses.</grounding_rules>
<citation_rules>Back important claims with references to the source you inspected. Prefer primary sources.</citation_rules>

<action_safety>Keep changes tightly scoped to the stated task. Avoid unrelated refactors/renames/cleanup unless required for correctness. Call out risky or irreversible actions before taking them.</action_safety>
<research_mode>Separate observed facts, reasoned inferences, and open questions. Breadth first, then depth only where evidence changes the recommendation.</research_mode>
<dig_deeper_nudge>After the first plausible issue, check second-order failures, empty-state behavior, retries, stale state, and rollback paths before finalizing.</dig_deeper_nudge>
<progress_updates>Keep any progress updates brief and outcome-based — only major phase changes or blockers.</progress_updates>
```

## Model and effort

- **Leave `--model` unset by default** — the account default is almost always
  right. Add `-m` only when the operator asks for a specific model.
- Codex also takes `--effort` (`none | minimal | low | medium | high | xhigh`).
  Leave it unset unless asked. Reach for higher effort on hard verification /
  review, not as a first move — tighten the prompt contract first.
- When a run disappoints, diagnose in order: **context → effort → model.** A
  vague packet explains most weak results; "didn't try hard enough" is an
  effort problem; "confidently wrong despite good context" is a model problem.

## Handling Codex's results

Treat the output as a **lead, not a fact** — the same bar as any delegated
worker. Then present it honestly:

- Preserve Codex's structure: verdict, summary, findings, next steps. For
  reviews, findings first, ordered by severity, with file:line exactly as
  reported.
- Preserve evidence boundaries. Keep Codex's own distinction between observed
  fact, inference, and open question — don't launder a hypothesis into a fact.
- If there were no findings, say so plainly and keep the residual-risk note
  short.
- If Codex made edits, say so and list the touched files; then **review the
  `git diff` yourself** before relying on it.
- **After a review, STOP. Do not auto-apply fixes** — even obvious ones. Report
  the findings and ask which, if any, to fix before touching a file.
- If the run **failed or was never successfully invoked**, report the failure
  with the most actionable stderr lines and stop. Do **not** silently
  substitute your own answer for a Codex run that didn't happen.

## Resume

For a follow-up on the same thread, use `codex exec resume --last "…"` (or a
specific `<SESSION_ID>`) and send **only the delta** instruction — don't
restate the whole prompt unless the direction changed materially. `--ephemeral`
runs leave no session to resume.
