#!/usr/bin/env node
// delegate-work.mjs — Foundry preset for bounded implementation via agent-headless.
//
// Wraps a write-access headless run with fixed flags and a required
// "Environment facts" section in the prompt (session-learned auth, paths,
// memory pointers the parent already paid to discover).
//
//   node .agent-foundry/delegate-work.mjs \
//     --provider claude|codex|cursor \
//     --prompt-file <path> \
//     [--model <id>] [--cwd <repo>] [--timeout-ms 1200000] \
//     [--access edit-isolated|edit-workspace] \
//     [--trust-workspace] [--dry-run]

import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { argv, exit, stderr, stdout } from "node:process";
import { fileURLToPath } from "node:url";
import { runManagedNode } from "./process-tree.mjs";

const DEFAULT_TIMEOUT_MS = 20 * 60 * 1000;
const HERE = dirname(fileURLToPath(import.meta.url));
const DEFAULT_RUNNER = join(HERE, "agent-headless", "cli.js");
const PROVIDER_GRACE_MS = 5_000;

const ACCESS_BY_PROVIDER = {
  claude: "edit-isolated",
  cursor: "edit-isolated",
  codex: "edit-workspace",
};

function usage() {
  return [
    "usage: node .agent-foundry/delegate-work.mjs --provider <claude|codex|cursor> --prompt-file <path> [options]",
    "options:",
    "  --model <id>",
    "  --cwd <path>",
    "  --timeout-ms <n>        Default 1200000",
    "  --access <mode>         Default: edit-isolated (claude/cursor), edit-workspace (codex)",
    "  --trust-workspace       Cursor only",
    "  --max-budget-usd <n>    Claude only",
    "  --runner <path>",
    "  --dry-run               Validate prompt and print argv; do not invoke",
    "  --json                  Print normalized result JSON (default)",
  ].join("\n");
}

function fail(code, message) {
  stderr.write(`ERROR: ${message}\n`);
  exit(code);
}

export function checkEnvironmentFacts(promptText) {
  const problems = [];
  const heading = /(?:^|\n)##?[ \t]*Environment facts[ \t]*\r?\n/iu.exec(promptText);
  if (!heading) {
    problems.push(
      'prompt must contain an "Environment facts" section (## Environment facts) with session-learned facts',
    );
    return { ok: false, problems };
  }
  const start = heading.index + heading[0].length;
  const rest = promptText.slice(start);
  const nextHeading = /\n##?[ \t]+\S/u.exec(rest);
  const body = (nextHeading ? rest.slice(0, nextHeading.index) : rest).trim();
  const bullets = body
    .split(/\r?\n/u)
    .map((line) => line.trim())
    .filter((line) => /^[-*]\s+\S/.test(line) || /^\d+\.\s+\S/.test(line));
  if (bullets.length < 1) {
    problems.push(
      "Environment facts section must list at least one bullet (auth, paths, memory pointers, repo slug)",
    );
  }
  return { ok: problems.length === 0, problems, bullets };
}

function parseArgs(args) {
  const out = {
    provider: null,
    promptFile: null,
    model: null,
    cwd: process.cwd(),
    timeoutMs: DEFAULT_TIMEOUT_MS,
    access: null,
    trustWorkspace: false,
    maxBudgetUsd: null,
    runner: DEFAULT_RUNNER,
    dryRun: false,
  };
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    const take = () => {
      const v = args[++i];
      if (v == null) throw new Error(`${a} requires a value`);
      return v;
    };
    switch (a) {
      case "--provider":
        out.provider = take();
        break;
      case "--prompt-file":
        out.promptFile = resolve(take());
        break;
      case "--model":
        out.model = take();
        break;
      case "--cwd":
        out.cwd = resolve(take());
        break;
      case "--timeout-ms": {
        const n = Number(take());
        if (!Number.isFinite(n) || n <= 0) throw new Error("--timeout-ms must be a positive number");
        out.timeoutMs = n;
        break;
      }
      case "--access":
        out.access = take();
        break;
      case "--trust-workspace":
        out.trustWorkspace = true;
        break;
      case "--max-budget-usd":
        out.maxBudgetUsd = take();
        break;
      case "--runner":
        out.runner = resolve(take());
        break;
      case "--dry-run":
        out.dryRun = true;
        break;
      case "--json":
        break;
      case "-h":
      case "--help":
        out.help = true;
        break;
      default:
        throw new Error(`unknown flag: ${a}`);
    }
  }
  return out;
}

export function buildDelegateArgs(options) {
  const access = options.access ?? ACCESS_BY_PROVIDER[options.provider];
  if (!access) throw new Error(`unsupported provider: ${options.provider}`);
  const args = [
    options.runner,
    "run",
    "--provider",
    options.provider,
    "--cwd",
    options.cwd,
    "--access",
    access,
    "--prompt-file",
    options.promptFile,
    "--timeout-ms",
    String(options.timeoutMs),
    "--json",
  ];
  if (options.provider !== "cursor") {
    args.splice(args.indexOf("--prompt-file"), 0, "--session", "ephemeral");
  }
  if (options.model) args.push("--model", options.model);
  if (options.maxBudgetUsd != null) args.push("--max-budget-usd", String(options.maxBudgetUsd));
  if (options.trustWorkspace) args.push("--trust-workspace");
  return { args, access };
}

function runHeadless(runnerArgs, timeoutMs, graceMs = PROVIDER_GRACE_MS) {
  return runManagedNode(runnerArgs, { timeoutMs, graceMs });
}

export async function runDelegate(options) {
  if (!["claude", "codex", "cursor"].includes(options.provider)) {
    return { ok: false, problems: [`unsupported provider: ${options.provider}`] };
  }
  let promptText;
  try {
    promptText = readFileSync(options.promptFile, "utf8");
  } catch (err) {
    return { ok: false, problems: [`cannot read prompt-file: ${err.message}`] };
  }
  const facts = checkEnvironmentFacts(promptText);
  if (!facts.ok) return { ok: false, problems: facts.problems };

  const { args, access } = buildDelegateArgs(options);
  if (options.dryRun) {
    return {
      ok: true,
      dryRun: true,
      access,
      argv: [process.execPath, ...args],
      environmentFacts: facts.bullets.length,
    };
  }
  const outcome = await runHeadless(
    args,
    options.timeoutMs,
    options.graceMs ?? PROVIDER_GRACE_MS,
  );
  return {
    ok: outcome.result?.status === "succeeded",
    access,
    status: outcome.status,
    exitCode: outcome.exitCode,
    result: outcome.result,
    pid: outcome.pid,
    stderrTail: (outcome.stderr || "").slice(-2000),
  };
}

async function main() {
  let options;
  try {
    options = parseArgs(argv.slice(2));
  } catch (err) {
    fail(2, err.message);
  }
  if (options.help) {
    stdout.write(`${usage()}\n`);
    return;
  }
  if (!options.provider || !options.promptFile) fail(2, usage());
  const result = await runDelegate(options);
  stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  if (!result.ok) exit(1);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((err) => {
    stderr.write(`ERROR: ${err.message}\n`);
    exit(1);
  });
}
