---
phase: 92-manifest-parsers
plan: "03"
subsystem: detect-shell
tags:
  - shell
  - detect
  - discovery
  - language
dependency_graph:
  requires: []
  provides:
    - detect_language java/csharp/ruby branches
    - detect_project_type java/dotnet/ruby priority branches
    - detect_all_project_types java/dotnet/ruby detection
    - MANIFESTS build.gradle build.gradle.kts Gemfile
  affects:
    - plugins/arcanon/lib/session-start.sh (banner language display)
    - plugins/arcanon/worker/scan/discovery.js (linked-repo discovery)
tech_stack:
  added: []
  patterns:
    - compgen -G for glob-prefix manifest detection (.csproj/.sln)
key_files:
  created: []
  modified:
    - plugins/arcanon/lib/detect.sh
    - plugins/arcanon/worker/scan/discovery.js
    - tests/detect.bats
decisions:
  - "Use `compgen -G` (bash builtin) for .csproj/.sln glob detection — no subprocess, stderr redirected to /dev/null for portability"
  - "Language token for C# is `csharp` in detect_language, `dotnet` in detect_project_type — matches CLI naming convention per LANG-02 constraint"
  - "pom.xml was already in MANIFESTS; only Gradle and Gemfile appended (append-only, no reorder)"
metrics:
  duration_minutes: 3
  completed_date: "2026-04-19"
  tasks_completed: 2
  files_modified: 3
requirements:
  - LANG-01
  - LANG-02
  - LANG-03
---

# Phase 92 Plan 03: Java/dotnet/Ruby Language Detection Summary

Java, .NET, and Ruby language detection added to `detect.sh` across all three detection functions, and `discovery.js` MANIFESTS extended with Gradle and Gemfile entries so `/ligamen:map` discovers those repo types during linked-repo scanning.

## Tasks Completed

| Task | Name | Commit | Files |
|------|------|--------|-------|
| 1 | Extend detect.sh with java/csharp/ruby branches | 60aeb44 | plugins/arcanon/lib/detect.sh |
| 2 | Extend MANIFESTS + add detect.bats coverage | 22aa44f | plugins/arcanon/worker/scan/discovery.js, tests/detect.bats |

## What Was Built

### Task 1 — detect.sh (LANG-01, LANG-02)

Three surgical edits to `plugins/arcanon/lib/detect.sh`:

- `detect_language`: added `java`, `csharp`, `ruby` case arms before the `json` branch
- `detect_project_type`: appended three `elif` clauses after `go.mod` check in priority order `java > dotnet > ruby`; updated header comment to document new priority chain
- `detect_all_project_types`: appended three `types+=` lines in the same priority order

The `dotnet` branch uses `compgen -G` (bash builtin) to detect glob-named files like `MyApp.csproj` and `Solution.sln` where a literal filename check would miss them.

### Task 2 — discovery.js + detect.bats (LANG-03)

- `MANIFESTS` in `discovery.js` extended with `build.gradle`, `build.gradle.kts`, `Gemfile` (append-only; `pom.xml` was already present, verified)
- `tests/detect.bats` extended with 9 new `@test` blocks:
  - 3 `detect_language` tests (java/csharp/ruby)
  - 4 `detect_project_type` manifest tests (pom.xml, build.gradle.kts, *.csproj, Gemfile)
  - 2 LANG-02 priority-order regression tests (python-over-java, node-over-ruby)

All 19 tests pass (10 existing + 9 new).

## Deviations from Plan

None — plan executed exactly as written.

## Known Stubs

None.

## Threat Flags

None — no new network endpoints, auth paths, or trust boundary changes introduced.

## Self-Check: PASSED

- `plugins/arcanon/lib/detect.sh` modified: FOUND (60aeb44)
- `plugins/arcanon/worker/scan/discovery.js` modified: FOUND (22aa44f)
- `tests/detect.bats` modified: FOUND (22aa44f)
- All 19 bats tests pass
- `bash -n` syntax check passes
- `node --check` syntax check passes
