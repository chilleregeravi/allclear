---
phase: 97-command-cleanup
plan: 03
subsystem: config
tags: [hub-sync, auto-sync, deprecation, config-migration, node-test]

# Dependency graph
requires: []
provides:
  - plugin.json userConfig block with auto_sync key (CLN-06)
  - _readHubAutoSync two-read helper in hub.js and manager.js (CLN-07)
  - one-time stderr deprecation warning for legacy hub.auto-upload key (CLN-08)
  - unit tests for two-read precedence semantics
affects: [hub-sync, scan-manager, status-command, login-command]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Two-read config fallback: cfg?.hub?.['auto-sync'] ?? cfg?.hub?.['auto-upload'] with explicit typeof check"
    - "Once-per-process deprecation guard via module-level boolean flag"
    - "Export internal helpers with _ prefix for test access"
    - "Guard main() behind import.meta.url === process.argv[1] to allow ESM import in tests"

key-files:
  created:
    - plugins/arcanon/worker/cli/hub.test.js
  modified:
    - plugins/arcanon/.claude-plugin/plugin.json
    - plugins/arcanon/worker/cli/hub.js
    - plugins/arcanon/worker/scan/manager.js
    - plugins/arcanon/worker/scan/manager.test.js
    - plugins/arcanon/commands/status.md
    - plugins/arcanon/commands/login.md

key-decisions:
  - "Use typeof newKey !== 'undefined' (not nullish coalescing) so auto-sync:false beats auto-upload:true"
  - "Module-level _autoUploadDeprecationWarned flag caps stderr writes at 1 per worker process"
  - "Guard hub.js main() behind import.meta.url check — Node v25 doesn't support query-string cache-busting on file:// URLs, so tests must be able to import hub.js as a module"
  - "hub.test.js uses direct import (not dynamic re-import) since the guard flag resets per-process and one test file = one process"

patterns-established:
  - "Legacy config key fallback: explicit typeof check, not ||, to preserve false values"
  - "Deprecation warning pattern: module-level boolean guard, static string, stderr.write (not console.error)"

requirements-completed: [CLN-06, CLN-07, CLN-08]

# Metrics
duration: 25min
completed: 2026-04-19
---

# Phase 97 Plan 03: auto_upload → auto_sync Rename Summary

**Backward-compatible rename of hub config flag from `auto-upload` to `auto-sync` with two-read fallback helper, once-per-process stderr deprecation warning, and 5 unit tests proving precedence semantics**

## Performance

- **Duration:** ~25 min
- **Started:** 2026-04-21T18:30:40Z
- **Completed:** 2026-04-21T18:55:00Z
- **Tasks:** 4
- **Files modified:** 6 (+ 1 created)

## Accomplishments

- Renamed `auto_upload` → `auto_sync` in plugin.json userConfig (UI schema, no back-compat needed)
- Added `_readHubAutoSync(hubBlock)` helper to both hub.js and manager.js implementing two-read precedence with explicit `typeof` check
- Legacy `hub.auto-upload` key still activates sync AND emits exactly one stderr deprecation warning per worker process
- Updated all `hubAutoUpload` variable references and `hub_auto_upload` JSON key in cmdStatus output
- 5 unit tests across manager.test.js (4) and hub.test.js (1) prove all semantic branches

## Final plugin.json userConfig block

```json
"auto_sync": {
  "title": "Auto-sync scans to hub",
  "type": "boolean",
  "description": "Automatically push scan findings to Arcanon Hub and drain the offline queue after every /arcanon:map. Requires api_token.",
  "required": false,
  "default": false
},
```

## Deprecation warning text (exact stderr string)

```
arcanon: config key 'hub.auto-upload' is deprecated — rename to 'hub.auto-sync' (legacy key will be dropped in v0.2.0)
```

## Rename site counts

| File | hubAutoUpload → hubAutoSync sites | hub_auto_upload → hub_auto_sync |
|------|-----------------------------------|----------------------------------|
| hub.js | 1 (variable decl in cmdStatus) | 1 (JSON report key) + 1 (text label) |
| manager.js | 1 (_readHubConfig return) + 2 (consumer conditionals) + 1 (catch default) | 0 (no JSON output) |

## Unit test results

```
node --test plugins/arcanon/worker/scan/manager.test.js plugins/arcanon/worker/cli/hub.test.js

✔ CLN-07: auto-sync=true activates sync without deprecation warning
✔ CLN-08: auto-upload-only triggers sync AND writes one deprecation warning
✔ CLN-07: auto-sync=false beats auto-upload=true (new key wins)
✔ CLN-07: neither key set disables sync without warning
✔ CLN-07: hub.js _readHubAutoSync mirrors manager.js precedence rules

pass 64 / fail 1 (pre-existing: "incremental scan prompt" — unrelated to this plan)
```

## Files Created/Modified

- `plugins/arcanon/.claude-plugin/plugin.json` — userConfig: auto_upload → auto_sync with updated title/description
- `plugins/arcanon/worker/cli/hub.js` — _readHubAutoSync helper, cmdStatus uses hubAutoSync, hub_auto_sync JSON key, auto-sync: text label; main() guarded for test import
- `plugins/arcanon/worker/scan/manager.js` — _readHubAutoSync helper, _readHubConfig returns hubAutoSync, all consumer sites updated, comment text updated
- `plugins/arcanon/worker/scan/manager.test.js` — 4 CLN-07/CLN-08 tests appended
- `plugins/arcanon/worker/cli/hub.test.js` — new file, 1 combined precedence test
- `plugins/arcanon/commands/status.md` — 2 occurrences of hub.auto-upload → hub.auto-sync
- `plugins/arcanon/commands/login.md` — 2 occurrences of hub.auto-upload → hub.auto-sync

## Decisions Made

- Used `typeof newKey !== "undefined"` instead of `??` nullish coalescing at the outer read level so `auto-sync: false` explicitly wins over `auto-upload: true` (the key security invariant for T-97-10)
- Guarded `hub.js main()` behind `import.meta.url === process.argv[1]` — Node v25 does not support query-string cache-busting on `file://` URLs (strips them), so the dynamic re-import trick used in manager.test.js cannot work for hub.js which calls `main()` at load time
- hub.test.js uses a direct static import since the `_autoUploadDeprecationWarned` guard is process-scoped: one test file = one process = one fresh guard state. No cache-busting needed.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Guard hub.js main() for ESM import compatibility in tests**
- **Found during:** Task 3 (unit test creation)
- **Issue:** hub.js calls `main()` unconditionally at module load. When imported by hub.test.js, `main()` runs with test-runner argv (e.g. `--test`), which isn't a valid subcommand, causing `process.exit(2)`. Additionally Node v25 strips query strings from `file://` URL imports, making the cache-busting approach in the plan non-functional for hub.js.
- **Fix:** Wrapped `main()` in `if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1])` guard. Rewrote hub.test.js to use direct static import instead of dynamic re-import.
- **Files modified:** plugins/arcanon/worker/cli/hub.js, plugins/arcanon/worker/cli/hub.test.js
- **Verification:** `node --test plugins/arcanon/worker/cli/hub.test.js` passes; hub.js still works as CLI entry point
- **Committed in:** 6dbd9b9 (Task 3 commit)

---

**Total deviations:** 1 auto-fixed (Rule 1 bug)
**Impact on plan:** Fix required for tests to work. The main() guard is also an improvement — hub.js can now be safely imported as a library module by other JS consumers.

## Confirmation: No 97-01 / 97-02 overlap

Files owned by Plans 97-01 and 97-02 not touched:
- commands/cross-impact.md, commands/sync.md, commands/upload.md (97-02)
- session-start.sh, README.md, docs/commands.md (97-01)
- tests/commands-surface.bats (97-02)
- tests/structure.bats, tests/session-start.bats (97-01)

## Task Commits

1. **Task 1: Rename auto_upload → auto_sync in plugin.json** - `501766f` (feat)
2. **Task 2: Two-read pattern + deprecation warning in hub.js and manager.js** - `14e42b1` (feat)
3. **Task 3: Unit tests + main() guard fix** - `6dbd9b9` (test)
4. **Task 4: Update status.md and login.md doc text** - `565f741` (docs)

## Issues Encountered

None beyond the auto-fixed deviation above.

## Next Phase Readiness

- CLN-06, CLN-07, CLN-08 complete
- Hub sync config rename is fully backward-compatible for one release
- Ready for v0.2.0 cleanup: drop `_readHubAutoSync` legacy fallback branch and the `_autoUploadDeprecationWarned` guard

---
*Phase: 97-command-cleanup*
*Completed: 2026-04-19*
