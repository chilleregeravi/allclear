import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";

import crypto from "node:crypto";

import {
  buildScanPayload,
  buildFindingsBlock,
  serializePayload,
  PayloadError,
  KNOWN_TOOLS,
  MAX_PAYLOAD_BYTES,
  ALLOWED_EVIDENCE_MODES,
} from "./payload.js";

function makeTempGitRepo(name = "arcanon-payload-test") {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), name + "-"));
  const git = (args) =>
    execFileSync("git", args, { cwd: dir, stdio: ["ignore", "pipe", "ignore"], encoding: "utf8" });
  git(["init", "-q"]);
  git(["config", "user.email", "test@arcanon.dev"]);
  git(["config", "user.name", "Test"]);
  fs.writeFileSync(path.join(dir, "README.md"), "hello");
  git(["add", "."]);
  git(["commit", "-q", "-m", "init"]);
  return dir;
}

test("buildFindingsBlock drops connections whose source is not a known service", () => {
  const findings = {
    services: [{ name: "svc-a", language: "ts" }],
    connections: [
      { source: "svc-a", target: "external", protocol: "rest" },
      { source: "ghost", target: "external", protocol: "rest" },
    ],
  };
  const block = buildFindingsBlock(findings);
  assert.equal(block.connections.length, 1);
  assert.equal(block.connections[0].source, "svc-a");
  assert.equal(block.warnings.length, 1);
  assert.match(block.warnings[0], /dropped connection/);
});

test("buildFindingsBlock sets defaults for missing optional fields", () => {
  const block = buildFindingsBlock({
    services: [{ name: "svc-a" }],
    connections: [{ source: "svc-a", target: "db" }],
  });
  assert.equal(block.services[0].root_path, ".");
  assert.equal(block.services[0].language, "unknown");
  assert.equal(block.services[0].type, "service");
  assert.equal(block.connections[0].protocol, "unknown");
});

test("buildScanPayload requires repoPath", () => {
  assert.throws(
    () => buildScanPayload({ findings: { services: [{ name: "a" }] } }),
    PayloadError,
  );
});

test("buildScanPayload rejects unknown tool names", () => {
  const repoPath = makeTempGitRepo();
  assert.throws(
    () =>
      buildScanPayload({
        findings: { services: [{ name: "a" }] },
        repoPath,
        tool: "not-a-real-tool",
      }),
    /tool "not-a-real-tool"/,
  );
});

test("buildScanPayload derives commit_sha from git", () => {
  const repoPath = makeTempGitRepo();
  const { payload } = buildScanPayload({
    findings: { services: [{ name: "svc" }] },
    repoPath,
  });
  assert.equal(payload.version, "1.0");
  assert.equal(payload.metadata.tool, "claude-code");
  assert.match(payload.metadata.commit_sha, /^[0-9a-f]{40}$/);
  assert.equal(payload.metadata.repo_name, path.basename(repoPath));
});

test("buildScanPayload requires findings.services to have at least one entry", () => {
  const repoPath = makeTempGitRepo();
  assert.throws(
    () =>
      buildScanPayload({
        findings: { services: [], connections: [] },
        repoPath,
      }),
    /services must contain at least one/,
  );
});

test("buildScanPayload omits project_slug when not provided", () => {
  const repoPath = makeTempGitRepo();
  const { payload } = buildScanPayload({
    findings: { services: [{ name: "svc" }] },
    repoPath,
  });
  assert.equal(payload.metadata.project_slug, undefined);
});

test("buildScanPayload includes project_slug when provided", () => {
  const repoPath = makeTempGitRepo();
  const { payload } = buildScanPayload({
    findings: { services: [{ name: "svc" }] },
    repoPath,
    projectSlug: "my-proj",
  });
  assert.equal(payload.metadata.project_slug, "my-proj");
});

test("KNOWN_TOOLS matches the server enum", () => {
  assert.deepEqual(
    [...KNOWN_TOOLS].sort(),
    ["claude-code", "cli", "copilot", "cursor", "unknown"].sort(),
  );
});

test("serializePayload rejects payloads larger than MAX_PAYLOAD_BYTES", () => {
  // Build a payload whose body exceeds 10 MB by stuffing connection evidence.
  const big = "x".repeat(MAX_PAYLOAD_BYTES + 1024);
  const fake = {
    version: "1.0",
    metadata: {
      tool: "claude-code",
      repo_name: "r",
      commit_sha: "0".repeat(40),
      scan_mode: "full",
    },
    findings: {
      services: [{ name: "svc" }],
      connections: [{ source: "svc", target: "big", protocol: "rest", evidence: big }],
      schemas: [],
      actors: [],
    },
  };
  assert.throws(() => serializePayload(fake), /exceeds hub limit/);
});

test("serializePayload returns body + byte count under the limit", () => {
  const payload = {
    version: "1.0",
    metadata: { tool: "claude-code", repo_name: "r", commit_sha: "0".repeat(40), scan_mode: "full" },
    findings: { services: [{ name: "svc" }], connections: [], schemas: [], actors: [] },
  };
  const { body, bytes } = serializePayload(payload);
  assert.ok(bytes > 0);
  assert.equal(JSON.parse(body).version, "1.0");
});

// ── HUB-01/02/03: libraryDepsEnabled gate + schemaVersion derivation ──────────

test("buildFindingsBlock(findings) with no opts returns schemaVersion 1.0 (backward compat)", () => {
  const block = buildFindingsBlock({ services: [{ name: "svc" }] });
  assert.equal(block.schemaVersion, "1.0");
  assert.equal(block.services[0].dependencies, undefined);
});

test("buildFindingsBlock with libraryDepsEnabled=false returns schemaVersion 1.0 and no per-service deps", () => {
  const findings = {
    services: [{ name: "svc", dependencies: [{ package_name: "express" }] }],
  };
  const block = buildFindingsBlock(findings, { libraryDepsEnabled: false });
  assert.equal(block.schemaVersion, "1.0");
  assert.equal(block.services[0].dependencies, undefined);
});

test("buildFindingsBlock with libraryDepsEnabled=true but all services have empty deps returns schemaVersion 1.0 (flag-on fallback)", () => {
  const findings = {
    services: [{ name: "svc-a", dependencies: [] }, { name: "svc-b" }],
  };
  const block = buildFindingsBlock(findings, { libraryDepsEnabled: true });
  assert.equal(block.schemaVersion, "1.0");
  assert.equal(block.services[0].dependencies, undefined);
  assert.equal(block.services[1].dependencies, undefined);
});

test("buildFindingsBlock with libraryDepsEnabled=true and non-empty deps returns schemaVersion 1.1 with per-service dependencies", () => {
  const dep = { id: 1, service_id: 10, ecosystem: "npm", package_name: "express", version_spec: "^4", resolved_version: "4.18.0", manifest_file: "package.json", dep_kind: "direct" };
  const findings = {
    services: [
      { name: "svc-a", dependencies: [dep] },
      { name: "svc-b" },
    ],
  };
  const block = buildFindingsBlock(findings, { libraryDepsEnabled: true });
  assert.equal(block.schemaVersion, "1.1");
  assert.deepEqual(block.services[0].dependencies, [dep]);
  assert.deepEqual(block.services[1].dependencies, []);
});

test("buildScanPayload without libraryDepsEnabled emits version 1.0 (default)", () => {
  const repoPath = makeTempGitRepo();
  const { payload } = buildScanPayload({
    findings: { services: [{ name: "svc" }] },
    repoPath,
  });
  assert.equal(payload.version, "1.0");
  assert.equal(payload.findings.services[0].dependencies, undefined);
});

test("buildScanPayload with libraryDepsEnabled=true and non-empty deps emits version 1.1", () => {
  const repoPath = makeTempGitRepo();
  const dep = { id: 1, service_id: 1, ecosystem: "npm", package_name: "lodash", version_spec: "^4", resolved_version: "4.17.21", manifest_file: "package.json", dep_kind: "direct" };
  const { payload } = buildScanPayload({
    findings: { services: [{ name: "svc", dependencies: [dep] }] },
    repoPath,
    libraryDepsEnabled: true,
  });
  assert.equal(payload.version, "1.1");
  assert.deepEqual(payload.findings.services[0].dependencies, [dep]);
});

test("buildScanPayload with libraryDepsEnabled=true but empty deps emits version 1.0 (fallback)", () => {
  const repoPath = makeTempGitRepo();
  const { payload } = buildScanPayload({
    findings: { services: [{ name: "svc", dependencies: [] }] },
    repoPath,
    libraryDepsEnabled: true,
  });
  assert.equal(payload.version, "1.0");
  assert.equal(payload.findings.services[0].dependencies, undefined);
});

// ---------------------------------------------------------------------------
// HUB-04 / HUB-05 — Phase 96-02: additional matrix coverage + regression guard
// ---------------------------------------------------------------------------

// Shared fixture — matches Phase 93-02 getDependenciesForService return shape.
const SAMPLE_DEP_ROW = {
  id: 1,
  service_id: 42,
  scan_version_id: 7,
  ecosystem: "npm",
  package_name: "react",
  version_spec: "^18.2.0",
  resolved_version: "18.2.0",
  manifest_file: "package.json",
  dep_kind: "direct",
};

test("HUB-05 regression guard: buildFindingsBlock with no opts returns schemaVersion='1.0' and omits per-service dependencies", () => {
  const block = buildFindingsBlock({
    services: [{ name: "svc-a", language: "ts" }],
    connections: [{ source: "svc-a", target: "db", protocol: "tcp" }],
  });
  // Default path MUST be v1.0 — proves backward compat for every caller that
  // never opts into the feature flag.
  assert.equal(block.schemaVersion, "1.0");
  assert.equal(block.services[0].dependencies, undefined, "v1.0 services must NOT carry a dependencies key");
  // Shape regression — existing keys are still present and unchanged.
  assert.equal(block.services[0].name, "svc-a");
  assert.equal(block.services[0].language, "ts");
  assert.equal(block.services[0].root_path, ".");
  assert.equal(block.services[0].type, "service");
  assert.ok(Array.isArray(block.connections));
  assert.ok(Array.isArray(block.schemas));
  assert.ok(Array.isArray(block.actors));
});

test("HUB-04 matrix #3: flag OFF + populated deps → schemaVersion='1.0', deps suppressed (flag is authoritative)", () => {
  const block = buildFindingsBlock(
    {
      services: [{ name: "svc-a", language: "ts", dependencies: [SAMPLE_DEP_ROW] }],
      connections: [],
    },
    { libraryDepsEnabled: false },
  );
  assert.equal(block.schemaVersion, "1.0", "flag OFF dominates — dep data is ignored");
  assert.equal(block.services[0].dependencies, undefined, "v1.0 must NOT leak the input dependencies array");
});

test("HUB-04 matrix #5 (mixed services): flag ON + one service with deps + one without → v1.1 with dependencies on both", () => {
  const block = buildFindingsBlock(
    {
      services: [
        { name: "svc-has-deps", language: "ts", dependencies: [SAMPLE_DEP_ROW] },
        { name: "svc-no-deps", language: "go", dependencies: [] },
        { name: "svc-missing-field", language: "py" }, // no dependencies key at all
      ],
      connections: [],
    },
    { libraryDepsEnabled: true },
  );
  // Any non-empty service → v1.1 envelope; every service in the envelope carries dependencies.
  assert.equal(block.schemaVersion, "1.1");
  assert.deepEqual(block.services[0].dependencies, [SAMPLE_DEP_ROW]);
  assert.deepEqual(block.services[1].dependencies, []);
  // Service with no dependencies field in input gets dependencies: [] on output (never undefined on v1.1 path)
  assert.deepEqual(block.services[2].dependencies, []);
});

test("HUB-04 end-to-end default: buildScanPayload without libraryDepsEnabled emits payload.version='1.0' (regression)", () => {
  const repoPath = makeTempGitRepo();
  const { payload } = buildScanPayload({
    findings: {
      services: [{ name: "svc-a", dependencies: [SAMPLE_DEP_ROW] }],
      connections: [],
    },
    repoPath,
    // libraryDepsEnabled intentionally omitted — default false
  });
  assert.equal(payload.version, "1.0");
  assert.equal(
    payload.findings.services[0].dependencies,
    undefined,
    "v1.0 must not leak dependencies even if caller supplied them in findings",
  );
});

// ── INT-01: hub.evidence_mode + v1.2 envelope ──────────────────────────────

function sha256(s) {
  return crypto.createHash("sha256").update(s).digest("hex");
}

// Common fixture — single-line evidence "fetch('/users')" living at line 1
// of source.js. Used across the matrix tests so byte-identical assertions
// can compare apples to apples.
const EVIDENCE_LITERAL = "fetch('/users')";
const EVIDENCE_FILE = "source.js";

function makeTempFileWithContent(content, name = EVIDENCE_FILE) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "arcanon-evmode-"));
  const filePath = path.join(dir, name);
  fs.writeFileSync(filePath, content, "utf8");
  return { filePath, projectRoot: dir, relPath: name };
}

function makeEvidenceFindings({ withDeps = false } = {}) {
  const svc = { name: "svc-a", language: "ts" };
  if (withDeps) {
    svc.dependencies = [SAMPLE_DEP_ROW];
  }
  return {
    services: [svc],
    connections: [
      {
        source: "svc-a",
        target: "users-api",
        protocol: "rest",
        evidence: EVIDENCE_LITERAL,
        source_file: EVIDENCE_FILE,
      },
    ],
  };
}

test("INT-01 M1 — default omitted evidenceMode emits v1.0 with string evidence (back-compat)", () => {
  const repoPath = makeTempGitRepo();
  const { projectRoot } = makeTempFileWithContent(EVIDENCE_LITERAL + "\n");
  const { payload } = buildScanPayload({
    findings: makeEvidenceFindings(),
    repoPath,
    projectRoot,
  });
  assert.equal(payload.version, "1.0");
  assert.equal(payload.findings.connections[0].evidence, EVIDENCE_LITERAL);
});

test("INT-01 M2 — explicit evidenceMode='full' is identical to omitted default", () => {
  const repoPath = makeTempGitRepo();
  const { projectRoot } = makeTempFileWithContent(EVIDENCE_LITERAL + "\n");
  const a = buildScanPayload({
    findings: makeEvidenceFindings(),
    repoPath,
    projectRoot,
    evidenceMode: "full",
  });
  const b = buildScanPayload({
    findings: makeEvidenceFindings(),
    repoPath,
    projectRoot,
  });
  assert.equal(a.payload.version, b.payload.version);
  assert.equal(a.payload.version, "1.0");
  assert.deepEqual(a.payload.findings.connections, b.payload.findings.connections);
});

test("INT-01 M3 — evidenceMode='full' + libraryDepsEnabled emits v1.1 with string evidence + dependencies", () => {
  const repoPath = makeTempGitRepo();
  const { projectRoot } = makeTempFileWithContent(EVIDENCE_LITERAL + "\n");
  const { payload } = buildScanPayload({
    findings: makeEvidenceFindings({ withDeps: true }),
    repoPath,
    projectRoot,
    evidenceMode: "full",
    libraryDepsEnabled: true,
  });
  assert.equal(payload.version, "1.1");
  assert.deepEqual(payload.findings.services[0].dependencies, [SAMPLE_DEP_ROW]);
  assert.equal(payload.findings.connections[0].evidence, EVIDENCE_LITERAL);
});

test("INT-01 M4 — evidenceMode='hash-only' emits v1.2 with {hash, start_line, end_line} object", () => {
  const repoPath = makeTempGitRepo();
  const { projectRoot } = makeTempFileWithContent(EVIDENCE_LITERAL + "\n");
  const { payload } = buildScanPayload({
    findings: makeEvidenceFindings(),
    repoPath,
    projectRoot,
    evidenceMode: "hash-only",
  });
  assert.equal(payload.version, "1.2");
  const ev = payload.findings.connections[0].evidence;
  assert.equal(typeof ev, "object");
  assert.equal(ev.hash, sha256(EVIDENCE_LITERAL));
  assert.equal(ev.start_line, 1);
  assert.equal(ev.end_line, 1);
});

test("INT-01 M5 — evidenceMode='hash-only' with missing source_file yields hash + null lines", () => {
  const repoPath = makeTempGitRepo();
  // No file on disk for the source_file path.
  const { payload } = buildScanPayload({
    findings: makeEvidenceFindings(),
    repoPath,
    projectRoot: "/tmp/does-not-exist-arcanon",
    evidenceMode: "hash-only",
  });
  assert.equal(payload.version, "1.2");
  const ev = payload.findings.connections[0].evidence;
  assert.equal(ev.hash, sha256(EVIDENCE_LITERAL));
  assert.equal(ev.start_line, null);
  assert.equal(ev.end_line, null);
});

test("INT-01 M6 — evidenceMode='hash-only' with falsy connection.evidence omits the field entirely", () => {
  const repoPath = makeTempGitRepo();
  const { payload } = buildScanPayload({
    findings: {
      services: [{ name: "svc-a" }],
      connections: [{ source: "svc-a", target: "db", protocol: "tcp", evidence: null }],
    },
    repoPath,
    evidenceMode: "hash-only",
  });
  assert.equal(payload.version, "1.2");
  // Spread-omit pattern — the key must not appear at all.
  assert.equal("evidence" in payload.findings.connections[0], false);
});

test("INT-01 M7 — evidenceMode='none' emits v1.2 and omits evidence on every connection", () => {
  const repoPath = makeTempGitRepo();
  const { projectRoot } = makeTempFileWithContent(EVIDENCE_LITERAL + "\n");
  const { payload } = buildScanPayload({
    findings: makeEvidenceFindings(),
    repoPath,
    projectRoot,
    evidenceMode: "none",
  });
  assert.equal(payload.version, "1.2");
  assert.equal("evidence" in payload.findings.connections[0], false);
});

test("INT-01 M8 — unknown evidenceMode falls back to 'full' with a console.warn (no throw)", () => {
  const repoPath = makeTempGitRepo();
  const { projectRoot } = makeTempFileWithContent(EVIDENCE_LITERAL + "\n");
  const originalWarn = console.warn;
  const captured = [];
  console.warn = (msg) => captured.push(String(msg));
  let payload;
  try {
    const out = buildScanPayload({
      findings: makeEvidenceFindings(),
      repoPath,
      projectRoot,
      evidenceMode: "weird-not-real",
    });
    payload = out.payload;
  } finally {
    console.warn = originalWarn;
  }
  // Falls back to "full" → libraryDepsEnabled defaults false → version 1.0
  assert.equal(payload.version, "1.0");
  assert.equal(payload.findings.connections[0].evidence, EVIDENCE_LITERAL);
  assert.equal(captured.length, 1, "console.warn fired exactly once");
  assert.match(captured[0], /unknown evidence_mode/i);
  assert.match(captured[0], /weird-not-real/);
});

test("INT-01 M9 — state machine matrix across (evidenceMode, libraryDepsEnabled) combos", () => {
  const repoPath = makeTempGitRepo();
  const { projectRoot } = makeTempFileWithContent(EVIDENCE_LITERAL + "\n");
  const cases = [
    { evidenceMode: "full",      withDeps: false, expectedVersion: "1.0", evShape: "string" },
    { evidenceMode: "full",      withDeps: true,  expectedVersion: "1.1", evShape: "string" },
    { evidenceMode: "hash-only", withDeps: false, expectedVersion: "1.2", evShape: "object" },
    { evidenceMode: "hash-only", withDeps: true,  expectedVersion: "1.2", evShape: "object" },
    { evidenceMode: "none",      withDeps: false, expectedVersion: "1.2", evShape: "absent" },
    { evidenceMode: "none",      withDeps: true,  expectedVersion: "1.2", evShape: "absent" },
  ];
  for (const c of cases) {
    const { payload } = buildScanPayload({
      findings: makeEvidenceFindings({ withDeps: c.withDeps }),
      repoPath,
      projectRoot,
      evidenceMode: c.evidenceMode,
      libraryDepsEnabled: c.withDeps,
    });
    assert.equal(
      payload.version,
      c.expectedVersion,
      `case ${c.evidenceMode}/withDeps=${c.withDeps}: expected version ${c.expectedVersion} got ${payload.version}`,
    );
    const conn = payload.findings.connections[0];
    if (c.evShape === "string") {
      assert.equal(typeof conn.evidence, "string");
    } else if (c.evShape === "object") {
      assert.equal(typeof conn.evidence, "object");
      assert.ok(conn.evidence.hash);
    } else {
      assert.equal("evidence" in conn, false);
    }
    if (c.withDeps) {
      assert.deepEqual(payload.findings.services[0].dependencies, [SAMPLE_DEP_ROW]);
    }
  }
});

// ── LOAD-BEARING byte-identical regression ─────────────────────────────────

test("INT-01 M10 — BYTE-IDENTICAL FULL @ v1.0: evidenceMode='full' === omitted-evidenceMode for the same input", () => {
  const repoPath = makeTempGitRepo();
  const { projectRoot } = makeTempFileWithContent(EVIDENCE_LITERAL + "\n");
  const findings = {
    services: [{ name: "svc-a" }],
    connections: [
      { source: "svc-a", target: "db", protocol: "tcp", evidence: "foo" },
    ],
  };
  const a = buildScanPayload({
    findings,
    repoPath,
    projectRoot,
    evidenceMode: "full",
    // Pin timestamps so the metadata.started_at/completed_at don't drift between calls.
    startedAt: new Date("2026-04-25T00:00:00Z"),
    completedAt: new Date("2026-04-25T00:00:01Z"),
  });
  const b = buildScanPayload({
    findings,
    repoPath,
    projectRoot,
    startedAt: new Date("2026-04-25T00:00:00Z"),
    completedAt: new Date("2026-04-25T00:00:01Z"),
  });
  assert.equal(
    JSON.stringify(a.payload),
    JSON.stringify(b.payload),
    "evidenceMode='full' must produce byte-identical JSON to omitted-mode at v1.0",
  );
});

test("INT-01 M11 — BYTE-IDENTICAL FULL @ v1.1 (LOAD-BEARING pre-flight): evidenceMode='full' + libraryDepsEnabled === omitted-evidenceMode", () => {
  const repoPath = makeTempGitRepo();
  const { projectRoot } = makeTempFileWithContent(EVIDENCE_LITERAL + "\n");
  const findings = {
    services: [{ name: "svc-a", dependencies: [SAMPLE_DEP_ROW] }],
    connections: [
      { source: "svc-a", target: "db", protocol: "tcp", evidence: "foo" },
    ],
  };
  const sharedTs = {
    startedAt: new Date("2026-04-25T00:00:00Z"),
    completedAt: new Date("2026-04-25T00:00:01Z"),
  };
  const a = buildScanPayload({
    findings,
    repoPath,
    projectRoot,
    evidenceMode: "full",
    libraryDepsEnabled: true,
    ...sharedTs,
  });
  const b = buildScanPayload({
    findings,
    repoPath,
    projectRoot,
    libraryDepsEnabled: true,
    ...sharedTs,
  });
  // Pre-Phase-120 v1.1 payload bytes must match post-Phase-120 v1.1 with full mode.
  assert.equal(a.payload.version, "1.1", "expected v1.1 envelope");
  assert.equal(b.payload.version, "1.1", "expected v1.1 envelope");
  assert.equal(
    JSON.stringify(a.payload),
    JSON.stringify(b.payload),
    "evidenceMode='full' must produce byte-identical JSON to omitted-mode at v1.1 — load-bearing pre-flight contract",
  );
});

test("INT-01 — ALLOWED_EVIDENCE_MODES enum is exported and frozen", () => {
  assert.deepEqual([...ALLOWED_EVIDENCE_MODES].sort(), ["full", "hash-only", "none"].sort());
  assert.throws(() => {
    ALLOWED_EVIDENCE_MODES.push("xyz");
  });
});
