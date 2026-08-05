import assert from "node:assert/strict";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { execFileSync, spawnSync } from "node:child_process";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import {
  escapeHtml,
  renderProjectOverview,
  writeProjectOverview,
} from "./project-overview.mjs";
import { collectProjectStatus, trackerApi } from "./project-status.mjs";

const SCRIPT = fileURLToPath(new URL("./project-overview.mjs", import.meta.url));
const { serializeTaskFile } = trackerApi;

function git(root, args) {
  return execFileSync("git", args, { cwd: root, encoding: "utf8" });
}

function integrationFixture() {
  const root = mkdtempSync(join(tmpdir(), "foundry-project-overview-integration-"));
  git(root, ["init", "-b", "main"]);
  git(root, ["config", "user.email", "overview@example.invalid"]);
  git(root, ["config", "user.name", "Overview Test"]);
  git(root, ["config", "commit.gpgsign", "false"]);
  mkdirSync(join(root, ".tasks", "tasks"), { recursive: true });
  mkdirSync(join(root, ".tasks", "archive"), { recursive: true });
  writeFileSync(join(root, ".agent-foundry.json"), `${JSON.stringify({ projectName: "Integrated Fixture" })}\n`);
  writeFileSync(
    join(root, "PLANNING-JOURNAL.md"),
    "## 2026-08-04 — integrated\n\n**Goal:** Render producer facts.\n\n**Done when:** The real next task appears.\n\nApproved front:\n\n1. `task-001` — integrated task.\n",
  );
  writeFileSync(
    join(root, ".tasks", "tasks", "task-001-integrated-task.md"),
    serializeTaskFile({
      frontmatter: {
        id: "task-001",
        title: "Integrated next task",
        status: "ready",
        priority: "p1",
        tags: ["milestone:integrated"],
        blockedBy: [],
        createdAt: "2026-08-04T00:00:00Z",
        updatedAt: "2026-08-04T00:00:00Z",
      },
      description: "Integration fixture.",
      log: "- 2026-08-04T00:00:00Z — created (status: ready)\n",
    }),
  );
  writeFileSync(join(root, ".gitignore"), ".agent-foundry/project-overview.html\n");
  git(root, ["add", "."]);
  git(root, ["commit", "-m", "fixture"]);
  return root;
}

function task(id, title, status) {
  return {
    id,
    title,
    status,
    priority: "p1",
    tags: [],
    blockedBy: [],
    unmetBlockers: [],
    createdAt: "2026-08-01T00:00:00Z",
    updatedAt: "2026-08-04T00:00:00Z",
    archived: false,
  };
}

function sampleStatus() {
  return {
    schemaVersion: 1,
    generatedAt: "2026-08-04T12:00:00Z",
    project: {
      name: "Useful <script>alert('x')</script> Project",
      description: "A clear operator view.",
    },
    state: { taskVersions: { "task-001": "2026-08-04T00:00:00Z" } },
    git: {
      available: true,
      branch: "feature/operator-view",
      head: "a".repeat(40),
      shortHead: "aaaaaaaa",
      dirty: true,
      changeCount: 2,
      changes: [
        { status: " M", path: "safe.html" },
        { status: "??", path: "<unsafe>.txt" },
      ],
      changesTruncated: false,
      error: null,
    },
    milestone: {
      name: "operator-interface",
      plannedAt: "2026-08-04",
      ageDays: 0,
      freshness: "current",
      goal: "Know where the project is going at a glance.",
      doneWhen: "Direction, work, decisions, and evidence are visible.",
      taskIds: ["task-001", "task-002", "task-003"],
      progress: { total: 3, done: 1, source: "milestone-tag", journalCovered: true },
    },
    work: {
      inProgress: [task("task-002", "Generate real project facts", "in_progress")],
      review: [task("task-003", "Review the visual surface", "review")],
      next: task("task-004", "Ship the next outcome", "ready"),
      later: [task("task-005", "Follow-on work", "backlog")],
      laterCount: 1,
      laterTruncated: false,
      blocked: [task("task-006", "Waiting on a dependency", "blocked")],
      needsOperator: [task("task-007", "Choose the release direction", "blocked")],
      recentCompleted: [task("task-001", "Made communication understandable", "done")],
    },
    validation: {
      latest: {
        taskId: "task-002",
        recordedAt: "2026-08-04T11:59:00Z",
        command: "node test.mjs",
        startedAt: "2026-08-04T11:58:00Z",
        exitCode: 0,
        durationSeconds: 2,
      },
    },
    since: {
      marker: { seenAt: "2026-08-04T09:00:00Z", head: "b".repeat(40), taskVersions: {} },
      markerStatus: "set",
      firstLook: false,
      commits: { count: 2, items: [], truncated: false },
      changedTasks: [task("task-002", "Generate real project facts", "in_progress")],
      removedTaskIds: [],
      completed: [task("task-001", "Made communication understandable", "done")],
      needsOperator: [task("task-007", "Choose the release direction", "blocked")],
    },
    warnings: [],
  };
}

describe("project overview", () => {
  it("renders one self-contained visual hierarchy from schema v1 data", () => {
    const html = renderProjectOverview(sampleStatus());
    for (const label of [
      "Current approved direction",
      "Since last look",
      "Work flow",
      "Now",
      "Next",
      "Later",
      "Needs you",
      "Verified evidence",
      "Recent outcomes",
    ]) assert.match(html, new RegExp(label, "u"));
    assert.match(html, /class="lane now"/u);
    assert.match(html, /class="lane next"/u);
    assert.match(html, /class="lane later"/u);
    assert.match(html, /Know where the project is going at a glance/u);
    assert.match(html, /style="--p:33%"/u);
    assert.match(html, /&lt;script&gt;alert\(&#39;x&#39;\)&lt;\/script&gt;/u);
    assert.match(html, /&lt;unsafe&gt;\.txt/u);
    assert.match(html, /Latest recorded check/u);
    assert.match(html, /<code>node test\.mjs<\/code>/u);
    assert.match(html, /<strong>Duration:<\/strong> 2s/u);
    assert.match(html, /Recent completed/u);
    assert.doesNotMatch(html, /<script\b/iu);
    assert.doesNotMatch(html, /(?:src|href)="https?:/iu);
    assert.match(html, /@media \(max-width:560px\)/u);
    assert.match(html, /overflow-wrap:anywhere/u);
  });

  it("renders the real producer shape and the public stdout path", () => {
    const root = integrationFixture();
    try {
      const html = renderProjectOverview(collectProjectStatus(root, {
        now: new Date("2026-08-04T12:00:00Z"),
      }));
      assert.match(html, /Integrated Fixture/u);
      assert.match(html, /Render producer facts\./u);
      assert.match(html, /Integrated next task/u);
      const stdoutResult = spawnSync(process.execPath, [SCRIPT, "--stdout"], {
        cwd: root,
        encoding: "utf8",
      });
      assert.equal(stdoutResult.status, 0, stdoutResult.stderr);
      assert.match(stdoutResult.stdout, /^<!doctype html>/u);
      assert.match(stdoutResult.stdout, /Integrated next task/u);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("renders a useful first look when project state is empty", () => {
    const status = sampleStatus();
    status.milestone.goal = null;
    status.milestone.doneWhen = null;
    status.milestone.progress = null;
    status.work.inProgress = [];
    status.work.review = [];
    status.work.next = null;
    status.work.later = [];
    status.work.laterCount = 0;
    status.work.laterTruncated = false;
    status.work.blocked = [];
    status.work.needsOperator = [];
    status.work.recentCompleted = [];
    status.validation.latest = null;
    status.since.firstLook = true;
    status.since.marker = null;
    const html = renderProjectOverview(status);
    for (const text of [
      "Set the approved direction with the plan-milestone workflow.",
      "No work is actively moving.",
      "Nothing queued.",
      "No other eligible work.",
      "No recorded check",
      "No evidence",
      "No recorded outcomes",
      "No reliable task set",
    ]) assert.match(html, new RegExp(text.replaceAll(".", "\\."), "u"));
  });

  it("keeps high-volume active and later work bounded on the first screen", () => {
    const status = sampleStatus();
    status.work.inProgress = [
      task("task-101", "Active one", "in_progress"),
      task("task-102", "Active two", "in_progress"),
      task("task-103", "Active three", "in_progress"),
      task("task-104", "Active four", "in_progress"),
    ];
    status.work.review = [task("task-105", "Review five", "review")];
    status.work.later = [
      task("task-201", "Later one", "backlog"),
      task("task-202", "Later two", "backlog"),
      task("task-203", "Later three", "backlog"),
    ];
    status.work.laterCount = 7;
    status.work.laterTruncated = true;
    const html = renderProjectOverview(status);
    const nowLane = html.match(/class="lane now"[\s\S]+?class="lane next"/u)?.[0];
    assert(nowLane);
    assert.match(nowLane, /Active one/u);
    assert.doesNotMatch(nowLane, /Active four/u);
    assert.match(nowLane, /\+2 more active/u);
    assert.match(html, /Showing 3 of 7 eligible tasks/u);
    assert.match(html, /Active four/u, "full active list must remain in drill-down detail");
  });

  it("makes unknown, stale, failure, and first-look states explicit", () => {
    const status = sampleStatus();
    status.milestone.freshness = "stale";
    status.milestone.ageDays = 42;
    status.validation.latest.exitCode = 1;
    status.git.available = false;
    status.git.error = "git unavailable";
    status.since.firstLook = true;
    status.since.marker = null;
    status.work.needsOperator = [];
    status.warnings = ["planning source is incomplete"];
    status.git.changesTruncated = true;
    status.since.commits.items = [{ commit: "c".repeat(40), subject: "A visible commit" }];
    status.since.commits.truncated = true;
    status.since.removedTaskIds = ["task-099"];
    const html = renderProjectOverview(status);
    assert.match(html, /STALE · 42d old/u);
    assert.match(html, />FAIL</u);
    assert.match(html, />UNKNOWN</u);
    assert.match(html, /First look — mark it seen after reading/u);
    assert.match(html, /Nothing waiting on you/u);
    assert.match(html, /planning source is incomplete/u);
    assert.match(html, /class="warning-banner"/u);
    assert.match(html, /More changed paths exist/u);
    assert.match(html, /More commits exist/u);
    assert.match(html, /task-099/u);
    status.since.firstLook = false;
    status.since.marker = { seenAt: "2026-08-04T09:00:00Z", head: null, taskVersions: {} };
    status.since.commits = null;
    const unavailable = renderProjectOverview(status);
    assert.match(unavailable, /Marker exists, but Git could not compare it/u);
    assert.match(unavailable, /Unavailable — Git could not compare the marker/u);
  });

  it("refuses to write through a symlinked output directory", (context) => {
    const root = mkdtempSync(join(tmpdir(), "foundry-project-overview-root-"));
    const outside = mkdtempSync(join(tmpdir(), "foundry-project-overview-target-"));
    try {
      try {
        symlinkSync(outside, join(root, ".agent-foundry"), process.platform === "win32" ? "junction" : "dir");
      } catch (error) {
        if (["EPERM", "EACCES", "ENOTSUP"].includes(error.code)) {
          context.skip(`symlinks unavailable: ${error.code}`);
          return;
        }
        throw error;
      }
      assert.throws(
        () => writeProjectOverview(root, sampleStatus()),
        /refusing to write through symlinked/u,
      );
    } finally {
      rmSync(root, { recursive: true, force: true });
      rmSync(outside, { recursive: true, force: true });
    }
  });

  it("refuses to overwrite a symlinked output file", (context) => {
    const root = mkdtempSync(join(tmpdir(), "foundry-project-overview-file-root-"));
    const outside = join(mkdtempSync(join(tmpdir(), "foundry-project-overview-file-target-")), "outside.html");
    try {
      mkdirSync(join(root, ".agent-foundry"));
      writeFileSync(outside, "outside remains unchanged\n");
      try {
        symlinkSync(outside, join(root, ".agent-foundry", "project-overview.html"), "file");
      } catch (error) {
        if (["EPERM", "EACCES", "ENOTSUP"].includes(error.code)) {
          context.skip(`file symlinks unavailable: ${error.code}`);
          return;
        }
        throw error;
      }
      assert.throws(
        () => writeProjectOverview(root, sampleStatus()),
        /refusing to overwrite symlinked/u,
      );
      assert.equal(readFileSync(outside, "utf8"), "outside remains unchanged\n");
    } finally {
      rmSync(root, { recursive: true, force: true });
      rmSync(dirname(outside), { recursive: true, force: true });
    }
  });

  it("writes the default ignored artifact and rejects another schema", () => {
    const root = mkdtempSync(join(tmpdir(), "foundry-project-overview-"));
    try {
      const output = writeProjectOverview(root, sampleStatus());
      assert.equal(output, join(root, ".agent-foundry", "project-overview.html"));
      assert.equal(existsSync(output), true);
      assert.match(readFileSync(output, "utf8"), /<!doctype html>/u);
      assert.throws(
        () => renderProjectOverview({ ...sampleStatus(), schemaVersion: 2 }),
        /unsupported project-status schemaVersion/u,
      );
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("escapes every HTML control character and exercises CLI exits", () => {
    assert.equal(escapeHtml(`<&>"'`), "&lt;&amp;&gt;&quot;&#39;");
    assert.match(spawnSync(process.execPath, [SCRIPT, "--help"], { encoding: "utf8" }).stdout, /--stdout/u);
    assert.equal(spawnSync(process.execPath, [SCRIPT, "--bad"]).status, 2);
    const outside = mkdtempSync(join(tmpdir(), "foundry-project-overview-outside-"));
    try {
      assert.equal(spawnSync(process.execPath, [SCRIPT], { cwd: outside }).status, 1);
    } finally {
      rmSync(outside, { recursive: true, force: true });
    }
  });
});
