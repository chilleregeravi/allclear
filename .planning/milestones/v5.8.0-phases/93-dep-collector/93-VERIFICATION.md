---
phase: 93-dep-collector
verified: 2026-04-19T16:10:00Z
status: passed
score: 5/5
overrides_applied: 0
---

# Phase 93: DB Schema + Dependency Collector — Verification Report

**Phase Goal:** Migration 010 creates the `service_dependencies` table with `dep_kind` discriminant and 4-column UNIQUE constraint; dep-collector.js reads all supported ecosystems and persists production deps; manager.js Phase B loop calls it after enrichment.
**Verified:** 2026-04-19T16:10:00Z
**Status:** PASSED
**Re-verification:** No — initial verification

---

## Goal Achievement

### Observable Truths

| # | Truth | Status | Evidence |
|---|-------|--------|----------|
| 1 | Migration 010 creates `service_dependencies` with `dep_kind TEXT CHECK(dep_kind IN ('direct','transient')) DEFAULT 'direct'` and `UNIQUE(service_id, ecosystem, package_name, manifest_file)` 4-column key; indexes on `package_name` and `scan_version_id` present | VERIFIED | `010_service_dependencies.js` lines 34-43 — exact CHECK and UNIQUE DDL confirmed. Two `CREATE INDEX IF NOT EXISTS` statements present. Migration test suite (7 tests) covers idempotency, columns, CHECK, UNIQUE, indexes, and CASCADE. |
| 2 | `upsertDependency` uses `ON CONFLICT DO UPDATE` preserving row IDs across re-scans (NOT `INSERT OR REPLACE`) | VERIFIED | `query-engine.js` lines 493-507 — `ON CONFLICT(service_id, ecosystem, package_name, manifest_file) DO UPDATE SET`. Zero occurrences of `INSERT OR REPLACE` in query-engine.js. 18 QE tests cover upsert + row-id stability. |
| 3 | `collectDependencies` covers 7 ecosystems (npm/pypi/go/cargo/maven/nuget/rubygems); emits WARN for unsupported manifests; `ecosystems_scanned` visible in logs | VERIFIED | `dep-collector.js` lines 60-69 — all 7 `tryParser()` calls present. `scanUnsupportedTopLevel()` warns for Swift/Composer/Mix/SBT/Pub. 14 collector tests including one per ecosystem parser + WARN test. |
| 4 | `manager.js` Phase B loop calls `collectDependencies` after `runEnrichmentPass` with NO changes to `beginScan`/`endScan` | VERIFIED | `manager.js` lines 779-816 — `collectDependencies` called inside the service loop after `runEnrichmentPass`. `git show c5b3bf4 -- manager.js \| grep "^[-+].*(beginScan\|endScan)"` returns only comment additions — zero bracket call changes. |
| 5 | `ON DELETE CASCADE` handles stale dep cleanup; no new delete SQL in endScan; devDependencies NOT persisted | VERIFIED | Migration DDL line 27: `REFERENCES services(id) ON DELETE CASCADE`. Integration test "cascade cleanup when service removed on re-scan" passes. npm parser reads only `pkg.dependencies` (not `devDependencies`). Maven parser skips `scope === 'test'`. |

**Score:** 5/5 truths verified

---

## Required Artifacts

| Artifact | Expected | Status | Details |
|----------|----------|--------|---------|
| `plugins/arcanon/worker/db/migrations/010_service_dependencies.js` | Migration DDL with CHECK + 4-col UNIQUE + CASCADE + indexes | VERIFIED | 44 lines; exact DDL confirmed |
| `plugins/arcanon/worker/db/query-engine.js` (upsertDependency, getDependenciesForService) | ON CONFLICT DO UPDATE; stable row IDs | VERIFIED | Lines 762-804; both methods present and substantive |
| `plugins/arcanon/worker/scan/enrichment/dep-collector.js` | 7-ecosystem parsers, production-only, WARN on unsupported | VERIFIED | 479 lines; all 7 parsers implemented with real parse logic |
| `plugins/arcanon/worker/scan/manager.js` (Phase B loop) | collectDependencies called after runEnrichmentPass | VERIFIED | Import line 35; call at line 786; bracket untouched |
| `plugins/arcanon/worker/db/migrations/010_service_dependencies.test.js` | 7 migration tests | VERIFIED | 7 pass |
| `plugins/arcanon/worker/db/query-engine.dependencies.test.js` | upsert + get + row-id stability tests | VERIFIED | 18 pass |
| `plugins/arcanon/worker/scan/enrichment/dep-collector.test.js` | 14 parser + WARN tests | VERIFIED | 14 pass |
| `plugins/arcanon/worker/scan/manager.dep-collector.test.js` | 4 integration tests (DEP-09/10/11) | VERIFIED | 4 pass |

---

## Key Link Verification

| From | To | Via | Status | Details |
|------|----|-----|--------|---------|
| `manager.js` | `dep-collector.js` | `import { collectDependencies }` (line 35) | WIRED | Called at line 786 inside Phase B service loop |
| `manager.js` | `queryEngine.upsertDependency` | `for (const row of rows) queryEngine.upsertDependency(...)` (line 793) | WIRED | Each row from collector persisted; scan_version_id attached |
| `dep-collector.js` | 7 manifest parsers | `tryParser('npm', ...)` … `tryParser('rubygems', ...)` (lines 60-66) | WIRED | All 7 parsers called unconditionally; null return = ecosystem absent |
| Migration 010 | `services(id)` | `REFERENCES services(id) ON DELETE CASCADE` | WIRED | Stale dep cleanup automatic when endScan removes stale service |

---

## Data-Flow Trace (Level 4)

| Artifact | Data Variable | Source | Produces Real Data | Status |
|----------|---------------|--------|--------------------|--------|
| `manager.js` dep loop | `rows` from `collectDependencies` | Manifest files at `service.root_path` | Yes — file-system parse; integration test confirms npm rows inserted | FLOWING |
| `upsertDependency` | `service_dependencies` table row | `_stmtUpsertDependency.run(params)` | Yes — real SQLite write; row-id returned | FLOWING |

---

## Behavioral Spot-Checks

| Behavior | Command | Result | Status |
|----------|---------|--------|--------|
| All 43 Phase 93 tests pass | `node --test 010_service_dependencies.test.js query-engine.dependencies.test.js dep-collector.test.js manager.dep-collector.test.js` | 43 pass, 0 fail | PASS |
| Zero regressions in existing manager tests | `node --test worker/scan/manager.test.js` | 60 pass, 0 fail | PASS |
| beginScan/endScan untouched in Phase B commit | `git show c5b3bf4 -- manager.js \| grep "^[-+].*(beginScan\|endScan)"` | Only comment additions, no call-site changes | PASS |
| INSERT OR REPLACE absent from query-engine | grep for `INSERT OR REPLACE` | 0 occurrences | PASS |

---

## Requirements Coverage

| Requirement | Description | Status | Evidence |
|-------------|-------------|--------|----------|
| DEP-01 | `service_dependencies` table with all required columns incl. `dep_kind CHECK` | SATISFIED | Migration DDL verified; 010 test confirms |
| DEP-02 | `UNIQUE(service_id, ecosystem, package_name, manifest_file)` 4-column key | SATISFIED | Line 35 of migration; UNIQUE test passes |
| DEP-03 | Index on `package_name` and `scan_version_id` | SATISFIED | Lines 38-43 of migration; index test passes |
| DEP-04 | v5.8.0 writes `dep_kind = 'direct'` only | SATISFIED | All parsers emit `dep_kind: 'direct'`; column exists for future `'transient'` |
| DEP-05 | `collectDependencies(repoPath, rootPath)` exports, returns one row per production dep | SATISFIED | All 7 parsers implemented; 14 tests pass |
| DEP-06 | WARN on unsupported manifests; `ecosystems_scanned` in logs | SATISFIED | `scanUnsupportedTopLevel` warns; `dep-scan done` INFO log includes `ecosystemsSeen` |
| DEP-07 | Production deps only — devDependencies excluded | SATISFIED | npm reads `pkg.dependencies` only; maven skips `scope === 'test'`; integration test confirms vitest absent |
| DEP-08 | `upsertDependency` uses `ON CONFLICT DO UPDATE` preserving row IDs | SATISFIED | Lines 502-506 of query-engine.js; 18 QE tests confirm row-id stability |
| DEP-09 | `manager.js` Phase B loop calls `collectDependencies` after `runEnrichmentPass` | SATISFIED | Import + call at lines 35, 786; integration test passes |
| DEP-10 | Stale rows cleaned by `ON DELETE CASCADE`; no new cleanup statement | SATISFIED | CASCADE DDL confirmed; cascade integration test passes; endScan unchanged |
| DEP-11 | node:test coverage per ecosystem + upsert + dedup + cascade cleanup | SATISFIED | 43 tests covering all required scenarios |

---

## Anti-Patterns Found

None detected. No TODO/FIXME/placeholder comments in Phase 93 files. No stub return patterns in parsers. No `INSERT OR REPLACE`. No hardcoded empty arrays passed to rendering paths.

**Notable deferred item (documented, not a blocker):** The `boundary_entry` column is used in `manager.js` line 774 (`SELECT id, root_path, language, boundary_entry FROM services`) but is not present in any migration (001-010). This pre-existing schema drift was worked around in the integration test with an `ALTER TABLE` in `buildQe()`. This is out of scope for Phase 93 and does not affect production (the column exists in the prod DDL via a separate path). Flagged in 93-04-SUMMARY.md deferred items.

---

## Human Verification Required

None. All success criteria are fully verifiable programmatically. No UI components or external service integrations were introduced.

---

## Gaps Summary

No gaps. All 5 observable truths verified, all 11 DEP requirements satisfied, 43 tests pass, 60 regression tests pass.

---

_Verified: 2026-04-19T16:10:00Z_
_Verifier: Claude (gsd-verifier)_
