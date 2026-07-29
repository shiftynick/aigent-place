# Architecture Decision Records

Architecture-significant decisions are recorded here as one MADR-style file
per decision.

## Process

1. Copy `template.md` to `NNNN-short-kebab-title.md` using the next free,
   zero-padded number.
2. Record context, options genuinely considered, the decision, and good and
   bad consequences while deliberation is fresh.
3. Agent-authored ADRs start as `proposed`.
4. Only explicit operator agreement changes status to `accepted`.
5. Add or update the index row in the same task.
6. Never rewrite an accepted ADR. Supersede it with a new ADR and update the
   old status.

## Statuses

`proposed -> accepted -> superseded/deprecated`

`rejected` records a formally considered proposal that was declined.

## Index

| ID | Title | Status |
| --- | --- | --- |
| _none_ | No architecture decisions recorded yet. | — |

