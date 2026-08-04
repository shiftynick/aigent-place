import assert from "node:assert/strict";
import test from "node:test";

import { assertNodeMatchesNvmrc, parseArgs } from "./product-check.mjs";

test("parseArgs recognizes --fast and help flags", () => {
  assert.deepEqual(parseArgs(["node", "product-check.mjs"]), {
    fast: false,
    help: false,
  });
  assert.deepEqual(parseArgs(["node", "product-check.mjs", "--fast"]), {
    fast: true,
    help: false,
  });
  assert.equal(parseArgs(["node", "product-check.mjs", "--help"]).help, true);
});

test("assertNodeMatchesNvmrc accepts the current runtime when it matches", () => {
  const expected = assertNodeMatchesNvmrc();
  assert.equal(expected, process.versions.node);
});

test("assertNodeMatchesNvmrc rejects a mismatched version", () => {
  assert.throws(
    () => assertNodeMatchesNvmrc("0.0.0"),
    /does not match \.nvmrc/,
  );
});
