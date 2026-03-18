# Deferred Items — Phase 35: external-actors

## Pre-existing failures

### query-engine-upsert.test.js
- **Status:** Failing before plan 35-01 began
- **Error:** `SqliteError: ON CONFLICT clause does not match any PRIMARY KEY or UNIQUE constraint` on `_stmtUpsertRepo`
- **Root cause:** The upsert test DB (migrations 001-004 only) doesn't have `UNIQUE INDEX` on `repos.path`. The `_stmtUpsertRepo` uses `ON CONFLICT(path) DO UPDATE` which requires a UNIQUE constraint on `path`. Migration 006 (`006_dedup_repos.js`) creates this index, but the upsert test only applies migrations 001-004.
- **Fix needed:** Update `query-engine-upsert.test.js` to apply migrations 001-006 (or inline the UNIQUE INDEX on repos.path in the test setup).
- **Discovered during:** Plan 35-01 Task 1/2 execution
