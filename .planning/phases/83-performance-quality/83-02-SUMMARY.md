---
phase: 83-performance-quality
plan: "02"
subsystem: cli
tags: [ligamen-map, config, project-name, AskUserQuestion]

# Dependency graph
requires: []
provides:
  - "/ligamen:map command prompts for project name before scanning when ligamen.config.json has no project-name"
  - "Project name persisted to ligamen.config.json for reuse on subsequent invocations"
  - "ligamen.config.json has project-name field set to 'ligamen'"
affects: [ligamen-map, scan-pipeline]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Config-gate pattern: read field from config, prompt if absent, write back, continue"

key-files:
  created: []
  modified:
    - plugins/ligamen/commands/map.md
    - ligamen.config.json

key-decisions:
  - "Step 0 inserted before repo discovery so project name is established before any I/O"
  - "AskUserQuestion used (consistent with existing command style) for interactive prompt"
  - "project-name written immediately after entry to ensure persistence even if scan fails"

patterns-established:
  - "Config-gate pattern: check field in config, prompt user if absent, write back before proceeding"

requirements-completed: [QUAL-02]

# Metrics
duration: 1min
completed: 2026-03-22
---

# Phase 83 Plan 02: Ensure Project Name Summary

**ligamen:map now prompts for a human-readable project name before scanning and persists it to ligamen.config.json for reuse on all subsequent invocations**

## Performance

- **Duration:** ~1 min
- **Started:** 2026-03-22T21:22:10Z
- **Completed:** 2026-03-22T21:22:48Z
- **Tasks:** 1
- **Files modified:** 2

## Accomplishments

- Added Step 0 "Ensure Project Name" to /ligamen:map before repo discovery
- Step 0 reads project-name from config, prompts via AskUserQuestion if missing, writes it back
- Subsequent invocations skip the prompt and print the stored name
- ligamen.config.json seeded with project-name: "ligamen" for the ligamen project itself

## Task Commits

Each task was committed atomically:

1. **Task 1: Add project name prompt to /ligamen:map command** - `6637aa5` (feat)

## Files Created/Modified

- `plugins/ligamen/commands/map.md` - Added Step 0 section with config-read, conditional AskUserQuestion prompt, and write-back logic
- `ligamen.config.json` - Added `"project-name": "ligamen"` field

## Decisions Made

- Step 0 is placed after the `view` early-exit block but before Step 1 repo discovery, so the name is captured before any scanning work begins
- AskUserQuestion is used for the prompt (consistent with the command's existing allowed-tools)
- project-name is written immediately after user entry so it survives even if the scan fails partway through

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered

None.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

- QUAL-02 complete: project names will now be captured and labeled on all new map invocations
- Phase 83 complete (both plans executed)

---
*Phase: 83-performance-quality*
*Completed: 2026-03-22*
