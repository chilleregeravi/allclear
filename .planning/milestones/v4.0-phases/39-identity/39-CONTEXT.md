# Phase 39: Identity - Context

**Gathered:** 2026-03-19
**Status:** Ready for planning

<domain>
## Phase Boundary

Rename the plugin's core identity artifacts from "allclear" to "ligamen": package.json, plugin.json, marketplace.json, Makefile, and config filename.

</domain>

<decisions>
## Implementation Decisions

### Claude's Discretion
All implementation choices are at Claude's discretion — pure infrastructure phase.

</decisions>

<code_context>
## Existing Code Insights

### Reusable Assets
- package.json: `@allclear/cli` with binary `allclear-init`
- .claude-plugin/plugin.json: `"name": "allclear"`
- .claude-plugin/marketplace.json: plugin marketplace reference
- Makefile: `PLUGIN_NAME := allclear`
- allclear.config.json.example: example config file

### Established Patterns
- Plugin follows Claude Code plugin conventions (commands/, skills/, hooks.json)
- Config file referenced in lib/config.sh, worker/db/database.js, worker/scan/discovery.js

### Integration Points
- Config filename referenced across ~10 files in lib/, worker/, tests/, docs/

</code_context>

<specifics>
## Specific Ideas

No specific requirements — infrastructure phase.

</specifics>

<deferred>
## Deferred Ideas

None — discussion stayed within phase scope.

</deferred>
