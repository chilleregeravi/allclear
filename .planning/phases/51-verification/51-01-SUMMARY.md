---
phase: 51-verification
plan: 01
subsystem: testing
tags: [bats, shellcheck, makefile, path-update, plugins]

# Dependency graph
requires:
  - phase: 49-directory-restructure
    provides: "plugin source moved to plugins/ligamen/ directory layout"
  - phase: 50-path-install-updates
    provides: "bats test files and Makefile already updated with plugins/ligamen/ paths"
provides:
  - "Verified: all 12 bats test files have PLUGIN_ROOT/CLAUDE_PLUGIN_ROOT pointing to plugins/ligamen/"
  - "Verified: Makefile lint/check targets reference plugins/ligamen/ paths"
  - "Test suite is runnable against the new directory layout"
affects: []

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Bats test PLUGIN_ROOT computed as BATS_TEST_DIRNAME/../plugins/ligamen (not BATS_TEST_DIRNAME/..)"
    - "worker-lifecycle.bats uses absolute $PLUGIN_ROOT/ prefix for all script/source calls (no bare relative refs)"
    - "Makefile uses plugins/$(PLUGIN_NAME) variable for all plugin source paths"

key-files:
  created: []
  modified:
    - tests/structure.bats
    - tests/config.bats
    - tests/detect.bats
    - tests/drift-versions.bats
    - tests/file-guard.bats
    - tests/format.bats
    - tests/lint.bats
    - tests/mcp-server.bats
    - tests/session-start.bats
    - tests/siblings.bats
    - tests/worker-index.bats
    - tests/worker-lifecycle.bats
    - Makefile

key-decisions:
  - "Test path updates were already completed in Phase 50-01 (a5e892a); no net-new changes required in Phase 51"
  - "worker-lifecycle.bats uses $PLUGIN_ROOT/ absolute prefix for script calls rather than adding cd to setup()"

patterns-established:
  - "All bats test files: PLUGIN_ROOT/CLAUDE_PLUGIN_ROOT must point to plugins/ligamen/, never the repo root"
  - "Worker lifecycle test scripts must use absolute $PLUGIN_ROOT paths since setup() does not cd"

requirements-completed:
  - VER-01

# Metrics
duration: 3min
completed: 2026-03-21
---

# Phase 51 Plan 01: Test Path Variables Verification Summary

**All 12 bats test files verified with plugins/ligamen/ path variables and Makefile lint/check targets confirmed correct — test suite is ready to run against restructured layout**

## Performance

- **Duration:** 3 min
- **Started:** 2026-03-21T09:30:58Z
- **Completed:** 2026-03-21T09:34:05Z
- **Tasks:** 2
- **Files modified:** 13 (all already committed in Phase 50)

## Accomplishments

- Verified all 12 bats test files have `plugins/ligamen` path references (32 total lines)
- Verified Makefile `lint` target uses `plugins/$(PLUGIN_NAME)/scripts/*.sh plugins/$(PLUGIN_NAME)/lib/*.sh`
- Verified Makefile `check` target validates `plugins/$(PLUGIN_NAME)/.claude-plugin/plugin.json`
- Confirmed no bare `BATS_TEST_DIRNAME/..` repo-root refs remain in test files

## Task Commits

Both tasks were already completed and committed during Phase 50 execution:

1. **Task 1: Update path variables in all bats test files** - `a5e892a` (docs: 50-01 complete path-install-updates plan)
   - All 12 test files updated in this commit along with the 50-01 SUMMARY
2. **Task 2: Update Makefile lint and check targets** - `9c9b299` (feat: 50-02 update Makefile for plugins/ligamen/ layout)

**Plan metadata:** (this commit — docs 51-01 complete)

## Files Created/Modified

- `tests/structure.bats` - PLUGIN_ROOT now points to `$TEST_DIR/../plugins/ligamen`
- `tests/config.bats` - LIB_CONFIG now points to `$REPO_ROOT/plugins/ligamen/lib/config.sh`
- `tests/detect.bats` - CLAUDE_PLUGIN_ROOT and all `source` paths updated (11 occurrences)
- `tests/drift-versions.bats` - PLUGIN_ROOT updated to `$TEST_DIR/../plugins/ligamen`
- `tests/file-guard.bats` - SCRIPT and CLAUDE_PLUGIN_ROOT updated
- `tests/format.bats` - SCRIPT and CLAUDE_PLUGIN_ROOT updated
- `tests/lint.bats` - SCRIPT and CLAUDE_PLUGIN_ROOT updated
- `tests/mcp-server.bats` - setup() cd target updated to `plugins/ligamen`
- `tests/session-start.bats` - cp source path updated to `plugins/ligamen/scripts/`
- `tests/siblings.bats` - CLAUDE_PLUGIN_ROOT and all source paths updated (8 occurrences)
- `tests/worker-index.bats` - PLUGIN_ROOT updated (uses `dirname "$BATS_TEST_FILENAME"`)
- `tests/worker-lifecycle.bats` - PLUGIN_ROOT updated + all bare `bash scripts/` and `source lib/` calls prefixed with `$PLUGIN_ROOT/`
- `Makefile` - lint/check targets use `plugins/$(PLUGIN_NAME)` variable

## Decisions Made

- Phase 50-01 already completed both tasks during path-install-updates execution. Phase 51-01 serves as the verification checkpoint confirming the work is correct and complete.
- `worker-lifecycle.bats` chose the absolute `$PLUGIN_ROOT/` prefix approach (rather than adding `cd "$PLUGIN_ROOT"` to `setup()`) to avoid side effects from changing CWD for tests that don't need it.

## Deviations from Plan

None - all work was pre-completed by Phase 50. Phase 51-01 verified the state matches the plan's acceptance criteria exactly.

## Issues Encountered

None - both tasks were already complete. Verification confirmed 32 `plugins/ligamen` references across 12 test files, all acceptance criteria met.

## Next Phase Readiness

- Test suite path variables are correct for the `plugins/ligamen/` layout
- `make test` should now be runnable against the restructured plugin directory
- `make lint` and `make check` targets point to the correct paths

---
*Phase: 51-verification*
*Completed: 2026-03-21*
