# Phase 40: Environment & Paths - Context

**Gathered:** 2026-03-19
**Status:** Ready for planning

<domain>
## Phase Boundary

Rename all ALLCLEAR_* environment variables to LIGAMEN_*, change data directory from ~/.allclear/ to ~/.ligamen/, and update temp file paths from /tmp/allclear_* to /tmp/ligamen_*.

</domain>

<decisions>
## Implementation Decisions

### Claude's Discretion
All implementation choices are at Claude's discretion — pure infrastructure phase.

</decisions>

<code_context>
## Existing Code Insights

### Reusable Assets
- lib/config.sh: central env var definitions
- scripts/worker-start.sh, worker-stop.sh: ALLCLEAR_WORKER_PORT, ALLCLEAR_DATA_DIR
- worker/db/database.js, pool.js, index.js: ~/.allclear/ path references

### Established Patterns
- 20+ ALLCLEAR_* environment variables across ~10 script files
- Data directory pattern: ~/.allclear/projects/<hash>/

### Integration Points
- lib/worker-client.sh reads ALLCLEAR_WORKER_PORT
- worker/index.js resolves ALLCLEAR_DATA_DIR at startup
- Tests reference /tmp/allclear_* for temp directories

</code_context>

<specifics>
## Specific Ideas

No specific requirements — infrastructure phase.

</specifics>

<deferred>
## Deferred Ideas

None — discussion stayed within phase scope.

</deferred>
