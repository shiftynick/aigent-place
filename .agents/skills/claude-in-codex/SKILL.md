---
name: claude-in-codex
description: >-
  Compatibility alias for requests to ask Claude from Codex. Use the shared
  agent-headless skill with provider claude; this alias retires after 0.15.x.
---

# Claude in Codex compatibility alias

Read `../agent-headless/SKILL.md` completely and follow it with
`--provider claude`. `docs/SDLC.md` still requires Claude as Codex's normal
different-family cold reviewer. This alias has no independent invocation
rules; its legacy wrapper remains only for 0.15.x command compatibility.
Existing callers may continue using
`scripts/claude-ask.mjs --help`; the wrapper is frozen except for security or
compatibility fixes and must not gain new provider policy.
