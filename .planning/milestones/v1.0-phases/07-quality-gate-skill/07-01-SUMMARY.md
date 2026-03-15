---
phase: 07-quality-gate-skill
plan: "01"
subsystem: skills
tags: [quality-gate, allclear, lint, format, test, typecheck, bash, makefile]

# Dependency graph
requires: []
provides:
  - "/allclear slash-command LLM prompt playbook with subcommand dispatch"
  - "Makefile-preference + per-language command tables for Python, Rust, TS/JS, Go"
  - "Structured result reporting with pass/fail, timing, and exact command"
  - "Fix scope guard: auto-fix restricted to lint/format only"
affects:
  - 13-integration-tests
  - 02-plugin-scaffold

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "LLM prompt playbook pattern: frontmatter + shell injection + dispatch table + command selection + result format"
    - "Shell injection via !backtick syntax for runtime project-type and Makefile detection"
    - "${CLAUDE_PLUGIN_ROOT}/lib/detect.sh with inline fallback probing pyproject.toml/Cargo.toml/go.mod/package.json"

key-files:
  created:
    - skills/quality-gate/SKILL.md
  modified: []

key-decisions:
  - "Makefile targets preferred over direct tool invocation when matching target exists — checked via make -qp"
  - "fix subcommand scope hard-limited to lint and format; test and typecheck failures require human review only"
  - "Both /allclear and /allclear:quality-gate namespace forms documented in description field"
  - "Inline manifest fallback in shell injection block handles Phase 2 (lib/detect.sh) not yet executed"

patterns-established:
  - "Skill frontmatter: name, description, allowed-tools: Bash, argument-hint"
  - "Runtime context via !backtick shell injection at top of skill file"
  - "Subcommand dispatch table mapping $ARGUMENTS to check subsets before command selection"
  - "Tool availability guard: command -v <tool> before each invocation, skip with 'skipped — [tool] not found'"

requirements-completed: [GATE-01, GATE-02, GATE-03, GATE-04, GATE-05]

# Metrics
duration: ~2min (checkpoint review accounted for)
completed: 2026-03-15
---

# Phase 07 Plan 01: Quality Gate Skill Summary

**`/allclear` quality gate SKILL.md prompt playbook with 7-subcommand dispatch, Makefile-preference command selection, per-language tables for Python/Rust/TS/JS/Go, structured result reporting, and hard-scoped auto-fix (lint+format only)**

## Performance

- **Duration:** ~2min (including human-verify checkpoint)
- **Started:** 2026-03-15T10:09:20Z
- **Completed:** 2026-03-15T10:11:41Z
- **Tasks:** 2 (1 auto + 1 checkpoint:human-verify)
- **Files modified:** 1

## Accomplishments

- Created `skills/quality-gate/SKILL.md` — a 154-line LLM prompt playbook covering all five GATE requirements
- Implemented 7-subcommand dispatch (empty, lint, format, test, typecheck, quick, fix) with Makefile-first command selection
- Established fix scope prohibition: test and typecheck failures are explicitly excluded from auto-fix with human-readable rationale
- Documented skill namespace disambiguation (`/allclear` vs `/allclear:quality-gate`) in frontmatter description

## Task Commits

Each task was committed atomically:

1. **Task 1: Create the quality gate SKILL.md** - `1750a2f` (feat)
2. **Task 2: Verify quality gate SKILL.md content** - checkpoint:human-verify (approved by user, no code commit)

**Plan metadata:** (this commit)

## Files Created/Modified

- `skills/quality-gate/SKILL.md` — Complete `/allclear` quality gate prompt playbook with shell injection, dispatch table, command selection, and result formatting

## Decisions Made

- Makefile targets are checked via `make -qp` at runtime and preferred over direct tool invocation when matching target exists (lint, format, fmt, test, typecheck, check, quick, fix)
- `fix` subcommand scope hard-limited to lint and format only; plan's explicit constraint (GATE-05) enforced with "non-negotiable" language
- Both `/allclear` and `/allclear:quality-gate` namespace forms mentioned in frontmatter description to address the open question in STATE.md blockers
- Inline manifest detection fallback (`pyproject.toml`, `Cargo.toml`, `go.mod`, `package.json`) embedded directly in shell injection block so the skill works before Phase 2 (lib/detect.sh) is executed

## Deviations from Plan

None — plan executed exactly as written.

## Issues Encountered

None.

## User Setup Required

None — no external service configuration required.

## Next Phase Readiness

- `skills/quality-gate/SKILL.md` is complete and ready for integration testing (Phase 13)
- The skill references `${CLAUDE_PLUGIN_ROOT}/lib/detect.sh` — runtime verification of this path pattern is still needed (noted as a blocker in STATE.md; unresolved, deferred to integration phase)
- `/allclear` vs `/allclear:quality-gate` namespace question remains open pending a dev session with `--plugin-dir` (documented in skill description to cover both cases)

---
*Phase: 07-quality-gate-skill*
*Completed: 2026-03-15*
