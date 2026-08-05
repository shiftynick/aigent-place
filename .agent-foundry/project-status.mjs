#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import {
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  realpathSync,
  writeFileSync,
} from "node:fs";
import {
  basename,
  dirname,
  isAbsolute,
  join,
  relative,
  resolve,
} from "node:path";
import { fileURLToPath } from "node:url";

export async function loadTrackerApi(options = {}) {
  const candidates = options.candidates ?? [
    "../.agents/skills/task-tracker/scripts/_lib.mjs",
    "../.claude/skills/task-tracker/scripts/_lib.mjs",
  ];
  const fileExists = options.fileExists ?? existsSync;
  const importer = options.importer ?? ((url) => import(url));
  for (const candidate of candidates) {
    const url = new URL(candidate, import.meta.url);
    if (fileExists(fileURLToPath(url))) return importer(url);
  }
  throw new Error("task-tracker library is missing from both harness trees");
}

export const trackerApi = await loadTrackerApi();
const {
  blockerStateIndex,
  claimableTasks,
  findRepoRoot,
  loadTaskContext,
  parseRunEvidenceLog,
  unmetBlockersFor,
} = trackerApi;

const STALE_PLAN_DAYS = 30;
const MARKER_RELATIVE = ".agent-foundry/project-status-seen.json";

function runGit(root, args) {
  const result = spawnSync("git", args, {
    cwd: root,
    encoding: "utf8",
    windowsHide: true,
  });
  if (result.error || result.status !== 0) {
    return {
      ok: false,
      stdout: "",
      error: result.error?.message ?? compact(result.stderr) ?? `exit ${result.status}`,
    };
  }
  return { ok: true, stdout: result.stdout.trim(), error: null };
}

function compact(value) {
  return String(value ?? "").replace(/\s+/gu, " ").trim();
}

function parseField(section, label) {
  const lines = section.split(/\r?\n/u);
  const fieldPattern = new RegExp(
    `^\\s*(?:[-*]\\s+)?(?:\\*\\*)?${label}:(?:\\*\\*)?\\s*(.*)$`,
    "iu",
  );
  const start = lines.findIndex((line) => fieldPattern.test(line));
  if (start < 0) return null;
  const parts = [lines[start].match(fieldPattern)[1].trim()];
  for (let index = start + 1; index < lines.length; index++) {
    const line = lines[index];
    if (
      line.trim() === ""
      || /^\s*(?:[-*]\s+)?(?:\*\*)?(?:Goal|Done when|Approved front|Assumptions):(?:\*\*)?/iu.test(line)
    ) break;
    parts.push(line.trim());
  }
  return compact(parts.join(" ")) || null;
}

function validDateOnly(value) {
  const date = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

export function parsePlanningJournal(text, now = new Date()) {
  const headings = [...String(text ?? "").matchAll(
    /^##\s+(\d{4}-\d{2}-\d{2})\s+[—-]\s+(.+)$/gmu,
  )];
  if (headings.length === 0) return null;
  const latest = headings
    .map((match, index) => ({ match, index }))
    .sort((a, b) => a.match[1].localeCompare(b.match[1]) || a.index - b.index)
    .at(-1).match;
  const sectionStart = latest.index + latest[0].length;
  const nextHeading = String(text).slice(sectionStart).search(/^##\s+/mu);
  const sectionEnd = nextHeading < 0 ? String(text).length : sectionStart + nextHeading;
  const section = String(text).slice(sectionStart, sectionEnd);
  const lines = section.split(/\r?\n/u);
  const frontStart = lines.findIndex((line) => /^\s*Approved front:\s*$/iu.test(line));
  const remainingFront = frontStart < 0 ? [] : lines.slice(frontStart + 1);
  const frontEnd = remainingFront.findIndex((line) => /^\s*Assumptions:\s*/iu.test(line));
  const frontLines = frontEnd < 0 ? remainingFront : remainingFront.slice(0, frontEnd);
  const taskIds = [...new Set(frontLines
    .filter((line) => /^\s*(?:\d+[.)]|[-*])\s+/u.test(line))
    .flatMap((line) => line.match(/\btask-\d{3,}\b/gu) ?? []))];
  const plannedAt = latest[1];
  const dateValid = validDateOnly(plannedAt);
  const ageDays = dateValid
    ? Math.max(
        0,
        Math.floor((now.getTime() - new Date(`${plannedAt}T00:00:00Z`).getTime()) / 86_400_000),
      )
    : null;
  return {
    name: compact(latest[2]),
    plannedAt,
    ageDays,
    freshness: ageDays === null ? "unknown" : (ageDays > STALE_PLAN_DAYS ? "stale" : "current"),
    goal: parseField(section, "Goal"),
    doneWhen: parseField(section, "Done when"),
    taskIds,
  };
}

function parseMetadata(root) {
  const path = join(root, ".agent-foundry.json");
  if (!existsSync(path)) return { value: {}, error: null };
  try {
    return { value: JSON.parse(readFileSync(path, "utf8")), error: null };
  } catch (error) {
    return { value: {}, error: `cannot read .agent-foundry.json: ${error.message}` };
  }
}

function taskView(entry, stateById) {
  const fm = entry.task.frontmatter;
  return {
    id: fm.id,
    title: fm.title,
    status: fm.status,
    priority: fm.priority,
    tags: fm.tags ?? [],
    blockedBy: fm.blockedBy ?? [],
    unmetBlockers: unmetBlockersFor(stateById, entry.task),
    createdAt: fm.createdAt,
    updatedAt: fm.updatedAt,
    ...(fm.claimedBy ? { claimedBy: fm.claimedBy } : {}),
    archived: Boolean(entry.archived),
  };
}

export function parseRunEvidence(entries) {
  const results = entries.flatMap((entry) => (
    parseRunEvidenceLog(entry.task.log, entry.task.frontmatter.id)
  ));
  return results.sort((a, b) => b.startedAt.localeCompare(a.startedAt));
}

function readSeenMarker(root) {
  const path = join(root, ...MARKER_RELATIVE.split("/"));
  if (!existsSync(path)) return { value: null, error: null };
  try {
    const parsed = JSON.parse(readFileSync(path, "utf8"));
    if (parsed.schemaVersion !== 1) {
      return { value: null, error: "project-status marker has an unsupported schemaVersion" };
    }
    if (typeof parsed.seenAt !== "string" || Number.isNaN(Date.parse(parsed.seenAt))) {
      return { value: null, error: "project-status marker has an invalid seenAt" };
    }
    if (parsed.head !== null && !/^(?:[0-9a-f]{40}|[0-9a-f]{64})$/u.test(parsed.head)) {
      return { value: null, error: "project-status marker has an invalid Git head" };
    }
    if (
      parsed.taskVersions === null
      || typeof parsed.taskVersions !== "object"
      || Array.isArray(parsed.taskVersions)
      || Object.entries(parsed.taskVersions).some(([id, value]) => (
        !/^task-\d{3,}$/u.test(id)
        || typeof value !== "string"
        || Number.isNaN(Date.parse(value))
      ))
    ) {
      return { value: null, error: "project-status marker has invalid taskVersions" };
    }
    return {
      value: {
        seenAt: parsed.seenAt,
        head: parsed.head,
        taskVersions: parsed.taskVersions,
      },
      error: null,
    };
  } catch (error) {
    return { value: null, error: `cannot read project-status marker: ${error.message}` };
  }
}

function assertSafeMarkerDirectory(root, path) {
  const directory = dirname(path);
  if (existsSync(directory) && lstatSync(directory).isSymbolicLink()) {
    throw new Error("refusing to write through symlinked .agent-foundry directory");
  }
  mkdirSync(directory, { recursive: true });
  if (existsSync(path) && lstatSync(path).isSymbolicLink()) {
    throw new Error("refusing to overwrite symlinked project-status marker");
  }
  const realRoot = realpathSync(root);
  const realDirectory = realpathSync(directory);
  const fromRoot = relative(realRoot, realDirectory);
  if (fromRoot === ".." || fromRoot.startsWith(`..${process.platform === "win32" ? "\\" : "/"}`) || isAbsolute(fromRoot)) {
    throw new Error("project-status marker directory resolves outside the repository");
  }
}

export function markProjectStatusSeen(root, status, now = new Date()) {
  const path = join(root, ...MARKER_RELATIVE.split("/"));
  assertSafeMarkerDirectory(root, path);
  const marker = {
    schemaVersion: 1,
    seenAt: now.toISOString(),
    head: status.git.head,
    taskVersions: status.state.taskVersions,
  };
  writeFileSync(path, `${JSON.stringify(marker, null, 2)}\n`, "utf8");
  return marker;
}

function milestoneProgress(plan, tasks) {
  if (!plan) return null;
  const available = tasks.filter((entry) => !isDeleted(entry));
  const milestoneTag = `milestone:${plan.name}`;
  const tagged = available.filter((entry) => (
    (entry.task.frontmatter.tags ?? []).includes(milestoneTag)
  ));
  const journalIds = new Set(plan.taskIds);
  const journalTasks = available.filter((entry) => journalIds.has(entry.task.frontmatter.id));
  const matching = tagged.length > 0
    ? tagged
    : journalTasks.length === journalIds.size && journalIds.size > 0
      ? journalTasks
      : [];
  if (matching.length === 0) return null;
  return {
    total: matching.length,
    done: matching.filter((entry) => entry.task.frontmatter.status === "done").length,
    source: tagged.length > 0 ? "milestone-tag" : "approved-front",
    journalCovered: plan.taskIds.length > 0 && (
      tagged.length > 0
        ? plan.taskIds.every((id) => tagged.some((entry) => entry.task.frontmatter.id === id))
        : true
    ),
  };
}

function isDeleted(entry) {
  return (entry.task.frontmatter.tags ?? []).includes("deleted:true");
}

export function parseGitChanges(text) {
  if (!text) return [];
  const records = text.split("\0");
  const changes = [];
  for (let index = 0; index < records.length; index++) {
    const record = records[index];
    if (!record) continue;
    const status = record.slice(0, 2);
    const path = record.slice(3);
    if (/^[RC]/u.test(status)) {
      const originalPath = records[++index];
      changes.push({ status, path, originalPath });
    } else {
      changes.push({ status, path });
    }
  }
  return changes;
}

function commitsSinceMarker(gitCall, root, marker, head) {
  if (!marker) return null;
  if (!marker.head || !head) return null;
  if (marker.head === head) return { count: 0, items: [], truncated: false };
  const countResult = gitCall(root, ["rev-list", "--count", `${marker.head}..${head}`]);
  if (!countResult.ok || !/^\d+$/u.test(countResult.stdout)) return null;
  const count = Number(countResult.stdout);
  const logResult = gitCall(root, [
    "log",
    "--format=%H%x09%s",
    "--max-count=20",
    `${marker.head}..${head}`,
  ]);
  if (!logResult.ok) return null;
  const items = logResult.stdout.split(/\r?\n/u).filter(Boolean).map((line) => {
    const [commit, ...subject] = line.split("\t");
    return { commit, subject: subject.join("\t") };
  });
  return { count, items, truncated: count > items.length };
}

export function collectProjectStatus(root, options = {}) {
  const repoRoot = resolve(root);
  const now = options.now ?? new Date();
  const gitCall = options.git ?? runGit;
  const entries = loadTaskContext(repoRoot);
  const visibleEntries = entries.filter((entry) => !isDeleted(entry));
  const activeEntries = visibleEntries.filter((entry) => !entry.archived);
  const stateById = blockerStateIndex(entries);
  const view = (entry) => taskView(entry, stateById);
  const planPath = join(repoRoot, "PLANNING-JOURNAL.md");
  const plan = existsSync(planPath)
    ? parsePlanningJournal(readFileSync(planPath, "utf8"), now)
    : null;
  const markerResult = readSeenMarker(repoRoot);
  const marker = markerResult.value;
  const metadataResult = parseMetadata(repoRoot);
  const metadata = metadataResult.value;
  const statusResult = gitCall(repoRoot, ["status", "--porcelain=v1", "-z"]);
  const headResult = gitCall(repoRoot, ["rev-parse", "HEAD"]);
  const branchResult = gitCall(repoRoot, ["symbolic-ref", "--quiet", "--short", "HEAD"]);
  const head = headResult.ok ? headResult.stdout : null;
  const branch = branchResult.ok ? branchResult.stdout : (head ? "detached" : "unknown");
  const gitChanges = statusResult.ok ? parseGitChanges(statusResult.stdout) : null;
  const claimableEntries = claimableTasks(entries).filter((entry) => !entry.archived);
  const nextEntry = claimableEntries[0] ?? null;
  const operatorEntries = activeEntries.filter((entry) => (
    entry.task.frontmatter.status !== "done"
    && (entry.task.frontmatter.tags ?? []).includes("needs:operator")
  ));
  const blockedEntries = activeEntries.filter((entry) => (
    entry.task.frontmatter.status !== "done"
    && (
      entry.task.frontmatter.status === "blocked"
      || unmetBlockersFor(stateById, entry.task).length > 0
    )
  ));
  const completed = visibleEntries
    .filter((entry) => entry.task.frontmatter.status === "done")
    .sort((a, b) => b.task.frontmatter.updatedAt.localeCompare(a.task.frontmatter.updatedAt));
  const taskVersions = Object.fromEntries(visibleEntries.map((entry) => [
    entry.task.frontmatter.id,
    entry.task.frontmatter.updatedAt,
  ]));
  const changedSince = marker
    ? visibleEntries.filter((entry) => (
        marker.taskVersions[entry.task.frontmatter.id] !== entry.task.frontmatter.updatedAt
      ))
    : [];
  const removedTaskIds = marker
    ? Object.keys(marker.taskVersions).filter((id) => !(id in taskVersions))
    : [];
  const runs = parseRunEvidence(visibleEntries);
  const commitsSince = commitsSinceMarker(gitCall, repoRoot, marker, head);
  const gitError = statusResult.ok
    ? (headResult.ok ? null : `cannot read Git head: ${headResult.error}`)
    : statusResult.error;
  const warnings = [metadataResult.error, markerResult.error].filter(Boolean);

  return {
    schemaVersion: 1,
    generatedAt: now.toISOString(),
    project: {
      name: metadata.projectName ?? basename(repoRoot),
      description: metadata.projectDescription ?? null,
    },
    state: {
      taskVersions,
    },
    git: {
      available: statusResult.ok && headResult.ok,
      branch,
      head,
      shortHead: head?.slice(0, 8) ?? null,
      dirty: gitChanges === null ? null : gitChanges.length > 0,
      changeCount: gitChanges?.length ?? null,
      changes: gitChanges?.slice(0, 100) ?? null,
      changesTruncated: gitChanges != null && gitChanges.length > 100,
      error: gitError,
    },
    milestone: plan
      ? { ...plan, progress: milestoneProgress(plan, entries) }
      : {
          name: null,
          plannedAt: null,
          ageDays: null,
          freshness: "unknown",
          goal: null,
          doneWhen: null,
          taskIds: [],
          progress: null,
        },
    work: {
      inProgress: activeEntries.filter((entry) => entry.task.frontmatter.status === "in_progress").map(view),
      review: activeEntries.filter((entry) => entry.task.frontmatter.status === "review").map(view),
      next: nextEntry ? view(nextEntry) : null,
      later: claimableEntries.slice(1, 4).map(view),
      laterCount: Math.max(0, claimableEntries.length - 1),
      laterTruncated: claimableEntries.length > 4,
      blocked: blockedEntries.map(view),
      needsOperator: operatorEntries.map(view),
      recentCompleted: completed.slice(0, 5).map(view),
    },
    validation: {
      latest: runs[0] ?? null,
    },
    since: {
      marker,
      markerStatus: markerResult.error ? "invalid" : (marker ? "set" : "missing"),
      firstLook: marker === null && markerResult.error === null,
      commits: commitsSince,
      changedTasks: changedSince.map(view),
      removedTaskIds,
      completed: changedSince
        .filter((entry) => entry.task.frontmatter.status === "done")
        .map(view),
      needsOperator: changedSince
        .filter((entry) => operatorEntries.includes(entry))
        .map(view),
    },
    warnings,
  };
}

function age(iso, now) {
  if (!iso) return "unknown age";
  const timestamp = new Date(iso).getTime();
  if (Number.isNaN(timestamp)) return "unknown age";
  const seconds = Math.max(0, Math.floor((now.getTime() - timestamp) / 1000));
  if (seconds < 120) return "just now";
  if (seconds < 7200) return `${Math.floor(seconds / 60)}m ago`;
  if (seconds < 172800) return `${Math.floor(seconds / 3600)}h ago`;
  return `${Math.floor(seconds / 86400)}d ago`;
}

function clip(value, max = 150) {
  const text = compact(value) || "unknown";
  return text.length <= max ? text : `${text.slice(0, max - 1)}…`;
}

function clipOperatorField(value, max = 160) {
  const text = compact(value) || "unknown";
  return text.length <= max ? text : `${text.slice(0, max - 20)}... [full in --json]`;
}

function taskLabel(task) {
  return task ? `${task.id} ${task.title}` : "none";
}

function groupLabel(tasks) {
  if (tasks.length === 0) return "none";
  const first = taskLabel(tasks[0]);
  return tasks.length === 1 ? first : `${first} (+${tasks.length - 1} more)`;
}

export function formatProjectStatus(status) {
  const now = new Date(status.generatedAt);
  const progressLabel = status.milestone.progress?.total
    ? `; ${status.milestone.progress.done}/${status.milestone.progress.total} done${status.milestone.progress.journalCovered ? "" : ", journal mismatch"}`
    : "; progress unknown";
  const since = status.since.markerStatus === "invalid"
    ? "marker unreadable; run --mark-seen to replace it"
    : status.since.firstLook
      ? "no marker yet; use --mark-seen after reading"
      : `${status.since.commits?.count ?? "unknown"} commit(s), ${status.since.completed.length} completed, ${status.since.needsOperator.length} operator item change(s), ${status.since.changedTasks.length} task change(s), ${status.since.removedTaskIds.length} removed`;
  const latest = status.validation.latest;
  const gitLabel = !status.git.available || status.git.dirty === null
    ? `Git state unknown${status.git.error ? ` (${clip(status.git.error, 80)})` : ""}`
    : `${status.git.branch}@${status.git.shortHead ?? "no-commit"} — ${status.git.dirty ? `${status.git.changeCount} changed path(s)` : "clean"}`;
  const lines = [
    `${clip(status.project.name, 80)} — ${gitLabel}`,
    `Goal [${status.milestone.freshness}${status.milestone.ageDays == null ? "" : `, ${status.milestone.ageDays}d`}${progressLabel}]: ${clipOperatorField(status.milestone.goal)}`,
    `Finish: ${clipOperatorField(status.milestone.doneWhen)}`,
    `Since last look: ${since}`,
    `Now: ${clip(groupLabel(status.work.inProgress))}`,
    `In review: ${clip(groupLabel(status.work.review))}`,
    `Next: ${clip(taskLabel(status.work.next))}`,
    `Needs you: ${clip(groupLabel(status.work.needsOperator))}`,
    `Blocked: ${clip(groupLabel(status.work.blocked))}`,
    `Recently done: ${clip(groupLabel(status.work.recentCompleted))}`,
    `Last check: ${latest ? `${latest.exitCode === 0 ? "PASS" : "FAIL"} ${clip(latest.command, 100)} (${age(latest.startedAt, now)})` : "unknown"}`,
  ];
  if (status.warnings.length > 0) {
    lines.push(`Warnings: ${clip(status.warnings.join("; "), 140)}`);
  }
  return `${lines.join("\n")}\n`;
}

function usage() {
  return `Usage: node .agent-foundry/project-status.mjs [--json] [--mark-seen]\n\n`;
}

function main(args) {
  let json = false;
  let markSeen = false;
  for (const arg of args) {
    if (arg === "--json") json = true;
    else if (arg === "--mark-seen") markSeen = true;
    else if (arg === "--help") {
      process.stdout.write(usage());
      return;
    } else {
      process.stderr.write(`error: unknown argument: ${arg}\n`);
      process.exitCode = 2;
      return;
    }
  }
  const root = findRepoRoot();
  if (!root) {
    process.stderr.write("error: not inside a Git repository\n");
    process.exitCode = 1;
    return;
  }
  try {
    const status = collectProjectStatus(root);
    process.stdout.write(json ? `${JSON.stringify(status, null, 2)}\n` : formatProjectStatus(status));
    if (markSeen) markProjectStatusSeen(root, status);
  } catch (error) {
    process.stderr.write(`error: ${error.message}\n`);
    process.exitCode = 1;
  }
}

const thisFile = fileURLToPath(import.meta.url);
if (process.argv[1] && resolve(process.argv[1]) === thisFile) {
  main(process.argv.slice(2));
}
