---
phase: 40-environment-paths
plan: "01"
subsystem: environment-vars
tags: [rename, env-vars, shell, javascript, ligamen]
dependency_graph:
  requires: []
  provides: [LIGAMEN_env_vars, ligamen_data_paths]
  affects: [lib/config.sh, lib/worker-client.sh, scripts/, worker/]
tech_stack:
  added: []
  patterns: [env-var-rename, path-migration]
key_files:
  created: []
  modified:
    - lib/config.sh
    - lib/worker-client.sh
    - scripts/worker-start.sh
    - scripts/worker-stop.sh
    - scripts/format.sh
    - scripts/lint.sh
    - scripts/file-guard.sh
    - scripts/session-start.sh
    - worker/index.js
    - worker/db/pool.js
    - worker/db/database.js
    - worker/mcp/server.js
    - worker/server/chroma.js
decisions:
  - "Renamed ~11 distinct ALLCLEAR_* shell vars to LIGAMEN_* across 8 shell files"
  - "Renamed ~12 distinct ALLCLEAR_* JS vars to LIGAMEN_* across 5 JS worker files"
  - "All ~/.allclear default paths updated to ~/.ligamen"
  - "All /tmp/allclear_* temp file prefixes updated to /tmp/ligamen_*"
  - "allclear.config.json config file references updated to ligamen.config.json"
metrics:
  duration: ~15min
  completed: "2026-03-19T18:33:29Z"
  tasks_completed: 4
  files_modified: 13
---

# Phase 40 Plan 01+02: Environment Variables and Data Paths Rename Summary

Complete rename of all ALLCLEAR_* environment variables and ~/.allclear path defaults to their LIGAMEN_* equivalents across 8 shell scripts and 5 JavaScript worker files.

## What Was Done

### Plan 40-01: Shell Scripts (Tasks 1-2)

**Task 1: lib/ shell scripts**

Renamed in `lib/config.sh`:
- `_ALLCLEAR_CONFIG_LOADED` guard variable → `_LIGAMEN_CONFIG_LOADED`
- `ALLCLEAR_CONFIG_FILE` → `LIGAMEN_CONFIG_FILE` (including default fallback: `ligamen.config.json`)
- `ALLCLEAR_CONFIG_LINKED_REPOS` → `LIGAMEN_CONFIG_LINKED_REPOS`
- Warning message updated: `allclear: warning: allclear.config.json is malformed` → `ligamen: warning: ligamen.config.json is malformed`
- All comment documentation updated

Renamed in `lib/worker-client.sh`:
- `ALLCLEAR_DATA_DIR:-$HOME/.allclear` → `LIGAMEN_DATA_DIR:-$HOME/.ligamen` in all 4 functions: `worker_running()`, `worker_call()`, `wait_for_worker()`, `worker_status_line()`

**Task 2: scripts/ shell scripts**

Renamed in `scripts/worker-start.sh`:
- `ALLCLEAR_DATA_DIR:-$HOME/.allclear` → `LIGAMEN_DATA_DIR:-$HOME/.ligamen`
- `ALLCLEAR_WORKER_PORT` → `LIGAMEN_WORKER_PORT` (env var check and settings.json key)
- `allclear.config.json` → `ligamen.config.json` (path check and jq invocation)
- Comment updated for data directory and settings.json key name

Renamed in `scripts/worker-stop.sh`:
- `ALLCLEAR_DATA_DIR:-$HOME/.allclear` → `LIGAMEN_DATA_DIR:-$HOME/.ligamen`

Renamed in `scripts/format.sh`:
- `ALLCLEAR_DISABLE_FORMAT` → `LIGAMEN_DISABLE_FORMAT`

Renamed in `scripts/lint.sh`:
- `ALLCLEAR_DISABLE_LINT` → `LIGAMEN_DISABLE_LINT`
- `/tmp/allclear_clippy_${THROTTLE_KEY}` → `/tmp/ligamen_clippy_${THROTTLE_KEY}`
- `ALLCLEAR_LINT_THROTTLE` → `LIGAMEN_LINT_THROTTLE`

Renamed in `scripts/file-guard.sh`:
- `ALLCLEAR_DISABLE_GUARD` → `LIGAMEN_DISABLE_GUARD` (header comments + conditional)
- `ALLCLEAR_EXTRA_BLOCKED` → `LIGAMEN_EXTRA_BLOCKED` (header comments, variable reads, error message)

Renamed in `scripts/session-start.sh`:
- `ALLCLEAR_DISABLE_SESSION_START` → `LIGAMEN_DISABLE_SESSION_START`
- `/tmp/allclear_session_${SESSION_ID}.initialized` → `/tmp/ligamen_session_${SESSION_ID}.initialized`

### Plan 40-02: JavaScript Worker Files (Tasks 3-4)

**Task 3: worker/index.js and worker/db/**

Renamed in `worker/index.js`:
- `process.env.ALLCLEAR_DATA_DIR || path.join(os.homedir(), ".allclear")` → `LIGAMEN_DATA_DIR / .ligamen`
- Settings key reads: `ALLCLEAR_LOG_LEVEL` → `LIGAMEN_LOG_LEVEL`, `ALLCLEAR_WORKER_PORT` → `LIGAMEN_WORKER_PORT`
- `allSettings.ALLCLEAR_CHROMA_MODE` → `allSettings.LIGAMEN_CHROMA_MODE`

Renamed in `worker/db/pool.js`:
- `process.env.ALLCLEAR_DATA_DIR || path.join(os.homedir(), ".allclear")` → `LIGAMEN_DATA_DIR / .ligamen`
- JSDoc comment: `~/.allclear/projects/` → `~/.ligamen/projects/`

Renamed in `worker/db/database.js`:
- JSDoc: `DB path: ~/.allclear/projects/...` → `~/.ligamen/projects/...`
- `path.join(os.homedir(), ".allclear", "projects", hash)` → `".ligamen"`

**Task 4: worker/mcp/server.js and worker/server/chroma.js**

Renamed in `worker/mcp/server.js`:
- `process.env.ALLCLEAR_DATA_DIR / .allclear` → `LIGAMEN_DATA_DIR / .ligamen`
- `_settings.ALLCLEAR_LOG_LEVEL` → `LIGAMEN_LOG_LEVEL`
- JSDoc: `~/.allclear/projects/...` → `~/.ligamen/projects/...`
- `process.env.ALLCLEAR_DB_PATH` → `LIGAMEN_DB_PATH`
- `process.env.ALLCLEAR_PROJECT_ROOT` → `LIGAMEN_PROJECT_ROOT` (3 occurrences: init, resolveDb, tool descriptions)
- 4 tool schema descriptions updated: `Defaults to ALLCLEAR_PROJECT_ROOT or cwd.` → `LIGAMEN_PROJECT_ROOT`

Renamed in `worker/server/chroma.js`:
- JSDoc: `ALLCLEAR_CHROMA_MODE/HOST/PORT/SSL` → `LIGAMEN_CHROMA_*` (4 JSDoc @param tags)
- `settings.ALLCLEAR_CHROMA_MODE` guard → `settings.LIGAMEN_CHROMA_MODE`
- All 6 `settings.ALLCLEAR_CHROMA_*` property reads → `LIGAMEN_CHROMA_*`

## Verification Results

Final grep for `ALLCLEAR_|\.allclear|/tmp/allclear` across all 13 production files: **zero matches**.

LIGAMEN_ variable counts:
- `lib/config.sh`: 11 occurrences of LIGAMEN_ vars
- `lib/worker-client.sh`: 4 occurrences of LIGAMEN_DATA_DIR
- `scripts/worker-start.sh`: 9 occurrences (LIGAMEN vars + .ligamen + ligamen.config.json)
- `scripts/lint.sh`: 1 occurrence of `/tmp/ligamen_clippy_`
- `scripts/session-start.sh`: 1 occurrence of `/tmp/ligamen_session_`
- `worker/index.js`: 6 LIGAMEN_ references
- `worker/db/pool.js`: 1 LIGAMEN_DATA_DIR
- `worker/db/database.js`: 2 .ligamen path references
- `worker/mcp/server.js`: 9 LIGAMEN_ references
- `worker/server/chroma.js`: 12 LIGAMEN_CHROMA_* references

## Commit

- `ced5e1c`: feat(40): rename env vars and data paths to ligamen

## Deviations from Plan

None - plan executed exactly as written. Some header comment renames (branding) were already applied by a prior Phase 42 commit that ran in parallel; this plan's env var and path changes were distinct and applied cleanly.

## Self-Check: PASSED

All 13 modified files verified clean (zero ALLCLEAR_ references). Commit ced5e1c confirmed in git log.
