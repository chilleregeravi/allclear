---
phase: 93-dep-collector
plan: "02"
subsystem: database/query-engine
tags: [database, sqlite, upsert, query-engine, dep-08, row-id-stability]

dependency_graph:
  requires:
    - migrations/010_service_dependencies.js (service_dependencies table + 4-col UNIQUE)
    - migrations/006_dedup_repos.js (uq_repos_path UNIQUE index required by QueryEngine constructor)
    - database.js runMigrations() (used by seedDb() in tests for full schema)
  provides:
    - QueryEngine.upsertDependency(row) — stable-id upsert for dep rows
    - QueryEngine.getDependenciesForService(serviceId) — ordered dep fetch
    - query-engine.dependencies.test.js — 7 DEP-08 acceptance tests
  affects:
    - Phase 93-03 dep-collector (calls upsertDependency per manifest entry)
    - Phase 96 hub payload v1.1 (calls getDependenciesForService to build payload)

tech_stack:
  added: []
  patterns:
    - "INSERT ... ON CONFLICT(4-col) DO UPDATE SET for row-id-stable upserts"
    - "try/catch around db.prepare() in constructor for backward-compat with pre-migration DBs"
    - "lastInsertRowid fallback to SELECT for stable id on UPDATE branch (better-sqlite3 returns 0 on UPDATE path)"
    - "runMigrations() in test seedDb() to get full schema rather than partial migration chain"

key_files:
  created:
    - plugins/arcanon/worker/db/query-engine.dependencies.test.js
  modified:
    - plugins/arcanon/worker/db/query-engine.js

decisions:
  - "ON CONFLICT DO UPDATE (not INSERT OR REPLACE) — INSERT OR REPLACE deletes+reinserts the row, changing its id and breaking any FK chains or cached IDs in callers. ON CONFLICT DO UPDATE touches only the named SET columns, leaving id untouched."
  - "No deleteStaleDependencies() helper — ON DELETE CASCADE from services(id) already removes dep rows when endScan() deletes stale services. A no-op helper would create misleading API symmetry and invite accidental double-delete."
  - "lastInsertRowid fallback SELECT — better-sqlite3 returns lastInsertRowid=0 when ON CONFLICT takes the UPDATE branch. A subsequent SELECT by the 4-col key recovers the stable id so upsertDependency always returns a non-null integer on success."
  - "runMigrations() in seedDb() — early prototype used only migrations 001+005+010 but QueryEngine constructor prepares _stmtUpsertRepo unconditionally; that statement needs the uq_repos_path UNIQUE index added by migration 006. Using runMigrations() applies all migrations in version order, eliminating partial-chain fragility."

metrics:
  duration: "~8 minutes"
  completed: "2026-04-19T15:51:00Z"
  tasks_completed: 2
  files_created: 1
  files_modified: 1
---

# Phase 93 Plan 02: QueryEngine Dependency API Summary

**One-liner:** `upsertDependency` and `getDependenciesForService` added to QueryEngine using `ON CONFLICT DO UPDATE` on the 4-col UNIQUE — row IDs are stable across re-scans, proven by 7 passing DEP-08 tests.

## What Was Built

Two deliverables:

- `plugins/arcanon/worker/db/query-engine.js` — 3 additive changes: new `_stmtUpsertDependency` prepared statement in constructor, new `upsertDependency(row)` method, new `getDependenciesForService(serviceId)` method. Zero changes to `endScan`, `beginScan`, or stale-cleanup statements.
- `plugins/arcanon/worker/db/query-engine.dependencies.test.js` — 7 `it()` blocks covering row-id stability, update-on-conflict, 4-col UNIQUE semantics, dep_kind default, sorted retrieval, empty result, and pre-migration-010 graceful absence.

## Prepared Statement (as added to constructor)

```javascript
// --- service_dependencies statement (migration 010) ---
this._stmtUpsertDependency = null;
try {
  this._stmtUpsertDependency = db.prepare(`
    INSERT INTO service_dependencies (
      service_id, scan_version_id, ecosystem, package_name,
      version_spec, resolved_version, manifest_file, dep_kind
    )
    VALUES (
      @service_id, @scan_version_id, @ecosystem, @package_name,
      @version_spec, @resolved_version, @manifest_file, @dep_kind
    )
    ON CONFLICT(service_id, ecosystem, package_name, manifest_file) DO UPDATE SET
      version_spec     = excluded.version_spec,
      resolved_version = excluded.resolved_version,
      scan_version_id  = excluded.scan_version_id,
      dep_kind         = excluded.dep_kind
  `);
} catch {
  // service_dependencies table not present (pre-migration-010 db)
  this._stmtUpsertDependency = null;
}
```

## Method Signatures

```javascript
/**
 * @param {object} row
 * @param {number} row.service_id
 * @param {number|null} row.scan_version_id
 * @param {string} row.ecosystem
 * @param {string} row.package_name
 * @param {string|null} row.version_spec
 * @param {string|null} row.resolved_version
 * @param {string} row.manifest_file
 * @param {string} [row.dep_kind='direct']
 * @returns {number|null}
 */
upsertDependency(row)

/**
 * @param {number} serviceId
 * @returns {Array<{id, service_id, scan_version_id, ecosystem, package_name, version_spec, resolved_version, manifest_file, dep_kind}>}
 */
getDependenciesForService(serviceId)
```

## Test Results

```
▶ QueryEngine dependencies API (DEP-08)
  ✔ upsertDependency preserves row id across repeat upserts
  ✔ upsertDependency update-on-conflict replaces version_spec and resolved_version
  ✔ different manifest_file for same package creates a second row
  ✔ dep_kind defaults to direct when omitted
  ✔ getDependenciesForService returns sorted rows
  ✔ getDependenciesForService returns [] for service with no deps
  ✔ graceful absence on pre-migration-010 database
✔ QueryEngine dependencies API (DEP-08)
tests 7  pass 7  fail 0
```

## Decisions Made

1. **`ON CONFLICT DO UPDATE`, not `INSERT OR REPLACE`** — `INSERT OR REPLACE` deletes the existing row and reinserts a new one, assigning a new `id`. Any caller caching or FK-referencing the original id gets a dangling reference. `ON CONFLICT DO UPDATE` performs an in-place column update, leaving `id` untouched. Row-id stability is the primary acceptance bar for DEP-08.

2. **No `deleteStaleDependencies()` helper** — `ON DELETE CASCADE` on `service_id` means `endScan()`'s existing stale-service cleanup cascades to dep rows automatically. A separate helper would be dead code in production and could create confusion about whether cleanup is single- or double-applied.

3. **`lastInsertRowid` fallback to `SELECT`** — `better-sqlite3` returns `lastInsertRowid = 0` when `ON CONFLICT DO UPDATE` takes the UPDATE branch (no row inserted). To guarantee callers always receive the stable integer id, `upsertDependency` falls back to a `SELECT id ... WHERE service_id=? AND ecosystem=? AND package_name=? AND manifest_file=?` on the update path.

4. **`runMigrations()` in `seedDb()`** — Initial test prototype imported only migrations 001+005+010. The `QueryEngine` constructor unconditionally prepares `_stmtUpsertRepo` with `ON CONFLICT(path)`, which requires the `uq_repos_path` UNIQUE index added by migration 006. Using `runMigrations()` applies all migrations in version order, making `seedDb()` robust against future migrations that add similar unconditional prepared statements.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] seedDb() applied incomplete migration chain**
- **Found during:** Task 2 GREEN phase — tests failed with `SQLITE_ERROR: ON CONFLICT clause does not match any PRIMARY KEY or UNIQUE constraint` at QueryEngine constructor line 345 (`_stmtUpsertRepo`).
- **Issue:** Test plan specified `up001 + up005 + up010` but QueryEngine constructor unconditionally prepares `_stmtUpsertRepo` with `ON CONFLICT(path)`, which requires the `uq_repos_path` UNIQUE index from migration 006.
- **Fix:** Replaced individual migration imports with `runMigrations(db)` from `database.js`. For the pre-migration-010 graceful-absence test, the table is dropped after `runMigrations()` completes.
- **Files modified:** `query-engine.dependencies.test.js`
- **Commit:** `c834b09`

## Known Stubs

None. This plan delivers query-engine methods only; no UI or data-wiring stubs.

## Threat Flags

None. This plan adds internal DB methods with no new network endpoints, auth paths, or external trust boundary changes.

## Self-Check: PASSED

- `plugins/arcanon/worker/db/query-engine.js` — FOUND
- `plugins/arcanon/worker/db/query-engine.dependencies.test.js` — FOUND
- commit `820dbfd` (test RED) — FOUND
- commit `c834b09` (feat GREEN) — FOUND
