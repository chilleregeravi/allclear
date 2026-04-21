---
phase: 100-impact-hook
plan: "01"
subsystem: impact-hook
tags: [bash, tdd, db-path, hash-parity, pre-flight]
dependency_graph:
  requires: []
  provides:
    - plugins/arcanon/lib/db-path.sh (resolve_project_db_path, resolve_project_db_hash)
    - .planning/phases/100-impact-hook/100-01-PREFLIGHT.md
  affects:
    - plans/100-02 (skeleton hook — consumes resolve_project_db_path)
    - plans/100-03 (full hook — consumes resolve_project_db_path + PREFLIGHT findings)
tech_stack:
  added: []
  patterns:
    - TDD RED/GREEN cycle for bash library
    - printf '%s' (no newline) for exact JS hash parity
    - shasum/sha256sum portability ladder
    - source-guard pattern (mirrors worker-client.sh)
key_files:
  created:
    - plugins/arcanon/lib/db-path.sh
    - tests/db-path.bats
    - .planning/phases/100-impact-hook/100-01-PREFLIGHT.md
  modified: []
decisions:
  - "systemMessage is the PreToolUse output key for soft-warns (confirmed from live file-guard.sh)"
  - "printf '%s' not echo to hash project_root — avoids trailing newline mismatch with JS"
  - "resolve_project_db_path returns path string unconditionally; caller does test -f"
  - "root_path in production DBs is always relative; join with repos.path for absolute match"
metrics:
  duration: "~145s"
  completed: "2026-04-21"
  tasks_completed: 2
  files_created: 3
---

# Phase 100 Plan 01: Pre-Flight Validations + db-path.sh Summary

One-liner: Bash port of JS `sha256(root).hex.slice(0,12)` hash with 5-test bats parity suite and 4 locked pre-flight findings for downstream plans.

## What Was Built

### Task 1: 100-01-PREFLIGHT.md

Four empirical validations run and findings locked:

| # | Question | Finding |
|---|----------|---------|
| 1 | PreToolUse output key | `systemMessage` (confirmed from `file-guard.sh` warn_file() — live production evidence) |
| 2 | Hash algorithm | `sha256(projectRoot).hex.slice(0,12)` via `printf '%s' \| shasum -a 256 \| cut -c1-12` |
| 3 | root_path convention | Relative only in all 18 production DBs; bare `.` and trailing slashes observed |
| 4 | /impact signature | `GET /impact?project=<abs-path>&change=<service-name>` — `change` is service name, not file |

### Task 2: lib/db-path.sh + tests/db-path.bats (TDD)

**RED commit:** `cb7f123` — 5 bats tests written, all fail (helper absent).

**GREEN commit:** `dca0e58` — `lib/db-path.sh` created, all 5 tests pass.

Bats run output (GREEN):
```
1..5
ok 1 db-path.sh - hash matches JS for /tmp/demo
ok 2 db-path.sh - resolve_project_db_path returns expected DB path
ok 3 db-path.sh - honors ARCANON_DATA_DIR override
ok 4 db-path.sh - direct execution refuses with error
ok 5 db-path.sh - parity for 3 sample project roots
```

Parity evidence:
```
JS:   84a8cd7d7a26  (node crypto.sha256('/tmp/demo').slice(0,12))
Bash: 84a8cd7d7a26  (printf '%s' '/tmp/demo' | shasum -a 256 | cut -c1-12)
```

## Interface Exported for Plans 02/03

```bash
source "$PLUGIN_ROOT/lib/db-path.sh"

# Returns absolute path to impact-map.db for a project root.
# Never errors on missing DB — caller must test -f the result.
db=$(resolve_project_db_path "/abs/project/root")

# Returns 12-char hex hash only (used for diagnostics).
hash=$(resolve_project_db_hash "/abs/project/root")
```

The function resolves `ARCANON_DATA_DIR` → `LIGAMEN_DATA_DIR` → `~/.arcanon` → `~/.ligamen` → `~/.arcanon` via the sourced `data-dir.sh`, so it honors all existing override mechanisms automatically.

## TDD Gate Compliance

- RED gate: commit `cb7f123` (`test(100-01): add failing parity tests...`) — all 5 tests failed
- GREEN gate: commit `dca0e58` (`feat(100-01): add lib/db-path.sh...`) — all 5 tests pass
- REFACTOR: not needed (implementation was clean on first pass)

## Deviations from Plan

None — plan executed exactly as written.

The one additional empirical finding beyond what the plan outlined: production DBs returned **only relative** `root_path` values (zero absolute paths across 18 DBs). The plan already specified a defensive two-branch match for Plan 03; this confirms defensive handling is the right approach and no absolute-path branch is needed. Documented in PREFLIGHT.md section 3.

## Known Stubs

None. This plan delivers a pure resolver library and pre-flight documentation. No UI rendering, no data sources.

## Self-Check: PASSED
