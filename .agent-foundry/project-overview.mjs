#!/usr/bin/env node

import {
  existsSync,
  lstatSync,
  mkdirSync,
  realpathSync,
  writeFileSync,
} from "node:fs";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { collectProjectStatus, trackerApi } from "./project-status.mjs";

const { findRepoRoot } = trackerApi;
const OUTPUT_RELATIVE = ".agent-foundry/project-overview.html";

export function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function present(value, fallback = "Unknown") {
  const text = String(value ?? "").replace(/\s+/gu, " ").trim();
  return text || fallback;
}

function tone(value) {
  if (["PASS", "clean", "current", "set"].includes(value)) return "good";
  if (["FAIL", "blocked", "stale", "invalid"].includes(value)) return "bad";
  return "neutral";
}

function taskCard(task, label = null) {
  if (!task) return '<p class="empty">Nothing queued.</p>';
  return `<article class="task-card">
    ${label ? `<span class="task-state">${escapeHtml(label)}</span>` : ""}
    <strong>${escapeHtml(task.title)}</strong>
    <span class="task-id">${escapeHtml(task.id)}</span>
  </article>`;
}

function taskGroup(tasks, emptyText) {
  return tasks.length > 0
    ? tasks.map((task) => taskCard(task, task.status?.replaceAll("_", " "))).join("")
    : `<p class="empty">${escapeHtml(emptyText)}</p>`;
}

function count(status, key) {
  if (status.since.firstLook || status.since.markerStatus === "invalid") return "—";
  if (key === "commits") {
    return Number.isInteger(status.since.commits?.count) ? status.since.commits.count : "?";
  }
  if (key === "changedTasks") {
    return Array.isArray(status.since.changedTasks) && Array.isArray(status.since.removedTaskIds)
      ? status.since.changedTasks.length + status.since.removedTaskIds.length
      : "?";
  }
  return Array.isArray(status.since[key]) ? status.since[key].length : "?";
}

function progress(status) {
  const value = status.milestone.progress;
  if (!value?.total) return { percent: 0, label: "Unknown", detail: "No reliable task set" };
  const percent = Math.max(0, Math.min(100, Math.round((value.done / value.total) * 100)));
  return {
    percent,
    label: `${value.done}/${value.total}`,
    detail: value.journalCovered ? "milestone tasks done" : "journal mismatch",
  };
}

function validationLabel(status) {
  const latest = status.validation.latest;
  if (!latest) return { state: "UNKNOWN", command: "No recorded check", when: "No evidence" };
  return {
    state: latest.exitCode === 0 ? "PASS" : "FAIL",
    command: present(latest.command),
    when: present(latest.startedAt),
  };
}

function gitLabel(status) {
  if (!status.git.available || status.git.dirty === null) {
    return { state: "UNKNOWN", detail: present(status.git.error, "Git evidence unavailable") };
  }
  return {
    state: status.git.dirty ? "CHANGED" : "CLEAN",
    detail: status.git.dirty
      ? `${status.git.changeCount} changed path${status.git.changeCount === 1 ? "" : "s"}`
      : "Working tree is clean",
  };
}

function detailList(tasks, emptyText = "None") {
  if (!tasks?.length) return `<li>${escapeHtml(emptyText)}</li>`;
  return tasks.map((task) => (
    `<li><strong>${escapeHtml(task.id)}</strong> — ${escapeHtml(task.title)} <span>${escapeHtml(task.status)}</span></li>`
  )).join("");
}

function renderTaskDetails(status, validation) {
  const latest = status.validation.latest;
  const validationDetail = latest
    ? `<ul>
        <li><strong>Result:</strong> ${escapeHtml(validation.state)}</li>
        <li><strong>Command:</strong> <code>${escapeHtml(latest.command)}</code></li>
        <li><strong>Task:</strong> ${escapeHtml(latest.taskId)}</li>
        <li><strong>Started:</strong> ${escapeHtml(latest.startedAt)}</li>
        <li><strong>Recorded:</strong> ${escapeHtml(latest.recordedAt)}</li>
        <li><strong>Duration:</strong> ${escapeHtml(latest.durationSeconds)}s</li>
        <li><strong>Exit code:</strong> ${escapeHtml(latest.exitCode)}</li>
      </ul>`
    : "<p>No recorded validation evidence.</p>";
  return `<details>
    <summary>Task and validation detail</summary>
    <div class="detail-body">
      <h3>Latest recorded check</h3>${validationDetail}
      <h3>In progress</h3><ul>${detailList(status.work.inProgress)}</ul>
      <h3>In review</h3><ul>${detailList(status.work.review)}</ul>
      <h3>Next</h3><ul>${detailList(status.work.next ? [status.work.next] : [])}</ul>
      <h3>Later preview</h3><ul>${detailList(status.work.later ?? [])}</ul>
      <h3>Blocked</h3><ul>${detailList(status.work.blocked)}</ul>
      <h3>Needs operator</h3><ul>${detailList(status.work.needsOperator)}</ul>
      <h3>Recent completed</h3><ul>${detailList(status.work.recentCompleted)}</ul>
    </div>
  </details>`;
}

function renderGitDetails(status, changes, commitItems, removedTaskIds, warnings) {
  const changedPaths = changes.length
    ? changes.map((change) => (
        `<li><code>${escapeHtml(change.status)}</code> ${escapeHtml(change.path)}${change.originalPath ? ` <span>(from ${escapeHtml(change.originalPath)})</span>` : ""}</li>`
      )).join("")
    : "<li>None</li>";
  const commits = commitItems.length
    ? commitItems.map((item) => (
        `<li><code>${escapeHtml(item.commit?.slice(0, 8))}</code> ${escapeHtml(item.subject)}</li>`
      )).join("")
    : `<li>${status.since.firstLook ? "No comparison marker yet." : status.since.commits === null ? "Unavailable — Git could not compare the marker." : "None"}</li>`;
  return `<details>
    <summary>Git changes and warnings</summary>
    <div class="detail-body">
      <h3>Changed paths</h3><ul>${changedPaths}${status.git.changesTruncated ? "<li><strong>More changed paths exist; this list is capped at 100.</strong></li>" : ""}</ul>
      <h3>Commits since last look</h3><ul>${commits}${status.since.commits?.truncated ? "<li><strong>More commits exist; this detail list is capped at 20.</strong></li>" : ""}</ul>
      <h3>Removed tasks</h3><ul>${removedTaskIds.length ? removedTaskIds.map((id) => `<li>${escapeHtml(id)}</li>`).join("") : "<li>None</li>"}</ul>
      <h3>Warnings</h3><ul>${warnings.length ? warnings.map((warning) => `<li>${escapeHtml(warning)}</li>`).join("") : "<li>None</li>"}</ul>
    </div>
  </details>`;
}

export function renderProjectOverview(status) {
  if (status.schemaVersion !== 1) {
    throw new Error(`unsupported project-status schemaVersion: ${status.schemaVersion}`);
  }
  const meter = progress(status);
  const validation = validationLabel(status);
  const git = gitLabel(status);
  const now = [
    ...status.work.inProgress.map((task) => ({ ...task, status: "in progress" })),
    ...status.work.review.map((task) => ({ ...task, status: "in review" })),
  ];
  const sinceLabel = status.since.markerStatus === "invalid"
    ? "Comparison marker needs repair"
    : status.since.firstLook
      ? "First look — mark it seen after reading"
      : status.since.commits === null
        ? "Marker exists, but Git could not compare it"
        : `Compared with ${present(status.since.marker?.seenAt)}`;
  const freshness = String(status.milestone.freshness ?? "unknown").toUpperCase();
  const warnings = status.warnings ?? [];
  const changes = status.git.changes ?? [];
  const commitItems = status.since.commits?.items ?? [];
  const removedTaskIds = status.since.removedTaskIds ?? [];
  const hasDirection = String(status.milestone.goal ?? "").trim().length > 0;
  const taskDetails = renderTaskDetails(status, validation);
  const gitDetails = renderGitDetails(status, changes, commitItems, removedTaskIds, warnings);

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${escapeHtml(status.project.name)} — Project overview</title>
  <style>
    :root { --paper:#f3efe5; --card:#fffdf8; --ink:#17313a; --muted:#66777b; --line:#d9d4c8; --orange:#e9673f; --teal:#167b75; --amber:#d29a2e; --red:#b84d46; --shadow:0 14px 40px rgba(23,49,58,.08); }
    * { box-sizing:border-box; }
    body { margin:0; color:var(--ink); background:radial-gradient(circle at 90% 0,#d9ebe4 0,transparent 28rem),var(--paper); font:15px/1.4 Inter,ui-sans-serif,system-ui,-apple-system,"Segoe UI",sans-serif; }
    .shell { width:min(1440px,calc(100% - 40px)); margin:0 auto; padding:18px 0 48px; }
    .topbar { min-height:54px; display:flex; align-items:center; justify-content:space-between; gap:18px; border-bottom:1px solid var(--line); }
    .brand { display:flex; align-items:center; gap:12px; min-width:0; }
    .brand-mark { width:34px; height:34px; border-radius:11px; background:var(--ink); color:white; display:grid; place-items:center; font-weight:850; }
    .brand-copy { min-width:0; overflow:hidden; }
    .brand strong,.brand span { display:block; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
    .brand span,.top-meta,.eyebrow,.micro { color:var(--muted); font-size:12px; }
    .top-meta { min-width:0; text-align:right; overflow-wrap:anywhere; }
    .hero { margin-top:16px; display:grid; grid-template-columns:minmax(0,1fr) 220px; gap:16px; }
    .panel { background:rgba(255,253,248,.92); border:1px solid rgba(217,212,200,.9); border-radius:20px; box-shadow:var(--shadow); }
    .goal { min-height:210px; padding:26px 28px; position:relative; overflow:hidden; }
    .goal:after { content:""; position:absolute; width:180px; height:180px; border:36px solid rgba(233,103,63,.09); border-radius:50%; right:-82px; bottom:-105px; }
    .eyebrow { letter-spacing:.15em; text-transform:uppercase; font-weight:800; }
    h1 { max-width:970px; margin:10px 0 12px; font:750 clamp(27px,3vw,47px)/1.04 Georgia,serif; letter-spacing:-.025em; overflow-wrap:anywhere; }
    .finish { max-width:950px; margin:0; color:#425b61; font-size:16px; overflow-wrap:anywhere; }
    .direction-help { margin:10px 0 0; color:#943d36; font-size:12px; font-weight:700; }
    .chips { display:flex; flex-wrap:wrap; gap:8px; margin-top:20px; }
    .chip { padding:6px 10px; border-radius:999px; background:#edf0eb; font-size:11px; font-weight:800; letter-spacing:.05em; text-transform:uppercase; }
    .chip.good { color:#0c655f; background:#dbefea; } .chip.bad { color:#943d36; background:#f6dfda; }
    .meter { min-height:210px; padding:22px; display:grid; place-items:center; text-align:center; }
    .ring { --p:0%; width:118px; aspect-ratio:1; border-radius:50%; display:grid; place-items:center; background:conic-gradient(var(--orange) var(--p),#e5e0d6 0); position:relative; }
    .ring:before { content:""; position:absolute; inset:12px; border-radius:50%; background:var(--card); }
    .ring strong { position:relative; font-size:25px; } .meter p { margin:9px 0 0; color:var(--muted); font-size:12px; }
    .signals { display:grid; grid-template-columns:repeat(4,1fr); gap:12px; margin-top:12px; }
    .signal { padding:14px 17px; min-height:84px; }
    .signal strong { display:block; font-size:27px; line-height:1; margin-bottom:7px; }
    .signal span { color:var(--muted); font-size:12px; }
    .comparison { grid-column:1/-1; margin:7px 2px 0; color:var(--muted); font-size:11px; }
    .warning-banner { margin-top:12px; padding:10px 14px; border:1px solid #e4ba67; border-radius:12px; background:#fff3d8; color:#7d5717; font-size:12px; }
    .flow { margin-top:12px; padding:20px; }
    .section-head { display:flex; justify-content:space-between; align-items:baseline; gap:12px; margin-bottom:13px; }
    h2 { margin:0; font-size:17px; } .section-head span { color:var(--muted); font-size:12px; }
    .flow-grid { display:grid; grid-template-columns:1.15fr 1fr 1fr; gap:12px; }
    .lane { min-width:0; min-height:142px; border:1px solid var(--line); border-radius:15px; padding:14px; background:#faf8f1; }
    .lane h3 { margin:0 0 10px; font-size:11px; text-transform:uppercase; letter-spacing:.13em; color:var(--muted); }
    .lane.now { border-top:4px solid var(--orange); } .lane.next { border-top:4px solid var(--teal); } .lane.later { border-top:4px solid #94a3a4; }
    .task-card { display:grid; grid-template-columns:1fr auto; gap:3px 10px; padding:9px 0; border-top:1px solid #e5e0d6; }
    .task-card:first-of-type { border-top:0; padding-top:0; }
    .task-card strong { min-width:0; font-size:13px; overflow-wrap:anywhere; } .task-id { color:var(--muted); font:10px ui-monospace,monospace; }
    .task-state { grid-column:1/-1; color:var(--orange); font-size:9px; font-weight:850; letter-spacing:.1em; text-transform:uppercase; }
    .empty { color:var(--muted); font-size:12px; margin:8px 0; }
    .lane-note { margin:7px 0 0; color:var(--muted); font-size:10px; font-weight:700; }
    .lower { display:grid; grid-template-columns:1.05fr 1fr 1.25fr; gap:12px; margin-top:12px; }
    .lower .panel { min-height:142px; padding:17px; box-shadow:none; }
    .attention { border-left:5px solid var(--amber); } .attention.clear { border-left-color:var(--teal); }
    .attention strong { display:block; margin:12px 0 3px; font-size:16px; }
    .evidence-grid { display:grid; grid-template-columns:1fr 1fr; gap:10px; margin-top:12px; }
    .evidence-item { padding:10px; border-radius:12px; background:#f4f1e8; }
    .state { display:block; font-size:10px; font-weight:900; letter-spacing:.11em; }
    .state.good { color:var(--teal); } .state.bad { color:var(--red); } .state.neutral { color:var(--muted); }
    .evidence-item strong { display:block; margin:4px 0; font-size:12px; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
    .recent-list { margin:10px 0 0; padding:0; list-style:none; }
    .recent-list li { display:flex; justify-content:space-between; gap:10px; padding:6px 0; border-top:1px solid #e5e0d6; font-size:12px; }
    .recent-list li:first-child { border-top:0; } .recent-list span { color:var(--muted); white-space:nowrap; }
    .recent-list li strong { min-width:0; overflow-wrap:anywhere; }
    .details { margin-top:12px; }
    details { background:rgba(255,253,248,.75); border:1px solid var(--line); border-radius:13px; margin-top:8px; }
    summary { cursor:pointer; padding:12px 15px; font-weight:750; font-size:12px; }
    .detail-body { padding:0 16px 14px; color:#425b61; font-size:12px; }
    .detail-body ul { margin:4px 0; padding-left:18px; } .detail-body li { margin:5px 0; overflow-wrap:anywhere; }
    footer { margin-top:16px; color:var(--muted); font-size:11px; display:flex; justify-content:space-between; gap:16px; }
    code { font-family:ui-monospace,"Cascadia Code",monospace; font-size:.95em; }
    @media (max-width:900px) { .hero { grid-template-columns:1fr; } .meter { min-height:150px; grid-template-columns:auto 1fr; gap:22px; } .signals { grid-template-columns:1fr 1fr; } .flow-grid,.lower { grid-template-columns:1fr; } }
    @media (max-width:560px) { .shell { width:min(100% - 22px,1440px); padding-top:8px; } .topbar { align-items:flex-start; } .top-meta { max-width:135px; } .goal { padding:21px; } .signals { grid-template-columns:1fr 1fr; } .signal { min-height:75px; } .flow { padding:14px; } footer { display:block; } }
    @media print { body { background:white; } .shell { width:100%; } .panel { box-shadow:none; } details { display:none; } }
  </style>
</head>
<body>
  <div class="shell">
    <header class="topbar">
      <div class="brand"><div class="brand-mark">AF</div><div class="brand-copy"><strong>${escapeHtml(present(status.project.name))}</strong><span>${escapeHtml(present(status.project.description, "Project operator view"))}</span></div></div>
      <div class="top-meta"><strong>${escapeHtml(present(status.git.branch))}@${escapeHtml(present(status.git.shortHead, "no commit"))}</strong><br>Generated ${escapeHtml(present(status.generatedAt))}</div>
    </header>

    <main>
      <section class="hero">
        <article class="panel goal">
          <span class="eyebrow">Current approved direction</span>
          <h1>${escapeHtml(present(status.milestone.goal))}</h1>
          <p class="finish"><strong>Finish line:</strong> ${escapeHtml(present(status.milestone.doneWhen))}</p>
          ${hasDirection ? "" : '<p class="direction-help">Set the approved direction with the plan-milestone workflow.</p>'}
          <div class="chips">
            <span class="chip ${tone(status.milestone.freshness)}">${escapeHtml(freshness)}${status.milestone.ageDays == null ? "" : ` · ${escapeHtml(status.milestone.ageDays)}d old`}</span>
            <span class="chip">${escapeHtml(present(status.milestone.name, "No milestone"))}</span>
            ${status.milestone.progress?.journalCovered === false ? '<span class="chip bad">Journal mismatch</span>' : ""}
          </div>
        </article>
        <aside class="panel meter">
          <div class="ring" style="--p:${meter.percent}%"><strong>${escapeHtml(meter.label)}</strong></div>
          <div><span class="eyebrow">Milestone</span><p>${escapeHtml(meter.detail)}</p></div>
        </aside>
      </section>

      <section class="signals" aria-label="Changes since last look">
        <article class="panel signal"><strong>${escapeHtml(count(status, "commits"))}</strong><span>commits</span></article>
        <article class="panel signal"><strong>${escapeHtml(count(status, "changedTasks"))}</strong><span>task changes</span></article>
        <article class="panel signal"><strong>${escapeHtml(count(status, "completed"))}</strong><span>completed</span></article>
        <article class="panel signal"><strong>${escapeHtml(count(status, "needsOperator"))}</strong><span>operator changes</span></article>
        <p class="comparison">Since last look · ${escapeHtml(sinceLabel)}</p>
      </section>

      ${warnings.length ? `<div class="warning-banner"><strong>Evidence warning:</strong> ${escapeHtml(warnings.join("; "))}</div>` : ""}

      <section class="panel flow">
        <div class="section-head"><h2>Work flow</h2><span>Outcome sequence, not a board copy</span></div>
        <div class="flow-grid">
          <div class="lane now"><h3>Now</h3>${taskGroup(now.slice(0, 3), "No work is actively moving.")}${now.length > 3 ? `<p class="lane-note">+${escapeHtml(now.length - 3)} more active — expand details below</p>` : ""}</div>
          <div class="lane next"><h3>Next</h3>${taskCard(status.work.next)}</div>
          <div class="lane later"><h3>Later</h3>${taskGroup(status.work.later ?? [], "No other eligible work.")}${status.work.laterTruncated ? `<p class="lane-note">Showing 3 of ${escapeHtml(status.work.laterCount)} eligible tasks</p>` : ""}</div>
        </div>
      </section>

      <section class="lower">
        <article class="panel attention ${status.work.needsOperator.length === 0 ? "clear" : ""}">
          <span class="eyebrow">Needs you</span>
          <strong>${status.work.needsOperator.length === 0 ? "Nothing waiting on you" : `${status.work.needsOperator.length} decision${status.work.needsOperator.length === 1 ? "" : "s"}`}</strong>
          <span class="micro">${escapeHtml(status.work.needsOperator[0]?.title ?? "Agents can continue without operator input.")}</span>
        </article>
        <article class="panel">
          <span class="eyebrow">Verified evidence</span>
          <div class="evidence-grid">
            <div class="evidence-item"><span class="state ${tone(validation.state)}">${escapeHtml(validation.state)}</span><strong>${escapeHtml(validation.command)}</strong><span class="micro">${escapeHtml(validation.when)}</span></div>
            <div class="evidence-item"><span class="state ${tone(git.state.toLowerCase())}">${escapeHtml(git.state)}</span><strong>${escapeHtml(git.detail)}</strong><span class="micro">Git working state</span></div>
          </div>
        </article>
        <article class="panel">
          <span class="eyebrow">Recent outcomes</span>
          <ul class="recent-list">${status.work.recentCompleted.slice(0, 3).map((task) => `<li><strong>${escapeHtml(task.title)}</strong><span>${escapeHtml(task.id)}</span></li>`).join("") || "<li>No recorded outcomes</li>"}</ul>
        </article>
      </section>

      <section class="details" aria-label="Drill-down details">
        ${taskDetails}
        ${gitDetails}
      </section>
    </main>

    <footer><span>Refresh with <code>node .agent-foundry/project-overview.mjs</code></span><span>Generated from project truth · not an editable task board</span></footer>
  </div>
</body>
</html>
`;
}

export function writeProjectOverview(root, status = collectProjectStatus(root)) {
  const output = join(resolve(root), ...OUTPUT_RELATIVE.split("/"));
  const outputDirectory = dirname(output);
  if (existsSync(outputDirectory) && lstatSync(outputDirectory).isSymbolicLink()) {
    throw new Error("refusing to write through symlinked .agent-foundry directory");
  }
  mkdirSync(outputDirectory, { recursive: true });
  if (existsSync(output) && lstatSync(output).isSymbolicLink()) {
    throw new Error("refusing to overwrite symlinked project overview");
  }
  const fromRoot = relative(realpathSync(root), realpathSync(outputDirectory));
  if (fromRoot === ".." || fromRoot.startsWith(`..${sep}`) || isAbsolute(fromRoot)) {
    throw new Error("project overview output resolves outside the repository");
  }
  writeFileSync(output, renderProjectOverview(status), "utf8");
  return output;
}

function usage() {
  return "Usage: node .agent-foundry/project-overview.mjs [--stdout] [--help]\n";
}

function main(args) {
  let stdout = false;
  for (const arg of args) {
    if (arg === "--stdout") stdout = true;
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
    if (stdout) {
      process.stdout.write(renderProjectOverview(status));
      return;
    }
    const output = writeProjectOverview(root, status);
    process.stdout.write(`Project overview updated: ${output}\n`);
  } catch (error) {
    process.stderr.write(`error: ${error.message}\n`);
    process.exitCode = 1;
  }
}

const thisFile = fileURLToPath(import.meta.url);
if (process.argv[1] && resolve(process.argv[1]) === thisFile) {
  main(process.argv.slice(2));
}
