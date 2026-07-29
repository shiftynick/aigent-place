#!/usr/bin/env node
// check-foundry-drift.mjs — report how this project's installed Agent Foundry
// files differ from what the installer originally wrote.
//
//   node .agent-foundry/check-foundry-drift.mjs
//
// This is a REPORT, not a gate. Local evolution of the installed workflow is
// expected and supported (see .agent-foundry/README.md). The point is that an
// upgrade must know which files carry project-specific work before it replaces
// them, so nothing deliberate is silently reverted.
//
// Tiers come from .agent-foundry/manifest.json:
//   seed — installed once, the project owns it. Drift here is normal.
//   mold — the Foundry owns it. Drift here is deliberate divergence that an
//          upgrade must re-apply, upstream, or consciously drop.
//
// Exit codes: 0 report produced (with or without drift), 2 no usable manifest.

import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { argv, cwd, exit, stdout } from "node:process";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";

// Line endings are normalized before hashing so a CRLF checkout on Windows is
// not reported as drift. The installer imports THIS function so the hash it
// records and the hash checked here can never diverge.
export function hashManagedFile(text) {
  return createHash("sha256").update(text.replace(/\r\n/gu, "\n"), "utf8").digest("hex");
}

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

export function checkFoundryDrift(repoRoot) {
  const manifestPath = join(repoRoot, ".agent-foundry", "manifest.json");
  if (!existsSync(manifestPath)) return { manifest: null };
  const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));

  const modified = { seed: [], mold: [] };
  const missing = { seed: [], mold: [] };
  let pristine = 0;

  for (const [relative, record] of Object.entries(manifest.files ?? {})) {
    const tier = record.tier === "seed" ? "seed" : "mold";
    const full = join(repoRoot, ...relative.split("/"));
    if (!existsSync(full)) {
      missing[tier].push(relative);
      continue;
    }
    if (hashManagedFile(readFileSync(full, "utf8")) === record.sha256) {
      pristine += 1;
      continue;
    }
    modified[tier].push(relative);
  }

  return { manifest, modified, missing, pristine };
}

function section(title, entries, note) {
  if (entries.length === 0) return "";
  const lines = [`\n${title} (${entries.length})`];
  if (note) lines.push(`  ${note}`);
  for (const entry of entries.sort()) lines.push(`  - ${entry}`);
  return `${lines.join("\n")}\n`;
}

function main() {
  const repoRoot = argv[2] ?? findRepoRoot();
  if (!repoRoot) {
    stdout.write("foundry-drift: no repo root found (no .git ancestor)\n");
    return exit(2);
  }

  const result = checkFoundryDrift(repoRoot);
  if (!result.manifest) {
    stdout.write(
      "foundry-drift: no .agent-foundry/manifest.json.\n"
      + "This project predates install manifests. Re-run the installer with\n"
      + "--force to record one (it backs up every file it replaces first).\n",
    );
    return exit(2);
  }

  const { manifest, modified, missing, pristine } = result;
  stdout.write(
    `foundry-drift: installed from Agent Foundry ${manifest.foundryVersion}`
    + ` on ${manifest.installedAt}\n`,
  );
  stdout.write(
    section(
      "Locally modified (mold)",
      modified.mold,
      "The Foundry owns these. An upgrade replaces them — re-apply, upstream, or drop each change deliberately.",
    ),
  );
  stdout.write(
    section(
      "Locally modified (seed)",
      modified.seed,
      "Expected: the project owns these. An upgrade must not overwrite them.",
    ),
  );
  stdout.write(section("Missing (mold)", missing.mold, "Reinstall restores these."));
  stdout.write(section("Missing (seed)", missing.seed, "Deleted on purpose? An upgrade will recreate them."));

  const driftCount = modified.mold.length + modified.seed.length
    + missing.mold.length + missing.seed.length;
  if (driftCount === 0) {
    stdout.write(`\nNo drift: all ${pristine} managed files match the install.\n`);
  } else {
    stdout.write(
      `\n${pristine} unchanged, ${driftCount} diverged.`
      + " Record intentional divergence in .agent-foundry/LOCAL-CHANGES.md\n"
      + "so the next upgrade does not silently revert it.\n",
    );
  }
}

if (argv[1] && resolve(argv[1]) === resolve(fileURLToPath(import.meta.url))) {
  main();
}
