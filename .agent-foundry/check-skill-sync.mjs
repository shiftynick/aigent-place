#!/usr/bin/env node
// check-skill-sync.mjs — verify the two harness skill trees still agree.
//
//   node .agent-foundry/check-skill-sync.mjs
//
// Agent Foundry installs the same shared workflow skills twice, once per
// harness. Nothing in the filesystem keeps them together, so editing one copy
// and forgetting the other silently gives Codex and Claude different
// instructions. This is the check that makes that drift loud.
//
// A skill directory present in both trees is shared and must match after
// harness-path normalization. A directory present in only one tree is a
// bridge skill (it exists to call the *other* harness) and is skipped.
//
// Exit codes: 0 in sync, 1 drift found, 2 the trees are missing entirely.

import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, relative, resolve, sep } from "node:path";
import { argv, cwd, exit, stdout } from "node:process";
import { fileURLToPath } from "node:url";

const AGENTS_TREE = join(".agents", "skills");
const CLAUDE_TREE = join(".claude", "skills");

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

function listRelativeFiles(root) {
  const out = [];
  const walk = (dir) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (entry.isFile()) out.push(relative(root, full));
    }
  };
  walk(root);
  return out.sort();
}

function directoriesIn(root) {
  if (!existsSync(root)) return [];
  return readdirSync(root, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort();
}

// Collapse the differences that are supposed to exist: each tree names its own
// harness in invocation paths and in "<harness>-facing" prose.
function normalize(text) {
  // Both separator styles are rewritten regardless of host platform so a tree
  // authored on Linux still compares cleanly when checked on Windows.
  return text
    .replaceAll(`${AGENTS_TREE}${sep}`, `${CLAUDE_TREE}${sep}`)
    .replaceAll(".agents/skills/", ".claude/skills/")
    .replaceAll(".agents\\skills\\", ".claude\\skills\\")
    .replaceAll("Codex-facing", "HARNESS-facing")
    .replaceAll("Claude-facing", "HARNESS-facing");
}

export function checkSkillSync(repoRoot) {
  const agentsRoot = join(repoRoot, AGENTS_TREE);
  const claudeRoot = join(repoRoot, CLAUDE_TREE);
  for (const root of [agentsRoot, claudeRoot]) {
    if (!existsSync(root) || !statSync(root).isDirectory()) {
      return { missingTree: relative(repoRoot, root), shared: [], problems: [] };
    }
  }

  const agentSkills = new Set(directoriesIn(agentsRoot));
  const claudeSkills = new Set(directoriesIn(claudeRoot));
  const shared = [...agentSkills].filter((name) => claudeSkills.has(name));
  const problems = [];

  for (const skill of shared) {
    const agentDir = join(agentsRoot, skill);
    const claudeDir = join(claudeRoot, skill);
    const agentFiles = listRelativeFiles(agentDir);
    const claudeFiles = listRelativeFiles(claudeDir);

    for (const missing of agentFiles.filter((f) => !claudeFiles.includes(f))) {
      problems.push(`${skill}: ${missing} exists only in ${AGENTS_TREE}`);
    }
    for (const missing of claudeFiles.filter((f) => !agentFiles.includes(f))) {
      problems.push(`${skill}: ${missing} exists only in ${CLAUDE_TREE}`);
    }

    for (const file of agentFiles.filter((f) => claudeFiles.includes(f))) {
      const agentText = readFileSync(join(agentDir, file), "utf8");
      const claudeText = readFileSync(join(claudeDir, file), "utf8");
      // A shared skill naming the opposite harness is drift even if the two
      // copies happen to match: it would send that harness to the wrong tree.
      if (agentText.includes(".claude/skills/")) {
        problems.push(`${skill}: ${file} references the Claude tree from ${AGENTS_TREE}`);
      }
      if (claudeText.includes(".agents/skills/")) {
        problems.push(`${skill}: ${file} references the Codex tree from ${CLAUDE_TREE}`);
      }
      if (normalize(agentText) !== normalize(claudeText)) {
        problems.push(`${skill}: ${file} differs beyond harness paths`);
      }
    }
  }

  return { missingTree: null, shared, problems };
}

function main() {
  const explicitRoot = argv[2];
  const repoRoot = explicitRoot ?? findRepoRoot();
  if (!repoRoot) {
    stdout.write("skill-sync: no repo root found (no .git ancestor)\n");
    return exit(2);
  }

  const { missingTree, shared, problems } = checkSkillSync(repoRoot);
  if (missingTree) {
    stdout.write(`skill-sync: missing skill tree: ${missingTree}\n`);
    return exit(2);
  }
  if (problems.length > 0) {
    stdout.write("skill-sync: FAIL\n");
    for (const problem of problems) stdout.write(`  ${problem}\n`);
    stdout.write(
      "\nEdit both copies of a shared skill in the same commit. Only harness\n"
      + "invocation paths may differ between the trees.\n",
    );
    return exit(1);
  }
  stdout.write(
    `skill-sync: PASS (${shared.length} shared skill${shared.length === 1 ? "" : "s"})\n`,
  );
}

if (argv[1] && resolve(argv[1]) === resolve(fileURLToPath(import.meta.url))) {
  main();
}
