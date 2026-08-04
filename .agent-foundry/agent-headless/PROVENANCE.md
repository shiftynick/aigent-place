# Bundled agent-headless

- Upstream: `https://github.com/shiftynick/agent-headless`
- Version: `0.2.0`
- CLI artifact: `dist/cli.js`
- CLI SHA-256: `859096bd6c8fd85440c1bae2c7a0892423ed614dd3dacdd00f7c648c152dc6bd`
- Library artifact: `dist/index.js`
- Library SHA-256: `95680e5ffc6182dfe9e2de98edf8a03b72c97f701f148c8bb1ada454038735cc`
- Public base commit: `7600ff8cc6a0e158dbbe7835daed05862aac3810`
- Source commit: `3a631b93e48c88e3f9fcf96ac0509ed4112db371`
- Source patches:
  - `source/0001-feat-harden-unified-runner-for-Node-20-consumers.patch.b64`: `a23f3f15a13024043761ffe54adc4360d2c5fb4f1a7eff806de07ca7f63bb07b`
  - `source/0002-fix-tighten-least-privilege-and-cancellation-contrac.patch.b64`: `bd04083e8f3ea06f09edfd844b5fd8828160822a0b1cc31682330a2a4193f01e`
- License: `MIT` (see adjacent `LICENSE`)
- Runtime: Node.js 20+

The source commit need not already be published: base64-decode and apply the
listed patches in order to the public base commit to reconstruct it. Foundry validation verifies
all artifact and patch hashes. The runtime is dependency-free; refresh it only
through a Foundry release after upstream tests, license review, dependency
audit, and review of relevant Node security advisories.
