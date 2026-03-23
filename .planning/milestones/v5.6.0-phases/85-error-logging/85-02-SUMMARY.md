---
phase: 85-error-logging
plan: 02
subsystem: logging
tags: [error-logging, stack-traces, mcp, chroma]

requires:
  - phase: 84-logger-infrastructure
    provides: createLogger utility used by mcp/server.js module-level logger
  - phase: 85-error-logging
    plan: 01
    provides: HTTP route error logging pattern (stack: err.stack)

provides:
  - MCP tool handler error logging with full stack traces (ERR-02)
  - All 7 MCP tool handlers wrapped in try/catch calling logger.error with stack
  - openDb(), querySearch FTS5, and queryScan error paths include stack: err.stack
  - chroma.js both logger.error calls include stack: err.stack (LOG-03)

affects: [phase-86-scan-logging, phase-87-query-engine-logger]

tech-stack:
  added: []
  patterns:
    - "try/catch around full MCP tool handler body with logger.error and graceful error content return"
    - "logger.error(msg, { error: err.message, stack: err.stack }) pattern across all worker logger.error calls"

key-files:
  created: []
  modified:
    - plugins/ligamen/worker/mcp/server.js
    - plugins/ligamen/worker/server/chroma.js
    - plugins/ligamen/worker/mcp/server.test.js

key-decisions:
  - "7 MCP tool handlers wrapped in try/catch returning { error: err.message } content block on failure"
  - "queryScan 3 inner catch blocks now call logger.error before returning error status"
  - "All logger.error calls in the worker now include stack: err.stack — zero ungarded calls remain"

patterns-established:
  - "MCP tool handler pattern: try { ... } catch (err) { logger.error('{tool} failed', { error: err.message, stack: err.stack }); return { content: [{ type: 'text', text: JSON.stringify({ error: err.message }) }] }; }"

requirements-completed: [ERR-02, LOG-03]

duration: 12min
completed: 2026-03-23
---

# Phase 85 Plan 02: MCP Tool Handler Error Logging Summary

**All 7 MCP tool handlers wrapped in try/catch with logger.error + stack, chroma.js and server.js error paths updated — zero unguarded logger.error calls remain in the worker**

## Performance

- **Duration:** 12 min
- **Started:** 2026-03-23T00:08:00Z
- **Completed:** 2026-03-23T00:20:00Z
- **Tasks:** 2
- **Files modified:** 3

## Accomplishments
- All 7 MCP tool handlers (impact_query, impact_changed, impact_graph, impact_search, impact_scan, drift_versions, drift_types, drift_openapi) now have try/catch wrapping with `logger.error('{tool} failed', { error: err.message, stack: err.stack })`
- `openDb()` logger.error call updated to include `stack: err.stack`
- `querySearch` FTS5 error logger.error updated to include `stack: err.stack`
- 3 `queryScan` inner catch blocks now call `logger.error` with `stack: err.stack`
- `chroma.js` both `_logger.error` calls updated to include `stack: err.stack`
- `grep -rn "logger.error|_logger.error" ... | grep -v test | grep -v stack` returns 0 lines
- `grep -c "stack: err.stack" mcp/server.js` = 13, `chroma.js` = 2
- All existing tests pass (31 mcp/server.test.js, 17 chroma.test.js)

## Task Commits

Each task was committed atomically:

1. **Task 1: Wrap MCP tool handlers in try/catch with logger.error + stack** - `104ff13` (feat)
2. **Task 2: Add err.stack to chroma.js logger.error calls** - `f97bbbb` (feat)

**Plan metadata:** (docs commit follows)

## Files Created/Modified
- `plugins/ligamen/worker/mcp/server.js` - 7 tool handlers wrapped in try/catch; openDb, querySearch FTS5, queryScan error paths updated with stack: err.stack
- `plugins/ligamen/worker/server/chroma.js` - initChroma and syncFindings logger.error calls updated with stack: err.stack
- `plugins/ligamen/worker/mcp/server.test.js` - 2 new tests for openDb error path and querySearch FTS5 fallback

## Decisions Made
- queryScan has 3 inner catch blocks (readiness fetch, scan fetch, outer catch) — all 3 got logger.error with stack since they all have access to an err object
- Tool handler try/catch returns graceful `{ error: err.message }` JSON content instead of throwing, matching MCP tool contract

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered
None.

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- ERR-01 and ERR-02 both complete: all HTTP route and MCP tool errors surface in structured logger with full stack traces
- LOG-03 complete: all logger.error calls across the worker include stack: err.stack
- Ready for Phase 86: scan lifecycle logging (SCAN-01, SCAN-02, SCAN-03)

---
*Phase: 85-error-logging*
*Completed: 2026-03-23*
