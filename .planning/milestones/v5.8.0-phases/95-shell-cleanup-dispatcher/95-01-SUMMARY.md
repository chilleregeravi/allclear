---
phase: 95-shell-cleanup-dispatcher
plan: "01"
subsystem: shell-scripts
tags: [dispatcher, bash, drift, bats, DSP-01, DSP-02, DSP-03, DSP-04, DSP-08, DSP-14]
dependency_graph:
  requires: []
  provides: [drift.sh dispatcher, DSP-08 canonical message, drift-dispatcher.bats coverage]
  affects: [plugins/arcanon/scripts/drift.sh, plugins/arcanon/scripts/drift-common.sh, tests/drift-dispatcher.bats]
tech_stack:
  added: [bash 5.x (Homebrew — test runtime)]
  patterns: [subcommand dispatcher, bash subprocess routing, TDD bats]
key_files:
  created:
    - plugins/arcanon/scripts/drift.sh
    - tests/drift-dispatcher.bats
  modified:
    - plugins/arcanon/scripts/drift-common.sh
decisions:
  - Dispatcher uses `bash` subprocess (never `source`) to preserve subcommand script independence (DSP-02/DSP-03)
  - `all` subcommand is sequential not parallel — predictable aggregate exit code and preserves drift-common.sh return-0 semantics
  - Reserved slots `licenses|security` exit 2 distinct from unknown=1 so operators can differentiate reserved vs typo
  - Tests prepend /opt/homebrew/bin to PATH in setup() so `bash` resolves to Bash 5.x — macOS system bash 3.2 correctly triggers DSP-04 guard and would fail all routing tests without this fix
metrics:
  duration: "~20 minutes"
  completed: "2026-04-19"
  tasks_completed: 3
  files_changed: 3
---

# Phase 95 Plan 01: Unified drift.sh Subcommand Dispatcher Summary

Unified drift entry point via `scripts/drift.sh` dispatcher routing `versions|types|openapi|all` to subcommand scripts as bash subprocesses, with Bash 4+ guard, reserved `licenses|security` slots, and DSP-08 canonical stderr message in drift-common.sh.

## Tasks Completed

| Task | Name | Commit | Files |
|------|------|--------|-------|
| 1 | Create scripts/drift.sh unified dispatcher | 912203c | plugins/arcanon/scripts/drift.sh (new, 66 lines) |
| 2 | Add DSP-08 canonical message to drift-common.sh | 31a6a16 | plugins/arcanon/scripts/drift-common.sh (3 lines added) |
| 3 RED | Write bats tests for dispatcher (RED phase) | dfe34d2 | tests/drift-dispatcher.bats (new, 116 lines) |
| 3 GREEN | Fix test PATH + all 12 tests passing | 78404ed | tests/drift-dispatcher.bats (3 lines added to setup) |

## Verification Results

- `bash plugins/arcanon/scripts/drift.sh --help` — passes, exit 0
- `bash plugins/arcanon/scripts/drift.sh licenses` — exits 2, stderr "not yet implemented"
- `bats tests/drift-dispatcher.bats` — 12/12 passing
- `bats tests/drift-versions.bats` — 25/25 passing (no regression)
- No `source` calls to subcommand scripts in dispatcher (static grep confirmed)
- `drift: no linked repos configured` on exactly one line in drift-common.sh

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Tests require Bash 4+ on PATH but macOS ships Bash 3.2**

- **Found during:** Task 3 GREEN — 10/12 tests failed with "arcanon drift requires Bash 4+"
- **Issue:** The plan's verbatim test contents use `run bash "$DISPATCHER"`. On macOS, `bash` resolves to /bin/bash (3.2) which correctly triggers the Bash 4+ guard and exits 1 — making all routing tests fail.
- **Fix:** Added `export PATH="/opt/homebrew/bin:$PATH"` to setup() in the bats file, and installed Bash 5.3 via `brew install bash`. The PATH fix ensures `bash` in tests resolves to Homebrew bash 5.x. This also verifies the DSP-04 guard fires correctly when system bash 3.2 IS used (tests D10-D11 are static grep assertions that don't invoke the dispatcher).
- **Files modified:** tests/drift-dispatcher.bats (3 lines in setup block)
- **Commit:** 78404ed

## TDD Gate Compliance

- RED gate commit: dfe34d2 `test(95-01): add failing bats tests for drift.sh dispatcher (RED)`
- GREEN gate commit: 78404ed `feat(95-01): pass all 12 bats tests for drift.sh dispatcher (GREEN)`
- REFACTOR: not required — code was clean

## Known Stubs

None.

## Threat Flags

None — no new network endpoints, auth paths, file access patterns, or schema changes introduced. This plan adds shell scripts only.

## Self-Check: PASSED

- `plugins/arcanon/scripts/drift.sh` — FOUND
- `plugins/arcanon/scripts/drift-common.sh` — FOUND (modified)
- `tests/drift-dispatcher.bats` — FOUND
- Commit 912203c — FOUND
- Commit 31a6a16 — FOUND
- Commit dfe34d2 — FOUND
- Commit 78404ed — FOUND
