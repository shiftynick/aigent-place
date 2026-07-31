import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { execFileSync, spawn } from "node:child_process";
import { existsSync, mkdtempSync, mkdirSync, readdirSync, rmSync, readFileSync, writeFileSync } from "node:fs";
import { join, dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { tmpdir } from "node:os";

const HERE = dirname(fileURLToPath(import.meta.url));
const SCRIPT = resolve(HERE, "task.mjs");

function fixtureRepo() {
  const root = mkdtempSync(join(tmpdir(), "tt-cli-"));
  mkdirSync(join(root, ".git"));
  return root;
}

function run(repo, args, options = {}) {
  return execFileSync("node", [SCRIPT, ...args], {
    cwd: repo,
    encoding: "utf8",
    ...options,
  });
}

function runAsync(repo, args) {
  return new Promise((resolveRun) => {
    const child = spawn("node", [SCRIPT, ...args], { cwd: repo });
    let stdout = "";
    let stderr = "";
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk) => { stdout += chunk; });
    child.stderr.on("data", (chunk) => { stderr += chunk; });
    child.on("close", (code) => resolveRun({ code, stdout, stderr }));
  });
}

function git(repo, args) {
  return execFileSync("git", args, { cwd: repo, encoding: "utf8" });
}

function gitFixtureRepo() {
  const root = mkdtempSync(join(tmpdir(), "tt-git-cli-"));
  git(root, ["init", "-b", "integration"]);
  git(root, ["config", "user.email", "task-tracker@example.invalid"]);
  git(root, ["config", "user.name", "Task Tracker Test"]);
  git(root, ["config", "commit.gpgsign", "false"]);
  git(root, ["config", "core.autocrlf", "false"]);
  git(root, ["config", "core.hooksPath", ".no-hooks"]);
  writeFileSync(
    join(root, ".agent-foundry.json"),
    `${JSON.stringify({ defaultBranch: "integration" }, null, 2)}\n`,
  );
  git(root, ["add", ".agent-foundry.json"]);
  git(root, ["commit", "-m", "baseline"]);
  return root;
}

function completeTask(repo, id) {
  run(repo, ["move", id, "in_progress"]);
  run(repo, ["move", id, "review"]);
  run(repo, ["move", id, "done"]);
}

describe("task run (recorded evidence)", () => {
  it("records command, exit code, and output tail in the task log", () => {
    const repo = fixtureRepo();
    try {
      run(repo, ["add", "Alpha"]);
      const out = run(repo, ["run", "task-001", "--", "node", "-e", '"console.log(41+1)"']);
      assert.match(out, /42/);
      assert.match(out, /task-001 evidence recorded: exit 0 in [\d.]+s/);
      const shown = run(repo, ["show", "task-001"]);
      assert.match(shown, /run: node -e "console\.log\(41\+1\)"/);
      assert.match(shown, /exit 0 in [\d.]+s/);
      assert.match(shown, /\| 42/);
    } finally {
      rmSync(repo, { recursive: true, force: true });
    }
  });

  it("never writes trailing whitespace, even for blank output lines", () => {
    const repo = fixtureRepo();
    try {
      run(repo, ["add", "Alpha"]);
      run(repo, [
        "run", "task-001", "--",
        "node", "-e", `"console.log('a');console.log('');console.log('b')"`,
      ]);
      const file = readFileSync(
        join(repo, ".tasks", "tasks", "task-001-alpha.md"),
        "utf8",
      );
      // Evidence has to be committable: a "  | " line fails `git diff --check`
      // and any trailing-whitespace hook. Scope note: this asserts the PREFIX
      // adds none — whitespace inside a command's own output is preserved on
      // purpose, because evidence is a record, not a reformat.
      const offenders = file.split("\n").filter((line) => /[ \t]$/u.test(line));
      assert.deepEqual(offenders, []);
      assert.match(file, /\n {2}\|\n/u);
    } finally {
      rmSync(repo, { recursive: true, force: true });
    }
  });

  it("records a failing command and exits 1", () => {
    const repo = fixtureRepo();
    try {
      run(repo, ["add", "Alpha"]);
      assert.throws(
        () => run(repo, ["run", "task-001", "--", "node", "-e", '"process.exit(3)"']),
        (err) => err.status === 1 && /command failed \(exit 3/.test(String(err.stderr)),
      );
      // The failure is still evidence: it must be in the log.
      assert.match(run(repo, ["show", "task-001"]), /exit 3 in [\d.]+s/);
    } finally {
      rmSync(repo, { recursive: true, force: true });
    }
  });

  it("fails fast with exit 4 for an unknown task id", () => {
    const repo = fixtureRepo();
    try {
      assert.throws(
        () => run(repo, ["run", "task-999", "--", "node", "--version"]),
        (err) => err.status === 4,
      );
    } finally {
      rmSync(repo, { recursive: true, force: true });
    }
  });

  it("requires both an id and a command", () => {
    const repo = fixtureRepo();
    try {
      run(repo, ["add", "Alpha"]);
      assert.throws(
        () => run(repo, ["run", "task-001"]),
        (err) => err.status === 2 && /usage: task\.mjs run/.test(String(err.stderr)),
      );
    } finally {
      rmSync(repo, { recursive: true, force: true });
    }
  });
});

describe("claim ownership", () => {
  it("records the claim on move to in_progress and shows it", () => {
    const repo = fixtureRepo();
    try {
      run(repo, ["add", "Alpha"]);
      const moved = run(repo, ["move", "task-001", "in_progress"], {
        env: { ...process.env, FOUNDRY_AGENT: "session-42" },
      });
      assert.match(moved, /task-001 → in_progress/);
      const shown = run(repo, ["show", "task-001"]);
      assert.match(shown, /claimedBy: session-42/);
      assert.match(shown, /claimedAt: \d{4}-/);
      assert.match(run(repo, ["board"]), /task-001.*\[session-42\]/);
    } finally {
      rmSync(repo, { recursive: true, force: true });
    }
  });

  it("clears the claim on any move out of in_progress", () => {
    const repo = fixtureRepo();
    try {
      run(repo, ["add", "Alpha"]);
      run(repo, ["move", "task-001", "in_progress"]);
      run(repo, ["move", "task-001", "review"]);
      const shown = run(repo, ["show", "task-001"]);
      assert.doesNotMatch(shown, /claimedBy/);
      const file = readFileSync(
        join(repo, ".tasks", "tasks", "task-001-alpha.md"),
        "utf8",
      );
      assert.doesNotMatch(file, /claimedBy/);
    } finally {
      rmSync(repo, { recursive: true, force: true });
    }
  });

  it("re-claiming records the new owner", () => {
    const repo = fixtureRepo();
    try {
      run(repo, ["add", "Alpha"]);
      run(repo, ["move", "task-001", "in_progress"], {
        env: { ...process.env, FOUNDRY_AGENT: "session-1" },
      });
      run(repo, ["move", "task-001", "blocked"]);
      run(repo, ["move", "task-001", "in_progress"], {
        env: { ...process.env, FOUNDRY_AGENT: "session-2" },
      });
      assert.match(run(repo, ["show", "task-001"]), /claimedBy: session-2/);
    } finally {
      rmSync(repo, { recursive: true, force: true });
    }
  });
});

describe("option values that begin with dashes", () => {
  it("accepts free text starting with dashes in a note", () => {
    const repo = fixtureRepo();
    try {
      run(repo, ["add", "Alpha"]);
      run(repo, ["note", "task-001", "--force was needed here"]);
      const out = run(repo, ["show", "task-001"]);
      assert.match(out, /--force was needed here/);
    } finally {
      rmSync(repo, { recursive: true, force: true });
    }
  });

  it("accepts a description starting with dashes", () => {
    const repo = fixtureRepo();
    try {
      run(repo, ["add", "Alpha", "--description", "-- leading dashes"]);
      assert.match(run(repo, ["show", "task-001"]), /-- leading dashes/);
    } finally {
      rmSync(repo, { recursive: true, force: true });
    }
  });

  it("still rejects a swallowed known flag", () => {
    const repo = fixtureRepo();
    try {
      assert.throws(
        () => run(repo, ["add", "Alpha", "--tag", "--json"]),
        (err) => err.status === 2 && /requires a value/.test(String(err.stderr)),
      );
    } finally {
      rmSync(repo, { recursive: true, force: true });
    }
  });

  it("positional free text shaped like --x=y survives verbatim", () => {
    const repo = fixtureRepo();
    try {
      run(repo, ["add", "Alpha"]);
      run(repo, ["note", "task-001", "--max-budget-usd=3 was used"]);
      // The unknown-flag shape must not be split into flag + value: that
      // silently truncated the note to its prefix.
      assert.match(run(repo, ["show", "task-001"]), /--max-budget-usd=3 was used/);
    } finally {
      rmSync(repo, { recursive: true, force: true });
    }
  });

  it("a bare -- makes everything after it literal", () => {
    const repo = fixtureRepo();
    try {
      run(repo, ["add", "Alpha"]);
      // Even text starting with a *recognized* flag name survives after --.
      run(repo, ["note", "task-001", "--", "--description=not a flag"]);
      assert.match(run(repo, ["show", "task-001"]), /--description=not a flag/);
      run(repo, ["add", "--", "--force is a title"]);
      assert.match(run(repo, ["show", "task-002"]), /--force is a title/);
    } finally {
      rmSync(repo, { recursive: true, force: true });
    }
  });

  it("--flag=value passes a value that is literally a flag name", () => {
    const repo = fixtureRepo();
    try {
      run(repo, ["add", "Alpha", "--description=--json"]);
      assert.match(run(repo, ["show", "task-001"]), /--json/);
    } finally {
      rmSync(repo, { recursive: true, force: true });
    }
  });

  it("--title carries a title the positional form cannot express", () => {
    const repo = fixtureRepo();
    try {
      run(repo, ["add", "--title=--weird title"]);
      assert.match(run(repo, ["show", "task-001"]), /--weird title/);
    } finally {
      rmSync(repo, { recursive: true, force: true });
    }
  });
});

describe("task add", () => {
  it("keeps default IDs compact and merges stale branch allocations without collision", () => {
    const repo = gitFixtureRepo();
    try {
      assert.equal(run(repo, ["add", "Default card"]).trim(), "task-001");
      git(repo, ["add", ".tasks"]);
      git(repo, ["commit", "-m", "default card"]);

      git(repo, ["switch", "-c", "work/alpha"]);
      const alpha = run(repo, ["add", "Alpha branch card"]).trim();
      git(repo, ["add", ".tasks"]);
      git(repo, ["commit", "-m", "alpha card"]);

      git(repo, ["switch", "integration"]);
      git(repo, ["switch", "-c", "work/beta"]);
      const beta = run(repo, ["add", "Beta branch card"]).trim();
      git(repo, ["add", ".tasks"]);
      git(repo, ["commit", "-m", "beta card"]);
      git(repo, ["cherry-pick", "work/alpha"]);

      assert.match(alpha, /^task-\d{16}$/u);
      assert.match(beta, /^task-\d{16}$/u);
      assert.notEqual(alpha, beta);
      const list = run(repo, ["list"]);
      assert.match(list, new RegExp(alpha, "u"));
      assert.match(list, new RegExp(beta, "u"));
      for (const id of [alpha, beta]) {
        const file = readdirSync(join(repo, ".tasks", "tasks"))
          .find((name) => name.startsWith(`${id}-`));
        assert(file);
        assert.match(
          readFileSync(join(repo, ".tasks", "tasks", file), "utf8"),
          new RegExp(`^id: ${id}$`, "mu"),
        );
      }
    } finally {
      rmSync(repo, { recursive: true, force: true });
    }
  });

  it("keeps compact IDs on an unborn default branch", () => {
    const repo = fixtureRepo();
    try {
      git(repo, ["init", "-b", "integration"]);
      assert.equal(run(repo, ["add", "First card"]).trim(), "task-001");
    } finally {
      rmSync(repo, { recursive: true, force: true });
    }
  });

  it("uses a stable namespace in detached HEAD state", () => {
    const repo = gitFixtureRepo();
    try {
      git(repo, ["switch", "--detach"]);
      assert.match(run(repo, ["add", "Detached card"]).trim(), /^task-\d{16}$/u);
    } finally {
      rmSync(repo, { recursive: true, force: true });
    }
  });

  it("uses remote HEAD when installed default-branch metadata is malformed", () => {
    const repo = gitFixtureRepo();
    try {
      writeFileSync(join(repo, ".agent-foundry.json"), "{ malformed\n");
      git(repo, ["update-ref", "refs/remotes/origin/integration", "HEAD"]);
      git(repo, [
        "symbolic-ref",
        "refs/remotes/origin/HEAD",
        "refs/remotes/origin/integration",
      ]);
      assert.equal(run(repo, ["add", "Remote default card"]).trim(), "task-001");
    } finally {
      rmSync(repo, { recursive: true, force: true });
    }
  });

  it("creates a new task file with defaults", () => {
    const repo = fixtureRepo();
    try {
      const out = run(repo, ["add", "Do the thing"]);
      assert.match(out, /task-001/);
      const file = readFileSync(join(repo, ".tasks", "tasks", "task-001-do-the-thing.md"), "utf8");
      assert.match(file, /id: task-001/);
      assert.match(file, /title: Do the thing/);
      assert.match(file, /status: backlog/);
      assert.match(file, /priority: p2/);
      assert.match(file, /tags: \[\]/);
      assert.match(file, /blockedBy: \[\]/);
      assert.match(file, /## Log\s*\n\s*\n- .* — created \(status: backlog\)/);
    } finally {
      rmSync(repo, { recursive: true, force: true });
    }
  });

  it("respects --priority, --tag, --description", () => {
    const repo = fixtureRepo();
    try {
      run(repo, [
        "add",
        "With opts",
        "--priority", "p1",
        "--tag", "area:web",
        "--tag", "phase:stab",
        "--description", "Some body text",
      ]);
      const file = readFileSync(join(repo, ".tasks", "tasks", "task-001-with-opts.md"), "utf8");
      assert.match(file, /priority: p1/);
      assert.match(file, /tags: \[area:web, phase:stab\]/);
      assert.match(file, /## Description\s*\n\s*\nSome body text/);
    } finally {
      rmSync(repo, { recursive: true, force: true });
    }
  });

  it("increments task id from existing files", () => {
    const repo = fixtureRepo();
    try {
      run(repo, ["add", "First"]);
      run(repo, ["add", "Second"]);
      const out = run(repo, ["add", "Third"]);
      assert.match(out, /task-003/);
    } finally {
      rmSync(repo, { recursive: true, force: true });
    }
  });

  it("serializes concurrent adds so distinct titles cannot share an id", async () => {
    const repo = fixtureRepo();
    try {
      const calls = [
        ["add", "Concurrent A"],
        ["add", "Concurrent B"],
      ];
      const results = await Promise.all(calls.map((args) => runAsync(repo, args)));
      // The lock's backoff normally lets both adds through. Exit 5 is still
      // accepted rather than asserted against: a machine slow enough to
      // exhaust the retry window must degrade to a conflict, not a duplicate
      // id, and asserting "both succeed" would make this test timing-bound.
      for (let i = 0; i < results.length; i++) {
        if (results[i].code === 0) continue;
        assert.equal(results[i].code, 5, results[i].stderr);
        run(repo, calls[i]);
      }
      const tasks = JSON.parse(run(repo, ["list", "--json"]));
      assert.deepEqual(tasks.map((task) => task.id), ["task-001", "task-002"]);
      assert.deepEqual(new Set(tasks.map((task) => task.title)), new Set(["Concurrent A", "Concurrent B"]));
    } finally {
      rmSync(repo, { recursive: true, force: true });
    }
  });

  it("increments task id from archived files", () => {
    const repo = fixtureRepo();
    try {
      run(repo, ["add", "First"]);
      completeTask(repo, "task-001");
      run(repo, ["archive"]);

      const out = run(repo, ["add", "Second"]);
      assert.match(out, /task-002/);
      assert.ok(existsSync(join(repo, ".tasks", "archive", "task-001-first.md")));
      assert.ok(existsSync(join(repo, ".tasks", "tasks", "task-002-second.md")));
    } finally {
      rmSync(repo, { recursive: true, force: true });
    }
  });

  it("rejects bad priority enum (exit 2)", () => {
    const repo = fixtureRepo();
    try {
      assert.throws(
        () => run(repo, ["add", "Bad", "--priority", "p9"]),
        (err) => err.status === 2,
      );
    } finally {
      rmSync(repo, { recursive: true, force: true });
    }
  });

  it("rejects a nonexistent blocker and a missing option value", () => {
    const repo = fixtureRepo();
    try {
      assert.throws(
        () => run(repo, ["add", "Bad dep", "--blocked-by", "task-999"]),
        (err) => err.status === 2 && /unknown blocker/.test(String(err.stderr)),
      );
      assert.throws(
        () => run(repo, ["add", "Bad option", "--priority"]),
        (err) => err.status === 2 && /requires a value/.test(String(err.stderr)),
      );
    } finally {
      rmSync(repo, { recursive: true, force: true });
    }
  });

  it("rejects unsafe and reserved frontmatter values", () => {
    const repo = fixtureRepo();
    try {
      assert.throws(() => run(repo, ["add", "X", "--tag", " "]), (err) => err.status === 2);
      assert.throws(() => run(repo, ["add", "X", "--tag", "deleted:true"]), (err) => err.status === 2);
      assert.throws(() => run(repo, ["add", "line\nbreak"]), (err) => err.status === 2);
      assert.throws(
        () => run(repo, ["add", "X", "--description", "<!-- task-tracker:log -->"]),
        (err) => err.status === 2,
      );
      assert.throws(
        () => run(repo, ["add", "<!-- task-tracker:log -->"]),
        (err) => err.status === 2,
      );
      run(repo, ["add", "Safe"]);
      assert.throws(
        () => run(repo, ["note", "task-001", "<!-- task-tracker:log -->"]),
        (err) => err.status === 2,
      );
    } finally {
      rmSync(repo, { recursive: true, force: true });
    }
  });
});

describe("task move", () => {
  it("moves between statuses", () => {
    const repo = fixtureRepo();
    try {
      run(repo, ["add", "X"]);
      run(repo, ["move", "task-001", "ready"]);
      const file = readFileSync(join(repo, ".tasks", "tasks", "task-001-x.md"), "utf8");
      assert.match(file, /status: ready/);
      assert.match(file, /— moved to ready/);
    } finally {
      rmSync(repo, { recursive: true, force: true });
    }
  });

  it("refuses move to in_progress when blocker is not done (exit 2)", () => {
    const repo = fixtureRepo();
    try {
      run(repo, ["add", "Blocker"]);
      run(repo, ["add", "Blocked", "--blocked-by", "task-001"]);
      run(repo, ["move", "task-002", "ready"]);
      assert.throws(
        () => run(repo, ["move", "task-002", "in_progress"]),
        (err) => err.status === 2 && /blocked by task-001/.test(String(err.stderr)),
      );
    } finally {
      rmSync(repo, { recursive: true, force: true });
    }
  });

  it("--force overrides and logs the override", () => {
    const repo = fixtureRepo();
    try {
      run(repo, ["add", "Blocker"]);
      run(repo, ["add", "Blocked", "--blocked-by", "task-001"]);
      run(repo, ["move", "task-002", "ready"]);
      run(repo, ["move", "task-002", "in_progress", "--force"]);
      const file = readFileSync(join(repo, ".tasks", "tasks", "task-002-blocked.md"), "utf8");
      assert.match(file, /status: in_progress/);
      assert.match(file, /— moved to in_progress \(claimed by [^;)]+; forced/);
    } finally {
      rmSync(repo, { recursive: true, force: true });
    }
  });

  it("rejects unknown status (exit 2)", () => {
    const repo = fixtureRepo();
    try {
      run(repo, ["add", "X"]);
      assert.throws(
        () => run(repo, ["move", "task-001", "bogus"]),
        (err) => err.status === 2,
      );
    } finally {
      rmSync(repo, { recursive: true, force: true });
    }
  });

  it("returns exit 4 for unknown id", () => {
    const repo = fixtureRepo();
    try {
      assert.throws(
        () => run(repo, ["move", "task-999", "ready"]),
        (err) => err.status === 4,
      );
    } finally {
      rmSync(repo, { recursive: true, force: true });
    }
  });

  it("rejects skipping review unless explicitly forced", () => {
    const repo = fixtureRepo();
    try {
      run(repo, ["add", "X"]);
      assert.throws(
        () => run(repo, ["move", "task-001", "done"]),
        (err) => err.status === 2 && /illegal transition backlog -> done/.test(String(err.stderr)),
      );
      run(repo, ["move", "task-001", "done", "--force"]);
      assert.match(
        readFileSync(join(repo, ".tasks", "tasks", "task-001-x.md"), "utf8"),
        /moved to done \(forced\)/,
      );
    } finally {
      rmSync(repo, { recursive: true, force: true });
    }
  });

  it("can block during review and resume review after the blocker clears", () => {
    const repo = fixtureRepo();
    try {
      run(repo, ["add", "X"]);
      run(repo, ["move", "task-001", "in_progress"]);
      run(repo, ["move", "task-001", "review"]);
      run(repo, ["move", "task-001", "blocked"]);
      run(repo, ["move", "task-001", "review"]);
      assert.match(
        readFileSync(join(repo, ".tasks", "tasks", "task-001-x.md"), "utf8"),
        /status: review/,
      );
    } finally {
      rmSync(repo, { recursive: true, force: true });
    }
  });
});

describe("task note", () => {
  it("appends a note line without changing state", () => {
    const repo = fixtureRepo();
    try {
      run(repo, ["add", "X"]);
      run(repo, ["note", "task-001", "blocked on Y"]);
      const file = readFileSync(join(repo, ".tasks", "tasks", "task-001-x.md"), "utf8");
      assert.match(file, /status: backlog/);
      assert.match(file, /— note: blocked on Y/);
    } finally {
      rmSync(repo, { recursive: true, force: true });
    }
  });
});

describe("task list", () => {
  function seed(repo) {
    run(repo, ["add", "Alpha", "--priority", "p0", "--tag", "area:web"]);
    run(repo, ["add", "Beta", "--priority", "p1", "--tag", "area:db"]);
    run(repo, ["add", "Gamma", "--blocked-by", "task-001"]);
    run(repo, ["move", "task-001", "ready"]);
    run(repo, ["move", "task-002", "ready"]);
    run(repo, ["move", "task-003", "ready"]);
  }

  it("lists all by default, sorted by priority", () => {
    const repo = fixtureRepo();
    try {
      seed(repo);
      const out = run(repo, ["list"]);
      const lines = out.trim().split(/\r?\n/);
      assert.match(lines[0], /task-001\s+ready\s+p0/);
      assert.match(lines[1], /task-002\s+ready\s+p1/);
    } finally {
      rmSync(repo, { recursive: true, force: true });
    }
  });

  it("filters by --status", () => {
    const repo = fixtureRepo();
    try {
      run(repo, ["add", "X"]);
      run(repo, ["add", "Y"]);
      run(repo, ["move", "task-001", "ready"]);
      const out = run(repo, ["list", "--status", "ready"]);
      assert.match(out, /task-001/);
      assert.doesNotMatch(out, /task-002/);
    } finally {
      rmSync(repo, { recursive: true, force: true });
    }
  });

  it("filters by --tag", () => {
    const repo = fixtureRepo();
    try {
      seed(repo);
      const out = run(repo, ["list", "--tag", "area:web"]);
      assert.match(out, /task-001/);
      assert.doesNotMatch(out, /task-002/);
    } finally {
      rmSync(repo, { recursive: true, force: true });
    }
  });

  it("--blocked shows only tasks with unmet blockers", () => {
    const repo = fixtureRepo();
    try {
      seed(repo);
      const out = run(repo, ["list", "--blocked"]);
      assert.match(out, /task-003/);
      assert.doesNotMatch(out, /task-001\b/);
    } finally {
      rmSync(repo, { recursive: true, force: true });
    }
  });

  it("--ready shows only claimable tasks", () => {
    const repo = fixtureRepo();
    try {
      seed(repo);
      const out = run(repo, ["list", "--ready"]);
      assert.match(out, /task-001/);
      assert.match(out, /task-002/);
      assert.doesNotMatch(out, /task-003/); // blocked by task-001 which is ready, not done
    } finally {
      rmSync(repo, { recursive: true, force: true });
    }
  });

  it("--json emits a JSON array", () => {
    const repo = fixtureRepo();
    try {
      run(repo, ["add", "X"]);
      const out = run(repo, ["list", "--json"]);
      const arr = JSON.parse(out);
      assert.equal(arr.length, 1);
      assert.equal(arr[0].id, "task-001");
    } finally {
      rmSync(repo, { recursive: true, force: true });
    }
  });

  it("rejects --blocked + --ready combination (exit 2)", () => {
    const repo = fixtureRepo();
    try {
      run(repo, ["add", "X"]);
      assert.throws(
        () => run(repo, ["list", "--blocked", "--ready"]),
        (err) => err.status === 2 && /mutually exclusive/.test(String(err.stderr)),
      );
    } finally {
      rmSync(repo, { recursive: true, force: true });
    }
  });

  it("refuses to move a soft-deleted task, even with --force", () => {
    const repo = fixtureRepo();
    try {
      run(repo, ["add", "Alpha"]);
      run(repo, ["rm", "task-001"]);
      for (const args of [
        ["move", "task-001", "backlog"],
        ["move", "task-001", "backlog", "--force"],
      ]) {
        assert.throws(
          () => run(repo, args),
          // Usage-level exit 2 with a plain explanation, not the exit-1
          // serialization error that forcing past this used to produce.
          (err) => err.status === 2 && /soft-deleted/.test(String(err.stderr)),
        );
      }
      assert.match(run(repo, ["show", "task-001"]), /status: done/);
    } finally {
      rmSync(repo, { recursive: true, force: true });
    }
  });

  it("applies the repo lock to read commands", () => {
    const repo = fixtureRepo();
    try {
      const lock = join(repo, ".tasks", ".write-lock");
      mkdirSync(lock, { recursive: true });
      writeFileSync(join(lock, "owner.json"), JSON.stringify({ pid: process.pid }));
      assert.throws(
        () => run(repo, ["list"]),
        (err) => err.status === 5 && /lock held by another process/.test(String(err.stderr)),
      );
    } finally {
      rmSync(repo, { recursive: true, force: true });
    }
  });
});

describe("task board", () => {
  it("renders columns including statuses with no tasks", () => {
    const repo = fixtureRepo();
    try {
      run(repo, ["add", "Alpha"]);
      const out = run(repo, ["board"]);
      assert.match(out, /BACKLOG/);
      assert.match(out, /READY/);
      assert.match(out, /IN_PROGRESS/);
      assert.match(out, /REVIEW/);
      assert.match(out, /DONE/);
      assert.match(out, /BLOCKED/);
      assert.match(out, /task-001/);
    } finally {
      rmSync(repo, { recursive: true, force: true });
    }
  });
});

describe("task show", () => {
  it("prints frontmatter, body, and unmet blockers line", () => {
    const repo = fixtureRepo();
    try {
      run(repo, ["add", "Blocker"]);
      run(repo, ["add", "Blocked", "--blocked-by", "task-001", "--description", "blocking body"]);
      const out = run(repo, ["show", "task-002"]);
      assert.match(out, /id:\s*task-002/);
      assert.match(out, /blocking body/);
      assert.match(out, /unmet blockers: task-001/);
    } finally {
      rmSync(repo, { recursive: true, force: true });
    }
  });
});

describe("task next", () => {
  it("prints highest-priority claimable id", () => {
    const repo = fixtureRepo();
    try {
      run(repo, ["add", "Low", "--priority", "p3"]);
      run(repo, ["add", "High", "--priority", "p0"]);
      run(repo, ["move", "task-001", "ready"]);
      run(repo, ["move", "task-002", "ready"]);
      const out = run(repo, ["next"]);
      assert.equal(out.trim(), "task-002");
    } finally {
      rmSync(repo, { recursive: true, force: true });
    }
  });

  it("surfaces backlog tasks too -- no explicit promotion to ready required", () => {
    const repo = fixtureRepo();
    try {
      // Both filed at the default `backlog` status; no `move ... ready`.
      run(repo, ["add", "Low", "--priority", "p3"]);
      run(repo, ["add", "High", "--priority", "p0"]);
      const out = run(repo, ["next"]);
      assert.equal(out.trim(), "task-002");
    } finally {
      rmSync(repo, { recursive: true, force: true });
    }
  });

  it("prefers a ready task over a backlog task at the same priority", () => {
    const repo = fixtureRepo();
    try {
      run(repo, ["add", "Backlog one", "--priority", "p1"]);
      run(repo, ["add", "Ready one", "--priority", "p1"]);
      run(repo, ["move", "task-002", "ready"]);
      const out = run(repo, ["next"]);
      assert.equal(out.trim(), "task-002");
    } finally {
      rmSync(repo, { recursive: true, force: true });
    }
  });

  it("exits 0 with no output when nothing is claimable", () => {
    const repo = fixtureRepo();
    try {
      const out = run(repo, ["next"]);
      assert.equal(out, "");
    } finally {
      rmSync(repo, { recursive: true, force: true });
    }
  });
});

describe("task archive", () => {
  it("explains that a positional task ID is not accepted", () => {
    const repo = fixtureRepo();
    try {
      assert.throws(
        () => run(repo, ["archive", "task-001"]),
        (error) => error.status === 2
          && /archive sweeps all done tasks and takes no task ID/u.test(String(error.stderr))
          && /archive \[--dry-run\]/u.test(String(error.stderr)),
      );
    } finally {
      rmSync(repo, { recursive: true, force: true });
    }
  });

  it("retains an actionable unknown-flag error", () => {
    const repo = fixtureRepo();
    try {
      assert.throws(
        () => run(repo, ["archive", "-n"]),
        (error) => error.status === 2 && /unknown flag: -n/u.test(String(error.stderr)),
      );
    } finally {
      rmSync(repo, { recursive: true, force: true });
    }
  });

  it("moves done tasks into .tasks/archive and leaves active tasks visible", () => {
    const repo = fixtureRepo();
    try {
      run(repo, ["add", "Finished"]);
      run(repo, ["add", "Still active"]);
      completeTask(repo, "task-001");
      run(repo, ["move", "task-002", "ready"]);
      const out = run(repo, ["archive"]);
      assert.match(out, /archived 1 task/);
      assert.equal(existsSync(join(repo, ".tasks", "tasks", "task-001-finished.md")), false);
      assert.equal(existsSync(join(repo, ".tasks", "archive", "task-001-finished.md")), true);

      const list = run(repo, ["list"]);
      assert.doesNotMatch(list, /task-001/);
      assert.match(list, /task-002/);
    } finally {
      rmSync(repo, { recursive: true, force: true });
    }
  });

  it("keeps archived done blockers satisfied for next and move", () => {
    const repo = fixtureRepo();
    try {
      run(repo, ["add", "Blocker"]);
      run(repo, ["add", "Blocked", "--blocked-by", "task-001"]);
      completeTask(repo, "task-001");
      run(repo, ["move", "task-002", "ready"]);
      run(repo, ["archive"]);

      assert.equal(run(repo, ["next"]).trim(), "task-002");
      run(repo, ["move", "task-002", "in_progress"]);
      const file = readFileSync(join(repo, ".tasks", "tasks", "task-002-blocked.md"), "utf8");
      assert.match(file, /status: in_progress/);
    } finally {
      rmSync(repo, { recursive: true, force: true });
    }
  });

  it("--dry-run reports planned moves without changing files", () => {
    const repo = fixtureRepo();
    try {
      run(repo, ["add", "Finished"]);
      completeTask(repo, "task-001");
      const out = run(repo, ["archive", "--dry-run"]);
      assert.match(out, /task-001 -> /);
      assert.match(out, /would archive 1 task/);
      assert.equal(existsSync(join(repo, ".tasks", "tasks", "task-001-finished.md")), true);
      assert.equal(existsSync(join(repo, ".tasks", "archive", "task-001-finished.md")), false);
    } finally {
      rmSync(repo, { recursive: true, force: true });
    }
  });
});

describe("task edit", () => {
  it("changes title and priority and logs the diff", () => {
    const repo = fixtureRepo();
    try {
      run(repo, ["add", "Old"]);
      run(repo, ["edit", "task-001", "--title", "New", "--priority", "p0"]);
      const file = readFileSync(join(repo, ".tasks", "tasks", "task-001-old.md"), "utf8");
      assert.match(file, /title: New/);
      assert.match(file, /priority: p0/);
      assert.match(file, /— edited \(/);
    } finally {
      rmSync(repo, { recursive: true, force: true });
    }
  });

  it("adds and removes tags", () => {
    const repo = fixtureRepo();
    try {
      run(repo, ["add", "X", "--tag", "area:web"]);
      run(repo, ["edit", "task-001", "--add-tag", "area:db", "--remove-tag", "area:web"]);
      const file = readFileSync(join(repo, ".tasks", "tasks", "task-001-x.md"), "utf8");
      assert.match(file, /tags: \[area:db\]/);
    } finally {
      rmSync(repo, { recursive: true, force: true });
    }
  });

  it("rejects cyclic --add-blocked-by (exit 2)", () => {
    const repo = fixtureRepo();
    try {
      run(repo, ["add", "A"]);
      run(repo, ["add", "B", "--blocked-by", "task-001"]);
      assert.throws(
        () => run(repo, ["edit", "task-001", "--add-blocked-by", "task-002"]),
        (err) => err.status === 2,
      );
    } finally {
      rmSync(repo, { recursive: true, force: true });
    }
  });

  it("rejects nonexistent and deleted blockers", () => {
    const repo = fixtureRepo();
    try {
      run(repo, ["add", "A"]);
      run(repo, ["add", "B"]);
      assert.throws(
        () => run(repo, ["edit", "task-002", "--add-blocked-by", "task-999"]),
        (err) => err.status === 2 && /unknown blocker/.test(String(err.stderr)),
      );
      run(repo, ["rm", "task-001"]);
      assert.throws(
        () => run(repo, ["edit", "task-002", "--add-blocked-by", "task-001"]),
        (err) => err.status === 2 && /deleted task cannot be a blocker/.test(String(err.stderr)),
      );
    } finally {
      rmSync(repo, { recursive: true, force: true });
    }
  });

  it("allows adding a live blocker when an existing blocker was deleted", () => {
    const repo = fixtureRepo();
    try {
      run(repo, ["add", "A"]);
      run(repo, ["add", "B", "--blocked-by", "task-001"]);
      run(repo, ["add", "C"]);
      run(repo, ["rm", "task-001"]);
      run(repo, ["edit", "task-002", "--add-blocked-by", "task-003"]);
      const file = readFileSync(join(repo, ".tasks", "tasks", "task-002-b.md"), "utf8");
      assert.match(file, /blockedBy: \[task-001, task-003\]/);
    } finally {
      rmSync(repo, { recursive: true, force: true });
    }
  });

  it("does not allow editing the reserved tombstone tag", () => {
    const repo = fixtureRepo();
    try {
      run(repo, ["add", "A"]);
      run(repo, ["rm", "task-001"]);
      assert.throws(
        () => run(repo, ["edit", "task-001", "--remove-tag", "deleted:true"]),
        (err) => err.status === 2 && /reserved/.test(String(err.stderr)),
      );
    } finally {
      rmSync(repo, { recursive: true, force: true });
    }
  });
});

describe("task rm", () => {
  it("soft-deletes by setting status=done and adding deleted:true tag", () => {
    const repo = fixtureRepo();
    try {
      run(repo, ["add", "X"]);
      run(repo, ["rm", "task-001"]);
      const file = readFileSync(join(repo, ".tasks", "tasks", "task-001-x.md"), "utf8");
      assert.match(file, /status: done/);
      assert.match(file, /tags: \[deleted:true\]/);
      assert.match(file, /— removed \(soft delete\)/);
    } finally {
      rmSync(repo, { recursive: true, force: true });
    }
  });

  it("keeps dependents blocked when their blocker is soft-deleted", () => {
    const repo = fixtureRepo();
    try {
      run(repo, ["add", "Blocker"]);
      run(repo, ["add", "Dependent", "--blocked-by", "task-001"]);
      run(repo, ["rm", "task-001"]);
      assert.match(run(repo, ["show", "task-002"]), /unmet blockers: task-001/);
      assert.throws(
        () => run(repo, ["move", "task-002", "in_progress"]),
        (err) => err.status === 2 && /blocked by task-001/.test(String(err.stderr)),
      );
    } finally {
      rmSync(repo, { recursive: true, force: true });
    }
  });
});
