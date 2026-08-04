import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

export function parseArgs(argv) {
  const args = argv.slice(2);
  return {
    fast: args.includes("--fast"),
    help: args.includes("--help") || args.includes("-h"),
  };
}

export function assertNodeMatchesNvmrc(
  nodeVersion = process.versions.node,
  nvmrcPath = path.join(root, ".nvmrc"),
) {
  const expected = fs.readFileSync(nvmrcPath, "utf8").trim();
  if (nodeVersion !== expected) {
    throw new Error(
      `product-check: Node ${nodeVersion} does not match .nvmrc (${expected})`,
    );
  }
  return expected;
}

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
    const label = [command, ...args].join(" ");
    console.error(`product-check: FAIL (${label})`);
    process.exit(result.status ?? 1);
  }
}

export function main(argv = process.argv) {
  const { fast, help } = parseArgs(argv);
  if (help) {
    console.log(`Usage: node scripts/product-check.mjs [--fast]

  (default)  full product gate: fmt, clippy, test, server smoke,
             protocol-conformance, workload-harness, npm ci,
             protocol generate --check, protocol TS conformance,
             viewer build + smoke
  --fast     pre-commit subset: fmt, clippy, test, server smoke,
             protocol-conformance, workload-harness
`);
    return;
  }

  try {
    assertNodeMatchesNvmrc();
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  }

  const cargo = process.env.CARGO_BIN || "cargo";
  if (process.env.CARGO_BIN) {
    console.log(`product-check: using CARGO_BIN=${cargo}`);
  }
  const npmCmd = process.platform === "win32" ? "npm.cmd" : "npm";
  const npmShell = process.platform === "win32";
  const mode = fast ? "fast" : "full";
  console.log(`product-check: mode=${mode}`);

  console.log("product-check: cargo fmt --check");
  run(cargo, ["fmt", "--all", "--", "--check"]);

  console.log("product-check: cargo clippy -D warnings");
  run(cargo, ["clippy", "--workspace", "--all-targets", "--", "-D", "warnings"]);

  console.log("product-check: cargo test");
  run(cargo, ["test", "--workspace"]);

  console.log("product-check: world-server smoke");
  run(cargo, ["run", "-q", "-p", "world-server"]);

  console.log("product-check: protocol-conformance");
  run(cargo, ["run", "-q", "-p", "protocol-conformance"]);

  console.log("product-check: workload-harness");
  run(cargo, ["run", "-q", "-p", "workload-harness"]);

  if (fast) {
    console.log("product-check: PASS (fast subset)");
    return;
  }

  console.log("product-check: npm ci");
  run(npmCmd, ["ci"], { shell: npmShell });

  console.log("product-check: protocol generate --check");
  run(process.execPath, ["scripts/generate-protocol.mjs", "--check"]);

  console.log("product-check: protocol binary conformance (TypeScript)");
  run(npmCmd, ["run", "test", "-w", "@aigent-place/protocol"], {
    shell: npmShell,
  });
  run(npmCmd, ["run", "test", "-w", "@aigent-place/aigent-sdk"], {
    shell: npmShell,
  });

  console.log("product-check: viewer build + smoke");
  run(npmCmd, ["run", "viewer:build"], { shell: npmShell });
  run(npmCmd, ["run", "viewer:smoke"], { shell: npmShell });

  console.log("product-check: PASS");
}

const isDirectRun =
  process.argv[1] &&
  fs.realpathSync(process.argv[1]) ===
    fs.realpathSync(fileURLToPath(import.meta.url));

if (isDirectRun) {
  main();
}
