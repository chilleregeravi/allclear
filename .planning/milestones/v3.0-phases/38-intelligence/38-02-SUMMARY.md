---
phase: 38-intelligence
plan: 02
subsystem: api
tags: [mcp, sqlite, query-engine, enrichment, actors]

# Dependency graph
requires:
  - phase: 35-actors
    provides: actor_connections table and actor scan detection
  - phase: 33-01
    provides: actors + actor_connections schema (migration 008)
provides:
  - enrichImpactResult() exported from query-engine.js — type-aware summary with boundary context
  - enrichSearchResult() exported from query-engine.js — actor relationship sentences per result row
  - impact_query MCP tool now returns {results, summary} with type-aware phrasing
  - impact_search MCP tool now returns results with actor_sentences array per row
affects: [mcp, intelligence, agents-consuming-impact-tools]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - Best-effort enrichment pattern: helpers catch all errors and return input unchanged on failure
    - Enrichment gated on qe._db non-null in MCP handlers — graceful degradation when no db

key-files:
  created:
    - worker/db/query-engine-enrich.test.js
  modified:
    - worker/db/query-engine.js
    - worker/mcp/server.js

key-decisions:
  - "enrichImpactResult and enrichSearchResult are standalone exports, not QueryEngine methods — simpler to import in server.js"
  - "Both enrichment helpers are best-effort: all errors caught internally, never throw to callers"
  - "MCP handler enrichment gated on qe._db non-null — raw result returned unchanged when no db available"

patterns-established:
  - "Enrichment helpers accept raw db + data, return augmented data — no side effects, pure transformation"
  - "Actor sentence format: 'service-name connects to external ActorName via PROTOCOL'"

requirements-completed: [INTEL-02, INTEL-03]

# Metrics
duration: 8min
completed: 2026-03-18
---

# Phase 38 Plan 02: MCP Tool Enrichment Summary

**type-aware impact_query summaries and actor_sentences in impact_search, wired via two best-effort enrichment helpers in query-engine.js**

## Performance

- **Duration:** ~8 min
- **Started:** 2026-03-18T20:59:00Z
- **Completed:** 2026-03-18T21:03:00Z
- **Tasks:** 2 (Task 1 TDD with 3 commits, Task 2 with 1 commit)
- **Files modified:** 3

## Accomplishments

- Added `enrichImpactResult(db, serviceName, results)` to query-engine.js — produces type-aware summary string (library/infra/service) with optional boundary label from allclear.config.json
- Added `enrichSearchResult(db, results)` to query-engine.js — appends `actor_sentences` array to each search result row using actor_connections JOIN actors JOIN services
- Wired both helpers into `impact_query` and `impact_search` MCP tool handlers in server.js
- 12 new passing tests covering all behavior paths including best-effort fallback

## Task Commits

Each task was committed atomically:

1. **TDD RED: add failing tests for enrichImpactResult and enrichSearchResult** - `9cd9b74` (test)
2. **Task 1: implement enrichImpactResult and enrichSearchResult** - `ca42d1a` (feat)
3. **Task 2: wire enrichment helpers into impact_query and impact_search handlers** - `518eac9` (feat)

## Files Created/Modified

- `worker/db/query-engine.js` — added `enrichImpactResult` and `enrichSearchResult` as named exports after QueryEngine class
- `worker/mcp/server.js` — imported helpers and updated impact_query + impact_search tool handlers
- `worker/db/query-engine-enrich.test.js` — 12 tests for both helpers (TDD RED first, then GREEN)

## Decisions Made

- Helpers are standalone exports rather than QueryEngine methods — avoids mutating the class interface and makes them directly importable in server.js without reaching through a QueryEngine instance
- Boundary lookup reads allclear.config.json at process.cwd() — consistent with how Phase 34 HTTP handler reads boundaries (avoids QueryEngine change)
- actor_sentences format "X connects to external Y via Z" matches the must_have truth assertions in the plan

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered

- `query-engine-upsert.test.js` was already failing before this plan (pre-existing ON CONFLICT test setup issue). Confirmed via `git stash` check. Out of scope per deviation boundary rule — logged here for awareness.

## Next Phase Readiness

- MCP tool consumers (Claude agents) will now receive enriched responses with human-readable summaries and actor relationship sentences
- Both enrichments gracefully degrade: empty actor table, missing config, or null DB all return clean results
- Ready for Phase 38 completion or further intelligence enhancements

---
*Phase: 38-intelligence*
*Completed: 2026-03-18*

## Self-Check: PASSED

- worker/db/query-engine-enrich.test.js — FOUND
- worker/db/query-engine.js — FOUND (enrichImpactResult + enrichSearchResult added)
- worker/mcp/server.js — FOUND (handlers updated)
- .planning/phases/38-intelligence/38-02-SUMMARY.md — FOUND
- Commits: 9cd9b74, ca42d1a, 518eac9 — all present in git log
