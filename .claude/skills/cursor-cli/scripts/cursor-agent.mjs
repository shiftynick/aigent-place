#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, realpathSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const definitions = new Map([
  ["--prompt", { name: "prompt", takesValue: true }],
  ["--context-file", { name: "contextFile", takesValue: true }],
  ["--context-text", { name: "contextText", takesValue: true }],
  ["--context-stdin", { name: "contextStdin", takesValue: false }],
  ["--model", { name: "model", takesValue: true }],
  ["--mode", { name: "mode", takesValue: true }],
  ["--workspace", { name: "workspace", takesValue: true }],
  ["--allow-write", { name: "allowWrite", takesValue: false }],
  ["--list-models", { name: "listModels", takesValue: false }],
  ["--json", { name: "json", takesValue: false }],
  ["--help", { name: "help", takesValue: false }],
]);

const usage = [
  "Usage:",
  "  node cursor-agent.mjs --model <id> --prompt <instruction> [options]",
  "",
  "Options:",
  "  --context-file <path>  Append UTF-8 file content as context.",
  "  --context-text <text>  Append inline context.",
  "  --context-stdin        Read context from standard input.",
  "  --model <id>           Required explicit Cursor model ID; auto is rejected.",
  "  --mode <ask|plan>      Read-only mode. Defaults to ask.",
  "  --workspace <path>     Scope the Cursor workspace.",
  "  --allow-write          Use an isolated Cursor worktree; requires workspace.",
  "  --list-models          List available models and exit.",
  "  --json                 Request JSON output.",
  "  --help                 Show this help.",
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
    if (inlineValue === undefined) index += 1;
    if (
      value === undefined
      || value === ""
      || (inlineValue === undefined && definitions.has(value))
    ) {
      throw new Error(`${flag} requires a non-empty value.`);
    }
    options[definition.name] = value;
  }

  if (options.help) return options;
  if (options.listModels) {
    if (Object.keys(options).length !== 1) {
      throw new Error("--list-models cannot be combined with other options.");
    }
    return options;
  }
  if (!options.prompt) {
    throw new Error(`--prompt is required.\n\n${usage}`);
  }
  if (!options.model) {
    throw new Error(
      `--model is required; list choices with \`agent models\`.\n\n${usage}`,
    );
  }
  if (options.model.toLowerCase() === "auto") {
    throw new Error("--model auto is not allowed; name the exact model ID.");
  }
  if (!/^[A-Za-z0-9][A-Za-z0-9._:/,[\]=+-]*$/u.test(options.model)) {
    throw new Error("--model contains unsupported characters.");
  }
  const contextSources = [
    options.contextFile,
    options.contextText,
    options.contextStdin,
  ].filter(Boolean);
  if (contextSources.length > 1) {
    throw new Error("Context inputs are mutually exclusive.");
  }
  if (options.mode && !["ask", "plan"].includes(options.mode)) {
    throw new Error("--mode must be ask or plan.");
  }
  if (options.allowWrite && options.mode) {
    throw new Error("--allow-write cannot be combined with --mode.");
  }
  if (!options.workspace) {
    throw new Error("--workspace is required for every Cursor invocation.");
  }
  if (!existsSync(options.workspace) || !statSync(options.workspace).isDirectory()) {
    throw new Error("--workspace must name an existing directory.");
  }
  options.workspace = realpathSync(options.workspace);
  if (!options.allowWrite) options.mode ??= "ask";
  return options;
}

export function buildCursorArguments(options, platform = process.platform) {
  if (options.listModels) return ["models"];
  const args = ["--print", "--trust", "--model", options.model];
  if (options.json) args.push("--output-format", "json");
  if (options.workspace) args.push("--workspace", options.workspace);
  if (options.allowWrite) {
    if (platform !== "win32") args.push("--sandbox", "enabled");
    args.push("--worktree");
  } else {
    args.push("--mode", options.mode);
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

export function quoteForCmd(value) {
  if (/[\r\n%!]/u.test(value)) {
    throw new Error(
      "A Windows command argument contains newline, % or !, which a .cmd "
      + "shim could expand. Set CURSOR_AGENT_BIN to the executable directly.",
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
      if (existsSync(candidate)) return candidate;
    }
  }
  return command;
}

export function invokeCursor(args, payload, options = {}) {
  let command = process.env.CURSOR_AGENT_BIN || "agent";
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
      throw new Error("Cursor Agent timed out.");
    }
    if (result.error.code === "ENOENT") {
      throw new Error(
        `Unable to start Cursor Agent: ${command} was not found. Install it, `
        + "put `agent` on PATH, or set CURSOR_AGENT_BIN.",
        { cause: result.error },
      );
    }
    throw new Error(`Unable to start Cursor Agent: ${result.error.message}`, {
      cause: result.error,
    });
  }
  if (result.status !== 0) {
    const outcome = result.signal
      ? `was terminated by signal ${result.signal}`
      : `failed with exit code ${result.status}`;
    throw new Error(
      `Cursor Agent ${outcome}. Re-check authentication, workspace trust, `
      + "the selected model ID, and `agent --help`.",
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
    if (options.listModels) {
      invokeCursor(buildCursorArguments(options), "");
      return;
    }
    if (options.contextStdin && process.stdin.isTTY) {
      throw new Error(
        "--context-stdin requires piped input; standard input is a terminal.",
      );
    }
    const stdinText = options.contextStdin ? readFileSync(0, "utf8") : undefined;
    const cursorArgs = buildCursorArguments(options);
    console.error(
      `cursor-agent: model=${options.model} mode=${options.allowWrite ? "write-worktree" : options.mode} workspace=${options.workspace}`,
    );
    invokeCursor(
      cursorArgs,
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
