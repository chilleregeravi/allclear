/**
 * Tests for worker/migrations/001_initial_schema.js via openDb
 * Run: node --input-type=module < worker/migrations.test.js
 */

import assert from "assert";
import os from "os";
import path from "path";
import fs from "fs";

// Each test needs a fresh db instance so we need separate test roots.
// However, db.js uses a module-level singleton. For isolated tests, we
// run separate node processes below via the inline heredoc verify form.
// This test file verifies schema structure in one pass using a fresh dir.

const testRoot = path.join(os.tmpdir(), "allclear-schema-test-" + Date.now());
fs.mkdirSync(testRoot, { recursive: true });

// Import openDb (requires migration 001 to exist for meaningful assertions)
const { openDb } = await import("./db.js");
const db = openDb(testRoot);

// All 7 domain tables must exist
const tables = db
  .prepare("SELECT name FROM sqlite_master WHERE type='table'")
  .pluck()
  .all();
[
  "repos",
  "services",
  "connections",
  "schemas",
  "fields",
  "map_versions",
  "repo_state",
].forEach((t) => {
  assert.ok(tables.includes(t), `table ${t} exists`);
});

// schema_versions has version 1
const ver = db
  .prepare("SELECT MAX(version) FROM schema_versions")
  .pluck()
  .get();
assert.strictEqual(ver, 1, "schema version is 1");

// FTS5 virtual tables must exist
const allObjs = db.prepare("SELECT name FROM sqlite_master").pluck().all();
["connections_fts", "services_fts", "fields_fts"].forEach((t) => {
  assert.ok(allObjs.includes(t), `FTS5 table ${t} exists`);
});

// FTS5 round-trip: insert service, find via FTS5
const repoId = db
  .prepare("INSERT INTO repos(path,name,type) VALUES(?,?,?)")
  .run("/tmp/r", "r", "single").lastInsertRowid;
db.prepare(
  "INSERT INTO services(repo_id,name,root_path,language) VALUES(?,?,?,?)",
).run(repoId, "payment-service", "/tmp/r/payment", "node");
const hit = db
  .prepare("SELECT name FROM services_fts WHERE services_fts MATCH 'payment'")
  .pluck()
  .all();
assert.ok(hit.includes("payment-service"), "FTS5 finds inserted service name");

// FTS5 delete: removing service removes from FTS5
db.prepare("DELETE FROM services WHERE name = ?").run("payment-service");
const hitAfterDelete = db
  .prepare("SELECT name FROM services_fts WHERE services_fts MATCH 'payment'")
  .pluck()
  .all();
assert.ok(
  !hitAfterDelete.includes("payment-service"),
  "FTS5 no longer has deleted service",
);

// All 9 FTS5 triggers exist
const triggers = db
  .prepare("SELECT name FROM sqlite_master WHERE type='trigger'")
  .pluck()
  .all();
const expectedTriggers = [
  "services_ai",
  "services_ad",
  "services_au",
  "connections_ai",
  "connections_ad",
  "connections_au",
  "fields_ai",
  "fields_ad",
  "fields_au",
];
expectedTriggers.forEach((t) => {
  assert.ok(triggers.includes(t), `trigger ${t} exists`);
});

console.log("PASS: migration 001 schema and FTS5 behavior");
db.close();
