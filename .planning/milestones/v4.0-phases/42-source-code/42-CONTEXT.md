# Phase 42: Source Code - Context

**Gathered:** 2026-03-19
**Status:** Ready for planning

<domain>
## Phase Boundary

Update all shell script and JavaScript source file comment headers, output messages, and internal references from "AllClear"/"allclear" to "Ligamen"/"ligamen".

</domain>

<decisions>
## Implementation Decisions

### Claude's Discretion
All implementation choices are at Claude's discretion — pure infrastructure phase.

</decisions>

<code_context>
## Existing Code Insights

### Reusable Assets
- 13 shell scripts in scripts/ and lib/
- 15+ JavaScript files in worker/ subdirectories
- Agent prompt files in worker/scan/

### Established Patterns
- Shell scripts have "AllClear" in comment headers and stdout messages
- JS files have "allclear" in file headers and log messages
- Session start hook outputs "AllClear active."

### Integration Points
- scripts/session-start.sh: CONTEXT="AllClear active."
- scripts/lint.sh: "AllClear lint" output
- scripts/format.sh: "AllClear: Auto-format hook" output
- scripts/file-guard.sh: "AllClear:" prefix in messages

</code_context>

<specifics>
## Specific Ideas

No specific requirements — infrastructure phase.

</specifics>

<deferred>
## Deferred Ideas

None — discussion stayed within phase scope.

</deferred>
