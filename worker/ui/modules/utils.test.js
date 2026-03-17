/**
 * Verification tests for utils.js.
 * Source inspection: infra guard in getNodeType(), getNodeColor(), and NODE_TYPE_COLORS.
 */

import { readFileSync } from "fs";
import { fileURLToPath } from "url";
import { dirname, join } from "path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const src = readFileSync(join(__dirname, "utils.js"), "utf8");
const src2 = readFileSync(join(__dirname, "state.js"), "utf8");

let passed = 0;
let failed = 0;

function check(condition, description, pattern) {
  if (condition) {
    console.log(`OK: ${description}`);
    passed++;
  } else {
    console.error(`FAIL: ${description}${pattern ? ` (missing: ${pattern})` : ""}`);
    failed++;
  }
}

// ── Check 1: infra guard exists in getNodeType ─────────────────────────────

check(
  src.includes("node.type === 'infra'") || src.includes('node.type === "infra"'),
  "infra guard exists in utils.js",
  "node.type === 'infra'"
);

// ── Check 2: infra guard appears BEFORE name heuristics ───────────────────

const infraIdx = src.indexOf("node.type === 'infra'") !== -1
  ? src.indexOf("node.type === 'infra'")
  : src.indexOf('node.type === "infra"');

const heuristicIdx = src.indexOf("/sdk|lib|client|");

check(
  infraIdx !== -1 && heuristicIdx !== -1 && infraIdx < heuristicIdx,
  "infra guard appears before name heuristics in utils.js",
  "infra guard index < heuristic index"
);

// ── Check 3: getNodeColor uses NODE_TYPE_COLORS.infra ─────────────────────

check(
  src.includes("NODE_TYPE_COLORS.infra"),
  "getNodeColor uses NODE_TYPE_COLORS.infra",
  "NODE_TYPE_COLORS.infra"
);

// ── Check 4: NODE_TYPE_COLORS in state.js has infra entry ─────────────────

check(
  src2.includes("infra:") || src2.includes("infra :"),
  "NODE_TYPE_COLORS in state.js has infra entry",
  "infra:"
);

console.log(`\nResults: ${passed} passed, ${failed} failed`);
if (failed > 0) {
  process.exit(1);
}
