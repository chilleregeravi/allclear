---
phase: 64-undefined-value-crash-chain
plan: "02"
subsystem: database
tags: [sqlite, openDb, project-root, hash, cli-fallback]

# Dependency graph
requires:
  - phase: 64-01
    provides: undefined-to-null crash fix that triggers CLI fallback
provides:
  - Corrected map.md Step 4 node -e snippet passing explicit PROJECT_ROOT to openDb()
  - PROJECT_ROOT capture in Step 1 before any scanning begins
affects: [cli-fallback, graph-query, /graph endpoint, scan data integrity]

# Tech tracking
tech-stack:
  added: []
  patterns: [Capture process.cwd() at scan-start and thread it explicitly into openDb() to guarantee correct DB hash]

key-files:
  created: []
  modified:
    - plugins/ligamen/commands/map.md

key-decisions:
  - "Use shell variable PROJECT_ROOT captured at Step 1 to override openDb() default of process.cwd(), preventing phantom DB when cwd drifts during scan"

patterns-established:
  - "Shell variables captured early in a multi-step command sequence must be explicitly threaded into node -e snippets rather than relying on process.cwd()"

requirements-completed: [SREL-03]

# Metrics
duration: 5min
completed: 2026-03-21
---

# Phase 64 Plan 02: CLI Fallback openDb() Project Root Fix Summary

**map.md Step 4 node -e snippet updated to pass `openDb('${PROJECT_ROOT}')` instead of bare `openDb()`, eliminating phantom DB hash when CLI fallback runs from a different cwd**

## Performance

- **Duration:** 5 min
- **Started:** 2026-03-21T19:45:00Z
- **Completed:** 2026-03-21T19:50:00Z
- **Tasks:** 1
- **Files modified:** 1

## Accomplishments

- Added `PROJECT_ROOT="$(pwd)"` capture in Step 1 of map.md immediately after the user confirms repos
- Updated Step 4 node -e snippet to call `openDb('${PROJECT_ROOT}')` using the shell-expanded variable
- Removed the bare `openDb()` zero-argument call that caused sha256 hash mismatch when process.cwd() differed from the scanned project directory
- Result: CLI fallback scan now writes to the same SQLite database file the HTTP server reads for /graph queries

## Task Commits

Each task was committed atomically:

1. **Task 1: Pass explicit PROJECT_ROOT to openDb() in map.md Step 4** - `c5ccf2a` (fix)

**Plan metadata:** (docs commit follows)

## Files Created/Modified

- `plugins/ligamen/commands/map.md` - Added PROJECT_ROOT capture in Step 1; updated Step 4 openDb() call to pass explicit project root

## Decisions Made

- Used shell variable `${PROJECT_ROOT}` substituted at node -e invocation time — same mechanism already in use for `${CLAUDE_PLUGIN_ROOT}` in the same snippet, so no new pattern is introduced

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered

None.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

- Phase 64 complete: both the undefined-to-null crash (64-01) and the resulting phantom DB write (64-02) are fixed
- Phase 65 (service ID collision fix) can proceed independently

---
*Phase: 64-undefined-value-crash-chain*
*Completed: 2026-03-21*
