---
phase: 76-discovery-phase-wiring
plan: 01
subsystem: scan
tags: [discovery, two-phase-scan, agent-runner, ephemeral-context, SARC-01]

# Dependency graph
requires: []
provides:
  - "runDiscoveryPass(repoPath, template, runner, slog) exported from manager.js"
  - "Two-phase scan loop: discovery (Phase 1) before deep scan (Phase 2) in scanRepos"
  - "{{DISCOVERY_JSON}} populated in agent-prompt-deep.md from Phase 1 output"
  - "Discovery failure fallback to empty context (deep scan always continues)"
  - "Structured 'discovery pass complete' log entry with languages, frameworks, service_hints"
affects:
  - "77-discovery-cleanup (SARC-03) — type-specific prompts now dead code, safe to remove"
  - "78-scan-reliability (SREL-02) — discovery agent now in critical path, timeout hardening needed"

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Two-phase agent invocation: discovery (structure) then deep scan (code analysis)"
    - "Ephemeral context: discovery output is a loop-local const, never written to DB"
    - "Extracted testable function pattern: runDiscoveryPass matches buildIncrementalConstraint"
    - "Discovery fallback: try/catch returns {} — deep scan never aborted by discovery failure"
    - "Prompt dispatch: agent-prompt-deep.md now the active deep-scan template for all repo types"

key-files:
  created: []
  modified:
    - plugins/ligamen/worker/scan/manager.js
    - plugins/ligamen/worker/scan/manager.test.js

key-decisions:
  - "promptDeep (agent-prompt-deep.md) used for all deep scans — type-specific prompts not used (SARC-03 Phase 77 cleanup)"
  - "beginScan bracket opens AFTER discovery completes — no orphaned scan_versions rows if discovery fails"
  - "Discovery output never persisted — ephemeral const in loop body (locked decision from STATE.md)"
  - "Existing tests updated for two-call pattern (discovery + deep scan per repo)"

patterns-established:
  - "Discovery mock pattern: check prompt for 'Discovery Agent' or 'structure discovery', return minimal discovery JSON"
  - "Two-call count assertion: expect 2N calls for N repos (N discovery + N deep scan)"

requirements-completed: [SARC-01]

# Metrics
duration: 4min
completed: 2026-03-22
---

# Phase 76 Plan 01: Discovery Phase Wiring Summary

**Two-phase scan wired into manager.js: discovery agent (Phase 1) injects structured language/framework context as {{DISCOVERY_JSON}} into agent-prompt-deep.md before each deep scan (Phase 2)**

## Performance

- **Duration:** 4 min
- **Started:** 2026-03-22T17:55:43Z
- **Completed:** 2026-03-22T18:00:19Z
- **Tasks:** 2
- **Files modified:** 2

## Accomplishments

- Exported `runDiscoveryPass` — extracts fenced JSON from discovery agent output, returns `{}` on any failure, emits structured log entry on success
- Wired two-phase loop in `scanRepos`: discovery runs before `beginScan`, populates `{{DISCOVERY_JSON}}` in `promptDeep`, deep scan proceeds regardless of discovery outcome
- 11 new tests covering: two-call flow, discovery fallback, log entry, placeholder replacement, `runDiscoveryPass` unit behavior (valid JSON, no-block, agent-throw, interpolation, log emissions)
- Updated 2 existing tests for the new two-call-per-repo pattern (error isolation, sequential order)
- All 93 tests pass across `manager.test.js`, `findings.test.js`, `enrichment.test.js`

## Task Commits

Each task was committed atomically:

1. **Task 1: Add runDiscoveryPass and wire two-phase scan loop** - `a71d3d5` (feat)
2. **Task 2: Add discovery wiring tests** - `a07e33f` (test)

_Note: TDD tasks — implementation and tests committed together per task_

## Files Created/Modified

- `plugins/ligamen/worker/scan/manager.js` — Added `runDiscoveryPass` export + two-phase scan wiring in `scanRepos`; `promptDiscovery` loaded alongside other prompts; `promptDeep` now active deep-scan template
- `plugins/ligamen/worker/scan/manager.test.js` — Added `describe("scanRepos — discovery wiring")` (4 tests) and `describe("runDiscoveryPass")` (7 tests); updated `makeQueryEngine` with `_db` mock; updated existing tests for two-call pattern

## Decisions Made

- `agent-prompt-deep.md` (`promptDeep`) is now the active deep-scan template for all repo types — the type-specific prompts (`promptService`, `promptLibrary`, `promptInfra`) remain loaded but unused (SARC-03 Phase 77 handles cleanup, per plan constraint)
- `beginScan` bracket opens AFTER `runDiscoveryPass` completes — ensures no orphaned open scan version rows if discovery hangs or fails
- Discovery output is a `const discoveryContext` local to the loop body — `JSON.stringify`'d into the prompt, never passed to any `queryEngine` or `_db` method (ephemeral by construction)

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Updated existing tests to handle two-call pattern**
- **Found during:** Task 1 (implementation) — existing tests broke because discovery adds a second `agentRunner` call per repo
- **Issue:** "error isolation: bad agent output for repo 1" expected `callCount === 2` but got 4 (2 repos × 2 calls). "agents run sequentially" test got `["svc-a", "svc-a", "svc-b", "svc-b"]` instead of `["svc-a", "svc-b"]`
- **Fix:** Updated both test mocks to detect discovery calls by prompt content (`prompt.includes('Discovery Agent') || prompt.includes('structure discovery')`) and return minimal discovery JSON; updated `callCount` assertion from 2 to 4; deep scan order tracking excludes discovery calls
- **Files modified:** `plugins/ligamen/worker/scan/manager.test.js`
- **Verification:** All 44 tests pass after fix
- **Committed in:** `a71d3d5` (Task 1 commit, as planned in RESEARCH pitfall 4)

---

**Total deviations:** 1 auto-fixed (Rule 1 bug — existing test count assertion broke predictably from two-call pattern; documented as Pitfall 4 in RESEARCH.md)
**Impact on plan:** Required fix, expected outcome. No scope creep.

## Issues Encountered

None — the RESEARCH.md accurately predicted all pitfalls. Pitfall 4 (existing test count assertions) was documented and resolved in-task.

## User Setup Required

None — no external service configuration required.

## Next Phase Readiness

- SARC-01 complete: discovery agent wired, {{DISCOVERY_JSON}} populated, ephemeral context enforced
- Phase 77 (SARC-03): type-specific prompts (`promptService`, `promptLibrary`, `promptInfra`) and dead-code cleanup safe to proceed — they are loaded but no longer used in the deep-scan interpolation path
- Phase 78 (SREL-02 / scan reliability): discovery is now in the critical scan path; timeout handling for hung discovery agent should be addressed next

## Self-Check: PASSED

- FOUND: `plugins/ligamen/worker/scan/manager.js`
- FOUND: `plugins/ligamen/worker/scan/manager.test.js`
- FOUND: `.planning/phases/76-discovery-phase-wiring/76-01-SUMMARY.md`
- FOUND commit: `a71d3d5` (Task 1)
- FOUND commit: `a07e33f` (Task 2)

---
*Phase: 76-discovery-phase-wiring*
*Completed: 2026-03-22*
