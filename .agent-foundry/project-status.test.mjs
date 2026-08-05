import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import {
  collectProjectStatus,
  formatProjectStatus,
  loadTrackerApi,
  markProjectStatusSeen,
  parseGitChanges,
  parsePlanningJournal,
  trackerApi,
} from "./project-status.mjs";

const { claimableTasks, loadTaskContext, serializeTaskFile } = trackerApi;
const SCRIPT = fileURLToPath(new URL("./project-status.mjs", import.meta.url));

function git(root, args) {
  return execFileSync("git", args, { cwd: root, encoding: "utf8" });
}

function task(id, title, status, options = {}) {
  const createdAt = options.createdAt ?? "2026-08-01T12:00:00Z";
  return serializeTaskFile({
    frontmatter: {
      id,
      title,
      status,
      priority: options.priority ?? "p2",
      tags: options.tags ?? [],
      blockedBy: options.blockedBy ?? [],
      createdAt,
      updatedAt: options.updatedAt ?? createdAt,
    },
    description: options.description ?? "Observable outcome.",
    log: options.log ?? `- ${createdAt} — created (status: ${status})\n`,
  });
}

function fixture() {
  const root = mkdtempSync(join(tmpdir(), "foundry-project-status-"));
  git(root, ["init", "-b", "main"]);
  git(root, ["config", "user.email", "status@example.invalid"]);
  git(root, ["config", "user.name", "Status Test"]);
  git(root, ["config", "commit.gpgsign", "false"]);
  git(root, ["config", "core.autocrlf", "false"]);
  mkdirSync(join(root, ".tasks", "tasks"), { recursive: true });
  mkdirSync(join(root, ".tasks", "archive"), { recursive: true });
  mkdirSync(join(root, ".agent-foundry"), { recursive: true });
  writeFileSync(
    join(root, ".agent-foundry.json"),
    `${JSON.stringify({ projectName: "Fixture Project", projectDescription: "Test status." })}\n`,
  );
  writeFileSync(
    join(root, "PLANNING-JOURNAL.md"),
    `# Planning journal\n\n## 2026-08-01 — useful-release\n\n**Goal:** Give people a reliable status view.\n\n**Done when:** The real next task and latest check are visible.\n\nApproved front:\n\n1. \`task-001\` — finished.\n2. \`task-002\` — active.\n3. \`task-003\` — overview.\n`,
  );
  writeFileSync(
    join(root, ".tasks", "archive", "task-001-finished.md"),
    task("task-001", "Finished useful work", "done", {
      priority: "p1",
      tags: ["milestone:useful-release"],
      updatedAt: "2026-08-03T12:00:00Z",
      log: `- 2026-08-03T12:00:00Z — run: node test.mjs\n  started 2026-08-03T11:59:00Z, exit 0 in 2.5s\n`,
    }),
  );
  writeFileSync(
    join(root, ".tasks", "archive", "task-009-deleted.md"),
    task("task-009", "Deleted result", "done", {
      tags: ["deleted:true"],
      updatedAt: "2026-08-04T11:00:00Z",
    }),
  );
  for (let index = 10; index < 16; index++) {
    const day = String(index - 5).padStart(2, "0");
    const id = `task-${String(index).padStart(3, "0")}`;
    writeFileSync(
      join(root, ".tasks", "archive", `${id}-older-${index}.md`),
      task(id, `Older result ${index}`, "done", {
        createdAt: `2026-07-${day}T10:00:00Z`,
        updatedAt: `2026-07-${day}T12:00:00Z`,
      }),
    );
  }
  writeFileSync(
    join(root, ".tasks", "tasks", "task-002-active.md"),
    task("task-002", "Build status facts", "in_progress", {
      priority: "p1",
      tags: ["milestone:useful-release"],
    }),
  );
  writeFileSync(
    join(root, ".tasks", "tasks", "task-003-dependent.md"),
    task("task-003", "Render overview", "backlog", {
      priority: "p1",
      tags: ["milestone:useful-release"],
      blockedBy: ["task-002"],
    }),
  );
  writeFileSync(
    join(root, ".tasks", "tasks", "task-004-next.md"),
    task("task-004", "Independent next step", "ready", { priority: "p1" }),
  );
  writeFileSync(
    join(root, ".tasks", "tasks", "task-005-operator.md"),
    task("task-005", "Choose the release name", "blocked", {
      priority: "p1",
      tags: ["needs:operator"],
      updatedAt: "2026-08-04T10:00:00Z",
    }),
  );
  writeFileSync(
    join(root, ".tasks", "tasks", "task-007-later.md"),
    task("task-007", "Later eligible work", "backlog", { priority: "p2" }),
  );
  writeFileSync(join(root, ".gitignore"), ".agent-foundry/project-status-seen.json\n");
  git(root, ["add", "."]);
  git(root, ["commit", "-m", "fixture"]);
  return root;
}

describe("project status", () => {
  it("parses the latest milestone goal verbatim and reports its age", () => {
    const journal = `## 2026-08-01 — current\n\n- **Goal:** Keep this exact wording.\n\n**Done when:** It works.\n\nA stray task-999 is not part of the milestone.\n\nApproved front:\n\n1. \`task-123\` — included.\n\n## 2026-01-01 — old\n\n**Goal:** Old goal.\n`;
    assert.deepEqual(parsePlanningJournal(journal, new Date("2026-08-04T00:00:00Z")), {
      name: "current",
      plannedAt: "2026-08-01",
      ageDays: 3,
      freshness: "current",
      goal: "Keep this exact wording.",
      doneWhen: "It works.",
      taskIds: ["task-123"],
    });
    assert.equal(
      parsePlanningJournal(journal, new Date("2026-10-04T00:00:00Z")).freshness,
      "stale",
    );
    const sameDay = `## 2026-08-01 — first\n\n**Goal:** First.\n\n## 2026-08-01 — second\n\n**Goal:** Keep a wrapped goal\nwith a useful detail: exactly as approved.\n`;
    assert.equal(parsePlanningJournal(sameDay).name, "second");
    assert.equal(
      parsePlanningJournal(sameDay).goal,
      "Keep a wrapped goal with a useful detail: exactly as approved.",
    );
    const invalidDate = parsePlanningJournal("## 2026-13-45 — impossible\n\n**Goal:** Do not call this current.\n");
    assert.equal(invalidDate.freshness, "unknown");
    assert.equal(invalidDate.ageDays, null);
  });

  it("parses NUL-delimited Git paths without treating path text as a rename", () => {
    assert.deepEqual(
      parseGitChanges("R  new name\0old name\0?? literal -> arrow.txt\0?? unicodé.txt\0"),
      [
        { status: "R ", path: "new name", originalPath: "old name" },
        { status: "??", path: "literal -> arrow.txt" },
        { status: "??", path: "unicodé.txt" },
      ],
    );
  });

  it("derives work, Git, milestone, operator, and validation facts", () => {
    const root = fixture();
    try {
      const now = new Date("2026-08-04T12:00:00Z");
      const status = collectProjectStatus(root, { now });
      const trackerNext = claimableTasks(loadTaskContext(root)).find((row) => !row.archived);
      assert.equal(status.project.name, "Fixture Project");
      assert.equal(status.git.branch, "main");
      assert.equal(status.git.dirty, false);
      assert.equal(status.milestone.goal, "Give people a reliable status view.");
      assert.deepEqual(status.milestone.progress, {
        total: 3,
        done: 1,
        source: "milestone-tag",
        journalCovered: true,
      });
      assert.equal(status.work.inProgress[0].id, "task-002");
      assert.equal(status.work.next.id, trackerNext.task.frontmatter.id);
      assert.equal(status.work.next.id, "task-004");
      assert.equal(status.work.later[0].id, "task-007");
      assert.equal(status.work.laterCount, 1);
      assert.equal(status.work.laterTruncated, false);
      assert.equal(status.work.needsOperator[0].id, "task-005");
      assert.equal(status.work.blocked.some((row) => row.id === "task-003"), true);
      assert.equal(status.validation.latest.command, "node test.mjs");
      assert.equal(status.validation.latest.exitCode, 0);
      assert.equal(status.since.firstLook, true);
      assert.equal(status.work.recentCompleted.length, 5);
      assert.equal(status.work.recentCompleted[0].id, "task-001");
      assert.equal(status.work.recentCompleted.some((row) => row.id === "task-009"), false);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("uses an explicit local marker for since-last-look changes", () => {
    const root = fixture();
    try {
      const before = collectProjectStatus(root, { now: new Date("2026-08-04T09:00:00Z") });
      markProjectStatusSeen(root, before, new Date("2026-08-04T09:00:00Z"));
      writeFileSync(join(root, "after-marker.txt"), "changed\n");
      git(root, ["add", "after-marker.txt"]);
      git(root, ["commit", "-m", "after marker"]);
      writeFileSync(
        join(root, ".tasks", "tasks", "task-006-boundary.md"),
        task("task-006", "Same-second boundary", "backlog", {
          createdAt: "2026-08-04T09:00:00Z",
          updatedAt: "2026-08-04T09:00:00Z",
        }),
      );
      const operatorPath = join(root, ".tasks", "tasks", "task-005-operator.md");
      writeFileSync(
        operatorPath,
        readFileSync(operatorPath, "utf8").replaceAll(
          "2026-08-04T10:00:00Z",
          "2026-08-04T11:00:00Z",
        ),
      );
      const after = collectProjectStatus(root, { now: new Date("2026-08-04T12:00:00Z") });
      assert.equal(after.since.firstLook, false);
      assert.equal(after.since.needsOperator[0].id, "task-005");
      assert.equal(after.since.commits.count, 1);
      assert.equal(after.since.commits.items[0].subject, "after marker");
      assert.equal(after.since.commits.truncated, false);
      assert.equal(after.since.changedTasks.some((row) => row.id === "task-006"), true);
      assert.equal(
        JSON.parse(readFileSync(join(root, ".agent-foundry", "project-status-seen.json"), "utf8")).head,
        before.git.head,
      );
      assert.equal(
        after.git.changes.some((change) => change.path.includes("project-status-seen")),
        false,
        "ignored seen marker must not appear in Git changes",
      );
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("keeps text output short and labels unknown planning state", () => {
    const root = fixture();
    try {
      rmSync(join(root, "PLANNING-JOURNAL.md"));
      const status = collectProjectStatus(root, { now: new Date("2026-08-04T12:00:00Z") });
      const text = formatProjectStatus(status);
      assert.match(text, /Goal \[unknown; progress unknown\]: unknown/u);
      assert.match(text, /Needs you: task-005 Choose the release name/u);
      assert.match(text, /Recently done: task-001 Finished useful work/u);
      assert.equal(text.split(/\r?\n/u).filter(Boolean).length <= 12, true);
      assert.doesNotMatch(text, /started 2026/u, "raw task evidence leaked into summary");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("labels Git and marker failures instead of claiming clean or first look", () => {
    const root = fixture();
    try {
      writeFileSync(join(root, ".agent-foundry", "project-status-seen.json"), "{broken");
      writeFileSync(join(root, ".agent-foundry.json"), "{broken");
      const status = collectProjectStatus(root, {
        now: new Date("2026-08-04T12:00:00Z"),
        git: () => ({ ok: false, stdout: "", error: "git unavailable" }),
      });
      assert.equal(status.git.dirty, null);
      assert.equal(status.since.markerStatus, "invalid");
      assert.match(status.warnings.join("\n"), /marker/u);
      assert.match(formatProjectStatus(status), /Git state unknown/u);
      assert.match(formatProjectStatus(status), /marker unreadable/u);
      assert.match(formatProjectStatus(status), /Warnings:.*agent-foundry\.json/u);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("labels a partial Git failure and confines an untrusted project name to one line", () => {
    const root = fixture();
    try {
      writeFileSync(
        join(root, ".agent-foundry.json"),
        `${JSON.stringify({ projectName: "A project\nwith a second line" })}\n`,
      );
      const status = collectProjectStatus(root, {
        now: new Date("2026-08-04T12:00:00Z"),
        git: (_root, args) => {
          if (args[0] === "status") return { ok: true, stdout: "", error: null };
          if (args[0] === "symbolic-ref") return { ok: true, stdout: "main", error: null };
          return { ok: false, stdout: "", error: "head unavailable" };
        },
      });
      const text = formatProjectStatus(status);
      assert.equal(status.git.available, false);
      assert.match(status.git.error, /head unavailable/u);
      assert.match(text, /A project with a second line — Git state unknown/u);
      assert.equal(text.split(/\r?\n/u).filter(Boolean).length <= 12, true);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("rejects unsupported marker schemas and reports failed validation", () => {
    const root = fixture();
    try {
      writeFileSync(
        join(root, ".agent-foundry", "project-status-seen.json"),
        `${JSON.stringify({ schemaVersion: 2, seenAt: "2026-08-04T10:00:00Z", head: null, taskVersions: {} })}\n`,
      );
      const taskPath = join(root, ".tasks", "archive", "task-001-finished.md");
      writeFileSync(
        taskPath,
        readFileSync(taskPath, "utf8").replace(
          "started 2026-08-03T11:59:00Z, exit 0 in 2.5s",
          "started 2026-08-03T11:59:00Z, exit 0 in 2.5s\n- 2026-08-04T11:00:00Z — run: node failing-test.mjs\n  started 2026-08-04T10:59:00Z, exit 1 in 1.2s",
        ),
      );
      const status = collectProjectStatus(root, { now: new Date("2026-08-04T12:00:00Z") });
      assert.equal(status.since.markerStatus, "invalid");
      assert.equal(status.validation.latest.exitCode, 1);
      assert.match(formatProjectStatus(status), /Last check: FAIL node failing-test\.mjs/u);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("falls back to the Claude tracker library and fails when neither tree exists", async () => {
    const loaded = await loadTrackerApi({
      candidates: ["./agents-missing.mjs", "./claude-present.mjs"],
      fileExists: (path) => path.endsWith("claude-present.mjs"),
      importer: async (url) => ({ selected: fileURLToPath(url) }),
    });
    assert.match(loaded.selected, /claude-present\.mjs$/u);
    await assert.rejects(
      loadTrackerApi({
        candidates: ["./agents-missing.mjs", "./claude-missing.mjs"],
        fileExists: () => false,
      }),
      /missing from both harness trees/u,
    );
  });

  it("exercises the public CLI flags and failure exits", () => {
    const root = fixture();
    const outside = mkdtempSync(join(tmpdir(), "foundry-project-status-outside-"));
    try {
      const parsed = JSON.parse(execFileSync(process.execPath, [SCRIPT, "--json"], {
        cwd: root,
        encoding: "utf8",
      }));
      assert.equal(parsed.schemaVersion, 1);
      assert.match(execFileSync(process.execPath, [SCRIPT, "--help"], {
        cwd: root,
        encoding: "utf8",
      }), /--mark-seen/u);
      execFileSync(process.execPath, [SCRIPT, "--mark-seen"], { cwd: root });
      assert.equal(existsSync(join(root, ".agent-foundry", "project-status-seen.json")), true);
      assert.equal(spawnSync(process.execPath, [SCRIPT, "--bad"], { cwd: root }).status, 2);
      assert.equal(spawnSync(process.execPath, [SCRIPT], { cwd: outside }).status, 1);
    } finally {
      rmSync(root, { recursive: true, force: true });
      rmSync(outside, { recursive: true, force: true });
    }
  });
});
