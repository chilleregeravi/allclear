---
phase: 08-config-layer
plan: 01
subsystem: config
tags: [bash, jq, config, environment-variables, bats]

# Dependency graph
requires: []
provides:
  - "lib/config.sh: sourceable bash library loading allclear.config.json into ALLCLEAR_CONFIG_SIBLINGS array"
  - "allclear.config.json.example: schema documentation for project-level config file"
  - "tests/config.bats: 15-test bats suite for CONF-01 through CONF-04"
  - "tests/fixtures/config/: mock hook scripts and fixture JSON for config tests"
affects:
  - lib/siblings.sh
  - scripts/lint.sh
  - scripts/format.sh
  - scripts/file-guard.sh

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Guard variable pattern: [[ -n \"${_ALLCLEAR_CONFIG_LOADED:-}\" ]] prevents double-sourcing"
    - "bash 3.2 compat: while IFS= read -r loop instead of mapfile for array population"
    - "Malformed JSON detection: jq '.' validation before .siblings[]? parsing"
    - "CONF-02 toggle: [[ -n \"${ALLCLEAR_DISABLE_X:-}\" ]] at top of each hook script"
    - "CONF-03 throttle: \"${ALLCLEAR_LINT_THROTTLE:-30}\" with ^[0-9]+$ regex fallback to 30"
    - "CONF-04 extra blocked: IFS=':' read -ra from ALLCLEAR_EXTRA_BLOCKED, basename glob match"

key-files:
  created:
    - lib/config.sh
    - allclear.config.json.example
    - tests/config.bats
    - tests/fixtures/config/allclear.config.json
    - tests/fixtures/config/mock-format.sh
    - tests/fixtures/config/mock-lint.sh
    - tests/fixtures/config/mock-guard.sh
  modified: []

key-decisions:
  - "Used while-read loop instead of mapfile for bash 3.2 compatibility on macOS system bash"
  - "lib/config.sh is a leaf node — sources nothing else; consumers source lib/config.sh"
  - "ALLCLEAR_CONFIG_SIBLINGS is NOT exported (bash cannot export arrays across subshells)"
  - "Malformed JSON emits warning to stderr and continues with empty defaults, never blocks"

patterns-established:
  - "Pattern: Source lib/config.sh at the top of any consumer script, before any cd calls"
  - "Pattern: ALLCLEAR_DISABLE_X env vars exit 0 immediately (allow, not block)"
  - "Pattern: Numeric env var with default — \"${VAR:-default}\" then ^[0-9]+$ regex validation"
  - "Pattern: Colon-delimited extra patterns in ALLCLEAR_EXTRA_BLOCKED, IFS=':' split"

requirements-completed: [CONF-01, CONF-02, CONF-03, CONF-04]

# Metrics
duration: 2min
completed: 2026-03-15
---

# Phase 8 Plan 1: Config Layer Summary

**Sourceable lib/config.sh loads allclear.config.json siblings via jq with bash 3.2-safe while-read loop, plus 15 bats tests validating all four CONF env-var patterns**

## Performance

- **Duration:** 2 min
- **Started:** 2026-03-15T10:08:02Z
- **Completed:** 2026-03-15T10:10:03Z
- **Tasks:** 2 (TDD: RED + GREEN phases)
- **Files modified:** 7 created

## Accomplishments

- `lib/config.sh` sourceable bash library: loads siblings from allclear.config.json using jq, handles absent config (empty array), warns on malformed JSON (stderr), respects ALLCLEAR_CONFIG_FILE override, guard variable prevents double-loading
- `allclear.config.json.example` documents the project-level config schema
- 15 bats tests covering CONF-01 (config loading), CONF-02 (disable toggles), CONF-03 (throttle override), CONF-04 (extra blocked patterns) — all passing
- Mock hook scripts in tests/fixtures/config/ demonstrating the exact env-var integration patterns that real hooks will use

## Task Commits

Each task was committed atomically:

1. **Task 1+2 RED: Failing tests for config layer** - `97d40bd` (test)
2. **Task 1+2 GREEN: lib/config.sh and allclear.config.json.example** - `92d62a2` (feat)

_Note: TDD tasks had RED (test) and GREEN (implementation) commits._

## Files Created/Modified

- `lib/config.sh` - Sourceable bash config library; loads ALLCLEAR_CONFIG_SIBLINGS from allclear.config.json
- `allclear.config.json.example` - Schema documentation showing siblings array
- `tests/config.bats` - 15 bats tests for CONF-01 through CONF-04
- `tests/fixtures/config/allclear.config.json` - Test fixture with 3 siblings (../api, ../ui, /opt/repos/sdk)
- `tests/fixtures/config/mock-format.sh` - Demonstrates ALLCLEAR_DISABLE_FORMAT pattern
- `tests/fixtures/config/mock-lint.sh` - Demonstrates ALLCLEAR_DISABLE_LINT + ALLCLEAR_LINT_THROTTLE patterns
- `tests/fixtures/config/mock-guard.sh` - Demonstrates ALLCLEAR_DISABLE_GUARD + ALLCLEAR_EXTRA_BLOCKED patterns

## Decisions Made

- Used `while IFS= read -r` loop instead of `mapfile -t` for bash 3.2 compatibility on macOS (which ships bash 3.2 by default)
- `lib/config.sh` is kept as a leaf node — it sources nothing else, preventing circular source risks
- `ALLCLEAR_CONFIG_SIBLINGS` is NOT exported via `export` — bash arrays cannot be exported across subshells; consumers must `source lib/config.sh` directly
- Malformed JSON warning goes to stderr and execution continues with empty defaults; AllClear never blocks Claude's flow for config parse errors

## Deviations from Plan

None - plan executed exactly as written.

Note: Plan success criteria listed "16 tests" but the task descriptions enumerate exactly 15 distinct test behaviors. All 15 specified behaviors are covered and passing. The count discrepancy was in the plan document itself.

## Issues Encountered

None.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

- `lib/config.sh` is ready to be sourced by `lib/siblings.sh` (Phase 9) for CONF-01 sibling path overrides
- Env var patterns (CONF-02/03/04) are documented via mock scripts for Phase 3 (format hook), Phase 4 (lint hook), Phase 5 (guard hook)
- All 15 tests pass with no external dependencies; bats-core already installed

---
*Phase: 08-config-layer*
*Completed: 2026-03-15*

## Self-Check: PASSED

- lib/config.sh: FOUND
- allclear.config.json.example: FOUND
- tests/config.bats: FOUND
- tests/fixtures/config/allclear.config.json: FOUND
- tests/fixtures/config/mock-format.sh: FOUND
- tests/fixtures/config/mock-lint.sh: FOUND
- tests/fixtures/config/mock-guard.sh: FOUND
- Commit 97d40bd (test): FOUND
- Commit 92d62a2 (feat): FOUND
- bats tests/config.bats: 15/15 PASSING
