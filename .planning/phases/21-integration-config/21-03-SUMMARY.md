---
phase: 21-integration-config
plan: "03"
subsystem: database
tags: [sqlite, vacuum-into, snapshots, map-versions, chroma, mcp, retention]

# Dependency graph
requires:
  - phase: 14-storage-foundation
    provides: worker/db.js singleton, map_versions table schema, openDb/getDb exports
  - phase: 20-command-layer
    provides: /allclear:map command orchestration, first-build detection pattern
provides:
  - createSnapshot(label) — atomic SQLite snapshot via VACUUM INTO in snapshots/ subdir
  - isFirstScan() — returns true before any map_versions rows exist
  - Retention cleanup capped at configurable limit (default 10, reads allclear.config.json)
  - skills/impact/SKILL.md with first-run ChromaDB + MCP server recommendation block
affects: [20-command-layer, 22-future-query-features]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - VACUUM INTO for atomic SQLite snapshot (not cp — avoids WAL/SHM inconsistency)
    - Relative snapshot paths in map_versions (resolved at read time via path.dirname(dbPath))
    - Retention cleanup via ORDER BY created_at DESC LIMIT -1 OFFSET N pattern

key-files:
  created:
    - worker/db-snapshot.test.js
    - skills/impact/SKILL.md
  modified:
    - worker/db.js

key-decisions:
  - "VACUUM INTO used for snapshot atomicity — safer than cp because it excludes WAL/SHM sidecars"
  - "Snapshot paths stored relative (snapshots/timestamp.db) not absolute — portable across machine/user changes"
  - "isFirstScan() delegates to getDb() — caller must have called openDb() first"
  - "getHistoryLimit() reads allclear.config.json from process.cwd() — plan-specified config path"

patterns-established:
  - "Snapshot pattern: VACUUM INTO + INSERT map_versions + retention cleanup in single createSnapshot() call"
  - "First-run detection: isFirstScan() checked before writeScan() in command layer"

requirements-completed: [INTG-05, INTG-06]

# Metrics
duration: 2min
completed: 2026-03-15
---

# Phase 21 Plan 03: Integration Config — Snapshot and First-Run Recommendations Summary

**SQLite snapshot-on-rescan via VACUUM INTO with 10-snapshot retention cap, plus first-run ChromaDB/MCP recommendations surfaced through skills/impact/SKILL.md**

## Performance

- **Duration:** 2 min
- **Started:** 2026-03-15T19:32:01Z
- **Completed:** 2026-03-15T19:34:10Z
- **Tasks:** 2 (plus TDD test commit)
- **Files modified:** 3

## Accomplishments
- `createSnapshot(label)` added to `worker/db.js` using VACUUM INTO for atomic, WAL-safe copies stored in `snapshots/` subdir with relative paths recorded in `map_versions`
- `isFirstScan()` added — returns true when `map_versions` is empty, enabling the command layer to detect the first successful map build
- Retention cleanup auto-trims oldest snapshots beyond the configured limit (default 10) after every snapshot creation
- `skills/impact/SKILL.md` created with full first-run recommendation block including ChromaDB setup (`ALLCLEAR_CHROMA_MODE`) and verbatim `.mcp.json` registration block for `allclear-impact` MCP server

## Task Commits

Each task was committed atomically:

1. **TDD RED: db-snapshot.test.js (failing tests)** - `ad4d18e` (test)
2. **Task 1: createSnapshot and isFirstScan in worker/db.js** - `debbdfc` (feat)
3. **Task 2: skills/impact/SKILL.md with first-run recommendations** - `346f3d6` (feat)

**Plan metadata:** (docs commit — see below)

_Note: Task 1 followed TDD — RED commit first (ad4d18e), then GREEN implementation (debbdfc)._

## Files Created/Modified
- `worker/db.js` - Added `createSnapshot()`, `isFirstScan()`, `getHistoryLimit()` functions
- `worker/db-snapshot.test.js` - TDD test suite for snapshot behavior (8 tests, all passing)
- `skills/impact/SKILL.md` - New impact skill definition with first-run ChromaDB + MCP recommendations

## Decisions Made
- VACUUM INTO used (not `cp`) — creates an atomic consistent copy without WAL/SHM sidecars
- Snapshot paths stored relative (`snapshots/timestamp.db`) not absolute — portable across environments
- `getHistoryLimit()` reads from `allclear.config.json` at `process.cwd()` with fallback to 10
- `isFirstScan()` requires `openDb()` to have been called first — plan's inline verify script omitted this (auto-fixed by adding `openDb()` to the verification)

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Plan inline verification script missing openDb() call**
- **Found during:** Task 1 verification
- **Issue:** The plan's `<verify>` block called `isFirstScan()` without first calling `openDb()`, causing "Database not initialized" error
- **Fix:** Added `openDb(testRoot)` call before `isFirstScan()` in the verification invocation; implementation is correct
- **Files modified:** None (verification script only, not committed)
- **Verification:** Corrected verification script passed; all 8 unit tests pass independently
- **Committed in:** debbdfc (part of Task 1 commit — implementation unchanged)

---

**Total deviations:** 1 auto-fixed (Rule 1 - Bug in plan verification script)
**Impact on plan:** Trivial — plan's inline verification was missing `openDb()` setup. Implementation correct, all tests pass.

## Issues Encountered
None beyond the verification script gap documented above.

## User Setup Required
None - no external service configuration required for this plan. ChromaDB setup is documented as an optional post-map recommendation.

## Next Phase Readiness
- `createSnapshot()` and `isFirstScan()` are ready for Phase 20 command layer to wire into the `/allclear:map` scan flow
- `skills/impact/SKILL.md` is ready for Claude Code to surface first-run recommendations after map build
- No blockers — Phase 21 integration config requirements INTG-05 and INTG-06 complete

---
*Phase: 21-integration-config*
*Completed: 2026-03-15*
