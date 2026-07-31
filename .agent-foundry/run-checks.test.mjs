import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { discoverTestFiles, findRepoRoot } from "./run-checks.mjs";

const SCRIPT = join(dirname(fileURLToPath(import.meta.url)), "run-checks.mjs");

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

test("ignores non-test files, unmanaged trees, and nested dependency trees", () => {
  withRepo([
    ".claude/skills/task-tracker/scripts/task.mjs",
    ".claude/skills/task-tracker/SKILL.md",
    ".claude/skills/task-tracker/scripts/real.test.mjs",
    ".claude/node_modules/pkg/index.test.mjs",
    "src/app.test.mjs",
    "node_modules/pkg/index.test.mjs",
  ], (root) => {
    const found = discoverTestFiles(root).map((file) => relative(root, file).replaceAll("\\", "/"));
    assert.deepEqual(found, [".claude/skills/task-tracker/scripts/real.test.mjs"]);
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

function runCli(files) {
  return withRepo(Object.keys(files), (root) => {
    for (const [relativePath, content] of Object.entries(files)) {
      writeFileSync(join(root, ...relativePath.split("/")), content, "utf8");
    }
    const childEnv = { ...process.env };
    // The CLI under test starts its own `node --test` process. Do not leak the
    // parent test runner's recursion marker into that independent invocation.
    delete childEnv.NODE_TEST_CONTEXT;
    return spawnSync(process.execPath, [SCRIPT], {
      cwd: root,
      encoding: "utf8",
      env: childEnv,
      windowsHide: true,
    });
  });
}

const passingTest = "import test from 'node:test'; test('pass', () => {});\n";
const failingTest = "import test from 'node:test'; test('fail', () => { throw new Error('boom'); });\n";
const passingSync = "process.exit(0);\n";

test("CLI exits 0 and reports checks that actually passed", () => {
  const result = runCli({
    ".agent-foundry/check-skill-sync.mjs": passingSync,
    ".agents/sample.test.mjs": passingTest,
  });
  assert.equal(result.status, 0);
  assert.match(result.stdout, /PASS \(skill-sync \+ 1 suites\)/u);
});

test("CLI fails closed when the skill-sync checker is missing", () => {
  const result = runCli({ ".agents/sample.test.mjs": passingTest });
  assert.equal(result.status, 1, `${result.stdout}\n${result.stderr}`);
  assert.match(result.stdout, /required checker is missing/u);
  assert.doesNotMatch(result.stdout, /PASS/u);
});

test("CLI exits 1 when the skill-sync checker fails", () => {
  const result = runCli({
    ".agent-foundry/check-skill-sync.mjs": "process.exit(3);\n",
    ".agents/sample.test.mjs": passingTest,
  });
  assert.equal(result.status, 1);
  assert.match(result.stdout, /FAIL \(skill-sync\)/u);
});

test("CLI exits 1 when a present skill-sync checker cannot load", () => {
  const result = runCli({
    ".agent-foundry/check-skill-sync.mjs": "this is not valid JavaScript {\n",
    ".agents/sample.test.mjs": passingTest,
  });
  assert.equal(result.status, 1);
  assert.match(result.stdout, /FAIL \(skill-sync\)/u);
});

test("CLI exits 1 when an installed suite fails", () => {
  const result = runCli({
    ".agent-foundry/check-skill-sync.mjs": passingSync,
    ".agents/sample.test.mjs": failingTest,
  });
  assert.equal(result.status, 1, `${result.stdout}\n${result.stderr}`);
  assert.match(result.stdout, /FAIL \(installed tests\)/u);
});

test("CLI exits 2 when no suites are discovered", () => {
  const result = runCli({
    ".agent-foundry/check-skill-sync.mjs": passingSync,
  });
  assert.equal(result.status, 2);
  assert.match(result.stdout, /no test suites found/u);
});
