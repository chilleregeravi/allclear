# Phase 41: Commands & MCP - Context

**Gathered:** 2026-03-19
**Status:** Ready for planning

<domain>
## Phase Boundary

Rename all 6 slash commands from /allclear:* to /ligamen:*, MCP server from allclear-impact to ligamen-impact, ChromaDB collection name, and skill descriptions.

</domain>

<decisions>
## Implementation Decisions

### Claude's Discretion
All implementation choices are at Claude's discretion — pure infrastructure phase.

</decisions>

<code_context>
## Existing Code Insights

### Reusable Assets
- commands/: 6 .md files (quality-gate, map, cross-impact, drift, pulse, deploy-verify)
- skills/: quality-gate/SKILL.md, impact/SKILL.md
- .mcp.json: "allclear-impact" server definition
- worker/mcp/server.js: MCP server name registration
- worker/server/chroma.js: collection name "allclear-impact"

### Established Patterns
- Commands use (plugin:allclear) namespacing
- Skills reference /allclear:* in descriptions

### Integration Points
- Session start hook outputs command names for context
- MCP server name used in .mcp.json and server.js

</code_context>

<specifics>
## Specific Ideas

No specific requirements — infrastructure phase.

</specifics>

<deferred>
## Deferred Ideas

None — discussion stayed within phase scope.

</deferred>
