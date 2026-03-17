/**
 * Verification tests for detail-panel.js.
 * Source-inspection tests for three-way panel routing, library/infra renderers,
 * and escapeHtml helper.
 */

import { readFileSync } from "fs";
import { fileURLToPath } from "url";
import { dirname, join } from "path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const src = readFileSync(join(__dirname, "detail-panel.js"), "utf8");

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

// ── PANEL-02: Three-way routing ────────────────────────────────────────────

// infra routing branch exists
check(
  src.includes("nodeType === 'infra'") || src.includes('nodeType === "infra"'),
  "PANEL-02: infra routing branch exists",
  "nodeType === 'infra'"
);

// renderInfraConnections function is defined
check(
  src.includes("renderInfraConnections"),
  "PANEL-02: renderInfraConnections function is defined",
  "renderInfraConnections"
);

// old two-way dispatch is gone (isLib boolean must not exist)
check(
  !src.includes("const isLib"),
  "PANEL-02: old isLib two-way dispatch is removed",
  null
);

// ── PANEL-03: Library panel with exports ──────────────────────────────────

// exports filtered by kind
check(
  src.includes("kind === 'export'") || src.includes('kind === "export"'),
  "PANEL-03: exports filtered by kind",
  "kind === 'export'"
);

// function vs type classification by parenthesis
check(
  src.includes(".includes('(')") || src.includes('.includes("(")') || src.includes("includes('(')"),
  "PANEL-03: function vs type classification by parenthesis",
  ".includes('(')"
);

// call site passes node as first argument
check(
  src.includes("renderLibraryConnections(node"),
  "PANEL-03: renderLibraryConnections call site passes node as first argument",
  "renderLibraryConnections(node"
);

// ── PANEL-04: Infra panel with resources ──────────────────────────────────

// resources filtered by kind
check(
  src.includes("kind === 'resource'") || src.includes('kind === "resource"'),
  "PANEL-04: resources filtered by kind",
  "kind === 'resource'"
);

// prefix extraction via split
check(
  src.includes(".split('/')[0]") || src.includes(".split('/')[0]"),
  "PANEL-04: prefix extraction via split('/')[0]",
  ".split('/')[0]"
);

// ── XSS safety ────────────────────────────────────────────────────────────

// escapeHtml helper is used
check(
  src.includes("escapeHtml"),
  "XSS: escapeHtml helper is used",
  "escapeHtml"
);

// escape function handles HTML entities
check(
  src.includes("&amp;") && src.includes("&lt;") && src.includes("&gt;"),
  "XSS: escape function handles &amp; &lt; &gt; entities",
  "&amp; &lt; &gt;"
);

// ── No connections guard ──────────────────────────────────────────────────

// guard accounts for exposes
check(
  src.includes("node.exposes") || src.includes("exposes"),
  "Guard: no-connections guard accounts for node.exposes",
  "node.exposes"
);

console.log(`\nResults: ${passed} passed, ${failed} failed`);
if (failed > 0) {
  process.exit(1);
}
