import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
  chmodSync,
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  rmdirSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const HOOK = join(dirname(fileURLToPath(import.meta.url)), "pre-commit");
const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");

function resolveShell() {
  if (process.platform === "win32") {
    const git = spawnSync("git", ["--exec-path"], { encoding: "utf8" });
    if (!git.error && git.status === 0) {
      const candidate = resolve(
        git.stdout.trim(),
        "..",
        "..",
        "..",
        "usr",
        "bin",
        "sh.exe",
      );
      if (existsSync(candidate)) {
        return candidate;
      }
    }
  }

  const direct = spawnSync("sh", ["-c", "command -v sh"], {
    encoding: "utf8",
  });
  if (!direct.error && direct.status === 0 && direct.stdout.trim()) {
    const candidate = resolve(direct.stdout.trim());
    if (existsSync(candidate)) {
      return candidate;
    }
  }

  throw new Error(
    "pre-commit tests require a POSIX shell; install Git for Windows or sh",
  );
}

const SHELL = resolveShell();
const SHELL_DIR = dirname(SHELL);

function toPosixPath(filePath) {
  const normalized = filePath.replaceAll("\\", "/");
  const match = normalized.match(/^([A-Za-z]):(.*)$/);
  if (match) {
    return `/${match[1].toLowerCase()}${match[2]}`;
  }
  return normalized;
}

function writeShellHelpers(dir) {
  for (const helper of ["dirname", "cat"]) {
    const found = spawnSync(SHELL, ["-c", `command -v ${helper}`], {
      cwd: ROOT,
      encoding: "utf8",
    });
    if (found.error || found.status !== 0 || !found.stdout.trim()) {
      throw new Error(`pre-commit tests require the shell helper ${helper}`);
    }
    // Preserve Git-sh's absolute POSIX paths on Windows. Forward to the
    // original executables so their native DLLs stay beside them.
    const foundPath = found.stdout.trim();
    const target = toPosixPath(
      foundPath.startsWith("/") ? foundPath : resolve(ROOT, foundPath),
    );
    const quoted = `'${target.replaceAll("'", "'\\''")}'`;
    const stub = join(dir, helper);
    writeFileSync(stub, `#!/bin/sh\nexec ${quoted} "$@"\n`, "utf8");
    chmodSync(stub, 0o755);
  }
}

function writeNodeStub(exitCode) {
  const dir = mkdtempSync(join(tmpdir(), "aigent-precommit-node-"));
  const stub = join(dir, "node");
  // Git-sh PATH shim: any `node ...` invocation returns the stub exit code so
  // the hook's success/failure branches are exercised without a bypass env var.
  writeFileSync(stub, `#!/bin/sh\nexit ${exitCode}\n`, "utf8");
  chmodSync(stub, 0o755);
  return dir;
}

function pathWithStubFirst(stubDir) {
  // Git's sh uses `:` even on Windows; keep the shell dir so sh helpers resolve.
  return `${toPosixPath(stubDir)}:${toPosixPath(SHELL_DIR)}`;
}

function runHook(envExtra = {}) {
  const env = { ...process.env, ...envExtra };
  const result = spawnSync(SHELL, [HOOK], {
    cwd: ROOT,
    encoding: "utf8",
    env,
    timeout: 15_000,
  });
  if (result.error) {
    throw result.error;
  }
  return result;
}

test("pre-commit hook is executable POSIX shell without bypass guidance", () => {
  const source = readFileSync(HOOK, "utf8");
  assert.match(source, /^#!\/bin\/sh\b/m);
  assert.match(source, /product-check\.mjs --fast/);
  assert.equal(source.includes("--no-verify"), false);
  assert.equal(/\bHUSKY\b/.test(source), false);
  assert.equal(/SKIP(_|\b)/.test(source), false);
  assert.equal(source.includes("AIGENT_PRECOMMIT"), false);

  const tracked = spawnSync(
    "git",
    ["ls-files", "-s", "--", ".githooks/pre-commit"],
    { cwd: ROOT, encoding: "utf8" },
  );
  assert.equal(tracked.status, 0, tracked.stderr);
  const modeLine = tracked.stdout.trim();
  if (modeLine) {
    assert.match(
      modeLine,
      /^100755\b/,
      `expected executable index mode, got: ${modeLine}`,
    );
  }
});

test("pre-commit fast subset invocation is documented in the hook body", () => {
  const source = readFileSync(HOOK, "utf8");
  assert.match(source, /core\.hooksPath \.githooks/);
  assert.match(source, /node scripts\/check\.mjs/);
});

test("pre-commit hook runs under sh and reaches the product-check command", () => {
  const syntax = spawnSync(SHELL, ["-n", HOOK], {
    cwd: ROOT,
    encoding: "utf8",
    timeout: 5_000,
  });
  assert.equal(syntax.status, 0, syntax.stderr || syntax.stdout);
});

test("pre-commit fails when node is missing from PATH", () => {
  const dir = mkdtempSync(join(tmpdir(), "aigent-precommit-no-node-"));
  try {
    writeShellHelpers(dir);
    const pathValue = toPosixPath(dir);
    const result = runHook({
      PATH: pathValue,
      Path: pathValue,
    });
    assert.equal(result.status, 1, `${result.stderr}\n${result.stdout}`);
    assert.match(result.stderr, /node is required/);
    assert.match(result.stderr, /\.nvmrc/);
  } finally {
    for (const helper of ["dirname", "cat"]) {
      rmSync(join(dir, helper), { force: true });
    }
    rmdirSync(dir);
  }
});

test("pre-commit exits 0 when product-check succeeds", () => {
  const pathValue = pathWithStubFirst(writeNodeStub(0));
  const result = runHook({
    PATH: pathValue,
    Path: pathValue,
  });
  assert.equal(result.status, 0, `${result.stderr}\n${result.stdout}`);
  assert.match(result.stdout, /running fast product subset/);
});

test("pre-commit exits 1 with fix guidance when product-check fails", () => {
  const pathValue = pathWithStubFirst(writeNodeStub(1));
  const result = runHook({
    PATH: pathValue,
    Path: pathValue,
  });
  assert.equal(result.status, 1, `${result.stderr}\n${result.stdout}`);
  assert.match(result.stderr, /fast product subset failed/);
  assert.match(result.stderr, /Fix the reported/);
  assert.match(result.stderr, /node scripts\/check\.mjs/);
  assert.equal(result.stderr.includes("--no-verify"), false);
});
