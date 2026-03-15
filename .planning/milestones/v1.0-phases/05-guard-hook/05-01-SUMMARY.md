---
phase: 05-guard-hook
plan: 01
subsystem: hooks
tags: [bash, bats, hooks, security, file-guard, pre-tool-use, exit2, hookSpecificOutput]

# Dependency graph
requires: []
provides:
  - "scripts/file-guard.sh: PreToolUse blocking hook with exit 2 hard-blocks and exit 0 soft-warns"
  - "hooks/hooks.json: PreToolUse registration for Edit|Write|MultiEdit"
  - "tests/file-guard.bats: 36-test bats suite covering all GRDH requirements"
affects:
  - "08-config-layer (ALLCLEAR_EXTRA_BLOCKED wired as env var; Phase 8 adds config.json parsing)"
  - "all phases that write files (hook fires on every Edit/Write/MultiEdit)"

# Tech tracking
tech-stack:
  added: [bats-core 1.13.0, bats-support, bats-assert]
  patterns:
    - "exit 2 + hookSpecificOutput JSON on stdout for PreToolUse hard blocks (TEST-08 contract)"
    - "systemMessage JSON on stdout + exit 0 for soft warns (GRDH-05/06/07)"
    - "realpath -m with macOS cd+pwd fallback for new-file path normalization"
    - "ALLCLEAR_DISABLE_GUARD=1 env var bypass checked first before any stdin read"
    - "IFS=: colon-split for ALLCLEAR_EXTRA_BLOCKED pattern iteration"

key-files:
  created:
    - scripts/file-guard.sh
    - tests/file-guard.bats
  modified:
    - hooks/hooks.json (PreToolUse registration was already present; verified intact)

key-decisions:
  - "Hard blocks output hookSpecificOutput.permissionDecision deny JSON on stdout AND human-readable message on stderr (both channels required per TEST-08 and project bats test style)"
  - "ALLCLEAR_EXTRA_BLOCKED checked before built-in patterns so user overrides can pre-empt soft-warn paths"
  - "No set -e in script -- realpath can fail on new files; all exits explicit"
  - "bats-assert/bats-support helpers used for consistency with existing tests/format.bats and tests/lint.bats"

patterns-established:
  - "Guard hook dual-channel output: stderr message + stdout hookSpecificOutput JSON for hard blocks"
  - "Path normalization before any pattern match: realpath -m or macOS cd/pwd fallback"
  - "PreToolUse deny uses exit 2 (not exit 1 which is hook error)"

requirements-completed: [GRDH-01, GRDH-02, GRDH-03, GRDH-04, GRDH-05, GRDH-06, GRDH-07, GRDH-08]

# Metrics
duration: 3min
completed: 2026-03-15
---

# Phase 5 Plan 01: Guard Hook Summary

**PreToolUse file-guard hook that hard-blocks .env/lock/vendor-dir writes with exit 2 + hookSpecificOutput JSON and soft-warns migrations/generated/CHANGELOG with systemMessage JSON, verified by 36-test bats suite**

## Performance

- **Duration:** 3 min
- **Started:** 2026-03-15T10:07:41Z
- **Completed:** 2026-03-15T10:10:41Z
- **Tasks:** 2 (Task 1: TDD RED + GREEN; Task 2: bats tests integrated)
- **Files modified:** 2 created, 1 verified

## Accomplishments

- `scripts/file-guard.sh` (168 lines): full PreToolUse guard with hard-blocks, soft-warns, ALLCLEAR_DISABLE_GUARD, ALLCLEAR_EXTRA_BLOCKED, and macOS-compatible path normalization
- `tests/file-guard.bats` (297 lines): 36 tests covering every GRDH-01 through GRDH-08 requirement plus TEST-08 hookSpecificOutput JSON schema, all passing
- `hooks/hooks.json`: PreToolUse registration for Edit|Write|MultiEdit was already in the file; verified intact with correct CLAUDE_PLUGIN_ROOT command path

## Task Commits

Each task was committed atomically:

1. **TDD RED — failing bats test suite** - `e3727b8` (test)
2. **TDD GREEN — file-guard.sh implementation + updated tests** - `38208aa` (feat)

_Note: TDD task produced two commits (test RED then feat GREEN) as required by TDD execution flow._

## Files Created/Modified

- `scripts/file-guard.sh` — PreToolUse guard: hard-blocks credentials/lock/vendor dirs, soft-warns migrations/generated/CHANGELOG, ALLCLEAR_DISABLE_GUARD bypass, ALLCLEAR_EXTRA_BLOCKED custom patterns
- `tests/file-guard.bats` — 36 bats tests using bats-assert/bats-support; covers all GRDH requirements + TEST-08 hookSpecificOutput JSON schema verification

## Decisions Made

- **Dual-channel hard-block output:** Project's existing bats tests (`file-guard.bats` was already present as a placeholder) expected `hookSpecificOutput.permissionDecision: "deny"` JSON on stdout in addition to the stderr message. Script outputs both channels: `printf 'AllClear: ...' >&2` plus `printf '{"hookSpecificOutput":...}' to stdout`.
- **ALLCLEAR_EXTRA_BLOCKED checked first:** User-defined patterns run before built-in soft-warn patterns, allowing users to upgrade a normally soft-warned file type to a hard block.
- **No set -e:** Explicitly avoided per RESEARCH.md Pitfall 2 — realpath fails on new files; every exit path is explicit.
- **bats-assert/bats-support helpers:** Adopted project's existing test style (same as tests/format.bats and tests/lint.bats) rather than plain `[ "$status" -eq N ]` assertions.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Updated block_file to output hookSpecificOutput JSON on stdout**
- **Found during:** Task 2 (bats test execution)
- **Issue:** Project's bats test file (replaced by linter during RED phase) expected `hookSpecificOutput.permissionDecision: "deny"` JSON on stdout for hard blocks. Plan's action section described stderr-only approach; the actual test contract requires both channels.
- **Fix:** Added `printf '{"hookSpecificOutput":{"hookEventName":"PreToolUse","permissionDecision":"deny","permissionDecisionReason":"..."}}' to stdout before exit 2 in block_file function.
- **Files modified:** scripts/file-guard.sh
- **Verification:** `bats tests/file-guard.bats` — 36/36 pass including "stdout contains valid hookSpecificOutput JSON" test at line 145-150.
- **Committed in:** 38208aa (Task 1 GREEN commit)

---

**Total deviations:** 1 auto-fixed (Rule 1 - bug/contract mismatch)
**Impact on plan:** Fix required for correctness per TEST-08 contract. No scope creep.

## Issues Encountered

- `tests/file-guard.bats` was overwritten by a linter/formatter during the RED phase commit. The replacement used `bats-assert`/`bats-support` helpers (consistent with the rest of the test suite) and specified the `hookSpecificOutput` JSON contract. Accepted the updated test file as the authoritative contract definition and adapted the implementation accordingly.

## Next Phase Readiness

- Guard hook is live and fully tested; all 36 bats tests pass
- `ALLCLEAR_EXTRA_BLOCKED` env var wired and tested; Phase 8 (Config Layer) can populate it from `allclear.config.json`
- No blockers for other phases

## Self-Check: PASSED

- scripts/file-guard.sh: FOUND
- hooks/hooks.json: FOUND
- tests/file-guard.bats: FOUND
- Commit e3727b8 (TDD RED): FOUND
- Commit 38208aa (feat GREEN): FOUND

---
*Phase: 05-guard-hook*
*Completed: 2026-03-15*
