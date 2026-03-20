# Phase 44: Documentation - Context

**Gathered:** 2026-03-19
**Status:** Ready for planning

<domain>
## Phase Boundary

Update README.md, all docs/ files, and planning docs to consistently use "Ligamen" as the product name with correct install instructions and command references.

</domain>

<decisions>
## Implementation Decisions

### Claude's Discretion
All implementation choices are at Claude's discretion — pure infrastructure phase.

</decisions>

<code_context>
## Existing Code Insights

### Reusable Assets
- README.md: ~30+ "allclear"/"AllClear" references
- docs/commands.md, configuration.md, hooks.md, architecture.md, service-map.md, development.md
- .planning/PROJECT.md, MILESTONES.md, ROADMAP.md

### Established Patterns
- README uses "AllClear" as product name, @allclear/cli as package name
- Docs reference /allclear:* commands and allclear.config.json

### Integration Points
- Install instructions reference git clone URL and npm package name
- Configuration docs reference allclear.config.json

</code_context>

<specifics>
## Specific Ideas

No specific requirements — infrastructure phase.

</specifics>

<deferred>
## Deferred Ideas

None — discussion stayed within phase scope.

</deferred>
