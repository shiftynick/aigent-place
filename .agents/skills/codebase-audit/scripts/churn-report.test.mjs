import test from "node:test";
import assert from "node:assert/strict";
import { countChangedFiles, parseArgs } from "./churn-report.mjs";

test("ranks files by change count, descending", () => {
  const output = ["a.js", "b.js", "", "a.js", "c.js", "a.js", "b.js"].join("\n");
  assert.deepEqual(countChangedFiles(output), [
    { file: "a.js", count: 3 },
    { file: "b.js", count: 2 },
    { file: "c.js", count: 1 },
  ]);
});

test("breaks count ties by path so output is deterministic", () => {
  const ranked = countChangedFiles("z.js\na.js\nm.js\n");
  assert.deepEqual(ranked.map((r) => r.file), ["a.js", "m.js", "z.js"]);
});

test("is case-sensitive, matching git's own path handling", () => {
  // The PowerShell-native equivalent (Group-Object) is case-INsensitive by
  // default, which would silently merge these two distinct paths.
  const ranked = countChangedFiles("App.js\napp.js\nApp.js\n");
  assert.deepEqual(ranked, [
    { file: "App.js", count: 2 },
    { file: "app.js", count: 1 },
  ]);
});

test("ignores blank lines and surrounding whitespace", () => {
  assert.deepEqual(countChangedFiles("\n\n  a.js  \n\n"), [{ file: "a.js", count: 1 }]);
});

test("handles empty history", () => {
  assert.deepEqual(countChangedFiles(""), []);
});

test("parses options in both spaced and inline form", () => {
  assert.equal(parseArgs(["--limit", "5"]).limit, 5);
  assert.equal(parseArgs(["--limit=5"]).limit, 5);
  assert.equal(parseArgs(["--since=2 weeks ago"]).since, "2 weeks ago");
  assert.equal(parseArgs([]).limit, 30);
});

test("rejects a non-positive or missing limit", () => {
  assert.throws(() => parseArgs(["--limit", "0"]), /positive integer/);
  assert.throws(() => parseArgs(["--limit", "x"]), /positive integer/);
  assert.throws(() => parseArgs(["--since"]), /requires a value/);
  assert.throws(() => parseArgs(["--nope", "1"]), /unknown option/);
});
