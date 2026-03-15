---
phase: 18-agent-scanning
plan: 02
subsystem: scanning
tags: [agent-scanning, scan-manager, incremental-scan, git-diff, repo-state, tdd, node-test]

# Dependency graph
requires:
  - phase: 18-01
    provides: worker/findings-schema.js with parseAgentOutput() and validateFindings()
  - phase: 14-storage-foundation
    provides: SQLite schema with repos/repo_state tables and QueryEngine write helpers
provides:
  - worker/scan-manager.js — scanRepos(), getChangedFiles(), buildScanContext(), setAgentRunner()
affects: [Phase 19 confirmation flow — scanRepos() returns ScanResult[] ready for confirmation]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "git diff --name-status (not --name-only) to capture deletions and renames in incremental scans"
    - "agentRunner injection pattern: setAgentRunner(fn) decouples Node.js module from Claude Task tool"
    - "Sequential for...of over repos — never Promise.all (foreground-only requirement per issue #13254)"
    - "Per-repo error isolation: one bad agent response pushes { findings: null, error } without halting others"
    - "TDD: RED commit (test file) then GREEN commit (implementation + test fix)"

key-files:
  created:
    - worker/scan-manager.js
    - worker/scan-manager.test.js
  modified:
    - worker/query-engine.js

key-decisions:
  - "getChangedFiles uses git ls-files (not diff) for sinceCommit=null — returns all tracked files as modified for full scan"
  - "Rename detection: baseCommit must be captured AFTER the file-to-rename is committed; capturing before yields 'A new.txt' not 'R old.txt -> new.txt'"
  - "agentRunner injection pattern chosen over dynamic import — enables test mocking and MCP server injection without module-level side effects"
  - "query-engine.js augmented with getRepoState/setRepoState/getRepoByPath — plan's interface contract was not yet implemented (Rule 3 auto-fix)"

# Metrics
duration: 3.5min
completed: 2026-03-15
---

# Phase 18 Plan 02: Scan Manager Summary

**Scan orchestration engine that determines incremental vs full scan scope, dispatches agents sequentially via an injectable runner, validates every response through parseAgentOutput(), and updates repo_state on success.**

## Performance

- **Duration:** ~3.5 min
- **Started:** 2026-03-15T19:21:15Z
- **Completed:** 2026-03-15T19:24:43Z
- **Tasks:** 2
- **Files modified:** 3

## Accomplishments

- `getChangedFiles(repoPath, sinceCommit)` — uses `git diff --name-status` to capture modified, deleted, and renamed files; falls back to `git ls-files` when sinceCommit is null (full scan); returns `{ error }` for non-git directories
- `buildScanContext(repoPath, repoId, queryEngine, options)` — returns `mode: 'full'` for explicit `--full` flag or missing repo_state (first scan auto-full per SCAN-06); `mode: 'skip'` when HEAD matches last_scanned_commit (SCAN-05); `mode: 'incremental'` with changed-file list otherwise
- `scanRepos(repoPaths, options, queryEngine)` — sequential for...of dispatch (never Promise.all per issue #13254), prompt interpolation from `worker/agent-prompt.md`, `parseAgentOutput()` validation gate before accepting any findings, `setRepoState` on success, per-repo error isolation
- `setAgentRunner(fn)` — injection point for real Claude Task invoker (MCP server) or mock (tests); throws if not set before `scanRepos`
- 14 unit tests passing via `node:test` — real temp git repos (no mocking of git), mock agentRunner for controlled agent output

## Task Commits

1. **Task 1 TDD RED** — `f52e15d` (test) — failing tests for getChangedFiles, buildScanContext, scanRepos + query-engine augmentation
2. **Task 1 + 2 TDD GREEN** — `0df21ee` (feat) — scan-manager.js implementation, all 14 tests passing

## Files Created/Modified

- `worker/scan-manager.js` — full implementation: getChangedFiles, buildScanContext, scanRepos, setAgentRunner, getCurrentHead
- `worker/scan-manager.test.js` — 14 tests covering all plan behavior specs with real temp git repos
- `worker/query-engine.js` — added getRepoState(), setRepoState(), getRepoByPath() methods + prepared statements (Rule 3 auto-fix)

## Decisions Made

- `git diff --name-status` (not `--name-only`) used to capture deletions (D lines) and renames (R100 lines) — prevents rename blindness where a renamed file would appear as deleted+added without the from/to link
- Rename detection test: baseCommit must be captured **after** `old.txt` is committed, not before. When base is before the file exists, git sees the diff as `A new.txt` (net add) rather than `R old.txt -> new.txt`. Fixed in GREEN pass.
- agentRunner injection over dynamic `require`/`import` — the Claude `Task` tool is not a Node.js API, so the scan-manager exports a setter that the MCP server calls at startup with the real invoker
- query-engine.js lacked `getRepoState`, `setRepoState`, `getRepoByPath` which the plan's interface contract required — auto-added as Rule 3 fix (blocking issue); methods added with prepared statements

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Missing query-engine methods required by scan-manager interface**
- **Found during:** Task 1 (reading query-engine.js to understand actual interface)
- **Issue:** Plan interface contract listed `getRepoState(repoId)`, `setRepoState(repoId, commit)`, `getRepoByPath(repoPath)` as expected query-engine exports. These did not exist — only `updateRepoState()` and `upsertRepo(repoData)` were present.
- **Fix:** Added three methods + two prepared SQL statements to QueryEngine class in `worker/query-engine.js`. `setRepoState` is an alias for `updateRepoState` for naming consistency. `getRepoByPath` uses a new `SELECT id, path, name FROM repos WHERE path = ?` prepared statement.
- **Files modified:** `worker/query-engine.js`
- **Commit:** `f52e15d` (included with RED test commit)

**2. [Rule 1 - Bug] Rename test captured baseCommit before file-to-rename existed**
- **Found during:** Task 1 GREEN pass (test failure)
- **Issue:** The rename test grabbed `git rev-parse HEAD` before adding `old.txt`. Git diff across that range shows `A new.txt` not `R100\told.txt\tnew.txt` because there's no deletion to pair the add with.
- **Fix:** Reordered test to commit `old.txt` first, then capture baseCommit, then rename. This matches how git rename detection actually works.
- **Files modified:** `worker/scan-manager.test.js`
- **Commit:** `0df21ee`

## Self-Check: PASSED

- worker/scan-manager.js: FOUND
- worker/scan-manager.test.js: FOUND
- worker/query-engine.js (modified): FOUND
- All 14 tests: PASS
- exports: function function function function
- imports ok (scan-manager + findings-schema cross-import)
- Commit f52e15d: FOUND
- Commit 0df21ee: FOUND

---
*Phase: 18-agent-scanning*
*Completed: 2026-03-15*
