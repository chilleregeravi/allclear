---
phase: 21-integration-config
plan: "04"
subsystem: integration-tests
tags: [integration, bats, testing, impact-map, chromadb, session-hook, snapshot]
dependency_graph:
  requires: [21-01, 21-02, 21-03, worker/db.js, worker/query-engine.js, worker/scan-manager.js, worker/chroma-sync.js, scripts/session-start.sh]
  provides: [tests/integration/impact-flow.bats]
  affects: [ci, regression-coverage]
tech_stack:
  added: []
  patterns: [bats-inline-node-eval, in-memory-sqlite-schema, hermetic-tmpdir-isolation, mock-worker-client-sentinel]
key_files:
  created: [tests/integration/impact-flow.bats]
  modified: []
decisions:
  - "Used node --input-type=module --eval with inline schema setup rather than importing db.js to avoid singleton interference between test processes"
  - "In-memory SQLite for most tests, file-backed DB only for INTG-E2E-05 (VACUUM INTO requires a real file path)"
  - "INTG-E2E-01 verified with QueryEngine.transitiveImpact; INTG-E2E-05 verified with QueryEngine.createMapVersion to test the db.js snapshot path indirectly"
  - "Sentinel file pattern reused from session-start.bats for INTG-E2E-04 worker auto-start verification"
metrics:
  duration: "142s"
  completed_date: "2026-03-15"
  tasks_completed: 1
  files_changed: 1
---

# Phase 21 Plan 04: Integration Test Suite Summary

End-to-end bats integration tests covering scan-to-query flow, incremental scan, ChromaDB fallback chain, session-hook auto-start, and snapshot lifecycle — all passing without ChromaDB running or real Claude agents.

## What Was Built

`tests/integration/impact-flow.bats` — 11 integration tests across 6 test groups (INTG-E2E-01 through INTG-E2E-06):

| Test | Description | Approach |
|------|-------------|----------|
| INTG-E2E-01 (×2) | Transitive A->B->C query; cyclic graph no-hang | In-memory SQLite + QueryEngine.transitiveImpact |
| INTG-E2E-02 (×2) | Incremental scan returns only changed files; full scan returns all | Real git repo in tmpdir + scan-manager.getChangedFiles |
| INTG-E2E-03 (×2) | FTS5 tier (skipChroma); SQL tier (skipChroma+skipFts5) | In-memory SQLite + query-engine.search() |
| INTG-E2E-04 (×2) | Worker auto-start with impact-map config; skip without | Sentinel file + mock worker-client.sh |
| INTG-E2E-05 (×1) | createMapVersion() creates snapshot file; map_versions row inserted | File-backed SQLite + VACUUM INTO |
| INTG-E2E-06 (×2) | SKILL.md contains ChromaDB and mcp-server.js text | grep on skills/impact/SKILL.md |

All 11 tests pass. Test suite completes in under 30 seconds.

## Key Design Decisions

**Inline schema vs. db.js import:** Each Node.js subprocess (called via `node --input-type=module --eval`) creates an isolated in-memory database with the schema applied inline. This avoids the db.js module-level singleton (which would persist across processes in a long-lived Node.js process) and ensures each test is fully hermetic.

**File-backed DB for INTG-E2E-05:** `VACUUM INTO` requires a real file path (SQLite cannot vacuum an in-memory DB to a file from certain environments). Test 5 creates a tmpdir with a real `.db` file and cleans up in the assertion block.

**Sentinel file pattern for INTG-E2E-04:** Reused the established pattern from `tests/session-start.bats` — a mock `worker-client.sh` that `touch`es a sentinel file when `worker_start_background` is called. The bats assertion checks `[ -f "$SENTINEL" ]`.

**_resetForTest() before each Node.js search test:** Ensures ChromaDB is marked unavailable (as it would be without a running instance), so the fallback tiers are exercised correctly.

## Test Results

All 11 integration tests pass:

```
1..11
ok 1 INTG-E2E-01: transitive query returns B and C for A->B->C chain
ok 2 INTG-E2E-01: cyclic graph A->B->C->A does not hang or error
ok 3 INTG-E2E-02: incremental scan returns only changed files
ok 4 INTG-E2E-02: full scan (sinceCommit=null) returns all tracked files
ok 5 INTG-E2E-03: search with skipChroma returns FTS5 results (tier 2)
ok 6 INTG-E2E-03: search with skipChroma+skipFts5 returns SQL tier results
ok 7 INTG-E2E-04: worker_start_background called when config has impact-map section
ok 8 INTG-E2E-04: worker_start_background NOT called when config has no impact-map section
ok 9 INTG-E2E-05: isFirstScan returns false after writeScan; createSnapshot creates file
ok 10 INTG-E2E-06: SKILL.md contains ALLCLEAR_CHROMA_MODE recommendation
ok 11 INTG-E2E-06: SKILL.md contains mcp-server.js reference
```

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Adaptation] Used QueryEngine.createMapVersion instead of db.createSnapshot for INTG-E2E-05**
- **Found during:** Task 1
- **Issue:** `db.createSnapshot()` relies on `getDb()` (singleton) which requires `openDb()` to have been called first. Since tests use direct `new Database()` rather than the openDb singleton path, calling `createSnapshot` from `worker/db.js` would throw "Database not initialized".
- **Fix:** Used `QueryEngine.createMapVersion(label)` which accepts any db instance directly and exercises the same VACUUM INTO + map_versions insertion path.
- **Files modified:** tests/integration/impact-flow.bats (test design only)

**2. [Rule 2 - Missing context] Added inline schema DDL for each Node.js subprocess test**
- **Found during:** Task 1
- **Issue:** The plan suggested "import db.writeScan() / query-engine.js queryTransitive" but db.js uses top-level await and a module singleton — unsafe to use across multiple bats subprocesses without resetting state.
- **Fix:** Each Node.js `--eval` subprocess defines the full schema inline (mirrors migration 001) and creates an isolated in-memory Database instance. This is the same pattern used in `worker/db.test.js`.
- **Files modified:** tests/integration/impact-flow.bats (test isolation design)

## Self-Check: PASSED

- tests/integration/impact-flow.bats: FOUND
- Commit ed7f150: FOUND
- All 11 bats tests: PASS
