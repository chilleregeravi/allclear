---
phase: 93-dep-collector
plan: "04"
subsystem: scan-pipeline
tags: [scan-pipeline, manager, integration, enrichment, dep-collector]
dependency_graph:
  requires: [93-03]
  provides: [DEP-09, DEP-10, DEP-11]
  affects: [manager.js, service_dependencies table]
tech_stack:
  added: []
  patterns: [phase-b-loop-enrichment, on-delete-cascade, error-containment]
key_files:
  created:
    - plugins/arcanon/worker/scan/manager.dep-collector.test.js
  modified:
    - plugins/arcanon/worker/scan/manager.js
decisions:
  - "collectDependencies called inside the existing enrichment try/catch — belt-and-suspenders error containment without new wrapping logic"
  - "boundary_entry column added via ALTER TABLE in test buildQe() — schema drift between migrations and prod DDL; NOT fixed in migrations (out of scope for this plan)"
  - "Service type must be 'service' not 'http' — findings validator enforces enum [service, library, sdk, infra]"
metrics:
  duration: "~25 minutes"
  completed: "2026-04-19"
  tasks_completed: 2
  files_modified: 1
  files_created: 1
requirements: [DEP-09, DEP-10, DEP-11]
---

# Phase 93 Plan 04: Manager Phase B Loop Wiring Summary

One-liner: collectDependencies wired into manager.js Phase B loop per service after runEnrichmentPass, with upsertDependency persistence, ecosystemsSeen INFO logging, and cascade-cleanup proven end-to-end.

## What Was Built

### Task 1 — Wire collectDependencies into manager.js Phase B loop

Import added (line 35):

    import { collectDependencies } from "./enrichment/dep-collector.js";

The service loop now:
1. Calls `await runEnrichmentPass(...)` as before
2. Calls `await collectDependencies({ repoPath, rootPath: service.root_path, logger: _logger })`
3. Upserts each returned row via `queryEngine.upsertDependency({ ...row, service_id: service.id, scan_version_id: r.scanVersionId })`
4. Accumulates `ecosystemsSeen` across services
5. After the loop logs `slog('INFO', 'dep-scan done', { repoPath, serviceCount, totalDeps, ecosystemsSeen: [...ecosystemsSeen].sort() })`

Each throw from collectDependencies or upsertDependency is caught and logged as WARN — the scan never fails.

**INFO log shape (dep-scan done):**

    { "repoPath": "/path/to/repo", "serviceCount": 1, "totalDeps": 2, "ecosystemsSeen": ["npm"] }

**Critical invariants held:**
- queryEngine.beginScan / queryEngine.endScan calls: unchanged (git diff confirms zero bracket call changes)
- Stale-cleanup SQL: not touched
- Stale dep cleanup: handled entirely by ON DELETE CASCADE from services(id) — no new DELETE statements
- Logger passed to collectDependencies is `_logger` (object with .log()), not `slog` (a closure)

### Task 2 — End-to-end integration test

**File:** plugins/arcanon/worker/scan/manager.dep-collector.test.js

4 tests, all passing:

| Test | Coverage |
|------|----------|
| scanRepos populates service_dependencies end-to-end (DEP-09) | react + lodash inserted; vitest devDep excluded |
| cascade cleanup when service removed on re-scan (DEP-10) | baseline N > 0 then re-scan with empty services gives count = 0 |
| collector throw does not fail scan (DEP-09 error containment) | invalid package.json forces scan to resolve without rejection |
| dep-scan done INFO log includes ecosystemsSeen with npm (DEP-11) | log entry present, level=INFO, ecosystemsSeen includes 'npm' |

## Full Phase 93 Test Results

    node --test 010_service_dependencies.test.js query-engine.dependencies.test.js dep-collector.test.js manager.dep-collector.test.js
    tests 43 | pass 43 | fail 0

| Plan | Test File | Tests |
|------|-----------|-------|
| 93-01 | 010_service_dependencies.test.js | 7 |
| 93-02 | query-engine.dependencies.test.js | 18 |
| 93-03 | dep-collector.test.js | 14 |
| 93-04 | manager.dep-collector.test.js | 4 |
| **Total** | | **43** |

Existing manager.test.js: 60 tests, 0 failures (zero regressions).

## Phase-Wide Invariants Proven

1. **Migration 010 schema correctness** — 7 tests: idempotent, columns, CHECK constraints, UNIQUE, indexes, CASCADE
2. **upsertDependency row-id stability** — repeat upsert of same (service_id, ecosystem, package_name, manifest_file) preserves same row id
3. **Production-only dep emission** — devDependencies excluded end-to-end; vitest never appears in service_dependencies
4. **WARN on unsupported manifest** — dep-collector emits WARN for Swift/Composer/Mix/SBT/Pub manifests
5. **Cascade cleanup via ON DELETE CASCADE** — proven in integration test; no new DELETE SQL added
6. **beginScan/endScan untouched** — git diff grep on actual bracket calls returns empty

## Commits

| Hash | Type | Description |
|------|------|-------------|
| c5b3bf4 | feat(93-04) | Wire collectDependencies into manager.js Phase B loop |
| dfe93d7 | test(93-04) | End-to-end integration test for dep-collector wiring |

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Findings stub missing `schemas` and `service_name` fields**
- Found during: Task 2 RED phase
- Issue: Agent output validator requires service_name (non-empty string) and schemas (array). Without them parseAgentOutput returns valid:false and Phase B is skipped entirely — deps never written.
- Fix: Added service_name, confidence, schemas to stub findings in makeAgentRunner
- Files modified: manager.dep-collector.test.js

**2. [Rule 1 - Bug] Service type `http` rejected by findings validator**
- Found during: Task 2 RED phase
- Issue: VALID_SERVICE_TYPES = [service, library, sdk, infra]. Type `http` is not in the enum; the service was silently skipped, leaving services[] empty, so dep-collector was never called.
- Fix: Changed fixture service type from `http` to `service`
- Files modified: manager.dep-collector.test.js

**3. [Rule 3 - Blocker] `boundary_entry` column absent from migration chain**
- Found during: Task 2 RED phase
- Issue: manager.js line 774 queries `SELECT id, root_path, language, boundary_entry FROM services WHERE repo_id = ?`. This column exists in prod DDL but is NOT added by any migration (001-010). runMigrations on an in-memory DB produces a schema without boundary_entry, causing the enrichment loop to throw `no such column: boundary_entry`. The outer catch swallows it — dep-collector is never reached.
- Fix: Added `try { db.exec('ALTER TABLE services ADD COLUMN boundary_entry TEXT'); } catch (_) {}` in buildQe() after runMigrations
- Files modified: manager.dep-collector.test.js

## Deferred Items

- **Schema drift — `boundary_entry` missing from migration chain:** The services.boundary_entry column is used by manager.js and enrichment.js but is not added by any migration (001-010). A future migration should ALTER TABLE services ADD COLUMN boundary_entry TEXT to close this drift.

## Known Stubs

None. All dep rows flow through to the real service_dependencies table via live upsertDependency calls.

## Threat Flags

None. This plan only calls existing query-engine methods and reads manifests from the local filesystem. No new network endpoints or auth paths introduced.

## Self-Check: PASSED
