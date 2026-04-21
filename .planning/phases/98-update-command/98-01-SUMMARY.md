---
phase: 98-update-command
plan: "01"
subsystem: update-command
tags: [update, semver, offline-safe, bats]
dependency_graph:
  requires: []
  provides:
    - plugins/arcanon/scripts/update.sh (--check mode)
    - plugins/arcanon/commands/update.md (/arcanon:update Phase 1)
    - tests/update.bats (semver matrix + offline fallback)
  affects:
    - plugins/arcanon/commands/ (new /arcanon:update surface)
    - tests/ (9 new bats tests)
tech_stack:
  added: []
  patterns:
    - Background-subshell timer for portable 5s network cap (no timeout(1) dep)
    - node+semver via NODE_PATH for deterministic version compare
    - trap 'exit 0' ERR with || NODE_EXIT=$? guard for non-zero node exits
key_files:
  created:
    - plugins/arcanon/scripts/update.sh (113 lines)
    - plugins/arcanon/commands/update.md (77 lines)
    - tests/update.bats (124 lines)
  modified: []
decisions:
  - semver present transitively via better-sqlite3/fastify — no package.json edit needed
  - node -e exit code captured via || NODE_EXIT=$? to prevent set -e from triggering ERR trap on exit code 1 (equal)
  - claude plugin update --yes flag absent — 98-02 must handle interactive prompt
metrics:
  duration: "~20 minutes"
  completed: "2026-04-21T18:56:31Z"
  tasks_completed: 3
  files_created: 3
  files_modified: 0
---

# Phase 98 Plan 01: Update Command Scaffolding and --check Mode Summary

Stand up `/arcanon:update` command surface with `--check` mode — semver-correct, offline-safe JSON output with 5-second network cap and 9-test bats matrix proving lexicographic comparison is not in use.

## Files Created

| File | Lines | Purpose |
|------|-------|---------|
| `plugins/arcanon/scripts/update.sh` | 113 | `--check` mode shell; stubs for `--kill`, `--prune-cache`, `--verify` |
| `plugins/arcanon/commands/update.md` | 77 | `/arcanon:update` command with 5 status paths, pre-flight note, changelog rendering |
| `tests/update.bats` | 124 | 9 bats tests: semver matrix, offline fallback, JSON shape |

## Test Results

```
1..9
ok 1 UPD-13: node+semver says 0.10.0 > 0.9.0 (not lexicographic)
ok 2 UPD-13: node+semver says 0.10.0 is NOT less than 0.9.0 (anti-lex proof)
ok 3 UPD-13: node+semver says 0.1.1 > 0.1.0
ok 4 UPD-13: node+semver says 1.0.0 == 1.0.0
ok 5 UPD-03: --check emits status=equal when installed matches remote
ok 6 UPD-04: --check emits non-empty changelog_preview when remote is newer
ok 7 UPD-04: --check marks update_available=true when remote is newer
ok 8 UPD-11: --check exits 0 with status=offline when marketplace manifest is absent
ok 9 --check emits valid JSON with all required keys
```

9/9 pass. Full suite: 278/278 pass (no regressions).

## Pre-flight Validation Outcome (for plan 98-02)

**Result: `--yes` flag is ABSENT from `claude plugin update`.**

```
$ claude plugin update --help
Usage: claude plugin update [options] <plugin>
Update a plugin to the latest version (restart required to apply)
Options:
  -h, --help           Display help for command
  -s, --scope <scope>  Installation scope: user, project, local, managed (default: user)
```

No `-y` / `--yes` / `--non-interactive` flag exists. Plan 98-02 must handle the interactive confirmation prompt — it cannot pass `--yes` to skip it. The apply flow in 98-02 will need to either:
1. Run `claude plugin update arcanon --scope user` and let the user confirm interactively, or
2. Find another non-interactive reinstall path (check `claude plugin install` or direct file replacement).

## Semver Package Path

`semver` is present transitively at:
```
plugins/arcanon/node_modules/semver/package.json
```
Available via `NODE_PATH="${PLUGIN_ROOT}/node_modules"`. No `package.json` edit was needed. Plans 98-02 and 98-03 can rely on this path.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Fixed node exit code 1 triggering ERR trap**
- **Found during:** Task 1 verification
- **Issue:** `set -euo pipefail` with `trap 'exit 0' ERR` treats node's exit code 1 (semver equal) as an error, causing the trap to fire and the script to exit silently before emitting JSON output.
- **Fix:** Captured node exit code via `|| NODE_EXIT=$?` pattern and initialized `NODE_EXIT="${NODE_EXIT:-0}"` for the success case. This prevents `set -e` from triggering ERR on intentional non-zero node exits.
- **Files modified:** `plugins/arcanon/scripts/update.sh`
- **Commit:** 8ee4233 (included in the same task commit after fix)

## Known Stubs

| Stub | File | Line | Reason |
|------|------|------|--------|
| `--kill` mode | `scripts/update.sh` | ~22 | Exits 1 with "not yet implemented" JSON error — 98-02 replaces |
| `--prune-cache` mode | `scripts/update.sh` | ~22 | Exits 1 with "not yet implemented" JSON error — 98-03 replaces |
| `--verify` mode | `scripts/update.sh` | ~22 | Exits 1 with "not yet implemented" JSON error — 98-03 replaces |
| Step 3 apply flow | `commands/update.md` | ~63 | Placeholder text pointing to 98-02/98-03 |

These stubs are intentional — plans 98-02 and 98-03 will replace them surgically without restructuring the file.

## Threat Surface Scan

No new network endpoints, auth paths, or file access patterns introduced beyond what the plan's threat model covers. T-98-01 and T-98-02 mitigations are implemented: `semver.valid()` guards reject non-semver strings before interpolation into `node -e`.

## Self-Check: PASSED

| Check | Result |
|-------|--------|
| `plugins/arcanon/scripts/update.sh` exists | FOUND |
| `plugins/arcanon/commands/update.md` exists | FOUND |
| `tests/update.bats` exists | FOUND |
| commit 8ee4233 (update.sh) | FOUND |
| commit 5d3d6fd (update.md) | FOUND |
| commit 131a612 (update.bats) | FOUND |
