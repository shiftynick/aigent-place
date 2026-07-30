import assert from "node:assert/strict";
import {
  chmodSync,
  mkdtempSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  buildCursorArguments,
  buildPayload,
  invokeCursor,
  parseArguments,
  quoteForCmd,
} from "./cursor-agent.mjs";

test("requires an explicit non-auto model", () => {
  assert.throws(
    () => parseArguments(["--prompt", "Review.", "--workspace", process.cwd()]),
    /--model is required/u,
  );
  assert.throws(
    () => parseArguments([
      "--prompt",
      "Review.",
      "--model",
      "auto",
      "--workspace",
      process.cwd(),
    ]),
    /--model auto is not allowed/u,
  );
  assert.equal(
    parseArguments([
      "--prompt",
      "Review.",
      "--model",
      "claude-opus-4-8[context=1m,effort=high,fast=false]",
      "--workspace",
      process.cwd(),
    ]).model,
    "claude-opus-4-8[context=1m,effort=high,fast=false]",
  );
});

test("defaults to read-only ask mode", () => {
  const options = parseArguments([
    "--prompt",
    "Review.",
    "--model",
    "gpt-5.4-mini-low",
    "--workspace",
    process.cwd(),
  ]);
  assert.deepEqual(buildCursorArguments(options), [
    "--print",
    "--trust",
    "--model",
    "gpt-5.4-mini-low",
    "--workspace",
    realpathSync(process.cwd()),
    "--mode",
    "ask",
  ]);
});

test("write mode requires a workspace and always uses a worktree", () => {
  assert.throws(
    () => parseArguments([
      "--prompt",
      "Implement.",
      "--model",
      "gpt-5.4-mini-low",
      "--allow-write",
    ]),
    /--workspace is required/u,
  );
  assert.throws(
    () => parseArguments([
      "--prompt",
      "Implement.",
      "--model",
      "gpt-5.4-mini-low",
      "--allow-write",
      "--workspace",
      process.cwd(),
      "--mode",
      "plan",
    ]),
    /cannot be combined/u,
  );
  const options = parseArguments([
    "--prompt",
    "Implement.",
    "--model",
    "gpt-5.4-mini-low",
    "--allow-write",
    "--workspace",
    process.cwd(),
  ]);
  assert.deepEqual(buildCursorArguments(options, "win32"), [
    "--print",
    "--trust",
    "--model",
    "gpt-5.4-mini-low",
    "--workspace",
    realpathSync(process.cwd()),
    "--worktree",
  ]);
  assert.deepEqual(buildCursorArguments(options, "linux").slice(-3), [
    "--sandbox",
    "enabled",
    "--worktree",
  ]);
});

test("combines instructions with inline, file, or stdin context", () => {
  const base = [
    "--prompt",
    "Review.",
    "--model",
    "gpt-5.4-mini-low",
    "--workspace",
    process.cwd(),
  ];
  assert.equal(
    buildPayload(parseArguments([...base, "--context-text", "diff"])),
    "Instruction:\nReview.\n\nContext:\ndiff\n",
  );
  assert.equal(
    buildPayload(
      parseArguments([...base, "--context-stdin"]),
      "stdin context",
    ),
    "Instruction:\nReview.\n\nContext:\nstdin context\n",
  );

  const tempRoot = mkdtempSync(path.join(os.tmpdir(), "cursor-agent-test-"));
  try {
    const contextFile = path.join(tempRoot, "context.txt");
    writeFileSync(contextFile, "file context", "utf8");
    assert.equal(
      buildPayload(parseArguments([
        ...base,
        "--context-file",
        contextFile,
      ])),
      "Instruction:\nReview.\n\nContext:\nfile context\n",
    );
  } finally {
    rmSync(tempRoot, { recursive: true, force: true });
  }
});

test("rejects ambiguous or unsupported options", () => {
  const base = [
    "--prompt",
    "Review.",
    "--model",
    "gpt-5.4-mini-low",
    "--workspace",
    process.cwd(),
  ];
  assert.throws(
    () => parseArguments([
      ...base,
      "--context-file",
      "a",
      "--context-stdin",
    ]),
    /mutually exclusive/u,
  );
  assert.throws(
    () => parseArguments([...base, "--mode", "agent"]),
    /ask or plan/u,
  );
  assert.throws(
    () => parseArguments([
      "--prompt",
      "Review.",
      "--model",
      "x & whoami",
      "--workspace",
      process.cwd(),
    ]),
    /unsupported characters/u,
  );
  assert.throws(
    () => parseArguments([
      "--prompt",
      "Review.",
      "--model",
      "--force",
      "--workspace",
      process.cwd(),
    ]),
    /unsupported characters/u,
  );
  assert.throws(
    () => parseArguments([...base, "--prompt", "Again."]),
    /only be provided once/u,
  );
});

test("lists models without selecting one and maps JSON output", () => {
  assert.deepEqual(
    buildCursorArguments(parseArguments(["--list-models"])),
    ["models"],
  );
  assert.throws(
    () => parseArguments(["--list-models", "--model", "gpt-5.4-mini-low"]),
    /cannot be combined/u,
  );
  const options = parseArguments([
    "--prompt",
    "Review.",
    "--model",
    "gpt-5.4-mini-low",
    "--workspace",
    process.cwd(),
    "--json",
  ]);
  assert.deepEqual(buildCursorArguments(options).slice(0, 6), [
    "--print",
    "--trust",
    "--model",
    "gpt-5.4-mini-low",
    "--output-format",
    "json",
  ]);
});

test("rejects cmd metacharacters and translates missing executables", () => {
  assert.throws(() => quoteForCmd("bad%PATH%"), /could expand/u);
  const previous = process.env.CURSOR_AGENT_BIN;
  try {
    process.env.CURSOR_AGENT_BIN = path.join(
      os.tmpdir(),
      "definitely-missing-cursor-agent",
    );
    assert.throws(
      () => invokeCursor(["models"], "", {
        stdio: ["pipe", "pipe", "pipe"],
      }),
      /was not found/u,
    );
  } finally {
    if (previous === undefined) delete process.env.CURSOR_AGENT_BIN;
    else process.env.CURSOR_AGENT_BIN = previous;
  }
});

test("launches a POSIX executable and sends payload on stdin", {
  skip: process.platform === "win32",
}, () => {
  const tempRoot = mkdtempSync(path.join(os.tmpdir(), "cursor-shim-test-"));
  const previous = process.env.CURSOR_AGENT_BIN;
  try {
    const shim = path.join(tempRoot, "agent");
    writeFileSync(
      shim,
      "#!/bin/sh\nread PAYLOAD\nprintf 'ARG1:%s\\nPAYLOAD:%s\\n' \"$1\" \"$PAYLOAD\"\n",
      "utf8",
    );
    chmodSync(shim, 0o755);
    process.env.CURSOR_AGENT_BIN = shim;
    const result = invokeCursor(["models"], "hello", {
      stdio: ["pipe", "pipe", "pipe"],
    });
    assert.match(result.stdout, /ARG1:models/u);
    assert.match(result.stdout, /PAYLOAD:hello/u);
  } finally {
    if (previous === undefined) delete process.env.CURSOR_AGENT_BIN;
    else process.env.CURSOR_AGENT_BIN = previous;
    rmSync(tempRoot, { recursive: true, force: true });
  }
});

test("translates a nonzero Cursor exit", () => {
  const tempRoot = mkdtempSync(path.join(os.tmpdir(), "cursor-fail-test-"));
  const previous = process.env.CURSOR_AGENT_BIN;
  try {
    const shim = path.join(
      tempRoot,
      process.platform === "win32" ? "agent.cmd" : "agent",
    );
    writeFileSync(
      shim,
      process.platform === "win32"
        ? "@echo off\r\nexit /b 7\r\n"
        : "#!/bin/sh\nexit 7\n",
      "utf8",
    );
    if (process.platform !== "win32") chmodSync(shim, 0o755);
    process.env.CURSOR_AGENT_BIN = shim;
    assert.throws(
      () => invokeCursor(["models"], "", {
        stdio: ["pipe", "pipe", "pipe"],
      }),
      /failed with exit code 7/u,
    );
  } finally {
    if (previous === undefined) delete process.env.CURSOR_AGENT_BIN;
    else process.env.CURSOR_AGENT_BIN = previous;
    rmSync(tempRoot, { recursive: true, force: true });
  }
});

test("launches a Windows command shim and sends payload on stdin", {
  skip: process.platform !== "win32",
}, () => {
  const tempRoot = mkdtempSync(path.join(os.tmpdir(), "cursor-shim-test-"));
  const previous = process.env.CURSOR_AGENT_BIN;
  try {
    const shim = path.join(tempRoot, "agent.cmd");
    writeFileSync(
      shim,
      "@echo off\r\nset /p PAYLOAD=\r\n"
      + "echo ARG1:%~1\r\n"
      + "echo ARG2:%~2\r\n"
      + "echo ARG3:%~3\r\n"
      + "echo ARG4:%~4\r\n"
      + "echo PAYLOAD:%PAYLOAD%\r\n",
      "utf8",
    );
    process.env.CURSOR_AGENT_BIN = shim;
    const result = invokeCursor(
      ["--print", "--trust", "--model", "gpt-5.4-mini-low"],
      "hello",
      { stdio: ["pipe", "pipe", "pipe"] },
    );
    assert.match(result.stdout, /ARG1:--print/u);
    assert.match(result.stdout, /ARG2:--trust/u);
    assert.match(result.stdout, /ARG3:--model/u);
    assert.match(result.stdout, /ARG4:gpt-5.4-mini-low/u);
    assert.match(result.stdout, /PAYLOAD:hello/u);
  } finally {
    if (previous === undefined) {
      delete process.env.CURSOR_AGENT_BIN;
    } else {
      process.env.CURSOR_AGENT_BIN = previous;
    }
    rmSync(tempRoot, { recursive: true, force: true });
  }
});
