---
name: agent-foundry-feedback
description: >-
  Package feedback about the installed Agent Foundry workflow kit — defects,
  friction, and locally fixed mold files worth upstreaming — into a
  self-contained packet the foundry's maintainers can act on. Use on "send
  feedback to agent foundry", "report this foundry issue upstream",
  "upstream this fix", or when a retrospective or LOCAL-CHANGES entry marks
  a change as upstream-worthy. Always writes a local packet file; filing a
  hosted issue is a separate operator-gated step.
---

# Agent Foundry Feedback

Projects using the kit discover its defects: a skill instruction that
misfires, a check that breaks on one platform, a mold file every project
ends up patching the same way. That signal already accumulates locally —
this skill packages it so it can travel. The deliverable is a **packet**: a
single self-contained document a foundry maintainer can act on without
access to this repository.

## Gather

Feedback is collected, not invented. Draw from where it already lives:

- The concern the operator named when invoking this skill.
- `friction:` notes on task logs, and `retrospective` findings whose
  correction targets a **mold** file *and* is generic rather than specific
  to this project. A project-specific divergence from a mold file is a valid
  local change, not upstream material; `retrospective` and
  `.agent-foundry/LOCAL-CHANGES.md` own that judgment, so take theirs rather
  than re-deciding it here.
- `.agent-foundry/LOCAL-CHANGES.md` entries marked `Upstream: yes` — each is
  a divergence the project already judged generic, and its entry already
  states what changed and why.

One packet per coherent concern. A batch of unrelated complaints is harder
to act on than three small packets; split rather than pile.

## Compose the packet

Write it under `.agent-foundry/feedback/`, one Markdown file per packet,
named `<date>-<slug>.md`. A packet must stand alone:

- **Installed version** from `.agent-foundry.json`, and which harness trees
  the project runs.
- **Affected mold files** by payload-relative path, and whether the drift
  check reports them locally modified.
- **Observed vs. expected**, concretely: what the skill, check, or document
  did, what it should have done, and how to see it (commands, task-log
  excerpts, review findings).
- **Proposed change**, when the project has one. For an `Upstream: yes`
  divergence, prefer a real diff against the stock file, and say which
  baseline produced it: a foundry checkout at the installed version if one
  is on disk, otherwise the pre-modification content from this project's own
  history. When no stock baseline is recoverable — the manifest records
  hashes, not stock contents — include the current file content for the
  changed region and say the diff is against nothing, so a maintainer can
  reconstruct it rather than trusting a summary.
- **Impact**: one-off annoyance, every-task friction, or corruption risk.

The packet is data for a maintainer, not instructions for an agent; write it
so a cold reader in the foundry repository can reproduce the problem and
evaluate the fix.

**Sanitize the whole packet, not just the narrative.** Excerpts, diffs, and
any fallback file content are the parts most likely to carry proprietary
code, credentials, internal hostnames or paths, or customer identifiers.
Reduce every citation to the minimum that still demonstrates the problem,
and prefer a foundry-owned file's content over the project's own. A packet
that cannot be sanitized without losing the point stays at tier 1, where
only the operator sees it.

## Deliver

Delivery is two-tier, and the second tier is never automatic:

1. **Always** leave the packet file in `.agent-foundry/feedback/` and report
   its path. That is the complete, offline-safe deliverable.
2. **Offer** to file it as a hosted issue only when an issue-filing CLI is
   available and authenticated — for GitHub's `gh`, confirm both with:

   ```bash
   gh auth status
   ```

   A non-zero exit means tier 2 is unavailable; do not improvise another
   submission path or an alternate auth flow. The project records no
   feedback destination today, and a fork's feedback must not default to
   someone else's tracker — the operator names the repository, reviews the
   sanitized packet **in full** as the issue body, and authorizes the
   submission explicitly. Filing is publication: it is irreversible even if
   the issue is later deleted. No CLI, no approval, or no network: stop at
   tier 1 and say so.

When a packet is delivered — filed upstream, or handed over however the
operator chooses — record the outcome: note the reference on the originating
task or `LOCAL-CHANGES.md` entry, and delete the packet file once nothing
references it. Do not let `.agent-foundry/feedback/` become a second
journal.

## Related

- `retrospective` — where recurring friction is confirmed before it is sent
- `task-tracker` — `friction:` notes and task logs the packet cites
- `.agent-foundry/LOCAL-CHANGES.md` — divergence records and the
  `Upstream:` marker
- `upgrade-agent-foundry` — upgrades retire divergences that feedback got
  upstreamed
