---
phase: 99-sessionstart-enrichment
plan: "01"
subsystem: session-hooks
tags: [session-start, enrichment, impact-map, sqlite, bats, tdd]
dependency_graph:
  requires: [phase-97, phase-98]
  provides: [SSE-01, SSE-02, SSE-03, SSE-04, SSE-05, SSE-06, SSE-07]
  affects: [plugins/arcanon/scripts/session-start.sh]
tech_stack:
  added: [sqlite3-cli-queries, shasum-sha256-portable-hashing, bats-test-fixtures]
  patterns: [subshell-silent-fallback, tdd-red-green, fixture-helper-pattern]
key_files:
  created:
    - tests/helpers/arcanon_enrichment.bash
    - tests/session-start-enrichment.bats
  modified:
    - plugins/arcanon/scripts/session-start.sh
decisions:
  - "Subshell pattern chosen for ENRICHMENT block: entire block runs in $(...) subshell so any failure exits the subshell silently; ENRICHMENT stays empty. This preserves set -euo pipefail discipline in the outer script without needing a break_sse function."
  - "Stale prefix is appended to the ENRICHMENT suffix, not to the full context string. The banner reads: 'Arcanon active. Commands: ... [stale map — last scanned 3d ago] 5 services mapped.'"
  - "Tests 3/4/6 (>7d, no-DB, corrupt-DB) pass in RED phase because they assert 'no enrichment' which is already the current behavior — these are valid negative-assertion tests that remain green in both RED and GREEN phases."
metrics:
  duration_seconds: 216
  completed_date: "2026-04-21T19:24:37Z"
  tasks_completed: 2
  files_changed: 3
---

# Phase 99 Plan 01: SessionStart Enrichment Summary

Impact-map stats suffix (service count, load-bearing files, scan date, hub status) injected into the Arcanon session banner via a silent-fallback subshell block in session-start.sh.

## What Was Built

The `ARCANON_ENRICHMENT` block (lines 85-179 of session-start.sh) runs after the INTG-01 worker-status block and before SSTH-02 project detection. It:

1. Resolves the project hash via `printf '%s' "$CWD" | shasum -a 256 | awk '{print $1}' | cut -c1-12` — byte-identical to `worker/db/database.js:75` `projectHashDir()`.
2. Locates `$DATA_DIR/projects/$PROJECT_HASH/impact-map.db` using `resolve_arcanon_data_dir` when available.
3. Validates the DB with `PRAGMA quick_check` before running any real query.
4. Runs three `sqlite3` COUNT queries: services, DISTINCT non-null `source_file` in connections, `MAX(completed_at)` from scan_versions.
5. Computes age in hours using portable `date` (GNU `-d` first, BSD `-jf` fallback).
6. Calls `hub.sh status --json` to derive banner hub-status token.
7. Assembles: `N services mapped. K load-bearing files. Last scan: YYYY-MM-DD. Hub: <token>.`
8. Prepends `[stale map — last scanned Xd ago]` when 48h <= age < 168h.
9. Silent no-op on every failure path (missing DB, corrupt DB, age >= 168h, any query error, hub failure).

The CONTEXT consumer `[[ -n "${ENRICHMENT:-}" ]] && CONTEXT="${CONTEXT} ${ENRICHMENT}"` appends the suffix after the WORKER_STATUS append line (line 212).

## Empirically Measured Warm-Cache Latency

**53ms** on a warm fixture (macOS M-series, local SSD). Well under the 200ms SSE-06 budget. The three sqlite3 COUNT queries on a sub-MB local DB complete in ~5-10ms total; the hub.sh bash invocation accounts for the remainder.

## Break_sse Early-Exit Pattern Decision

Used **subshell capture** (`ENRICHMENT="$(... set -euo pipefail; ... )" 2>/dev/null || ENRICHMENT=""`):

- The plan proposed a `break_sse()` function or explicit `|| { ENRICHMENT=""; }` guards.
- The subshell approach is simpler: any `exit 0` in the subshell cleanly terminates the block, `printf '%s' "$ENRICHMENT_VAL"` at the end emits the value, and `2>/dev/null || ENRICHMENT=""` in the outer script catches any subshell failure.
- The `set -euo pipefail` inside the subshell is separate from the outer script — failures cannot propagate.
- Early exits via `exit 0` produce empty stdout, so `ENRICHMENT=""` is the correct fallback.

## hub.sh Status on This Machine

```json
{"plugin_version":"0.1.0","data_dir":"...","hub_auto_upload":false,"credentials":"present","queue":{"pending":0,"dead":0}}
```

Derived token: **manual** (credentials=present, hub_auto_upload=false). The `auto-sync on` path (hub_auto_upload=true) and `offline` path (credentials=missing) are exercised by the bats fixture stub variations.

## Portability Surprises

| Issue | Resolution |
|-------|-----------|
| `shasum` vs `sha256sum` | Both available on macOS. Shell uses `command -v shasum` first, falls back to `sha256sum`. Both emit `<hash>  -` format so `awk '{print $1}'` works on either. |
| `date -d` vs `date -jf` | macOS `date` uses BSD syntax (`-jf '%Y-%m-%d %H:%M:%S'`); GNU `date` uses `-d`. Block tries GNU first, BSD second, `exit 0` on both failures. |
| `timeout` availability | macOS lacks GNU `timeout` by default. The plan noted this; the block omits per-query `timeout` (belt-and-suspenders) and relies on the outer script's ERR trap + subshell `exit 0` for any sqlite3 hang. The 53ms measurement confirms this is not needed for correctness. |
| `date +%s%N` | Not available on all macOS versions (returns literal `%N`). The SSE-06 budget test guards with `if [[ "$start_ns" == "0" ]]` and skips the assertion gracefully. |

## TDD Gate Compliance

- RED gate commit: `98498a2` — `test(99-01): add failing enrichment tests (RED gate)`
- GREEN gate commit: `acb6802` — `feat(99-01): insert ARCANON_ENRICHMENT block into session-start.sh (GREEN)`

3 positive-assertion tests failed in RED (SSE-01 fresh, SSE-03 stale, SSE-04 hub-down). 4 negative-assertion tests (>7d, no-DB, corrupt-DB, 200ms) trivially passed in RED because the current code has no enrichment — they assert absence of enrichment, which is already true. All 7 tests pass in GREEN.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Stale-prefix regex anchored to ctx start**
- **Found during:** Task 2 GREEN verification
- **Issue:** Test 2 asserted `^[stale map` (anchored to start of ctx string), but the stale prefix is on the ENRICHMENT suffix appended after `Commands: ...`. Full ctx is: `Arcanon active. Commands: ... [stale map — last scanned 3d ago] 5 services mapped...`
- **Fix:** Changed regex from `^\[stale map` to `\[stale map` (unanchored grep). The plan's `<must_haves>` says the banner "gains the same suffix prefixed by `[stale map...]`" — the prefix is on the suffix, not on the whole context string.
- **Files modified:** `tests/session-start-enrichment.bats`
- **Commit:** `acb6802` (included in same GREEN commit)

## Known Stubs

None — all enrichment data is live-queried from the sqlite3 DB and hub.sh output.

## Threat Flags

No new trust boundaries introduced beyond those documented in the plan's threat model (T-99-01 through T-99-07). The enrichment block adds no new network endpoints, auth paths, or schema changes.

## Self-Check: PASSED

All created/modified files exist. Both commits (`98498a2`, `acb6802`) confirmed in git log. SSE block marker appears exactly once. ENRICHMENT consumer line appears exactly once.
