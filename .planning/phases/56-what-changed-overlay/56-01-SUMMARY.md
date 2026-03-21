---
phase: 56-what-changed-overlay
plan: "01"
subsystem: frontend-state
tags: [graph, state, scan-version, what-changed]
dependency_graph:
  requires: [55-01]
  provides: [state.latestScanVersionId, state.showChanges, node.scan_version_id, edge.scan_version_id]
  affects: [56-02]
tech_stack:
  added: []
  patterns: [state-field-extension, api-response-mapping]
key_files:
  created: []
  modified:
    - plugins/ligamen/worker/ui/modules/state.js
    - plugins/ligamen/worker/ui/graph.js
key_decisions:
  - "latestScanVersionId and showChanges placed directly after currentProject — logically adjacent scan-awareness fields"
  - "scan_version_id uses nullish coalescing (?? null) rather than || null — preserves 0 as a valid version ID"
  - "Actor synthetic nodes and edges intentionally left without scan_version_id — they are not sourced from raw.services or raw.connections"
metrics:
  duration_minutes: 5
  tasks_completed: 2
  files_changed: 2
  completed_date: "2026-03-21"
---

# Phase 56 Plan 01: What-Changed Overlay — State Wiring Summary

**One-liner:** Wired `latest_scan_version_id` from `/graph` API into `state.latestScanVersionId` and mapped `scan_version_id` onto every service node and connection edge for renderer consumption.

## What Was Built

Phase 55 exposed `latest_scan_version_id` in the `/graph` response and `scan_version_id` on each service/connection. This plan ingests those values into the shared UI state so Plan 02 can render a visual distinction for new nodes and edges.

### Task 1: state.js — Two new fields

Added to the `state` object immediately after `currentProject`:

```js
latestScanVersionId: null,   // ID of the most recent scan (from /graph response metadata)
showChanges: true,           // When true, highlight nodes/edges from the latest scan
```

### Task 2: graph.js — loadProject() extractions

Three targeted edits to `loadProject()`:

1. After `const raw = await resp.json()`: stores `raw.latest_scan_version_id ?? null` into `state.latestScanVersionId`
2. Node mapping: adds `scan_version_id: s.scan_version_id ?? null` to every service node object
3. Edge mapping: adds `scan_version_id: c.scan_version_id ?? null` to every connection edge object

Actor synthetic nodes/edges were intentionally left unmodified — they carry no real `scan_version_id` from the API.

## Decisions Made

- **Nullish coalescing over OR:** `?? null` rather than `|| null` — preserves `0` if it ever appears as a valid version ID
- **Actor nodes excluded:** Synthetic actor nodes and actor edges are constructed from `raw.actors`, not `raw.services`/`raw.connections`, so they have no `scan_version_id` to map; leaving them with `undefined` is correct

## Deviations from Plan

None — plan executed exactly as written.

## Self-Check

- [x] `plugins/ligamen/worker/ui/modules/state.js` — modified with 2 new fields
- [x] `plugins/ligamen/worker/ui/graph.js` — modified with 4 new lines
- [x] Task 1 commit: `54a6d61`
- [x] Task 2 commit: `4cd96f7`
- [x] Both files pass `node --check`
