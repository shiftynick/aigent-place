#!/usr/bin/env node
// process-tree.mjs — terminate a spawned Node child and its descendants.
// Matches the agent-headless contract: Windows taskkill /t /f; Unix SIGTERM
// then SIGKILL (process group when detached).

import { spawn } from "node:child_process";
import { platform } from "node:process";

export function forceKillProcessTree(pid) {
  if (!pid) return;
  if (platform === "win32") {
    const killer = spawn("taskkill", ["/pid", String(pid), "/t", "/f"], {
      windowsHide: true,
      stdio: "ignore",
    });
    killer.on("error", () => {
      try {
        process.kill(pid);
      } catch {
        /* already gone */
      }
    });
    return;
  }
  try {
    process.kill(-pid, "SIGKILL");
  } catch {
    try {
      process.kill(pid, "SIGKILL");
    } catch {
      /* already gone */
    }
  }
}

export function terminateProcessTree(child, { forceAfterMs = 2000 } = {}) {
  if (!child?.pid) {
    try {
      child?.kill("SIGTERM");
    } catch {
      /* ignore */
    }
    return;
  }
  const pid = child.pid;
  if (platform === "win32") {
    forceKillProcessTree(pid);
    return;
  }
  try {
    process.kill(-pid, "SIGTERM");
  } catch {
    try {
      child.kill("SIGTERM");
    } catch {
      /* ignore */
    }
  }
  const forceTimer = setTimeout(() => forceKillProcessTree(pid), forceAfterMs);
  forceTimer.unref?.();
}

export function isPidAlive(pid) {
  if (!pid) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

/**
 * Spawn node with the same stdio/hide defaults the presets use.
 * On non-Windows, detach so the child is its own process group (Unix kill -pid).
 */
export function spawnNodeChild(args, options = {}) {
  return spawn(process.execPath, args, {
    stdio: options.stdio ?? ["ignore", "pipe", "pipe"],
    windowsHide: true,
    detached: platform !== "win32",
    ...options.spawnOptions,
  });
}

/**
 * Run a managed child until exit, cancel, or timeoutMs.
 * On timeout, reaps the process tree and resolves status "timed-out".
 */
export function runManagedNode(args, { timeoutMs, graceMs = 0 } = {}) {
  return new Promise((resolvePromise) => {
    const child = spawnNodeChild(args);
    let stdoutBuf = "";
    let stderrBuf = "";
    let settled = false;
    let timedOut = false;
    let fallbackTimer;

    const finish = (payload) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (fallbackTimer) clearTimeout(fallbackTimer);
      resolvePromise({
        pid: child.pid ?? null,
        stdout: stdoutBuf,
        stderr: stderrBuf,
        ...payload,
      });
    };

    const timer = setTimeout(() => {
      timedOut = true;
      terminateProcessTree(child);
      // If close never fires (stuck zombie edge), still report.
      fallbackTimer = setTimeout(() => {
        finish({
          status: "timed-out",
          exitCode: null,
          error: `timed out after ${timeoutMs}ms`,
          result: null,
        });
      }, 2000);
      fallbackTimer.unref?.();
    }, timeoutMs + graceMs);

    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk) => {
      stdoutBuf += chunk;
    });
    child.stderr.on("data", (chunk) => {
      stderrBuf += chunk;
    });
    child.on("error", (err) => {
      finish({
        status: timedOut ? "timed-out" : "failed",
        exitCode: null,
        error: timedOut ? `timed out after ${timeoutMs}ms` : err.message,
        result: null,
      });
    });
    child.on("close", (code) => {
      if (timedOut) {
        finish({
          status: "timed-out",
          exitCode: code,
          error: `timed out after ${timeoutMs}ms`,
          result: null,
        });
        return;
      }
      let result = null;
      let parseError = null;
      try {
        result = JSON.parse(stdoutBuf);
      } catch (err) {
        parseError = err.message;
      }
      finish({
        status: result?.status ?? (code === 0 ? "unparsed" : "failed"),
        exitCode: code,
        error: parseError,
        result,
      });
    });
  });
}
