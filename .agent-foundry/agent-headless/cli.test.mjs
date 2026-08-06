import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { runAgent, runInvocation } from "./index.js";

const root = path.dirname(fileURLToPath(import.meta.url));
const cli = path.join(root, "cli.js");

function run(args, env = {}) {
  return spawnSync(process.execPath, [cli, ...args], {
    cwd: root,
    env: { ...process.env, ...env },
    encoding: "utf8",
    windowsHide: true,
  });
}

test("bundled CLI exposes the provenance version", () => {
  const result = run(["--version"]);
  assert.equal(result.status, 0, result.stderr);
  const provenance = readFileSync(path.join(root, "PROVENANCE.md"), "utf8");
  const expected = provenance.match(/^- Version: `([^`]+)`$/mu)?.[1];
  assert.ok(expected);
  assert.equal(result.stdout.trim(), expected);
});

test("capability probing reports a missing configured executable", () => {
  const missing = path.join(root, "definitely-missing-provider");
  const result = run(["capabilities", "claude"], { CLAUDE_BIN: missing });
  assert.equal(result.status, 0, result.stderr);
  const report = JSON.parse(result.stdout);
  assert.equal(report.provider, "claude");
  assert.equal(report.availability, "missing");
  assert.match(report.availabilityReason, /not found/u);
});

test("unknown capability providers fail closed", () => {
  const result = run(["capabilities", "other"]);
  assert.equal(result.status, 1);
  assert.match(result.stderr, /invalid_request/u);
});

function providerOutput(provider) {
  if (provider === "claude") {
    return `${JSON.stringify({ type: "result", subtype: "success", is_error: false, result: "OK" })}\n`;
  }
  if (provider === "codex") {
    return [
      JSON.stringify({ type: "thread.started", thread_id: "test" }),
      JSON.stringify({ type: "item.completed", item: { type: "agent_message", text: "OK" } }),
      JSON.stringify({ type: "turn.completed" }),
    ].join("\n");
  }
  return `${JSON.stringify({ type: "result", subtype: "success", is_error: false, result: "OK" })}\n`;
}

test("default invocations are answer-only and exclude dangerous bypass flags", async () => {
  for (const provider of ["claude", "codex", "cursor"]) {
    let captured;
    const result = await runAgent(
      { provider, prompt: "review", cwd: root, ...(provider === "cursor" ? { model: "model-test" } : {}) },
      { execute: async (invocation) => {
        captured = invocation;
        return { stdout: providerOutput(provider), stderr: "", exitCode: 0, durationMs: 1, timedOut: false, cancelled: false };
      } },
    );
    assert.equal(result.status, "succeeded");
    const argv = captured.args.join(" ");
    for (const forbidden of ["dangerously", "danger-full-access", "--force", "--yolo", "--approve-mcps"]) {
      assert.equal(argv.includes(forbidden), false, `${provider} emitted ${forbidden}`);
    }
    if (provider === "claude") assert.equal(captured.args.includes("--tools="), true);
    if (provider === "codex") assert.equal(captured.args.includes("read-only"), true);
    if (provider === "cursor") assert.deepEqual(captured.args.slice(-2), ["--mode", "ask"]);
  }
});

test("Cursor isolated writes do not claim sandboxing on Windows", async () => {
  let captured;
  await runAgent(
    { provider: "cursor", prompt: "edit", cwd: root, model: "model-test", access: "edit-isolated" },
    { execute: async (invocation) => {
      captured = invocation;
      return { stdout: providerOutput("cursor"), stderr: "", exitCode: 0, durationMs: 1, timedOut: false, cancelled: false };
    } },
  );
  assert.equal(captured.args.includes("--worktree"), true);
  assert.equal(captured.args.includes("--sandbox"), process.platform !== "win32");
});

// The tests below pin the behavior this bundle was upgraded for. Without them
// the vendoring gate cannot tell a correct artifact from the previous one: the
// older runner passes every other test in this file.

function stub(stdout, overrides = {}) {
  return { execute: async () => ({
    stdout,
    stderr: overrides.stderr ?? "",
    exitCode: overrides.exitCode === undefined ? 0 : overrides.exitCode,
    durationMs: 1,
    timedOut: overrides.timedOut ?? false,
    cancelled: overrides.cancelled ?? false,
  }) };
}

const cursorEvents = { provider: "cursor", prompt: "x", cwd: ".", output: "events" };

test("a banner line before the stream does not fail an otherwise successful run", async () => {
  const result = await runAgent(
    { ...cursorEvents, model: "model-test" },
    stub(`Cursor Agent starting\n${providerOutput("cursor")}`),
  );
  assert.equal(result.status, "succeeded", "an unparseable leading line must not discard the stream");
  assert.equal(result.finalText, "OK");
  assert.ok(result.warnings.some((w) => w.includes("line 1")), "the skipped line must be reported");
});

test("output that cannot be read is unparsed, not failed", async () => {
  const result = await runAgent({ ...cursorEvents, model: "model-test" }, stub("banner one\nbanner two"));
  assert.equal(result.status, "unparsed", "a clean exit with unreadable output is not a provider failure");
  assert.equal(result.exitCode, 0);
});

test("the last terminal marker decides the verdict, in both directions", async () => {
  const success = JSON.stringify({ type: "result", subtype: "success", is_error: false, result: "OK" });
  const error = JSON.stringify({ type: "error", message: "quota exhausted" });

  const afterSuccess = await runAgent({ ...cursorEvents, model: "model-test" }, stub(`${success}\n${error}`));
  assert.equal(afterSuccess.status, "failed", "an error after a success must not be swallowed");

  const retried = await runAgent({ ...cursorEvents, model: "model-test" }, stub(`${error}\n${success}`));
  assert.equal(retried.status, "succeeded", "a success after an earlier error is a recovered run");
  assert.equal(retried.finalText, "OK");
});

test("a non-zero exit is still a plain failure", async () => {
  const result = await runAgent({ ...cursorEvents, model: "model-test" }, stub("", { exitCode: 1 }));
  assert.equal(result.status, "failed");
});

test("Cursor defaults its model and says so", async () => {
  let captured;
  const withCapture = { execute: async (invocation) => {
    captured = invocation;
    return { stdout: providerOutput("cursor"), stderr: "", exitCode: 0, durationMs: 1, timedOut: false, cancelled: false };
  } };
  const defaulted = await runAgent({ ...cursorEvents }, withCapture);
  const index = captured.args.indexOf("--model");
  assert.notEqual(index, -1, "a model must be passed even when the caller named none");
  assert.equal(captured.args[index + 1], "cursor-grok-4.5-medium");
  assert.equal(defaulted.modelDefaulted, true);

  const explicit = await runAgent({ ...cursorEvents, model: "cursor-grok-4.5-medium" }, withCapture);
  assert.notEqual(explicit.modelDefaulted, true,
    "a caller naming the default model chose it; modelDefaulted must reflect intent, not string equality");
});

test("an isolated run reports where the work is, even when its output is unreadable", async () => {
  for (const [label, overrides] of [
    ["unreadable", {}],
    ["timed out", { timedOut: true, exitCode: null }],
    ["non-zero exit", { exitCode: 1 }],
  ]) {
    const result = await runAgent(
      { ...cursorEvents, cwd: root, access: "edit-isolated" },
      stub("banner one\nbanner two", overrides),
    );
    const workspace = result.workspace;
    assert.ok(workspace, `${label}: every result carries a workspace`);
    assert.ok(workspace.worktree, `${label}: a name alone does not locate the work`);
    assert.ok(path.isAbsolute(workspace.worktree), `${label}: the worktree must be an absolute path`);
    assert.equal(
      path.join(workspace.worktreeRoot, workspace.worktreeName),
      workspace.worktree,
      `${label}: the reported root and name must compose to the reported path`,
    );
  }
});

test("a successful isolated run hands over a reviewable diff from the result alone", (t) => {
  const git = (cwd, ...args) => spawnSync("git", args, { cwd, encoding: "utf8", windowsHide: true });
  if (spawnSync("git", ["--version"], { encoding: "utf8", windowsHide: true }).status !== 0) {
    return t.skip("git unavailable");
  }
  return (async () => {
    const { mkdtempSync, rmSync, writeFileSync, mkdirSync, existsSync } = await import("node:fs");
    const { tmpdir } = await import("node:os");
    const scratch = mkdtempSync(path.join(tmpdir(), "ah-handoff-"));
    try {
      const repo = path.join(scratch, "scratch-repo");
      const worktreesRoot = path.join(scratch, "worktrees");
      mkdirSync(repo);
      git(repo, "init", "-q");
      git(repo, "-c", "user.name=t", "-c", "user.email=t@t", "commit", "-q", "--allow-empty", "-m", "seed");

      // Stand in for the provider, without trusting the result under test: the
      // stub captures the argv the runner sent, and the worktree is created at
      // CURSOR'S OWN layout - <root>/<repo-basename-slug>/<name from argv> -
      // computed here independently. The result must then agree with reality,
      // not the other way round.
      let capturedArgs;
      const result = await runAgent(
        { ...cursorEvents, cwd: repo, access: "edit-isolated", env: { CURSOR_WORKTREES_ROOT: worktreesRoot } },
        { execute: async (invocation) => {
          capturedArgs = invocation.args;
          return { stdout: "banner only, nothing parseable", stderr: "", exitCode: 0, durationMs: 1, timedOut: false, cancelled: false };
        } },
      );
      const sentName = capturedArgs[capturedArgs.indexOf("--worktree") + 1];
      assert.ok(sentName && !sentName.startsWith("--"), "the runner must pass an explicit worktree name");
      const cursorLayout = path.join(worktreesRoot, path.basename(repo), sentName);
      mkdirSync(path.dirname(cursorLayout), { recursive: true });
      assert.equal(git(repo, "worktree", "add", "-q", "-b", sentName, cursorLayout).status, 0);
      writeFileSync(path.join(cursorLayout, "delivered.txt"), "delegated change\n");

      const { worktree } = result.workspace;
      assert.ok(worktree, "the result must name the worktree even though nothing parsed");
      assert.equal(path.resolve(worktree), path.resolve(cursorLayout),
        "the derived path must match where Cursor actually puts the worktree");

      // The documented recovery path, using only data from the result.
      assert.ok(existsSync(worktree));
      const status = git(worktree, "status", "--short");
      assert.equal(status.status, 0);
      assert.match(status.stdout, /delivered\.txt/u, "the diff must be reachable from the result alone");
    } finally {
      rmSync(scratch, { recursive: true, force: true });
    }
  })();
});

test("live cancellation terminates the bundled process runner", async () => {
  const controller = new AbortController();
  const result = await runInvocation(
    {
      provider: "claude",
      command: process.execPath,
      args: ["-e", "process.stdout.write('started\\n'); setInterval(() => {}, 1000)"],
      cwd: root,
      stdin: "",
      structured: false,
    },
    { timeoutMs: 10_000, signal: controller.signal, onStdoutLine: () => controller.abort() },
  );
  assert.equal(result.cancelled, true);
  assert.equal(result.timedOut, false);
  assert.ok(result.durationMs < 5_000);
});
