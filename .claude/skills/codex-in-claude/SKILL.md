---
name: codex-in-claude
description: >-
  Compatibility alias for requests to ask Codex from Claude Code. Use the
  shared agent-headless skill with provider codex; this alias retires after
  0.15.x.
---

# Codex in Claude compatibility alias

Read `../agent-headless/SKILL.md` completely and follow it with
`--provider codex`. `docs/SDLC.md` still requires Codex as Claude Code's normal
different-family cold reviewer. This alias has no independent invocation
rules; raw Codex commands remain supported only as a 0.15.x transition.
Existing callers may continue using the documented raw `codex exec` surface;
this alias is frozen except for security or compatibility fixes.
