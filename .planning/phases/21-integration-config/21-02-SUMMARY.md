---
phase: 21-integration-config
plan: 02
subsystem: worker/chroma-sync, worker/query-engine, worker/db
tags: [chroma, search, fallback, fts5, sqlite, tdd]
dependency_graph:
  requires: []
  provides:
    - "worker/chroma-sync.js: ChromaDB async sync with health check and availability flag"
    - "worker/query-engine.js: standalone search() with 3-tier fallback chain"
    - "worker/db.js: writeScan() as the canonical persist gate with fire-and-forget ChromaDB sync"
  affects:
    - "Any future Phase 22+ code that persists confirmed findings via writeScan()"
    - "MCP server search tools that will call search() for semantic queries"
tech_stack:
  added:
    - "chromadb v3.3.3: ChromaClient, getOrCreateCollection, heartbeat, collection.upsert, collection.query"
  patterns:
    - "Fire-and-forget async: syncFindings().catch(logErr) — SQLite writes always complete before ChromaDB"
    - "Availability flag: isChromaAvailable() set once at startup via heartbeat(), not per-query"
    - "3-tier fallback: chromaSearch -> FTS5 -> SQL LIKE, each tier bypassed via skipChroma/skipFts5"
    - "Injected mock client: initChromaSync(settings, mockClient) for hermetic tests without ChromaDB"
    - "TDD: RED (failing test commit) -> GREEN (implementation commit) for both tasks"
key_files:
  created:
    - worker/chroma-sync.js
    - worker/chroma-sync.test.js
    - worker/query-engine-search.test.js
  modified:
    - worker/query-engine.js
    - worker/db.js
decisions:
  - "[21-02]: chromaSearch throws 'ChromaDB not available' when flag is false — caller (query-engine) catches and falls through to FTS5"
  - "[21-02]: initChromaSync accepts optional mockClient second arg — enables hermetic unit tests without running ChromaDB"
  - "[21-02]: _resetForTest() exported from chroma-sync.js for beforeEach test isolation — documented as not for production use"
  - "[21-02]: setSearchDb() exported from query-engine.js for test DB injection — mirrors Phase 14-02 decision to use new Database() directly in tests"
  - "[21-02]: writeScan() added to db.js as canonical persist gate — syncFindings fire-and-forget appended after synchronous SQLite writes complete"
  - "[21-02]: FTS5 tier uses services_fts only (not connections_fts/fields_fts) in standalone search() — simplifies result normalization to {id, name, type, score}"
metrics:
  duration: "261s (~4.5 min)"
  completed_date: "2026-03-15"
  tasks_completed: 2
  files_changed: 5
---

# Phase 21 Plan 02: ChromaDB Sync and 3-Tier Search Fallback Summary

**One-liner:** ChromaDB async sync module with fire-and-forget persist path and 3-tier search fallback (ChromaDB semantic -> FTS5 keyword -> SQL LIKE) testable at each tier independently.

## Tasks Completed

| Task | Name | Commit | Files |
|------|------|--------|-------|
| 1 | Create worker/chroma-sync.js (TDD) | `a3fa28d` | worker/chroma-sync.js (new), worker/chroma-sync.test.js (new) |
| 2 | Add search() 3-tier fallback (TDD) | `6269437` | worker/query-engine.js, worker/db.js, worker/query-engine-search.test.js (new) |

## What Was Built

### worker/chroma-sync.js (new)

Async ChromaDB sync module with 4 exports:
- `initChromaSync(settings, [mockClient])` — returns false immediately when ALLCLEAR_CHROMA_MODE is unset; calls heartbeat() and sets availability flag on success/failure
- `syncFindings(findings)` — upserts services and endpoints to 'allclear-impact' collection; never rejects; safe as fire-and-forget
- `chromaSearch(query, limit)` — throws `'ChromaDB not available'` when flag is false (caller triggers fallback); returns normalized `[{id, document, score, metadata}]`
- `isChromaAvailable()` — returns current flag; set once at startup

Key constraint: ChromaClient constructor never throws (chromadb v3) — errors surface only on heartbeat().

### worker/query-engine.js (modified)

Added 3 new exports alongside the existing QueryEngine class:
- `search(query, options)` — async 3-tier fallback
- `setSearchDb(db)` — inject db instance for test isolation
- Import: `import { chromaSearch, isChromaAvailable } from './chroma-sync.js'`

**Fallback chain:**
1. **Tier 1 (ChromaDB):** when `isChromaAvailable()=true` and `!skipChroma`; throws triggers automatic fallback
2. **Tier 2 (FTS5):** wraps query in double-quotes (handles hyphens per Phase 14-02 decision); empty results trigger SQL fallback
3. **Tier 3 (SQL LIKE):** always reachable; returns `score=0.5`

Each tier logs `[search] tier=... results=N` to stderr.

### worker/db.js (modified)

Added `writeScan(findings, queryEngine, repoId)` as the canonical SQLite persist gate. Pattern:
```js
// All SQLite writes are synchronous (better-sqlite3)
for (const svc of findings.services) { queryEngine.upsertService(...); }
for (const conn of findings.connections) { queryEngine.upsertConnection(...); }
// Fire-and-forget ChromaDB sync — NEVER await in persist path
syncFindings(findings).catch(err => process.stderr.write('[chroma] sync failed: ' + err.message + '\n'));
```

## Test Coverage

| File | Tests | Pass |
|------|-------|------|
| worker/chroma-sync.test.js | 13 | 13 |
| worker/query-engine-search.test.js | 9 | 9 |
| worker/scan-manager.test.js | 14 | 14 (regression check) |
| **Total** | **36** | **36** |

## Deviations from Plan

None — plan executed exactly as written.

## Self-Check: PASSED

| Check | Status |
|-------|--------|
| worker/chroma-sync.js exists | FOUND |
| worker/chroma-sync.test.js exists | FOUND |
| worker/query-engine-search.test.js exists | FOUND |
| Commit 95ec516 (RED: chroma-sync tests) | FOUND |
| Commit a3fa28d (GREEN: chroma-sync impl) | FOUND |
| Commit 8b2a793 (RED: search tests) | FOUND |
| Commit 6269437 (GREEN: search impl + writeScan) | FOUND |
