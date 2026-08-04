import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.dirname(fileURLToPath(import.meta.url));
const distIndex = path.join(root, "..", "dist", "index.html");

assert.ok(
  fs.existsSync(distIndex),
  `missing build output: ${distIndex} (run npm run build first)`,
);

const html = fs.readFileSync(distIndex, "utf8");
assert.match(html, /Aigent Place/);
assert.match(html, /assets\//);
assert.match(html, /ws=/);

console.log("viewer: smoke ok");
