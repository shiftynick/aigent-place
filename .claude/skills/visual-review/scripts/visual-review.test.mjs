import { after, before, describe, it } from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { request } from "node:http";
import {
  mkdtempSync,
  mkdirSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

import {
  createReloadSignal,
  hostAllowed,
  injectSdk,
  readConfinedArtifact,
  resolveStatic,
  startServer,
} from "./visual-review.mjs";

const ARTIFACT_HTML = `<!doctype html>
<html><head><title>Fixture</title></head>
<body><h1 id="headline">Hello</h1><img src="logo.svg" alt=""></body></html>
`;

function makeFixture() {
  const root = mkdtempSync(join(tmpdir(), "vr-fixture-"));
  const artifactDir = join(root, "artifact");
  mkdirSync(artifactDir);
  writeFileSync(join(artifactDir, "page.html"), ARTIFACT_HTML);
  writeFileSync(join(artifactDir, "logo.svg"), "<svg xmlns=\"http://www.w3.org/2000/svg\"/>");
  writeFileSync(join(root, "outside-secret.txt"), "must never be served");
  return { root, artifactDir, artifactPath: join(artifactDir, "page.html") };
}

// fetch() refuses a hand-set Host header, so the foreign-host probe goes
// through node:http directly.
function rawGet(port, urlPath, hostHeader) {
  return new Promise((resolve, reject) => {
    const req = request(
      {
        host: "127.0.0.1",
        port,
        path: urlPath,
        headers: hostHeader === undefined ? {} : { host: hostHeader },
      },
      (res) => {
        const chunks = [];
        res.on("data", (chunk) => chunks.push(chunk));
        res.on("end", () => resolve({
          status: res.statusCode,
          body: Buffer.concat(chunks).toString("utf8"),
        }));
      },
    );
    req.on("error", reject);
    req.end();
  });
}

describe("injectSdk", () => {
  it("injects exactly one SDK tag before the closing body tag", () => {
    const html = injectSdk("<html><body><p>x</p></body></html>");
    const matches = html.match(/__vr_sdk\.js/gu) ?? [];
    assert.equal(matches.length, 1);
    assert.ok(html.indexOf("__vr_sdk.js") < html.indexOf("</body>"));
  });

  it("targets the final closing body tag when markup embeds an earlier one", () => {
    const html = injectSdk("<body><pre>&lt;/body&gt;</pre><code></body></code></body>");
    assert.ok(html.lastIndexOf("__vr_sdk.js") > html.indexOf("</code>"));
  });

  it("is idempotent: re-injecting an already-tagged document keeps one tag", () => {
    const once = injectSdk("<html><body><p>x</p></body></html>");
    const twice = injectSdk(once);
    assert.equal(twice, once);
    assert.equal((twice.match(/__vr_sdk\.js/gu) ?? []).length, 1);
  });

  it("collapses duplicate pre-existing SDK tags to exactly one", () => {
    const tag = '<script src="/__vr_sdk.js"></script>';
    const html = injectSdk(`<body><p>x</p>${tag}${tag}</body>`);
    assert.equal((html.match(/<script[^>]*__vr_sdk\.js/gu) ?? []).length, 1);
  });

  it("still injects when the route is only mentioned in text or a comment", () => {
    const html = injectSdk("<body><!-- see /__vr_sdk.js --><p>/__vr_sdk.js</p></body>");
    assert.equal((html.match(/<script[^>]*__vr_sdk\.js/gu) ?? []).length, 1);
  });

  it("appends the tag when no closing body tag exists", () => {
    const html = injectSdk("<h1>fragment</h1>");
    assert.match(html, /<h1>fragment<\/h1>\n<script src="\/__vr_sdk\.js"><\/script>/u);
  });
});

describe("hostAllowed", () => {
  it("accepts loopback names with and without the port", () => {
    assert.equal(hostAllowed("127.0.0.1:8123", 8123), true);
    assert.equal(hostAllowed("localhost:8123", 8123), true);
    assert.equal(hostAllowed("LOCALHOST", 8123), true);
  });

  it("rejects foreign, wrong-port, and missing hosts", () => {
    assert.equal(hostAllowed("evil.example", 8123), false);
    assert.equal(hostAllowed("127.0.0.1.evil.example:8123", 8123), false);
    assert.equal(hostAllowed("127.0.0.1:9", 8123), false);
    assert.equal(hostAllowed(undefined, 8123), false);
    assert.equal(hostAllowed("", 8123), false);
  });
});

describe("resolveStatic", () => {
  const { root, artifactDir: rawDir } = makeFixture();
  const artifactDir = realpathSync(rawDir);
  after(() => rmSync(root, { recursive: true, force: true }));

  it("serves a file inside the artifact directory", () => {
    assert.ok(resolveStatic(artifactDir, "/logo.svg"));
  });

  it("refuses traversal, encoded traversal, and backslash smuggling", () => {
    assert.equal(resolveStatic(artifactDir, "/../outside-secret.txt"), null);
    assert.equal(resolveStatic(artifactDir, "/%2e%2e/outside-secret.txt"), null);
    assert.equal(resolveStatic(artifactDir, "/..%5coutside-secret.txt"), null);
    assert.equal(resolveStatic(artifactDir, "/a/../../outside-secret.txt"), null);
  });

  it("refuses a symlink that leaves the artifact directory", (t) => {
    const linkPath = join(artifactDir, "escape.txt");
    try {
      symlinkSync(join(root, "outside-secret.txt"), linkPath);
    } catch {
      // Symlink creation needs privileges on some Windows setups; the
      // structural checks above still cover the non-link escapes.
      t.skip("cannot create symlinks here");
      return;
    }
    assert.equal(resolveStatic(artifactDir, "/escape.txt"), null);
  });
});

describe("readConfinedArtifact", () => {
  const { root, artifactDir: rawDir } = makeFixture();
  const artifactDir = realpathSync(rawDir);
  after(() => rmSync(root, { recursive: true, force: true }));

  it("reads an artifact that resolves inside its directory", () => {
    assert.match(readConfinedArtifact(artifactDir, "page.html"), /Hello/u);
  });

  it("returns null when the file swapped between validation and open", () => {
    // The race cannot be produced deterministically against the real
    // filesystem, so the io seam reports a different identity from the one
    // that was validated — exactly what a mid-flight swap looks like.
    let call = 0;
    const io = {
      statSync: () => ({ dev: 1, ino: 100 }),
      openSync: () => 42,
      fstatSync: () => ({ dev: 1, ino: 999 }),
      readFileSync: () => { call += 1; return "SHOULD NOT BE READ"; },
      closeSync: () => {},
    };
    assert.equal(readConfinedArtifact(artifactDir, "page.html", io), null);
    assert.equal(call, 0);
  });

  it("closes the descriptor even when identity fails", () => {
    let closed = 0;
    const io = {
      statSync: () => ({ dev: 1, ino: 100 }),
      openSync: () => 42,
      fstatSync: () => ({ dev: 2, ino: 100 }),
      readFileSync: () => "x",
      closeSync: () => { closed += 1; },
    };
    readConfinedArtifact(artifactDir, "page.html", io);
    assert.equal(closed, 1);
  });

  it("returns null when the artifact leaves its directory", () => {
    assert.equal(readConfinedArtifact(artifactDir, "../outside-secret.txt"), null);
  });

  it("refuses reads after the artifact directory itself becomes a link out", (t) => {
    // The ancestor swap: replace the whole directory with a link elsewhere.
    // A root resolved per request would follow it and call the outside file
    // "inside"; a root pinned once puts that file out of bounds.
    const swapRoot = mkdtempSync(join(tmpdir(), "vr-ancestor-"));
    const realDir = join(swapRoot, "real");
    const elsewhere = join(swapRoot, "elsewhere");
    mkdirSync(realDir);
    mkdirSync(elsewhere);
    writeFileSync(join(realDir, "page.html"), ARTIFACT_HTML);
    writeFileSync(join(elsewhere, "page.html"), "<h1>OUTSIDE THE BOUNDARY</h1>");
    const pinned = realpathSync(realDir);
    assert.match(readConfinedArtifact(pinned, "page.html"), /Hello/u);
    rmSync(realDir, { recursive: true, force: true });
    try {
      symlinkSync(elsewhere, realDir, "junction");
    } catch {
      rmSync(swapRoot, { recursive: true, force: true });
      t.skip("cannot create directory links here");
      return;
    }
    try {
      assert.equal(readConfinedArtifact(pinned, "page.html"), null);
    } finally {
      rmSync(swapRoot, { recursive: true, force: true });
    }
  });
});

// The shell page's behavior used to be asserted by searching its HTML for
// strings, which passes even if the handlers never run. This shim is the
// smallest thing that executes the real script: enough DOM to satisfy it,
// built from node: built-ins only, with fetch under the test's control.
function runShellScript(html, fetchImpl) {
  const script = html.slice(
    html.lastIndexOf("<script>") + "<script>".length,
    html.lastIndexOf("</script>"),
  );
  const made = new Map();
  const element = (id) => {
    const node = {
      id,
      textContent: "",
      value: "",
      disabled: false,
      children: [],
      className: "",
      handlers: {},
      addEventListener(type, fn) { node.handlers[type] = fn; },
      appendChild(child) { node.children.push(child); return child; },
      prepend(child) { node.children.unshift(child); return child; },
      focus() {},
      setAttribute(name, value) { node[name] = value; },
      getAttribute(name) { return node[name]; },
    };
    // The shell verifies message provenance against the artifact frame.
    if (id === "artifact") node.contentWindow = { name: "artifact-frame" };
    return node;
  };
  const document = {
    getElementById(id) {
      if (!made.has(id)) made.set(id, element(id));
      return made.get(id);
    },
    createElement: () => element("created"),
    createTextNode: (text) => ({ textContent: text }),
    querySelectorAll: () => [],
  };
  const windowHandlers = {};
  const win = {
    addEventListener(type, fn) { windowHandlers[type] = fn; },
  };
  // Never fires: watchReload's retry sleep must not resume and overwrite state
  // in the middle of an assertion.
  const setTimeoutStub = () => 0;
  // eslint-disable-next-line no-new-func
  new Function("document", "window", "fetch", "setTimeout", script)(
    document, win, fetchImpl, setTimeoutStub,
  );
  return { el: (id) => document.getElementById(id), windowHandlers };
}

// The injected SDK runs inside the sandboxed iframe, so nothing in the server
// tests exercises its click logic. This shim executes the real SDK source
// against a fake element tree and captures what it posts to the parent.
function runSdk(source) {
  class FakeElement {
    constructor(tag, id, attrs, text) {
      this.tagName = tag.toUpperCase();
      this.id = id;
      this.attrs = attrs;
      this.textContent = text;
      this.nodeType = 1;
      this.parentElement = null;
      this.previousElementSibling = null;
      this.style = {};
    }
    hasAttribute(name) { return Object.hasOwn(this.attrs, name); }
    getAttribute(name) { return this.attrs[name]; }
  }
  const listeners = {};
  const document = { addEventListener(type, fn) { listeners[type] = fn; } };
  const posted = [];
  const win = {
    getSelection: () => "",
    parent: { postMessage: (payload) => posted.push(payload) },
  };
  // eslint-disable-next-line no-new-func
  new Function("document", "window", "Element", source)(document, win, FakeElement);
  return {
    posted,
    click(target) {
      listeners.click({ target, preventDefault() {}, stopPropagation() {} });
    },
    make: (tag, id, attrs, text) => new FakeElement(tag, id, attrs, text),
  };
}

describe("injected SDK choice marker", () => {
  let source;

  before(async () => {
    const fixture = makeFixture();
    const handle = await startServer({ artifactPath: fixture.artifactPath });
    source = await (await fetch(`${handle.url}__vr_sdk.js`)).text();
    await handle.close();
    rmSync(fixture.root, { recursive: true, force: true });
  });

  it("posts a choice using the marker's value as the label", () => {
    const sdk = runSdk(source);
    const opt = sdk.make("div", "q1-a", { "data-vr-choice": "Q1: ship it" }, "Yes, ship it");
    sdk.click(opt);
    assert.equal(sdk.posted.length, 1);
    assert.equal(sdk.posted[0].kind, "choice");
    assert.equal(sdk.posted[0].comment, "Q1: ship it");
    assert.equal(sdk.posted[0].selector, "#q1-a");
  });

  it("finds the marker on an ancestor when an inner node is clicked", () => {
    const sdk = runSdk(source);
    const opt = sdk.make("div", "q2-b", { "data-vr-choice": "Q2: both" }, "Both");
    const inner = sdk.make("strong", "", {}, "Both");
    inner.parentElement = opt;
    sdk.click(inner);
    assert.equal(sdk.posted[0].kind, "choice");
    assert.equal(sdk.posted[0].comment, "Q2: both");
  });

  it("falls back to the element's own text when the marker is empty", () => {
    const sdk = runSdk(source);
    sdk.click(sdk.make("div", "q3", { "data-vr-choice": "" }, "  Use the text  "));
    assert.equal(sdk.posted[0].comment, "Use the text");
  });

  it("leaves unmarked elements on the ordinary annotation path", () => {
    const sdk = runSdk(source);
    sdk.click(sdk.make("p", "plain", {}, "no marker here"));
    assert.equal(sdk.posted[0].kind, "element");
    assert.equal(sdk.posted[0].comment, undefined);
  });

  it("caps a marker label at the annotation comment cap, not the text cap", () => {
    const sdk = runSdk(source);
    sdk.click(sdk.make("div", "mid", { "data-vr-choice": "L".repeat(900) }, "x"));
    assert.equal(sdk.posted[0].comment.length, 900, "a 900-char label must survive");
    const long = runSdk(source);
    long.click(long.make("div", "long", { "data-vr-choice": "L".repeat(9000) }, "x"));
    assert.equal(long.posted[0].comment.length, 8000);
  });
});

describe("shell page behavior (executed, not pattern-matched)", () => {
  let html;

  before(async () => {
    const fixture = makeFixture();
    const handle = await startServer({ artifactPath: fixture.artifactPath });
    html = (await (await fetch(handle.url)).text());
    await handle.close();
    rmSync(fixture.root, { recursive: true, force: true });
  });

  it("keeps the typed comment and shows the failure when a send fails", async () => {
    const calls = [];
    const dom = runShellScript(html, (url, init) => {
      calls.push(String(url));
      if (String(url).includes("/api/reload")) return new Promise(() => {});
      return Promise.reject(new Error("server gone"));
    });
    dom.windowHandlers.message({
      source: dom.el("artifact").contentWindow,
      data: { source: "visual-review", kind: "element", selector: "#x", text: "T" },
    });
    dom.el("comment").value = "must survive";
    await dom.el("send").handlers.click();

    assert.equal(dom.el("comment").value, "must survive", "typed comment was discarded");
    assert.equal(dom.el("sent").children.length, 0, "a failed send was logged as sent");
    assert.match(dom.el("status").textContent, /send failed/u);
    assert.equal(dom.el("send").disabled, false, "selection was cleared on failure");
    assert.ok(calls.some((u) => u.includes("/api/annotations")));
  });

  it("clears the comment and logs the entry when a send succeeds", async () => {
    const dom = runShellScript(html, (url) => {
      if (String(url).includes("/api/reload")) return new Promise(() => {});
      return Promise.resolve({ ok: true, status: 201, json: async () => ({ seq: 1 }) });
    });
    dom.windowHandlers.message({
      source: dom.el("artifact").contentWindow,
      data: { source: "visual-review", kind: "element", selector: "#x", text: "T" },
    });
    dom.el("comment").value = "applied";
    await dom.el("send").handlers.click();

    assert.equal(dom.el("comment").value, "");
    assert.equal(dom.el("sent").children.length, 1);
    assert.equal(dom.el("send").disabled, true);
  });

  it("sends a marked choice immediately, with no typing and no Send press", async () => {
    const posted = [];
    const dom = runShellScript(html, (url, init) => {
      if (String(url).includes("/api/reload")) return new Promise(() => {});
      posted.push(JSON.parse(init.body));
      return Promise.resolve({ ok: true, status: 201, json: async () => ({ seq: 1 }) });
    });
    await dom.windowHandlers.message({
      source: dom.el("artifact").contentWindow,
      data: {
        source: "visual-review",
        kind: "choice",
        selector: "#q1-a",
        text: "A. One scoped delta review",
        comment: "A. One scoped delta review",
      },
    });
    assert.equal(posted.length, 1);
    assert.equal(posted[0].kind, "choice");
    assert.equal(posted[0].comment, "A. One scoped delta review");
    assert.equal(posted[0].selector, "#q1-a");
    assert.equal(dom.el("sent").children.length, 1);
    // The comment box is never involved: nothing typed, nothing cleared.
    assert.equal(dom.el("comment").value, "");
    assert.equal(dom.el("send").disabled, false);
  });

  it("ignores a forged choice from any window other than the artifact frame", async () => {
    const posted = [];
    const dom = runShellScript(html, (url, init) => {
      if (String(url).includes("/api/reload")) return new Promise(() => {});
      posted.push(JSON.parse(init.body));
      return Promise.resolve({ ok: true, status: 201, json: async () => ({ seq: 1 }) });
    });
    await dom.windowHandlers.message({
      source: { name: "some-other-window" },
      data: {
        source: "visual-review",
        kind: "choice",
        selector: "#q1-a",
        text: "forged",
        comment: "Q1: forged by another window",
      },
    });
    assert.equal(posted.length, 0, "a message from a foreign window was accepted");
    assert.equal(dom.el("sent").children.length, 0);
  });

  it("carries a long choice label up to the annotation comment cap", async () => {
    const posted = [];
    const dom = runShellScript(html, (url, init) => {
      if (String(url).includes("/api/reload")) return new Promise(() => {});
      posted.push(JSON.parse(init.body));
      return Promise.resolve({ ok: true, status: 201, json: async () => ({ seq: 1 }) });
    });
    await dom.windowHandlers.message({
      source: dom.el("artifact").contentWindow,
      data: {
        source: "visual-review",
        kind: "choice",
        selector: "#long",
        text: "x",
        comment: "L".repeat(5000),
      },
    });
    assert.equal(posted.length, 1);
    assert.equal(posted[0].comment.length, 5000, "label must not be cut below the 8000 cap");
  });

  it("keeps a failed choice out of the sent list, then retries without duplicating", async () => {
    const attempts = [];
    let failNext = true;
    const dom = runShellScript(html, (url, init) => {
      if (String(url).includes("/api/reload")) return new Promise(() => {});
      attempts.push(JSON.parse(init.body));
      if (failNext) {
        failNext = false;
        return Promise.reject(new Error("server gone"));
      }
      return Promise.resolve({ ok: true, status: 201, json: async () => ({ seq: 1 }) });
    });
    const message = {
      source: dom.el("artifact").contentWindow,
      data: {
        source: "visual-review",
        kind: "choice",
        selector: "#q1-a",
        text: "A",
        comment: "Q1: option A",
      },
    };
    await dom.windowHandlers.message(message);
    assert.equal(dom.el("sent").children.length, 0, "a failed choice was logged as sent");
    assert.match(dom.el("status").textContent, /send failed/u);

    await dom.windowHandlers.message(message);
    assert.equal(attempts.length, 2, "the retry did not reach the server");
    assert.equal(dom.el("sent").children.length, 1, "the retry duplicated the entry");
  });

  it("leaves an ordinary element selection needing a typed comment", async () => {
    const posted = [];
    const dom = runShellScript(html, (url, init) => {
      if (String(url).includes("/api/reload")) return new Promise(() => {});
      posted.push(JSON.parse(init.body));
      return Promise.resolve({ ok: true, status: 201, json: async () => ({ seq: 1 }) });
    });
    await dom.windowHandlers.message({
      source: dom.el("artifact").contentWindow,
      data: { source: "visual-review", kind: "element", selector: "#x", text: "T" },
    });
    assert.equal(posted.length, 0, "an unmarked element must not auto-send");
    assert.equal(dom.el("send").disabled, false);
  });

  it("does not send an empty comment", async () => {
    let posted = false;
    const dom = runShellScript(html, (url) => {
      if (String(url).includes("/api/reload")) return new Promise(() => {});
      posted = true;
      return Promise.resolve({ ok: true, status: 201, json: async () => ({ seq: 1 }) });
    });
    dom.el("comment").value = "   ";
    await dom.el("note").handlers.click();
    assert.equal(posted, false);
  });
});

describe("visual-review server", () => {
  let fixture;
  let handle;

  before(async () => {
    fixture = makeFixture();
    handle = await startServer({ artifactPath: fixture.artifactPath });
  });

  after(async () => {
    await handle.close();
    rmSync(fixture.root, { recursive: true, force: true });
  });

  it("binds the loopback interface only", () => {
    assert.equal(handle.server.address().address, "127.0.0.1");
  });

  it("rejects a foreign Host header on every route", async () => {
    for (const urlPath of ["/", "/artifact", "/api/poll?timeout=0"]) {
      const response = await rawGet(handle.port, urlPath, "evil.example:80");
      assert.equal(response.status, 403, urlPath);
    }
  });

  it("serves the shell page with a sandboxed iframe and no allow-same-origin", async () => {
    const response = await rawGet(handle.port, "/");
    assert.equal(response.status, 200);
    assert.match(response.body, /<iframe[^>]*sandbox="allow-scripts"/u);
    assert.doesNotMatch(response.body, /allow-same-origin/u);
  });

  it("confines every served document to the review server via CSP", async () => {
    for (const urlPath of ["/", "/artifact", "/logo.svg"]) {
      const response = await fetch(`${handle.url.replace(/\/$/u, "")}${urlPath}`);
      const csp = response.headers.get("content-security-policy") ?? "";
      assert.match(csp, /default-src 'self'/u, urlPath);
      assert.match(csp, /connect-src 'self'/u, urlPath);
      assert.match(csp, /frame-src 'self'/u, urlPath);
      assert.doesNotMatch(csp, /https?:\/\//u, urlPath);
    }
  });

  it("serves the artifact with the SDK tag injected", async () => {
    const response = await rawGet(handle.port, "/artifact");
    assert.equal(response.status, 200);
    assert.match(response.body, /<h1 id="headline">Hello<\/h1>/u);
    assert.equal((response.body.match(/__vr_sdk\.js/gu) ?? []).length, 1);
    const sdk = await rawGet(handle.port, "/__vr_sdk.js");
    assert.equal(sdk.status, 200);
    assert.match(sdk.body, /postMessage/u);
  });

  it("serves sibling assets but never files outside the artifact directory", async () => {
    const asset = await rawGet(handle.port, "/logo.svg");
    assert.equal(asset.status, 200);
    for (const urlPath of [
      "/../outside-secret.txt",
      "/%2e%2e/outside-secret.txt",
      "/..%5coutside-secret.txt",
    ]) {
      const response = await rawGet(handle.port, urlPath);
      assert.equal(response.status, 404, urlPath);
      assert.doesNotMatch(response.body, /must never be served/u);
    }
  });

  it("delivers a queued annotation through the long-poll endpoint", async () => {
    const posted = await fetch(`${handle.url}api/annotations`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        kind: "element",
        selector: "#headline",
        text: "Hello",
        comment: "Make this the product name.",
      }),
    });
    assert.equal(posted.status, 201);
    const { seq } = await posted.json();
    const polled = await fetch(`${handle.url}api/poll?after=${seq - 1}&timeout=0`);
    const { events } = await polled.json();
    assert.equal(events.length, 1);
    assert.equal(events[0].seq, seq);
    assert.equal(events[0].kind, "element");
    assert.equal(events[0].selector, "#headline");
    assert.equal(events[0].comment, "Make this the product name.");
  });

  it("parks a long-poll until an annotation arrives", async () => {
    const drained = await (await fetch(`${handle.url}api/poll?after=0&timeout=0`)).json();
    const lastSeq = drained.events.at(-1)?.seq ?? 0;
    const pending = fetch(`${handle.url}api/poll?after=${lastSeq}&timeout=5000`);
    setTimeout(() => {
      fetch(`${handle.url}api/annotations`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ kind: "note", comment: "late arrival" }),
      });
    }, 50);
    const { events } = await (await pending).json();
    assert.equal(events.length, 1);
    assert.equal(events[0].comment, "late arrival");
  });

  it("returns an empty batch when the long-poll times out", async () => {
    const drained = await (await fetch(`${handle.url}api/poll?after=0&timeout=0`)).json();
    const lastSeq = drained.events.at(-1)?.seq ?? 0;
    const start = Date.now();
    const { events } = await (
      await fetch(`${handle.url}api/poll?after=${lastSeq}&timeout=100`)
    ).json();
    assert.equal(events.length, 0);
    assert.ok(Date.now() - start >= 90);
  });

  it("rejects cross-site annotation posts", async () => {
    const plain = await fetch(`${handle.url}api/annotations`, {
      method: "POST",
      headers: { "content-type": "text/plain" },
      body: JSON.stringify({ kind: "note", comment: "csrf probe" }),
    });
    assert.equal(plain.status, 415);
    const foreign = await fetch(`${handle.url}api/annotations`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        origin: "https://evil.example",
      },
      body: JSON.stringify({ kind: "note", comment: "csrf probe" }),
    });
    assert.equal(foreign.status, 403);
    const loopback = await fetch(`${handle.url}api/annotations`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        origin: `http://127.0.0.1:${handle.port}`,
      },
      body: JSON.stringify({ kind: "note", comment: "same-origin ok" }),
    });
    assert.equal(loopback.status, 201);
  });

  it("accepts a choice annotation and caps its comment", async () => {
    const drained = await (await fetch(`${handle.url}api/poll?after=0&timeout=0`)).json();
    const lastSeq = drained.events.at(-1)?.seq ?? 0;
    const posted = await fetch(`${handle.url}api/annotations`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        kind: "choice",
        selector: "#q2-b",
        text: "Option B",
        comment: "B".repeat(9000),
      }),
    });
    assert.equal(posted.status, 201);
    const { events } = await (
      await fetch(`${handle.url}api/poll?after=${lastSeq}&timeout=0`)
    ).json();
    const choice = events.find((e) => e.kind === "choice");
    assert.ok(choice, "choice annotation was not queued");
    assert.equal(choice.selector, "#q2-b");
    assert.equal(choice.comment.length, 8000, "existing comment cap must still apply");
  });

  it("applies the same content-type and Origin gating to a choice", async () => {
    const body = JSON.stringify({
      kind: "choice", selector: "#q1-a", text: "A", comment: "Q1: option A",
    });
    const plain = await fetch(`${handle.url}api/annotations`, {
      method: "POST", headers: { "content-type": "text/plain" }, body,
    });
    assert.equal(plain.status, 415, "a CORS-simple choice post must be refused");
    const foreign = await fetch(`${handle.url}api/annotations`, {
      method: "POST",
      headers: { "content-type": "application/json", origin: "https://evil.example" },
      body,
    });
    assert.equal(foreign.status, 403, "a foreign-origin choice must be refused");
    const loopback = await fetch(`${handle.url}api/annotations`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        origin: `http://127.0.0.1:${handle.port}`,
      },
      body,
    });
    assert.equal(loopback.status, 201);
  });

  it("keeps the SDK inert for artifacts without the choice marker", async () => {
    const sdk = await rawGet(handle.port, "/__vr_sdk.js");
    assert.match(sdk.body, /data-vr-choice/u);
    // The marker is opt-in: the lookup returns null and the ordinary element
    // path runs when no ancestor carries the attribute.
    assert.match(sdk.body, /hasAttribute\("data-vr-choice"\)/u);
    assert.match(sdk.body, /kind: "element"/u);
  });

  it("rejects malformed annotation payloads", async () => {
    for (const body of ["not json", JSON.stringify({ kind: "unknown", comment: "x" }), JSON.stringify({ kind: "note" })]) {
      const response = await fetch(`${handle.url}api/annotations`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body,
      });
      assert.equal(response.status, 400);
    }
  });

  it("bumps the reload version when the artifact directory changes", async () => {
    const first = await (await fetch(`${handle.url}api/reload?after=0`)).json();
    const pending = fetch(`${handle.url}api/reload?after=${first.version}`);
    // fs.watch delivery can lag; keep touching the file until the poll returns.
    let done = false;
    let touch = 0;
    const nudge = setInterval(() => {
      touch += 1;
      if (!done) writeFileSync(fixture.artifactPath, `${ARTIFACT_HTML}<!-- touch ${touch} -->`);
    }, 200);
    try {
      const next = await pending.then((r) => r.json());
      done = true;
      assert.ok(next.version > first.version);
    } finally {
      clearInterval(nudge);
    }
  });

  it("reports whether the artifact directory is being watched", async () => {
    const live = await (await fetch(`${handle.url}api/reload?after=0`)).json();
    assert.equal(live.watching, true);
    const dead = createReloadSignal(join(fixture.root, "no-such-dir"));
    try {
      assert.equal(dead.watching(), false);
      assert.equal(await dead.wait(dead.current(), 50), dead.current());
    } finally {
      dead.close();
    }
  });

  it("stops claiming to watch after the watcher errors", () => {
    // A real fs.watch cannot be made to emit "error" on demand, so the watch
    // factory is injected here; without this the transition is untestable and
    // a refactor could delete it silently.
    const fake = new EventEmitter();
    fake.close = () => {};
    const signal = createReloadSignal(fixture.artifactDir, () => fake);
    try {
      assert.equal(signal.watching(), true);
      fake.emit("error", new Error("watch died"));
      assert.equal(signal.watching(), false);
    } finally {
      signal.close();
    }
  });

  it("surfaces send failures in the shell page instead of swallowing them", async () => {
    const response = await rawGet(handle.port, "/");
    assert.match(response.body, /send failed — is the review server still running\?/u);
    assert.match(response.body, /live reload unavailable — refresh manually/u);
  });

  it("refuses a primary artifact that becomes a link out of its directory", async (t) => {
    const dir = join(fixture.root, "swap");
    mkdirSync(dir);
    const page = join(dir, "page.html");
    writeFileSync(page, ARTIFACT_HTML);
    const swapped = await startServer({ artifactPath: page });
    try {
      rmSync(page);
      try {
        symlinkSync(join(fixture.root, "outside-secret.txt"), page);
      } catch {
        t.skip("cannot create symlinks here");
        return;
      }
      const escaped = await rawGet(swapped.port, "/artifact");
      assert.equal(escaped.status, 403);
      assert.doesNotMatch(escaped.body, /must never be served/u);
      assert.throws(
        () => startServer({ artifactPath: page }),
        /resolving inside its own directory/u,
      );
    } finally {
      await swapped.close();
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("refuses to start on a missing artifact", () => {
    assert.throws(
      () => startServer({ artifactPath: join(fixture.root, "missing.html") }),
      /Artifact file not found/u,
    );
  });
});
