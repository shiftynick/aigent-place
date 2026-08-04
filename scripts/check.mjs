import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const SKIPPED_DIRECTORIES = new Set([
  ".agent-foundry-backups",
  ".git",
  ".tasks",
  "node_modules",
  "target",
]);
// Keep the searched token out of this scanner's own source.
const CUSTOMIZATION_MARKER = "[CUSTOM" + "IZE";
const ALLOWED_MARKER_COUNTS = new Map([
  [".agents/skills/codebase-audit/SKILL.md", 1],
  [".claude/skills/codebase-audit/SKILL.md", 1],
]);

export function findCustomizationMarkers(
  root,
  allowedMarkerCounts = ALLOWED_MARKER_COUNTS,
) {
  const hits = [];
  const pending = [root];
  const observedAllowedPaths = new Set();

  while (pending.length > 0) {
    const directory = pending.pop();
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      const absolutePath = path.join(directory, entry.name);
      const relativePath = path
        .relative(root, absolutePath)
        .replaceAll("\\", "/");
      if (entry.isDirectory() && SKIPPED_DIRECTORIES.has(entry.name)) {
        continue;
      }

      if (entry.isDirectory()) {
        pending.push(absolutePath);
        continue;
      }
      if (entry.isSymbolicLink()) {
        hits.push(`${relativePath} (symlink not scanned)`);
        continue;
      }
      if (!entry.isFile()) {
        continue;
      }

      const bytes = fs.readFileSync(absolutePath);
      if (bytes.includes(0)) {
        continue;
      }
      const contents = bytes.toString("utf8");
      const markerCount =
        contents.split(CUSTOMIZATION_MARKER).length - 1;
      const allowedCount = allowedMarkerCounts.get(relativePath) ?? 0;
      if (allowedMarkerCounts.has(relativePath)) {
        observedAllowedPaths.add(relativePath);
      }
      if (markerCount !== allowedCount) {
        hits.push(
          `${relativePath} (expected ${allowedCount} marker(s), found ${markerCount})`,
        );
      }
    }
  }

  for (const relativePath of allowedMarkerCounts.keys()) {
    if (!observedAllowedPaths.has(relativePath)) {
      hits.push(`${relativePath} (allowlist path missing)`);
    }
  }

  return hits.sort();
}

export function isMainModule(argvPath, moduleUrl) {
  if (!argvPath) {
    return false;
  }
  return (
    fs.realpathSync(argvPath) === fs.realpathSync(fileURLToPath(moduleUrl))
  );
}

function run(command, args, root) {
  const result = spawnSync(command, args, {
    cwd: root,
    stdio: "inherit",
    windowsHide: true,
  });

  if (result.error) {
    throw result.error;
  }
  if (result.status !== 0) {
    process.exit(result.status ?? 1);
  }
}

function main() {
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

  run(
    process.execPath,
    [
      "--test",
      "scripts/check.test.mjs",
      "scripts/protocol-contract.test.mjs",
      "scripts/product-check.test.mjs",
      "scripts/replay-contract.test.mjs",
      "scripts/ruleset-contract.test.mjs",
      "scripts/world-contract.test.mjs",
      "scripts/workload-contract.test.mjs",
      ".githooks/pre-commit.test.mjs",
      ".githooks/pre-push.test.mjs",
    ],
    root,
  );
  run(process.execPath, [".agent-foundry/run-checks.mjs"], root);

  const markerHits = findCustomizationMarkers(root);
  if (markerHits.length > 0) {
    console.error("Process-document scan issues:");
    for (const hit of markerHits) {
      console.error(`  - ${hit}`);
    }
    process.exit(1);
  }

  console.log(
    "process-docs: PASS (no unresolved markers in scoped non-binary files)",
  );

  run(process.execPath, ["scripts/product-check.mjs"], root);
}

if (isMainModule(process.argv[1], import.meta.url)) {
  try {
    main();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`process-docs: FAIL (${message})`);
    process.exit(1);
  }
}
