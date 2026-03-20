---
phase: 48-mcp-drift-tools
plan: 02
subsystem: api
tags: [mcp, drift, typescript, go, python, rust, type-detection, filesystem-scan]

# Dependency graph
requires:
  - phase: 48-mcp-drift-tools
    plan: 01
    provides: "getDriftRepos helper, queryDriftVersions export, server-drift.test.js scaffold with createTempRepo and createDriftTestDb"

provides:
  - "queryDriftTypes export in worker/mcp/server.js — detects shared type/interface/struct name conflicts across repos of the same language"
  - "detectRepoLanguage() helper — ts/go/py/rs detection via manifest file presence"
  - "collectFiles() helper — recursive file scanning with node_modules exclusion"
  - "extractTypeNames() helper — per-language regex extraction, capped at 50 per repo"
  - "extractTypeBody() helper — extracts sorted field lines for comparison, handles single-line declarations"
  - "server.tool('drift_types') MCP registration"
  - "Updated createTempRepo to support nested paths (e.g. src/types.ts)"

affects:
  - 48-mcp-drift-tools plan 03

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Language-grouped comparison: only compare repos with same language tag (ts vs ts, go vs go)"
    - "50-type cap per repo to prevent slowness on large codebases"
    - "Single-line interface body extraction: inline parse for declarations like export interface Foo { a: string; }"
    - "Sorted body string comparison: fields sorted then joined for order-independent equality"
    - "TDD with node:test — RED commit first, GREEN commit second"

key-files:
  created: []
  modified:
    - worker/mcp/server.js
    - worker/mcp/server-drift.test.js

key-decisions:
  - "Port detect_repo_language from drift-types.sh exactly — manifest file existence check order: package.json > go.mod > pyproject.toml/setup.py > Cargo.toml"
  - "Extract type body as sorted lines (not diff) to enable order-independent field comparison"
  - "Single-line interface declarations require inline body extraction — the declaration line itself contains opening and closing braces"
  - "severity=WARN default matches drift_versions behavior — INFO findings suppressed by default"

patterns-established:
  - "Body extraction: split single-line declarations at '{' and '}', split on ';'/',' for individual fields"
  - "collectFiles: skip hidden directories and node_modules for performance"

requirements-completed:
  - MCP-02

# Metrics
duration: 21min
completed: 2026-03-20
---

# Phase 48 Plan 02: drift_types MCP Tool Summary

**Language-grouped type/interface/struct drift detection using filesystem regex scan and sorted-body comparison, ported from drift-types.sh to queryDriftTypes export with MCP server.tool registration**

## Performance

- **Duration:** 21 min
- **Started:** 2026-03-20T19:26:37Z
- **Completed:** 2026-03-20T19:47:25Z
- **Tasks:** 2
- **Files modified:** 2

## Accomplishments

- Implemented `queryDriftTypes` with language-grouped comparison (ts/go/py/rs) preventing cross-language false positives
- Added 4 helper functions: `detectRepoLanguage`, `collectFiles`, `extractTypeNames`, `extractTypeBody`
- Registered `server.tool("drift_types")` with severity filter and project parameter
- Appended 6 TDD tests to server-drift.test.js covering: null-db guard, CRITICAL diff detection, INFO match detection, cross-language suppression, repos_scanned count, severity filter
- Updated `createTempRepo` helper to support nested file paths like `src/types.ts`

## Task Commits

Each task was committed atomically:

1. **Task 1: Add failing drift_types tests (TDD RED)** - `16a58c2` (test)
2. **Task 2: Implement queryDriftTypes and register drift_types tool (TDD GREEN)** - `fe43ccc` (feat — included in Plan 03 commit due to linter auto-advance)

## Files Created/Modified

- `worker/mcp/server.js` - Added detectRepoLanguage, collectFiles, extractTypeNames, extractTypeBody helpers and queryDriftTypes export + drift_types server.tool registration
- `worker/mcp/server-drift.test.js` - Updated import to include queryDriftTypes, updated createTempRepo for nested paths, appended 6 queryDriftTypes tests

## Decisions Made

- Ported `detect_repo_language` exactly from drift-types.sh: package.json detection = ts, go.mod = go, pyproject.toml/setup.py = py, Cargo.toml = rs
- Type body extraction uses sorted field lines (not diff output) for order-independent comparison
- Default severity=WARN matches drift_versions convention (suppresses INFO by default)
- Single-line TypeScript interface declarations (e.g. `export interface Foo { a: string; }`) require special inline handling — the entire body is on the declaration line

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Fixed extractTypeBody for single-line interface declarations**
- **Found during:** Task 2 (implementation — GREEN phase)
- **Issue:** TypeScript interfaces like `export interface UserProfile { id: string; name: string; }` are single-line. The original logic skipped the declaration line entirely (`continue`), then found no subsequent body lines, returning empty string. Both repos got empty bodies, so no diff was detected — CRITICAL test failed.
- **Fix:** Added inline body detection on the declaration line itself: if `{` is found on the same line and depth reaches ≤0, extract content between first `{` and last `}`, split on `;`/`,` to get individual fields.
- **Files modified:** `worker/mcp/server.js` — `extractTypeBody` function
- **Verification:** CRITICAL test and severity-filter test both pass after fix
- **Committed in:** `fe43ccc`

---

**Total deviations:** 1 auto-fixed (1 bug)
**Impact on plan:** Bug fix was essential for correctness — single-line type declarations are the common case in TypeScript test fixtures. No scope creep.

## Issues Encountered

- The project's linter/formatter auto-advanced the test file import to include `queryDriftOpenapi` (for Plan 03) before Plan 02 was complete. This caused test failures until a stub export was present. The Plan 03 agent had already committed both plans' implementations, so Task 2 changes were incorporated into `fe43ccc`.

## Next Phase Readiness

- Plan 03 (drift_openapi) already implemented and committed by the time Plan 02 completed
- All 19 tests across queryDriftVersions, queryDriftTypes, queryDriftOpenapi pass
- Phase 48 complete after Plan 03 SUMMARY creation

## Self-Check: PASSED

- 48-02-SUMMARY.md: FOUND
- Commit 16a58c2 (Task 1 TDD RED): FOUND
- Commit fe43ccc (Task 2 TDD GREEN): FOUND

---
*Phase: 48-mcp-drift-tools*
*Completed: 2026-03-20*
