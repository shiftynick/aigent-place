import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const HOOK = join(dirname(fileURLToPath(import.meta.url)), "pre-push");
const ZERO = "0".repeat(40);
const SHA_A = "a".repeat(40);
const SHA_B = "b".repeat(40);

function resolveShell() {
  const direct = spawnSync("sh", ["--version"], { encoding: "utf8" });
  if (!direct.error) {
    return "sh";
  }

  if (process.platform === "win32") {
    const git = spawnSync("git", ["--exec-path"], { encoding: "utf8" });
    if (!git.error && git.status === 0) {
      const candidate = resolve(
        git.stdout.trim(),
        "..",
        "..",
        "..",
        "usr",
        "bin",
        "sh.exe",
      );
      if (existsSync(candidate)) {
        return candidate;
      }
    }
  }

  throw new Error(
    "pre-push tests require a POSIX shell; install Git for Windows or sh",
  );
}

const SHELL = resolveShell();

function runHook(lines, { terminalNewline = true } = {}) {
  const joined = lines.join("\n");
  const stdin =
    lines.length > 0 && terminalNewline ? `${joined}\n` : joined;
  const result = spawnSync(SHELL, [HOOK], {
    encoding: "utf8",
    input: stdin,
    timeout: 5_000,
  });
  if (result.error) {
    throw result.error;
  }
  if (result.signal) {
    throw new Error(`pre-push hook terminated by ${result.signal}`);
  }
  return result;
}

test("allows an ordinary task-branch update", () => {
  assert.equal(
    runHook([
      `refs/heads/task-019-x ${SHA_A} refs/heads/task-019-x ${SHA_B}`,
    ]).status,
    0,
  );
});

test("refuses updating main", () => {
  assert.equal(
    runHook([`refs/heads/main ${SHA_A} refs/heads/main ${SHA_B}`]).status,
    1,
  );
});

test("refuses pushing another local branch onto main", () => {
  assert.equal(
    runHook([
      `refs/heads/task-019-x ${SHA_A} refs/heads/main ${SHA_B}`,
    ]).status,
    1,
  );
});

test("refuses deleting main", () => {
  assert.equal(
    runHook([`(delete) ${ZERO} refs/heads/main ${SHA_B}`]).status,
    1,
  );
});

test("allows deleting a task branch", () => {
  assert.equal(
    runHook([
      `(delete) ${ZERO} refs/heads/task-019-x ${SHA_B}`,
    ]).status,
    0,
  );
});

test("refuses a multi-ref push containing main", () => {
  assert.equal(
    runHook([
      `refs/heads/task-019-x ${SHA_A} refs/heads/task-019-x ${SHA_B}`,
      `refs/heads/main ${SHA_A} refs/heads/main ${SHA_B}`,
    ]).status,
    1,
  );
});

test("allows a tag named main and similarly named branches", () => {
  assert.equal(
    runHook([
      `refs/tags/main ${SHA_A} refs/tags/main ${ZERO}`,
      `refs/heads/maintenance ${SHA_A} refs/heads/maintenance ${SHA_B}`,
    ]).status,
    0,
  );
});

test("allows an empty push", () => {
  assert.equal(runHook([]).status, 0);
});

test("refuses an unterminated main update and explains the failure", () => {
  const result = runHook(
    [`refs/heads/main ${SHA_A} refs/heads/main ${SHA_B}`],
    { terminalNewline: false },
  );

  assert.equal(result.status, 1);
  assert.match(result.stderr, /refusing to push directly/);
  assert.match(result.stderr, /task-NNN-short-slug/);
});

test("allows an unterminated task-branch update without hanging", () => {
  const result = runHook(
    [
      `refs/heads/task-018-x ${SHA_A} refs/heads/task-018-x ${SHA_B}`,
      `refs/heads/task-019-x ${SHA_A} refs/heads/task-019-x ${SHA_B}`,
    ],
    { terminalNewline: false },
  );

  assert.equal(result.status, 0);
});
