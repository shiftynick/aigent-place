#!/usr/bin/env node
// task-tracker dispatcher. See SKILL.md for verbs and exit codes.

import { argv, env, exit, stderr, stdout } from "node:process";
import { spawnSync } from "node:child_process";
import { existsSync, renameSync } from "node:fs";
import { hostname, userInfo } from "node:os";
import { basename, join } from "node:path";
import {
  ConflictError,
  NotFoundError,
  PRIORITY_RANK,
  TASK_PRIORITIES,
  TASK_STATUSES,
  appendLog,
  archiveDir,
  assertNoCycle,
  claimableTasks,
  compareTaskIds,
  ensureArchiveDir,
  ensureTasksDir,
  findRepoRoot,
  loadAllTasks,
  loadTaskContext,
  nextTaskId,
  nowIso,
  serializeTaskFile,
  slugify,
  taskFilePath,
  unmetBlockers,
  withRepoWriteLock,
  writeTaskAtomic,
} from "./_lib.mjs";

const STATUSES = TASK_STATUSES;
const PRIORITIES = TASK_PRIORITIES;
const ALLOWED_TRANSITIONS = {
  backlog: new Set(["ready", "in_progress", "blocked"]),
  ready: new Set(["backlog", "in_progress", "blocked"]),
  in_progress: new Set(["review", "blocked"]),
  review: new Set(["in_progress", "done", "blocked"]),
  blocked: new Set(["backlog", "ready", "in_progress", "review"]),
  done: new Set(),
};

class CliError extends Error {
  constructor(code, message) {
    super(message);
    this.code = code;
  }
}

function fail(code, msg) {
  throw new CliError(code, msg);
}

function requireRepoRoot() {
  const root = findRepoRoot();
  if (!root) fail(1, "no repo root found (no .git ancestor)");
  return root;
}

// Who is claiming a task. FOUNDRY_AGENT names the session explicitly (useful
// when several agents share one machine account); otherwise user@host is
// stable enough to tell two humans' machines apart and to spot stale claims.
function claimOwner() {
  const explicit = env.FOUNDRY_AGENT;
  if (typeof explicit === "string" && explicit.trim() !== "") {
    return explicit.trim();
  }
  let user = "unknown";
  try {
    user = userInfo().username;
  } catch {
    // Some containers have no resolvable user; hostname alone still helps.
  }
  return `${user}@${hostname()}`;
}

// Every flag this CLI accepts, across all verbs. Used to tell a swallowed
// value ("--tag --json") apart from free text that merely starts with dashes.
const KNOWN_FLAGS = new Set([
  "--add-blocked-by",
  "--add-tag",
  "--blocked",
  "--blocked-by",
  "--description",
  "--dry-run",
  "--force",
  "--json",
  "--note",
  "--priority",
  "--ready",
  "--remove-blocked-by",
  "--remove-tag",
  "--status",
  "--tag",
  "--title",
]);

// Values supplied as `--flag=value` are literal and must be accepted even when
// they look like a flag. Indices are safe to key on because every parser
// receives the same normalized array `normalizeArgs` produces in `main`.
let literalValueIndices = new Set();

function normalizeArgs(args) {
  const out = [];
  const literal = new Set();
  let optionsEnded = false;
  for (const arg of args) {
    // POSIX end-of-options: a bare `--` is dropped, and everything after it
    // is literal — the escape hatch for free text that would otherwise parse
    // as a flag (e.g. a note that literally starts with "--description=").
    if (!optionsEnded && arg === "--") {
      optionsEnded = true;
      continue;
    }
    if (optionsEnded) {
      literal.add(out.length);
      out.push(arg);
      continue;
    }
    const eq = arg.startsWith("--") ? arg.indexOf("=") : -1;
    // Split only when the prefix is a flag this CLI recognizes. Splitting any
    // `--x=y` shape would mangle positional free text — a note or title like
    // "--max-budget-usd=3 was used" must survive verbatim.
    if (eq > 2 && KNOWN_FLAGS.has(arg.slice(0, eq))) {
      out.push(arg.slice(0, eq));
      literal.add(out.length);
      out.push(arg.slice(eq + 1));
      continue;
    }
    out.push(arg);
  }
  literalValueIndices = literal;
  return out;
}

function optionValue(args, index, flag) {
  const value = args[index + 1];
  if (value == null) fail(2, `${flag} requires a value`);
  // Only a *recognized* flag counts as a swallowed value. Notes and
  // descriptions legitimately start with dashes ("--force was needed"), and
  // rejecting every such value made them unwritable.
  if (KNOWN_FLAGS.has(value) && !literalValueIndices.has(index + 1)) {
    fail(
      2,
      `${flag} requires a value (use ${flag}=<value> when the value is literally "${value}")`,
    );
  }
  return value;
}

function assertFrontmatterValue(label, value) {
  if (typeof value !== "string" || value.trim() === "") fail(2, `${label} must be non-empty`);
  if (/[\u0000-\u001f\u007f]/.test(value)) fail(2, `${label} cannot contain control characters`);
  if (value.includes("<!-- task-tracker:")) {
    fail(2, `${label} cannot contain reserved task-tracker markers`);
  }
}

function assertEditableTag(tag) {
  assertFrontmatterValue("tag", tag);
  if (tag === "deleted:true") fail(2, "deleted:true is reserved for task.mjs rm");
}

function assertDescription(value) {
  if (value.includes("<!-- task-tracker:")) {
    fail(2, "description cannot contain reserved task-tracker markers");
  }
}

function assertUsableBlockers(allTasks, blockerIds) {
  const byId = new Map(allTasks.map((row) => [row.task.frontmatter.id, row.task.frontmatter]));
  for (const id of blockerIds) {
    if (!/^task-\d{3,}$/.test(id)) fail(2, `invalid blocker id: ${id}`);
    const blocker = byId.get(id);
    if (!blocker) fail(2, `unknown blocker: ${id}`);
    if ((blocker.tags ?? []).includes("deleted:true")) {
      fail(2, `deleted task cannot be a blocker: ${id}`);
    }
  }
}

function parseAddArgs(args) {
  const out = { title: "", priority: "p2", tags: [], blockedBy: [], description: "" };
  let i = 0;
  if (args[0] && (literalValueIndices.has(0) || !args[0].startsWith("--"))) {
    out.title = args[0];
    i = 1;
  }
  while (i < args.length) {
    const a = args[i];
    // `--title` is the escape hatch for a title that starts with dashes, which
    // the positional form cannot express: task.mjs add --title=--weird
    if (a === "--title") {
      out.title = optionValue(args, i, a);
      i += 2;
    } else if (a === "--priority") {
      out.priority = optionValue(args, i, a);
      i += 2;
    } else if (a === "--tag") {
      out.tags.push(optionValue(args, i, a));
      i += 2;
    } else if (a === "--blocked-by") {
      out.blockedBy.push(optionValue(args, i, a));
      i += 2;
    } else if (a === "--description") {
      out.description = optionValue(args, i, a);
      i += 2;
    } else {
      fail(2, `unknown flag: ${a}`);
    }
  }
  return out;
}

function cmdAdd(args) {
  const root = requireRepoRoot();
  const opts = parseAddArgs(args);
  assertFrontmatterValue("title", opts.title);
  if (!PRIORITIES.includes(opts.priority)) fail(2, `bad --priority: ${opts.priority}`);
  for (const tag of opts.tags) assertEditableTag(tag);
  assertDescription(opts.description);
  if (new Set(opts.tags).size !== opts.tags.length) fail(2, "--tag values must be unique");
  if (new Set(opts.blockedBy).size !== opts.blockedBy.length) fail(2, "--blocked-by values must be unique");

  ensureTasksDir(root);
  const all = loadTaskContext(root);
  const id = nextTaskId(all);
  assertUsableBlockers(all, opts.blockedBy);
  try {
    assertNoCycle(all, id, opts.blockedBy);
  } catch (err) {
    fail(2, err.message);
  }
  const slug = slugify(opts.title);
  const ts = nowIso();
  const task = {
    frontmatter: {
      id,
      title: opts.title,
      status: "backlog",
      priority: opts.priority,
      tags: opts.tags,
      blockedBy: opts.blockedBy,
      createdAt: ts,
      updatedAt: ts,
    },
    description: opts.description,
    log: appendLog("", "created (status: backlog)"),
  };
  const path = taskFilePath(root, id, slug);
  writeTaskAtomic(path, serializeTaskFile(task), null);
  stdout.write(`${id}\n`);
}

function parseMoveArgs(args) {
  const out = { id: args[0], status: args[1], force: false, note: "" };
  let i = 2;
  while (i < args.length) {
    const a = args[i];
    if (a === "--force") {
      out.force = true;
      i++;
    } else if (a === "--note") {
      out.note = optionValue(args, i, a);
      i += 2;
    } else {
      fail(2, `unknown flag: ${a}`);
    }
  }
  return out;
}

function cmdMove(args) {
  const opts = parseMoveArgs(args);
  if (!opts.id || !opts.status) fail(2, "usage: task.mjs move <id> <status> [--force] [--note ...]");
  if (!STATUSES.includes(opts.status)) fail(2, `bad status: ${opts.status} (allowed: ${STATUSES.join(", ")})`);

  const root = requireRepoRoot();
  const all = loadAllTasks(root);
  const taskContext = loadTaskContext(root);
  const found = all.find((t) => t.task.frontmatter.id === opts.id);
  if (!found) {
    throw new NotFoundError(opts.id);
  }

  const from = found.task.frontmatter.status;
  if (opts.note) assertFrontmatterValue("note", opts.note);
  // Checked ahead of the transition guard so `--force` cannot reach it: a
  // soft-deleted task is pinned to `done`, and forcing past this would fail
  // later inside serialization as an opaque internal error instead of usage.
  if ((found.task.frontmatter.tags ?? []).includes("deleted:true") && opts.status !== "done") {
    fail(2, `${opts.id} is soft-deleted and is pinned to done; it cannot be moved`);
  }
  if (!ALLOWED_TRANSITIONS[from].has(opts.status) && !opts.force) {
    fail(2, `illegal transition ${from} -> ${opts.status} (use --force to override)`);
  }

  if (["in_progress", "review", "done"].includes(opts.status)) {
    const unmet = unmetBlockers(taskContext, found.task);
    if (unmet.length && !opts.force) {
      fail(2, `blocked by ${unmet.join(", ")} (use --force to override)`);
    }
  }

  found.task.frontmatter.status = opts.status;
  found.task.frontmatter.updatedAt = nowIso();
  let logMsg = `moved to ${opts.status}`;
  const decorations = [];
  // Claims exist only while a task is in_progress: set on entry so parallel
  // sessions can see who owns active work, cleared on any exit so a finished
  // or parked task never carries a stale owner.
  if (opts.status === "in_progress") {
    found.task.frontmatter.claimedBy = claimOwner();
    found.task.frontmatter.claimedAt = nowIso();
    decorations.push(`claimed by ${found.task.frontmatter.claimedBy}`);
  } else if (found.task.frontmatter.claimedBy != null) {
    delete found.task.frontmatter.claimedBy;
    delete found.task.frontmatter.claimedAt;
  }
  if (opts.force) decorations.push("forced");
  if (opts.note) decorations.push(`note: ${opts.note}`);
  if (decorations.length) logMsg += ` (${decorations.join("; ")})`;
  found.task.log = appendLog(found.task.log, logMsg);

  writeTaskAtomic(found.path, serializeTaskFile(found.task), found.mtime);
  stdout.write(`${opts.id} → ${opts.status}\n`);
}

function cmdNote(args) {
  const id = args[0];
  const text = args[1];
  if (!id || !text) fail(2, 'usage: task.mjs note <id> "<text>"');
  assertFrontmatterValue("note", text);
  const root = requireRepoRoot();
  const all = loadAllTasks(root);
  const found = all.find((t) => t.task.frontmatter.id === id);
  if (!found) throw new NotFoundError(id);
  found.task.frontmatter.updatedAt = nowIso();
  found.task.log = appendLog(found.task.log, `note: ${text}`);
  writeTaskAtomic(found.path, serializeTaskFile(found.task), found.mtime);
  stdout.write(`${id} noted\n`);
}

function parseListArgs(args) {
  const out = { status: null, tag: null, blocked: false, ready: false, json: false };
  let i = 0;
  while (i < args.length) {
    const a = args[i];
    if (a === "--status") {
      out.status = optionValue(args, i, a);
      i += 2;
    } else if (a === "--tag") {
      out.tag = optionValue(args, i, a);
      i += 2;
    } else if (a === "--blocked") {
      out.blocked = true;
      i++;
    } else if (a === "--ready") {
      out.ready = true;
      i++;
    } else if (a === "--json") {
      out.json = true;
      i++;
    } else {
      fail(2, `unknown flag: ${a}`);
    }
  }
  return out;
}

function cmdList(args) {
  const opts = parseListArgs(args);
  if (opts.blocked && opts.ready) {
    fail(2, "--blocked and --ready are mutually exclusive (a task can't be both)");
  }
  if (opts.status && !STATUSES.includes(opts.status)) {
    fail(2, `bad --status: ${opts.status}`);
  }
  const root = requireRepoRoot();
  const all = loadAllTasks(root);
  const taskContext = loadTaskContext(root);
  let rows = all.slice();
  if (opts.status) rows = rows.filter(({ task }) => task.frontmatter.status === opts.status);
  if (opts.tag) rows = rows.filter(({ task }) => (task.frontmatter.tags ?? []).includes(opts.tag));
  if (opts.blocked) rows = rows.filter(({ task }) => unmetBlockers(taskContext, task).length > 0);
  if (opts.ready) {
    // Pass full task context so dep status resolves even when --ready combines
    // with another filter that would have shrunk the visible set.
    const claimableIds = new Set(
      claimableTasks(taskContext)
        .filter((r) => !r.archived)
        .map((r) => r.task.frontmatter.id),
    );
    rows = rows.filter(({ task }) => claimableIds.has(task.frontmatter.id));
  }

  rows.sort((a, b) => {
    const pa = PRIORITY_RANK[a.task.frontmatter.priority] ?? 9;
    const pb = PRIORITY_RANK[b.task.frontmatter.priority] ?? 9;
    if (pa !== pb) return pa - pb;
    return compareTaskIds(a.task.frontmatter.id, b.task.frontmatter.id);
  });

  if (opts.json) {
    stdout.write(JSON.stringify(rows.map((r) => r.task.frontmatter), null, 2) + "\n");
    return;
  }
  for (const { task } of rows) {
    const fm = task.frontmatter;
    const tags = fm.tags?.length ? `[${fm.tags.join(",")}]` : "";
    stdout.write(
      `${fm.id.padEnd(10)} ${fm.status.padEnd(12)} ${fm.priority.padEnd(3)} ${tags.padEnd(30)} ${fm.title}\n`,
    );
  }
}

const COLUMNS = ["backlog", "ready", "in_progress", "review", "done", "blocked"];

function cmdBoard(_args) {
  const root = requireRepoRoot();
  const all = loadAllTasks(root);
  const buckets = Object.fromEntries(COLUMNS.map((c) => [c, []]));
  for (const { task } of all) {
    const s = task.frontmatter.status;
    if (buckets[s]) buckets[s].push(task);
  }
  for (const col of COLUMNS) {
    stdout.write(`\n${col.toUpperCase()}\n`);
    if (buckets[col].length === 0) {
      stdout.write("  (empty)\n");
      continue;
    }
    for (const t of buckets[col]) {
      const title =
        t.frontmatter.title.length > 60
          ? t.frontmatter.title.slice(0, 57) + "..."
          : t.frontmatter.title;
      const claim = t.frontmatter.claimedBy != null
        ? `  [${t.frontmatter.claimedBy}]`
        : "";
      stdout.write(`  ${t.frontmatter.id}  ${t.frontmatter.priority}  ${title}${claim}\n`);
    }
  }
}

function cmdShow(args) {
  const id = args[0];
  if (!id) fail(2, "usage: task.mjs show <id>");
  const root = requireRepoRoot();
  const all = loadAllTasks(root);
  const taskContext = loadTaskContext(root);
  const found = all.find((t) => t.task.frontmatter.id === id);
  if (!found) throw new NotFoundError(id);
  const fm = found.task.frontmatter;
  for (const k of ["id", "title", "status", "priority", "tags", "blockedBy", "createdAt", "updatedAt"]) {
    const v = Array.isArray(fm[k]) ? `[${fm[k].join(", ")}]` : fm[k];
    stdout.write(`${k}: ${v}\n`);
  }
  if (fm.claimedBy != null) {
    stdout.write(`claimedBy: ${fm.claimedBy}\n`);
    stdout.write(`claimedAt: ${fm.claimedAt}\n`);
  }
  const unmet = unmetBlockers(taskContext, found.task);
  stdout.write(`unmet blockers: ${unmet.length ? unmet.join(", ") : "(none)"}\n`);
  stdout.write(`\n## Description\n\n${found.task.description}\n`);
  stdout.write(`\n## Log\n\n${found.task.log}\n`);
}

function cmdNext(_args) {
  const root = requireRepoRoot();
  const all = loadTaskContext(root);
  const ready = claimableTasks(all).filter((r) => !r.archived);
  if (ready.length === 0) return;
  stdout.write(`${ready[0].task.frontmatter.id}\n`);
}

function parseArchiveArgs(args) {
  const out = { dryRun: false };
  let i = 0;
  while (i < args.length) {
    const a = args[i];
    if (a === "--dry-run") {
      out.dryRun = true;
      i++;
    } else {
      fail(2, `unknown flag: ${a}`);
    }
  }
  return out;
}

function cmdArchive(args) {
  const opts = parseArchiveArgs(args);
  const root = requireRepoRoot();
  const all = loadAllTasks(root);
  const done = all.filter(({ task }) => task.frontmatter.status === "done");
  if (!done.length) {
    stdout.write("archived 0 tasks\n");
    return;
  }

  const dir = archiveDir(root);
  const moves = done.map((row) => ({
    ...row,
    target: join(dir, basename(row.path)),
  }));
  for (const move of moves) {
    if (existsSync(move.target)) {
      throw new ConflictError(move.target);
    }
  }

  if (opts.dryRun) {
    for (const { task, target } of moves) {
      stdout.write(`${task.frontmatter.id} -> ${target}\n`);
    }
    stdout.write(`would archive ${moves.length} task${moves.length === 1 ? "" : "s"}\n`);
    return;
  }

  ensureArchiveDir(root);
  for (const move of moves) {
    renameSync(move.path, move.target);
  }
  stdout.write(`archived ${moves.length} task${moves.length === 1 ? "" : "s"}\n`);
}

function parseEditArgs(args) {
  const out = {
    id: args[0],
    title: null,
    priority: null,
    addTags: [],
    removeTags: [],
    addBlockedBy: [],
    removeBlockedBy: [],
    description: null,
  };
  let i = 1;
  while (i < args.length) {
    const a = args[i];
    if (a === "--title") {
      out.title = optionValue(args, i, a);
      i += 2;
    } else if (a === "--priority") {
      out.priority = optionValue(args, i, a);
      i += 2;
    } else if (a === "--add-tag") {
      out.addTags.push(optionValue(args, i, a));
      i += 2;
    } else if (a === "--remove-tag") {
      out.removeTags.push(optionValue(args, i, a));
      i += 2;
    } else if (a === "--add-blocked-by") {
      out.addBlockedBy.push(optionValue(args, i, a));
      i += 2;
    } else if (a === "--remove-blocked-by") {
      out.removeBlockedBy.push(optionValue(args, i, a));
      i += 2;
    } else if (a === "--description") {
      out.description = optionValue(args, i, a);
      i += 2;
    } else {
      fail(2, `unknown flag: ${a}`);
    }
  }
  return out;
}

function cmdEdit(args) {
  const opts = parseEditArgs(args);
  if (!opts.id) fail(2, "usage: task.mjs edit <id> [...]");
  const root = requireRepoRoot();
  const all = loadAllTasks(root);
  const taskContext = loadTaskContext(root);
  const found = all.find((t) => t.task.frontmatter.id === opts.id);
  if (!found) throw new NotFoundError(opts.id);

  const fm = found.task.frontmatter;
  const diffs = [];

  if (opts.title != null && opts.title !== fm.title) {
    assertFrontmatterValue("title", opts.title);
    diffs.push(`title "${fm.title}"→"${opts.title}"`);
    fm.title = opts.title;
  }
  if (opts.priority != null && opts.priority !== fm.priority) {
    if (!PRIORITIES.includes(opts.priority)) fail(2, `bad --priority: ${opts.priority}`);
    diffs.push(`priority ${fm.priority}→${opts.priority}`);
    fm.priority = opts.priority;
  }
  for (const t of opts.addTags) {
    assertEditableTag(t);
    if (!fm.tags.includes(t)) {
      fm.tags.push(t);
      diffs.push(`+tag ${t}`);
    }
  }
  for (const t of opts.removeTags) {
    assertEditableTag(t);
    const before = fm.tags.length;
    fm.tags = fm.tags.filter((x) => x !== t);
    if (fm.tags.length !== before) diffs.push(`-tag ${t}`);
  }
  let newBlocked = fm.blockedBy.slice();
  for (const b of opts.removeBlockedBy) {
    const before = newBlocked.length;
    newBlocked = newBlocked.filter((x) => x !== b);
    if (newBlocked.length !== before) diffs.push(`-blockedBy ${b}`);
  }
  for (const b of opts.addBlockedBy) {
    if (!newBlocked.includes(b)) {
      newBlocked.push(b);
      diffs.push(`+blockedBy ${b}`);
    }
  }
  if (opts.addBlockedBy.length || opts.removeBlockedBy.length) {
    assertUsableBlockers(taskContext, opts.addBlockedBy);
    try {
      assertNoCycle(taskContext, fm.id, newBlocked);
    } catch (err) {
      fail(2, err.message);
    }
    fm.blockedBy = newBlocked;
  }
  if (opts.description != null) {
    assertDescription(opts.description);
    found.task.description = opts.description;
    diffs.push("description updated");
  }

  if (!diffs.length) {
    stdout.write("(no changes)\n");
    return;
  }
  fm.updatedAt = nowIso();
  found.task.log = appendLog(found.task.log, `edited (${diffs.join("; ")})`);
  writeTaskAtomic(found.path, serializeTaskFile(found.task), found.mtime);
  stdout.write(`${fm.id} edited\n`);
}

function cmdRm(args) {
  const id = args[0];
  if (!id) fail(2, "usage: task.mjs rm <id>");
  const root = requireRepoRoot();
  const all = loadAllTasks(root);
  const found = all.find((t) => t.task.frontmatter.id === id);
  if (!found) throw new NotFoundError(id);
  const fm = found.task.frontmatter;
  fm.status = "done";
  if (!fm.tags.includes("deleted:true")) fm.tags.push("deleted:true");
  fm.updatedAt = nowIso();
  found.task.log = appendLog(found.task.log, "removed (soft delete)");
  writeTaskAtomic(found.path, serializeTaskFile(found.task), found.mtime);
  stdout.write(`${id} removed\n`);
}

// Bound so evidence entries stay readable inside a task log; the full output
// is printed to the console at run time and is not the log's job to preserve.
const RUN_TAIL_LINES = 30;
const RUN_TAIL_CHARS = 3000;
const RUN_TIMEOUT_MS = 15 * 60 * 1000;

function evidenceTail(output) {
  const clean = output
    .replace(/\r\n/gu, "\n")
    // The serializer rejects reserved markers anywhere in the log; command
    // output quoting one (docs, test fixtures) must not make evidence
    // unrecordable.
    .replaceAll("<!-- task-tracker:", "<!- - task-tracker:")
    .replace(/[\u0000-\u0008\u000b-\u001f\u007f]/gu, "?")
    .trimEnd();
  if (clean === "") return { tail: "(no output)", truncated: false };
  let lines = clean.split("\n");
  let truncated = false;
  if (lines.length > RUN_TAIL_LINES) {
    lines = lines.slice(-RUN_TAIL_LINES);
    truncated = true;
  }
  let tail = lines.join("\n");
  if (tail.length > RUN_TAIL_CHARS) {
    tail = tail.slice(-RUN_TAIL_CHARS);
    truncated = true;
  }
  return { tail, truncated };
}

// `task.mjs run <id> -- <command...>` executes the command and appends what
// ACTUALLY happened — command, exit code, duration, output tail — to the task
// log. This is the difference between claimed and recorded validation: the
// entry is written by this tool from the real result, not typed by the agent.
function cmdRun(args) {
  const id = args[0];
  const commandParts = args.slice(1);
  if (!id || commandParts.length === 0) {
    fail(2, "usage: task.mjs run <id> -- <command> [args...]");
  }
  const root = requireRepoRoot();
  // Fail fast on a bad id before spending minutes running the command.
  withRepoWriteLock(root, () => {
    const all = loadAllTasks(root);
    if (!all.find((t) => t.task.frontmatter.id === id)) {
      throw new NotFoundError(id);
    }
  });

  const commandLine = commandParts.join(" ");
  const startedAt = nowIso();
  const t0 = Date.now();
  // The command itself runs OUTSIDE the repo lock: a ten-minute test suite
  // must not block every other board command on this machine.
  const result = spawnSync(commandLine, {
    shell: true,
    cwd: root,
    encoding: "utf8",
    maxBuffer: 16 * 1024 * 1024,
    timeout: RUN_TIMEOUT_MS,
    killSignal: "SIGTERM",
    windowsHide: true,
  });
  const seconds = ((Date.now() - t0) / 1000).toFixed(1);
  const timedOut = result.error?.code === "ETIMEDOUT";
  const combined = `${result.stdout ?? ""}${result.stderr ?? ""}`;
  const outcome = timedOut
    ? `timed out after ${seconds}s`
    : result.signal
      ? `terminated by signal ${result.signal} after ${seconds}s`
      : `exit ${result.status} in ${seconds}s`;

  // Show the agent the full output now; the log keeps only the bounded tail.
  if (combined) stdout.write(combined.endsWith("\n") ? combined : `${combined}\n`);

  const { tail, truncated } = evidenceTail(combined);
  const evidence = [
    `run: ${commandLine}`,
    `  started ${startedAt}, ${outcome}`,
    truncated ? `  output tail (truncated to last ${RUN_TAIL_LINES} lines):` : "  output:",
    // The prefix must not manufacture whitespace: an interior blank output
    // line would otherwise become "  | " and fail `git diff --check` and any
    // trailing-whitespace hook — on the one feature whose whole purpose is
    // producing committable evidence. Trailing space *within* a command's own
    // output line is preserved deliberately; evidence is a record, not a
    // reformat.
    ...tail.split("\n").map((line) => (line ? `  | ${line}` : "  |")),
  ].join("\n");

  withRepoWriteLock(root, () => {
    const all = loadAllTasks(root);
    const found = all.find((t) => t.task.frontmatter.id === id);
    if (!found) throw new NotFoundError(id);
    found.task.frontmatter.updatedAt = nowIso();
    found.task.log = appendLog(found.task.log, evidence);
    writeTaskAtomic(found.path, serializeTaskFile(found.task), found.mtime);
  });

  stdout.write(`${id} evidence recorded: ${outcome}\n`);
  if (result.error && !timedOut) {
    fail(1, `command could not start: ${result.error.message}`);
  }
  if (timedOut || result.signal || result.status !== 0) {
    fail(1, `command failed (${outcome}); evidence recorded on ${id}`);
  }
}

const VERBS = {
  // Read
  board: cmdBoard,
  list: cmdList,
  show: cmdShow,
  next: cmdNext,
  // Write
  add: cmdAdd,
  archive: cmdArchive,
  move: cmdMove,
  note: cmdNote,
  edit: cmdEdit,
  rm: cmdRm,
  run: cmdRun,
};
function main() {
  const verb = argv[2];
  if (!verb || verb === "-h" || verb === "--help") {
    stdout.write("usage: task.mjs <verb> [args...]\nverbs: " + Object.keys(VERBS).join(", ") + "\n");
    return;
  }
  const handler = VERBS[verb];
  if (!handler) return failAndExit(2, `unknown verb: ${verb}`);
  try {
    const root = requireRepoRoot();
    const args = normalizeArgs(argv.slice(3));
    if (verb === "run") {
      // cmdRun manages the lock itself: it must execute the command with the
      // lock RELEASED (long commands would block the whole board) and the
      // lock is not reentrant, so wrapping here would deadlock the append.
      handler(args);
    } else {
      withRepoWriteLock(root, () => handler(args));
    }
  } catch (err) {
    if (err instanceof CliError) return failAndExit(err.code, err.message);
    if (err instanceof NotFoundError) return failAndExit(4, err.message);
    if (err instanceof ConflictError) return failAndExit(5, err.message);
    return failAndExit(1, err.message);
  }
}

function failAndExit(code, msg) {
  stderr.write(`ERROR: ${msg}\n`);
  exit(code);
}

main();
