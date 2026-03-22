# Phase 81: Data Integrity Port - Context

**Gathered:** 2026-03-22
**Status:** Ready for planning

<domain>
## Phase Boundary

Port four already-fixed bugs from the plugin cache (`~/.claude/plugins/cache/ligamen/ligamen/5.4.0/`) to the source repo (`plugins/ligamen/`). Each fix was validated with regression tests during this session. This is a code port, not new implementation.

</domain>

<decisions>
## Implementation Decisions

### Claude's Discretion
All implementation choices are at Claude's discretion — pure infrastructure phase (code port).

Key context for each fix:

**DINT-01 (endScan FK cleanup):** In `worker/db/query-engine.js` lines 713-726, the schema pre-cleanup query used `WHERE scan_version_id = ? OR scan_version_id IS NULL` which kept schemas for null-versioned connections alive. But lines 733-734 then deleted those null connections, causing FK violations. Fix: Remove `OR scan_version_id IS NULL` from the filter. Regression test: Test B2 in `query-engine-upsert.test.js`.

**DINT-02 (upsertRepo ID):** In `query-engine.js` `upsertRepo()`, `lastInsertRowid` returns 0 on `ON CONFLICT DO UPDATE`. Fix: Query `SELECT id FROM repos WHERE path = ?` after upsert instead of relying on `lastInsertRowid`. Regression test: Test 6 in `query-engine-upsert.test.js`.

**DINT-03 (test view mismatch):** In `query-engine-mcp-enrichment.test.js`, `seedMeta()` used `view = "scan"` but production queries filter on `('enrichment', 'security', 'infra', 'ownership')`. Fix: Use `KEY_TO_VIEW` mapping (owner→ownership, auth_mechanism→security, db_backend→infra). Also fix inline insert in `query-engine-graph.test.js` from `"scan"` to `"ownership"`.

**DINT-04 (worker version restart):** In `scripts/session-start.sh`, the "worker already running" branch (lines 55-59) just read the status line without checking versions. Fix: Add version mismatch check using `CLAUDE_PLUGIN_ROOT/package.json` vs worker `/api/version`, and stop+restart on mismatch.

</decisions>

<code_context>
## Existing Code Insights

### Source of Truth (already-fixed files in plugin cache)
- `~/.claude/plugins/cache/ligamen/ligamen/5.4.0/worker/db/query-engine.js` — DINT-01 + DINT-02 fixes applied
- `~/.claude/plugins/cache/ligamen/ligamen/5.4.0/worker/db/query-engine-upsert.test.js` — Test B2 + Test 6 added
- `~/.claude/plugins/cache/ligamen/ligamen/5.4.0/worker/db/query-engine-mcp-enrichment.test.js` — seedMeta fix
- `~/.claude/plugins/cache/ligamen/ligamen/5.4.0/worker/db/query-engine-graph.test.js` — view name fix
- `~/.claude/plugins/cache/ligamen/ligamen/5.4.0/scripts/session-start.sh` — INTG-02 version check

### Target Files (source repo)
- `plugins/ligamen/worker/db/query-engine.js`
- `plugins/ligamen/worker/db/query-engine-upsert.test.js`
- `plugins/ligamen/worker/db/query-engine-mcp-enrichment.test.js`
- `plugins/ligamen/worker/db/query-engine-graph.test.js`
- `plugins/ligamen/scripts/session-start.sh`

### Integration Points
- All test files must pass after port: `node --test worker/db/query-engine*.test.js`

</code_context>

<specifics>
## Specific Ideas

The fixes should be exact ports of the changes already applied to the plugin cache. Diff the cache files against source to identify exact changes needed.

</specifics>

<deferred>
## Deferred Ideas

None — discussion stayed within phase scope.

</deferred>
