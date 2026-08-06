import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

// Executable review example for the derived-oracle lens in
// `docs/REVIEW-STANDARDS.md`. This suite deliberately tests no product code.
// It keeps the lens falsifiable by demonstrating, on a miniature subject, that
// a fixture-echoing oracle cannot detect a broken implementation while a
// derived oracle can.
//
// The miniature subject is the session sequence rule: a command envelope is
// accepted only when its sequence is exactly one past the session's last
// accepted sequence.

const repoRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);

const CASES = [
  { state: { lastAcceptedSequence: 0 }, envelope: { sequence: 1 } },
  { state: { lastAcceptedSequence: 4 }, envelope: { sequence: 4 } },
  { state: { lastAcceptedSequence: 4 }, envelope: { sequence: 6 } },
  { state: { lastAcceptedSequence: 9 }, envelope: { sequence: 10 } },
];

// The implementation under review.
function classifyCommand(state, envelope) {
  return envelope.sequence === state.lastAcceptedSequence + 1
    ? "accepted"
    : "rejected";
}

// A deliberately broken variant of it: every envelope is accepted, so the
// duplicate and gap cases are misclassified.
function brokenClassifyCommand() {
  return "accepted";
}

// The expectation derived from authoritative state rather than borrowed from
// the implementation: rebuild the session's accepted-sequence ledger and ask
// whether this envelope claims the next open slot.
function expectedFromAuthoritativeState(state, envelope) {
  const acceptedLedger = Array.from(
    { length: state.lastAcceptedSequence },
    (_, index) => index + 1,
  );
  const nextOpenSlot = acceptedLedger.length + 1;
  return envelope.sequence === nextOpenSlot ? "accepted" : "rejected";
}

// The tautological shape the lens targets: the fixture's `expected` field is
// recorded from whatever implementation is under test, then asserted back
// against that same implementation.
function recordFixtures(implementation) {
  return CASES.map((example) => ({
    ...example,
    expected: implementation(example.state, example.envelope),
  }));
}

function tautologicalOracle(implementation) {
  for (const fixture of recordFixtures(implementation)) {
    assert.equal(
      implementation(fixture.state, fixture.envelope),
      fixture.expected,
    );
  }
}

function derivedOracle(implementation) {
  for (const example of CASES) {
    assert.equal(
      implementation(example.state, example.envelope),
      expectedFromAuthoritativeState(example.state, example.envelope),
    );
  }
}

function oracleOutcome(oracle, implementation) {
  try {
    oracle(implementation);
    return "pass";
  } catch {
    return "fail";
  }
}

// The lens applied mechanically: an oracle earns its keep only when it passes
// the correct implementation and fails a deliberately broken one.
function oracleDetectsBrokenImplementation(oracle) {
  return (
    oracleOutcome(oracle, classifyCommand) === "pass" &&
    oracleOutcome(oracle, brokenClassifyCommand) === "fail"
  );
}

test("the example cases cover both authoritative classifications", () => {
  const outcomes = CASES.map((example) =>
    expectedFromAuthoritativeState(example.state, example.envelope),
  );
  assert.deepEqual([...new Set(outcomes)].sort(), ["accepted", "rejected"]);
});

test("both oracles pass while the implementation is correct", () => {
  assert.equal(oracleOutcome(tautologicalOracle, classifyCommand), "pass");
  assert.equal(oracleOutcome(derivedOracle, classifyCommand), "pass");
});

test("a fixture-echoing oracle still passes a broken implementation", () => {
  assert.equal(
    oracleOutcome(tautologicalOracle, brokenClassifyCommand),
    "pass",
  );
});

test("a derived oracle fails that same broken implementation", () => {
  assert.equal(oracleOutcome(derivedOracle, brokenClassifyCommand), "fail");
});

test("the lens flags the tautological oracle and clears the derived one", () => {
  assert.equal(oracleDetectsBrokenImplementation(tautologicalOracle), false);
  assert.equal(oracleDetectsBrokenImplementation(derivedOracle), true);
});

test("the derived-oracle lens is recorded in the review standards", () => {
  const standards = fs.readFileSync(
    path.join(repoRoot, "docs", "REVIEW-STANDARDS.md"),
    "utf8",
  );
  const lens = standards
    .split(/\n(?=- )/)
    .map((bullet) => bullet.replace(/\s+/g, " ").trim())
    .find((bullet) => bullet.includes("oracle"));

  assert.ok(lens, "no review lens in docs/REVIEW-STANDARDS.md mentions oracles");
  assert.match(lens, /authoritative state/);
  assert.match(lens, /scripts\/derived-oracle-lens\.test\.mjs/);
  assert.match(lens, /\(origin: /);
});
