---
phase: 34-layout-engine
plan: "01"
subsystem: graph-ui
tags: [layout, grid, deterministic, force-worker-removal, boundaries, canvas]
dependency_graph:
  requires: []
  provides: [layout-engine, deterministic-positions, boundary-boxes, boundaries-api]
  affects: [graph-ui, renderer, project-switcher, http-graph-api]
tech_stack:
  added: []
  patterns: [pure-function-layout, boundary-aware-sort, actor-column-reserve]
key_files:
  created:
    - worker/ui/modules/layout.js
    - worker/ui/modules/layout.test.js
  modified:
    - worker/ui/modules/state.js
    - worker/ui/graph.js
    - worker/ui/modules/interactions.js
    - worker/ui/modules/project-switcher.js
    - worker/server/http.js
    - worker/ui/modules/interactions.test.js
decisions:
  - "computeLayout() is a pure function — zero side effects, same input always yields same output"
  - "Reserved right 18% of canvas width for Phase 35 actor column via ACTOR_COLUMN_RESERVE_RATIO constant"
  - "Boundary-aware service sort: boundary members contiguous before un-boundaried services, both groups alphabetical"
  - "Boundary box minimum height = NODE_RADIUS*2 + BOX_PAD*2 (prevents collapsed boxes on single-row layers)"
  - "HTTP handler reads boundaries from config directly — avoids touching QueryEngine"
  - "Direct drag: state.positions[dragNodeId] updated on mousemove and mouseup — no Worker needed"
metrics:
  duration_minutes: 4
  completed_date: "2026-03-18"
  tasks_completed: 3
  tasks_total: 3
  files_created: 2
  files_modified: 6
  tests_added: 13
---

# Phase 34 Plan 01: Layout Engine — Force Worker Removal Summary

**One-liner:** Deterministic grid layout (service/library/infra layers, boundary-aware sort, 18% actor column reserve) replacing D3 force simulation, with boundaries surfaced from allclear.config.json through /graph API.

## What Was Built

Replaced the D3 force simulation Worker with a pure deterministic layout function. Node positions are now computed synchronously from node type and sort order, producing identical positions on every page reload. Services appear at top (50% of canvas height), libraries in the middle (25%), and infra at the bottom (25%). Service nodes in the same boundary are placed in adjacent columns, enabling compact boundary box rendering in Phase 34-02.

The right 18% of canvas width is reserved for external actors (Phase 35), controlled by the exported `ACTOR_COLUMN_RESERVE_RATIO` constant.

The `/graph` API now includes a `boundaries` array read from `allclear.config.json`, defaulting to `[]` when the file is missing or has no boundaries key.

## Tasks Completed

| Task | Name | Commit | Files |
|------|------|--------|-------|
| 1 | Create layout.js, update state.js, wire into graph.js, fix interactions.js | 2fb1cbd | layout.js, state.js, graph.js, interactions.js, project-switcher.js |
| 2 | Surface boundaries from config in /graph API | 1a79d75 | worker/server/http.js |
| 3 | Create layout.test.js and update interactions.test.js | 483cc79 | layout.test.js, interactions.test.js |

## Verification Results

- `node --test worker/ui/modules/layout.test.js` — 10/10 pass
- `node --test worker/ui/modules/interactions.test.js` — 27/27 pass (3 new forceWorker removal checks)
- `grep -r "forceWorker" worker/ui/ --include="*.js" | grep -v force-worker.js` — empty (no production references)
- `grep -c "boundaries" worker/server/http.js` — 6 matches

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] project-switcher.js had orphaned forceWorker stop/terminate block**
- **Found during:** Task 1 verification
- **Issue:** After removing `state.forceWorker` from state.js, `project-switcher.js` still had `if (state.forceWorker) { state.forceWorker.postMessage(...); state.forceWorker.terminate(); }` which would silently no-op on project switch but leaves dead code and could confuse future readers
- **Fix:** Removed the forceWorker stop/terminate block; added `state.boundaryBoxes = []` to the project switch reset
- **Files modified:** worker/ui/modules/project-switcher.js
- **Commit:** 2fb1cbd (included in Task 1 commit)

## Decisions Made

1. `computeLayout()` is a pure function — zero side effects, same input always yields same output
2. Reserved right 18% of canvas width for Phase 35 actor column via `ACTOR_COLUMN_RESERVE_RATIO` constant
3. Boundary-aware service sort: boundary members contiguous before un-boundaried services, both groups alphabetical
4. Boundary box minimum height = NODE_RADIUS*2 + BOX_PAD*2 (prevents collapsed boxes on single-row layers)
5. HTTP handler reads boundaries from config directly — avoids touching QueryEngine
6. Direct drag: `state.positions[dragNodeId]` updated on mousemove and mouseup — no Worker needed

## Self-Check: PASSED

| Item | Status |
|------|--------|
| worker/ui/modules/layout.js | FOUND |
| worker/ui/modules/layout.test.js | FOUND |
| 34-01-SUMMARY.md | FOUND |
| commit 2fb1cbd (Task 1) | FOUND |
| commit 1a79d75 (Task 2) | FOUND |
| commit 483cc79 (Task 3) | FOUND |
