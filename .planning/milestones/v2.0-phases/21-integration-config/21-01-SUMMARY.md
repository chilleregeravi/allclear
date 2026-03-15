---
phase: 21-integration-config
plan: 01
subsystem: hooks
tags: [session-start, worker, auto-start, bats, integration]

# Dependency graph
requires:
  - phase: 15-worker-lifecycle
    provides: worker-start.sh and lib/worker-client.sh worker lifecycle infrastructure
  - phase: 20-command-layer
    provides: /allclear:map command writes impact-map section to allclear.config.json
provides:
  - Conditional worker auto-start in session-start.sh gated on impact-map section presence
  - worker_start_background() and worker_status_line() functions in lib/worker-client.sh
  - INTG-01/INTG-02 test coverage for worker auto-start behavior
affects: [22-final-integration, session hooks, worker lifecycle]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "CLAUDE_PLUGIN_ROOT-relative lib sourcing pattern (consistent with detect.sh sourcing)"
    - "Non-blocking worker call: 2>/dev/null || true wrapper on all worker calls"
    - "Mock worker-client.sh with sentinel file pattern for bats integration tests"

key-files:
  created: []
  modified:
    - scripts/session-start.sh
    - lib/worker-client.sh
    - tests/session-start.bats

key-decisions:
  - "worker_start_background() and worker_status_line() added to lib/worker-client.sh — fills gap in Phase 15 implementation"
  - "Worker auto-start inserted after dedup block and before project detection — preserves existing hook flow order"
  - "WORKER_STATUS appended to CONTEXT string (not separate JSON field) — minimal output format change"

patterns-established:
  - "Pattern: Worker client sourcing mirrors detect.sh pattern — CLAUDE_PLUGIN_ROOT first, script-relative fallback"
  - "Pattern: All worker calls in session hook wrapped 2>/dev/null || true — never surface worker errors to hook stdout"

requirements-completed: [INTG-01, INTG-02]

# Metrics
duration: 2min
completed: 2026-03-15
---

# Phase 21 Plan 01: Integration Config Summary

**Session-start hook auto-starts AllClear worker via jq impact-map check and worker_start_background(), with INTG-01/02 bats coverage across 22 tests**

## Performance

- **Duration:** 2 min
- **Started:** 2026-03-15T19:31:51Z
- **Completed:** 2026-03-15T19:33:58Z
- **Tasks:** 2
- **Files modified:** 3

## Accomplishments
- Added `worker_start_background()` and `worker_status_line()` to `lib/worker-client.sh` to fill Phase 15 implementation gap
- Modified `session-start.sh` to conditionally source worker-client.sh and fire worker start when `impact-map` section present
- Added 5 new INTG-01/02 bats tests; all 22 tests pass with no regressions

## Task Commits

Each task was committed atomically:

1. **Task 1: Add impact-map auto-start to session-start.sh** - `f15b831` (feat)
2. **Task 2: Add INTG-01 and INTG-02 tests to session-start.bats** - `764a961` (test)

**Plan metadata:** _(to be added after final commit)_

## Files Created/Modified
- `scripts/session-start.sh` - Added worker-client sourcing block and conditional worker_start_background() call
- `lib/worker-client.sh` - Added worker_start_background() and worker_status_line() functions
- `tests/session-start.bats` - Added INTG-01a/b/c/d and INTG-02 tests (126 new lines)

## Decisions Made
- `worker_start_background()` and `worker_status_line()` were not present in Phase 15's `lib/worker-client.sh`; added them here as a Rule 3 auto-fix (blocking: plan references functions that didn't exist)
- Used same CLAUDE_PLUGIN_ROOT-relative sourcing pattern already established for detect.sh for consistency
- All worker calls wrapped `2>/dev/null || true` so worker failures never surface to hook stdout

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Added missing worker_start_background() and worker_status_line() to lib/worker-client.sh**
- **Found during:** Task 1 (Add impact-map auto-start to session-start.sh)
- **Issue:** Plan referenced worker_start_background() and worker_status_line() from lib/worker-client.sh, but Phase 15 only implemented worker_running(), worker_call(), and wait_for_worker(). The required functions were missing.
- **Fix:** Added worker_start_background() (fires worker-start.sh in background, returns immediately) and worker_status_line() (returns human-readable status when worker running) to lib/worker-client.sh
- **Files modified:** lib/worker-client.sh
- **Verification:** bash -n syntax check passes; functions used by session-start.sh and mocked in bats tests correctly
- **Committed in:** f15b831 (Task 1 commit)

---

**Total deviations:** 1 auto-fixed (1 blocking — missing functions)
**Impact on plan:** Essential for the implementation to compile. Functions are exactly what the plan specified; they simply weren't present in the Phase 15 artifact.

## Issues Encountered
None — plan executed cleanly after adding missing worker-client.sh functions.

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- Worker auto-start is live in session-start.sh; Phase 21 Plan 02+ can build on this
- lib/worker-client.sh is now complete with all referenced functions
- 22/22 session-start tests green, no regression risk

---
*Phase: 21-integration-config*
*Completed: 2026-03-15*
