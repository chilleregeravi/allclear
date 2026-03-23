# Phase 86: Scan Observability - Context

**Gathered:** 2026-03-23
**Status:** Ready for planning

<domain>
## Phase Boundary

Add scan lifecycle logging to the scan manager and wire the auth-db extractor logger. Three requirements: SCAN-01 (BEGIN/END events), SCAN-02 (per-repo progress), SCAN-03 (setExtractorLogger wiring).

</domain>

<decisions>
## Implementation Decisions

### Claude's Discretion
All implementation choices are at Claude's discretion.

Key constraints:
- SCAN-01: Log BEGIN event at start of `scanRepos()` with repo count and scan mode (full/incremental). Log END event after all repos complete with total services found, connections found, and wall-clock duration (`Date.now()` diff).
- SCAN-02: Per-repo, log 3 progress lines: (1) discovery done with detected languages/frameworks, (2) deep scan done with service/connection counts, (3) enrichment done with enrichers applied. Use the scan logger (`slog`) already available in manager.js.
- SCAN-03: Call `setExtractorLogger(logger)` from `worker/index.js` alongside the existing `setScanLogger(logger)` call. Import from auth-db-extractor.js.

Verbosity target: ~6 lines per repo (moderate).

</decisions>

<code_context>
## Existing Code Insights

### Target Files
- `plugins/ligamen/worker/scan/manager.js` — scanRepos() and per-repo loop
- `plugins/ligamen/worker/index.js` — logger creation and setScanLogger call

### Existing Logger Infrastructure in manager.js
- `let _logger = null;`
- `export function setScanLogger(logger) { _logger = logger; }`
- `function slog(level, msg, extra)` — wrapper that calls `_logger?.[level]?.(msg, extra)`
- slog is already used for warnings in the scan flow

### setExtractorLogger Gap
- `worker/scan/enrichment/auth-db-extractor.js` exports `setExtractorLogger(logger)`
- NOT imported or called anywhere in production code
- `worker/index.js:55` has `setScanLogger(logger)` — add `setExtractorLogger(logger)` alongside

</code_context>

<specifics>
No specific requirements.
</specifics>

<deferred>
None.
</deferred>
