/**
 * worker/findings-schema.test.js
 *
 * Unit tests for validateFindings() and parseAgentOutput() using Node.js
 * built-in node:test. Zero external dependencies.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { validateFindings, parseAgentOutput } from "./findings.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Minimal valid findings object */
function minimalValid() {
  return {
    service_name: "test-svc",
    confidence: "high",
    services: [
      {
        name: "test-svc",
        root_path: "src/",
        language: "typescript",
        confidence: "high",
      },
    ],
    connections: [],
    schemas: [],
  };
}

/** A valid connection */
function validConnection(overrides = {}) {
  return {
    source: "svc-a",
    target: "svc-b",
    protocol: "rest",
    method: "GET",
    path: "/health",
    source_file: "src/client.ts:callHealth",
    confidence: "high",
    evidence: "await fetch('/health')",
    ...overrides,
  };
}

/** A valid schema */
function validSchema(overrides = {}) {
  return {
    name: "UserRequest",
    role: "request",
    file: "src/types/user.ts",
    fields: [{ name: "email", type: "string", required: true }],
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// validateFindings — top-level structure
// ---------------------------------------------------------------------------

test("validateFindings returns valid:false with error for null input", () => {
  const result = validateFindings(null);
  assert.equal(result.valid, false);
  assert.equal(result.error, "findings must be an object");
});

test("validateFindings returns valid:false for non-object (string)", () => {
  const result = validateFindings("hello");
  assert.equal(result.valid, false);
  assert.equal(result.error, "findings must be an object");
});

test("validateFindings returns valid:false for non-object (number)", () => {
  const result = validateFindings(42);
  assert.equal(result.valid, false);
  assert.equal(result.error, "findings must be an object");
});

test("validateFindings returns valid:false for empty object (missing connections)", () => {
  const result = validateFindings({});
  assert.equal(result.valid, false);
  assert.ok(
    result.error.includes("connections"),
    `Expected error about 'connections', got: ${result.error}`,
  );
});

test("validateFindings returns valid:false when service_name is missing", () => {
  const obj = minimalValid();
  delete obj.service_name;
  const result = validateFindings(obj);
  assert.equal(result.valid, false);
  assert.ok(result.error.includes("service_name"));
});

test("validateFindings returns valid:false when confidence field is missing", () => {
  const obj = minimalValid();
  delete obj.confidence;
  const result = validateFindings(obj);
  assert.equal(result.valid, false);
});

test("validateFindings returns valid:false when confidence is invalid value", () => {
  const obj = minimalValid();
  obj.confidence = "medium";
  const result = validateFindings(obj);
  assert.equal(result.valid, false);
  assert.ok(
    result.error.includes("high") || result.error.includes("low"),
    `Expected error about confidence values, got: ${result.error}`,
  );
});

test("validateFindings returns valid:false when services is not an array", () => {
  const obj = minimalValid();
  obj.services = "not-an-array";
  const result = validateFindings(obj);
  assert.equal(result.valid, false);
});

test("validateFindings returns valid:false when connections is not an array", () => {
  const obj = minimalValid();
  obj.connections = {};
  const result = validateFindings(obj);
  assert.equal(result.valid, false);
});

test("validateFindings returns valid:false when schemas is not an array", () => {
  const obj = minimalValid();
  obj.schemas = null;
  const result = validateFindings(obj);
  assert.equal(result.valid, false);
});

// ---------------------------------------------------------------------------
// validateFindings — connection validation
// ---------------------------------------------------------------------------

test("validateFindings returns valid:false for unknown protocol", () => {
  const obj = minimalValid();
  obj.connections = [validConnection({ protocol: "websocket" })];
  const result = validateFindings(obj);
  assert.equal(result.valid, false);
  assert.ok(
    result.error.includes("connection[0].protocol must be one of:"),
    `Expected protocol error, got: ${result.error}`,
  );
  assert.ok(result.error.includes("rest"));
  assert.ok(result.error.includes("grpc"));
  assert.ok(result.error.includes("kafka"));
  assert.ok(result.error.includes("rabbitmq"));
  assert.ok(result.error.includes("internal"));
  assert.ok(result.error.includes("sdk"));
});

test("validateFindings returns valid:false for invalid connection confidence", () => {
  const obj = minimalValid();
  obj.connections = [validConnection({ confidence: "medium" })];
  const result = validateFindings(obj);
  assert.equal(result.valid, false);
  assert.ok(
    result.error.includes("confidence") ||
      result.error.includes("high") ||
      result.error.includes("low"),
    `Expected confidence error, got: ${result.error}`,
  );
});

test("validateFindings returns valid:false when connection source is missing", () => {
  const obj = minimalValid();
  const conn = validConnection();
  delete conn.source;
  obj.connections = [conn];
  const result = validateFindings(obj);
  assert.equal(result.valid, false);
  assert.ok(result.error.includes("source"));
});

test("validateFindings returns valid:false when connection target is missing", () => {
  const obj = minimalValid();
  const conn = validConnection();
  delete conn.target;
  obj.connections = [conn];
  const result = validateFindings(obj);
  assert.equal(result.valid, false);
});

test("validateFindings returns valid:false when connection evidence is missing", () => {
  const obj = minimalValid();
  const conn = validConnection();
  delete conn.evidence;
  obj.connections = [conn];
  const result = validateFindings(obj);
  assert.equal(result.valid, false);
  assert.ok(result.error.includes("evidence"));
});

test("validateFindings accepts connection with target_file as null (optional)", () => {
  const obj = minimalValid();
  obj.connections = [validConnection({ target_file: null })];
  const result = validateFindings(obj);
  assert.equal(result.valid, true);
});

test("validateFindings accepts all valid protocols", () => {
  const protocols = ["rest", "grpc", "kafka", "rabbitmq", "internal", "sdk"];
  for (const protocol of protocols) {
    const obj = minimalValid();
    obj.connections = [validConnection({ protocol })];
    const result = validateFindings(obj);
    assert.equal(result.valid, true, `Protocol '${protocol}' should be valid`);
  }
});

// ---------------------------------------------------------------------------
// validateFindings — schema and field validation
// ---------------------------------------------------------------------------

test("validateFindings returns valid:false for invalid schema role", () => {
  const obj = minimalValid();
  obj.schemas = [validSchema({ role: "body" })];
  const result = validateFindings(obj);
  assert.equal(result.valid, false);
  assert.ok(
    result.error.includes("role") ||
      result.error.includes("request") ||
      result.error.includes("event_payload"),
    `Expected role error, got: ${result.error}`,
  );
});

test("validateFindings returns valid:false when field required is not boolean", () => {
  const obj = minimalValid();
  obj.schemas = [
    validSchema({
      fields: [{ name: "email", type: "string", required: "true" }],
    }),
  ];
  const result = validateFindings(obj);
  assert.equal(result.valid, false);
  assert.ok(result.error.includes("required"));
});

test("validateFindings returns valid:false when schema fields is not an array", () => {
  const obj = minimalValid();
  obj.schemas = [validSchema({ fields: null })];
  const result = validateFindings(obj);
  assert.equal(result.valid, false);
});

test("validateFindings accepts valid minimal input (no schemas, empty arrays)", () => {
  const obj = minimalValid();
  const result = validateFindings(obj);
  assert.equal(result.valid, true);
  assert.deepEqual(result.findings, obj);
});

test("validateFindings accepts valid input with connections and schemas", () => {
  const obj = minimalValid();
  obj.connections = [validConnection()];
  obj.schemas = [validSchema()];
  const result = validateFindings(obj);
  assert.equal(result.valid, true);
  assert.deepEqual(result.findings, obj);
});

test("validateFindings accepts all valid schema roles", () => {
  const roles = ["request", "response", "event_payload"];
  for (const role of roles) {
    const obj = minimalValid();
    obj.schemas = [validSchema({ role })];
    const result = validateFindings(obj);
    assert.equal(result.valid, true, `Role '${role}' should be valid`);
  }
});

// ---------------------------------------------------------------------------
// parseAgentOutput
// ---------------------------------------------------------------------------

test("parseAgentOutput extracts valid JSON from fenced block", () => {
  const findings = minimalValid();
  const raw = `Here is my analysis:\n\`\`\`json\n${JSON.stringify(findings)}\n\`\`\``;
  const result = parseAgentOutput(raw);
  assert.equal(result.valid, true);
  assert.deepEqual(result.findings, findings);
});

test("parseAgentOutput returns valid:false with error when no JSON block found", () => {
  const result = parseAgentOutput(
    "I found some services but here is prose only.",
  );
  assert.equal(result.valid, false);
  assert.equal(result.error, "no JSON block found in agent output");
});

test("parseAgentOutput returns valid:false with JSON parse error for malformed JSON", () => {
  const raw = "```json\n{ invalid json here }\n```";
  const result = parseAgentOutput(raw);
  assert.equal(result.valid, false);
  assert.ok(
    result.error.startsWith("JSON parse error:"),
    `Expected JSON parse error, got: ${result.error}`,
  );
});

test("parseAgentOutput handles leading and trailing prose", () => {
  const findings = minimalValid();
  const raw = [
    "Scanning complete. I found the following service connections:",
    "",
    "```json",
    JSON.stringify(findings),
    "```",
    "",
    "Let me know if you need more details.",
  ].join("\n");
  const result = parseAgentOutput(raw);
  assert.equal(result.valid, true);
  assert.deepEqual(result.findings, findings);
});

test("parseAgentOutput validates the extracted JSON against the schema", () => {
  const raw = '```json\n{"service_name":"x"}\n```';
  const result = parseAgentOutput(raw);
  assert.equal(result.valid, false);
  // Should fail schema validation, not JSON parse
  assert.ok(
    !result.error.startsWith("JSON parse error:"),
    `Should fail schema validation, got: ${result.error}`,
  );
});

test("parseAgentOutput with empty string returns no JSON block error", () => {
  const result = parseAgentOutput("");
  assert.equal(result.valid, false);
  assert.equal(result.error, "no JSON block found in agent output");
});
