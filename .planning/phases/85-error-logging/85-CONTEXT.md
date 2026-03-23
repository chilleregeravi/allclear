# Phase 85: Error Logging - Context

**Gathered:** 2026-03-23
**Status:** Ready for planning

<domain>
## Phase Boundary

Add structured error logging with stack traces to HTTP route handlers, MCP tool handlers, and all error log call sites. Three requirements: ERR-01 (HTTP errors), ERR-02 (MCP errors), LOG-03 (err.stack everywhere).

</domain>

<decisions>
## Implementation Decisions

### Claude's Discretion
All implementation choices are at Claude's discretion.

Key constraints:
- ERR-01: Every catch block in `worker/server/http.js` that returns a 500 should also call `logger.error()` with message + stack. The HTTP server already has `logger` available via options.
- ERR-02: Every catch block in `worker/mcp/server.js` that returns error status should also call `logger.error()` with message + stack.
- LOG-03: Audit all `logger.error()` calls across the codebase. Anywhere `err.message` is logged, add `err.stack` as an extra field. Pattern: `logger.error('msg', { error: err.message, stack: err.stack })`.

</decisions>

<code_context>
## Existing Code Insights

### Target Files
- `plugins/ligamen/worker/server/http.js` — HTTP route handlers with catch blocks
- `plugins/ligamen/worker/mcp/server.js` — MCP tool handlers with catch blocks
- Any file with `logger.error` calls that only log `err.message`

### Current Pattern (broken)
```javascript
catch (err) { return reply.code(500).send({ error: err.message }); }
// No logger.error call — error context lost
```

### Desired Pattern
```javascript
catch (err) {
  logger.error('route-name failed', { error: err.message, stack: err.stack });
  return reply.code(500).send({ error: err.message });
}
```

</code_context>

<specifics>
No specific requirements.
</specifics>

<deferred>
None.
</deferred>
