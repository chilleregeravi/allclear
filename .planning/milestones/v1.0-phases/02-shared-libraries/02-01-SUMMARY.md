---
phase: 02-shared-libraries
plan: 01
subsystem: lib
tags: [bash, detection, project-type, language-detection, sibling-repos, shared-library]

# Dependency graph
requires: []
provides:
  - "lib/detect.sh: detect_language(FILE), detect_project_type(DIR), detect_all_project_types(DIR)"
  - "lib/siblings.sh: discover_siblings([PROJECT_DIR])"
affects:
  - 06-session-start-hook
  - 07-quality-gate-skill
  - 08-config-layer
  - 09-puls-skill
  - 12-deploy-verify-skill
  - 13-tests

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Bash source library pattern: shebang + source guard, no set -e at file level, stdout reserved for return values, stderr for diagnostics"
    - "POSIX-safe path resolution: $(cd dir && pwd) instead of realpath for macOS compatibility"
    - "(( count++ )) || true pattern: prevents set -e in callers from treating arithmetic-zero as failure"

key-files:
  created:
    - lib/detect.sh
    - lib/siblings.sh
  modified: []

key-decisions:
  - "Use $(cd dir && pwd) instead of realpath for absolute path resolution — realpath not guaranteed on macOS without Homebrew"
  - "detect_all_project_types returns empty string (not 'unknown') when no manifests found — callers check [[ -z result ]]"
  - "No set -e in library files — sourcing context owns error handling; prevents strict-mode leakage into hook scripts"
  - "discover_siblings caps at max_siblings=10 to prevent SessionStart timeout on large parent directories"
  - "detect_project_type priority order: python > rust > node > go — python is primary signal for mixed-language repos with tooling package.json"

patterns-established:
  - "Pattern: Bash library source guard — [[ BASH_SOURCE[0] != 0 ]] || { echo ... >&2; exit 1; }"
  - "Pattern: All non-return output to stderr — never echo debug text to stdout in library functions"
  - "Pattern: detect_all_project_types uses bash array types=() with types+=() and echo ${types[*]} — space-separated return value"

requirements-completed: [PLGN-02, PLGN-03, PLGN-05, PLGN-07, PLGN-08]

# Metrics
duration: 2min
completed: 2026-03-15
---

# Phase 02 Plan 01: Shared Libraries Summary

**Sourceable bash libraries lib/detect.sh and lib/siblings.sh providing stable project-type detection and sibling-repo discovery APIs for all hooks and skills**

## Performance

- **Duration:** ~2 min
- **Started:** 2026-03-15T10:07:31Z
- **Completed:** 2026-03-15T10:09:20Z
- **Tasks:** 2 (+ 1 auto-fix)
- **Files modified:** 2

## Accomplishments

- `lib/detect.sh` with three public functions: `detect_language` (file extension to language token), `detect_project_type` (manifest-based primary type with python>rust>node>go priority), `detect_all_project_types` (all matching types space-separated for mixed-language repos)
- `lib/siblings.sh` with `discover_siblings` scanning parent directory for sibling git repos, capped at 10, using POSIX-safe path resolution
- Both libraries follow all bash library conventions: source guards, no `set -e` at file level, stdout reserved for return values only, diagnostics to stderr

## Task Commits

Each task was committed atomically:

1. **Task 1: Create lib/detect.sh** - `35a74bd` (feat)
2. **Task 2: Create lib/siblings.sh** - `0e1e742` (feat)
3. **Auto-fix: Restore from linter overwrite** - `db6f92d` (fix)

**Plan metadata:** (docs commit follows)

## Files Created/Modified

- `/Users/ravichillerega/sources/allclear/lib/detect.sh` - Language detection and project type detection library with three public functions
- `/Users/ravichillerega/sources/allclear/lib/siblings.sh` - Sibling repo discovery library with one public function

## Decisions Made

- Used `$(cd "$dir" && pwd)` instead of `realpath` for POSIX-safe absolute path resolution — `realpath` not guaranteed on macOS without Homebrew (per Open Question 2 in 02-RESEARCH.md)
- `detect_all_project_types` returns empty string on no manifests (not "unknown") to allow callers to use `[[ -z "$result" ]]` check cleanly
- `(( count++ )) || true` pattern used in `discover_siblings` to prevent `set -e` in callers from treating arithmetic increment-from-0 as failure

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Restored files overwritten by linter with placeholder stubs**
- **Found during:** Final verification pass
- **Issue:** After the task commits, a linter replaced both lib files with incorrect placeholder implementations — `detect.sh` got stubs with wrong function names (`detect_formatter`, `detect_linter`), `siblings.sh` got a `set -euo pipefail` implementation with wrong function name (`list_siblings`)
- **Fix:** Rewrote both files with the correct full implementations; re-ran all verification checks to confirm correctness
- **Files modified:** `lib/detect.sh`, `lib/siblings.sh`
- **Verification:** All plan verification commands passed after restore
- **Committed in:** `db6f92d`

---

**Total deviations:** 1 auto-fixed (Rule 3 - blocking)
**Impact on plan:** Auto-fix necessary to restore correct implementations after external tool interference. No scope creep.

## Issues Encountered

A linter/code-generator tool overwrote both `lib/detect.sh` and `lib/siblings.sh` with placeholder stubs between the task commits and the final verification pass. The stubs had incorrect function names and `lib/siblings.sh` contained the forbidden `set -euo pipefail`. Both files were restored to their correct implementations via `Edit`/`Write` and committed as a fix.

## User Setup Required

None — no external service configuration required.

## Next Phase Readiness

- `lib/detect.sh` and `lib/siblings.sh` are complete and verified; all hooks and skills can source them
- Public APIs are stable: `detect_language`, `detect_project_type`, `detect_all_project_types`, `discover_siblings`
- Bats unit tests for these libraries are scoped to Phase 13 (TEST-05, TEST-06) — no blocker for other phases
- Open concern from STATE.md still applies: `${CLAUDE_SKILL_DIR}/../../lib/detect.sh` relative path in skill injections needs runtime verification before Phase 7 finalizes SKILL.md frontmatter

---
*Phase: 02-shared-libraries*
*Completed: 2026-03-15*
