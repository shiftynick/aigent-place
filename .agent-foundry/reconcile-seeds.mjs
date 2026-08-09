#!/usr/bin/env node
// Restore project-owned seed files after a forced Foundry upgrade.

import { lstatSync, readFileSync, realpathSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { dirname, isAbsolute, join, normalize, resolve } from "node:path";
import { argv, cwd, exit, platform, stderr, stdout } from "node:process";
import { fileURLToPath } from "node:url";
import { hashManagedFile } from "./check-foundry-drift.mjs";

function safeManagedPath(value) {
  const path = String(value).replaceAll("\\", "/");
  if (
    path === ""
    || isAbsolute(path)
    || normalize(path).split(/[\\/]/u).includes("..")
  ) {
    throw new Error(`unsafe managed path in manifest: ${value}`);
  }
  return path;
}

export function restorableSeedPaths(manifest) {
  if (!manifest || typeof manifest.files !== "object" || manifest.files === null) {
    throw new Error("manifest.json has no files map");
  }
  return Object.entries(manifest.files)
    .filter(([, record]) => record?.tier === "seed" && record.preserveIfExists !== true)
    .map(([path]) => safeManagedPath(path))
    .sort();
}

function runGit(repoRoot, args) {
  return spawnSync("git", args, {
    cwd: repoRoot,
    encoding: "utf8",
    windowsHide: true,
  });
}

function trackedAtHead(repoRoot, relative) {
  const result = runGit(repoRoot, ["ls-tree", "-rz", "--name-only", "HEAD", "--", relative]);
  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(result.stderr.trim() || `git ls-tree failed for ${relative}`);
  }
  return result.stdout.split("\0").includes(relative);
}

function samePath(left, right) {
  const normalizeCase = (value) => (platform === "win32" ? value.toLowerCase() : value);
  return normalizeCase(resolve(left)) === normalizeCase(resolve(right));
}

// A seed path must name a file inside the working tree itself. If any
// component of its directory chain is a symlink or junction, or the file is
// one, `git checkout` would write through the link to a target the manifest
// never described.
function assertNoLinkTraversal(repoRoot, relative) {
  const rootReal = realpathSync(repoRoot);
  const target = join(rootReal, relative);
  let parentReal;
  try {
    parentReal = realpathSync(dirname(target));
  } catch (error) {
    throw new Error(`cannot resolve seed directory: ${relative} (${error.message})`);
  }
  if (!samePath(parentReal, join(rootReal, dirname(relative)))) {
    throw new Error(`seed path traverses a link; refusing to restore: ${relative}`);
  }
  let entry;
  try {
    entry = lstatSync(target);
  } catch (error) {
    throw new Error(`cannot read seed file: ${relative} (${error.message})`);
  }
  if (entry.isSymbolicLink()) {
    throw new Error(`seed path traverses a link; refusing to restore: ${relative}`);
  }
}

export function restoreSeedsFromHead(repoRoot, paths, records) {
  // Preflight every path before mutating any of them. Validating and
  // checking out in one loop meant a late mismatch threw "refusing to
  // overwrite" after earlier seeds had already been overwritten.
  const restorable = [];
  const newSeeds = [];
  for (const relative of paths) {
    assertNoLinkTraversal(repoRoot, relative);
    const expected = records?.[relative]?.sha256;
    if (
      typeof expected !== "string"
      || hashManagedFile(readFileSync(join(repoRoot, relative), "utf8")) !== expected
    ) {
      throw new Error(
        `seed changed after installation; refusing to overwrite: ${relative}`,
      );
    }
    if (trackedAtHead(repoRoot, relative)) restorable.push(relative);
    else newSeeds.push(relative);
  }

  if (restorable.length > 0) {
    const result = runGit(repoRoot, ["checkout", "HEAD", "--", ...restorable]);
    if (result.error) throw result.error;
    if (result.status !== 0) {
      throw new Error(result.stderr.trim() || `git checkout failed for ${restorable.join(", ")}`);
    }
  }
  return { restored: restorable, newSeeds };
}

function findRepoRoot(start = cwd()) {
  const result = runGit(start, ["rev-parse", "--show-toplevel"]);
  if (result.error || result.status !== 0) {
    throw new Error("no Git repository found");
  }
  return result.stdout.trim();
}

function main() {
  const args = argv.slice(2);
  if (args.length > 1 || (args[0] && !["--list", "--restore-from-head"].includes(args[0]))) {
    stderr.write("usage: reconcile-seeds.mjs [--list | --restore-from-head]\n");
    return exit(2);
  }
  if (!args[0]) {
    stderr.write("usage: reconcile-seeds.mjs [--list | --restore-from-head]\n");
    return exit(2);
  }
  const repoRoot = findRepoRoot();
  const manifest = JSON.parse(
    readFileSync(join(repoRoot, ".agent-foundry", "manifest.json"), "utf8"),
  );
  const paths = restorableSeedPaths(manifest);
  if (args[0] === "--list") {
    stdout.write(`${paths.join("\n")}${paths.length ? "\n" : ""}`);
    return;
  }
  const result = restoreSeedsFromHead(repoRoot, paths, manifest.files);
  stdout.write(`Restored ${result.restored.length} committed project seed file(s) from HEAD.\n`);
  for (const path of result.restored) stdout.write(`  restored: ${path}\n`);
  for (const path of result.newSeeds) stdout.write(`  new seed kept from Foundry: ${path}\n`);
}

if (argv[1] && resolve(argv[1]) === resolve(fileURLToPath(import.meta.url))) {
  try {
    main();
  } catch (error) {
    stderr.write(`reconcile-seeds: ${error.message}\n`);
    exit(1);
  }
}
