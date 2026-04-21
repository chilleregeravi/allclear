---
phase: 97-command-cleanup
plan: "04"
subsystem: commands
tags: [impact, cross-impact, grep-fallback, 3-state-degradation, bats, serialization-guard]

requires:
  - phase: 95-shell-cleanup
    provides: worker-client.sh worker_running/worker_call helpers + scripts/impact.sh grep scanner

provides:
  - Merged /arcanon:impact command with --exclude, --changed, and 3-state degradation (A/B/C)
  - Serialization guard bats file (tests/impact-merged-features.bats) that gates Plan 97-01

affects:
  - 97-01 (must have depends_on: [97-04] and wave: 2 before running — deletion of cross-impact.md)
  - Any future plan touching commands/impact.md

tech-stack:
  added: []
  patterns:
    - "3-state worker degradation: State A (no worker) → grep, State B (worker, no data) → prompt + grep, State C (worker + data) → graph"
    - "Serialization guard bats: structural assertions on the merged file gate the deletion plan in the next wave"

key-files:
  created:
    - tests/impact-merged-features.bats
  modified:
    - plugins/arcanon/commands/impact.md

key-decisions:
  - "Do not touch commands/cross-impact.md in this plan — Plan 97-01 owns its deletion in Wave 2"
  - "Structural bats assertions (grep on the merged file) are sufficient as a serialization guard because slash-command markdown is documentation-as-code"
  - "Legacy grep fallback delegates entirely to scripts/impact.sh — no grep logic is inlined in the command prompt"

patterns-established:
  - "Merge-then-delete sequencing: absorb capabilities first (Wave 1), delete source (Wave 2) gated on bats"

requirements-completed: [CLN-10, CLN-11, CLN-12, CLN-13]

duration: 2min
completed: 2026-04-21
---

# Phase 97 Plan 04: Cross-Impact Merge Summary

**`/arcanon:impact` rewritten with `--exclude`, `--changed`, and 3-state grep-fallback degradation absorbed from `cross-impact.md`; 14-test bats serialization guard gates Plan 97-01's deletion**

## Performance

- **Duration:** ~2 min
- **Started:** 2026-04-21T18:21:29Z
- **Completed:** 2026-04-21T18:23:32Z
- **Tasks:** 2
- **Files modified:** 2 (1 rewritten, 1 created)

## Accomplishments

- Rewrote `commands/impact.md` from 53 lines to 217 lines absorbing all three capabilities from `cross-impact.md`: `--exclude <repo>` flag (CLN-10), `--changed` auto-detect mode (CLN-11), and the 3-state degradation model with grep fallback (CLN-12)
- Preserved the existing MCP-first graph query flow (`mcp__arcanon__impact_query` / `mcp__arcanon__impact_graph`), `--direction`, and `--hops` flags from v0.1.0 intact in State C
- Created `tests/impact-merged-features.bats` with 14 structural assertions (CLN-13 serialization guard) — all pass green; this file is the explicit gate before Plan 97-01 can delete `cross-impact.md`

## Final argument-hint

```
argument-hint: "[target] [--direction downstream|upstream] [--hops N] [--changed] [--exclude <repo>]"
```

## Step 0 state-detection block (adapted from cross-impact.md)

```bash
source ${CLAUDE_PLUGIN_ROOT}/lib/worker-client.sh
WORKER_UP=$(worker_running && echo "yes" || echo "no")
GRAPH_RESPONSE=$(worker_call GET /graph 2>/dev/null || echo "[]")
# MAP_HAS_DATA=yes if GRAPH_RESPONSE has at least one service node; else no
```

Three states:
- **A** (`WORKER_UP=no`) → jump to Legacy Fallback
- **B** (`WORKER_UP=yes`, `MAP_HAS_DATA=no`) → print /arcanon:map prompt, then Legacy Fallback as partial answer
- **C** (`WORKER_UP=yes`, `MAP_HAS_DATA=yes`) → Graph Query Flow (MCP-first)

## --exclude filter coverage

Applied to BOTH result paths:
- **State C (graph):** `drop any row whose service or repo basename matches excluded-repo list` (Step 2)
- **States A/B (grep):** `drop any match line whose {repo} matches an entry in the excluded-repo list` (Legacy scan)

## grep-fallback shell-out pattern

```bash
bash ${CLAUDE_PLUGIN_ROOT}/scripts/impact.sh [args]
```

The existing v1.0 script is reused unchanged — no grep logic is inlined. `--exclude` filtering is applied to the script's tab-separated output in the command layer.

## bats results

```
1..14
ok 1  CLN-10: /arcanon:impact advertises --exclude in argument-hint
ok 2  CLN-10: /arcanon:impact documents --exclude filter for graph results
ok 3  CLN-10: /arcanon:impact documents --exclude filter for grep results
ok 4  CLN-11: /arcanon:impact advertises --changed in argument-hint
ok 5  CLN-11: /arcanon:impact --changed auto-detects from git diff HEAD
ok 6  CLN-11: /arcanon:impact treats no-args invocation as --changed
ok 7  CLN-12: /arcanon:impact documents 3-state degradation model
ok 8  CLN-12: State A falls back to scripts/impact.sh grep scanner
ok 9  CLN-12: State B prompts user to run /arcanon:map
ok 10 CLN-12: State C preserves MCP-first graph query flow
ok 11 CLN-12: /arcanon:impact never starts the worker (query-only)
ok 12 CLN-10+11 combine: --changed and --exclude both documented together
ok 13 CLN-13: original --direction and --hops flags preserved (not regressed)
ok 14 CLN-13: frontmatter allowed-tools covers Bash + MCP + AskUserQuestion
```

14/14 pass. Runtime: < 1 second.

## Plan 97-01 handoff note

**Plan 97-01 (`delete cross-impact.md`) MUST have:**
- `depends_on: [97-04]`
- `wave: 2`

These ensure the orchestrator cannot schedule the deletion until this plan's bats file is green. Do not run Plan 97-01 until `bats tests/impact-merged-features.bats` exits 0 on the branch being merged.

## Untouched-file invariant

`git diff --name-only plugins/arcanon/commands/cross-impact.md` → empty (confirmed at both commit points). `commands/cross-impact.md` is unchanged by this plan.

## Task Commits

1. **Task 1: Merge cross-impact capabilities into commands/impact.md** — `ee07b57` (feat)
2. **Task 2: Add tests/impact-merged-features.bats serialization guard** — `d756906` (test)

**Plan metadata:** (final commit below)

## Files Created/Modified

- `/Users/ravichillerega/sources/ligamen/plugins/arcanon/commands/impact.md` — fully rewritten with --exclude, --changed, 3-state degradation, legacy grep fallback, query-only contract
- `/Users/ravichillerega/sources/ligamen/tests/impact-merged-features.bats` — 14-test structural serialization guard

## Decisions Made

- Do not inline grep logic — delegate entirely to `scripts/impact.sh` (reuse existing v1.0 script, no regression surface)
- Structural bats assertions (not end-to-end) are sufficient: the slash-command markdown is documentation-as-code, and Claude executes what it documents
- `cross-impact.md` left fully intact — this plan's scope stops at merge; deletion belongs to Plan 97-01 in Wave 2

## Deviations from Plan

None — plan executed exactly as written.

## Issues Encountered

None.

## User Setup Required

None — no external service configuration required.

## Next Phase Readiness

- Plan 97-01 (delete `commands/cross-impact.md`) is now safe to run in Wave 2 — the serialization guard is in place and green
- Plan 97-01 must have `depends_on: [97-04]` and `wave: 2` set in its frontmatter before the orchestrator schedules it

## Known Stubs

None — all features documented in `commands/impact.md` wire directly to existing infrastructure (`lib/worker-client.sh`, `scripts/impact.sh`, `mcp__arcanon__*`). No placeholder data or TODO text introduced.

## Threat Flags

No new threat surface introduced beyond what was documented in the plan's threat model. The `--exclude` filter, `--changed` git-diff path, and legacy grep fallback all remain within the boundaries analysed in T-97-09 through T-97-15.

---
*Phase: 97-command-cleanup*
*Completed: 2026-04-21*
