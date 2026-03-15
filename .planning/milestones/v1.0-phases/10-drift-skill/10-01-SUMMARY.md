---
phase: 10-drift-skill
plan: 01
subsystem: skill
tags: [bash, drift, versioning, jq, awk, bats, cross-repo]

# Dependency graph
requires:
  - phase: 02-siblings
    provides: lib/siblings.sh for sibling repo discovery
provides:
  - skills/drift/SKILL.md — prompt playbook for /allclear drift with subcommand routing
  - skills/drift/scripts/drift-common.sh — shared emit_finding, parse_drift_args, SHOW_INFO filtering
  - skills/drift/scripts/drift-versions.sh — multi-format version extraction and cross-repo comparison
affects:
  - 10-02 (drift-types and drift-openapi scripts will source drift-common.sh)
  - 13-xx (test infrastructure may add tests for drift skill)

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "TDD with bats-core: RED commit (failing tests) then GREEN commit (implementation)"
    - "POSIX awk for TOML/manifest parsing (no gawk required)"
    - "Tmpdir-based storage replaces bash 4 associative arrays for bash 3.2 compatibility"
    - "DRIFT_TEST_SIBLINGS + --test-only flags for hermetic test isolation"
    - "Severity filtering via SHOW_INFO variable in shared common.sh"
    - "Cargo.toml [dependencies] section scoping prevents [package] metadata leakage"

key-files:
  created:
    - skills/drift/SKILL.md
    - skills/drift/scripts/drift-common.sh
    - skills/drift/scripts/drift-versions.sh
    - tests/drift-versions.bats
    - tests/fixtures/drift/repo-a/package.json
    - tests/fixtures/drift/repo-a/go.mod
    - tests/fixtures/drift/repo-a/Cargo.toml
    - tests/fixtures/drift/repo-a/pyproject.toml
    - tests/fixtures/drift/repo-b/package.json
    - tests/fixtures/drift/repo-b/go.mod
    - tests/fixtures/drift/repo-b/Cargo.toml
    - tests/fixtures/drift/repo-b/pyproject.toml
  modified:
    - lib/siblings.sh (fixed discover_siblings -> list_siblings API mismatch)

key-decisions:
  - "Tmpdir + flat files used instead of declare -A associative arrays for bash 3.2 compatibility on macOS"
  - "Cargo.toml extraction scoped to [dependencies] section only to avoid [package] version/edition leakage"
  - "POSIX awk used throughout (no gawk 3-argument match() calls) for macOS compatibility"
  - "DRIFT_TEST_SIBLINGS env var + --test-only flag pattern chosen for hermetic test isolation without mocking siblings.sh"
  - "Range specifier vs pinned detected: ^1.2.3 vs ~1.2.3 = WARN (different locking strategy), 1.0.0 vs 1.0.1 = CRITICAL"

patterns-established:
  - "Drift scripts source drift-common.sh which provides PLUGIN_ROOT, SHOW_INFO, SIBLINGS, emit_finding, parse_drift_args"
  - "TDD for bash scripts: write bats tests first (RED), implement to pass (GREEN), review (REFACTOR)"
  - "Test isolation: DRIFT_TEST_SIBLINGS env var overrides sibling discovery; --test-only stops main loop"

requirements-completed: [DRFT-01, DRFT-04, DRFT-05, DRFT-06]

# Metrics
duration: 8min
completed: 2026-03-15
---

# Phase 10 Plan 01: Drift Skill Foundation Summary

**SKILL.md subcommand routing, shared emit_finding helper (CRITICAL/WARN/INFO severity filtering), and drift-versions.sh extracting versions from package.json, go.mod, Cargo.toml, pyproject.toml with cross-repo comparison — all bash 3.2 compatible**

## Performance

- **Duration:** ~8 min
- **Started:** 2026-03-15T10:08:18Z
- **Completed:** 2026-03-15T10:15:52Z
- **Tasks:** 2 (Task 2 had 3 TDD commits: RED + GREEN + no refactor needed)
- **Files modified:** 14

## Accomplishments

- SKILL.md defines `/allclear drift` with correct frontmatter and subcommand routing (versions, types, openapi) defaulting to all three
- drift-common.sh provides `emit_finding` (CRITICAL/WARN/INFO), `parse_drift_args`, `SHOW_INFO` filter — sourced by all drift scripts
- drift-versions.sh extracts versions from all 4 manifest formats, reports CRITICAL for pinned mismatches and WARN for range specifier differences, respects severity filtering
- 15 bats tests covering extract_versions per format, CRITICAL/WARN/INFO behavior, repo name reporting, single-repo skip

## Task Commits

Each task was committed atomically:

1. **Task 1: Create SKILL.md and drift-common.sh** - `d867770` (feat)
2. **Task 2 RED: Failing tests for drift-versions.sh** - `38551f3` (test)
3. **Task 2 GREEN: Implement drift-versions.sh** - `ed35ed7` (feat)

_Note: TDD task 2 has separate RED (test) and GREEN (feat) commits per TDD protocol._

## Files Created/Modified

- `skills/drift/SKILL.md` — Prompt playbook: frontmatter (name: drift, allowed-tools: Bash), subcommand routing instructions
- `skills/drift/scripts/drift-common.sh` — Shared helpers: emit_finding with 3 severity levels, parse_drift_args, SHOW_INFO flag, SIBLINGS discovery
- `skills/drift/scripts/drift-versions.sh` — Version extraction for 4 manifest formats; tmpdir-based cross-repo comparison; CRITICAL/WARN/INFO findings
- `lib/siblings.sh` — Fixed `discover_siblings` -> `list_siblings` API mismatch (Rule 1 auto-fix)
- `tests/drift-versions.bats` — 15 bats tests (DRFT-01, DRFT-05, DRFT-06)
- `tests/fixtures/drift/repo-a/` and `repo-b/` — Test fixture repos with all 4 manifest types

## Decisions Made

- **Bash 3.2 compatibility:** macOS ships bash 3.2 which lacks `declare -A` (associative arrays). Used tmpdir + flat files (`pkg_dir/data` with `repo=version` lines) instead. This is a required compatibility fix, not a preference.
- **POSIX awk throughout:** macOS awk is POSIX, not gawk. Avoided 3-argument `match()` and other gawk extensions.
- **Cargo.toml section scoping:** grep fallback scoped to `[dependencies]` section only via awk to prevent `version = "0.1.0"` from `[package]` appearing as a dependency.
- **Test isolation pattern:** `DRIFT_TEST_SIBLINGS` env var + `--test-only` flag allows tests to use fixture repos without real sibling discovery. Functions exported with `export -f` so subshells can call them.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Fixed discover_siblings -> list_siblings API mismatch in SKILL.md and drift-common.sh**
- **Found during:** Task 1 (reading existing files)
- **Issue:** Existing SKILL.md and drift-common.sh used `discover_siblings` but lib/siblings.sh exports `list_siblings`
- **Fix:** Updated both files to use `list_siblings "${PLUGIN_ROOT}"`
- **Files modified:** skills/drift/SKILL.md, skills/drift/scripts/drift-common.sh
- **Verification:** drift-common.sh sources and runs without error
- **Committed in:** d867770 (Task 1 commit)

**2. [Rule 1 - Bug] Fixed bash 3.2 incompatibility: declare -A not available**
- **Found during:** Task 2 GREEN (first test run)
- **Issue:** `declare -A` (associative arrays) requires bash 4+; macOS default bash is 3.2
- **Fix:** Replaced associative array storage with tmpdir + flat files (one directory per package, data file with `repo=version` lines)
- **Files modified:** skills/drift/scripts/drift-versions.sh
- **Verification:** All 15 bats tests pass; full script runs successfully
- **Committed in:** ed35ed7 (Task 2 GREEN commit)

**3. [Rule 1 - Bug] Fixed POSIX awk compatibility: removed 3-argument match() call**
- **Found during:** Task 2 GREEN (Cargo.toml parsing)
- **Issue:** macOS awk is POSIX, does not support gawk's 3-argument `match($0, regex, arr)` syntax
- **Fix:** Replaced with awk `in_deps` section filter + shell `while read` loop for Cargo.toml parsing
- **Files modified:** skills/drift/scripts/drift-versions.sh
- **Verification:** Cargo.toml extraction tested on macOS awk
- **Committed in:** ed35ed7 (Task 2 GREEN commit)

---

**Total deviations:** 3 auto-fixed (all Rule 1 - Bug)
**Impact on plan:** All fixes required for correctness and macOS compatibility. No scope creep. Core behavior matches plan specification exactly.

## Issues Encountered

- Cargo.toml grep fallback initially captured `version = "0.1.0"` and `edition = "2021"` from `[package]` section — fixed by scoping extraction to `[dependencies]` section only via awk.
- pyproject.toml PEP 508 strings (`"fastapi>=0.103.0"`) required careful normalization to `NAME=VERSION` format for comparison.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

- drift-common.sh is the shared foundation for Plan 02 (drift-types.sh and drift-openapi.sh)
- All three drift subcommand script paths are referenced in SKILL.md and ready to be created
- Test fixture repos (repo-a, repo-b) can be extended for drift-types and drift-openapi tests

---
*Phase: 10-drift-skill*
*Completed: 2026-03-15*
