# Phase 84: Logger Infrastructure - Context

**Gathered:** 2026-03-23
**Status:** Ready for planning

<domain>
## Phase Boundary

Add size-based log rotation and TTY-aware stderr suppression to `plugins/ligamen/worker/lib/logger.js`. Two requirements: LOG-01 (rotation) and LOG-02 (stderr dedup).

</domain>

<decisions>
## Implementation Decisions

### Claude's Discretion
All implementation choices are at Claude's discretion — infrastructure phase.

Key constraints from discussion:

- LOG-01: Size-based rotation at 10MB, keep 3 old files (worker.log.1, .2, .3). Self-implemented (no external deps). Check file size before each write — if over threshold, rename current → .1, .1 → .2, .2 → .3, delete .4+. Use `fs.statSync` + `fs.renameSync`.
- LOG-02: Logger should skip `process.stderr.write()` when no TTY is attached (daemon mode). Use `process.stderr.isTTY` to detect. When running under nohup, stderr goes to the same log file — causing duplicates. In daemon mode, only write to the log file via `appendFileSync`.

Key implementation detail: The current logger at `worker/lib/logger.js` writes every log line via both `fs.appendFileSync(logPath, line)` and `process.stderr.write(line)`. The rotation check and stderr suppression both happen in the `log()` method.

</decisions>

<code_context>
## Existing Code Insights

### Target File
- `plugins/ligamen/worker/lib/logger.js` — the only file being modified

### Current Implementation
- `createLogger({ dataDir, port, logLevel, component })` factory
- Returns `{ log, info, warn, error, debug }`
- `log(level, msg, extra)` does:
  1. Check level threshold
  2. Build JSON line with ts, level, msg, pid, port, component, ...extra
  3. `fs.appendFileSync(logPath, line + '\n')`
  4. `process.stderr.write(line + '\n')`
- Log path: `${dataDir}/logs/worker.log`

### Stderr Duplication Bug
- `worker-start.sh:97`: `nohup node ... >>"${DATA_DIR}/logs/worker.log" 2>&1 &`
- This captures stderr (which logger also writes to) into the same file
- Result: every log line appears twice in worker.log

</code_context>

<specifics>
## Specific Ideas

No specific requirements — infrastructure phase.

</specifics>

<deferred>
## Deferred Ideas

None.

</deferred>
