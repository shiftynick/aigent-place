import test from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { checkFoundryDrift, hashManagedFile } from "./check-foundry-drift.mjs";

function withRepo(files, manifestFiles, fn) {
  const root = mkdtempSync(join(tmpdir(), "foundry-drift-"));
  try {
    mkdirSync(join(root, ".git"), { recursive: true });
    for (const [relative, body] of Object.entries(files)) {
      const full = join(root, ...relative.split("/"));
      mkdirSync(join(full, ".."), { recursive: true });
      writeFileSync(full, body, "utf8");
    }
    if (manifestFiles) {
      mkdirSync(join(root, ".agent-foundry"), { recursive: true });
      writeFileSync(
        join(root, ".agent-foundry", "manifest.json"),
        JSON.stringify({
          schemaVersion: 1,
          foundryVersion: "9.9.9",
          installedAt: "2026-01-01T00:00:00.000Z",
          files: manifestFiles,
        }),
        "utf8",
      );
    }
    return fn(root);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

function record(body, tier = "mold") {
  return { tier, sha256: hashManagedFile(body) };
}

test("an untouched install reports no drift", () => {
  withRepo(
    { "AGENTS.md": "seeded\n", "docs/SDLC.md": "mold\n" },
    { "AGENTS.md": record("seeded\n", "seed"), "docs/SDLC.md": record("mold\n") },
    (root) => {
      const result = checkFoundryDrift(root);
      assert.equal(result.pristine, 2);
      assert.deepEqual(result.modified.mold, []);
      assert.deepEqual(result.modified.seed, []);
    },
  );
});

test("modified files are reported under their own tier", () => {
  withRepo(
    { "AGENTS.md": "edited by project\n", "docs/SDLC.md": "edited too\n" },
    { "AGENTS.md": record("seeded\n", "seed"), "docs/SDLC.md": record("mold\n") },
    (root) => {
      const result = checkFoundryDrift(root);
      assert.deepEqual(result.modified.seed, ["AGENTS.md"]);
      assert.deepEqual(result.modified.mold, ["docs/SDLC.md"]);
      assert.equal(result.pristine, 0);
    },
  );
});

test("CRLF line endings are not drift", () => {
  // A Windows checkout with autocrlf must not look like a modified file.
  withRepo(
    { "docs/SDLC.md": "line one\r\nline two\r\n" },
    { "docs/SDLC.md": record("line one\nline two\n") },
    (root) => {
      const result = checkFoundryDrift(root);
      assert.deepEqual(result.modified.mold, []);
      assert.equal(result.pristine, 1);
    },
  );
});

test("deleted managed files are reported as missing, not modified", () => {
  withRepo(
    {},
    { "docs/SDLC.md": record("mold\n") },
    (root) => {
      const result = checkFoundryDrift(root);
      assert.deepEqual(result.missing.mold, ["docs/SDLC.md"]);
      assert.deepEqual(result.modified.mold, []);
    },
  );
});

test("a project without a manifest is detectable rather than crashing", () => {
  withRepo({ "AGENTS.md": "x\n" }, null, (root) => {
    assert.equal(checkFoundryDrift(root).manifest, null);
  });
});
