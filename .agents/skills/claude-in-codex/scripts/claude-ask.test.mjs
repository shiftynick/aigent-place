import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  buildClaudeArguments,
  buildPayload,
  invokeClaude,
  parseArguments,
} from "./claude-ask.mjs";

test("--help short-circuits validation of every other option", () => {
  // Asking how to use the tool must not fail because an unrelated flag on the
  // same line is malformed, and must not demand --prompt.
  assert.equal(parseArguments(["--help"]).help, true);
  assert.equal(parseArguments(["--help", "--effort", "bogus"]).help, true);
  assert.equal(
    parseArguments(["--help", "--max-budget-usd", "-1"]).help,
    true,
  );
});

test("rejects an invalid effort when help is not requested", () => {
  assert.throws(
    () => parseArguments(["--prompt", "hi", "--effort", "bogus"]),
    /--effort must be one of/u,
  );
});

test("builds a cold read-only Claude invocation", () => {
  const options = parseArguments([
    "--prompt",
    "Review this.",
    "--model",
    "sonnet",
    "--effort",
    "high",
    "--max-budget-usd",
    "3.00",
    "--json",
  ]);
  assert.deepEqual(buildClaudeArguments(options), [
    "-p",
    "--no-session-persistence",
    "--permission-mode",
    "dontAsk",
    "--tools=",
    "--output-format",
    "json",
    "--model",
    "sonnet",
    "--effort",
    "high",
    "--max-budget-usd",
    "3",
  ]);
  assert.equal(buildPayload(options), "Review this.");
});

test("combines the instruction with inline or file context", () => {
  assert.equal(
    buildPayload(parseArguments([
      "--prompt",
      "Review.",
      "--context-text",
      "diff",
    ])),
    "Instruction:\nReview.\n\nContext:\ndiff\n",
  );
  assert.equal(
    buildPayload(parseArguments([
      "--prompt",
      "Review.",
      "--context-stdin",
    ]), "stdin context"),
    "Instruction:\nReview.\n\nContext:\nstdin context\n",
  );

  const tempRoot = mkdtempSync(path.join(os.tmpdir(), "claude-ask-test-"));
  try {
    const contextFile = path.join(tempRoot, "context.txt");
    writeFileSync(contextFile, "file context", "utf8");
    assert.equal(
      buildPayload(parseArguments([
        "--prompt",
        "Summarize.",
        "--context-file",
        contextFile,
      ])),
      "Instruction:\nSummarize.\n\nContext:\nfile context\n",
    );
  } finally {
    rmSync(tempRoot, { recursive: true, force: true });
  }
});

test("rejects ambiguous or unsafe options", () => {
  assert.throws(
    () => parseArguments([
      "--prompt",
      "Review.",
      "--context-file",
      "a",
      "--context-text",
      "b",
    ]),
    /mutually exclusive/u,
  );
  assert.throws(
    () => parseArguments([
      "--prompt",
      "Review.",
      "--context-file",
      "a",
      "--context-stdin",
    ]),
    /mutually exclusive/u,
  );
  assert.throws(
    () => parseArguments(["--prompt", "Review.", "--effort", "extreme"]),
    /--effort/u,
  );
  assert.throws(
    () => parseArguments(["--prompt", "Review.", "--model", "x & whoami"]),
    /--model/u,
  );
  assert.throws(
    () => parseArguments(["--prompt", "--json"]),
    /requires a non-empty value/u,
  );
  assert.throws(
    () => parseArguments([
      "--prompt",
      "Review.",
      "--prompt",
      "Again.",
    ]),
    /only be provided once/u,
  );
  assert.throws(
    () => buildPayload(parseArguments([
      "--prompt",
      "Review.",
      "--context-stdin",
    ])),
    /did not provide any input/u,
  );
});

test("launches a Windows command shim without corrupting arguments", {
  skip: process.platform !== "win32",
}, () => {
  const tempRoot = mkdtempSync(path.join(os.tmpdir(), "claude-shim-test-"));
  const previous = process.env.CLAUDE_BIN;
  try {
    const shim = path.join(tempRoot, "claude.cmd");
    writeFileSync(
      shim,
      "@echo off\r\nset /p PAYLOAD=\r\necho ARG1:%~1\r\necho ARG2:%~2\r\necho ARG3:%~3\r\necho ARG4:%~4\r\necho PAYLOAD:%PAYLOAD%\r\n",
      "utf8",
    );
    process.env.CLAUDE_BIN = shim;
    const result = invokeClaude(
      ["-p", "--permission-mode", "dontAsk", "--tools="],
      "hello",
      { stdio: ["pipe", "pipe", "pipe"] },
    );
    assert.match(result.stdout, /ARG1:-p/u);
    assert.match(result.stdout, /ARG2:--permission-mode/u);
    assert.match(result.stdout, /ARG3:dontAsk/u);
    assert.match(result.stdout, /ARG4:--tools=/u);
    assert.match(result.stdout, /PAYLOAD:hello/u);
  } finally {
    if (previous === undefined) {
      delete process.env.CLAUDE_BIN;
    } else {
      process.env.CLAUDE_BIN = previous;
    }
    rmSync(tempRoot, { recursive: true, force: true });
  }
});
