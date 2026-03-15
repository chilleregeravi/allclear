---
phase: 14-storage-foundation
plan: 01
subsystem: database
tags: [sqlite, better-sqlite3, fts5, migrations, wal-mode]

# Dependency graph
requires: []
provides:
  - SQLite database module (worker/db.js) with WAL mode and migration runner
  - Initial schema with 7 domain tables (repos, services, connections, schemas, fields, map_versions, repo_state)
  - FTS5 virtual tables for keyword search (connections_fts, services_fts, fields_fts)
  - 9 FTS5 content-sync triggers (insert/delete/update for each FTS table)
  - Migration system using schema_versions table, idempotent and version-ordered
affects: [15-worker-lifecycle, 16-mcp-server, 17-http-server, 18-scan-manager]

# Tech tracking
tech-stack:
  added: [better-sqlite3@^12.8.0]
  patterns:
    - Hash-based DB path pattern — sha256(projectRoot).slice(0,12) for project isolation
    - Top-level await ES module migration preloading — async import() at module load, sync openDb()
    - WAL + FK + synchronous=NORMAL + cache=64MB + busy_timeout=5s pragma stack
    - FTS5 content tables with ai/ad/au trigger pattern for incremental sync

key-files:
  created:
    - worker/db.js
    - worker/migrations/001_initial_schema.js
    - worker/db.test.js
    - worker/migrations.test.js
  modified:
    - package.json (type=module, engines>=20 already present, better-sqlite3 confirmed)

key-decisions:
  - "Top-level await used in db.js to preload ES module migrations synchronously before any openDb() call"
  - "FTS5 content tables (not tokenized copies) with trigger-based sync chosen for consistency with design doc"
  - "Migration runner reads MAX(version) from schema_versions to skip already-applied migrations"

patterns-established:
  - "openDb(projectRoot?) is idempotent — module-level singleton, returns same instance on repeat calls"
  - "getDb() throws clear error message if called before openDb — fail-fast for misconfigured callers"
  - "Each migration wrapped in db.transaction() for atomic application + schema_versions insert"

requirements-completed: [STOR-01, STOR-02, STOR-04, STOR-05]

# Metrics
duration: 7min
completed: 2026-03-15
---

# Phase 14 Plan 01: Storage Foundation Summary

**SQLite database module with WAL mode, 7-table schema, FTS5 keyword search, and version-based migration system using better-sqlite3**

## Performance

- **Duration:** 7 min
- **Started:** 2026-03-15T17:05:56Z
- **Completed:** 2026-03-15T17:12:09Z
- **Tasks:** 2
- **Files modified:** 4 created, 1 confirmed (package.json)

## Accomplishments

- `worker/db.js` exports `openDb(projectRoot?)` and `getDb()` with full pragma stack and migration runner
- Migration 001 creates all 7 domain tables, 3 FTS5 virtual tables, and 9 content-sync triggers
- FTS5 keyword search verified end-to-end: insert row, search via MATCH, delete syncs automatically
- All operations idempotent — running on an existing DB at schema_version=1 is a no-op

## Task Commits

Each task was committed atomically:

1. **Task 1 RED: failing tests for openDb/getDb** - `36df524` (test)
2. **Task 1 GREEN: implement openDb/getDb** - `1d26beb` (feat)
3. **Task 2 RED: failing tests for migration 001** - `5fb2a0f` (test)
4. **Task 2 GREEN: implement migration 001** - `77a5a34` (feat)

_Note: TDD tasks have multiple commits (test RED → feat GREEN)_

## Files Created/Modified

- `worker/db.js` — Database lifecycle module: openDb, getDb, runMigrations with top-level await migration preloading
- `worker/migrations/001_initial_schema.js` — Initial schema DDL: 7 tables, 3 FTS5 virtual tables, 9 triggers
- `worker/db.test.js` — TDD test file for openDb/getDb behavior (WAL, FK, idempotency, path creation)
- `worker/migrations.test.js` — TDD test file for migration 001 (tables, FTS5 round-trip, triggers, delete sync)
- `package.json` — Confirmed: type=module, engines>=20, better-sqlite3@^12.8.0 present

## Decisions Made

- Used top-level await at module load in `db.js` to preload migration ES modules before any `openDb()` call. This preserves the synchronous `openDb()` API that better-sqlite3 expects while supporting ES module migration files with `export const version` / `export function up` syntax.
- FTS5 content tables (not standalone) with trigger-based sync — keeps search index in lock-step with domain data without requiring explicit FTS maintenance calls.
- Hash-based DB path (`~/.allclear/projects/<sha256(projectRoot).slice(0,12)>/impact-map.db`) ensures project isolation without any configuration.

## Deviations from Plan

None — plan executed exactly as written. The top-level await migration loading approach was the natural ES module solution for synchronous openDb() with async module imports.

## Issues Encountered

None — `better-sqlite3` was already in `package.json` (added by a prior planning phase), so `npm install` succeeded immediately. The `type: "module"` and `engines` fields were also pre-populated.

## User Setup Required

None — no external service configuration required. Database is created on first `openDb()` call.

## Next Phase Readiness

- `worker/db.js` is ready to import in phases 15 (worker lifecycle), 16 (MCP server), and 17 (HTTP server)
- All subsequent phases can call `openDb(projectRoot)` and rely on the schema being fully initialized
- FTS5 tables ready for scan manager (phase 18) to populate via service/connection inserts

---
*Phase: 14-storage-foundation*
*Completed: 2026-03-15*
