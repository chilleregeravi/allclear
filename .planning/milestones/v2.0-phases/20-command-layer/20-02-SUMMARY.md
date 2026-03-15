---
phase: 20-command-layer
plan: "02"
subsystem: command-layer
tags: [cross-impact, worker-client, legacy-fallback, impact-classification]
dependency_graph:
  requires:
    - lib/worker-client.sh (Phase 15)
    - worker GET /impact endpoint (Phase 17)
    - worker GET /graph endpoint (Phase 17)
    - scripts/impact.sh (v1.0 legacy)
  provides:
    - commands/cross-impact.md — worker-aware cross-impact command with legacy fallback
  affects:
    - End users invoking /allclear:cross-impact
tech_stack:
  added: []
  patterns:
    - Three-state degradation (no worker / worker+no data / worker+data)
    - Worker-call orchestration from Claude command markdown
    - Legacy grep fallback preserved for v1.0 backward compatibility
key_files:
  created: []
  modified:
    - commands/cross-impact.md
decisions:
  - "cross-impact is query-only — never starts the worker inline"
  - "State B (worker up, no map data) still runs legacy grep to give partial results"
  - "Stale map detection uses repo_state last_scanned_commit vs current HEAD"
  - "Transitive query uses /impact?transitive=true — same endpoint, extra param"
metrics:
  duration: "82s"
  completed: "2026-03-15"
  tasks_completed: 1
  files_modified: 1
---

# Phase 20 Plan 02: Cross-Impact Command Rewrite Summary

**One-liner:** Worker-aware cross-impact command with three-state degradation (CRITICAL/WARN/INFO graph queries + legacy grep fallback).

## What Was Done

Rewrote `commands/cross-impact.md` to support the v2.0 service dependency map while preserving 100% backward compatibility with v1.0 users who have no worker or map data.

## Three-State Detection Logic

The command opens with a bash block that determines which path to take:

```bash
source ${CLAUDE_PLUGIN_ROOT}/lib/worker-client.sh
WORKER_UP=$(worker_running && echo "yes" || echo "no")
```

Then checks map data by calling `GET /graph`:

| State | Condition | Behavior |
|-------|-----------|----------|
| A — No worker | `WORKER_UP=no` | Jump immediately to Legacy Fallback |
| B — Worker, no data | `WORKER_UP=yes`, graph empty | Print "Run /allclear:map first" + Legacy Fallback |
| C — Worker + data | `WORKER_UP=yes`, graph has nodes | Full graph query flow |

## Graph Query Flow (State C)

1. **Auto-detect changes** — `git diff --name-only HEAD` (uncommitted) + `git diff --name-only HEAD~1 HEAD` (recent commit), combined and deduplicated. If empty and no symbol provided, asks user.
2. **Query impact map** — `worker_call GET /impact?change=<target>` (direct) + `?transitive=true` (blast radius).
3. **Render report** — CRITICAL (endpoint_removed) → WARN (field_type_changed) → INFO (field_added), grouped by severity with consumer list and files to update.
4. **Stale map suggestion** — compares `last_scanned_commit` in `repo_state` to current HEAD; if stale, offers to guide user to run `/allclear:map`.

## How Legacy Fallback Was Preserved

States A and B both print a `[Legacy mode — dependency map not available]` banner and then execute the complete v1.0 flow:
- Linked repos config check (allclear.config.json, auto-discover, manual, skip)
- `bash ${CLAUDE_PLUGIN_ROOT}/scripts/impact.sh [args]`
- Tab-separated output parsing (repo / term / type / filepath)
- Original Output Interpretation table (code=HIGH, config=MEDIUM, test=LOW, docs=LOW)
- Original reporting format (group by repo, unique file count, one-line summary)

No behavior change for v1.0 users — they hit State A and get identical output to the previous command.

## Deviations from Plan

None — plan executed exactly as written.

## Self-Check: PASSED

- `commands/cross-impact.md` exists and contains all required keywords (CRITICAL, worker_running, impact.sh, Legacy, transitive)
- Automated grep verification returned PASS
- Commit 37fddc9 created successfully
