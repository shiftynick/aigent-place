import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const genDir = path.join(root, "packages/protocol/src/gen");

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: root,
    encoding: "utf8",
    stdio: "pipe",
    windowsHide: true,
    shell: options.shell ?? false,
    env: process.env,
  });
  if (result.error) {
    throw result.error;
  }
  if (result.status !== 0) {
    const detail = `${result.stdout || ""}${result.stderr || ""}`.trim();
    throw new Error(
      `generate-protocol: FAIL (${[command, ...args].join(" ")})${detail ? `\n${detail}` : ""}`,
    );
  }
  return result;
}

function listGeneratedFiles(directory) {
  if (!fs.existsSync(directory)) {
    return [];
  }
  const files = [];
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const absolute = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      files.push(...listGeneratedFiles(absolute));
    } else {
      files.push(path.relative(root, absolute).replaceAll("\\", "/"));
    }
  }
  return files.sort();
}

function snapshotDirectory(directory) {
  const snapshot = new Map();
  for (const relative of listGeneratedFiles(directory)) {
    snapshot.set(
      relative,
      fs.readFileSync(path.join(root, relative), "utf8"),
    );
  }
  return snapshot;
}

function restoreSnapshot(snapshot) {
  fs.rmSync(genDir, { recursive: true, force: true });
  for (const [relative, contents] of snapshot) {
    const absolute = path.join(root, relative);
    fs.mkdirSync(path.dirname(absolute), { recursive: true });
    fs.writeFileSync(absolute, contents, "utf8");
  }
}

function main(argv = process.argv) {
  const check = argv.includes("--check");
  const npmCmd = process.platform === "win32" ? "npm.cmd" : "npm";
  const before = check ? snapshotDirectory(genDir) : null;

  fs.mkdirSync(genDir, { recursive: true });
  run(npmCmd, ["exec", "--", "buf", "generate"], {
    shell: process.platform === "win32",
  });

  const marker = path.join(genDir, "aigent_pb.js");
  if (!fs.existsSync(marker)) {
    throw new Error(`generate-protocol: expected ${marker}`);
  }

  if (check) {
    const after = snapshotDirectory(genDir);
    const beforeKeys = [...before.keys()];
    const afterKeys = [...after.keys()];
    let drifted = JSON.stringify(beforeKeys) !== JSON.stringify(afterKeys);
    if (!drifted) {
      for (const key of beforeKeys) {
        if (before.get(key) !== after.get(key)) {
          drifted = true;
          break;
        }
      }
    }
    if (drifted) {
      restoreSnapshot(before);
      throw new Error(
        "generate-protocol: generated TypeScript is stale; run npm run protocol:generate",
      );
    }
    console.log("generate-protocol: PASS (--check, generated TS is current)");
    return;
  }

  console.log(
    `generate-protocol: PASS (wrote ${listGeneratedFiles(genDir).length} file(s))`,
  );
}

const isDirectRun =
  process.argv[1] &&
  fs.realpathSync(process.argv[1]) ===
    fs.realpathSync(fileURLToPath(import.meta.url));

if (isDirectRun) {
  try {
    main();
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  }
}

export { main };
