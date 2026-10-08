#!/usr/bin/env node
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtemp, readFile, writeFile, mkdir, rm, cp } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const sdk = fileURLToPath(new URL('../', import.meta.url));
const childEnv = { ...process.env };
// These are independent test runners, not nested node:test workers.
delete childEnv.NODE_TEST_CONTEXT;
const mutations = [
  { name: 'peer-position-response', source: 'demo-policy.js', test: 'demo-policy.test.mjs', pattern: 'seeker replans from a changed peer', before: 'const peerPose = pose(others[0]);', after: 'const peerPose = pose(own);' },
  { name: 'observed-position-arrival', source: 'demo-policy.js', test: 'demo-policy.test.mjs', pattern: 'runner transitions require authoritative arrival', before: 'if (distance(ownPose, arrivalTarget) <= tolerance)', after: 'if (true)' },
  { name: 'current-peer-meeting-dwell', source: 'demo-policy.js', test: 'demo-policy.test.mjs', pattern: 'seeker dwell cannot complete', before: 'const stillArrived = distance(ownPose, meeting ? peerPose : state.target)', after: 'const stillArrived = distance(ownPose, state.target)' },
  { name: 'fresh-meeting-own-travel', source: 'demo-policy.js', test: 'demo-policy.test.mjs', pattern: 'runner approaching a stationary seeker', before: 'state.maxSeparationMm >= REARM_MM && ownTravel() >= MEET_TRAVEL_MM', after: 'state.maxSeparationMm >= REARM_MM' },
  { name: 'position-watchdog', source: 'demo-policy.js', test: 'demo-policy.test.mjs', pattern: 'position watchdog replans within ten seconds', before: 'if (stalledMs >= WATCHDOG_MS || blocked)', after: 'if (false)' },
  { name: 'peer-retarget-does-not-hide-stall', source: 'demo-policy.js', test: 'demo-policy.test.mjs', pattern: 'moving peer retargets', before: "const keepOwnProgress = reason === 'peer-moved' && ['moving', 'dwell'].includes(state.phase);", after: 'const keepOwnProgress = false;' },
  { name: 'explicit-own-binding-gate', source: 'demo-policy.js', test: 'demo-policy.test.mjs', pattern: 'binding gates policy', before: 'observation.selfBodyId === undefined ? undefined : observation.bodies.get(observation.selfBodyId)', after: 'observation.bodies.values().next().value' },
  { name: 'binding-absence-clears', source: 'demo-observation.js', test: 'demo-observation.test.mjs', pattern: 'binding is adopted only', before: 'this.selfBodyId = selfBodyId;', after: 'this.selfBodyId = selfBodyId ?? this.selfBodyId;' },
  { name: 'recovery-clears-binding', source: 'demo-observation.js', test: 'demo-observation.test.mjs', pattern: 'binding is adopted only', before: 'this.selfBodyId = undefined;', after: 'this.selfBodyId = this.selfBodyId;' },
  { name: 'invalid-snapshot-recovers', source: 'demo-client.js', test: 'demo-client.test.mjs', pattern: 'malformed full and invalid delta recover', before: "['BASELINE_MISMATCH', 'INVALID_OBSERVATION'].includes(error.code)", after: "['BASELINE_MISMATCH'].includes(error.code)" },
];

for (const mutation of mutations) {
  // Keep node_modules resolution local and never mutate the implementation.
  const temp = await mkdtemp(join(sdk, '.demo-mutant-'));
  try {
    await mkdir(join(temp, 'src'));
    await mkdir(join(temp, 'test'));
    await mkdir(join(temp, 'scripts'));
    for (const name of ['demo-policy.js', 'demo-observation.js', 'demo-client.js']) await cp(join(sdk, 'src', name), join(temp, 'src', name));
    for (const name of ['demo-policy.test.mjs', 'demo-observation.test.mjs', 'demo-client.test.mjs', 'demo-fixture.mjs']) await cp(join(sdk, 'test', name), join(temp, 'test', name));
    await cp(join(sdk, 'scripts', 'demo.mjs'), join(temp, 'scripts', 'demo.mjs'));
    const path = join(temp, 'src', mutation.source);
    const original = await readFile(path, 'utf8');
    assert.equal(original.split(mutation.before).length, 2, `mutation seam must be unique: ${mutation.name}`);
    await writeFile(path, original.replace(mutation.before, mutation.after));
    const compiled = spawnSync(process.execPath, ['--check', path], { encoding: 'utf8', timeout: 5_000 });
    assert.equal(compiled.status, 0, `mutant must compile: ${mutation.name}: ${compiled.stderr}`);
    const result = spawnSync(process.execPath, ['--test', `--test-name-pattern=${mutation.pattern}`, join(temp, 'test', mutation.test)], { encoding: 'utf8', timeout: 8_000, env: childEnv });
    assert.equal(result.status, 1, `behavior mutant escaped: ${mutation.name}\n${result.stdout}\n${result.stderr}`);
    assert.match(result.stdout, /not ok/);
    assert.match(result.stdout, /ERR_ASSERTION/);
    console.log(`REJECTED compiling behavior mutant: ${mutation.name}`);
  } finally { await rm(temp, { recursive: true, force: true }); }
}
