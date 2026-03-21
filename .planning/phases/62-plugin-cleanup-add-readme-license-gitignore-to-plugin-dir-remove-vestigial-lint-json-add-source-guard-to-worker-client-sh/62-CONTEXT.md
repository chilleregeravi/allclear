# Phase 62: Plugin Cleanup - Context

**Gathered:** 2026-03-21
**Status:** Ready for planning

<domain>
## Phase Boundary

Fix 5 warnings from plugin validation review: add README.md, LICENSE, .gitignore to plugin directory; remove vestigial hooks/lint.json; add source-execution guard to lib/worker-client.sh. Pure file operations, no behavior changes.

</domain>

<decisions>
## Implementation Decisions

### README.md
- Brief overview (~50 lines), not full standalone docs
- What the plugin does, available commands list, link to repo README for details
- Include environment variables table (LIGAMEN_DISABLE_GUARD, LIGAMEN_DISABLE_LINT, LIGAMEN_DISABLE_FORMAT, LIGAMEN_EXTRA_BLOCKED)
- Mention MCP server and worker setup briefly

### LICENSE
- Copy repo root LICENSE (AGPL-3.0-only) into plugin directory
- Exact copy, not symlink (marketplace installs extract plugin subtree)

### .gitignore
- Cover: node_modules/, *.log, .npm-install.log
- Plugin-specific, not a copy of repo root .gitignore

### hooks/lint.json removal
- Delete the file — it's vestigial, uses old hook format, missing MultiEdit matcher
- hooks.json is the authoritative hook config

### lib/worker-client.sh source guard
- Add the same pattern used by detect.sh, linked-repos.sh, config.sh
- Prevent direct execution when script is meant to be sourced

### Claude's Discretion
- Exact README structure and wording
- .gitignore additional entries beyond the three listed

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Files to modify/create
- `plugins/ligamen/lib/worker-client.sh` — needs source-execution guard added
- `plugins/ligamen/hooks/lint.json` — delete this file

### Reference patterns
- `plugins/ligamen/lib/detect.sh` — has source-execution guard pattern to replicate
- `LICENSE` (repo root) — content to copy into plugin directory
- `README.md` (repo root) — reference for plugin README content

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- Source guard pattern from detect.sh: `if [[ "${BASH_SOURCE[0]}" == "${0}" ]]; then echo "..."; exit 1; fi`
- Repo root LICENSE is AGPL-3.0-only full text

### Established Patterns
- All lib/*.sh files have source guards except worker-client.sh
- Plugin uses AGPL-3.0-only license declared in plugin.json

### Integration Points
- No integration needed — these are standalone file additions/edits

</code_context>

<specifics>
## Specific Ideas

No specific requirements — standard cleanup work

</specifics>

<deferred>
## Deferred Ideas

None — discussion stayed within phase scope

</deferred>

---

*Phase: 62-plugin-cleanup*
*Context gathered: 2026-03-21*
