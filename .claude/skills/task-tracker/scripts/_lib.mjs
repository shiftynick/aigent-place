// Shared helpers for the task-tracker skill.
// Zero-dep — only Node built-ins.
//
// The task-file header is YAML-*shaped*, not YAML. This module implements a
// small private dialect: every scalar is a string, and quoting exists only to
// survive this parser's own round-trip. Values a real YAML parser would type
// (`1e3`, `0x10`, `2026-05-02`, `on`) stay strings here. Anything else reading
// `.tasks/*.md` with a general YAML library can therefore disagree with this
// tool; treat `task.mjs --json` as the interchange format instead.

import {
  copyFileSync,
  existsSync,
  linkSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { basename, dirname, join } from "node:path";
import { cwd } from "node:process";
import { randomBytes } from "node:crypto";
import { hostname } from "node:os";

const FRONTMATTER_KEYS = [
  "id",
  "title",
  "status",
  "priority",
  "tags",
  "blockedBy",
  "createdAt",
  "updatedAt",
  "claimedBy",
  "claimedAt",
];

// Keys that only exist while a claim is live. They are omitted from
// serialization when absent so files written before claims existed — and
// files for unclaimed tasks — do not change shape.
const OPTIONAL_FRONTMATTER_KEYS = new Set(["claimedBy", "claimedAt"]);

const RESERVED_VALUES = new Set(["true", "false", "null", "~", "yes", "no"]);
const QUOTE_TRIGGERS = /[:#\[\]\{\},&*!|>'"%@`]/;
export const TASK_STATUSES = ["backlog", "ready", "in_progress", "review", "done", "blocked"];
export const TASK_PRIORITIES = ["p0", "p1", "p2", "p3"];
const ISO_SECOND = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/;
// linkSync failures that mean "this filesystem has no hard links" rather than
// "the destination exists". EEXIST is deliberately absent: it is a real race.
const LINK_UNSUPPORTED = new Set([
  "EPERM",
  "EACCES",
  "ENOSYS",
  "ENOTSUP",
  "EOPNOTSUPP",
  "EXDEV",
  "EMLINK",
]);

export function parseTaskFile(text) {
  if (!text.startsWith("---\n") && !text.startsWith("---\r\n")) {
    throw new Error("missing frontmatter opening ---");
  }
  const lines = text.split(/\r?\n/);
  let i = 1;
  let closed = false;
  const fm = {};
  for (; i < lines.length; i++) {
    if (lines[i] === "---") {
      i++;
      closed = true;
      break;
    }
    const colon = lines[i].indexOf(":");
    if (colon < 0) throw new Error(`invalid frontmatter line: ${lines[i]}`);
    const key = lines[i].slice(0, colon).trim();
    const raw = lines[i].slice(colon + 1).trim();
    if (!FRONTMATTER_KEYS.includes(key)) throw new Error(`unknown frontmatter key: ${key}`);
    if (Object.hasOwn(fm, key)) throw new Error(`duplicate frontmatter key: ${key}`);
    fm[key] = parseScalarOrList(raw);
  }
  if (!closed) throw new Error("missing frontmatter closing ---");
  for (const key of FRONTMATTER_KEYS) {
    if (OPTIONAL_FRONTMATTER_KEYS.has(key)) continue;
    if (fm[key] == null) throw new Error(`missing required frontmatter key: ${key}`);
  }
  validateTaskFrontmatter(fm);

  const body = lines.slice(i).join("\n");
  const { description, log } = extractBodySections(body);
  return { frontmatter: fm, description, log };
}

function validateTaskFrontmatter(fm) {
  if (!/^task-\d{3,}$/.test(String(fm.id))) {
    throw new Error(`invalid task id: ${fm.id}`);
  }
  if (typeof fm.title !== "string" || fm.title.trim() === "") {
    throw new Error("title must be a non-empty string");
  }
  if (/[\u0000-\u001f\u007f]/.test(fm.title)) {
    throw new Error("title cannot contain control characters");
  }
  if (!TASK_STATUSES.includes(fm.status)) {
    throw new Error(`invalid status: ${fm.status}`);
  }
  if (!TASK_PRIORITIES.includes(fm.priority)) {
    throw new Error(`invalid priority: ${fm.priority}`);
  }
  for (const key of ["tags", "blockedBy"]) {
    if (!Array.isArray(fm[key]) || fm[key].some((v) => typeof v !== "string" || v.trim() === "")) {
      throw new Error(`${key} must be a list of non-empty strings`);
    }
    if (fm[key].some((v) => /[\u0000-\u001f\u007f]/.test(v))) {
      throw new Error(`${key} cannot contain control characters`);
    }
    if (new Set(fm[key]).size !== fm[key].length) {
      throw new Error(`${key} contains duplicate values`);
    }
  }
  for (const id of fm.blockedBy) {
    if (!/^task-\d{3,}$/.test(id)) throw new Error(`invalid blocker id: ${id}`);
    if (id === fm.id) throw new Error(`${fm.id} cannot block itself`);
  }
  if (fm.claimedBy != null || fm.claimedAt != null) {
    if (typeof fm.claimedBy !== "string" || fm.claimedBy.trim() === "") {
      throw new Error("claimedBy must be a non-empty string when a claim exists");
    }
    if (/[\u0000-\u001f\u007f]/u.test(fm.claimedBy)) {
      throw new Error("claimedBy cannot contain control characters");
    }
    if (Number.isNaN(Date.parse(String(fm.claimedAt)))) {
      throw new Error("claimedAt must be a timestamp when a claim exists");
    }
    if (fm.status !== "in_progress") {
      throw new Error("claim fields are only valid while status is in_progress");
    }
  }
  for (const key of ["createdAt", "updatedAt"]) {
    const value = String(fm[key]);
    const normalized = Number.isNaN(Date.parse(value))
      ? null
      : new Date(value).toISOString().replace(/\.\d{3}Z$/, "Z");
    if (!ISO_SECOND.test(value) || normalized !== value) {
      throw new Error(`invalid ${key}: ${fm[key]}`);
    }
  }
  if (Date.parse(fm.updatedAt) < Date.parse(fm.createdAt)) {
    throw new Error("updatedAt cannot precede createdAt");
  }
  if (fm.tags.includes("deleted:true") && fm.status !== "done") {
    throw new Error("deleted:true requires status done");
  }
}

function parseScalarOrList(raw) {
  if (raw.startsWith("[") && raw.endsWith("]")) {
    const inner = raw.slice(1, -1).trim();
    if (!inner) return [];
    return splitFlowList(inner).map(unquote);
  }
  return unquote(raw);
}

function splitFlowList(s) {
  // Naive split on commas not inside quotes. Good enough for tag/blockedBy lists.
  const out = [];
  let cur = "";
  let inQuote = null;
  let escaped = false;
  for (const ch of s) {
    if (inQuote) {
      if (inQuote === '"' && escaped) {
        escaped = false;
        cur += ch;
        continue;
      }
      if (inQuote === '"' && ch === "\\") {
        escaped = true;
        cur += ch;
        continue;
      }
      if (ch === inQuote) inQuote = null;
      cur += ch;
      continue;
    }
    if (ch === '"' || ch === "'") {
      inQuote = ch;
      cur += ch;
      continue;
    }
    if (ch === ",") {
      out.push(cur.trim());
      cur = "";
      continue;
    }
    cur += ch;
  }
  if (inQuote) throw new Error("unterminated quoted list value");
  if (cur.trim()) out.push(cur.trim());
  return out;
}

function unquote(raw) {
  const v = raw.trim();
  if (v.length >= 2) {
    const first = v[0];
    const last = v[v.length - 1];
    // Matching outer quotes are only a quoted scalar when they actually
    // enclose the value. `"a" or "b"` (reachable by hand-editing) closes its
    // first quote in the middle, so it is a bare string, not `a" or "b`.
    if (first === '"' && last === '"' && enclosesWholeValue(v, '"')) {
      return v.slice(1, -1).replace(/\\"/g, '"').replace(/\\\\/g, "\\");
    }
    if (first === "'" && last === "'" && enclosesWholeValue(v, "'")) {
      return v.slice(1, -1);
    }
  }
  return v;
}

function enclosesWholeValue(v, quote) {
  for (let i = 1; i < v.length - 1; i++) {
    if (quote === '"' && v[i] === "\\") {
      i++;
      continue;
    }
    if (v[i] === quote) return false;
  }
  return true;
}

function extractBodySections(body) {
  const descriptionMarker = "<!-- task-tracker:description -->";
  const logMarker = "<!-- task-tracker:log -->";
  const descriptionMarkers = body.split(descriptionMarker).length - 1;
  const logMarkers = body.split(logMarker).length - 1;
  if ((descriptionMarkers || logMarkers) && (descriptionMarkers !== 1 || logMarkers !== 1)) {
    throw new Error("task body markers must appear exactly once");
  }

  const descriptionHeader = body.search(/^## Description\s*$/m);
  if (descriptionHeader < 0) throw new Error("missing ## Description section");
  const descriptionStart = body.indexOf("\n", descriptionHeader);
  if (descriptionStart < 0) throw new Error("malformed ## Description section");

  let logBoundary;
  let logHeader;
  if (logMarkers === 1) {
    logBoundary = body.indexOf(logMarker);
    const logSearchStart = logBoundary + logMarker.length;
    const relativeLogHeader = body.slice(logSearchStart).search(/^## Log\s*$/m);
    logHeader = relativeLogHeader < 0 ? -1 : logSearchStart + relativeLogHeader;
    const descriptionBoundary = body.indexOf(descriptionMarker);
    if (
      descriptionBoundary < 0 ||
      descriptionBoundary > descriptionHeader ||
      descriptionHeader > logBoundary ||
      logHeader < logBoundary
    ) {
      throw new Error("malformed task body marker order");
    }
  } else {
    const matches = [...body.matchAll(/^## Log\s*$/gm)];
    if (!matches.length) throw new Error("missing ## Log section");
    if (matches.length !== 1) throw new Error("ambiguous legacy ## Log sections");
    logHeader = matches[0].index;
    logBoundary = logHeader;
  }
  if (logHeader < 0) throw new Error("missing ## Log section after marker");
  const logStart = body.indexOf("\n", logHeader);
  return {
    description: body.slice(descriptionStart + 1, logBoundary).replace(/^\n+/, "").replace(/\n+$/, "\n"),
    log: logStart < 0 ? "" : body.slice(logStart + 1).replace(/^\n+/, "").replace(/\n+$/, "\n"),
  };
}

export function serializeTaskFile({ frontmatter, description, log }) {
  validateTaskFrontmatter(frontmatter);
  if (String(description ?? "").includes("<!-- task-tracker:")) {
    throw new Error("description contains a reserved task-tracker marker");
  }
  if (String(log ?? "").includes("<!-- task-tracker:")) {
    throw new Error("log contains a reserved task-tracker marker");
  }
  const lines = ["---"];
  for (const key of FRONTMATTER_KEYS) {
    const v = frontmatter[key];
    if (OPTIONAL_FRONTMATTER_KEYS.has(key) && v == null) continue;
    if (Array.isArray(v)) {
      if (v.length === 0) {
        lines.push(`${key}: []`);
      } else {
        lines.push(`${key}: [${v.map(formatScalarInList).join(", ")}]`);
      }
    } else {
      lines.push(`${key}: ${formatScalar(v)}`);
    }
  }
  lines.push("---");
  lines.push("");
  lines.push("<!-- task-tracker:description -->");
  lines.push("## Description");
  lines.push("");
  lines.push((description ?? "").trimEnd());
  lines.push("");
  lines.push("<!-- task-tracker:log -->");
  lines.push("## Log");
  lines.push("");
  lines.push((log ?? "").trimEnd());
  lines.push("");
  return lines.join("\n");
}

function formatScalarInList(v) {
  // Inside a flow list, only chars that would break list parsing matter.
  // Bare `area:web` parses fine because splitFlowList splits on commas,
  // not colons. This keeps the canonical `key:value` tag shape unquoted.
  if (v == null) return '""';
  const s = String(v);
  if (s === "") return '""';
  // Leading *and* trailing whitespace must be quoted: the parser trims every
  // scalar, so an unquoted trailing space would silently vanish on read-back.
  if (/[,\[\]"']/.test(s) || /^\s|\s$/.test(s)) {
    return `"${s.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
  }
  return s;
}

function formatScalar(v) {
  if (v == null) return '""';
  const s = String(v);
  if (s === "") return '""';
  if (RESERVED_VALUES.has(s.toLowerCase())) return `"${s}"`;
  if (/^-?\d+(\.\d+)?$/.test(s)) return `"${s}"`;
  // Trailing whitespace is quoted for the same reason as leading whitespace:
  // the parser trims, so an unquoted trailing space would not round-trip.
  if (s.startsWith("-") || /^\s|\s$/.test(s) || QUOTE_TRIGGERS.test(s)) {
    return `"${s.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
  }
  return s;
}

export function findRepoRoot(startDir = cwd(), maxDepth = 12) {
  let dir = startDir;
  for (let i = 0; i < maxDepth; i++) {
    if (existsSync(join(dir, ".git"))) return dir;
    const parent = dirname(dir);
    if (parent === dir) return null;
    dir = parent;
  }
  return null;
}

export function tasksDir(repoRoot) {
  return join(repoRoot, ".tasks", "tasks");
}

export function archiveDir(repoRoot) {
  return join(repoRoot, ".tasks", "archive");
}

export function taskFilePath(repoRoot, id, slug) {
  return join(tasksDir(repoRoot), `${id}-${slug}.md`);
}

export function ensureTasksDir(repoRoot) {
  const dir = tasksDir(repoRoot);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  return dir;
}

export function ensureArchiveDir(repoRoot) {
  const dir = archiveDir(repoRoot);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  return dir;
}

export class ConflictError extends Error {
  constructor(path, message) {
    super(message ?? `task file changed since read: ${path}`);
    this.name = "ConflictError";
    this.path = path;
  }
}

// A held lock and a changed file are both exit-5 conflicts, so this extends
// ConflictError to keep every dispatcher's exit mapping intact — but it says
// what actually happened instead of blaming a file that never changed.
export class LockHeldError extends ConflictError {
  constructor(lockPath) {
    super(lockPath, `lock held by another process: ${lockPath}`);
    this.name = "LockHeldError";
  }
}

// Ordinary cross-agent contention is a command-length wait, not a failure.
// Back off over ~1.5s before surfacing exit 5; a lock that outlives that is a
// stuck process, which is worth reporting rather than waiting on.
const LOCK_RETRY_DELAYS_MS = [50, 100, 200, 400, 800];
const LOCK_MAX_ATTEMPTS = 12;

function sleepSync(ms) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

export function acquireRepoLock(repoRoot) {
  const taskRoot = join(repoRoot, ".tasks");
  const lockPath = join(taskRoot, ".write-lock");
  if (!existsSync(taskRoot)) mkdirSync(taskRoot, { recursive: true });
  let acquired = false;
  let waits = 0;
  for (let attempt = 0; attempt < LOCK_MAX_ATTEMPTS && !acquired; attempt++) {
    try {
      mkdirSync(lockPath);
      acquired = true;
    } catch (err) {
      if (err.code !== "EEXIST") throw err;
      // A recovered stale lock is retried immediately; a live one waits.
      if (recoverStaleLock(lockPath)) continue;
      if (waits >= LOCK_RETRY_DELAYS_MS.length) break;
      sleepSync(LOCK_RETRY_DELAYS_MS[waits]);
      waits += 1;
    }
  }
  if (!acquired) throw new LockHeldError(lockPath);
  try {
    writeFileSync(
      join(lockPath, "owner.json"),
      JSON.stringify({ pid: process.pid, hostname: hostname(), createdAt: nowIso() }) + "\n",
    );
    recoverInterruptedWrites(repoRoot);
  } catch (err) {
    rmSync(lockPath, { recursive: true, force: true });
    throw err;
  }
  let released = false;
  return () => {
    if (released) return;
    released = true;
    rmSync(lockPath, { recursive: true, force: true });
  };
}

export function withRepoWriteLock(repoRoot, fn) {
  const release = acquireRepoLock(repoRoot);
  try {
    return fn();
  } finally {
    release();
  }
}

function recoverStaleLock(lockPath) {
  try {
    const owner = JSON.parse(readFileSync(join(lockPath, "owner.json"), "utf8"));
    const ownerAgeMs = Date.now() - Date.parse(owner.createdAt);
    const validPid = Number.isInteger(owner.pid) && owner.pid > 0;
    const hasHostname = typeof owner.hostname === "string" && owner.hostname.length > 0;
    const sameHost = hasHostname && owner.hostname === hostname();
    const deadLocalOwner = sameHost && validPid && !processIsAlive(owner.pid);
    const staleLegacyOwner =
      !hasHostname && Number.isFinite(ownerAgeMs) && ownerAgeMs > 300_000;
    const staleMalformedOwner =
      !validPid && Number.isFinite(ownerAgeMs) && ownerAgeMs > 300_000;
    if (deadLocalOwner || staleLegacyOwner || staleMalformedOwner) {
      rmSync(lockPath, { recursive: true, force: true });
      return true;
    }
    return false;
  } catch {
    let ageMs;
    try {
      ageMs = Date.now() - statSync(lockPath).mtimeMs;
    } catch {
      // The lock vanished while being inspected — another process released it
      // mid-check. Nothing to recover; the caller may retry immediately.
      return true;
    }
    if (ageMs < 30_000) return false;
    rmSync(lockPath, { recursive: true, force: true });
    return true;
  }
}

function processIsAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    return err.code === "EPERM";
  }
}

function recoverInterruptedWrites(repoRoot) {
  for (const dir of [tasksDir(repoRoot), archiveDir(repoRoot)]) {
    if (!existsSync(dir)) continue;
    const names = readdirSync(dir);
    for (const name of names) {
      const backupMatch = name.match(/^\.(task-\d+-.*\.md)\.([0-9a-f]+)\.bak$/);
      if (backupMatch) {
        const backupPath = join(dir, name);
        const tmpPath = join(dir, `.${backupMatch[2]}.tmp`);
        if (existsSync(tmpPath)) {
          copyFileSync(backupPath, join(dir, backupMatch[1]));
          rmSync(tmpPath, { force: true });
        }
        rmSync(backupPath, { force: true });
      }
    }
    for (const name of readdirSync(dir)) {
      if (/^\.[0-9a-f]+\.tmp$/.test(name)) {
        rmSync(join(dir, name), { force: true });
      }
    }
  }
}

export function readTaskFile(path) {
  const text = readFileSync(path, "utf8");
  const mtime = statSync(path).mtime;
  return { task: parseTaskFile(text), mtime };
}

export function writeTaskAtomic(path, text, expectedMtime) {
  const dir = dirname(path);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  const token = randomBytes(6).toString("hex");
  const tmp = join(dir, `.${token}.tmp`);
  let backup = null;
  writeFileSync(tmp, text);
  try {
    if (expectedMtime === null) {
      // Caller is creating a new file. Use linkSync for atomic create-or-fail
      // — fails with EEXIST if path already exists (another agent raced us
      // for the same id). This closes the parallel-`add` collision window
      // that a separate existsSync check would leave open.
      let linked = false;
      try {
        linkSync(tmp, path);
        linked = true;
      } catch (err) {
        if (err.code === "EEXIST") throw new ConflictError(path);
        if (!LINK_UNSUPPORTED.has(err.code)) throw err;
      }
      if (!linked) {
        // Filesystems without hard links (FAT/exFAT, some SMB/NFS shares and
        // container overlays) reject linkSync outright rather than with
        // EEXIST. The `wx` flag is the portable equivalent: atomic
        // create-or-EEXIST, so the same race guarantee still holds.
        try {
          writeFileSync(path, text, { flag: "wx" });
        } catch (err) {
          if (err.code === "EEXIST") throw new ConflictError(path);
          throw err;
        }
      }
      rmSync(tmp, { force: true });
      return;
    }
    if (!existsSync(path)) throw new ConflictError(path);
    const currentMtime = statSync(path).mtime;
    if (currentMtime.getTime() !== new Date(expectedMtime).getTime()) {
      throw new ConflictError(path);
    }
    // Keep the old file visible while installing the replacement. Readers and
    // writers share the repo lock; the backup lets stale-lock recovery roll
    // back a process death during the copy.
    backup = join(dir, `.${basename(path)}.${token}.bak`);
    copyFileSync(path, backup);
    try {
      copyFileSync(tmp, path);
    } catch (err) {
      if (existsSync(backup)) copyFileSync(backup, path);
      if (existsSync(backup)) rmSync(backup, { force: true });
      backup = null;
      throw err;
    }
    // Cleanup failure must not roll back a successfully installed task.
    try { rmSync(tmp, { force: true }); } catch {}
    try { rmSync(backup, { force: true }); } catch {}
    backup = null;
  } catch (err) {
    if (existsSync(tmp)) unlinkSync(tmp);
    if (backup && existsSync(backup)) {
      copyFileSync(backup, path);
      rmSync(backup, { force: true });
    }
    throw err;
  }
}

export function listTaskFiles(dir) {
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((name) => /^task-\d+-.*\.md$/.test(name))
    .sort()
    .map((name) => join(dir, name));
}

export class NotFoundError extends Error {
  constructor(id) {
    super(`task not found: ${id}`);
    this.name = "NotFoundError";
  }
}

export function nowIso() {
  return new Date().toISOString().replace(/\.\d{3}Z$/, "Z");
}

export function nextTaskId(allTasks) {
  let max = 0;
  for (const { task } of allTasks) {
    const m = String(task.frontmatter.id).match(/^task-(\d+)$/);
    if (!m) continue;
    const n = Number(m[1]);
    if (n > max) max = n;
  }
  const next = max + 1;
  const padded = next < 1000 ? String(next).padStart(3, "0") : String(next);
  return `task-${padded}`;
}

export function slugify(title) {
  const s = String(title ?? "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 50);
  return s || "untitled";
}

export function loadAllTasks(repoRoot) {
  const files = listTaskFiles(tasksDir(repoRoot));
  const out = files.map((path) => readTaskEntry(path, false));
  assertUniqueTaskIds(out);
  return out;
}

export function loadTaskContext(repoRoot) {
  const active = loadAllTasks(repoRoot);
  const archived = listTaskFiles(archiveDir(repoRoot)).map((path) => readTaskEntry(path, true));
  const context = [...archived, ...active];
  assertUniqueTaskIds(context);
  return context;
}

function readTaskEntry(path, archived) {
  try {
    const entry = { ...readTaskFile(path), path, ...(archived ? { archived: true } : {}) };
    const filenameId = basename(path).match(/^(task-\d+)-/)?.[1];
    if (filenameId !== entry.task.frontmatter.id) {
      throw new Error(`filename id ${filenameId ?? "(missing)"} does not match ${entry.task.frontmatter.id}`);
    }
    return entry;
  } catch (err) {
    throw new Error(`could not parse ${path}: ${err.message}`);
  }
}

function assertUniqueTaskIds(entries) {
  const seen = new Map();
  for (const entry of entries) {
    const id = entry.task.frontmatter.id;
    if (seen.has(id)) {
      throw new Error(`duplicate task id ${id}: ${seen.get(id)} and ${entry.path}`);
    }
    seen.set(id, entry.path);
  }
}

export function findTaskById(repoRoot, id) {
  const all = loadAllTasks(repoRoot);
  const found = all.find((t) => t.task.frontmatter.id === id);
  if (!found) throw new NotFoundError(id);
  return found;
}

export function assertNoCycle(allTasks, id, newBlockedBy) {
  if (newBlockedBy.includes(id)) {
    throw new Error(`cycle: ${id} cannot block itself`);
  }
  const map = new Map();
  for (const { task } of allTasks) {
    map.set(task.frontmatter.id, task.frontmatter.blockedBy ?? []);
  }
  map.set(id, newBlockedBy);
  // DFS for a cycle starting at id. `cleared` memoizes fully-explored nodes:
  // without it, a diamond-shaped dependency graph re-walks shared subtrees
  // once per path into them, which is exponential in the worst case.
  const visiting = new Set();
  const cleared = new Set();
  function visit(node) {
    if (cleared.has(node)) return;
    if (visiting.has(node)) {
      throw new Error(`cycle detected via ${node}`);
    }
    visiting.add(node);
    for (const dep of map.get(node) ?? []) {
      visit(dep);
    }
    visiting.delete(node);
    cleared.add(node);
  }
  visit(id);
}

// Build the id→state index once when resolving blockers for many tasks;
// `unmetBlockers` rebuilds it per call, which is quadratic over a whole board.
export function blockerStateIndex(allTasks) {
  const stateById = new Map();
  for (const { task: t } of allTasks) {
    stateById.set(t.frontmatter.id, {
      status: t.frontmatter.status,
      deleted: (t.frontmatter.tags ?? []).includes("deleted:true"),
    });
  }
  return stateById;
}

export function unmetBlockersFor(stateById, task) {
  return (task.frontmatter.blockedBy ?? []).filter((id) => {
    const state = stateById.get(id);
    return !state || state.status !== "done" || state.deleted;
  });
}

export function unmetBlockers(allTasks, task) {
  return unmetBlockersFor(blockerStateIndex(allTasks), task);
}

export const PRIORITY_RANK = { p0: 0, p1: 1, p2: 2, p3: 3 };

export function compareTaskIds(a, b) {
  const na = Number(String(a).match(/^task-(\d+)$/)?.[1] ?? Number.MAX_SAFE_INTEGER);
  const nb = Number(String(b).match(/^task-(\d+)$/)?.[1] ?? Number.MAX_SAFE_INTEGER);
  return na - nb || String(a).localeCompare(String(b));
}

// Statuses an agent can legitimately pick up. `backlog` is filed-but-
// not-yet-triaged work; `ready` is triaged. Both are surfaced so work does
// not stall merely because no collaborator promoted a valid unblocked card.
const CLAIMABLE_STATUSES = new Set(["ready", "backlog"]);

export function claimableTasks(allTasks) {
  return allTasks
    .filter(({ task }) => CLAIMABLE_STATUSES.has(task.frontmatter.status))
    .filter(({ task }) => unmetBlockers(allTasks, task).length === 0)
    .sort((a, b) => {
      const pa = PRIORITY_RANK[a.task.frontmatter.priority] ?? 9;
      const pb = PRIORITY_RANK[b.task.frontmatter.priority] ?? 9;
      if (pa !== pb) return pa - pb;
      // Within a priority bucket, prefer ready over backlog -- if the
      // operator bothered to triage, that's a real preference signal.
      const sa = a.task.frontmatter.status === "ready" ? 0 : 1;
      const sb = b.task.frontmatter.status === "ready" ? 0 : 1;
      if (sa !== sb) return sa - sb;
      return compareTaskIds(a.task.frontmatter.id, b.task.frontmatter.id);
    });
}

export function appendLog(currentLog, message) {
  const ts = nowIso();
  const cur = (currentLog ?? "").trimEnd();
  const sep = cur ? "\n" : "";
  return `${cur}${sep}- ${ts} — ${message}\n`;
}
