---
name: grill-me
description: >-
  Grill the user relentlessly about a plan, decision, or idea until
  reaching shared understanding, walking every branch of the decision
  tree one question at a time. Use when the user wants to stress-test
  their thinking, nail down what they actually want, or uses any
  'grill' trigger phrase.
---

# Grill Me

Interview the user relentlessly about every aspect of the topic until you
reach a shared understanding. Walk down each branch of the decision tree,
resolving dependencies between decisions one by one. The output of a good
grilling is not a transcript — it's a resolved decision tree the user has
confirmed.

## Ground rules

- **One question at a time**, waiting for the answer before continuing.
  Multiple questions at once is bewildering, and later questions usually
  depend on earlier answers anyway.
- **Every question comes with your recommended answer** and a one-line
  reason. A bare question offloads work; a recommendation gives the user
  something to react to — confirming is cheap, and disagreement is
  informative.
- **Facts are yours; decisions are the user's.** If a *fact* can be found
  by exploring the environment (filesystem, code, docs, tools), look it up
  instead of asking. The *decisions* — tradeoffs, priorities, intent — are
  the user's: put each one to them and wait.
- **Do not act until the user confirms** shared understanding has been
  reached. Grilling is the deliverable; execution is a separate, explicit
  step.

## Running the interview

1. **Map before you drill.** Skim the topic and privately sketch the
   major branches (scope, users, constraints, architecture, risks,
   sequencing — whatever fits). Don't show the whole map as a wall of
   questions; use it to pick the next question.
2. **Order by dependency.** Ask first the questions whose answers change
   the most downstream questions. When an answer prunes a branch, say so
   and skip it — don't ask questions the tree no longer needs.
3. **Chase vagueness.** "Fast", "simple", "flexible", "later" are not
   answers — follow up until the answer is concrete enough that two
   different implementations couldn't both claim to satisfy it.
4. **Surface contradictions immediately.** When an answer conflicts with
   an earlier answer, a recorded decision (ADR, out-of-scope entry), or
   something true in the environment, name the conflict and ask which
   side wins — don't silently reconcile it yourself.
5. **Keep a running ledger.** Maintain a compact list of decisions made
   so far (one line each). Every handful of questions — and whenever a
   big branch closes — replay the ledger so drift is caught early, and
   confirm before descending further.
6. **Close branches explicitly.** "That settles X; open branches: Y, Z."
   The user should always know how much tree is left.
7. **Know when to stop.** When remaining questions wouldn't change what
   gets built or decided, say so and move to wrap-up — relentless is not
   the same as endless.

## Wrap-up

Present the final ledger: every decision, each with its one-line
rationale, plus explicitly-parked items (open questions deliberately
deferred, with what would reopen them). Ask for confirmation that it
matches the user's intent.

After confirmation, recommend durable homes for the results:
architecture-significant decisions in ADRs, rejected directions in the
out-of-scope KB, and follow-up work on the task board. Write those artifacts
only when the user explicitly asks for or authorizes that execution step.
