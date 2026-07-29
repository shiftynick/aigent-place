import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { pathToFileURL } from "node:url";

import { findCustomizationMarkers, isMainModule } from "./check.mjs";

function withFixture(run) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "aigent-check-"));
  try {
    run(root);
  } finally {
    fs.rmSync(root, { force: true, recursive: true });
  }
}

test("finds customization markers in authoritative text files", () => {
  withFixture((root) => {
    fs.mkdirSync(path.join(root, "docs"));
    const marker = "[CUSTOM" + "IZE: me]\n";
    fs.writeFileSync(path.join(root, "docs", "guide.md"), marker);
    fs.writeFileSync(path.join(root, "README.md"), "ready\n");

    assert.deepEqual(findCustomizationMarkers(root, new Map()), [
      "docs/guide.md (expected 0 marker(s), found 1)",
    ]);
  });
});

test("scans extensionless files and ignores scoped state directories", () => {
  withFixture((root) => {
    for (const directory of [
      ".agent-foundry-backups",
      ".git",
      ".tasks",
      "node_modules",
      "target",
    ]) {
      fs.mkdirSync(path.join(root, directory));
      const quotedMarker = "[CUSTOM" + "IZE: quoted history]\n";
      fs.writeFileSync(
        path.join(root, directory, "history.md"),
        quotedMarker,
      );
    }
    const marker = "[CUSTOM" + "IZE: extensionless]\n";
    fs.writeFileSync(path.join(root, "orientation"), marker);

    assert.deepEqual(findCustomizationMarkers(root, new Map()), [
      "orientation (expected 0 marker(s), found 1)",
    ]);
  });
});

test("ignores binary files", () => {
  withFixture((root) => {
    const marker = Buffer.from("[CUSTOM" + "IZE: binary]\0");
    fs.writeFileSync(path.join(root, "artifact.bin"), marker);

    assert.deepEqual(findCustomizationMarkers(root, new Map()), []);
  });
});

test("allows the single explanatory marker in each managed audit skill", () => {
  withFixture((root) => {
    const marker = "[CUSTOM" + "IZE]";
    const allowedMarkerCounts = new Map();
    for (const harness of [".agents", ".claude"]) {
      const directory = path.join(
        root,
        harness,
        "skills",
        "codebase-audit",
      );
      fs.mkdirSync(directory, { recursive: true });
      fs.writeFileSync(
        path.join(directory, "SKILL.md"),
        `The audit detects ${marker} markers.\n`,
      );
      allowedMarkerCounts.set(
        `${harness}/skills/codebase-audit/SKILL.md`,
        1,
      );
    }

    assert.deepEqual(
      findCustomizationMarkers(root, allowedMarkerCounts),
      [],
    );
  });
});

test("reports allowlist count drift and missing paths", () => {
  withFixture((root) => {
    const marker = "[CUSTOM" + "IZE]";
    fs.writeFileSync(path.join(root, "audit.md"), `${marker} ${marker}\n`);
    const allowedMarkerCounts = new Map([
      ["audit.md", 1],
      ["missing.md", 1],
    ]);

    assert.deepEqual(
      findCustomizationMarkers(root, allowedMarkerCounts),
      [
        "audit.md (expected 1 marker(s), found 2)",
        "missing.md (allowlist path missing)",
      ],
    );
  });
});

test("recognizes the executable through real paths", () => {
  const scriptPath = path.resolve("scripts/check.mjs");
  assert.equal(isMainModule(scriptPath, pathToFileURL(scriptPath).href), true);
  assert.equal(isMainModule(undefined, pathToFileURL(scriptPath).href), false);
});
