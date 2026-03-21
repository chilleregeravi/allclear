/**
 * Tests for sanitizeBindings helper and undefined-safe upsert methods.
 *
 * Run: node worker/db/query-engine-sanitize.test.js
 */

import assert from "assert";
import Database from "better-sqlite3";

async function buildDb() {
  const db = new Database(":memory:");
  db.pragma("foreign_keys = ON");

  db.exec(`
    CREATE TABLE schema_versions (
      version    INTEGER PRIMARY KEY,
      applied_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE TABLE repos (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      path        TEXT NOT NULL,
      name        TEXT NOT NULL,
      type        TEXT NOT NULL,
      last_commit TEXT,
      scanned_at  TEXT
    );
    CREATE TABLE services (
      id        INTEGER PRIMARY KEY AUTOINCREMENT,
      repo_id   INTEGER NOT NULL REFERENCES repos(id),
      name      TEXT    NOT NULL,
      root_path TEXT    NOT NULL,
      language  TEXT    NOT NULL
    );
    CREATE TABLE connections (
      id                INTEGER PRIMARY KEY AUTOINCREMENT,
      source_service_id INTEGER NOT NULL REFERENCES services(id),
      target_service_id INTEGER NOT NULL REFERENCES services(id),
      protocol          TEXT    NOT NULL,
      method            TEXT,
      path              TEXT,
      source_file       TEXT,
      target_file       TEXT
    );
    CREATE TABLE schemas (
      id            INTEGER PRIMARY KEY AUTOINCREMENT,
      connection_id INTEGER NOT NULL REFERENCES connections(id),
      role          TEXT    NOT NULL,
      name          TEXT    NOT NULL,
      file          TEXT
    );
    CREATE TABLE fields (
      id        INTEGER PRIMARY KEY AUTOINCREMENT,
      schema_id INTEGER NOT NULL REFERENCES schemas(id),
      name      TEXT    NOT NULL,
      type      TEXT    NOT NULL,
      required  INTEGER NOT NULL DEFAULT 0
    );
    CREATE TABLE map_versions (
      id            INTEGER PRIMARY KEY AUTOINCREMENT,
      created_at    TEXT NOT NULL DEFAULT (datetime('now')),
      label         TEXT,
      snapshot_path TEXT
    );
    CREATE TABLE repo_state (
      id                   INTEGER PRIMARY KEY AUTOINCREMENT,
      repo_id              INTEGER NOT NULL UNIQUE REFERENCES repos(id),
      last_scanned_commit  TEXT,
      last_scanned_at      TEXT
    );
    CREATE VIRTUAL TABLE connections_fts USING fts5(
      path, protocol, source_file, target_file,
      content='connections', content_rowid='id'
    );
    CREATE VIRTUAL TABLE services_fts USING fts5(
      name,
      content='services', content_rowid='id'
    );
    CREATE VIRTUAL TABLE fields_fts USING fts5(
      name, type,
      content='fields', content_rowid='id'
    );
    CREATE TRIGGER services_ai AFTER INSERT ON services BEGIN
      INSERT INTO services_fts(rowid, name) VALUES (new.id, new.name);
    END;
    CREATE TRIGGER services_ad AFTER DELETE ON services BEGIN
      INSERT INTO services_fts(services_fts, rowid, name) VALUES ('delete', old.id, old.name);
    END;
    CREATE TRIGGER services_au AFTER UPDATE ON services BEGIN
      INSERT INTO services_fts(services_fts, rowid, name) VALUES ('delete', old.id, old.name);
      INSERT INTO services_fts(rowid, name) VALUES (new.id, new.name);
    END;
    CREATE TRIGGER connections_ai AFTER INSERT ON connections BEGIN
      INSERT INTO connections_fts(rowid, path, protocol, source_file, target_file)
        VALUES (new.id, new.path, new.protocol, new.source_file, new.target_file);
    END;
    CREATE TRIGGER connections_ad AFTER DELETE ON connections BEGIN
      INSERT INTO connections_fts(connections_fts, rowid, path, protocol, source_file, target_file)
        VALUES ('delete', old.id, old.path, old.protocol, old.source_file, old.target_file);
    END;
    CREATE TRIGGER connections_au AFTER UPDATE ON connections BEGIN
      INSERT INTO connections_fts(connections_fts, rowid, path, protocol, source_file, target_file)
        VALUES ('delete', old.id, old.path, old.protocol, old.source_file, old.target_file);
      INSERT INTO connections_fts(rowid, path, protocol, source_file, target_file)
        VALUES (new.id, new.path, new.protocol, new.source_file, new.target_file);
    END;
    CREATE TRIGGER fields_ai AFTER INSERT ON fields BEGIN
      INSERT INTO fields_fts(rowid, name, type) VALUES (new.id, new.name, new.type);
    END;
    CREATE TRIGGER fields_ad AFTER DELETE ON fields BEGIN
      INSERT INTO fields_fts(fields_fts, rowid, name, type) VALUES ('delete', old.id, old.name, old.type);
    END;
    CREATE TRIGGER fields_au AFTER UPDATE ON fields BEGIN
      INSERT INTO fields_fts(fields_fts, rowid, name, type) VALUES ('delete', old.id, old.name, old.type);
      INSERT INTO fields_fts(rowid, name, type) VALUES (new.id, new.name, new.type);
    END;
  `);

  db.exec(`INSERT INTO schema_versions(version) VALUES(1);`);
  db.exec(`ALTER TABLE services ADD COLUMN type TEXT NOT NULL DEFAULT 'service';`);
  db.exec(`INSERT INTO schema_versions(version) VALUES(2);`);
  db.exec(`
    CREATE TABLE exposed_endpoints (
      id         INTEGER PRIMARY KEY AUTOINCREMENT,
      service_id INTEGER NOT NULL REFERENCES services(id),
      method     TEXT,
      path       TEXT NOT NULL,
      handler    TEXT,
      UNIQUE(service_id, method, path)
    );
  `);
  db.exec(`INSERT INTO schema_versions(version) VALUES(3);`);

  const { up: up004 } = await import("./migrations/004_dedup_constraints.js");
  db.transaction(() => { up004(db); db.prepare("INSERT INTO schema_versions(version) VALUES(?)").run(4); })();

  const { up: up005 } = await import("./migrations/005_scan_versions.js");
  db.transaction(() => { up005(db); db.prepare("INSERT INTO schema_versions(version) VALUES(?)").run(5); })();

  const { up: up006 } = await import("./migrations/006_dedup_repos.js");
  db.transaction(() => { up006(db); db.prepare("INSERT INTO schema_versions(version) VALUES(?)").run(6); })();

  return db;
}

// ---------------------------------------------------------------------------
// Test 1: upsertService with language: undefined does NOT throw
// ---------------------------------------------------------------------------
console.log("Test 1: upsertService with language: undefined does not throw TypeError");
{
  const db = await buildDb();
  const { QueryEngine } = await import("./query-engine.js?v=sanitize-1");
  const qe = new QueryEngine(db);

  const repoId = db
    .prepare("INSERT INTO repos(path, name, type) VALUES(?,?,?)")
    .run("/tmp/san-r1", "san-repo1", "single").lastInsertRowid;

  assert.doesNotThrow(() => {
    qe.upsertService({ repo_id: repoId, name: "svc-undef", root_path: ".", language: undefined });
  }, "upsertService with language: undefined must not throw");

  const row = db.prepare("SELECT language FROM services WHERE name = ?").get("svc-undef");
  assert.ok(row, "Service row should exist");
  assert.strictEqual(row.language, null, "language should be stored as null");

  db.close();
}
console.log("  PASS");

// ---------------------------------------------------------------------------
// Test 2: upsertService with no undefined values still works correctly
// ---------------------------------------------------------------------------
console.log("Test 2: upsertService with valid values still works correctly");
{
  const db = await buildDb();
  const { QueryEngine } = await import("./query-engine.js?v=sanitize-2");
  const qe = new QueryEngine(db);

  const repoId = db
    .prepare("INSERT INTO repos(path, name, type) VALUES(?,?,?)")
    .run("/tmp/san-r2", "san-repo2", "single").lastInsertRowid;

  assert.doesNotThrow(() => {
    qe.upsertService({ repo_id: repoId, name: "svc-normal", root_path: ".", language: "ts" });
  });

  const row = db.prepare("SELECT language FROM services WHERE name = ?").get("svc-normal");
  assert.ok(row, "Service row should exist");
  assert.strictEqual(row.language, "ts", "language should be 'ts'");

  db.close();
}
console.log("  PASS");

// ---------------------------------------------------------------------------
// Test 3: upsertConnection with protocol: undefined does NOT throw
// ---------------------------------------------------------------------------
console.log("Test 3: upsertConnection with protocol: undefined does not throw TypeError");
{
  const db = await buildDb();
  const { QueryEngine } = await import("./query-engine.js?v=sanitize-3");
  const qe = new QueryEngine(db);

  const repoId = db
    .prepare("INSERT INTO repos(path, name, type) VALUES(?,?,?)")
    .run("/tmp/san-r3", "san-repo3", "single").lastInsertRowid;

  const svcId = qe.upsertService({ repo_id: repoId, name: "svc-conn", root_path: ".", language: "js" });

  assert.doesNotThrow(() => {
    qe.upsertConnection({
      source_service_id: svcId,
      target_service_id: svcId,
      protocol: undefined,
    });
  }, "upsertConnection with protocol: undefined must not throw");

  db.close();
}
console.log("  PASS");

// ---------------------------------------------------------------------------
// Test 4: sanitizeBindings function exists in source (at least 3 occurrences)
// ---------------------------------------------------------------------------
console.log("Test 4: sanitizeBindings defined in query-engine.js with at least 3 occurrences");
{
  const { readFileSync } = await import("fs");
  const { fileURLToPath } = await import("url");
  const { dirname, join } = await import("path");
  const __dir = dirname(fileURLToPath(import.meta.url));
  const src = readFileSync(join(__dir, "query-engine.js"), "utf8");

  assert.ok(
    src.includes("function sanitizeBindings"),
    "query-engine.js must define 'function sanitizeBindings'",
  );

  const matches = (src.match(/sanitizeBindings/g) || []).length;
  assert.ok(
    matches >= 3,
    `Expected at least 3 occurrences of 'sanitizeBindings' (definition + 2 call sites), got ${matches}`,
  );
}
console.log("  PASS");

console.log("\nAll sanitizeBindings tests PASS");
