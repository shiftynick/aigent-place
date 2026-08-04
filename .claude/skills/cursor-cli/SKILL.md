---
name: cursor-cli
description: >-
  Compatibility alias for operator-selected Cursor CLI work. Use the shared
  agent-headless skill with provider cursor and an exact operator-named model;
  this alias retires after 0.15.x.
---

# Cursor CLI compatibility alias

Read `../agent-headless/SKILL.md` completely and follow it with
`--provider cursor`. Cursor and its exact model remain operator-selected. This
alias has no independent policy; its legacy wrapper remains only for 0.15.x
command compatibility.
Existing callers may continue using
`scripts/cursor-agent.mjs --help`; the wrapper is frozen except for security or
compatibility fixes and must not gain new provider policy.
