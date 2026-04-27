---
phase: 116
plan: "01"
title: "--help System: lib/help.sh + ## Help section in all 13 commands"
subsystem: help-system
tags: [help, slash-commands, bash-helper, awk]
requires: []
provides:
  - lib/help.sh extractor (sourceable by other plugin code)
  - canonical `## Help` section in every /arcanon:* command
affects:
  - plugins/arcanon/commands/* (all 13 markdown files)
  - plugins/arcanon/CHANGELOG.md
tech-stack:
  added: []
  patterns:
    - state-machine awk for markdown section extraction (replaces /range/,/range/ pair)
    - sourceable bash helper with direct-execution guard (mirrors lib/worker-client.sh:7)
key-files:
  created:
    - plugins/arcanon/lib/help.sh
    - tests/help.bats
  modified:
    - plugins/arcanon/commands/map.md
    - plugins/arcanon/commands/drift.md
    - plugins/arcanon/commands/impact.md
    - plugins/arcanon/commands/sync.md
    - plugins/arcanon/commands/login.md
    - plugins/arcanon/commands/status.md
    - plugins/arcanon/commands/export.md
    - plugins/arcanon/commands/verify.md
    - plugins/arcanon/commands/update.md
    - plugins/arcanon/commands/list.md
    - plugins/arcanon/commands/view.md
    - plugins/arcanon/commands/doctor.md
    - plugins/arcanon/commands/diff.md
    - plugins/arcanon/CHANGELOG.md
decisions:
  - "Used a stateful awk in arcanon_extract_help_section instead of the plan's /range/,/range/ pair. The original pattern closes on the same line as the start because `## Help` matches both the start and end regex, returning a single-line result. Discovered while smoke-testing against the existing diff.md `## Help` section."
  - "Restructured diff.md to add a `## Step 1 — Run the diff` H2 between the existing `## Help` section and its bash block. Without the H2 the extractor would have included the bash invocation (source ... && exit 0) in the help output. Help section content unchanged; the bash block stayed in the same position."
  - "Extended the iteration list in tests/help.bats from the plan's 12 commands to 13 (added `diff`). The plan was authored before 115-02 shipped diff.md. Hand-coupled with commands-surface.bats:18 per RESEARCH §10 question 5."
  - "doctor.md `## Help` (line 57) renamed to `## Troubleshooting`; full content preserved verbatim. New canonical `## Help` section appended at end-of-file."
  - "update.md HELP-03 line (`claude plugin update --help 2>&1 | grep -i -- '--yes'`) is byte-identical. Position shifted from line 21 to line 23 due to the 2-line prepend; HELP-03 contract is about CONTENT byte-identity, not line number."
metrics:
  duration_min: 22
  completed: 2026-04-25
---

# Phase 116 Plan 01: `--help` System Summary

Every `/arcanon:*` slash command (13 total) now answers `--help` / `-h` / `help` with usage and examples extracted via a single sourceable bash helper (`lib/help.sh`) from each command's own `## Help` markdown section.

## Tasks

| # | Task | Commit | Files |
|---|------|--------|-------|
| 1 | Author `lib/help.sh` (extractor + flag detector + direct-exec guard) | `690bf29` | `plugins/arcanon/lib/help.sh` |
| 2 | Add `## Help` section to all 13 commands; rename doctor.md `## Help` → `## Troubleshooting`; restructure diff.md to keep bash block out of Help range | `a1e7bd0` | 13 command markdown files |
| 3 | Insert `arcanon_print_help_if_requested` 2-liner in each command's first bash block (drift + sync get a new `## Help short-circuit` H2) | `bed1ac7` | 12 command markdown files (diff already done in Task 2) |
| 4 | Author `tests/help.bats` (8 tests covering HELP-01..04) | `f80b6ec` | `tests/help.bats` |
| 5 | CHANGELOG bullet under `[Unreleased] / ### Added` | `e299b8b` | `plugins/arcanon/CHANGELOG.md` |

## Tests

- `bats tests/help.bats` — 8/8 pass
- `bats tests/commands-surface.bats` — 14/14 pass (regression confirmed clean)

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Awk extractor pattern was self-closing**

- **Found during:** Task 1 verification
- **Issue:** The plan's recommended awk `/^## Help[[:space:]]*$/,/^## /` range form treats the `## Help` line as BOTH the start and end of the range, so it returns only that single line. Reproduced against the existing diff.md `## Help` section (which had no subsequent `## ` heading): the extractor returned just `## Help`, not the body.
- **Fix:** Replaced with a state-machine awk that sets `in_section=1` on the heading match and exits on a SUBSEQUENT `## ` line. Behaviour identical at EOF (still captures to end of file when no following `## ` exists).
- **Files modified:** `plugins/arcanon/lib/help.sh`
- **Commit:** `690bf29`

**2. [Rule 1 - Bug] diff.md `## Help` section had bash block inside it**

- **Found during:** Task 2 planning
- **Issue:** `commands/diff.md` shipped (in 115-02) with a `## Help` section but the bash invocation block was directly underneath, with no following `## ` heading. The extractor would have included the entire bash block (source, conditional, hub.sh call) in the help output — producing noisy and incorrect help text.
- **Fix:** Added a `## Step 1 — Run the diff` H2 between the `## Help` section and the bash block. The `## Help` content was also slightly expanded (Usage + Options block) to match the canonical template used by the other 12 commands.
- **Files modified:** `plugins/arcanon/commands/diff.md`
- **Commit:** `a1e7bd0` (bundled with the Task 2 wave because the structural reshuffle is inseparable from adding the canonical content)

**3. [Rule 2 - Missing functionality] Iteration list did not include diff.md**

- **Found during:** Task 4
- **Issue:** The plan's bats iteration list and the file roster reference 12 commands. Reality is 13 (diff shipped in 115-02 between the time the plan was written and execution). Without including diff in HELP-01/HELP-04 iteration, contributors could ship a 14th command without `## Help` and the gate would still pass.
- **Fix:** Added `diff` to every iteration list in `tests/help.bats` (HELP-01, HELP-02, HELP-04 cases). Also documented the manual coupling with `commands-surface.bats:18` in a comment so future contributors know to update both.
- **Files modified:** `tests/help.bats`
- **Commit:** `f80b6ec`

### Authentication Gates

None — no auth-required steps in this plan.

## Verification Trace

| Check | Result |
|------|--------|
| `lib/help.sh` mode 644, sourceable, NOT executable | PASS (`-rw-r--r--`) |
| `bash plugins/arcanon/lib/help.sh` exits 1 with guard message | PASS (`Source this file; do not execute directly.`, exit 1) |
| `arcanon_extract_help_section` defined after source | PASS |
| `arcanon_print_help_if_requested` defined after source | PASS |
| Every command has exactly one `## Help` H2 | PASS (13/13) |
| Extractor returns rc=0 + non-empty for every command | PASS (13/13, sizes 330–1140 bytes) |
| `update.md` retains `claude plugin update --help` line | PASS (byte-identical content; now at line 23) |
| `doctor.md` retains `## Troubleshooting` heading | PASS |
| `bats tests/help.bats` | 8/8 PASS |
| `bats tests/commands-surface.bats` regression | 14/14 PASS |

## Self-Check: PASSED

- File `plugins/arcanon/lib/help.sh` — FOUND
- File `tests/help.bats` — FOUND
- Commit `690bf29` — FOUND
- Commit `a1e7bd0` — FOUND
- Commit `bed1ac7` — FOUND
- Commit `f80b6ec` — FOUND
- Commit `e299b8b` — FOUND
