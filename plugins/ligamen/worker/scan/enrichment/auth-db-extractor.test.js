/**
 * Tests for auth-db-extractor.js — auth mechanism and DB backend enricher.
 *
 * Run: node --test worker/scan/enrichment/auth-db-extractor.test.js
 *
 * Uses node:test + node:assert/strict + better-sqlite3 in-memory DB.
 * File fixtures created in tmpdir via mkdtempSync.
 */

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import Database from 'better-sqlite3';
import { mkdtempSync, writeFileSync, mkdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import { extractAuthAndDb } from './auth-db-extractor.js';

// ---------------------------------------------------------------------------
// Helper: in-memory DB with node_metadata and services tables (migration 009)
// ---------------------------------------------------------------------------

function buildDb() {
  const db = new Database(':memory:');
  db.pragma('foreign_keys = ON');

  db.exec(`
    CREATE TABLE repos (
      id   INTEGER PRIMARY KEY AUTOINCREMENT,
      path TEXT NOT NULL,
      name TEXT NOT NULL,
      type TEXT NOT NULL
    );

    CREATE TABLE services (
      id             INTEGER PRIMARY KEY AUTOINCREMENT,
      repo_id        INTEGER NOT NULL REFERENCES repos(id),
      name           TEXT    NOT NULL,
      root_path      TEXT    NOT NULL,
      language       TEXT,
      boundary_entry TEXT,
      auth_mechanism TEXT,
      db_backend     TEXT
    );

    CREATE TABLE node_metadata (
      id         INTEGER PRIMARY KEY AUTOINCREMENT,
      service_id INTEGER NOT NULL REFERENCES services(id) ON DELETE CASCADE,
      view       TEXT    NOT NULL,
      key        TEXT    NOT NULL,
      value      TEXT,
      source     TEXT,
      updated_at TEXT    NOT NULL DEFAULT (datetime('now')),
      UNIQUE(service_id, view, key)
    );
  `);

  db.prepare("INSERT INTO repos (path, name, type) VALUES (?, ?, ?)").run('/tmp/repo', 'testrepo', 'mono');
  db.prepare("INSERT INTO services (repo_id, name, root_path, language, boundary_entry) VALUES (?, ?, ?, ?, ?)").run(1, 'api', '/tmp/repo/api', 'javascript', 'index.js');

  return db;
}

// Helper: get node_metadata value for a service
function getMeta(db, serviceId, view, key) {
  const row = db.prepare('SELECT value FROM node_metadata WHERE service_id = ? AND view = ? AND key = ?').get(serviceId, view, key);
  return row ? row.value : undefined;
}

// Helper: get services columns
function getServiceCols(db, serviceId) {
  return db.prepare('SELECT auth_mechanism, db_backend FROM services WHERE id = ?').get(serviceId);
}

// Helper: build a ctx object for tests
function buildCtx(db, repoPath, language, entryFile) {
  return {
    serviceId: 1,
    repoPath,
    language,
    entryFile,
    db,
    logger: null,
  };
}

// ---------------------------------------------------------------------------
// Test 1: Python jwt — PyJWT in entry file → auth_mechanism='jwt', confidence='high'
// ---------------------------------------------------------------------------

describe('auth detection — Python', () => {
  let tmpDir;

  before(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'auth-test-py-'));
    writeFileSync(join(tmpDir, 'main.py'), `
from PyJWT import encode, decode

def get_token(user):
    return encode({'sub': user}, 'secret')
`);
  });

  after(() => rmSync(tmpDir, { recursive: true, force: true }));

  it('PyJWT import in entry file -> jwt, high confidence', async () => {
    const db = buildDb();
    const ctx = buildCtx(db, tmpDir, 'python', 'main.py');
    const result = await extractAuthAndDb(ctx);

    assert.equal(result.auth_mechanism, 'jwt');
    assert.equal(result.auth_confidence, 'high');
    assert.equal(getMeta(db, 1, 'security', 'auth_mechanism'), 'jwt');
    assert.equal(getMeta(db, 1, 'security', 'auth_confidence'), 'high');
    assert.equal(getServiceCols(db, 1).auth_mechanism, 'jwt');
    db.close();
  });
});

// ---------------------------------------------------------------------------
// Test 2: Node.js jwt — jsonwebtoken import in entry file → jwt, high
// ---------------------------------------------------------------------------

describe('auth detection — Node.js jwt (entry file)', () => {
  let tmpDir;

  before(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'auth-test-node-'));
    writeFileSync(join(tmpDir, 'index.js'), `
import jwt from 'jsonwebtoken';

export function signToken(payload) {
  return jwt.sign(payload, process.env.SECRET);
}
`);
  });

  after(() => rmSync(tmpDir, { recursive: true, force: true }));

  it('jsonwebtoken import in entry file -> jwt, high confidence', async () => {
    const db = buildDb();
    const ctx = buildCtx(db, tmpDir, 'javascript', 'index.js');
    const result = await extractAuthAndDb(ctx);

    assert.equal(result.auth_mechanism, 'jwt');
    assert.equal(result.auth_confidence, 'high');
    assert.equal(getMeta(db, 1, 'security', 'auth_mechanism'), 'jwt');
    db.close();
  });
});

// ---------------------------------------------------------------------------
// Test 3: Node.js oauth2 in secondary file only → oauth2, low confidence
// ---------------------------------------------------------------------------

describe('auth detection — Node.js oauth2 (secondary file only)', () => {
  let tmpDir;

  before(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'auth-test-node-oauth-'));
    writeFileSync(join(tmpDir, 'index.js'), `
// plain express server, no auth here
import express from 'express';
`);
    mkdirSync(join(tmpDir, 'middleware'), { recursive: true });
    writeFileSync(join(tmpDir, 'middleware', 'auth.js'), `
import passport from 'passport';
passport.use(new Strategy());
`);
  });

  after(() => rmSync(tmpDir, { recursive: true, force: true }));

  it('passport.use only in middleware/auth.js -> oauth2, low confidence', async () => {
    const db = buildDb();
    const ctx = buildCtx(db, tmpDir, 'javascript', 'index.js');
    const result = await extractAuthAndDb(ctx);

    assert.equal(result.auth_mechanism, 'oauth2');
    assert.equal(result.auth_confidence, 'low');
    db.close();
  });
});

// ---------------------------------------------------------------------------
// Test 4: Node.js both jwt AND oauth2 → oauth2+jwt
// ---------------------------------------------------------------------------

describe('auth detection — Node.js oauth2+jwt combination', () => {
  let tmpDir;

  before(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'auth-test-combo-'));
    writeFileSync(join(tmpDir, 'index.js'), `
import jwt from 'jsonwebtoken';
import passport from 'passport';
passport.use(new LocalStrategy());
`);
  });

  after(() => rmSync(tmpDir, { recursive: true, force: true }));

  it('both jsonwebtoken and passport.use -> oauth2+jwt', async () => {
    const db = buildDb();
    const ctx = buildCtx(db, tmpDir, 'javascript', 'index.js');
    const result = await extractAuthAndDb(ctx);

    assert.equal(result.auth_mechanism, 'oauth2+jwt');
    db.close();
  });
});

// ---------------------------------------------------------------------------
// Test 5: schema.prisma with postgresql → db_backend='postgresql'
// ---------------------------------------------------------------------------

describe('db detection — prisma postgresql', () => {
  let tmpDir;

  before(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'db-test-prisma-'));
    writeFileSync(join(tmpDir, 'index.js'), `// simple service`);
    writeFileSync(join(tmpDir, 'schema.prisma'), `
datasource db {
  provider = "postgresql"
  url      = env("DATABASE_URL")
}
`);
  });

  after(() => rmSync(tmpDir, { recursive: true, force: true }));

  it('schema.prisma with postgresql provider -> db_backend=postgresql', async () => {
    const db = buildDb();
    const ctx = buildCtx(db, tmpDir, 'javascript', 'index.js');
    const result = await extractAuthAndDb(ctx);

    assert.equal(result.db_backend, 'postgresql');
    assert.equal(getMeta(db, 1, 'infra', 'db_backend'), 'postgresql');
    assert.equal(getServiceCols(db, 1).db_backend, 'postgresql');
    db.close();
  });
});

// ---------------------------------------------------------------------------
// Test 6: .env DATABASE_URL=postgres:// → db_backend='postgresql'
// ---------------------------------------------------------------------------

describe('db detection — .env DATABASE_URL', () => {
  let tmpDir;

  before(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'db-test-env-'));
    writeFileSync(join(tmpDir, 'index.js'), `// plain service`);
    writeFileSync(join(tmpDir, '.env'), `
DATABASE_URL=postgres://user:pass@localhost:5432/mydb
PORT=3000
`);
  });

  after(() => rmSync(tmpDir, { recursive: true, force: true }));

  it('.env DATABASE_URL with postgres -> db_backend=postgresql', async () => {
    const db = buildDb();
    const ctx = buildCtx(db, tmpDir, 'javascript', 'index.js');
    const result = await extractAuthAndDb(ctx);

    assert.equal(result.db_backend, 'postgresql');
    db.close();
  });
});

// ---------------------------------------------------------------------------
// Test 7: No auth, no DB → null for both (no false positive)
// ---------------------------------------------------------------------------

describe('no detection — null results for clean service', () => {
  let tmpDir;

  before(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'auth-test-none-'));
    writeFileSync(join(tmpDir, 'index.js'), `
// plain express service — no auth, no ORM
import express from 'express';
const app = express();
app.get('/', (req, res) => res.send('hello'));
`);
  });

  after(() => rmSync(tmpDir, { recursive: true, force: true }));

  it('no auth or DB signals -> null,null — no false positive', async () => {
    const db = buildDb();
    const ctx = buildCtx(db, tmpDir, 'javascript', 'index.js');
    const result = await extractAuthAndDb(ctx);

    assert.equal(result.auth_mechanism, null);
    assert.equal(result.db_backend, null);
    assert.equal(getMeta(db, 1, 'security', 'auth_mechanism'), undefined);
    assert.equal(getMeta(db, 1, 'infra', 'db_backend'), undefined);
    db.close();
  });
});

// ---------------------------------------------------------------------------
// Test 8: *.test.js file excluded — credential in test file not extracted
// ---------------------------------------------------------------------------

describe('file exclusion — test files', () => {
  let tmpDir;

  before(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'auth-test-excl-test-'));
    writeFileSync(join(tmpDir, 'index.js'), `// plain service`);
    mkdirSync(join(tmpDir, 'auth'), { recursive: true });
    writeFileSync(join(tmpDir, 'auth', 'auth.test.js'), `
import jwt from 'jsonwebtoken';
`);
  });

  after(() => rmSync(tmpDir, { recursive: true, force: true }));

  it('*.test.js file is excluded -> jwt not extracted', async () => {
    const db = buildDb();
    const ctx = buildCtx(db, tmpDir, 'javascript', 'index.js');
    const result = await extractAuthAndDb(ctx);

    assert.equal(result.auth_mechanism, null);
    db.close();
  });
});

// ---------------------------------------------------------------------------
// Test 9: *.example file excluded — not scanned
// ---------------------------------------------------------------------------

describe('file exclusion — example files', () => {
  let tmpDir;

  before(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'auth-test-excl-ex-'));
    writeFileSync(join(tmpDir, 'index.js'), `// plain service`);
    writeFileSync(join(tmpDir, 'config.example'), `jsonwebtoken=my-secret-key`);
  });

  after(() => rmSync(tmpDir, { recursive: true, force: true }));

  it('*.example file is excluded -> jwt not extracted from it', async () => {
    const db = buildDb();
    const ctx = buildCtx(db, tmpDir, 'javascript', 'index.js');
    const result = await extractAuthAndDb(ctx);

    assert.equal(result.auth_mechanism, null);
    db.close();
  });
});

// ---------------------------------------------------------------------------
// Test 10: Extracted label is short (3 chars) — not rejected by credential check
// ---------------------------------------------------------------------------

describe('credential rejection — short labels pass', () => {
  it('auth mechanism label jwt (3 chars) is not rejected', async () => {
    const tmpDir = mkdtempSync(join(tmpdir(), 'auth-test-short-'));
    writeFileSync(join(tmpDir, 'index.js'), `import jwt from 'jsonwebtoken';`);
    const db = buildDb();
    const ctx = buildCtx(db, tmpDir, 'javascript', 'index.js');
    const result = await extractAuthAndDb(ctx);
    assert.equal(result.auth_mechanism, 'jwt');
    db.close();
    rmSync(tmpDir, { recursive: true, force: true });
  });
});

// ---------------------------------------------------------------------------
// Test 11: Service with Bearer token in source — no crash, function runs cleanly
// ---------------------------------------------------------------------------

describe('credential rejection — Bearer token in source', () => {
  it('Bearer token in source comment does not crash extractor', async () => {
    const tmpDir = mkdtempSync(join(tmpdir(), 'auth-test-bearer-'));
    writeFileSync(join(tmpDir, 'index.js'), `
// Example token: Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.dozjgNryP4J3jVmNHl0w5N_XgL0n3I1jFDPkdWDjZ
const x = 1;
`);
    const db = buildDb();
    const ctx = buildCtx(db, tmpDir, 'javascript', 'index.js');
    const result = await extractAuthAndDb(ctx);
    assert.ok(result !== null && typeof result === 'object', 'should return an object');
    db.close();
    rmSync(tmpDir, { recursive: true, force: true });
  });
});

// ---------------------------------------------------------------------------
// Test 12: Go service with oauth2 import in entry file → oauth2, high
// ---------------------------------------------------------------------------

describe('auth detection — Go oauth2', () => {
  let tmpDir;

  before(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'auth-test-go-'));
    writeFileSync(join(tmpDir, 'main.go'), `
package main

import (
  "golang.org/x/oauth2"
  "golang.org/x/oauth2/google"
)

func main() {
  config := &oauth2.Config{}
  _ = config
}
`);
  });

  after(() => rmSync(tmpDir, { recursive: true, force: true }));

  it('golang.org/x/oauth2 in entry file -> oauth2, high confidence', async () => {
    const db = buildDb();
    const ctx = buildCtx(db, tmpDir, 'go', 'main.go');
    const result = await extractAuthAndDb(ctx);

    assert.equal(result.auth_mechanism, 'oauth2');
    assert.equal(result.auth_confidence, 'high');
    db.close();
  });
});

// ---------------------------------------------------------------------------
// Test 13: Rust service with sqlite prisma schema → db_backend='sqlite'
// ---------------------------------------------------------------------------

describe('db detection — Rust service with sqlite prisma schema', () => {
  let tmpDir;

  before(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'db-test-rust-sqlite-'));
    writeFileSync(join(tmpDir, 'main.rs'), `// Rust service`);
    writeFileSync(join(tmpDir, 'schema.prisma'), `
datasource db {
  provider = "sqlite"
  url      = "file:./dev.db"
}
`);
  });

  after(() => rmSync(tmpDir, { recursive: true, force: true }));

  it('schema.prisma with sqlite provider in Rust service -> db_backend=sqlite', async () => {
    const db = buildDb();
    const ctx = buildCtx(db, tmpDir, 'rust', 'main.rs');
    const result = await extractAuthAndDb(ctx);

    assert.equal(result.db_backend, 'sqlite');
    db.close();
  });
});
