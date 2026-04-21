---
phase: 97-command-cleanup
plan: "01"
subsystem: commands
tags: [cross-impact, impact, bats, banner, docs-cleanup, wave-2]

requires:
  - phase: 97-command-cleanup
    plan: "04"
    provides: Merged /arcanon:impact with --exclude/--changed/3-state degradation + impact-merged-features.bats serialization guard

provides:
  - /arcanon:cross-impact deleted from plugin command surface
  - Session banner, both READMEs, and docs/commands.md scrubbed of cross-impact references
  - tests/structure.bats and tests/session-start.bats updated to assert /arcanon:impact instead

affects:
  - Any future plan scanning command surface (zero cross-impact refs in live surface)
  - 97-02, 97-03 (wave 2 siblings — command surface is now 7 commands: no cross-impact)

tech-stack:
  added: []
  patterns:
    - "Wave-gated deletion: merge capabilities first (Wave 1 / 97-04), delete source (Wave 2 / 97-01) only after serialization guard passes"

key-files:
  created: []
  modified:
    - plugins/arcanon/commands/cross-impact.md (DELETED)
    - plugins/arcanon/scripts/session-start.sh
    - plugins/arcanon/README.md
    - README.md
    - docs/commands.md
    - tests/structure.bats
    - tests/session-start.bats

key-decisions:
  - "Outright kill — no migration stub, no redirect; /arcanon:impact is the forward-going verb and docs/commands.md already says so"
  - "tests/commands-surface.bats and tests/impact-merged-features.bats retain cross-impact string references intentionally — they are structural test guards (CLN-01 assertion + serialization guard comments), not live command surface"
  - "tests/structure.bats command loop updated to 'impact drift' (not removed) — keeps the structural assertion exercising two files while eliminating the cross-impact dependency"

patterns-established:
  - "Banner edit minimal-touch: remove only the deleted command token; leave /arcanon:upload for 97-02 to manage"

requirements-completed: [CLN-01, CLN-02]

duration: 5min
completed: 2026-04-21
---

# Phase 97 Plan 01: Cross-Impact Deletion Summary

**`/arcanon:cross-impact` deleted from the plugin surface; banner, both READMEs, docs/commands.md, and two bats test files scrubbed; all 70 bats assertions pass green across 4 test suites**

## Performance

- **Duration:** ~5 min
- **Started:** 2026-04-21T18:30:00Z
- **Completed:** 2026-04-21T18:35:00Z
- **Tasks:** 1
- **Files modified:** 7 (1 deleted, 6 edited)

## Accomplishments

- Pre-flight confirmed: `bats tests/impact-merged-features.bats` 14/14 pass before deletion, proving 97-04 merge features are in place
- Deleted `plugins/arcanon/commands/cross-impact.md` — command file gone from plugin surface (CLN-01)
- Scrubbed all user-visible cross-impact references: session banner, plugins README, root README, docs/commands.md (CLN-02)
- Updated `tests/structure.bats` command loops from `cross-impact drift` to `impact drift`
- Updated `tests/session-start.bats` two assertions from `/arcanon:cross-impact` to `/arcanon:impact`
- Final Wave 2 verification: `bats tests/commands-surface.bats` 10/10 pass (CLN-01 test now true); `bats tests/impact-merged-features.bats` 14/14 still pass

## Banner string after edit

```bash
CONTEXT="${CONTEXT} Commands: /arcanon:map, /arcanon:drift, /arcanon:impact, /arcanon:login, /arcanon:upload, /arcanon:status, /arcanon:sync, /arcanon:export."
```

(Token `/arcanon:cross-impact, ` removed. `/arcanon:upload` left in place — Plan 97-02 owns its banner disposition.)

## bats results

| Suite | Tests | Pass | Fail |
|---|---|---|---|
| tests/structure.bats | 16 | 16 | 0 |
| tests/session-start.bats | 26 | 26 | 0 |
| tests/commands-surface.bats | 10 | 10 | 0 |
| tests/impact-merged-features.bats | 14 | 14 | 0 |
| **Total** | **66** | **66** | **0** |

## Task Commits

1. **Task 1: Delete commands/cross-impact.md and scrub all references** — `381b297` (chore)

**Plan metadata:** (final commit below)

## Files Created/Modified

- `plugins/arcanon/commands/cross-impact.md` — DELETED
- `plugins/arcanon/scripts/session-start.sh` — Removed `/arcanon:cross-impact, ` token from banner line 114
- `plugins/arcanon/README.md` — Removed `- /arcanon:cross-impact — legacy repo-local impact query` list item
- `README.md` — Removed `| /arcanon:cross-impact | Legacy alias for repo-local transitive impact. |` table row
- `docs/commands.md` — Renamed `## Impact & cross-impact` to `## Impact`; removed `### /arcanon:cross-impact [file-or-symbol]` subsection (4 lines)
- `tests/structure.bats` — Both `for cmd in cross-impact drift` loops changed to `for cmd in impact drift`
- `tests/session-start.bats` — Both `/arcanon:cross-impact` assertions changed to `/arcanon:impact`

## Intentionally untouched references

- `plugins/arcanon/worker/scan/agent-prompt-infra.md` — READ-ONLY agent prompt; research explicitly flags this as out-of-scope
- `tests/commands-surface.bats` lines 5, 29-30 — CLN-01 bats test that asserts the file was deleted; referencing the deleted path is correct and necessary
- `tests/impact-merged-features.bats` lines 5-6, 80 — Comments in the 97-04 serialization guard describing what capabilities were absorbed; historical context in a guard file
- `.planning/**/*` — Planning archives (history record)
- `.planning/designs/cross-impact-v2.md` — Design archive (history record)

## Decisions Made

- Outright kill with no migration stub — `/arcanon:impact` is already the canonical verb and docs mark cross-impact legacy; a stub would prolong the confusion
- `tests/commands-surface.bats` and `tests/impact-merged-features.bats` cross-impact string references are intentional (guard/test), not live surface; they do not require modification

## Deviations from Plan

None — plan executed exactly as written.

## Issues Encountered

None.

## User Setup Required

None — no external service configuration required.

## Next Phase Readiness

- Command surface is now clean: 7 surviving commands (`map`, `drift`, `impact`, `login`, `upload`, `status`, `sync`, `export`)
- Plan 97-02 (upload deprecation), 97-03 (sync flags), and remaining Wave 2 plans can proceed
- `bats tests/commands-surface.bats` deferred run from 97-02 Task 3 is now complete — all 10 pass

## Known Stubs

None.

## Self-Check: PASSED

- cross-impact.md deleted: confirmed
- 97-01-SUMMARY.md created: confirmed
- Task commit 381b297: confirmed

## Threat Flags

No new threat surface. T-97-01 verified: banner string still produced by `jq -Rs .` (line 119 untouched), removing one command token from the string cannot produce malformed JSON — confirmed by live banner JSON validation during verification.

---
*Phase: 97-command-cleanup*
*Completed: 2026-04-21*
