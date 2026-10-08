#!/usr/bin/env node
import { DemoBrainClient } from '../src/demo-client.js';
import { DemoError } from '../src/demo-observation.js';
import { pathToFileURL } from 'node:url';

/** The journal/cast assertion is explicit; it cannot inspect the server disk. */
export function parseOptions(args, env = process.env) {
  const values = new Map();
  for (let index = 0; index < args.length; index++) {
    const option = args[index];
    if (!['--role', '--ws', '--id', '--duration', '--fresh-two-body'].includes(option) || values.has(option)) throw new DemoError('INVALID_OPTIONS', `unknown or duplicate option ${option}`);
    if (option === '--fresh-two-body') values.set(option, true);
    else {
      const value = args[++index];
      if (value === undefined || value.startsWith('--')) throw new DemoError('INVALID_OPTIONS', `missing value for ${option}`);
      values.set(option, value);
    }
  }
  const role = values.get('--role');
  if (!['runner', 'seeker'].includes(role) || !values.has('--fresh-two-body')) throw new DemoError('INVALID_OPTIONS', 'usage: --role runner|seeker --fresh-two-body [--ws URL] [--id ID] [--duration SECONDS]; use a fresh journal and only these two bodies');
  const duration = values.has('--duration') ? Number(values.get('--duration')) : 0;
  if (values.has('--duration') && (!Number.isFinite(duration) || duration <= 0 || duration > 3_600)) throw new DemoError('INVALID_OPTIONS', '--duration must be positive and at most 3600 seconds');
  return {
    role, url: values.get('--ws') ?? env.AIGENT_WS_URL ?? 'ws://127.0.0.1:7600/ws',
    aigentId: values.get('--id') ?? env.AIGENT_ID ?? `demo-${role}`, durationMs: duration * 1_000,
  };
}

async function main() {
  const lifecycle = new AbortController();
  const stop = () => lifecycle.abort();
  process.once('SIGINT', stop);
  process.once('SIGTERM', stop);
  try {
    const client = new DemoBrainClient({ ...parseOptions(process.argv.slice(2)), log: event => console.log(JSON.stringify(event)) });
    await client.run(lifecycle.signal);
    console.log(JSON.stringify({ source: 'aigent-demo', type: 'stopped' }));
  } catch (error) {
    console.error(JSON.stringify({ source: 'aigent-demo', type: 'failure', code: error.code ?? 'DEMO_ERROR', message: error.message }));
    process.exitCode = 1;
  } finally {
    process.removeListener('SIGINT', stop);
    process.removeListener('SIGTERM', stop);
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) await main();
