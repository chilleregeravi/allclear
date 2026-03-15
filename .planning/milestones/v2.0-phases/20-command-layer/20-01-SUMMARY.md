---
phase: 20-command-layer
plan: 01
subsystem: api
tags: [allclear-map, command, worker-client, scan-pipeline, mcp-registration]

# Dependency graph
requires:
  - phase: 15-worker-lifecycle
    provides: worker-client.sh, worker-start.sh, worker_running/wait_for_worker/worker_call functions
  - phase: 17-http-server-web-ui
    provides: GET /graph, POST /scan, POST /scan/confirm, GET /versions REST API
  - phase: 18-agent-scanning
    provides: POST /scan endpoint that spawns agents and returns findings JSON
  - phase: 19-repo-discovery-user-confirmation
    provides: confirmation-flow.js pattern, lib/linked-repos.sh, list_linked_repos function
provides:
  - commands/map.md — full /allclear:map orchestration command with 10-step pipeline
affects: [21-integration, cross-impact-v2, session-start-hook]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Claude command markdown: YAML frontmatter + imperative second-person steps + inline bash code blocks"
    - "Step 0 flag check: early exit for --view before entering main pipeline"
    - "Inline node -e for JSON config read/write without separate script files"

key-files:
  created:
    - commands/map.md
  modified: []

key-decisions:
  - "commands/map.md is a pure orchestration prompt — no new scripts; all heavy lifting is delegated to Phase 15/17/18/19 infrastructure"
  - "--view flag handled in Step 0 before worker start to enable fast UI open without triggering any confirmation flow"
  - "First-build detection: versions list empty before Step 7 persist → triggers MCP instructions + impact-map section write"
  - "allclear.config.json updated with impact-map section only after first successful persist — presence of section enables worker auto-start in future sessions"
  - "Low-confidence findings capped at 10 to avoid overwhelming users; each shown with its clarification_question from the finding object"

patterns-established:
  - "Command flag handling: detect flags at top (Step 0) and early-exit before entering main pipeline"
  - "Worker lifecycle in commands: source worker-client.sh → check worker_running → start + wait if needed"
  - "Repo confirmation gate: present combined config+discovered list, loop on edit until yes/no"

requirements-completed: [CMDL-01]

# Metrics
duration: 2min
completed: 2026-03-15
---

# Phase 20 Plan 01: Command Layer — Map Command Summary

**`/allclear:map` Claude command implementing the full discover-confirm-scan-confirm-persist-view pipeline using worker-client.sh and the Phase 17/18/19 REST API**

## Performance

- **Duration:** ~2 min
- **Started:** 2026-03-15T19:28:44Z
- **Completed:** 2026-03-15T19:29:53Z
- **Tasks:** 1
- **Files modified:** 1

## Accomplishments

- Created `commands/map.md` — single command that drives the entire v2.0 dependency map flow
- Implemented all 10 pipeline steps from the cross-impact-v2.md flowchart in imperative command prose
- `--view` flag: fast path to open browser without scanning (Step 0 early exit)
- `--full` flag: bypass incremental check and force full re-scan
- First-build detection: adds `impact-map` section to `allclear.config.json` and prints MCP registration instructions

## Task Commits

1. **Task 1: Write commands/map.md — full orchestration flow** - `df7bba4` (feat)

## Files Created/Modified

- `commands/map.md` — `/allclear:map` command prompt with 10 pipeline steps, --view, --full, MCP registration

## Decisions Made

- The command is a pure orchestration layer — no new shell scripts created. All functionality delegates to Phase 15 (worker-client.sh, worker-start.sh), Phase 17 (REST API endpoints), Phase 18 (POST /scan), and Phase 19 (lib/linked-repos.sh) infrastructure.
- First-build detection uses the /versions response from Step 7: if the list was empty before persist, it is a first build. This avoids a separate DB query and reuses already-fetched data.
- `allclear.config.json` is written twice: once in Step 3 (confirmed linked-repos) and optionally updated in Step 9 (add impact-map section). Kept as two discrete writes to match the plan's confirmation gate requirement.
- Low-confidence findings limited to 10 displayed at once to avoid overwhelming the user in large codebases.

## Deviations from Plan

None — plan executed exactly as written.

## Issues Encountered

None.

## User Setup Required

None — no external service configuration required.

## Next Phase Readiness

- `commands/map.md` is complete and ready for Phase 21 integration testing
- Phase 21 should verify the full pipeline end-to-end: worker start → repo discovery → scan → confirm → persist → UI open
- MCP registration path (`${CLAUDE_PLUGIN_ROOT}/worker/mcp-server.js`) matches Phase 16 output

---
*Phase: 20-command-layer*
*Completed: 2026-03-15*
