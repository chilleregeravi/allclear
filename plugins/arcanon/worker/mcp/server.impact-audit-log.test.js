/**
 * worker/mcp/server.impact-audit-log.test.js — Phase 111 Plan 03 (TRUST-06, TRUST-14)
 *
 * Verifies the new MCP tool `impact_audit_log` exposed by Plan 111-03:
 *   - The tool's handler `handleImpactAuditLog(params)` is exported from
 *     server.js (testability per Plan 111-03 Task 2 <action>).
 *   - With a populated DB, calling the handler with { scan_version_id: N }
 *     returns the rows wrapped in MCP envelope: { content:[{ type:'text', text }] }.
 *   - The `enricher` filter narrows results to a single enricher.
 *   - Project resolution by absolute path resolves the correct DB.
 *   - When no DB is resolvable, returns the standard `no_scan_data` error
 *     envelope (parity with impact_query / impact_changed / impact_search).
 *   - With an existing DB but unknown scan_version_id, returns [] in the envelope.
 *
 * Setup: ARCANON_DATA_DIR is set to a tmp dir BEFORE importing server.js so
 * the module-level dataDir constant in server.js, pool.js, and database.js
 * all see the same fixture root. We seed a fixture project DB at the correct
 * sha256-12 hashed path.
 *
 * Run: node --test plugins/arcanon/worker/mcp/server.impact-audit-log.test.js
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';
import crypto from 'node:crypto';

// CRITICAL: set ARCANON_DATA_DIR BEFORE the dynamic imports below.
// server.js, pool.js, and database.js all evaluate resolveDataDir() at module
// load time via top-level constants. If we set the env var after import, the
// fixture DB path won't be honored.
const TMP_DATA_DIR = fs.mkdtempSync(
  path.join(os.tmpdir(), 'arcanon-audit-log-test-'),
);
process.env.ARCANON_DATA_DIR = TMP_DATA_DIR;

// Now import the handler + supporting modules.
const { handleImpactAuditLog } = await import('./server.js');
const { QueryEngine } = await import('../db/query-engine.js');
const { openDb } = await import('../db/database.js');

/**
 * Compute the fixture project's hashed data dir, mirroring server.js
 * resolveDbPath() and pool.js projectHashDir().
 */
function projectDir(projectRoot) {
  const hash = crypto
    .createHash('sha256')
    .update(projectRoot)
    .digest('hex')
    .slice(0, 12);
  return path.join(TMP_DATA_DIR, 'projects', hash);
}

/**
 * Seed a fixture project DB at <TMP_DATA_DIR>/projects/<hash>/impact-map.db.
 * Calls openDb(projectRoot) which mkdir's the dir and runs all migrations
 * (001..016). Returns { projectRoot, qe, scanVersionId } where the scan
 * version has 2 audit rows (1 reconciliation, 1 codeowners) attached.
 *
 * Each call uses a unique projectRoot so test cases get isolated DBs.
 */
function seedFixture(projectName, withRows = true) {
  const projectRoot = path.join(TMP_DATA_DIR, 'fixtures', projectName);
  fs.mkdirSync(projectRoot, { recursive: true });
  // Pre-create the hashed dir so openDb() finds it
  fs.mkdirSync(projectDir(projectRoot), { recursive: true });
  const db = openDb(projectRoot);
  const qe = new QueryEngine(db);
  // Seed a repos row + scan_versions row directly (pre-bracket — simplest).
  const repoId = db
    .prepare("INSERT INTO repos (path, name, type) VALUES (?, ?, 'single')")
    .run(projectRoot, projectName).lastInsertRowid;
  const scanVersionId = qe.beginScan(repoId);

  if (withRows) {
    qe.logEnrichment(
      scanVersionId, 'reconciliation', 'connection', 1, 'crossing',
      'external', 'cross-service', 'target matches known service: auth',
    );
    qe.logEnrichment(
      scanVersionId, 'codeowners', 'service', 1, 'owner',
      null, '@team-a', 'codeowners file',
    );
  }

  return { projectRoot, scanVersionId };
}

/** Pull the JSON-decoded payload out of an MCP envelope response. */
function unwrap(envelope) {
  assert.ok(envelope && Array.isArray(envelope.content), 'envelope has content array');
  assert.equal(envelope.content.length, 1);
  assert.equal(envelope.content[0].type, 'text');
  return JSON.parse(envelope.content[0].text);
}

// ─────────────────────────────────────────────────────────────
// Tests
// ─────────────────────────────────────────────────────────────

test('Test 1 — handleImpactAuditLog is exported from server.js', () => {
  assert.equal(
    typeof handleImpactAuditLog,
    'function',
    'handleImpactAuditLog must be exported as a top-level function (testability — see Plan 111-03 Task 2)',
  );
});

test('Test 2 — returns the 2 audit rows wrapped in the standard MCP envelope', async () => {
  const { projectRoot, scanVersionId } = seedFixture('test2-returns-rows');
  const envelope = await handleImpactAuditLog({
    scan_version_id: scanVersionId,
    project: projectRoot,
  });
  const rows = unwrap(envelope);
  assert.ok(Array.isArray(rows), 'unwrapped payload is an array');
  assert.equal(rows.length, 2);
  // Confirm the row shape includes all expected enrichment_log columns.
  const sample = rows[0];
  for (const col of [
    'id', 'scan_version_id', 'enricher', 'target_kind', 'target_id',
    'field', 'from_value', 'to_value', 'reason', 'created_at',
  ]) {
    assert.ok(col in sample, `row has column ${col}`);
  }
  const enrichers = rows.map((r) => r.enricher).sort();
  assert.deepEqual(enrichers, ['codeowners', 'reconciliation']);
});

test('Test 3 — enricher filter returns only matching rows', async () => {
  const { projectRoot, scanVersionId } = seedFixture('test3-filter');
  const envelope = await handleImpactAuditLog({
    scan_version_id: scanVersionId,
    enricher: 'reconciliation',
    project: projectRoot,
  });
  const rows = unwrap(envelope);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].enricher, 'reconciliation');
  assert.equal(rows[0].field, 'crossing');
  assert.equal(rows[0].from_value, 'external');
  assert.equal(rows[0].to_value, 'cross-service');
});

test('Test 4 — project resolution by absolute path returns that DB rows', async () => {
  const { projectRoot, scanVersionId } = seedFixture('test4-project-by-path');
  const envelope = await handleImpactAuditLog({
    scan_version_id: scanVersionId,
    project: projectRoot,
  });
  const rows = unwrap(envelope);
  // Both rows belong to the resolved DB — resolution worked.
  assert.equal(rows.length, 2);
  assert.ok(rows.every((r) => r.scan_version_id === scanVersionId));
});

test('Test 5 — no_scan_data error envelope when project is not resolvable', async () => {
  // An absolute path that does not exist in the projects/ tree → resolveDb
  // returns null (security check in server.js rejects paths outside dataDir/projects).
  const envelope = await handleImpactAuditLog({
    scan_version_id: 1,
    project: '/nonexistent/absolute/path/xyz',
  });
  const payload = unwrap(envelope);
  assert.equal(payload.error, 'no_scan_data');
  assert.ok(typeof payload.hint === 'string' && payload.hint.length > 0);
  assert.equal(payload.project, '/nonexistent/absolute/path/xyz');
});

test('Test 6 — empty array when scan_version_id has no audit rows', async () => {
  const { projectRoot, scanVersionId } = seedFixture(
    'test6-empty',
    /* withRows */ false,
  );
  const envelope = await handleImpactAuditLog({
    scan_version_id: scanVersionId,
    project: projectRoot,
  });
  const rows = unwrap(envelope);
  assert.ok(Array.isArray(rows));
  assert.equal(rows.length, 0);

  // Also test with a known DB but completely unknown scan_version_id.
  const envelope2 = await handleImpactAuditLog({
    scan_version_id: 99999,
    project: projectRoot,
  });
  const rows2 = unwrap(envelope2);
  assert.ok(Array.isArray(rows2));
  assert.equal(rows2.length, 0);
});

test('cleanup — remove tmp data dir', () => {
  fs.rmSync(TMP_DATA_DIR, { recursive: true, force: true });
});
