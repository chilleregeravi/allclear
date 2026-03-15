---
phase: 06-session-hook
plan: 01
subsystem: hooks
tags: [bash, jq, hooks, session, claude-code, deduplication, context-injection]

# Dependency graph
requires:
  - phase: 02-shared-libraries
    provides: lib/detect.sh with detect_project_type function
provides:
  - scripts/session-start.sh — session context injection hook for SessionStart and UserPromptSubmit
  - hooks/hooks.json — dual-event hook registration with CLAUDE_PLUGIN_ROOT paths
  - lib/detect.sh — project type detection (already provided by Phase 2; used as-is)
affects: [all phases that test the full hook pipeline, 13-tests]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Session tmpfile deduplication: /tmp/allclear_session_${SESSION_ID}.initialized prevents double injection"
    - "Dual-event registration: same script handles both SessionStart and UserPromptSubmit via dynamic hook_event_name"
    - "Non-blocking hook: trap ERR exits 0, all error paths exit 0, jq absence silently exits"
    - "CLAUDE_PLUGIN_ROOT with script-relative fallback for lib sourcing"

key-files:
  created:
    - scripts/session-start.sh
  modified:
    - hooks/hooks.json

key-decisions:
  - "No source matcher on SessionStart: registers for all sources (startup/clear/compact/resume) so bug #10373 fix is transparent when shipped"
  - "detect_project_type returns 'unknown' on no match — session-start.sh normalizes unknown to empty string for clean context message"
  - "lib/detect.sh from Phase 2 used as-is: it already provides detect_project_type; no stub needed"
  - "Dynamic hookEventName from stdin, not hardcoded: prevents silent discard when UserPromptSubmit triggers script (Pitfall 3)"

patterns-established:
  - "Dual-event hook pattern: register same script for SessionStart + UserPromptSubmit to work around upstream bug #10373"
  - "Session tmpfile deduplication: use session_id from stdin JSON as flag file key in /tmp"
  - "Non-blocking hook: trap ERR + all paths exit 0 — session hook must never block Claude Code"

requirements-completed: [SSTH-01, SSTH-02, SSTH-03, SSTH-04, SSTH-05]

# Metrics
duration: 1min
completed: 2026-03-15
---

# Phase 6 Plan 1: Session Hook Summary

**Dual-event SessionStart/UserPromptSubmit bash hook with session_id tmpfile deduplication injecting project type and command list into Claude context**

## Performance

- **Duration:** ~1 min
- **Started:** 2026-03-15T10:07:43Z
- **Completed:** 2026-03-15T10:09:32Z
- **Tasks:** 2
- **Files modified:** 2 (hooks/hooks.json, scripts/session-start.sh)

## Accomplishments

- hooks/hooks.json updated with SessionStart and UserPromptSubmit dual-event registration pointing to session-start.sh via CLAUDE_PLUGIN_ROOT, without source matcher so all session sources (startup/clear/compact/resume) fire the hook
- scripts/session-start.sh implemented with full SSTH-01 through SSTH-05 compliance: disable guard, stdin JSON parsing, session_id deduplication, project type detection, dynamic hookEventName, and non-blocking exit 0 guarantee
- All verification checks pass: SessionStart emits valid additionalContext JSON, deduplication blocks second call with same session_id, ALLCLEAR_DISABLE_SESSION_START=1 exits silently, UserPromptSubmit event path works correctly

## Task Commits

Each task was committed atomically:

1. **Task 1: Create detect.sh stub and hooks.json registration** - `bda446f` (feat)
2. **Task 2: Create session-start.sh hook script** - `7262f1f` (feat)

**Plan metadata:** TBD (docs: complete plan)

## Files Created/Modified

- `scripts/session-start.sh` - Session context injection hook: reads SessionStart/UserPromptSubmit stdin JSON, deduplicates via /tmp tmpfile, sources lib/detect.sh for project type, emits hookSpecificOutput.additionalContext JSON
- `hooks/hooks.json` - Added SessionStart and UserPromptSubmit entries pointing to session-start.sh; removed source matcher from SessionStart; added description field

## Decisions Made

- No source matcher on SessionStart: the plan specified registering for all sources so upstream bug #10373 fix is transparent. The existing hooks.json had `"matcher": "startup|clear|compact"` — removed per plan spec.
- lib/detect.sh from Phase 2 was already present with a complete implementation. The plan called for creating a stub, but the existing file is superior. Used it as-is; the stub step was skipped.
- detect_project_type returns "unknown" when no project type is found. The session-start.sh normalizes "unknown" to empty string so the context message reads "AllClear active." rather than "AllClear active. Detected: unknown."
- Dynamic hookEventName read from stdin's hook_event_name field, not hardcoded, as required by the research (Pitfall 3).

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] detect_project_type "unknown" return value normalized**
- **Found during:** Task 2 (session-start.sh implementation)
- **Issue:** Plan's stub specified that no-match returns empty string, but the existing Phase 2 lib/detect.sh returns "unknown" string on no match. If injected as-is, context would read "Detected: unknown."
- **Fix:** Added `[[ "$PROJECT_TYPES" == "unknown" ]] && PROJECT_TYPES=""` after calling detect_project_type
- **Files modified:** scripts/session-start.sh
- **Verification:** Verified via manual test that context reads "AllClear active." when no manifests present
- **Committed in:** 7262f1f (Task 2 commit)

---

**Total deviations:** 1 auto-fixed (1 bug normalization)
**Impact on plan:** Minimal fix for correct context message display. No scope creep.

## Issues Encountered

- hooks/hooks.json had already been updated by other phases (Phase 3/4/5 parallel execution): contained format.sh, lint.sh, file-guard.sh entries and a SessionStart entry with source matcher. Used Edit tool to update only the SessionStart and add UserPromptSubmit entries, preserving existing PostToolUse and PreToolUse hooks.
- lib/detect.sh was already a complete Phase 2 implementation — no stub creation needed. The plan's Task 1 stub creation was skipped in favor of the existing superior implementation.

## Known Limitations

- **Upstream bug #10373**: SessionStart does not fire on brand-new sessions (only clear/compact/resume). UserPromptSubmit fallback bridges this gap but is subject to bug #12151.
- **Upstream bug #12151**: Plugin-registered UserPromptSubmit hooks execute but stdout is not passed to agent context. Both paths are implemented correctly and will work automatically when Anthropic fixes the bugs.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

- Session hook is complete and ready for integration testing in Phase 13 (bats test suite)
- hooks/hooks.json now has all four hook types registered: PostToolUse (format, lint), PreToolUse (file-guard), SessionStart, UserPromptSubmit
- lib/detect.sh provides detect_project_type for all hook scripts that need project type detection

---
*Phase: 06-session-hook*
*Completed: 2026-03-15*
