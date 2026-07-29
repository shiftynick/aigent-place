import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { join } from "node:path";
import { existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import { hostname, tmpdir } from "node:os";
import {
  parseTaskFile,
  serializeTaskFile,
  findRepoRoot,
  archiveDir,
  tasksDir,
  taskFilePath,
  readTaskFile,
  writeTaskAtomic,
  withRepoWriteLock,
  listTaskFiles,
  loadAllTasks,
  loadTaskContext,
  ConflictError,
  LockHeldError,
  nextTaskId,
  slugify,
  assertNoCycle,
  unmetBlockers,
  claimableTasks,
  appendLog,
  nowIso,
  NotFoundError,
} from "./_lib.mjs";

describe("parseTaskFile", () => {
  it("parses a clean frontmatter block", () => {
    const src = [
      "---",
      "id: task-007",
      "title: Make subscribe form work",
      "status: ready",
      "priority: p2",
      "tags: [area:web, area:email]",
      "blockedBy: []",
      "createdAt: 2026-04-30T14:22:01Z",
      "updatedAt: 2026-05-02T09:14:55Z",
      "---",
      "",
      "## Description",
      "",
      "Body text.",
      "",
      "## Log",
      "",
      "- 2026-04-30T14:22:01Z — created (status: backlog)",
      "",
    ].join("\n");
    const t = parseTaskFile(src);
    assert.equal(t.frontmatter.id, "task-007");
    assert.equal(t.frontmatter.title, "Make subscribe form work");
    assert.equal(t.frontmatter.status, "ready");
    assert.equal(t.frontmatter.priority, "p2");
    assert.deepEqual(t.frontmatter.tags, ["area:web", "area:email"]);
    assert.deepEqual(t.frontmatter.blockedBy, []);
    assert.equal(t.frontmatter.createdAt, "2026-04-30T14:22:01Z");
    assert.equal(t.frontmatter.updatedAt, "2026-05-02T09:14:55Z");
    assert.match(t.description, /Body text\./);
    assert.match(t.log, /created \(status: backlog\)/);
  });

  it("preserves values intentionally wrapped in single quotes", () => {
    const src = [
      "---",
      "id: task-001",
      "title: \"'quoted title'\"",
      "status: done",
      "priority: p1",
      "tags: [\"'quoted:tag'\"]",
      "blockedBy: []",
      "createdAt: 2026-05-02T02:09:43Z",
      "updatedAt: 2026-05-02T02:09:48Z",
      "---",
      "",
      "## Description",
      "",
      "x",
      "",
      "## Log",
      "",
      "- 2026-05-02T02:09:43Z — created",
      "",
    ].join("\n");
    const t = parseTaskFile(src);
    assert.equal(t.frontmatter.title, "'quoted title'");
    assert.deepEqual(t.frontmatter.tags, ["'quoted:tag'"]);
  });

  it("throws on missing required frontmatter", () => {
    assert.throws(() => parseTaskFile("no frontmatter here"));
    assert.throws(() => parseTaskFile("---\nid: x\n---\n"));
    assert.throws(
      () => parseTaskFile("---\nid: task-001\ntitle: X\nstatus: backlog\npriority: p2\ncreatedAt: 2026-05-02T00:00:00Z\nupdatedAt: 2026-05-02T00:00:00Z\n"),
      /missing frontmatter closing|invalid frontmatter line/,
    );
  });

  it("rejects invalid enums, timestamps, ids, and duplicate dependencies", () => {
    const valid = serializeTaskFile(sampleTask("task-001"));
    assert.throws(() => parseTaskFile(valid.replace("status: backlog", "status: mystery")), /invalid status/);
    assert.throws(() => parseTaskFile(valid.replace("priority: p2", "priority: urgent")), /invalid priority/);
    assert.throws(() => parseTaskFile(valid.replace("id: task-001", "id: x")), /invalid task id/);
    assert.throws(
      () => parseTaskFile(valid.replace("blockedBy: []", "blockedBy: [task-002, task-002]")),
      /duplicate values/,
    );
    assert.throws(
      () => parseTaskFile(valid.replace(/createdAt: .*/, "createdAt: someday")),
      /invalid createdAt/,
    );
    assert.throws(
      () => parseTaskFile(valid.replace("tags: []", "tags: area:core")),
      /tags must be a list/,
    );
    assert.throws(
      () => parseTaskFile(valid.replace("title: x", "title: x\ntitle: y")),
      /duplicate frontmatter key/,
    );
    assert.throws(
      () => parseTaskFile(valid.replace(/createdAt: .*/, 'createdAt: "2026-02-31T00:00:00Z"')),
      /invalid createdAt/,
    );
    assert.throws(
      () => parseTaskFile(valid.replace(/updatedAt: .*/, 'updatedAt: "2026-05-01T00:00:00Z"')),
      /updatedAt cannot precede/,
    );
    assert.throws(
      () => parseTaskFile(valid.replace("tags: []", "tags: [deleted:true]")),
      /deleted:true requires status done/,
    );
  });

  it("fails closed when body sections or reserved markers are malformed", () => {
    const valid = serializeTaskFile(sampleTask("task-001"));
    assert.throws(() => parseTaskFile(valid.replace("## Description", "## Details")), /missing ## Description/);
    assert.throws(() => parseTaskFile(valid.replace("## Log", "## History")), /missing ## Log|malformed task body/);
    assert.throws(
      () => parseTaskFile(valid.replace("## Log", "## Log\n\n<!-- task-tracker:log -->")),
      /markers must appear exactly once/,
    );
  });
});

describe("serializeTaskFile", () => {
  it("round-trips a clean task without changing it", () => {
    const t = {
      frontmatter: {
        id: "task-007",
        title: "Make subscribe form work",
        status: "ready",
        priority: "p2",
        tags: ["area:web", "area:email"],
        blockedBy: [],
        createdAt: "2026-04-30T14:22:01Z",
        updatedAt: "2026-05-02T09:14:55Z",
      },
      description: "Body text.\n",
      log: "- 2026-04-30T14:22:01Z — created (status: backlog)\n",
    };
    const round = parseTaskFile(serializeTaskFile(t));
    assert.deepEqual(round.frontmatter, t.frontmatter);
    assert.equal(round.description.trim(), t.description.trim());
    assert.equal(round.log.trim(), t.log.trim());
  });

  it("round-trips escaped quotes and commas in list values", () => {
    const t = sampleTask("task-008");
    t.frontmatter.tags = ['a"b,c', "area:core"];
    assert.deepEqual(parseTaskFile(serializeTaskFile(t)).frontmatter.tags, t.frontmatter.tags);
  });

  it("preserves nested Markdown headings inside the description", () => {
    const t = sampleTask("task-009");
    t.description = "Acceptance\n\n## Edge cases\n\nKeep this text.\n";
    assert.equal(parseTaskFile(serializeTaskFile(t)).description.trim(), t.description.trim());
  });

  it("quotes strings with reserved characters", () => {
    const t = {
      frontmatter: {
        id: "task-099",
        title: "Add: a colon",
        status: "backlog",
        priority: "p2",
        tags: ["area:web"],
        blockedBy: [],
        createdAt: "2026-05-02T00:00:00Z",
        updatedAt: "2026-05-02T00:00:00Z",
      },
      description: "",
      log: "",
    };
    const out = serializeTaskFile(t);
    assert.match(out, /title: "Add: a colon"/);
  });

  it("escapes inner double quotes when quoting", () => {
    const t = {
      frontmatter: {
        id: "task-100",
        title: 'has "inner" quotes: yes',
        status: "backlog",
        priority: "p2",
        tags: [],
        blockedBy: [],
        createdAt: "2026-05-02T00:00:00Z",
        updatedAt: "2026-05-02T00:00:00Z",
      },
      description: "",
      log: "",
    };
    const out = serializeTaskFile(t);
    assert.match(out, /title: "has \\"inner\\" quotes: yes"/);
    const back = parseTaskFile(out);
    assert.equal(back.frontmatter.title, 'has "inner" quotes: yes');
  });

  it("emits empty arrays as []", () => {
    const t = {
      frontmatter: {
        id: "task-001",
        title: "x",
        status: "backlog",
        priority: "p2",
        tags: [],
        blockedBy: [],
        createdAt: "2026-05-02T00:00:00Z",
        updatedAt: "2026-05-02T00:00:00Z",
      },
      description: "",
      log: "",
    };
    const out = serializeTaskFile(t);
    assert.match(out, /tags: \[\]/);
    assert.match(out, /blockedBy: \[\]/);
  });
});

describe("findRepoRoot", () => {
  it("returns the directory containing .git", () => {
    const root = mkdtempSync(join(tmpdir(), "tt-root-"));
    try {
      mkdirSync(join(root, ".git"));
      const sub = join(root, "deep", "nested");
      mkdirSync(sub, { recursive: true });
      assert.equal(findRepoRoot(sub), root);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("returns null if no .git is found", () => {
    const root = mkdtempSync(join(tmpdir(), "tt-noroot-"));
    try {
      assert.equal(findRepoRoot(root), null);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});

describe("tasksDir / archiveDir / taskFilePath", () => {
  it("derives paths from a repo root", () => {
    const root = "/some/repo";
    assert.equal(tasksDir(root), join(root, ".tasks", "tasks"));
    assert.equal(archiveDir(root), join(root, ".tasks", "archive"));
    assert.equal(taskFilePath(root, "task-007", "do-the-thing"), join(root, ".tasks", "tasks", "task-007-do-the-thing.md"));
  });
});

describe("writeTaskAtomic + readTaskFile", () => {
  function fixture() {
    const root = mkdtempSync(join(tmpdir(), "tt-io-"));
    const dir = join(root, ".tasks", "tasks");
    mkdirSync(dir, { recursive: true });
    return { root, dir };
  }

  it("writes a new task atomically", () => {
    const { root, dir } = fixture();
    try {
      const path = join(dir, "task-001-x.md");
      const t = sampleTask("task-001");
      writeTaskAtomic(path, serializeTaskFile(t), null);
      const { task, mtime } = readTaskFile(path);
      assert.equal(task.frontmatter.id, "task-001");
      assert.ok(mtime instanceof Date);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("throws ConflictError when expected mtime does not match", () => {
    const { root, dir } = fixture();
    try {
      const path = join(dir, "task-002-y.md");
      writeTaskAtomic(path, serializeTaskFile(sampleTask("task-002")), null);
      const { mtime } = readTaskFile(path);
      // Force a future mtime to deterministically simulate a competing write
      // (avoids flakes on filesystems with coarse mtime resolution).
      const future = new Date(mtime.getTime() + 5000);
      utimesSync(path, future, future);
      assert.throws(
        () => writeTaskAtomic(path, serializeTaskFile(sampleTask("task-002")), mtime),
        (err) => err instanceof ConflictError,
      );
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("expectedMtime=null throws ConflictError when target exists (atomic create)", () => {
    const { root, dir } = fixture();
    try {
      const path = join(dir, "task-007-collision.md");
      // First create succeeds.
      writeTaskAtomic(path, serializeTaskFile(sampleTask("task-007")), null);
      // Second create with the same path simulates two parallel `add` calls
      // that both computed the same id. Must not silently overwrite.
      assert.throws(
        () => writeTaskAtomic(path, serializeTaskFile(sampleTask("task-007")), null),
        (err) => err instanceof ConflictError,
      );
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("listTaskFiles returns sorted task-*.md paths only", () => {
    const { root, dir } = fixture();
    try {
      writeTaskAtomic(join(dir, "task-002-b.md"), serializeTaskFile(sampleTask("task-002")), null);
      writeTaskAtomic(join(dir, "task-001-a.md"), serializeTaskFile(sampleTask("task-001")), null);
      writeFileSync(join(dir, "README.md"), "ignore me");
      const files = listTaskFiles(dir);
      assert.equal(files.length, 2);
      assert.match(files[0], /task-001-a\.md$/);
      assert.match(files[1], /task-002-b\.md$/);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});

describe("claim frontmatter", () => {
  it("round-trips claim fields on an in_progress task", () => {
    const task = sampleTask("task-001");
    task.frontmatter.status = "in_progress";
    task.frontmatter.claimedBy = "session-42";
    task.frontmatter.claimedAt = "2026-05-02T00:00:00Z";
    const round = parseTaskFile(serializeTaskFile(task));
    assert.equal(round.frontmatter.claimedBy, "session-42");
    assert.equal(round.frontmatter.claimedAt, "2026-05-02T00:00:00Z");
  });

  it("omits claim keys entirely when no claim exists", () => {
    const text = serializeTaskFile(sampleTask("task-001"));
    assert.doesNotMatch(text, /claimedBy|claimedAt/);
    // And a file without them parses — the pre-claims format stays valid.
    assert.equal(parseTaskFile(text).frontmatter.claimedBy, undefined);
  });

  it("rejects claim fields on any status other than in_progress", () => {
    const task = sampleTask("task-001");
    task.frontmatter.claimedBy = "session-42";
    task.frontmatter.claimedAt = "2026-05-02T00:00:00Z";
    assert.throws(
      () => serializeTaskFile(task),
      /only valid while status is in_progress/,
    );
  });

  it("rejects a claim owner without a timestamp", () => {
    const task = sampleTask("task-001");
    task.frontmatter.status = "in_progress";
    task.frontmatter.claimedBy = "session-42";
    assert.throws(() => serializeTaskFile(task), /claimedAt must be a timestamp/);
  });
});

describe("scalar round-trips", () => {
  it("preserves a title with trailing whitespace", () => {
    const task = sampleTask("task-001");
    task.frontmatter.title = "trailing space ";
    const round = parseTaskFile(serializeTaskFile(task));
    assert.equal(round.frontmatter.title, "trailing space ");
  });

  it("preserves a tag with trailing whitespace", () => {
    const task = sampleTask("task-001");
    task.frontmatter.tags = ["area:web "];
    const round = parseTaskFile(serializeTaskFile(task));
    assert.deepEqual(round.frontmatter.tags, ["area:web "]);
  });

  it("treats a partially-quoted hand-edited scalar as a bare string", () => {
    // Hand-edited into an otherwise well-formed file: the outer quotes do not
    // enclose the value, so this is a bare string, not `a" or "b`.
    const src = serializeTaskFile(sampleTask("task-001"))
      .replace("title: x", 'title: "a" or "b"');
    assert.equal(parseTaskFile(src).frontmatter.title, '"a" or "b"');
  });

  it("still unquotes a fully quoted scalar containing escaped quotes", () => {
    const task = sampleTask("task-001");
    task.frontmatter.title = 'say "hi" now';
    const round = parseTaskFile(serializeTaskFile(task));
    assert.equal(round.frontmatter.title, 'say "hi" now');
  });
});

describe("assertNoCycle", () => {
  it("clears a wide diamond graph without exponential re-exploration", () => {
    // Each layer depends on both nodes of the layer below. Without memoizing
    // fully-explored nodes this is 2^depth work and would not return.
    const rows = [];
    const depth = 60;
    for (let layer = 0; layer < depth; layer++) {
      for (const side of ["a", "b"]) {
        const deps = layer === 0
          ? []
          : [`task-${layer - 1}a`, `task-${layer - 1}b`];
        rows.push({
          task: { frontmatter: { id: `task-${layer}${side}`, blockedBy: deps } },
        });
      }
    }
    const start = Date.now();
    assertNoCycle(rows, "task-top", [`task-${depth - 1}a`, `task-${depth - 1}b`]);
    assert.ok(Date.now() - start < 2000);
  });

  it("still detects a cycle reachable through shared nodes", () => {
    const rows = [
      { task: { frontmatter: { id: "task-001", blockedBy: ["task-002"] } } },
      { task: { frontmatter: { id: "task-002", blockedBy: ["task-003"] } } },
      { task: { frontmatter: { id: "task-003", blockedBy: ["task-001"] } } },
    ];
    assert.throws(() => assertNoCycle(rows, "task-004", ["task-001"]), /cycle/);
  });
});

describe("repo lock recovery", () => {
  it("rejects a lock owned by a live process", () => {
    const root = mkdtempSync(join(tmpdir(), "tt-lock-"));
    try {
      const lock = join(root, ".tasks", ".write-lock");
      mkdirSync(lock, { recursive: true });
      writeFileSync(
        join(lock, "owner.json"),
        JSON.stringify({ pid: process.pid, hostname: hostname(), createdAt: nowIso() }),
      );
      assert.throws(() => withRepoWriteLock(root, () => {}), LockHeldError);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("reports a held lock truthfully and still exits as a conflict", () => {
    const root = mkdtempSync(join(tmpdir(), "tt-lock-"));
    try {
      const lock = join(root, ".tasks", ".write-lock");
      mkdirSync(lock, { recursive: true });
      writeFileSync(
        join(lock, "owner.json"),
        JSON.stringify({ pid: process.pid, hostname: hostname(), createdAt: nowIso() }),
      );
      assert.throws(
        () => withRepoWriteLock(root, () => {}),
        (err) => {
          // Callers map ConflictError to exit 5; the message must not claim a
          // task file changed when nothing was ever read.
          assert.ok(err instanceof ConflictError);
          assert.match(err.message, /lock held by another process/);
          assert.doesNotMatch(err.message, /changed since read/);
          return true;
        },
      );
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("backs off before surfacing a held lock rather than failing instantly", () => {
    const root = mkdtempSync(join(tmpdir(), "tt-lock-"));
    try {
      const lock = join(root, ".tasks", ".write-lock");
      mkdirSync(lock, { recursive: true });
      writeFileSync(
        join(lock, "owner.json"),
        JSON.stringify({ pid: process.pid, hostname: hostname(), createdAt: nowIso() }),
      );
      // The retry loop sleeps synchronously (Atomics.wait), so contention that
      // resolves mid-backoff cannot be simulated with a timer here — that path
      // is covered by the real two-process test in task.test.mjs. What this
      // asserts is that the loop waits at all instead of failing on contact.
      const start = Date.now();
      assert.throws(() => withRepoWriteLock(root, () => {}), LockHeldError);
      assert.ok(
        Date.now() - start >= 1000,
        "expected the lock retry loop to back off before giving up",
      );
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("recovers a dead-owner lock and rolls back an interrupted backup", () => {
    const root = mkdtempSync(join(tmpdir(), "tt-lock-"));
    try {
      const dir = join(root, ".tasks", "tasks");
      const lock = join(root, ".tasks", ".write-lock");
      mkdirSync(dir, { recursive: true });
      mkdirSync(lock);
      writeFileSync(
        join(lock, "owner.json"),
        JSON.stringify({ pid: 2147483647, hostname: hostname(), createdAt: nowIso() }),
      );
      const target = join(dir, "task-001-x.md");
      const original = serializeTaskFile(sampleTask("task-001"));
      writeFileSync(target, "partial");
      writeFileSync(join(dir, ".task-001-x.md.abcdef.bak"), original);
      writeFileSync(join(dir, ".abcdef.tmp"), "replacement");
      withRepoWriteLock(root, () => {});
      assert.equal(readFileSync(target, "utf8"), original);
      assert.equal(existsSync(lock), false);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("keeps a completed write when only backup cleanup was interrupted", () => {
    const root = mkdtempSync(join(tmpdir(), "tt-lock-"));
    try {
      const dir = join(root, ".tasks", "tasks");
      const lock = join(root, ".tasks", ".write-lock");
      mkdirSync(dir, { recursive: true });
      mkdirSync(lock);
      writeFileSync(
        join(lock, "owner.json"),
        JSON.stringify({ pid: 2147483647, hostname: hostname(), createdAt: nowIso() }),
      );
      const target = join(dir, "task-001-x.md");
      writeFileSync(target, "committed");
      writeFileSync(join(dir, ".task-001-x.md.abcdef.bak"), "previous");
      withRepoWriteLock(root, () => {});
      assert.equal(readFileSync(target, "utf8"), "committed");
      assert.equal(existsSync(join(dir, ".task-001-x.md.abcdef.bak")), false);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});

describe("loadTaskContext", () => {
  it("rejects duplicate ids across active and archived tasks", () => {
    const root = mkdtempSync(join(tmpdir(), "tt-context-"));
    try {
      const activeDir = join(root, ".tasks", "tasks");
      const archivedDir = join(root, ".tasks", "archive");
      mkdirSync(activeDir, { recursive: true });
      mkdirSync(archivedDir, { recursive: true });
      writeTaskAtomic(join(archivedDir, "task-001-old.md"), serializeTaskFile({
        ...sampleTask("task-001"),
        frontmatter: { ...sampleTask("task-001").frontmatter, status: "done" },
      }), null);
      writeTaskAtomic(join(activeDir, "task-001-new.md"), serializeTaskFile(sampleTask("task-001")), null);

      assert.throws(
        () => loadTaskContext(root),
        /duplicate task id task-001/,
      );
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("rejects a filename id that disagrees with frontmatter", () => {
    const root = mkdtempSync(join(tmpdir(), "tt-context-"));
    try {
      const activeDir = join(root, ".tasks", "tasks");
      mkdirSync(activeDir, { recursive: true });
      writeTaskAtomic(
        join(activeDir, "task-002-wrong.md"),
        serializeTaskFile(sampleTask("task-001")),
        null,
      );
      assert.throws(() => loadAllTasks(root), /filename id task-002 does not match task-001/);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});

function sampleTask(id) {
  return {
    frontmatter: {
      id,
      title: "x",
      status: "backlog",
      priority: "p2",
      tags: [],
      blockedBy: [],
      createdAt: "2026-05-02T00:00:00Z",
      updatedAt: "2026-05-02T00:00:00Z",
    },
    description: "",
    log: "",
  };
}

describe("nextTaskId", () => {
  it("returns task-001 when there are no tasks", () => {
    assert.equal(nextTaskId([]), "task-001");
  });
  it("returns the next id after the highest existing", () => {
    const tasks = [
      { task: { frontmatter: { id: "task-001" } } },
      { task: { frontmatter: { id: "task-007" } } },
      { task: { frontmatter: { id: "task-003" } } },
    ];
    assert.equal(nextTaskId(tasks), "task-008");
  });
  it("expands to 4 digits past 999", () => {
    const tasks = [{ task: { frontmatter: { id: "task-999" } } }];
    assert.equal(nextTaskId(tasks), "task-1000");
  });
});

describe("slugify", () => {
  it("normalizes a title", () => {
    assert.equal(slugify("Make Subscribe Form Trigger Real Email"), "make-subscribe-form-trigger-real-email");
  });
  it("strips punctuation", () => {
    assert.equal(slugify("Fix: don't break things!"), "fix-don-t-break-things");
  });
  it("truncates to 50 chars", () => {
    const long = "a".repeat(80);
    assert.equal(slugify(long).length, 50);
  });
  it("returns 'untitled' for empty input", () => {
    assert.equal(slugify(""), "untitled");
    assert.equal(slugify("!!!"), "untitled");
  });
});

describe("assertNoCycle", () => {
  it("rejects self-reference", () => {
    assert.throws(() => assertNoCycle([], "task-001", ["task-001"]));
  });
  it("rejects a cycle via existing tasks", () => {
    const tasks = [
      { task: { frontmatter: { id: "task-001", blockedBy: ["task-002"] } } },
      { task: { frontmatter: { id: "task-002", blockedBy: [] } } },
    ];
    // Adding task-001 as a blocker of task-002 would create 1→2→1.
    assert.throws(() => assertNoCycle(tasks, "task-002", ["task-001"]));
  });
  it("allows non-cyclic deps", () => {
    const tasks = [
      { task: { frontmatter: { id: "task-001", blockedBy: [] } } },
    ];
    assert.doesNotThrow(() => assertNoCycle(tasks, "task-002", ["task-001"]));
  });
});

describe("unmetBlockers", () => {
  it("returns ids of blockers not in done", () => {
    const tasks = [
      { task: { frontmatter: { id: "task-001", status: "ready" } } },
      { task: { frontmatter: { id: "task-002", status: "done" } } },
    ];
    const t = { frontmatter: { id: "task-003", blockedBy: ["task-001", "task-002"] } };
    assert.deepEqual(unmetBlockers(tasks, t), ["task-001"]);
  });

  it("does not treat a soft-deleted done task as a satisfied blocker", () => {
    const tasks = [
      { task: { frontmatter: { id: "task-001", status: "done", tags: ["deleted:true"] } } },
    ];
    const t = { frontmatter: { id: "task-002", blockedBy: ["task-001"] } };
    assert.deepEqual(unmetBlockers(tasks, t), ["task-001"]);
  });
});

describe("claimableTasks", () => {
  it("returns ready tasks with all blockers done, sorted p0 first then by id", () => {
    const tasks = [
      { task: { frontmatter: { id: "task-001", status: "done", priority: "p1", blockedBy: [] } } },
      { task: { frontmatter: { id: "task-002", status: "ready", priority: "p2", blockedBy: ["task-001"] } } },
      { task: { frontmatter: { id: "task-003", status: "ready", priority: "p0", blockedBy: [] } } },
      { task: { frontmatter: { id: "task-004", status: "ready", priority: "p1", blockedBy: ["task-002"] } } },
      { task: { frontmatter: { id: "task-005", status: "in_progress", priority: "p0", blockedBy: [] } } },
    ];
    const got = claimableTasks(tasks).map((t) => t.task.frontmatter.id);
    assert.deepEqual(got, ["task-003", "task-002"]);
  });

  it("includes backlog tasks alongside ready, prefers ready within a priority bucket", () => {
    const tasks = [
      // p0 backlog: highest priority overall.
      { task: { frontmatter: { id: "task-001", status: "backlog", priority: "p0", blockedBy: [] } } },
      // p1 ready vs p1 backlog: ready should sort first within the bucket.
      { task: { frontmatter: { id: "task-002", status: "backlog", priority: "p1", blockedBy: [] } } },
      { task: { frontmatter: { id: "task-003", status: "ready",   priority: "p1", blockedBy: [] } } },
      // Non-claimable statuses are excluded regardless of priority.
      { task: { frontmatter: { id: "task-004", status: "in_progress", priority: "p0", blockedBy: [] } } },
      { task: { frontmatter: { id: "task-005", status: "review",      priority: "p0", blockedBy: [] } } },
      { task: { frontmatter: { id: "task-006", status: "done",        priority: "p0", blockedBy: [] } } },
      { task: { frontmatter: { id: "task-007", status: "blocked",     priority: "p0", blockedBy: [] } } },
    ];
    const got = claimableTasks(tasks).map((t) => t.task.frontmatter.id);
    assert.deepEqual(got, ["task-001", "task-003", "task-002"]);
  });

  it("respects blockers for backlog tasks the same as ready tasks", () => {
    const tasks = [
      { task: { frontmatter: { id: "task-001", status: "backlog", priority: "p0", blockedBy: ["task-002"] } } },
      { task: { frontmatter: { id: "task-002", status: "ready",   priority: "p2", blockedBy: [] } } },
    ];
    const got = claimableTasks(tasks).map((t) => t.task.frontmatter.id);
    // task-001 is blocked by an undone task and must NOT surface even
    // though it's higher priority.
    assert.deepEqual(got, ["task-002"]);
  });

  it("sorts numeric task ids correctly past 999", () => {
    const tasks = [
      { task: { frontmatter: { id: "task-1000", status: "ready", priority: "p1", blockedBy: [] } } },
      { task: { frontmatter: { id: "task-999", status: "ready", priority: "p1", blockedBy: [] } } },
    ];
    assert.deepEqual(
      claimableTasks(tasks).map((row) => row.task.frontmatter.id),
      ["task-999", "task-1000"],
    );
  });
});

describe("appendLog", () => {
  it("appends a dated line", () => {
    const out = appendLog("- 2026-05-01T00:00:00Z — created\n", "moved to ready");
    assert.match(out, /^- 2026-05-01T00:00:00Z — created\n- \d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z — moved to ready\n$/);
  });
  it("starts a fresh log when current is empty", () => {
    const out = appendLog("", "created");
    assert.match(out, /^- \d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z — created\n$/);
  });
});

describe("nowIso", () => {
  it("returns YYYY-MM-DDTHH:MM:SSZ", () => {
    assert.match(nowIso(), /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/);
  });
});
