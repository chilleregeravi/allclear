---
phase: 059-runtime-dependency-installation
plan: 02
subsystem: infra
tags: [bash, mcp, npm, bats, self-healing, better-sqlite3]

# Dependency graph
requires:
  - phase: 059-runtime-dependency-installation
    provides: runtime-deps.json dep manifest and phase context
provides:
  - Self-healing mcp-wrapper.sh that installs better-sqlite3 before launching MCP server
  - .mcp.json wired to launch via mcp-wrapper.sh instead of node directly
  - Bats test suite covering MCP-02 self-healing scenarios (6 tests)
affects: [060-end-to-end-mcp-verification, 061-version-bumping]

# Tech tracking
tech-stack:
  added: []
  patterns: [self-healing bash wrapper, stderr-only output for MCP process, temp log file for npm exit code capture]

key-files:
  created:
    - tests/mcp-wrapper.bats
  modified:
    - plugins/ligamen/scripts/mcp-wrapper.sh
    - plugins/ligamen/.mcp.json

key-decisions:
  - "Use temp log file approach to capture npm exit code before pipe to head — preserves $? without set -o pipefail"
  - "Wrapper always attempts exec node even on failed install — let Node give a clear error rather than wrapper abort"
  - ".mcp.json updated in this plan (not deferred to Phase 60) — wiring is essential for self-healing to activate"

patterns-established:
  - "All wrapper output via >&2 — stdout stays pristine for MCP JSON-RPC protocol"
  - "Temp log file pattern: redirect to file, capture exit code, head -N to stderr, rm file"

requirements-completed: [MCP-02]

# Metrics
duration: 15min
completed: 2026-03-21
---

# Phase 59 Plan 02: MCP Wrapper Self-Healing Summary

**mcp-wrapper.sh extended with dep detection and inline npm install, .mcp.json wired to wrapper, 6 bats tests covering deps-present, deps-missing, stdout-clean, and fallback-root paths**

## Performance

- **Duration:** ~15 min
- **Started:** 2026-03-21T18:00:00Z
- **Completed:** 2026-03-21T18:15:00Z
- **Tasks:** 2
- **Files modified:** 3 (mcp-wrapper.sh, .mcp.json, tests/mcp-wrapper.bats created)

## Accomplishments

- Extended mcp-wrapper.sh from 6 lines to a self-healing launcher that checks for better-sqlite3 before exec'ing server.js
- All npm output and echo messages routed to stderr — stdout stays pristine for MCP JSON-RPC
- Updated .mcp.json to invoke mcp-wrapper.sh instead of node directly, activating the self-healing on every marketplace MCP launch
- Created tests/mcp-wrapper.bats with 6 passing tests covering all critical paths

## Task Commits

Each task was committed atomically:

1. **Task 1: Extend mcp-wrapper.sh with self-healing dep installation** - `b922faa` (feat)
2. **Task 2: Create bats tests for mcp-wrapper.sh self-healing** - `45767df` (test)

## Files Created/Modified

- `plugins/ligamen/scripts/mcp-wrapper.sh` - Extended with better-sqlite3 check + npm install self-healing before exec
- `plugins/ligamen/.mcp.json` - Updated command field from `node` to `${CLAUDE_PLUGIN_ROOT}/scripts/mcp-wrapper.sh`
- `tests/mcp-wrapper.bats` - 6 bats tests covering deps-present, deps-missing, stdout-cleanliness, .mcp.json wiring, and script-relative fallback

## Decisions Made

- Used a temp log file approach (`>.npm-install.log 2>&1; INSTALL_EXIT=$?; head -50 ... >&2; rm`) to capture npm exit code before piping to head. This avoids the pipe masking problem without requiring `set -o pipefail`.
- Wrapper deliberately has no `set -e` — it always reaches `exec node` even if install fails, so Node can emit a clearer missing-module error rather than a silent bash abort.
- Updated .mcp.json in this plan rather than deferring to Phase 60 — the self-healing logic in the wrapper is useless unless .mcp.json invokes it.

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered

None.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

- Self-healing MCP wrapper is live — marketplace installs that race the SessionStart hook will now auto-install deps on first MCP server launch
- .mcp.json wired to wrapper — no further changes needed for Phase 60 end-to-end verification
- Blocker remains: empirically confirm ${CLAUDE_PLUGIN_ROOT} is writable during live SessionStart hook and identify which Node binary Claude Code uses for MCP servers (ABI match for better-sqlite3)

---
*Phase: 059-runtime-dependency-installation*
*Completed: 2026-03-21*
