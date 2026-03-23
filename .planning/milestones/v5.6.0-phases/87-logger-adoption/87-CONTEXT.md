# Phase 87: Logger Adoption - Context

**Gathered:** 2026-03-23
**Status:** Ready for planning

<domain>
## Phase Boundary

QueryEngine accepts optional injected logger to replace console.warn for cross-repo name collision warnings. One requirement: ADOPT-01.

</domain>

<decisions>
## Implementation Decisions

### Claude's Discretion
All implementation choices are at Claude's discretion.

Key constraints:
- ADOPT-01: Add optional `logger` parameter to QueryEngine constructor. Store as `this._logger`. At line 1257 (cross-repo name collision warning), use `this._logger?.warn?.(msg) ?? console.warn(msg)`.
- Backward compatible: if no logger passed, falls back to console.warn — no TypeError.
- Callers that create QueryEngine instances (pool.js, test files) should pass their available logger where possible.

</decisions>

<code_context>
## Existing Code Insights

### Target Files
- `plugins/ligamen/worker/db/query-engine.js` — constructor + line 1257
- `plugins/ligamen/worker/db/pool.js` — creates QueryEngine instances, has access to logger

### Current Code (line 1257)
```javascript
console.warn(`[persistFindings] ambiguous service name "${name}" ...`);
```

### Desired Code
```javascript
(this._logger?.warn ?? console.warn)(`[persistFindings] ambiguous service name "${name}" ...`);
```

</code_context>

<specifics>
No specific requirements.
</specifics>

<deferred>
None.
</deferred>
