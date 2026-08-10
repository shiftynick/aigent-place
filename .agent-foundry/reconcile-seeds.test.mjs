import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { platform } from "node:process";
import { restorableSeedPaths, restoreSeedsFromHead } from "./reconcile-seeds.mjs";
import { hashManagedFile } from "./check-foundry-drift.mjs";

test("derives every non-preserved seed from the manifest", () => {
  const manifest = {
    files: {
      "CLAUDE.md": { tier: "seed" },
      "future/NEW-SEED.md": { tier: "seed" },
      "PLANNING-JOURNAL.md": { tier: "seed", preserveIfExists: true },
      "docs/SDLC.md": { tier: "mold" },
    },
  };
  assert.deepEqual(
    restorableSeedPaths(manifest),
    ["CLAUDE.md", "future/NEW-SEED.md"],
  );
});

test("rejects unsafe manifest paths", () => {
  assert.throws(
    () => restorableSeedPaths({ files: { "../outside.md": { tier: "seed" } } }),
    /unsafe managed path/u,
  );
});

test("restores tracked ASCII and non-ASCII seeds while keeping new seeds", () => {
  const root = mkdtempSync(join(tmpdir(), "reconcile-seeds-"));
  const git = (args) => execFileSync("git", args, { cwd: root, encoding: "utf8" });
  try {
    git(["init", "-b", "integration"]);
    git(["config", "user.email", "seed-test@example.invalid"]);
    git(["config", "user.name", "Seed Test"]);
    git(["config", "commit.gpgsign", "false"]);
    git(["config", "core.autocrlf", "false"]);
    git(["config", "core.hooksPath", ".no-hooks"]);
    writeFileSync(join(root, "CLAUDE.md"), "project Claude\n");
    writeFileSync(join(root, "guidé.md"), "project unicode\n");
    git(["add", "CLAUDE.md", "guidé.md"]);
    git(["commit", "-m", "project seeds"]);

    writeFileSync(join(root, "CLAUDE.md"), "reset template\n");
    writeFileSync(join(root, "guidé.md"), "reset unicode template\n");
    writeFileSync(join(root, "NEW-SEED.md"), "new stock seed\n");
    const records = Object.fromEntries(
      ["CLAUDE.md", "NEW-SEED.md", "guidé.md"].map((path) => [
        path,
        { sha256: hashManagedFile(readFileSync(join(root, path), "utf8")) },
      ]),
    );

    const result = restoreSeedsFromHead(
      root,
      ["CLAUDE.md", "NEW-SEED.md", "guidé.md"],
      records,
    );
    assert.deepEqual(result.restored, ["CLAUDE.md", "guidé.md"]);
    assert.deepEqual(result.newSeeds, ["NEW-SEED.md"]);
    assert.equal(readFileSync(join(root, "CLAUDE.md"), "utf8"), "project Claude\n");
    assert.equal(readFileSync(join(root, "guidé.md"), "utf8"), "project unicode\n");
    assert.equal(readFileSync(join(root, "NEW-SEED.md"), "utf8"), "new stock seed\n");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

// Windows grants directory junctions to any user but gates file symlinks
// behind Developer Mode, so probe rather than assume.
function linkSkipReason(type) {
  const probe = mkdtempSync(join(tmpdir(), "reconcile-seeds-linkprobe-"));
  try {
    const target = join(probe, "target");
    if (type === "junction") mkdirSync(target);
    else writeFileSync(target, "probe\n");
    symlinkSync(target, join(probe, "link"), type);
    return false;
  } catch (error) {
    return `${platform}: cannot create ${type} links here (${error.code ?? error.message})`;
  } finally {
    rmSync(probe, { recursive: true, force: true });
  }
}

function seedFixtureRepo(prefix) {
  const root = mkdtempSync(join(tmpdir(), prefix));
  const git = (args) => execFileSync("git", args, { cwd: root, encoding: "utf8" });
  git(["init", "-b", "integration"]);
  git(["config", "user.email", "seed-test@example.invalid"]);
  git(["config", "user.name", "Seed Test"]);
  git(["config", "commit.gpgsign", "false"]);
  git(["config", "core.autocrlf", "false"]);
  git(["config", "core.hooksPath", ".no-hooks"]);
  return { root, git };
}

test("a late hash mismatch leaves every earlier seed untouched", () => {
  const { root, git } = seedFixtureRepo("reconcile-seeds-partial-");
  try {
    writeFileSync(join(root, "AGENTS.md"), "project agents\n");
    writeFileSync(join(root, "CLAUDE.md"), "project claude\n");
    git(["add", "AGENTS.md", "CLAUDE.md"]);
    git(["commit", "-m", "project seeds"]);

    // Both files carry stock template content, as they would right after a
    // forced upgrade. Only the second one was then edited by the operator.
    writeFileSync(join(root, "AGENTS.md"), "stock agents\n");
    writeFileSync(join(root, "CLAUDE.md"), "stock claude\n");
    const records = {
      "AGENTS.md": { sha256: hashManagedFile("stock agents\n") },
      "CLAUDE.md": { sha256: hashManagedFile("stock claude\n") },
    };
    writeFileSync(join(root, "CLAUDE.md"), "edited after install\n");

    assert.throws(
      () => restoreSeedsFromHead(root, ["AGENTS.md", "CLAUDE.md"], records),
      /refusing to overwrite: CLAUDE\.md/u,
    );
    // The message says nothing was overwritten, so nothing may have been.
    assert.equal(readFileSync(join(root, "AGENTS.md"), "utf8"), "stock agents\n");
    assert.equal(readFileSync(join(root, "CLAUDE.md"), "utf8"), "edited after install\n");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("refuses a seed path that reaches its target through a link", { skip: linkSkipReason("junction") }, () => {
  const { root, git } = seedFixtureRepo("reconcile-seeds-link-");
  const outside = mkdtempSync(join(tmpdir(), "reconcile-seeds-outside-"));
  try {
    mkdirSync(join(outside, "docs"), { recursive: true });
    writeFileSync(join(outside, "docs", "SEED.md"), "stock seed\n");
    writeFileSync(join(root, "keep.md"), "project keep\n");
    git(["add", "keep.md"]);
    git(["commit", "-m", "baseline"]);
    symlinkSync(join(outside, "docs"), join(root, "docs"), "junction");
    writeFileSync(join(root, "keep.md"), "stock keep\n");

    const records = {
      "docs/SEED.md": { sha256: hashManagedFile("stock seed\n") },
      "keep.md": { sha256: hashManagedFile("stock keep\n") },
    };
    // keep.md comes first and would restore cleanly on its own. The refusal
    // must still leave it alone, so a link check that runs per path as it
    // mutates cannot pass this.
    assert.throws(
      () => restoreSeedsFromHead(root, ["keep.md", "docs/SEED.md"], records),
      /traverses a link; refusing to restore: docs\/SEED\.md/u,
    );
    assert.equal(readFileSync(join(root, "keep.md"), "utf8"), "stock keep\n");
    assert.equal(readFileSync(join(outside, "docs", "SEED.md"), "utf8"), "stock seed\n");
  } finally {
    rmSync(root, { recursive: true, force: true });
    rmSync(outside, { recursive: true, force: true });
  }
});

test("refuses a seed file that is itself a link", { skip: linkSkipReason("file") }, () => {
  const { root, git } = seedFixtureRepo("reconcile-seeds-filelink-");
  const outside = mkdtempSync(join(tmpdir(), "reconcile-seeds-outside-file-"));
  try {
    writeFileSync(join(outside, "SEED.md"), "stock seed\n");
    writeFileSync(join(root, "keep.md"), "stock keep\n");
    git(["add", "keep.md"]);
    git(["commit", "-m", "baseline"]);
    symlinkSync(join(outside, "SEED.md"), join(root, "SEED.md"), "file");

    const records = { "SEED.md": { sha256: hashManagedFile("stock seed\n") } };
    assert.throws(
      () => restoreSeedsFromHead(root, ["SEED.md"], records),
      /traverses a link; refusing to restore: SEED\.md/u,
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
    rmSync(outside, { recursive: true, force: true });
  }
});

test("refuses to overwrite a seed changed after installation", () => {
  const root = mkdtempSync(join(tmpdir(), "reconcile-seeds-dirty-"));
  const git = (args) => execFileSync("git", args, { cwd: root, encoding: "utf8" });
  try {
    git(["init", "-b", "integration"]);
    git(["config", "user.email", "seed-test@example.invalid"]);
    git(["config", "user.name", "Seed Test"]);
    git(["config", "commit.gpgsign", "false"]);
    git(["config", "core.autocrlf", "false"]);
    git(["config", "core.hooksPath", ".no-hooks"]);
    writeFileSync(join(root, "CLAUDE.md"), "project\n");
    git(["add", "CLAUDE.md"]);
    git(["commit", "-m", "project seed"]);
    writeFileSync(join(root, "CLAUDE.md"), "fresh template\n");
    const records = {
      "CLAUDE.md": { sha256: hashManagedFile("fresh template\n") },
    };
    writeFileSync(join(root, "CLAUDE.md"), "edited after install\n");
    assert.throws(
      () => restoreSeedsFromHead(root, ["CLAUDE.md"], records),
      /refusing to overwrite/u,
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
