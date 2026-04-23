// plugins/arcanon/worker/cli/hub.test.js
// Unit tests for the _readHubAutoSync two-read pattern in hub.js (CLN-07, CLN-08).
//
// hub.js calls main() only when executed directly (import.meta.url === process.argv[1]),
// so importing it here is safe — no CLI side effects occur.
import { test } from "node:test";
import assert from "node:assert/strict";
import { _readHubAutoSync } from "./hub.js";

function captureStderr() {
  const originalWrite = process.stderr.write.bind(process.stderr);
  const captured = [];
  process.stderr.write = (chunk) => { captured.push(String(chunk)); return true; };
  return { captured, restore: () => { process.stderr.write = originalWrite; } };
}

test("CLN-07: hub.js _readHubAutoSync mirrors manager.js precedence rules", () => {
  const capture = captureStderr();
  try {
    // new key true → enabled, no warning
    assert.equal(_readHubAutoSync({ "auto-sync": true }), true);
    // new key false beats legacy true → disabled, no warning
    assert.equal(_readHubAutoSync({ "auto-sync": false, "auto-upload": true }), false);
    // legacy key only → enabled, warning fires once
    assert.equal(_readHubAutoSync({ "auto-upload": true }), true);
    // neither key → disabled
    assert.equal(_readHubAutoSync({}), false);
    // undefined hubBlock → disabled
    assert.equal(_readHubAutoSync(undefined), false);
    // In this run the legacy key was read exactly once, expect exactly one warning.
    const warnings = capture.captured.filter(s => s.includes("deprecated"));
    assert.equal(warnings.length, 1, "deprecation warning fires exactly once");
    assert.match(warnings[0], /auto-sync/, "warning mentions new key name");
    assert.match(warnings[0], /auto-upload/, "warning mentions legacy key name");
  } finally {
    capture.restore();
  }
});
