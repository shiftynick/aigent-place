#!/usr/bin/env node
// cold-review.mjs — Foundry preset for dual-axis cold review via agent-headless.
//
// Checks a packet directory, builds SPEC and STANDARDS prompts from the shared
// template, and dispatches both axes concurrently as independent answer-only
// ephemeral runs. Returns one JSON object with both axis results.
//
//   node .agent-foundry/cold-review.mjs \
//     --provider claude|codex|cursor \
//     --packet <dir> \
//     [--model <id>] [--cwd <repo>] [--timeout-ms 1200000] \
//     [--max-budget-usd 3] [--trust-workspace] [--axis both|SPEC|STANDARDS] \
//     [--dry-run]
//
// Does not replace docs/SDLC.md adjudication. It only removes hand-assembled
// invocation boilerplate and incomplete-packet dispatches.

import {
  mkdtempSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { argv, exit, stderr, stdout } from "node:process";
import { fileURLToPath } from "node:url";
import { buildAxisPrompt, checkPacket } from "./review-packet.mjs";
import { runManagedNode } from "./process-tree.mjs";

const DEFAULT_TIMEOUT_MS = 20 * 60 * 1000;
const HERE = dirname(fileURLToPath(import.meta.url));
const DEFAULT_RUNNER = join(HERE, "agent-headless", "cli.js");
// Extra grace so agent-headless can apply its own --timeout-ms before we reap.
const PROVIDER_GRACE_MS = 5_000;

function usage() {
  return [
    "usage: node .agent-foundry/cold-review.mjs --provider <claude|codex|cursor> --packet <dir> [options]",
    "options:",
    "  --model <id>            Exact allowlisted model (required for Cursor cold review)",
    "  --cwd <path>            Repository root (default: process cwd)",
    "  --timeout-ms <n>        Per-axis timeout (default: 1200000)",
    "  --max-budget-usd <n>    Claude only",
    "  --trust-workspace       Cursor only",
    "  --axis both|SPEC|STANDARDS|COMBINED   Default both (concurrent when both)",
    "  --runner <path>         agent-headless cli.js (default: bundled)",
    "  --dry-run               Check packet and print prompts; do not invoke",
    "  --json                  Print the combined result JSON (default)",
  ].join("\n");
}

function fail(code, message) {
  stderr.write(`ERROR: ${message}\n`);
  exit(code);
}

function parseArgs(args) {
  const out = {
    provider: null,
    packet: null,
    model: null,
    cwd: process.cwd(),
    timeoutMs: DEFAULT_TIMEOUT_MS,
    maxBudgetUsd: null,
    trustWorkspace: false,
    axis: "both",
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
      case "--packet":
        out.packet = resolve(take());
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
      case "--max-budget-usd":
        out.maxBudgetUsd = take();
        break;
      case "--trust-workspace":
        out.trustWorkspace = true;
        break;
      case "--axis":
        out.axis = take();
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

function runHeadless(runnerArgs, { timeoutMs, graceMs = PROVIDER_GRACE_MS }) {
  return runManagedNode(runnerArgs, { timeoutMs, graceMs });
}

export function buildRunnerArgs({
  runner,
  provider,
  model,
  cwd,
  promptFile,
  timeoutMs,
  maxBudgetUsd,
  trustWorkspace,
}) {
  const args = [
    runner,
    "run",
    "--provider",
    provider,
    "--cwd",
    cwd,
    "--access",
    "answer-only",
    "--prompt-file",
    promptFile,
    "--timeout-ms",
    String(timeoutMs),
    "--json",
  ];
  // Cursor has no ephemeral session mode; Claude/Codex default to ephemeral.
  if (provider !== "cursor") {
    args.splice(args.indexOf("--prompt-file"), 0, "--session", "ephemeral");
  }
  if (model) args.push("--model", model);
  if (maxBudgetUsd != null) args.push("--max-budget-usd", String(maxBudgetUsd));
  if (trustWorkspace) args.push("--trust-workspace");
  return args;
}

export async function runColdReview(options) {
  const checked = checkPacket(options.packet, { repoRoot: options.cwd });
  if (!checked.ok) {
    return {
      ok: false,
      problems: checked.problems,
      axes: {},
    };
  }
  const packet = checked.packet;
  if (options.provider === "cursor" && !options.model) {
    return {
      ok: false,
      problems: ["Cursor cold review requires an explicit --model (operator-chosen)"],
      axes: {},
    };
  }
  if (!["claude", "codex", "cursor"].includes(options.provider)) {
    return {
      ok: false,
      problems: [`unsupported provider: ${options.provider}`],
      axes: {},
    };
  }

  const axes =
    options.axis === "both"
      ? ["SPEC", "STANDARDS"]
      : options.axis === "SPEC" ||
          options.axis === "STANDARDS" ||
          options.axis === "COMBINED"
        ? [options.axis]
        : null;
  if (!axes) {
    return { ok: false, problems: [`--axis must be both|SPEC|STANDARDS|COMBINED`], axes: {} };
  }

  const workDir = mkdtempSync(join(tmpdir(), "foundry-cold-review-"));
  const prompts = {};
  for (const axis of axes) {
    const promptPath = join(workDir, `${axis.toLowerCase()}.md`);
    const body = buildAxisPrompt(packet, axis);
    writeFileSync(promptPath, body, "utf8");
    prompts[axis] = { path: promptPath, body };
  }

  if (options.dryRun) {
    return {
      ok: true,
      dryRun: true,
      packet: {
        taskId: packet.manifest.taskId,
        round: packet.manifest.round ?? 1,
        dir: packet.dir,
      },
      prompts: Object.fromEntries(
        Object.entries(prompts).map(([axis, value]) => [axis, value.path]),
      ),
      axes: {},
    };
  }

  const settled = await Promise.all(
    axes.map(async (axis) => {
      const runnerArgs = buildRunnerArgs({
        runner: options.runner,
        provider: options.provider,
        model: options.model,
        cwd: options.cwd,
        promptFile: prompts[axis].path,
        timeoutMs: options.timeoutMs,
        maxBudgetUsd: options.maxBudgetUsd,
        trustWorkspace: options.trustWorkspace,
      });
      const outcome = await runHeadless(runnerArgs, {
        timeoutMs: options.timeoutMs,
        graceMs: options.graceMs ?? PROVIDER_GRACE_MS,
      });
      return [axis, outcome];
    }),
  );

  const axisResults = Object.fromEntries(settled);
  const incomplete = axes.filter((axis) => {
    const outcome = axisResults[axis];
    return !outcome.result || outcome.result.status !== "succeeded";
  });

  return {
    ok: incomplete.length === 0,
    packet: {
      taskId: packet.manifest.taskId,
      round: packet.manifest.round ?? 1,
      dir: packet.dir,
    },
    provider: options.provider,
    model: options.model ?? null,
    axes: Object.fromEntries(
      axes.map((axis) => {
        const outcome = axisResults[axis];
        return [
          axis,
          {
            status: outcome.status,
            exitCode: outcome.exitCode,
            error: outcome.error,
            stderrTail: (outcome.stderr || "").slice(-2000),
            result: outcome.result,
            finalText: outcome.result?.finalText ?? null,
          },
        ];
      }),
    ),
    incomplete,
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
  if (!options.provider || !options.packet) fail(2, usage());

  const result = await runColdReview(options);
  stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  if (!result.ok) exit(1);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((err) => {
    stderr.write(`ERROR: ${err.message}\n`);
    exit(1);
  });
}
