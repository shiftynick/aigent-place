---
name: grill-me
description: >-
  Run a one-question-at-a-time decision interview about a plan, choice, or
  idea until the user's intent is clear. Use when the user wants to stress-test
  their thinking, decide what they actually want, or uses any 'grill' trigger
  phrase.
---

# Grill Me — Decision Interview

Help the user make the decisions that would materially change the result.

Keep the reasoning map private. The human experience is a short STE
conversation. It is not a display of the agent's decision tree.

`docs/SDLC.md` → "Operator communication" (ASD-STE100) is the authority for
human-facing language. The rules below apply that contract to a decision
interview.

## Ground rules

- Apply the SDLC question rule through the question format below. Wait for
  the answer before continuing.
- Spend fewer words on choices whose consequences are small and easy to undo.
- Look up discoverable facts. Ask the user only for intent, priorities, and
  trade-offs that evidence cannot decide.
- Do not act until the user confirms the resulting decisions.

## Run the interview

1. Privately map the decisions that could change the result. Do not show the
   map or a wall of questions unless the user asks for it.
2. Ask the most consequential unresolved choice first. Skip questions made
   irrelevant by an earlier answer.
3. Show a light progress estimate such as `Decision 2 of about 5`. Update the
   estimate honestly as answers remove or reveal choices.
4. Challenge vague words such as "fast," "simple," or "later" only when the
   ambiguity could produce meaningfully different work. Continue until two
   different implementations could no longer both claim to satisfy the answer.
5. If an answer conflicts with earlier intent, repository evidence, or a
   recorded decision, explain the practical conflict. Ask which should win.
   Never silently resolve the contradiction yourself.
6. After a meaningful choice, keep orientation compact: `Decided: ...` and
   `Still open: ...`. Do not repeatedly replay the full history.
7. Stop when another answer would not change what gets built or decided.

## Question format

A normal question uses this compact shape:

```text
Decision 2 of about 5: <plain question>
Recommendation: <answer>, because <short reason>.
If wrong: <practical effect>; <easy or hard> to undo.
```

## Wrap up

Return a compact list of confirmed decisions and their reasons. Follow with
anything deliberately left open and what would make it relevant. Ask the user
to confirm that this matches their intent.

After confirmation, suggest the existing durable home that fits each result:
an ADR for a costly architecture choice, the out-of-scope record for a rejected
direction, or the task board for follow-up work. Write those artifacts only
when the user explicitly authorizes execution.
