#!/usr/bin/env node
// board-html.mjs — render the task board to a static, self-contained HTML
// snapshot. Zero-dep, read-only; the file-based board stays the source of
// truth. Usage:
//
//   node .claude/skills/task-tracker/scripts/board-html.mjs [--out <path>]
//
// Default output: .tasks/board.html (gitignored — it's a generated view).

import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { argv, exit, stderr, stdout } from "node:process";
import {
  blockerStateIndex,
  ConflictError,
  findRepoRoot,
  loadTaskContext,
  nowIso,
  PRIORITY_RANK,
  compareTaskIds,
  unmetBlockersFor,
  withRepoWriteLock,
} from "./_lib.mjs";

const COLUMNS = ["backlog", "ready", "in_progress", "review", "done", "blocked"];

function esc(s) {
  return String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function parseArgs(args) {
  const opts = { out: null };
  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--out") {
      const value = args[i + 1];
      if (!value || value.startsWith("--")) {
        stderr.write("error: --out requires a path\n");
        exit(2);
      }
      opts.out = value;
      i++;
    } else {
      stderr.write(`error: unknown argument: ${args[i]}\n`);
      exit(2);
    }
  }
  return opts;
}

function card(entry, blockerStates) {
  const fm = entry.task.frontmatter;
  const unmet = new Set(unmetBlockersFor(blockerStates, entry.task));
  const blockers = (fm.blockedBy ?? [])
    .map((b) =>
      unmet.has(b)
        ? `<span class="blocker unmet" title="blocker not done">${esc(b)}</span>`
        : `<span class="blocker met" title="blocker done">${esc(b)}</span>`
    )
    .join(" ");
  const tags = (fm.tags ?? [])
    .map((t) => `<span class="tag">${esc(t)}</span>`)
    .join(" ");
  const description = entry.task.description.trim();
  const log = entry.task.log.trim();
  const body =
    description || log
      ? `<details><summary>details</summary>${
          description ? `<h4>Description</h4><pre>${esc(description)}</pre>` : ""
        }${log ? `<h4>Log</h4><pre>${esc(log)}</pre>` : ""}</details>`
      : "";
  return `<article class="card prio-${esc(fm.priority)}${entry.archived ? " archived" : ""}">
  <header><span class="id">${esc(fm.id)}</span><span class="prio">${esc(fm.priority)}</span></header>
  <h3>${esc(fm.title)}</h3>
  ${tags ? `<div class="tags">${tags}</div>` : ""}
  ${blockers ? `<div class="blockers">blocked by ${blockers}</div>` : ""}
  <footer>updated ${esc(fm.updatedAt)}</footer>
  ${body}
</article>`;
}

function main() {
  const opts = parseArgs(argv.slice(2));
  const root = findRepoRoot();
  if (!root) {
    stderr.write("error: not inside a git repository\n");
    exit(1);
  }
  try {
    withRepoWriteLock(root, () => renderBoard(root, opts));
  } catch (err) {
    stderr.write(`error: ${err.message}\n`);
    exit(err instanceof ConflictError ? 5 : 1);
  }
}

function renderBoard(root, opts) {
  const context = loadTaskContext(root);
  const active = context.filter((entry) => !entry.archived);
  const archived = context.filter((entry) => entry.archived);
  // Resolved once for the whole render; every card reads the same index.
  const blockerStates = blockerStateIndex(context);

  const byPriority = (a, b) => {
    const pa = PRIORITY_RANK[a.task.frontmatter.priority] ?? 9;
    const pb = PRIORITY_RANK[b.task.frontmatter.priority] ?? 9;
    if (pa !== pb) return pa - pb;
    return compareTaskIds(a.task.frontmatter.id, b.task.frontmatter.id);
  };

  const columnsHtml = COLUMNS.map((status) => {
    const entries = active
      .filter((e) => e.task.frontmatter.status === status)
      .sort(byPriority);
    return `<section class="column col-${status}">
<h2>${esc(status.replace("_", " "))} <span class="count">${entries.length}</span></h2>
${entries.map((e) => card(e, blockerStates)).join("\n") || '<p class="empty">(empty)</p>'}
</section>`;
  }).join("\n");

  const archivedHtml = archived.length
    ? `<details class="archive"><summary>archive <span class="count">${archived.length}</span></summary>
<div class="archive-list">${archived
        .sort((a, b) => compareTaskIds(b.task.frontmatter.id, a.task.frontmatter.id))
        .map((e) => card(e, blockerStates))
        .join("\n")}</div></details>`
    : "";

  const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Project task board</title>
<style>
  :root {
    --bg: #f6f7f9; --panel: #ffffff; --ink: #1a1d21; --muted: #667085;
    --line: #e4e7ec; --accent: #4157d8;
    --p0: #d92d20; --p1: #dc6803; --p2: #4157d8; --p3: #667085;
  }
  @media (prefers-color-scheme: dark) {
    :root {
      --bg: #101318; --panel: #181c23; --ink: #e6e9ee; --muted: #8a94a6;
      --line: #262c36; --accent: #8ea0ff;
      --p0: #f97066; --p1: #fdb022; --p2: #8ea0ff; --p3: #8a94a6;
    }
  }
  * { box-sizing: border-box; }
  body { margin: 0; padding: 1.25rem; background: var(--bg); color: var(--ink);
    font: 14px/1.45 system-ui, -apple-system, "Segoe UI", sans-serif; }
  h1 { font-size: 1.15rem; margin: 0 0 .25rem; }
  .meta { color: var(--muted); font-size: .8rem; margin-bottom: 1rem; }
  .board { display: grid; grid-template-columns: repeat(auto-fit, minmax(230px, 1fr));
    gap: .75rem; align-items: start; }
  .column { background: var(--panel); border: 1px solid var(--line);
    border-radius: 10px; padding: .6rem .6rem .2rem; }
  .column h2 { font-size: .78rem; text-transform: uppercase; letter-spacing: .06em;
    color: var(--muted); margin: .1rem .2rem .6rem; }
  .count { background: var(--line); border-radius: 999px; padding: 0 .5em;
    font-size: .72rem; color: var(--ink); }
  .empty { color: var(--muted); font-size: .8rem; margin: .2rem .2rem .6rem; }
  .card { border: 1px solid var(--line); border-left: 3px solid var(--p3);
    border-radius: 8px; padding: .5rem .6rem; margin-bottom: .6rem;
    background: var(--bg); }
  .card.prio-p0 { border-left-color: var(--p0); }
  .card.prio-p1 { border-left-color: var(--p1); }
  .card.prio-p2 { border-left-color: var(--p2); }
  .card header { display: flex; justify-content: space-between;
    font-size: .72rem; color: var(--muted); }
  .card .prio { font-weight: 600; }
  .card h3 { font-size: .88rem; margin: .25rem 0 .35rem; font-weight: 600; }
  .tags, .blockers { margin-bottom: .3rem; font-size: .72rem; }
  .tag { background: var(--line); border-radius: 4px; padding: .05rem .35rem; }
  .blockers { color: var(--muted); }
  .blocker.unmet { color: var(--p0); font-weight: 600; }
  .blocker.met { text-decoration: line-through; }
  .card footer { font-size: .7rem; color: var(--muted); }
  details { margin-top: .35rem; font-size: .78rem; }
  summary { cursor: pointer; color: var(--accent); }
  details h4 { margin: .5rem 0 .2rem; font-size: .72rem; text-transform: uppercase;
    letter-spacing: .05em; color: var(--muted); }
  details pre { white-space: pre-wrap; word-break: break-word; margin: 0;
    font: .78rem/1.5 ui-monospace, Consolas, monospace; }
  .archive { margin-top: 1.25rem; }
  .archive > summary { font-size: .85rem; }
  .archive-list { display: grid;
    grid-template-columns: repeat(auto-fill, minmax(230px, 1fr));
    gap: .6rem; margin-top: .6rem; }
  .card.archived { opacity: .75; }
</style>
</head>
<body>
<h1>Project task board</h1>
<p class="meta">snapshot generated ${esc(nowIso())} — regenerate with
<code>node .claude/skills/task-tracker/scripts/board-html.mjs</code></p>
<div class="board">
${columnsHtml}
</div>
${archivedHtml}
</body>
</html>
`;

  const outPath = opts.out ?? join(root, ".tasks", "board.html");
  mkdirSync(dirname(outPath), { recursive: true });
  writeFileSync(outPath, html);
  stdout.write(`${outPath}\n`);
}

main();
