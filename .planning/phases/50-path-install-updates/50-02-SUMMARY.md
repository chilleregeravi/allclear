---
phase: 50-path-install-updates
plan: "02"
subsystem: install-tooling
tags: [makefile, readme, mcp, install, paths]
dependency_graph:
  requires: [49-01]
  provides: [INS-01, INS-02]
  affects: [README.md, Makefile]
tech_stack:
  added: []
  patterns: [makefile-guard, plugin-dir-variable]
key_files:
  created: []
  modified:
    - README.md
    - Makefile
decisions:
  - "PLUGIN_DIR now resolves to plugins/ligamen/ subdirectory instead of repo root — this matches Phase 49 layout where plugin source lives under plugins/ligamen/"
  - "plugins/$(PLUGIN_NAME) prerequisite target replaced symlink creation with existence guard — the directory is real after Phase 49, not a symlink"
metrics:
  duration_seconds: 61
  completed_date: "2026-03-21"
  tasks_completed: 2
  files_modified: 2
---

# Phase 50 Plan 02: Install + Path Updates Summary

**One-liner:** README MCP server path and Makefile PLUGIN_DIR updated to reference `plugins/ligamen/` after Phase 49 directory restructure.

## What Was Built

Updated two files to align with the Phase 49 plugin source relocation:

1. **README.md** — MCP server `.mcp.json` example now shows `<path-to-ligamen>/plugins/ligamen/worker/mcp/server.js` so users installing from source configure the correct server path.

2. **Makefile** — Four changes:
   - `PLUGIN_DIR` changed from `$(shell pwd)` to `$(shell pwd)/plugins/$(PLUGIN_NAME)` — points at the actual plugin root
   - `lint` target now shellchecks `plugins/$(PLUGIN_NAME)/scripts/*.sh` and `plugins/$(PLUGIN_NAME)/lib/*.sh`
   - `check` target now validates `plugins/$(PLUGIN_NAME)/.claude-plugin/plugin.json` and `plugins/$(PLUGIN_NAME)/hooks/hooks.json`
   - `plugins/$(PLUGIN_NAME)` prerequisite target replaced `mkdir + ln -sfn` recipe with existence guard (since the directory is real, not a symlink, after Phase 49)

## Tasks Completed

| Task | Name | Commit | Files |
|------|------|--------|-------|
| 1 | Update README MCP server path | a374627 | README.md |
| 2 | Update Makefile for plugins/ligamen/ layout | 9c9b299 | Makefile |

## Verification Results

```
# README check
grep "plugins/ligamen/worker/mcp/server.js" README.md  → 1 match (PASS)

# Makefile dry-runs
make --dry-run install → claude plugin marketplace add .../plugins/ligamen (PASS)
make --dry-run lint    → shellcheck .../plugins/ligamen/scripts/*.sh (PASS)
make --dry-run check   → jq empty plugins/ligamen/.claude-plugin/plugin.json (PASS)
```

## Deviations from Plan

None - plan executed exactly as written.

## Self-Check: PASSED

- README.md: exists and contains `plugins/ligamen/worker/mcp/server.js`
- Makefile: exists with `PLUGIN_DIR := $(shell pwd)/plugins/$(PLUGIN_NAME)`
- Commit a374627: Task 1
- Commit 9c9b299: Task 2
