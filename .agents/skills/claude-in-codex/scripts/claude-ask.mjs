#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const definitions = new Map([
  ["--prompt", { name: "prompt", takesValue: true }],
  ["--context-file", { name: "contextFile", takesValue: true }],
  ["--context-text", { name: "contextText", takesValue: true }],
  ["--context-stdin", { name: "contextStdin", takesValue: false }],
  ["--model", { name: "model", takesValue: true }],
  ["--effort", { name: "effort", takesValue: true }],
  ["--max-budget-usd", { name: "maxBudgetUsd", takesValue: true }],
  ["--json", { name: "json", takesValue: false }],
  ["--help", { name: "help", takesValue: false }],
]);

const usage = [
  "Usage:",
  "  node claude-ask.mjs --prompt <instruction> [options]",
  "",
  "Options:",
  "  --context-file <path>      Append UTF-8 file content as context.",
  "  --context-text <text>      Append inline context.",
  "  --context-stdin            Read context from standard input.",
  "  --model <name>             Claude model alias or full model name.",
  "  --effort <level>           low, medium, high, xhigh, or max.",
  "  --max-budget-usd <amount>  Positive API-spend cap.",
  "  --json                     Emit Claude's raw JSON result object.",
  "  --help                     Show this help.",
].join("\n");

export function parseArguments(args) {
  const options = {};
  const seen = new Set();

  for (let index = 0; index < args.length; index += 1) {
    const raw = args[index];
    const equalsIndex = raw.indexOf("=");
    const flag = equalsIndex === -1 ? raw : raw.slice(0, equalsIndex);
    const inlineValue = equalsIndex === -1
      ? undefined
      : raw.slice(equalsIndex + 1);
    const definition = definitions.get(flag);
    if (!definition) {
      throw new Error(`Unknown option: ${flag}\n\n${usage}`);
    }
    if (seen.has(flag)) {
      throw new Error(`Option may only be provided once: ${flag}`);
    }
    seen.add(flag);

    if (!definition.takesValue) {
      if (inlineValue !== undefined) {
        throw new Error(`${flag} does not take a value.`);
      }
      options[definition.name] = true;
      continue;
    }

    const value = inlineValue ?? args[index + 1];
    if (inlineValue === undefined) {
      index += 1;
    }
    if (
      value === undefined
      || value === ""
      || (inlineValue === undefined && definitions.has(value))
    ) {
      throw new Error(`${flag} requires a non-empty value.`);
    }
    options[definition.name] = value;
  }

  // `--help` short-circuits every other check: asking how to use the tool must
  // not fail because an unrelated flag on the same line is malformed.
  if (options.help) {
    return options;
  }
  if (!options.prompt) {
    throw new Error(`--prompt is required.\n\n${usage}`);
  }
  const contextSources = [
    options.contextFile,
    options.contextText,
    options.contextStdin,
  ].filter(Boolean);
  if (contextSources.length > 1) {
    throw new Error(
      "Context inputs are mutually exclusive.",
    );
  }
  if (
    options.effort
    && !["low", "medium", "high", "xhigh", "max"].includes(options.effort)
  ) {
    throw new Error(
      "--effort must be one of: low, medium, high, xhigh, max.",
    );
  }
  if (options.model && !/^[A-Za-z0-9._:/-]+$/u.test(options.model)) {
    throw new Error("--model contains unsupported characters.");
  }
  if (options.maxBudgetUsd) {
    const budget = Number(options.maxBudgetUsd);
    if (!Number.isFinite(budget) || budget <= 0) {
      throw new Error("--max-budget-usd must be a positive number.");
    }
    options.maxBudgetUsd = String(budget);
  }

  return options;
}

export function buildClaudeArguments(options) {
  const args = [
    "-p",
    "--no-session-persistence",
    "--permission-mode",
    "dontAsk",
    "--tools=",
  ];
  if (options.json) {
    args.push("--output-format", "json");
  }
  if (options.model) {
    args.push("--model", options.model);
  }
  if (options.effort) {
    args.push("--effort", options.effort);
  }
  if (options.maxBudgetUsd) {
    args.push("--max-budget-usd", options.maxBudgetUsd);
  }
  return args;
}

export function buildPayload(options, stdinText) {
  let context;
  if (options.contextFile) {
    if (!existsSync(options.contextFile)) {
      throw new Error(`Context file not found: ${options.contextFile}`);
    }
    context = readFileSync(options.contextFile, "utf8");
  } else if (options.contextStdin) {
    if (stdinText === undefined) {
      throw new Error("--context-stdin did not provide any input.");
    }
    context = stdinText;
  } else {
    context = options.contextText;
  }

  return context === undefined
    ? options.prompt
    : `Instruction:\n${options.prompt}\n\nContext:\n${context}\n`;
}

function quoteForCmd(value) {
  if (/[\r\n%!]/u.test(value)) {
    // cmd.exe expands %VAR% and (with delayed expansion) !VAR! inside quotes,
    // so these cannot be passed through a .cmd shim safely.
    throw new Error(
      "A Windows command argument contains characters cmd.exe would expand "
      + `(newline, % or !): ${value}\n`
      + "Set CLAUDE_BIN to the Claude executable directly to bypass the "
      + ".cmd shim.",
    );
  }
  return `"${value.replaceAll('"', '""')}"`;
}

function resolveWindowsCommand(command) {
  if (
    path.isAbsolute(command)
    || command.includes("/")
    || command.includes("\\")
  ) {
    return command;
  }
  const extensions = (process.env.PATHEXT ?? ".COM;.EXE;.BAT;.CMD")
    .split(";")
    .filter(Boolean);
  const directories = (process.env.PATH ?? "").split(path.delimiter);
  for (const directory of directories.filter((item) => (
    item && path.isAbsolute(item)
  ))) {
    for (const extension of extensions) {
      const candidate = path.join(directory, `${command}${extension}`);
      if (existsSync(candidate)) {
        return candidate;
      }
    }
  }
  return command;
}

export function invokeClaude(args, payload, options = {}) {
  let command = process.env.CLAUDE_BIN || "claude";
  let commandArgs = args;
  let windowsVerbatimArguments = false;
  if (process.platform === "win32") {
    command = resolveWindowsCommand(command);
    if (/\.(?:cmd|bat)$/iu.test(command)) {
      const commandLine = `"${[command, ...args]
        .map(quoteForCmd)
        .join(" ")}"`;
      command = process.env.ComSpec || "cmd.exe";
      commandArgs = ["/d", "/s", "/c", commandLine];
      windowsVerbatimArguments = true;
    }
  }

  const result = spawnSync(command, commandArgs, {
    encoding: "utf8",
    input: payload,
    stdio: options.stdio ?? ["pipe", "inherit", "inherit"],
    maxBuffer: options.maxBuffer ?? 16 * 1024 * 1024,
    timeout: options.timeout ?? 20 * 60 * 1000,
    killSignal: "SIGTERM",
    windowsVerbatimArguments,
    windowsHide: true,
  });
  if (result.error) {
    if (result.error.code === "ETIMEDOUT") {
      throw new Error("claude -p timed out");
    }
    if (result.error.code === "ENOENT") {
      throw new Error(
        `Unable to start Claude CLI: ${command} was not found. Install the `
        + "Claude CLI, or set CLAUDE_BIN to its executable or shim path.",
        { cause: result.error },
      );
    }
    throw new Error(`Unable to start Claude CLI: ${result.error.message}`, {
      cause: result.error,
    });
  }
  if (result.status !== 0) {
    const outcome = result.signal
      ? `was terminated by signal ${result.signal}`
      : `failed with exit code ${result.status}`;
    throw new Error(
      `claude -p ${outcome}. If the failure names an unknown flag, this `
      + "skill's documented CLI contract has aged — re-check `claude --help`.",
    );
  }
  return result;
}

function main() {
  try {
    const options = parseArguments(process.argv.slice(2));
    if (options.help) {
      console.log(usage);
      return;
    }
    if (options.contextStdin && process.stdin.isTTY) {
      throw new Error(
        "--context-stdin requires piped input; standard input is a terminal.",
      );
    }
    const stdinText = options.contextStdin ? readFileSync(0, "utf8") : undefined;
    invokeClaude(
      buildClaudeArguments(options),
      buildPayload(options, stdinText),
    );
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}

const currentFile = fileURLToPath(import.meta.url);
if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(currentFile)) {
  main();
}
