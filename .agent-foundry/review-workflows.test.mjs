import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";
import {
  buildAxisPrompt,
  checkPacket,
  initPacket,
} from "./review-packet.mjs";
import { buildRunnerArgs, runColdReview } from "./cold-review.mjs";
import { buildDelegateArgs, checkEnvironmentFacts, runDelegate } from "./delegate-work.mjs";
import { isPidAlive, runManagedNode } from "./process-tree.mjs";

function fillPacket(dir) {
  writeFileSync(join(dir, "objective.txt"), "Ship the timeout fix.\n");
  writeFileSync(join(dir, "rubric.txt"), "(1) timeout default is 25m\n(2) --timeout-ms works\n");
  writeFileSync(join(dir, "diff.patch"), "diff --git a/x b/x\n+hello\n");
  writeFileSync(join(dir, "status.txt"), " M x\n");
  writeFileSync(join(dir, "untracked.txt"), "");
  writeFileSync(join(dir, "evidence.md"), "run: node --test … exit 0\n");
  writeFileSync(join(dir, "decisions.md"), "none\n");
  writeFileSync(join(dir, "review-standards.md"), "# Review standards\n- no secrets\n");
}

describe("review-packet", () => {
  it("init then check passes when required fields are filled", () => {
    const repo = mkdtempSync(join(tmpdir(), "pkt-repo-"));
    const dir = join(repo, ".tasks", "review-packets", "t1");
    initPacket(dir, { taskId: "task-046", round: 1, repoRoot: repo });
    fillPacket(dir);
    const result = checkPacket(dir, { repoRoot: repo });
    assert.equal(result.ok, true);
    assert.equal(result.packet.manifest.taskId, "task-046");
  });

  it("refuses an incomplete packet", () => {
    const repo = mkdtempSync(join(tmpdir(), "pkt-bad-repo-"));
    const dir = join(repo, "packet");
    initPacket(dir, { taskId: "task-001", repoRoot: repo });
    const result = checkPacket(dir, { repoRoot: repo });
    assert.equal(result.ok, false);
    assert.ok(result.problems.some((p) => p.includes("objective.txt")));
  });

  it("refuses empty diff with empty untracked", () => {
    const repo = mkdtempSync(join(tmpdir(), "pkt-empty-repo-"));
    const dir = join(repo, "packet");
    initPacket(dir, { taskId: "task-001", repoRoot: repo });
    fillPacket(dir);
    writeFileSync(join(dir, "diff.patch"), "");
    writeFileSync(join(dir, "untracked.txt"), "");
    const result = checkPacket(dir, { repoRoot: repo });
    assert.equal(result.ok, false);
    assert.ok(result.problems.some((p) => p.includes("no change surface")));
  });

  it("builds COMBINED prompts that include standards", () => {
    const repo = mkdtempSync(join(tmpdir(), "pkt-prompt-repo-"));
    const dir = join(repo, "packet");
    initPacket(dir, { taskId: "task-046", repoRoot: repo });
    fillPacket(dir);
    const { packet } = checkPacket(dir, { repoRoot: repo });
    const spec = buildAxisPrompt(packet, "SPEC");
    const combined = buildAxisPrompt(packet, "COMBINED");
    assert.match(spec, /Axis: SPEC/);
    assert.doesNotMatch(spec, /Attached review standards/);
    assert.match(combined, /Axis: COMBINED/);
    assert.match(combined, /Attached review standards/);
    assert.match(combined, /no secrets/);
  });

  it("refuses writing packet stubs through a dangling symlink", () => {
    const repo = mkdtempSync(join(tmpdir(), "pkt-sym-repo-"));
    const dir = join(repo, "packet");
    initPacket(dir, { taskId: "task-001", repoRoot: repo });
    const outside = join(repo, "outside-target.txt");
    const link = join(dir, "objective.txt");
    rmSync(link, { force: true });
    try {
      symlinkSync(outside, link);
    } catch {
      // Symlinks may be unavailable on this host; confinement still covered by
      // the outside-root test and O_EXCL write path.
      return;
    }
    assert.throws(
      () => initPacket(dir, { taskId: "task-001", repoRoot: repo }),
      /symlink|EEXIST/i,
    );
    assert.equal(existsSync(outside), false);
  });
});

describe("cold-review argv", () => {
  it("bakes answer-only, json, and ephemeral for claude", () => {
    const args = buildRunnerArgs({
      runner: "cli.js",
      provider: "claude",
      model: "claude-fable-5",
      cwd: "/repo",
      promptFile: "/tmp/spec.md",
      timeoutMs: 1200000,
      maxBudgetUsd: "3",
      trustWorkspace: false,
    });
    assert.ok(args.includes("answer-only"));
    assert.ok(args.includes("--json"));
    assert.ok(args.includes("ephemeral"));
    assert.ok(args.includes("claude-fable-5"));
  });

  it("omits ephemeral for cursor", () => {
    const args = buildRunnerArgs({
      runner: "cli.js",
      provider: "cursor",
      model: "cursor-grok-4.5-medium",
      cwd: "/repo",
      promptFile: "/tmp/spec.md",
      timeoutMs: 1200000,
      trustWorkspace: true,
    });
    assert.equal(args.includes("ephemeral"), false);
    assert.ok(args.includes("--trust-workspace"));
  });

  it("runColdReview dry-run and fake-runner succeed on a complete packet", async () => {
    const repo = mkdtempSync(join(tmpdir(), "cold-repo-"));
    const dir = join(repo, "packet");
    initPacket(dir, { taskId: "task-046", repoRoot: repo });
    fillPacket(dir);
    const fakeRunner = join(repo, "fake-runner.js");
    writeFileSync(
      fakeRunner,
      [
        "#!/usr/bin/env node",
        "const payload = {",
        "  status: 'succeeded',",
        "  provider: 'fake',",
        "  finalText: 'PASS\\n\\nCHECKED\\n- rubric 1 | inspected',",
        "  workspace: { cwd: process.cwd(), access: 'answer-only' },",
        "};",
        "process.stdout.write(JSON.stringify(payload));",
        "",
      ].join("\n"),
    );
    const dry = await runColdReview({
      provider: "codex",
      packet: dir,
      cwd: repo,
      timeoutMs: 5000,
      dryRun: true,
      axis: "COMBINED",
      runner: fakeRunner,
    });
    assert.equal(dry.ok, true);
    assert.equal(dry.dryRun, true);

    const live = await runColdReview({
      provider: "codex",
      packet: dir,
      cwd: repo,
      timeoutMs: 10000,
      dryRun: false,
      axis: "both",
      runner: fakeRunner,
    });
    assert.equal(live.ok, true);
    assert.equal(live.axes.SPEC.status, "succeeded");
    assert.equal(live.axes.STANDARDS.status, "succeeded");
  });
});

describe("delegate-work", () => {
  it("requires Environment facts bullets", () => {
    const bad = checkEnvironmentFacts("# Task\n\nDo the thing.\n");
    assert.equal(bad.ok, false);
    const good = checkEnvironmentFacts(
      "# Task\n\n## Environment facts\n\n- Auth: use memory/gh-token-invocation.md\n- Repo slug: org/name\n\n## Objective\n\nEdit foo.\n",
    );
    assert.equal(good.ok, true);
    assert.equal(good.bullets.length, 2);
  });

  it("defaults access mode per provider", () => {
    const claude = buildDelegateArgs({
      provider: "claude",
      runner: "cli.js",
      cwd: "/repo",
      promptFile: "/tmp/t.md",
      timeoutMs: 1200000,
    });
    assert.equal(claude.access, "edit-isolated");
    assert.ok(claude.args.includes("ephemeral"));

    const codex = buildDelegateArgs({
      provider: "codex",
      runner: "cli.js",
      cwd: "/repo",
      promptFile: "/tmp/t.md",
      timeoutMs: 1200000,
    });
    assert.equal(codex.access, "edit-workspace");

    const cursor = buildDelegateArgs({
      provider: "cursor",
      runner: "cli.js",
      cwd: "/repo",
      promptFile: "/tmp/t.md",
      timeoutMs: 1200000,
      trustWorkspace: true,
    });
    assert.equal(cursor.access, "edit-isolated");
    assert.equal(cursor.args.includes("ephemeral"), false);
    assert.ok(cursor.args.includes("--trust-workspace"));
  });

  it("runDelegate dry-run accepts Environment facts and refuses without them", async () => {
    const repo = mkdtempSync(join(tmpdir(), "del-repo-"));
    const good = join(repo, "good.md");
    const bad = join(repo, "bad.md");
    writeFileSync(
      good,
      "# Task\n\n## Environment facts\n\n- Auth: memory/gh-token-invocation.md\n\n## Objective\n\nEdit foo.\n",
    );
    writeFileSync(bad, "# Task\n\nJust do it.\n");
    const ok = await runDelegate({
      provider: "claude",
      promptFile: good,
      cwd: repo,
      timeoutMs: 1000,
      dryRun: true,
      runner: join(repo, "unused.js"),
    });
    assert.equal(ok.ok, true);
    assert.equal(ok.access, "edit-isolated");
    const no = await runDelegate({
      provider: "claude",
      promptFile: bad,
      cwd: repo,
      timeoutMs: 1000,
      dryRun: true,
      runner: join(repo, "unused.js"),
    });
    assert.equal(no.ok, false);
  });

  it("runDelegate live fake-runner returns succeeded", async () => {
    const repo = mkdtempSync(join(tmpdir(), "del-live-"));
    const prompt = join(repo, "task.md");
    writeFileSync(
      prompt,
      "# Task\n\n## Environment facts\n\n- Repo slug: example/foundry\n\n## Objective\n\nEdit foo.\n",
    );
    const fakeRunner = join(repo, "fake-runner.js");
    writeFileSync(
      fakeRunner,
      [
        "#!/usr/bin/env node",
        "const payload = {",
        "  status: 'succeeded',",
        "  provider: 'fake',",
        "  finalText: 'done',",
        "  workspace: { cwd: process.cwd(), access: 'edit-isolated' },",
        "};",
        "process.stdout.write(JSON.stringify(payload));",
        "",
      ].join("\n"),
    );
    const live = await runDelegate({
      provider: "claude",
      promptFile: prompt,
      cwd: repo,
      timeoutMs: 10000,
      dryRun: false,
      runner: fakeRunner,
    });
    assert.equal(live.ok, true);
    assert.equal(live.status, "succeeded");
    assert.equal(live.access, "edit-isolated");
  });
});

describe("process-tree timeout reap", () => {
  it("runManagedNode kills a hung child and its descendant", async () => {
    const repo = mkdtempSync(join(tmpdir(), "reap-"));
    const marker = join(repo, "pids.json");
    const hang = join(repo, "hang.js");
    writeFileSync(
      hang,
      [
        "const { spawn } = require('node:child_process');",
        "const { writeFileSync } = require('node:fs');",
        "const marker = process.argv[2];",
        "const child = spawn(process.execPath, ['-e', 'Atomics.wait(new Int32Array(new SharedArrayBuffer(4)),0,0,120000)'], { stdio: 'ignore', windowsHide: true });",
        "writeFileSync(marker, JSON.stringify({ parent: process.pid, child: child.pid }));",
        "Atomics.wait(new Int32Array(new SharedArrayBuffer(4)),0,0,120000);",
        "",
      ].join("\n"),
    );
    const outcome = await runManagedNode([hang, marker], { timeoutMs: 400, graceMs: 0 });
    assert.equal(outcome.status, "timed-out");
    assert.ok(existsSync(marker), "hang script should have written pids");
    const pids = JSON.parse(readFileSync(marker, "utf8"));
    // Brief settle for taskkill / process group teardown.
    await new Promise((r) => setTimeout(r, 500));
    assert.equal(isPidAlive(pids.parent), false, `parent ${pids.parent} still alive`);
    assert.equal(isPidAlive(pids.child), false, `child ${pids.child} still alive`);
  });

  it("cold-review reports timed-out and reaps a hung fake runner", async () => {
    const repo = mkdtempSync(join(tmpdir(), "cold-reap-"));
    const dir = join(repo, "packet");
    initPacket(dir, { taskId: "task-047", repoRoot: repo });
    fillPacket(dir);
    const hang = join(repo, "hang-runner.js");
    writeFileSync(
      hang,
      [
        "Atomics.wait(new Int32Array(new SharedArrayBuffer(4)),0,0,120000);",
        "",
      ].join("\n"),
    );
    const result = await runColdReview({
      provider: "codex",
      packet: dir,
      cwd: repo,
      timeoutMs: 400,
      graceMs: 0,
      dryRun: false,
      axis: "SPEC",
      runner: hang,
    });
    assert.equal(result.ok, false);
    assert.equal(result.axes.SPEC.status, "timed-out");
  });

  it("delegate-work reports timed-out for a hung fake runner", async () => {
    const repo = mkdtempSync(join(tmpdir(), "del-reap-"));
    const prompt = join(repo, "task.md");
    writeFileSync(
      prompt,
      "# Task\n\n## Environment facts\n\n- Repo slug: example/foundry\n\n## Objective\n\nHang.\n",
    );
    const hang = join(repo, "hang-runner.js");
    writeFileSync(
      hang,
      ["Atomics.wait(new Int32Array(new SharedArrayBuffer(4)),0,0,120000);", ""].join("\n"),
    );
    const result = await runDelegate({
      provider: "claude",
      promptFile: prompt,
      cwd: repo,
      timeoutMs: 400,
      graceMs: 0,
      dryRun: false,
      runner: hang,
    });
    assert.equal(result.ok, false);
    assert.equal(result.status, "timed-out");
    if (result.pid) {
      await new Promise((r) => setTimeout(r, 500));
      assert.equal(isPidAlive(result.pid), false, `delegate pid ${result.pid} still alive`);
    }
  });
});
