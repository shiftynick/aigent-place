import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: root,
    stdio: "inherit",
    windowsHide: true,
    env: process.env,
    shell: options.shell ?? false,
    ...options,
  });
  if (result.error) {
    throw result.error;
  }
  if (result.status !== 0) {
    process.exit(result.status ?? 1);
  }
}

function assertNodeMatchesNvmrc() {
  const expected = fs.readFileSync(path.join(root, ".nvmrc"), "utf8").trim();
  const actual = process.versions.node;
  if (actual !== expected) {
    console.error(
      `product-check: Node ${actual} does not match .nvmrc (${expected})`,
    );
    process.exit(1);
  }
}

function main() {
  assertNodeMatchesNvmrc();

  const cargo = process.env.CARGO_BIN || "cargo";
  if (process.env.CARGO_BIN) {
    console.log(`product-check: using CARGO_BIN=${cargo}`);
  }
  const npmCmd = process.platform === "win32" ? "npm.cmd" : "npm";
  const npmShell = process.platform === "win32";

  console.log("product-check: cargo fmt --check");
  run(cargo, ["fmt", "--all", "--", "--check"]);

  console.log("product-check: cargo clippy -D warnings");
  run(cargo, ["clippy", "--workspace", "--all-targets", "--", "-D", "warnings"]);

  console.log("product-check: cargo test");
  run(cargo, ["test", "--workspace"]);

  console.log("product-check: world-server smoke");
  run(cargo, ["run", "-q", "-p", "world-server"]);

  console.log("product-check: npm ci");
  run(npmCmd, ["ci"], { shell: npmShell });

  console.log("product-check: viewer build + smoke");
  run(npmCmd, ["run", "viewer:build"], { shell: npmShell });
  run(npmCmd, ["run", "viewer:smoke"], { shell: npmShell });

  console.log("product-check: PASS");
}

main();
