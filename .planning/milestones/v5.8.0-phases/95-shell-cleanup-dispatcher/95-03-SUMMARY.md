---
phase: "95"
plan: "03"
subsystem: shell-scripts
tags: [bug-fix, dead-code, shell, drift-types, lint, impact, worker-client]
dependency_graph:
  requires: [95-02]
  provides: [DSP-09, DSP-10, DSP-11, DSP-12, DSP-13, DSP-14]
  affects: [worker-client.sh, drift-types.sh, lint.sh, impact.sh]
tech_stack:
  added: []
  patterns: [awk-pre-computation, bash-version-guard, per-linter-stderr-redirect]
key_files:
  created: []
  modified:
    - plugins/arcanon/lib/worker-client.sh
    - plugins/arcanon/scripts/drift-types.sh
    - plugins/arcanon/scripts/lint.sh
    - plugins/arcanon/scripts/impact.sh
decisions:
  - "Keep bash-3.2 workarounds in impact.sh --changed block as POSIX-portable wording (not tied to bash version)"
  - "unset type_repos injected before first declare -A in lang loop, not after loop end (complementary to existing unset at loop bottom)"
metrics:
  duration: "~8 minutes"
  completed: "2026-04-19"
  tasks_completed: 4
  files_modified: 4
---

# Phase 95 Plan 03: Shell Bug Fixes + Dead Code Removal Summary

4 targeted shell fixes: awk pre-computation in worker-client, bash 4+ guard + associative-array key-leak fix in drift-types, global stderr redirect removal + npm-bin dead code in lint, and classify_match dead function deletion + comment cleanup in impact.

## Tasks Completed

| # | Task | Commit | Files |
|---|------|--------|-------|
| 1 | Fix bc subprocess in wait_for_worker (DSP-09) | 9cb8162 | lib/worker-client.sh |
| 2 | bash 4+ guard + unset type_repos fix (DSP-10, DSP-11) | 6ea07ea | scripts/drift-types.sh |
| 3 | Remove exec 2>/dev/null + dead npm bin code (DSP-12, DSP-13) | 88a44e6 | scripts/lint.sh |
| 4 | Delete classify_match() + update bash-3.2 comments (DSP-14) | a93abfb | scripts/impact.sh |

## Changes Detail

### Bug Fix 1 — DSP-09: awk pre-computation in wait_for_worker

`lib/worker-client.sh` line 44: replaced `sleep "$(echo "scale=3; $interval_ms/1000" | bc)"` with a single `awk` pre-computation before the loop:

```bash
SLEEP_SEC=$(awk -v ms="$interval_ms" 'BEGIN { printf "%.3f", ms/1000 }')
```

`sleep "$SLEEP_SEC"` is then used inside the loop. Eliminates one `bc` subprocess spawn per poll iteration (up to 20 per `wait_for_worker` call). `bc` is also not universally available; `awk` is POSIX-guaranteed.

### Bug Fix 2 — DSP-10 + DSP-11: drift-types.sh bash guard + declare -A key leak

Two sub-fixes in `scripts/drift-types.sh`:

1. **Bash 4+ version guard** added at top (after `set -euo pipefail`): exits with a clear message if `BASH_VERSINFO[0] < 4`. `declare -A` is a bash 4 feature; running on bash 3.2 would silently misbehave.

2. **`unset type_repos` before first `declare -A type_repos`** in the per-language loop body. Without it, keys from a previous language iteration survive into the next iteration, producing phantom shared-type false positives. The second `unset`/`declare -A` pair at the loop bottom (already present) ensures cleanup after the inner loop; the new `unset` before the first `declare -A` closes the gap at loop entry.

### Bug Fix 3 — DSP-12 + DSP-13: lint.sh stderr + npm bin dead code

Two sub-fixes in `scripts/lint.sh`:

1. **Removed global `exec 2>/dev/null`** (was line 10). All linter invocations already use `2>&1` to capture stderr into `LINT_OUTPUT`, so the global redirect was redundant — but it also silently swallowed unexpected linter panics, crashes, and misconfiguration errors that would help diagnose issues. Stderr from individual tool invocations now reaches the caller.

2. **Deleted `NPM_BIN=$(npm bin ...)` branch** in the eslint resolution block. `npm bin` was removed in npm 9+ (2022). The branch was dead on any modern Node.js install and emitted deprecation warnings on npm 8. Local `node_modules/.bin/eslint` (branch 1) and global `eslint` (branch 2, renumbered) cover all real cases.

### Dead Code Removal — DSP-14: classify_match() deletion + comment cleanup in impact.sh

1. **Deleted `classify_match()` function** (originally lines 16-55). The function was never called after the main grep loop was rewritten to use inline awk classification (the awk block at line 152+). Removing it eliminates ~40 lines of unreachable bash, including its own bash-3.2 `tr` workarounds.

2. **Updated three bash-3.2 comments** in the `--changed` block and awk inline classifier to say "POSIX portable" instead of referencing a specific bash version, since the workarounds are retained for portability (not bash 3.2 specifically).

## Regression Test Results

Ran full bats suite (`tests/worker-lifecycle.bats`, `tests/structure.bats`, `tests/drift-types.bats`, `tests/lint.bats`):

- **50/51 tests passed**
- **1 pre-existing failure:** `WRKR-07: worker writes structured JSON log to logs/worker.log` — fails on the commit prior to this phase; unrelated to any change in this plan.

## Deviations from Plan

None — plan executed exactly as written. The `unset`/`declare -A` pair at the bottom of the lang loop in drift-types.sh (lines 277-278) was already correct; only the missing `unset` at loop entry was added.

## Known Stubs

None.

## Threat Flags

None — no new network endpoints, auth paths, file access patterns, or schema changes introduced.

## Self-Check: PASSED

| Item | Status |
|------|--------|
| plugins/arcanon/lib/worker-client.sh | FOUND |
| plugins/arcanon/scripts/drift-types.sh | FOUND |
| plugins/arcanon/scripts/lint.sh | FOUND |
| plugins/arcanon/scripts/impact.sh | FOUND |
| commit 9cb8162 | FOUND |
| commit 6ea07ea | FOUND |
| commit 88a44e6 | FOUND |
| commit a93abfb | FOUND |
