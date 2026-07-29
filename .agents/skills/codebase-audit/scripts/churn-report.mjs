#!/usr/bin/env node
// churn-report.mjs — rank tracked files by how often they have been changed.
//
//   node .agents/skills/codebase-audit/scripts/churn-report.mjs [--limit 30] [--since "6 months ago"]
//
// Churn concentrates debt: the files edited most often are where accumulation
// happens and where it costs the most. This only chooses WHERE TO LOOK — every
// audit finding must still come from reading the code.
//
// Zero-dep and shell-neutral on purpose: the equivalent
// `git log | sort | uniq -c | sort -rn` pipeline is GNU-only and silently
// means something different under PowerShell.

import { spawnSync } from "node:child_process";
import { argv, exit, stderr, stdout } from "node:process";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";

export function parseArgs(args) {
  const options = { limit: 30, since: null, path: null };
  for (let i = 0; i < args.length; i += 1) {
    const [flag, inline] = args[i].includes("=")
      ? [args[i].slice(0, args[i].indexOf("=")), args[i].slice(args[i].indexOf("=") + 1)]
      : [args[i], undefined];
    const value = inline ?? args[i + 1];
    if (inline === undefined && flag !== "--help") i += 1;
    if (flag === "--help") return { help: true };
    if (value === undefined || value === "") {
      throw new Error(`${flag} requires a value`);
    }
    if (flag === "--limit") {
      const parsed = Number(value);
      if (!Number.isInteger(parsed) || parsed <= 0) {
        throw new Error("--limit must be a positive integer");
      }
      options.limit = parsed;
    } else if (flag === "--since") {
      options.since = value;
    } else if (flag === "--path") {
      options.path = value;
    } else {
      throw new Error(`unknown option: ${flag}`);
    }
  }
  return options;
}

// Counts one changed-file line per commit touching it. Renames are recorded
// under their new name only, which is what "where is churn now" wants.
export function countChangedFiles(nameOnlyOutput) {
  const counts = new Map();
  for (const raw of nameOnlyOutput.split(/\r?\n/u)) {
    const file = raw.trim();
    if (file === "") continue;
    counts.set(file, (counts.get(file) ?? 0) + 1);
  }
  return [...counts.entries()]
    .sort((a, b) => (b[1] - a[1]) || (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0))
    .map(([file, count]) => ({ file, count }));
}

function gitLogNameOnly(options) {
  const args = ["log", "--format=", "--name-only"];
  if (options.since) args.push(`--since=${options.since}`);
  if (options.path) args.push("--", options.path);
  const result = spawnSync("git", args, {
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
    windowsHide: true,
  });
  if (result.error) {
    throw new Error(`could not run git: ${result.error.message}`);
  }
  if (result.status !== 0) {
    throw new Error(`git log failed: ${(result.stderr ?? "").trim()}`);
  }
  return result.stdout ?? "";
}

function main() {
  let options;
  try {
    options = parseArgs(argv.slice(2));
  } catch (error) {
    stderr.write(`error: ${error.message}\n`);
    return exit(2);
  }
  if (options.help) {
    stdout.write(
      "usage: churn-report.mjs [--limit N] [--since <git date>] [--path <pathspec>]\n",
    );
    return;
  }
  let ranked;
  try {
    ranked = countChangedFiles(gitLogNameOnly(options));
  } catch (error) {
    stderr.write(`error: ${error.message}\n`);
    return exit(1);
  }
  if (ranked.length === 0) {
    stdout.write("no changed files in range\n");
    return;
  }
  const width = String(ranked[0].count).length;
  for (const { file, count } of ranked.slice(0, options.limit)) {
    stdout.write(`${String(count).padStart(width)}  ${file}\n`);
  }
  if (ranked.length > options.limit) {
    stdout.write(`... ${ranked.length - options.limit} more\n`);
  }
}

if (argv[1] && resolve(argv[1]) === resolve(fileURLToPath(import.meta.url))) {
  main();
}
