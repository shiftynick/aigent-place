#!/usr/bin/env node
// visual-review.mjs — loopback server for operator review of one HTML artifact.
//
//   node visual-review.mjs serve <artifact.html> [--port N] [--poll-timeout-ms N]
//   node visual-review.mjs poll --url http://127.0.0.1:PORT [--after N] [--timeout-ms N]
//
// The agent starts `serve` in the background and prints the review URL for the
// operator. The operator annotates elements and text selections in the
// browser; the agent receives them through the long-poll endpoint (`poll` is a
// one-shot convenience wrapper around it). This is an operator feedback loop
// during implementation; review-model placement is defined in docs/SDLC.md.
//
// Security posture (all deliberate, none optional):
// - binds 127.0.0.1 only and validates the Host header (DNS-rebinding defense)
// - makes zero outbound network calls; `poll` refuses non-loopback URLs
// - serves files only from inside the artifact's directory, link-aware
// - the artifact runs in a sandboxed iframe without allow-same-origin
// - never auto-opens a browser; the URL is printed for the operator

import { createServer } from "node:http";
import { get as httpGet } from "node:http";
import {
  closeSync,
  constants as fsConstants,
  existsSync,
  fstatSync,
  openSync,
  readFileSync,
  realpathSync,
  statSync,
  watch,
} from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const MAX_BODY_BYTES = 1024 * 1024;
const DEFAULT_POLL_TIMEOUT_MS = 25_000;
const MAX_POLL_TIMEOUT_MS = 60_000;
const SDK_ROUTE = "/__vr_sdk.js";
const SDK_TAG = `<script src="${SDK_ROUTE}"></script>`;

const CONTENT_TYPES = new Map([
  [".html", "text/html; charset=utf-8"],
  [".htm", "text/html; charset=utf-8"],
  [".css", "text/css; charset=utf-8"],
  [".js", "text/javascript; charset=utf-8"],
  [".mjs", "text/javascript; charset=utf-8"],
  [".json", "application/json; charset=utf-8"],
  [".svg", "image/svg+xml"],
  [".png", "image/png"],
  [".jpg", "image/jpeg"],
  [".jpeg", "image/jpeg"],
  [".gif", "image/gif"],
  [".webp", "image/webp"],
  [".ico", "image/x-icon"],
  [".txt", "text/plain; charset=utf-8"],
  [".woff", "font/woff"],
  [".woff2", "font/woff2"],
]);

// Every document this server produces carries a CSP confining the browser to
// the review server itself: the iframe sandbox alone does not stop an
// artifact's external scripts, images, or fetch() calls from leaving loopback.
// frame-src is explicit because it is the navigation boundary: the embedder's
// frame-src governs every load into the nested context, so an artifact using
// location assignment or <meta refresh> cannot steer its iframe off-server.
const DOCUMENT_CSP =
  "default-src 'self' data: blob:; "
  + "script-src 'self' 'unsafe-inline'; "
  + "style-src 'self' 'unsafe-inline'; "
  + "img-src 'self' data: blob:; "
  + "font-src 'self' data:; "
  + "connect-src 'self'; "
  + "frame-src 'self'; "
  + "form-action 'none'";

const SDK_TAG_PATTERN =
  /<script\b[^>]*\bsrc\s*=\s*(?:"\/__vr_sdk\.js"|'\/__vr_sdk\.js'|\/__vr_sdk\.js(?=[\s>]))[^>]*>\s*<\/script\s*>\s*/giu;

// Inject exactly one SDK script tag by string transform: before the last
// </body> when present, otherwise appended, so malformed fragments still work.
// Existing SDK script tags (a re-saved review page) are stripped first so the
// served document always carries exactly one, and a mere textual mention of
// the route (a comment, prose) does not suppress injection.
export function injectSdk(html) {
  html = html.replace(SDK_TAG_PATTERN, "");
  const closer = /<\/body\s*>(?![\s\S]*<\/body\s*>)/iu;
  if (closer.test(html)) {
    return html.replace(closer, `${SDK_TAG}\n$&`);
  }
  return `${html}\n${SDK_TAG}\n`;
}

// Only the loopback names the server itself answers on are acceptable; any
// other Host header means a DNS-rebinding or proxy attempt and is refused.
export function hostAllowed(hostHeader, port) {
  if (typeof hostHeader !== "string" || hostHeader.length === 0) return false;
  const allowed = new Set([
    "127.0.0.1",
    "localhost",
    `127.0.0.1:${port}`,
    `localhost:${port}`,
  ]);
  return allowed.has(hostHeader.trim().toLowerCase());
}

// Map a request path to a real file confined to the artifact directory.
// Returns the resolved path or null. Rejections are structural (traversal,
// separators smuggled through encoding, null bytes) or link-aware (a symlink
// that leaves the directory), so the check holds on Windows and POSIX alike.
//
// artifactRoot MUST already be a real path, pinned once by the caller. An
// earlier version resolved the root on every request, which defeated the whole
// check: replacing the artifact directory itself with a link to somewhere else
// moved the boundary along with the target, and every file "inside" it passed.
export function resolveStatic(artifactRoot, urlPath) {
  if (typeof urlPath !== "string" || !urlPath.startsWith("/")) return null;
  let decoded;
  try {
    decoded = decodeURIComponent(urlPath);
  } catch {
    return null;
  }
  if (decoded.includes("\0") || decoded.includes("\\")) return null;
  const segments = decoded.split("/").filter((part) => part.length > 0);
  if (segments.some((part) => part === "." || part === "..")) return null;
  const rootPrefix = artifactRoot.endsWith(path.sep)
    ? artifactRoot
    : artifactRoot + path.sep;
  const resolved = path.resolve(artifactRoot, ...segments);
  if (resolved !== artifactRoot && !resolved.startsWith(rootPrefix)) return null;
  let real;
  try {
    real = realpathSync(resolved);
  } catch {
    return null;
  }
  // Compared against the pinned root, never a freshly resolved one.
  if (real !== artifactRoot && !real.startsWith(rootPrefix)) return null;
  try {
    if (!statSync(real).isFile()) return null;
  } catch {
    return null;
  }
  return real;
}

const DEFAULT_FILE_IO = { statSync, openSync, fstatSync, readFileSync, closeSync };

// Read the primary artifact, or null if it does not resolve inside its own
// directory. Validating a path and opening it are two lookups, so a swap can
// land between them; Node exposes no openat, so this cannot be made atomic. It
// is made *detectable* instead, in three layers:
//   1. resolveStatic proves the path resolves inside the directory.
//   2. O_NOFOLLOW refuses a final component that became a link (POSIX only;
//      the flag is absent, and therefore 0, on Windows).
//   3. The identity check compares what was validated against what was actually
//      opened. This is the layer that covers an ancestor-directory swap and
//      covers Windows; a mismatch refuses the request rather than serving it.
// Residual, stated rather than hidden: a swap preserving device and inode is
// undetectable, and the comparison is vacuous on filesystems reporting ino 0.
// Anyone able to swap files in the artifact directory can already change what
// the operator sees; this keeps that from becoming a read of a file outside it.
// io is injectable so the mismatch branch is a real test gate.
export function readConfinedArtifact(artifactRoot, artifactName, io = DEFAULT_FILE_IO) {
  const resolved = resolveStatic(artifactRoot, `/${encodeURIComponent(artifactName)}`);
  if (resolved === null) return null;
  let validated;
  let fd;
  try {
    validated = io.statSync(resolved);
    fd = io.openSync(resolved, fsConstants.O_RDONLY | (fsConstants.O_NOFOLLOW ?? 0));
  } catch {
    return null;
  }
  try {
    const opened = io.fstatSync(fd);
    if (opened.dev !== validated.dev || opened.ino !== validated.ino) return null;
    return io.readFileSync(fd, "utf8");
  } finally {
    io.closeSync(fd);
  }
}

function sendJson(res, status, payload) {
  const body = JSON.stringify(payload);
  res.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "content-length": Buffer.byteLength(body),
    "cache-control": "no-store",
  });
  res.end(body);
}

function sendHtml(res, status, html) {
  res.writeHead(status, {
    "content-type": "text/html; charset=utf-8",
    "cache-control": "no-store",
    "content-security-policy": DOCUMENT_CSP,
  });
  res.end(html);
}

function escapeHtml(text) {
  return String(text)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function readBody(req) {
  return new Promise((resolvePromise, rejectPromise) => {
    const chunks = [];
    let size = 0;
    req.on("data", (chunk) => {
      size += chunk.length;
      if (size > MAX_BODY_BYTES) {
        rejectPromise(new Error("body too large"));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => resolvePromise(Buffer.concat(chunks).toString("utf8")));
    req.on("error", rejectPromise);
  });
}

// The iframe side. It runs inside the sandboxed artifact (allow-scripts only),
// so it cannot reach the parent DOM; it reports selections via postMessage.
const SDK_SOURCE = String.raw`(() => {
  "use strict";
  const MAX_COMMENT = 8000;
  let marked = null;
  const OUTLINE = "2px solid #e4572e";
  function cssPath(el) {
    if (!(el instanceof Element)) return "";
    const parts = [];
    let node = el;
    while (node && node.nodeType === 1 && parts.length < 24) {
      if (node.id) {
        parts.unshift("#" + node.id);
        break;
      }
      let index = 1;
      let sibling = node;
      while ((sibling = sibling.previousElementSibling)) {
        if (sibling.tagName === node.tagName) index += 1;
      }
      parts.unshift(node.tagName.toLowerCase() + ":nth-of-type(" + index + ")");
      node = node.parentElement;
    }
    return parts.join(" > ");
  }
  function mark(el) {
    if (marked) marked.style.outline = marked.__vrOutline || "";
    marked = el;
    if (el) {
      el.__vrOutline = el.style.outline;
      el.style.outline = OUTLINE;
    }
  }
  function report(payload) {
    window.parent.postMessage(Object.assign({ source: "visual-review" }, payload), "*");
  }
  // Opt-in choice affordance (ADR-0004). An artifact author marks an element
  // with data-vr-choice; a click on it sends that choice with no typing and no
  // Send press. The attribute's value is the label when present, otherwise the
  // element's own text. Unmarked artifacts never reach this path.
  function choiceFor(target) {
    let node = target instanceof Element ? target : null;
    while (node && node.nodeType === 1) {
      if (node.hasAttribute("data-vr-choice")) {
        const attr = (node.getAttribute("data-vr-choice") || "").trim();
        const label = attr.length > 0 ? attr : (node.textContent || "").trim();
        if (label.length > 0) return { node: node, label: label };
        return null;
      }
      node = node.parentElement;
    }
    return null;
  }
  document.addEventListener("click", (event) => {
    const selection = String(window.getSelection() || "");
    if (selection.trim().length > 0) return;
    event.preventDefault();
    event.stopPropagation();
    const el = event.target instanceof Element ? event.target : null;
    if (!el) return;
    const choice = choiceFor(el);
    if (choice) {
      mark(choice.node);
      report({
        kind: "choice",
        selector: cssPath(choice.node),
        text: (choice.node.textContent || "").trim().slice(0, 400),
        comment: choice.label.slice(0, MAX_COMMENT),
      });
      return;
    }
    mark(el);
    report({
      kind: "element",
      selector: cssPath(el),
      text: (el.textContent || "").trim().slice(0, 400),
    });
  }, true);
  document.addEventListener("mouseup", () => {
    const selection = window.getSelection();
    const text = String(selection || "").trim();
    if (text.length === 0) return;
    let anchor = selection.anchorNode;
    if (anchor && anchor.nodeType !== 1) anchor = anchor.parentElement;
    mark(null);
    report({
      kind: "text",
      selector: cssPath(anchor),
      text: text.slice(0, 2000),
    });
  }, true);
})();
`;

function shellPage(artifactName) {
  const title = escapeHtml(artifactName);
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>Visual review: ${title}</title>
<style>
  * { box-sizing: border-box; }
  body { margin: 0; font: 14px/1.45 system-ui, sans-serif; display: flex;
         height: 100vh; color: #1c2230; }
  #stage { flex: 1; display: flex; flex-direction: column; min-width: 0; }
  #stage header { padding: 8px 12px; background: #1c2230; color: #f5f6f8;
                  display: flex; gap: 12px; align-items: baseline; }
  #stage header .status { font-size: 12px; opacity: 0.8; }
  iframe { flex: 1; border: 0; width: 100%; background: #fff; }
  aside { width: 340px; border-left: 1px solid #d5d9e0; display: flex;
          flex-direction: column; background: #f5f6f8; }
  aside section { padding: 12px; border-bottom: 1px solid #d5d9e0; }
  aside h2 { margin: 0 0 6px; font-size: 13px; text-transform: uppercase;
             letter-spacing: 0.04em; color: #5b6472; }
  #target { min-height: 3em; font-size: 12px; word-break: break-all;
            color: #3a4354; }
  textarea { width: 100%; min-height: 5em; resize: vertical; font: inherit;
             padding: 6px; border: 1px solid #b8bfc9; border-radius: 4px; }
  button { font: inherit; padding: 6px 14px; border: 0; border-radius: 4px;
           background: #2456c4; color: #fff; cursor: pointer; }
  button.secondary { background: #5b6472; }
  button:disabled { background: #b8bfc9; cursor: default; }
  #sent { flex: 1; overflow-y: auto; margin: 0; padding: 0 12px 12px;
          list-style: none; font-size: 12px; }
  #sent li { border: 1px solid #d5d9e0; border-radius: 4px; background: #fff;
             padding: 6px 8px; margin-top: 8px; }
  #sent .kind { color: #5b6472; }
</style>
</head>
<body>
<div id="stage">
  <header>
    <strong>Visual review</strong>
    <span>${title}</span>
    <span class="status" id="status">connecting…</span>
  </header>
  <iframe id="artifact" src="/artifact" sandbox="allow-scripts"
          title="Artifact under review"></iframe>
</div>
<aside>
  <section>
    <h2>Selection</h2>
    <div id="target">Click an element or select text in the artifact.</div>
  </section>
  <section>
    <h2>Comment</h2>
    <textarea id="comment" placeholder="What should change here?"></textarea>
    <p>
      <button id="send" disabled>Send annotation</button>
      <button id="note" class="secondary">Send page note</button>
    </p>
  </section>
  <section style="border-bottom:0">
    <h2>Sent to agent</h2>
    <p><button id="finish" class="secondary">Finish review</button></p>
  </section>
  <ol id="sent"></ol>
</aside>
<script>
  "use strict";
  const statusEl = document.getElementById("status");
  const targetEl = document.getElementById("target");
  const commentEl = document.getElementById("comment");
  const sendEl = document.getElementById("send");
  const noteEl = document.getElementById("note");
  const finishEl = document.getElementById("finish");
  const sentEl = document.getElementById("sent");
  const frame = document.getElementById("artifact");
  let selection = null;
  // The reload poll owns the connection status; a successful send must restore
  // that message rather than assert "live" over a degraded watcher.
  let reloadStatus = "connecting…";
  // A send failure outranks the reload poll's status: without this the poll's
  // next tick overwrites the failure message and the operator never sees it.
  let sendFailed = false;

  window.addEventListener("message", async (event) => {
    // Only the artifact frame may report selections. Without this any window
    // that can reach this page could forge annotations — and a choice posts
    // with no operator keystroke, so it is the message worth forging.
    if (event.source !== frame.contentWindow) return;
    const data = event.data;
    if (!data || data.source !== "visual-review") return;
    // A marked choice is already a complete annotation: send it now rather
    // than making the operator retype what they just clicked (ADR-0004).
    if (data.kind === "choice") {
      const sent = await post({ kind: "choice", selector: data.selector,
                                text: data.text, comment: data.comment });
      if (sent) record("choice", data.comment);
      return;
    }
    selection = { kind: data.kind, selector: data.selector, text: data.text };
    targetEl.textContent = "[" + data.kind + "] " + (data.selector || "(document)")
      + (data.text ? " — “" + data.text.slice(0, 120) + "”" : "");
    sendEl.disabled = false;
    commentEl.focus();
  });

  function record(kind, detail) {
    const item = document.createElement("li");
    const label = document.createElement("span");
    label.className = "kind";
    label.textContent = "[" + kind + "] ";
    item.appendChild(label);
    item.appendChild(document.createTextNode(detail));
    sentEl.prepend(item);
  }

  // A failed send must be visible and must not discard the typed comment.
  async function post(payload) {
    try {
      const response = await fetch("/api/annotations", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (!response.ok) throw new Error(String(response.status));
      sendFailed = false;
      statusEl.textContent = reloadStatus;
      return true;
    } catch {
      sendFailed = true;
      statusEl.textContent = "send failed — is the review server still running?";
      return false;
    }
  }

  sendEl.addEventListener("click", async () => {
    if (!selection) return;
    const comment = commentEl.value.trim();
    if (comment.length === 0) { commentEl.focus(); return; }
    const sent = await post({ kind: selection.kind, selector: selection.selector,
                              text: selection.text, comment });
    if (!sent) return;
    record(selection.kind, comment);
    commentEl.value = "";
    selection = null;
    sendEl.disabled = true;
    targetEl.textContent = "Click an element or select text in the artifact.";
  });

  noteEl.addEventListener("click", async () => {
    const comment = commentEl.value.trim();
    if (comment.length === 0) { commentEl.focus(); return; }
    if (!(await post({ kind: "note", selector: "", text: "", comment }))) return;
    record("note", comment);
    commentEl.value = "";
  });

  finishEl.addEventListener("click", async () => {
    const sent = await post({ kind: "complete", selector: "", text: "",
                              comment: "Operator finished the review." });
    if (!sent) return;
    record("complete", "Review finished.");
    finishEl.disabled = true;
  });

  async function watchReload() {
    let version = 0;
    for (;;) {
      try {
        const response = await fetch("/api/reload?after=" + version, {
          cache: "no-store",
        });
        if (!response.ok) throw new Error(String(response.status));
        const data = await response.json();
        reloadStatus = data.watching
          ? "live"
          : "live reload unavailable — refresh manually after edits";
        if (!sendFailed) statusEl.textContent = reloadStatus;
        if (data.version > version) {
          if (version > 0) frame.src = "/artifact?v=" + data.version;
          version = data.version;
        }
      } catch {
        reloadStatus = "server stopped";
        if (!sendFailed) statusEl.textContent = reloadStatus;
        await new Promise((r) => setTimeout(r, 2000));
      }
    }
  }
  watchReload();
</script>
</body>
</html>
`;
}

// In-memory annotation queue with monotonic sequence numbers, plus parked
// long-poll responses. Nothing persists across a server restart on purpose:
// the loop is live agent-operator traffic, not review-of-record evidence.
function createQueue() {
  const events = [];
  const waiters = new Set();
  let nextSeq = 1;

  function eventsAfter(after) {
    return events.filter((event) => event.seq > after);
  }

  function push(event) {
    const stamped = { seq: nextSeq, at: new Date().toISOString(), ...event };
    nextSeq += 1;
    events.push(stamped);
    for (const waiter of [...waiters]) {
      const pending = eventsAfter(waiter.after);
      if (pending.length > 0) {
        waiters.delete(waiter);
        clearTimeout(waiter.timer);
        waiter.resolve(pending);
      }
    }
    return stamped;
  }

  function wait(after, timeoutMs) {
    const pending = eventsAfter(after);
    if (pending.length > 0) return Promise.resolve(pending);
    return new Promise((resolvePromise) => {
      const waiter = { after, resolve: resolvePromise, timer: null };
      waiter.timer = setTimeout(() => {
        waiters.delete(waiter);
        resolvePromise([]);
      }, timeoutMs);
      waiters.add(waiter);
    });
  }

  function close() {
    for (const waiter of waiters) {
      clearTimeout(waiter.timer);
      waiter.resolve([]);
    }
    waiters.clear();
  }

  return { push, wait, eventsAfter, close };
}

// watchFactory is injectable so a test can drive the later-error path: a real
// fs.watch cannot be made to emit "error" on demand, and an untestable
// transition is one a refactor can silently delete.
export function createReloadSignal(artifactDir, watchFactory = watch) {
  let version = 1;
  let watching = false;
  const waiters = new Set();
  let watcher = null;
  let debounce = null;

  function bump() {
    version += 1;
    for (const waiter of [...waiters]) {
      waiters.delete(waiter);
      clearTimeout(waiter.timer);
      waiter.resolve(version);
    }
  }

  // A watcher that cannot start or later dies must not be silent: the flag
  // reaches /api/reload and the UI, which tells the operator to refresh
  // manually instead of claiming a live view.
  try {
    watcher = watchFactory(artifactDir, () => {
      // fs.watch fires in bursts per save; collapse them into one reload.
      clearTimeout(debounce);
      debounce = setTimeout(bump, 100);
    });
    watching = true;
    watcher.on("error", () => {
      watching = false;
    });
  } catch {
    watcher = null;
  }

  function wait(after, timeoutMs) {
    if (version > after) return Promise.resolve(version);
    return new Promise((resolvePromise) => {
      const waiter = { resolve: resolvePromise, timer: null };
      waiter.timer = setTimeout(() => {
        waiters.delete(waiter);
        resolvePromise(version);
      }, timeoutMs);
      waiters.add(waiter);
    });
  }

  function close() {
    clearTimeout(debounce);
    if (watcher) watcher.close();
    for (const waiter of waiters) {
      clearTimeout(waiter.timer);
      waiter.resolve(version);
    }
    waiters.clear();
  }

  return { wait, close, current: () => version, watching: () => watching };
}

function clampTimeout(raw, fallback) {
  const value = Number.parseInt(raw ?? "", 10);
  if (!Number.isFinite(value) || value < 0) return fallback;
  return Math.min(value, MAX_POLL_TIMEOUT_MS);
}

export function startServer(options) {
  const artifactPath = path.resolve(options.artifactPath);
  if (!existsSync(artifactPath) || !statSync(artifactPath).isFile()) {
    throw new Error(`Artifact file not found: ${options.artifactPath}`);
  }
  const artifactDir = path.dirname(artifactPath);
  const artifactName = path.basename(artifactPath);
  // Pin the real root ONCE. Every later containment decision is made against
  // this value, so replacing the directory with a link afterwards moves the
  // files out of bounds instead of moving the boundary with them.
  const artifactRoot = realpathSync(artifactDir);
  // The artifact itself gets the same link-aware confinement as its assets: a
  // primary file that is (or later becomes) a symlink out of its directory
  // must not be followed.
  const confineArtifact = () =>
    resolveStatic(artifactRoot, `/${encodeURIComponent(artifactName)}`);
  if (confineArtifact() === null) {
    throw new Error(
      `Artifact must be a regular file resolving inside its own directory; a link that leaves it is refused: ${options.artifactPath}`,
    );
  }
  const readArtifactConfined = () => readConfinedArtifact(artifactRoot, artifactName);
  const defaultPollMs = clampTimeout(
    options.pollTimeoutMs,
    DEFAULT_POLL_TIMEOUT_MS,
  );
  const queue = createQueue();
  const reload = createReloadSignal(artifactRoot);

  const server = createServer(async (req, res) => {
    // address() is null once close() starts; refuse the racing request.
    const address = server.address();
    if (address === null) {
      sendJson(res, 503, { error: "shutting down" });
      return;
    }
    const port = address.port;
    if (!hostAllowed(req.headers.host, port)) {
      sendJson(res, 403, { error: "forbidden host" });
      return;
    }
    let url;
    try {
      url = new URL(req.url, `http://127.0.0.1:${port}`);
    } catch {
      sendJson(res, 400, { error: "bad request" });
      return;
    }
    const route = `${req.method} ${url.pathname}`;
    try {
      if (route === "GET /") {
        sendHtml(res, 200, shellPage(artifactName));
        return;
      }
      if (route === "GET /artifact") {
        const artifactHtml = readArtifactConfined();
        if (artifactHtml === null) {
          sendJson(res, 403, { error: "artifact no longer resolves inside its directory" });
          return;
        }
        sendHtml(res, 200, injectSdk(artifactHtml));
        return;
      }
      if (route === `GET ${SDK_ROUTE}`) {
        res.writeHead(200, {
          "content-type": "text/javascript; charset=utf-8",
          "cache-control": "no-store",
        });
        res.end(SDK_SOURCE);
        return;
      }
      if (route === "GET /api/health") {
        sendJson(res, 200, { ok: true, artifact: artifactName });
        return;
      }
      if (route === "GET /api/poll") {
        const after = Number.parseInt(url.searchParams.get("after") ?? "0", 10) || 0;
        const timeoutMs = clampTimeout(
          url.searchParams.get("timeout"),
          defaultPollMs,
        );
        const events = await queue.wait(after, timeoutMs);
        sendJson(res, 200, { events });
        return;
      }
      if (route === "GET /api/reload") {
        const after = Number.parseInt(url.searchParams.get("after") ?? "0", 10) || 0;
        const version = await reload.wait(after, defaultPollMs);
        sendJson(res, 200, { version, watching: reload.watching() });
        return;
      }
      if (route === "POST /api/annotations") {
        // Cross-site request defense: a foreign page can fire a CORS-simple
        // text/plain POST at loopback without any preflight, and the browser
        // sets a truthful loopback Host header on it. Requiring JSON forces a
        // preflight this server never grants, and a non-loopback Origin is
        // rejected outright (CLI callers send no Origin at all).
        const contentType = String(req.headers["content-type"] ?? "");
        if (!contentType.toLowerCase().startsWith("application/json")) {
          sendJson(res, 415, { error: "annotations must be application/json" });
          return;
        }
        const origin = req.headers.origin;
        if (typeof origin === "string" && origin.length > 0) {
          let originHost = null;
          try {
            originHost = new URL(origin).hostname;
          } catch {
            originHost = null;
          }
          if (originHost !== "127.0.0.1" && originHost !== "localhost") {
            sendJson(res, 403, { error: "forbidden origin" });
            return;
          }
        }
        let payload;
        try {
          payload = JSON.parse(await readBody(req));
        } catch {
          sendJson(res, 400, { error: "invalid JSON body" });
          return;
        }
        const kinds = new Set(["element", "text", "choice", "note", "complete"]);
        if (
          payload === null
          || typeof payload !== "object"
          || !kinds.has(payload.kind)
          || typeof payload.comment !== "string"
        ) {
          sendJson(res, 400, { error: "annotation needs a known kind and a comment" });
          return;
        }
        const stored = queue.push({
          kind: payload.kind,
          selector: typeof payload.selector === "string" ? payload.selector.slice(0, 1000) : "",
          text: typeof payload.text === "string" ? payload.text.slice(0, 4000) : "",
          comment: payload.comment.slice(0, 8000),
        });
        sendJson(res, 201, { seq: stored.seq });
        return;
      }
      if (req.method === "GET") {
        const file = resolveStatic(artifactRoot, url.pathname);
        if (!file) {
          sendJson(res, 404, { error: "not found" });
          return;
        }
        // The CSP goes on every static response as well: an artifact may link
        // to further HTML documents in its directory, and those navigations
        // must stay confined to the review server too.
        res.writeHead(200, {
          "content-type": CONTENT_TYPES.get(path.extname(file).toLowerCase())
            ?? "application/octet-stream",
          "cache-control": "no-store",
          "content-security-policy": DOCUMENT_CSP,
        });
        res.end(readFileSync(file));
        return;
      }
      sendJson(res, 405, { error: "method not allowed" });
    } catch (error) {
      sendJson(res, 500, { error: error instanceof Error ? error.message : String(error) });
    }
  });

  return new Promise((resolvePromise, rejectPromise) => {
    server.once("error", rejectPromise);
    server.listen(options.port ?? 0, "127.0.0.1", () => {
      const { port } = server.address();
      resolvePromise({
        server,
        port,
        url: `http://127.0.0.1:${port}/`,
        close: () => new Promise((done) => {
          queue.close();
          reload.close();
          server.close(() => done());
          server.closeAllConnections?.();
        }),
      });
    });
  });
}

function parseFlags(args) {
  const flags = new Map();
  const positional = [];
  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i];
    if (arg.startsWith("--")) {
      const value = args[i + 1];
      if (value === undefined || value.startsWith("--")) {
        throw new Error(`Flag ${arg} requires a value.`);
      }
      flags.set(arg.slice(2), value);
      i += 1;
    } else {
      positional.push(arg);
    }
  }
  return { flags, positional };
}

function usage() {
  process.stderr.write(
    "Usage:\n"
    + "  node visual-review.mjs serve <artifact.html> [--port N] [--poll-timeout-ms N]\n"
    + "  node visual-review.mjs poll --url <base-url> [--after N] [--timeout-ms N]\n",
  );
  process.exitCode = 2;
}

async function commandServe(args) {
  const { flags, positional } = parseFlags(args);
  if (positional.length !== 1) return usage();
  const { url, close } = await startServer({
    artifactPath: positional[0],
    port: Number.parseInt(flags.get("port") ?? "0", 10) || 0,
    pollTimeoutMs: flags.get("poll-timeout-ms"),
  });
  process.stdout.write(
    `Visual review server running.\n`
    + `Open in a browser: ${url}\n`
    + `Agent long-poll:   ${url}api/poll?after=<last-seq>\n`
    + `Stop with Ctrl+C or by ending this process.\n`,
  );
  const stop = () => {
    close().then(() => process.exit(0));
  };
  process.on("SIGINT", stop);
  process.on("SIGTERM", stop);
}

// One long-poll against a running server, printed as JSON. Refusing
// non-loopback bases keeps the zero-outbound-network guarantee even when a
// caller pastes the wrong URL.
async function commandPoll(args) {
  const { flags } = parseFlags(args);
  const base = flags.get("url");
  if (!base) return usage();
  let parsed;
  try {
    parsed = new URL(base);
  } catch {
    throw new Error(`--url is not a valid URL: ${base}`);
  }
  if (
    parsed.protocol !== "http:"
    || !["127.0.0.1", "localhost"].includes(parsed.hostname)
  ) {
    throw new Error("poll only talks to http on 127.0.0.1 or localhost.");
  }
  const after = Number.parseInt(flags.get("after") ?? "0", 10) || 0;
  const timeoutMs = clampTimeout(flags.get("timeout-ms"), DEFAULT_POLL_TIMEOUT_MS);
  const target = new URL("/api/poll", parsed);
  target.searchParams.set("after", String(after));
  target.searchParams.set("timeout", String(timeoutMs));
  const body = await new Promise((resolvePromise, rejectPromise) => {
    const request = httpGet(target, (response) => {
      const chunks = [];
      response.on("data", (chunk) => chunks.push(chunk));
      response.on("end", () => {
        if (response.statusCode !== 200) {
          rejectPromise(new Error(`poll failed: HTTP ${response.statusCode}`));
          return;
        }
        resolvePromise(Buffer.concat(chunks).toString("utf8"));
      });
    });
    request.on("error", rejectPromise);
  });
  process.stdout.write(`${body}\n`);
}

async function main() {
  const [command, ...rest] = process.argv.slice(2);
  try {
    if (command === "serve") await commandServe(rest);
    else if (command === "poll") await commandPoll(rest);
    else usage();
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  }
}

if (
  process.argv[1]
  && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url))
) {
  main();
}
