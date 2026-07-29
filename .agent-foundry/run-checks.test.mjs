import test from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, relative } from "node:path";
import { discoverTestFiles, findRepoRoot } from "./run-checks.mjs";

function withRepo(files, fn) {
  const root = mkdtempSync(join(tmpdir(), "run-checks-"));
  try {
    mkdirSync(join(root, ".git"), { recursive: true });
    for (const rel of files) {
      const full = join(root, ...rel.split("/"));
      mkdirSync(join(full, ".."), { recursive: true });
      writeFileSync(full, "// fixture\n", "utf8");
    }
    return fn(root);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

test("discovers test suites across every managed tree", () => {
  withRepo([
    ".agent-foundry/check-skill-sync.test.mjs",
    ".claude/skills/task-tracker/scripts/task.test.mjs",
    ".claude/skills/codebase-audit/scripts/churn-report.test.mjs",
    ".agents/skills/retrospective/scripts/process-signals.test.mjs",
  ], (root) => {
    const found = discoverTestFiles(root).map((f) => relative(root, f).split("\\").join("/"));
    assert.equal(found.length, 4);
    assert.ok(found.some((f) => f.includes("churn-report.test.mjs")));
    assert.ok(found.some((f) => f.includes("process-signals.test.mjs")));
  });
});

test("finds suites added by a future release without being told about them", () => {
  // The whole point: a new skill shipping its own tests is picked up with no
  // edit to this script, the upgrade procedure, or the project's gate.
  withRepo([".claude/skills/brand-new-skill/scripts/whatever.test.mjs"], (root) => {
    const found = discoverTestFiles(root);
    assert.equal(found.length, 1);
    assert.ok(found[0].endsWith("whatever.test.mjs"));
  });
});

test("ignores non-test files and unmanaged trees", () => {
  withRepo([
    ".claude/skills/task-tracker/scripts/task.mjs",
    ".claude/skills/task-tracker/SKILL.md",
    "src/app.test.mjs",
    "node_modules/pkg/index.test.mjs",
  ], (root) => {
    assert.deepEqual(discoverTestFiles(root), []);
  });
});

test("returns an empty list rather than throwing when trees are absent", () => {
  withRepo([], (root) => {
    assert.deepEqual(discoverTestFiles(root), []);
  });
});

test("locates the repo root from a nested directory", () => {
  withRepo([".claude/skills/x/y.test.mjs"], (root) => {
    const nested = join(root, ".claude", "skills", "x");
    assert.equal(findRepoRoot(nested), root);
  });
});
