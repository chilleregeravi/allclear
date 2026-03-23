---
phase: 87-logger-adoption
plan: 01
subsystem: database
tags: [logger, sqlite, query-engine, optional-injection, better-sqlite3]

# Dependency graph
requires:
  - phase: 84-logger-infrastructure
    provides: createLogger factory and logger interface with .warn method
provides:
  - QueryEngine constructor with optional logger param stored as this._logger
  - Collision warning routing through injected logger.warn or console.warn fallback
  - pool.js explicit null second arg documenting injection intent
affects:
  - Any future phase wiring a logger instance into pool.js or QueryEngine

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Optional logger injection via constructor default param (logger = null)"
    - "Optional chaining fallback: (this._logger?.warn ?? console.warn)(msg)"

key-files:
  created:
    - plugins/ligamen/worker/db/query-engine-logger.test.js
  modified:
    - plugins/ligamen/worker/db/query-engine.js
    - plugins/ligamen/worker/db/pool.js

key-decisions:
  - "pool.js passes null explicitly (not a bare second-arg omission) to document that logger injection is deferred to a future phase when a pool-level logger is available"
  - "Optional chaining (this._logger?.warn ?? console.warn) guards against loggers missing the .warn method — zero-TypeError guarantee"

patterns-established:
  - "Logger injection via constructor: constructor(db, logger = null) + this._logger = logger"
  - "Fallback pattern: (this._logger?.warn ?? console.warn)(msg)"

requirements-completed: [ADOPT-01]

# Metrics
duration: 4min
completed: 2026-03-23
---

# Phase 87 Plan 01: Logger Adoption Summary

**QueryEngine collision warning routed through optional injected logger via (this._logger?.warn ?? console.warn) — backward-compatible with no-logger callers**

## Performance

- **Duration:** 4 min
- **Started:** 2026-03-23T10:53:56Z
- **Completed:** 2026-03-23T10:57:35Z
- **Tasks:** 2
- **Files modified:** 3

## Accomplishments
- QueryEngine constructor now accepts optional `logger` param (default null), stored as `this._logger`
- Collision warning in `_resolveServiceId()` uses `(this._logger?.warn ?? console.warn)` — routes to structured log when available, falls back to console when not
- No bare `console.warn()` calls remain in query-engine.js
- TDD tests cover both paths: injected-logger path and no-logger fallback path
- pool.js updated with explicit `null` second arg to document the injection intent

## Task Commits

Each task was committed atomically:

1. **Test: Add failing tests for QueryEngine logger injection** - `a4426ac` (test - RED phase)
2. **Task 1: Add logger param to QueryEngine, replace console.warn** - `8954aa1` (feat - GREEN phase)
3. **Task 2: Forward logger from pool.js to QueryEngine** - `1a49114` (feat)

## Files Created/Modified
- `plugins/ligamen/worker/db/query-engine-logger.test.js` - TDD tests for logger injection (Test A: injected logger, Test B: no-logger fallback)
- `plugins/ligamen/worker/db/query-engine.js` - Constructor updated with `logger = null` param, `this._logger` assignment, optional-chain collision warning, updated JSDoc
- `plugins/ligamen/worker/db/pool.js` - Both `new QueryEngine(db)` calls updated to `new QueryEngine(db, null)` with explanatory comment

## Decisions Made
- pool.js passes `null` explicitly rather than importing the worker logger, because `createLogger` requires runtime `dataDir`/`port` context unavailable at module evaluation time. Logger can be wired at a higher level in a future phase.
- Optional chaining `(this._logger?.warn ?? console.warn)` guards against loggers without `.warn` for extra robustness.

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered
- Simplified `buildDb()` in the test initially only created `repos` + `services` tables, causing QueryEngine constructor to fail on `connections` table. Fixed by using the full migration chain (001-009) matching `query-engine-upsert.test.js` pattern (Rule 3 auto-fix during TDD RED phase setup).

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- Logger injection foundation complete for QueryEngine
- pool.js wiring of a real logger instance deferred to future phase when pool-level logger context is available
- All existing query-engine tests continue to pass without modification

---
*Phase: 87-logger-adoption*
*Completed: 2026-03-23*

## Self-Check: PASSED
- SUMMARY.md: found
- query-engine-logger.test.js: found
- a4426ac (test commit): found
- 8954aa1 (feat commit): found
- 1a49114 (feat commit): found
