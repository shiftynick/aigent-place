#!/usr/bin/env node
// run-checks.mjs — run every check the installed Agent Foundry owns.
//
//   node .agent-foundry/run-checks.mjs [--list]
//
// One command so upgrade procedures and quality gates never have to enumerate
// paths that go stale with each release. The kit ships executable code inside
// the skill trees, and a hand-maintained list of suites is exactly the sort of
// thing that silently falls behind — this discovers them instead.
//
// What runs:
//   1. skill-sync   — the two harness trees must agree (a real gate)
//   2. every *.test.mjs under .agents/, .claude/, and .agent-foundry/
//
// Deliberately NOT run: check-foundry-drift, which is a report rather than a
// gate — local divergence from stock is a legitimate choice.
//
// Exit codes: 0 all checks passed, 1 something failed, 2 nothing discovered.

import { spawnSync } from "node:child_process";
import { existsSync, readdirSync, statSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import process, { argv, cwd, execPath, stdout } from "node:process";
import { fileURLToPath } from "node:url";

const MANAGED_ROOTS = [".agent-foundry", ".agents", ".claude"];

export function findRepoRoot(startDir = cwd(), maxDepth = 12) {
  let dir = startDir;
  for (let i = 0; i < maxDepth; i++) {
    if (existsSync(join(dir, ".git"))) return dir;
    const parent = dirname(dir);
    if (parent === dir) return null;
    dir = parent;
  }
  return null;
}

export function discoverTestFiles(repoRoot) {
  const found = [];
  const walk = (dir) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (entry.isDirectory() && entry.name === "node_modules") continue;
      const full = join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (entry.isFile() && entry.name.endsWith(".test.mjs")) found.push(full);
    }
  };
  for (const root of MANAGED_ROOTS) {
    const full = join(repoRoot, root);
    if (existsSync(full) && statSync(full).isDirectory()) walk(full);
  }
  return found.sort();
}

function runStep(label, command, args, repoRoot) {
  stdout.write(`\n=== ${label} ===\n`);
  const result = spawnSync(command, args, {
    cwd: repoRoot,
    stdio: "inherit",
    windowsHide: true,
  });
  if (result.error) {
    stdout.write(`${label}: could not start — ${result.error.message}\n`);
    return false;
  }
  return result.status === 0;
}

function main() {
  const repoRoot = findRepoRoot();
  if (!repoRoot) {
    stdout.write("run-checks: no repo root found (no .git ancestor)\n");
    process.exitCode = 2;
    return;
  }
  const tests = discoverTestFiles(repoRoot);

  if (argv.includes("--list")) {
    stdout.write(`${tests.map((t) => relative(repoRoot, t)).join("\n")}\n`);
    return;
  }
  if (tests.length === 0) {
    stdout.write("run-checks: no test suites found under the managed trees\n");
    process.exitCode = 2;
    return;
  }

  const failures = [];
  const syncCheck = join(repoRoot, ".agent-foundry", "check-skill-sync.mjs");
  if (!existsSync(syncCheck)) {
    stdout.write("\n=== skill-sync ===\n");
    stdout.write("skill-sync: required checker is missing\n");
    failures.push("skill-sync");
  } else if (!runStep("skill-sync", execPath, [syncCheck], repoRoot)) {
    failures.push("skill-sync");
  }
  if (!runStep(
    `installed tests (${tests.length} suites)`,
    execPath,
    ["--test", ...tests],
    repoRoot,
  )) {
    failures.push("installed tests");
  }

  if (failures.length > 0) {
    stdout.write(`\nrun-checks: FAIL (${failures.join(", ")})\n`);
    process.exitCode = 1;
    return;
  }
  stdout.write(`\nrun-checks: PASS (skill-sync + ${tests.length} suites)\n`);
}

if (argv[1] && resolve(argv[1]) === resolve(fileURLToPath(import.meta.url))) {
  main();
}
