import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

test('behavioral checks reject compiling movement, binding, recovery and activity mutants', async () => {
  const entry = fileURLToPath(new URL('../scripts/check-demo-mutations.mjs', import.meta.url));
  const child = spawn(process.execPath, [entry]);
  let output = '';
  child.stdout.on('data', data => { output += data; });
  child.stderr.on('data', data => { output += data; });
  const code = await new Promise((resolve, reject) => {
    child.on('error', reject);
    child.on('close', resolve);
  });
  assert.equal(code, 0, output);
  assert.equal(output.match(/REJECTED compiling behavior mutant/g)?.length, 16, output);
});
