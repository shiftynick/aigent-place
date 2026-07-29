#!/usr/bin/env node
// process-signals.mjs — mine the task board for process-friction signals.
//
//   node .claude/skills/retrospective/scripts/process-signals.mjs [--since 2026-07-01] [--json]
//
// Reports, per signal class, the tasks that exhibit it:
//
//   friction   notes an agent flagged in the moment ("friction: ...")
//   forced     discipline bypasses (a --force transition was logged)
//   churn      tasks that re-entered in_progress more than once (review bounces)
//   failed     recorded `task.mjs run` evidence with a non-zero outcome
//
// These are candidates, not findings. The retrospective's evidence bar still
// applies: three or more occurrences, a named governing document, a stated
// cost, and a correction expressible as a small edit.
//
// Zero-dep and shell-neutral on purpose: the equivalent recursive `grep`
// pipeline is GNU-only, and its PowerShell counterpart (Select-String) is
// case-insensitive by default, which silently changes what matches.

import { existsSync, readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { argv, cwd, exit, stdout } from "node:process";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";

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

// Case-sensitive by construction: `friction:` is a convention, and matching
// `Friction:` or `FRICTION:` would quietly widen it.
export function scanTaskText(id, text) {
  const lines = text.split(/\r?\n/u);
  const signals = { friction: [], forced: [], churn: 0, failed: [] };
  let claims = 0;
  for (const line of lines) {
    const frictionAt = line.indexOf("friction:");
    if (frictionAt !== -1) {
      signals.friction.push(line.slice(frictionAt + "friction:".length).trim());
    }
    if (line.includes("moved to in_progress")) claims += 1;
    if (line.includes("(forced") || line.includes("; forced")) {
      signals.forced.push(line.trim());
    }
    // Recorded-evidence outcome lines look like: "started <ts>, exit 3 in 1.2s"
    const outcome = line.match(/,\s(exit\s(\d+)\sin\s[\d.]+s|timed out[^\n]*|terminated by[^\n]*)/u);
    if (outcome && !/exit 0 in/u.test(outcome[1])) {
      signals.failed.push(outcome[1]);
    }
  }
  // Re-entering in_progress means the task bounced back from review or blocked.
  signals.churn = Math.max(0, claims - 1);
  return { id, ...signals };
}

function taskFiles(repoRoot) {
  const out = [];
  for (const dir of [join(repoRoot, ".tasks", "tasks"), join(repoRoot, ".tasks", "archive")]) {
    if (!existsSync(dir)) continue;
    for (const name of readdirSync(dir).sort()) {
      if (!/^task-\d+-.*\.md$/u.test(name)) continue;
      out.push(join(dir, name));
    }
  }
  return out;
}

// When a task last changed, read from the file's own content — never from
// filesystem mtime, which any fresh clone, new worktree, or CI checkout resets
// to "now". Under mtime, `--since` silently matches everything and degrades to
// no filter at all, which would let months-old friction be counted as a
// current pattern and edit a governing document on bad evidence. Worktrees are
// the recommended layout for parallel agents, so this is the common case.
export function taskTimestamp(text) {
  const raw = text.match(/^updatedAt:\s*(.+)$/mu)?.[1]?.trim();
  if (raw) {
    const parsed = Date.parse(raw.replace(/^["']|["']$/gu, ""));
    if (!Number.isNaN(parsed)) return parsed;
  }
  // Fall back to the newest dated log line for hand-edited or older files.
  let newest = null;
  for (const match of text.matchAll(/^-\s(\d{4}-\d{2}-\d{2}T[\d:]+Z)/gmu)) {
    const parsed = Date.parse(match[1]);
    if (!Number.isNaN(parsed) && (newest === null || parsed > newest)) {
      newest = parsed;
    }
  }
  return newest;
}

export function collectSignals(repoRoot, since = null) {
  const cutoff = since ? Date.parse(since) : null;
  if (since && Number.isNaN(cutoff)) {
    throw new Error(`--since is not a parsable date: ${since}`);
  }
  const rows = [];
  for (const file of taskFiles(repoRoot)) {
    const text = readFileSync(file, "utf8");
    if (cutoff !== null) {
      const stamp = taskTimestamp(text);
      // A file carrying no usable timestamp is kept: over-reporting is
      // recoverable at the evidence bar, silently dropping evidence is not.
      if (stamp !== null && stamp < cutoff) continue;
    }
    const id = text.match(/^id:\s*(task-\d+)/mu)?.[1] ?? file;
    rows.push(scanTaskText(id, text));
  }
  return rows;
}

function section(title, entries, note) {
  if (entries.length === 0) return `\n${title}: none\n`;
  return `\n${title} (${entries.length})\n  ${note}\n${
    entries.map((e) => `  - ${e}`).join("\n")
  }\n`;
}

function main() {
  const args = argv.slice(2);
  const asJson = args.includes("--json");
  const sinceIndex = args.indexOf("--since");
  const since = sinceIndex === -1 ? null : args[sinceIndex + 1];
  const repoRoot = findRepoRoot();
  if (!repoRoot) {
    stdout.write("process-signals: no repo root found (no .git ancestor)\n");
    return exit(2);
  }
  let rows;
  try {
    rows = collectSignals(repoRoot, since);
  } catch (error) {
    stdout.write(`process-signals: ${error.message}\n`);
    return exit(2);
  }

  if (asJson) {
    stdout.write(`${JSON.stringify(rows, null, 2)}\n`);
    return;
  }

  stdout.write(`process-signals: ${rows.length} task file(s) in range\n`);
  stdout.write(section(
    "Friction notes",
    rows.flatMap((r) => r.friction.map((f) => `${r.id}: ${f}`)),
    "Flagged in the moment. The highest-value signal.",
  ));
  stdout.write(section(
    "Forced transitions",
    rows.filter((r) => r.forced.length > 0).map((r) => `${r.id} (${r.forced.length})`),
    "Discipline bypassed. Ask what made the rule impractical.",
  ));
  stdout.write(section(
    "Review churn",
    rows.filter((r) => r.churn > 0).map((r) => `${r.id} re-entered in_progress ${r.churn}x`),
    "Repeated bounces suggest an unclear rubric or a missing check.",
  ));
  stdout.write(section(
    "Failed recorded runs",
    rows.flatMap((r) => r.failed.map((f) => `${r.id}: ${f}`)),
    "Expected during work; a pattern across tasks is the signal.",
  ));
  stdout.write(
    "\nCandidates only. Apply the evidence bar in SKILL.md before acting.\n",
  );
}

if (argv[1] && resolve(argv[1]) === resolve(fileURLToPath(import.meta.url))) {
  main();
}
