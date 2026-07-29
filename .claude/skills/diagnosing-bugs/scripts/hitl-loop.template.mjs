#!/usr/bin/env node

// Last-resort human-in-the-loop reproduction script.
//
// Copy this file, author the steps in the marked section, then ASK THE USER to
// run it in their own terminal (it prompts interactively; do not run it from
// the agent shell). The user pastes the final "--- Captured ---" block back to
// you; parse the KEY=VALUE lines by splitting on the FIRST "=" only — answers
// routinely contain "=" (readline makes newlines impossible, so one line per
// captured value always holds).

import { createInterface } from "node:readline/promises";
import { stdin, stdout } from "node:process";

const terminal = createInterface({ input: stdin, output: stdout });
const captured = new Map();

async function step(instruction) {
  console.log(`\n>> ${instruction}`);
  await terminal.question("   (press Enter when done)");
}

async function capture(name, question) {
  const answer = await terminal.question(`\n>> ${question} `);
  captured.set(name, answer);
}

try {
  // --- edit below: author the manual reproduction steps ---------------------

  await step("Start the dev server and open the app UI.");
  await capture("ERRORED", "Click the '<button>' - did it throw? (y/n)");
  await capture(
    "ERROR_MSG",
    "Paste the exact error message (or 'none'):",
  );

  // --- end of authored steps ------------------------------------------------
} finally {
  // Dumped in `finally` so a partial run still yields usable evidence: EOF on
  // stdin (Ctrl+D / Ctrl+Z, or piped input running out) rejects the pending
  // question, and answers already collected would otherwise be lost.
  if (captured.size > 0) {
    console.log("\n--- Captured ---");
    for (const [name, value] of captured) {
      console.log(`${name}=${value}`);
    }
  }
  terminal.close();
}
