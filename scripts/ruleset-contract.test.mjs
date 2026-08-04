import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import {
  CONSTITUTION_COST_CEILING,
  canonicalize,
  defaultParameters,
  envelopeCost,
  evaluateFixtureCase,
  isEligibleVoter,
  loadFixture,
  PARAMETER_CATALOG,
  validateCandidate,
  validateFixture,
} from "./ruleset-contract.mjs";

const fixture = loadFixture();
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

test("all ruleset v1 semantic fixtures match their expected state and trace", () => {
  validateFixture(fixture);
  for (const scenario of fixture.cases) {
    assert.deepEqual(
      evaluateFixtureCase(fixture, scenario),
      canonicalize(scenario.expect),
      scenario.id,
    );
  }
});

test("default catalog is complete, in-range, and at the constitution ceiling", () => {
  const defaults = defaultParameters();
  assert.equal(Object.keys(PARAMETER_CATALOG).length, Object.keys(defaults).length);
  assert.deepEqual(validateCandidate(defaults), {
    ok: true,
    cost: CONSTITUTION_COST_CEILING,
    ceiling: CONSTITUTION_COST_CEILING,
  });
  assert.equal(envelopeCost(defaults), CONSTITUTION_COST_CEILING);
  for (const [pathKey, spec] of Object.entries(PARAMETER_CATALOG)) {
    assert.ok(spec.migration, pathKey);
    assert.ok(["grandfather", "clamp", "evict"].includes(spec.migration));
  }
});

test("voter eligibility matches constitutional floors", () => {
  assert.equal(
    isEligibleVoter({ account_age_days: 7, has_command_handshake: true }),
    true,
  );
  assert.equal(
    isEligibleVoter({ account_age_days: 6, has_command_handshake: true }),
    false,
  );
  assert.equal(
    isEligibleVoter({ account_age_days: 30, has_command_handshake: false }),
    false,
  );
});

test("CONTRACT.md relative links resolve and README cites the ruleset contract", () => {
  const contractPath = path.join(root, "ruleset/v1/CONTRACT.md");
  const contract = fs.readFileSync(contractPath, "utf8");
  const linkPattern = /\[[^\]]+\]\(([^)]+)\)/g;
  let match;
  while ((match = linkPattern.exec(contract)) !== null) {
    const target = match[1];
    if (target.startsWith("http")) continue;
    const resolved = path.resolve(path.dirname(contractPath), target);
    assert.ok(fs.existsSync(resolved), `missing link target: ${target}`);
  }
  const readme = fs.readFileSync(path.join(root, "README.md"), "utf8");
  assert.match(readme, /ruleset\/v1\/CONTRACT\.md/);
  assert.match(readme, /ADR-0007/);
});

test("evaluator source does not use localeCompare for ordering", () => {
  const source = fs.readFileSync(
    path.join(root, "scripts/ruleset-contract.mjs"),
    "utf8",
  );
  assert.equal(source.includes("localeCompare"), false);
});
