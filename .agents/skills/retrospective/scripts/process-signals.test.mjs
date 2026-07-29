import test from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { collectSignals, scanTaskText, taskTimestamp } from "./process-signals.mjs";

test("extracts friction notes with their text", () => {
  const row = scanTaskText("task-001", [
    "- 2026-07-01T00:00:00Z — note: friction: SDLC and execute-task disagreed",
    "- 2026-07-01T00:01:00Z — note: ordinary progress note",
  ].join("\n"));
  assert.deepEqual(row.friction, ["SDLC and execute-task disagreed"]);
});

test("friction matching is case-sensitive", () => {
  // `friction:` is a convention; matching Friction:/FRICTION: would widen it
  // silently, which is exactly how the PowerShell equivalent would behave.
  const row = scanTaskText("task-001", "note: Friction: capitalised\nnote: FRICTION: shouty");
  assert.deepEqual(row.friction, []);
});

test("counts review churn as re-entries into in_progress", () => {
  const once = scanTaskText("task-001", "— moved to in_progress");
  assert.equal(once.churn, 0);
  const thrice = scanTaskText("task-002", [
    "— moved to in_progress",
    "— moved to review",
    "— moved to in_progress (claimed by a)",
    "— moved to review",
    "— moved to in_progress (claimed by a)",
  ].join("\n"));
  assert.equal(thrice.churn, 2);
});

test("detects forced transitions in either decoration position", () => {
  const row = scanTaskText("task-001", [
    "— moved to done (forced)",
    "— moved to in_progress (claimed by a; forced)",
  ].join("\n"));
  assert.equal(row.forced.length, 2);
});

test("reports failing recorded runs but not passing ones", () => {
  const row = scanTaskText("task-001", [
    "  started 2026-07-01T00:00:00Z, exit 0 in 1.2s",
    "  started 2026-07-01T00:01:00Z, exit 3 in 0.4s",
    "  started 2026-07-01T00:02:00Z, timed out after 900.0s",
  ].join("\n"));
  assert.deepEqual(row.failed, ["exit 3 in 0.4s", "timed out after 900.0s"]);
});

test("collects across active and archived tasks", () => {
  const root = mkdtempSync(join(tmpdir(), "signals-"));
  try {
    mkdirSync(join(root, ".git"), { recursive: true });
    mkdirSync(join(root, ".tasks", "tasks"), { recursive: true });
    mkdirSync(join(root, ".tasks", "archive"), { recursive: true });
    writeFileSync(
      join(root, ".tasks", "tasks", "task-001-a.md"),
      "id: task-001\nnote: friction: active one\n",
      "utf8",
    );
    writeFileSync(
      join(root, ".tasks", "archive", "task-002-b.md"),
      "id: task-002\nnote: friction: archived one\n",
      "utf8",
    );
    // Not a task file; must be ignored.
    writeFileSync(join(root, ".tasks", "tasks", "notes.md"), "friction: ignore me\n", "utf8");

    const rows = collectSignals(root);
    assert.deepEqual(rows.map((r) => r.id).sort(), ["task-001", "task-002"]);
    assert.deepEqual(rows.flatMap((r) => r.friction).sort(), ["active one", "archived one"]);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("reads the task timestamp from content, quoted or bare", () => {
  assert.equal(
    taskTimestamp('updatedAt: "2026-05-02T00:00:00Z"\n'),
    Date.parse("2026-05-02T00:00:00Z"),
  );
  assert.equal(
    taskTimestamp("updatedAt: 2026-05-02T00:00:00Z\n"),
    Date.parse("2026-05-02T00:00:00Z"),
  );
});

test("falls back to the newest dated log line when updatedAt is absent", () => {
  const text = [
    "- 2026-03-01T00:00:00Z — created",
    "- 2026-06-15T12:00:00Z — note: later entry",
    "- 2026-04-01T00:00:00Z — note: out of order",
  ].join("\n");
  assert.equal(taskTimestamp(text), Date.parse("2026-06-15T12:00:00Z"));
  assert.equal(taskTimestamp("no timestamps at all"), null);
});

test("--since ignores filesystem mtime entirely", () => {
  // A fresh clone, new worktree, or CI checkout resets every mtime to "now".
  // This fixture reproduces that: the file is touched to the present while its
  // frontmatter stays old, and it must still be excluded.
  const root = mkdtempSync(join(tmpdir(), "signals-"));
  try {
    mkdirSync(join(root, ".git"), { recursive: true });
    mkdirSync(join(root, ".tasks", "tasks"), { recursive: true });
    const old = join(root, ".tasks", "tasks", "task-001-old.md");
    writeFileSync(
      old,
      'id: task-001\nupdatedAt: "2026-01-01T00:00:00Z"\nnote: friction: ancient\n',
      "utf8",
    );
    const recent = join(root, ".tasks", "tasks", "task-002-recent.md");
    writeFileSync(
      recent,
      'id: task-002\nupdatedAt: "2026-06-01T00:00:00Z"\nnote: friction: current\n',
      "utf8",
    );
    // Both files now look brand new to the filesystem, as after a checkout.
    const now = new Date();
    utimesSync(old, now, now);
    utimesSync(recent, now, now);

    const rows = collectSignals(root, "2026-05-01");
    assert.deepEqual(rows.map((r) => r.id), ["task-002"]);
    assert.deepEqual(rows.flatMap((r) => r.friction), ["current"]);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("keeps files with no usable timestamp rather than dropping evidence", () => {
  const root = mkdtempSync(join(tmpdir(), "signals-"));
  try {
    mkdirSync(join(root, ".git"), { recursive: true });
    mkdirSync(join(root, ".tasks", "tasks"), { recursive: true });
    writeFileSync(
      join(root, ".tasks", "tasks", "task-001-undated.md"),
      "id: task-001\nnote: friction: undated\n",
      "utf8",
    );
    assert.deepEqual(
      collectSignals(root, "2026-05-01").map((r) => r.id),
      ["task-001"],
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("rejects an unparsable --since value", () => {
  const root = mkdtempSync(join(tmpdir(), "signals-"));
  try {
    mkdirSync(join(root, ".git"), { recursive: true });
    assert.throws(() => collectSignals(root, "not-a-date"), /not a parsable date/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
