---
gsd_state_version: 1.0
milestone: v2.1
milestone_name: UI Polish & Observability
status: planning
stopped_at: Completed 23-03-PLAN.md (console.error sweep)
last_updated: "2026-03-16T12:51:50.749Z"
last_activity: 2026-03-16 — v2.1 roadmap created; phases 22-25 defined
progress:
  total_phases: 5
  completed_phases: 1
  total_plans: 11
  completed_plans: 5
  percent: 0
---

# Project State

## Project Reference

See: .planning/PROJECT.md (updated 2026-03-16)

**Core value:** Every edit is automatically formatted and linted, every quality check runs with one command, and breaking changes across repos are caught before they ship.
**Current focus:** Phase 22 — Canvas & Zoom

## Current Position

Phase: 22 of 26 (Canvas & Zoom)
Plan: 0 of TBD in current phase
Status: Ready to plan
Last activity: 2026-03-16 — v2.1 roadmap created; phases 22-25 defined

Progress: [░░░░░░░░░░] 0% (v2.1)

## Accumulated Context

### Decisions

- [v2.0]: Canvas not SVG for graph UI — SVG degrades at 30+ nodes, Canvas scales to 100+
- [v2.0]: Web Worker for D3 force simulation — keeps main thread free for smooth 60fps interaction
- [v2.0]: Worker logs to ~/.allclear/logs/worker.log as structured JSON (one line per entry)
- [v2.0]: Server binds to 127.0.0.1 only — never 0.0.0.0
- [v2.1 Roadmap]: Phase 23 (Logging Instrumentation) adds component tags to all worker modules — prerequisite for log filtering
- [v2.1 Roadmap]: Phase 24 (Log Terminal API) is infrastructure; all LOG requirements map to Phase 25 where user-visible outcome lives
- [v2.1 Roadmap]: Phase 22 and Phase 23 can be developed in parallel (renderer.js and logger are fully decoupled)
- [v2.1 Roadmap]: Phase 26 gated on named-handler refactor of setupInteractions() — prerequisite, not optional polish
- [Phase 22-canvas-zoom]: ctrlKey=false pans (not zooms) — mouse users use Ctrl+scroll (standard shortcut); trackpad two-finger scroll pans naturally
- [Phase 22-canvas-zoom]: Wheel zoom uses Math.pow(2, delta) exponential formula with SENSITIVITY=0.001 (D3-style, half of D3 default for gentler feel)
- [Phase 23-logging-instrumentation]: createLogger factory in worker/lib/logger.js — plain object, component-tagged JSON logging, port field omitted when undefined/null
- [Phase 22-canvas-zoom]: CSS pixel space is the single coordinate truth — DPR is render-time only; no mouse event or transform values multiplied by DPR
- [Phase 22-canvas-zoom]: watchDPR uses matchMedia re-registration (not persistent listener) for multi-monitor DPR change detection
- [Phase 22-canvas-zoom]: fitToScreen() placed inside init() closure to access container variable — bounding box formula: min(scaleX,scaleY) clamped 0.15-5, 60px padding, center translate
- [Phase 23-logging-instrumentation]: process.stderr.write used in db/database.js migration loader — no injection point, single error case, not console.error
- [Phase 23-logging-instrumentation]: setScanLogger setter injection pattern for scan/manager.js — mirrors setChromaLogger pattern, consistent approach
- [Phase 23-logging-instrumentation]: worker/ui/graph.js console.error left untouched — browser-side Canvas UI, not Node.js worker process code

### Pending Todos

None yet.

### Blockers/Concerns

- **Phase 25 (Log Terminal UI):** SSE zombie connection leak — request.raw.on('close', cleanup) is mandatory in first implementation
- **Phase 26 (Project Switcher):** Named-function refactor of setupInteractions() must precede switcher work; anonymous handlers cannot be torn down

## Session Continuity

Last session: 2026-03-16T12:51:50.746Z
Stopped at: Completed 23-03-PLAN.md (console.error sweep)
Resume file: None
