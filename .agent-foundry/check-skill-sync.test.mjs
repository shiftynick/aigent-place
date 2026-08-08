import test from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { checkSkillSync } from "./check-skill-sync.mjs";

function makeRepo() {
  const root = mkdtempSync(join(tmpdir(), "skill-sync-"));
  mkdirSync(join(root, ".git"), { recursive: true });
  for (const tree of [".agents", ".claude"]) {
    mkdirSync(join(root, tree, "skills"), { recursive: true });
  }
  return root;
}

function writeSkill(root, tree, skill, files) {
  for (const [name, body] of Object.entries(files)) {
    const path = join(root, tree, "skills", skill, name);
    mkdirSync(join(path, ".."), { recursive: true });
    writeFileSync(path, body, "utf8");
  }
}

function withRepo(fn) {
  const root = makeRepo();
  try {
    return fn(root);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

test("identical shared skills pass", () => {
  withRepo((root) => {
    writeSkill(root, ".agents", "adr", { "SKILL.md": "# ADR\nsame\n" });
    writeSkill(root, ".claude", "adr", { "SKILL.md": "# ADR\nsame\n" });
    const result = checkSkillSync(root);
    assert.deepEqual(result.problems, []);
    assert.deepEqual(result.shared, ["adr"]);
  });
});

test("harness invocation paths are not drift", () => {
  withRepo((root) => {
    writeSkill(root, ".agents", "adr", {
      "SKILL.md": "run node .agents/skills/adr/x.mjs\nCodex-facing note\n",
    });
    writeSkill(root, ".claude", "adr", {
      "SKILL.md": "run node .claude/skills/adr/x.mjs\nClaude-facing note\n",
    });
    assert.deepEqual(checkSkillSync(root).problems, []);
  });
});

test("content drift is reported", () => {
  withRepo((root) => {
    writeSkill(root, ".agents", "adr", { "SKILL.md": "one\n" });
    writeSkill(root, ".claude", "adr", { "SKILL.md": "two\n" });
    const { problems } = checkSkillSync(root);
    assert.equal(problems.length, 1);
    assert.match(problems[0], /differs beyond harness paths/u);
  });
});

test("a file missing from one tree is reported", () => {
  withRepo((root) => {
    writeSkill(root, ".agents", "adr", {
      "SKILL.md": "same\n",
      "scripts/helper.mjs": "export const a = 1;\n",
    });
    writeSkill(root, ".claude", "adr", { "SKILL.md": "same\n" });
    const { problems } = checkSkillSync(root);
    assert.equal(problems.length, 1);
    assert.match(problems[0], /helper\.mjs exists only in/u);
  });
});

test("a shared skill pointing at the opposite tree is drift", () => {
  withRepo((root) => {
    const body = "see .claude/skills/adr/SKILL.md\n";
    writeSkill(root, ".agents", "adr", { "SKILL.md": body });
    writeSkill(root, ".claude", "adr", { "SKILL.md": body });
    const { problems } = checkSkillSync(root);
    assert.equal(problems.length, 1);
    assert.match(problems[0], /references the Claude tree/u);
  });
});

test("one-tree-only skills are skipped as bridges", () => {
  withRepo((root) => {
    writeSkill(root, ".agents", "example-bridge-a", { "SKILL.md": "codex side\n" });
    writeSkill(root, ".claude", "example-bridge-b", { "SKILL.md": "claude side\n" });
    const result = checkSkillSync(root);
    assert.deepEqual(result.problems, []);
    assert.deepEqual(result.shared, []);
  });
});

test("a missing skill tree is reported separately", () => {
  withRepo((root) => {
    rmSync(join(root, ".claude"), { recursive: true, force: true });
    assert.equal(checkSkillSync(root).missingTree?.includes("skills"), true);
  });
});
