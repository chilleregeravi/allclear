# Phase 43: Tests - Context

**Gathered:** 2026-03-19
**Status:** Ready for planning

<domain>
## Phase Boundary

Update all bats test files, JavaScript test files, and test fixtures to use ligamen naming for env vars, config filenames, temp paths, and assertion strings.

</domain>

<decisions>
## Implementation Decisions

### Claude's Discretion
All implementation choices are at Claude's discretion — pure infrastructure phase.

</decisions>

<code_context>
## Existing Code Insights

### Reusable Assets
- tests/*.bats: 10+ bats test files
- tests/storage/*.test.js, tests/worker/*.test.js: JS test files
- worker/db/*.test.js, worker/scan/*.test.js, worker/server/*.test.js: worker tests
- tests/fixtures/config/: mock configs and allclear.config.json fixture

### Established Patterns
- Bats tests use ALLCLEAR_* env vars and /tmp/allclear_* temp paths
- JS tests use "allclear-test-" temp directory prefix
- session-start.bats asserts "AllClear active." and /allclear:* commands

### Integration Points
- Test fixtures must match renamed config filename (ligamen.config.json)
- Assertion strings must match renamed output messages

</code_context>

<specifics>
## Specific Ideas

No specific requirements — infrastructure phase.

</specifics>

<deferred>
## Deferred Ideas

None — discussion stayed within phase scope.

</deferred>
