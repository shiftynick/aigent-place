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
