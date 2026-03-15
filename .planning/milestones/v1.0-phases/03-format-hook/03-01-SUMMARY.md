---
phase: 03-format-hook
plan: 01
subsystem: hooks
tags: [bash, jq, ruff, black, rustfmt, prettier, eslint, gofmt, PostToolUse]

requires:
  - phase: 01-plugin-skeleton
    provides: Plugin directory structure, placeholder format.sh and hooks.json scaffold

provides:
  - PostToolUse hook wiring in hooks/hooks.json for Write|Edit|MultiEdit events
  - Full auto-format dispatch script in scripts/format.sh for Python/Rust/TS/JS/Go/JSON/YAML
  - ALLCLEAR_DISABLE_FORMAT toggle for Phase 8 CONF-02 forward compatibility

affects: [08-config, 04-lint-hook]

tech-stack:
  added: [jq (stdin JSON parse), ruff, black, rustfmt, prettier, eslint, gofmt]
  patterns:
    - Read stdin once into variable; extract fields with jq null-coalescing (// empty)
    - Per-extension case dispatch for formatter selection
    - Path substring exclusion loop before formatter dispatch
    - All formatter calls guarded with || true; unconditional exit 0 at end
    - No set -e in PostToolUse hooks to prevent rustfmt exit code propagation

key-files:
  created:
    - hooks/hooks.json
    - scripts/format.sh
  modified: []

key-decisions:
  - "Added ALLCLEAR_DISABLE_FORMAT toggle at top of format.sh for Phase 8 CONF-02 forward compat (one-liner cost, zero-rework benefit)"
  - "Path exclusion checks /node_modules/, /.venv/, /venv/, /env/, /target/, /.git/, /__pycache__/, /.tox/ — trailing slash prevents false positive on .env file at project root"
  - "Redirect both stdout and stderr (>/dev/null 2>&1) to silence all formatter output — redirecting only stderr leaves stdout polluted"
  - "Used jq // empty null-coalescing to avoid literal 'null' string passed to -f guard when tool_input.file_path absent"

patterns-established:
  - "Pattern: stdin-once — capture INPUT=$(cat) then extract with printf | jq; never re-read stdin in hook scripts"
  - "Pattern: non-blocking exit — || true on every formatter + unconditional exit 0 as final line; never set -e in PostToolUse hooks"
  - "Pattern: path exclusion loop — iterate SKIP_PAT array before dispatch table; substring match with *SKIP_PAT* glob"

requirements-completed: [FMTH-01, FMTH-02, FMTH-03, FMTH-04, FMTH-05, FMTH-06, FMTH-07, FMTH-08, FMTH-09, FMTH-10]

duration: 2min
completed: 2026-03-15
---

# Phase 3 Plan 01: Format Hook Summary

**PostToolUse auto-format hook dispatching ruff/black/rustfmt/prettier/eslint/gofmt by file extension with silent non-blocking operation and directory exclusion**

## Performance

- **Duration:** 2 min
- **Started:** 2026-03-15T10:07:34Z
- **Completed:** 2026-03-15T10:09:34Z
- **Tasks:** 2
- **Files modified:** 2

## Accomplishments

- hooks/hooks.json wires PostToolUse Write|Edit|MultiEdit to scripts/format.sh via CLAUDE_PLUGIN_ROOT
- scripts/format.sh implements full formatter dispatch: Python (ruff/black fallback), Rust (rustfmt), TypeScript/JavaScript (prettier/local node_modules/eslint fallback chain), Go (gofmt), JSON/YAML (prettier/local node_modules fallback)
- Hook is strictly non-blocking: 9 formatter calls each guarded with `|| true`, unconditional `exit 0` as final line, no `set -e`
- Silent operation: all formatter stdout+stderr redirected to /dev/null on success
- ALLCLEAR_DISABLE_FORMAT=1 toggle exits immediately for Phase 8 CONF-02

## Task Commits

Each task was committed atomically:

1. **Task 1: Create hooks.json with PostToolUse format entry** - `be555c0` (feat)
2. **Task 2: Create format.sh auto-format hook script** - `bd50514` (feat, committed via concurrent plan 01-01 scaffold)

**Plan metadata:** (docs commit below)

## Files Created/Modified

- `hooks/hooks.json` - PostToolUse event wiring; Write|Edit|MultiEdit -> ${CLAUDE_PLUGIN_ROOT}/scripts/format.sh
- `scripts/format.sh` - Auto-format dispatch script; 63 lines; executable (+x); handles 11 extensions across 6 language families

## Decisions Made

- Used ALLCLEAR_DISABLE_FORMAT forward-compat toggle (one-liner from research open question — low cost, prevents Phase 8 rework)
- Path exclusion includes `/env/` and `/.tox/` beyond base patterns to cover all common Python virtualenv naming conventions
- Checked local `./node_modules/.bin/prettier` as fallback before eslint for TS/JS/JSON/YAML to prefer consistent prettier output in projects with local devDependency install

## Deviations from Plan

None — plan executed exactly as written. The format.sh implementation was also committed by the concurrent plan 01-01 (scaffold) execution; the content is identical to what this plan specified.

## Issues Encountered

- Concurrent plan 01-01 (plugin skeleton) committed a full implementation of format.sh as part of its scaffold task. When Task 2 commit was attempted, git reported nothing to commit because the file was already committed with identical content. The implementation in git matches this plan's specification exactly — confirmed via content verification and all automated checks passing.

## Next Phase Readiness

- Phase 3 deliverables complete: hooks/hooks.json and scripts/format.sh are both committed and production-ready
- Phase 4 (lint hook) can proceed: hooks.json PostToolUse array accepts additional entries; format.sh pattern established for lint.sh to follow
- Phase 8 (config): ALLCLEAR_DISABLE_FORMAT toggle already in place; Phase 8 only needs config layer to set/unset the env var

## Self-Check: PASSED

- hooks/hooks.json: FOUND
- scripts/format.sh: FOUND
- 03-01-SUMMARY.md: FOUND
- Commit be555c0 (hooks.json): FOUND
- Commit bd50514 (format.sh): FOUND

---
*Phase: 03-format-hook*
*Completed: 2026-03-15*
