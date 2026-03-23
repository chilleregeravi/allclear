# Phase 89: Crossing Semantics - Context

**Gathered:** 2026-03-23
**Status:** Ready for planning

<domain>
## Phase Boundary

Redefine crossing field semantics in agent scan prompts and add post-scan reconciliation to map.md. Three requirements: CROSS-01 (three-value crossing), CROSS-02 (examples completeness), CROSS-03 (reconciliation step).

Linear issue: THE-949

</domain>

<decisions>
## Implementation Decisions

### Claude's Discretion
All implementation choices are at Claude's discretion.

Key constraints from THE-949:

- CROSS-01: Redefine crossing in agent-prompt-common.md and all type-specific prompts:
  - `external` — target is NOT a service in any linked repo (third-party APIs, SaaS, truly unknown)
  - `cross-service` — target is a different service (regardless of repo)
  - `internal` — within the same deployable unit only

- CROSS-02: Every example connection in prompt files must include `crossing` field. Currently the REST example in agent-prompt-service.md omits it.

- CROSS-03: Add reconciliation step to map.md between Step 2 (scan) and Step 3 (confirm):
  1. Collect all discovered service names across all repos
  2. For connections where both source and target resolve to known services, downgrade `external` → `cross-service`
  3. This is a safety net even if agents misclassify

</decisions>

<code_context>
## Existing Code Insights

### Target Files
- `plugins/ligamen/worker/scan/agent-prompt-common.md` — crossing definition
- `plugins/ligamen/worker/scan/agent-prompt-service.md` — service prompt with examples
- `plugins/ligamen/worker/scan/agent-prompt-library.md` — library prompt with examples
- `plugins/ligamen/worker/scan/agent-prompt-infra.md` — infra prompt (if has examples)
- `plugins/ligamen/commands/map.md` — add reconciliation step

### Current Crossing Definition
In agent-prompt-service.md line 94: `"crossing": "external"` — only one example, only one value shown.
In agent-prompt-common.md: no explicit crossing definition (only scope rule mentions "external service").

</code_context>

<specifics>
No specific requirements.
</specifics>

<deferred>
None.
</deferred>
