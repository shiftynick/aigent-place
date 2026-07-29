import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const BOARD = resolve(HERE, "board-html.mjs");
const TASK = resolve(HERE, "task.mjs");

function fixtureRepo() {
  const root = mkdtempSync(join(tmpdir(), "tt-board-"));
  mkdirSync(join(root, ".git"));
  return root;
}

function run(script, repo, args = []) {
  return execFileSync("node", [script, ...args], {
    cwd: repo,
    encoding: "utf8",
  });
}

function complete(repo, id) {
  run(TASK, repo, ["move", id, "in_progress"]);
  run(TASK, repo, ["move", id, "review"]);
  run(TASK, repo, ["move", id, "done"]);
}

describe("board-html", () => {
  it("writes the default board and escapes task content", () => {
    const repo = fixtureRepo();
    try {
      run(TASK, repo, ["add", "<script>alert(1)</script>"]);
      const output = run(BOARD, repo).trim();
      const boardPath = join(repo, ".tasks", "board.html");
      assert.equal(output, boardPath);
      assert.ok(existsSync(boardPath));
      const html = readFileSync(boardPath, "utf8");
      assert.match(html, /Project task board/);
      assert.match(html, /&lt;script&gt;alert\(1\)&lt;\/script&gt;/);
      assert.doesNotMatch(html, /<script>alert\(1\)<\/script>/);
    } finally {
      rmSync(repo, { recursive: true, force: true });
    }
  });

  it("resolves blockers against archived task context", () => {
    const repo = fixtureRepo();
    try {
      run(TASK, repo, ["add", "Blocker"]);
      run(TASK, repo, ["add", "Dependent", "--blocked-by", "task-001"]);
      complete(repo, "task-001");
      run(TASK, repo, ["archive"]);
      run(BOARD, repo);
      const html = readFileSync(join(repo, ".tasks", "board.html"), "utf8");
      assert.match(html, /class="blocker met" title="blocker done">task-001/);
      assert.doesNotMatch(html, /class="blocker unmet"[^>]*>task-001/);
    } finally {
      rmSync(repo, { recursive: true, force: true });
    }
  });

  it("supports a custom output path and rejects a missing value", () => {
    const repo = fixtureRepo();
    try {
      run(TASK, repo, ["add", "X"]);
      const custom = join(repo, "generated", "boards", "custom-board.html");
      assert.equal(run(BOARD, repo, ["--out", custom]).trim(), custom);
      assert.ok(existsSync(custom));
      assert.throws(
        () => run(BOARD, repo, ["--out"]),
        (err) => err.status === 2 && /requires a path/.test(String(err.stderr)),
      );
    } finally {
      rmSync(repo, { recursive: true, force: true });
    }
  });

  it("reports a live repo-lock collision as exit 5 without a stack trace", () => {
    const repo = fixtureRepo();
    try {
      const lock = join(repo, ".tasks", ".write-lock");
      mkdirSync(lock, { recursive: true });
      writeFileSync(join(lock, "owner.json"), JSON.stringify({ pid: process.pid }));
      assert.throws(
        () => run(BOARD, repo),
        (err) =>
          err.status === 5 &&
          /lock held by another process/.test(String(err.stderr)) &&
          !/\bat\s+/.test(String(err.stderr)),
      );
    } finally {
      rmSync(repo, { recursive: true, force: true });
    }
  });
});
