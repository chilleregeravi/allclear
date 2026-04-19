---
phase: 92-manifest-parsers
plan: "02"
subsystem: drift-versions
tags: [shell, drift, bats, fixtures, maven, gradle, nuget, bundler]
dependency_graph:
  requires: [92-01]
  provides: [regression-guard-MF-07, fixtures-MF-06]
  affects: [tests/drift-versions.bats, tests/fixtures/drift/]
tech_stack:
  added: []
  patterns: [bats-assert --partial, source --test-only, assert_output]
key_files:
  created:
    - tests/fixtures/drift/maven-parent/pom.xml
    - tests/fixtures/drift/maven-parent/child/pom.xml
    - tests/fixtures/drift/gradle-kotlin/build.gradle.kts
    - tests/fixtures/drift/gradle-kotlin/gradle/libs.versions.toml
    - tests/fixtures/drift/nuget-cpm/Directory.Packages.props
    - tests/fixtures/drift/nuget-cpm/App.csproj
    - tests/fixtures/drift/gemfile-allsections/Gemfile.lock
  modified:
    - tests/drift-versions.bats
    - plugins/arcanon/scripts/drift-versions.sh
decisions:
  - Fixtures contain only the minimum files to trigger exactly one parser each — no cross-ecosystem contamination
  - Rule 1 bug fix applied to drift-versions.sh relativePath extraction (off-by-one RSTART+15 → RSTART+14)
metrics:
  duration: "202s"
  completed: "2026-04-19T15:32:04Z"
  tasks_completed: 2
  files_changed: 9
---

# Phase 92 Plan 02: Manifest Parser Fixtures + Bats Tests Summary

**One-liner:** Seven minimal fixture files plus 10 bats assertions cover Maven parent inheritance, Gradle Kotlin DSL + version catalog, NuGet CPM version-less PackageReference, and Gemfile.lock GEM/GIT/PATH sections; full 227-test suite green.

## Tasks Completed

| # | Task | Commit | Files |
|---|------|--------|-------|
| 1 | Create fixtures for all four new parsers (MF-06) | 1db7c2b | 7 fixture files created under tests/fixtures/drift/ |
| 2 | Add bats tests + fix Maven relativePath bug (MF-06, MF-07) | 0913992 | tests/drift-versions.bats (+107 lines), drift-versions.sh (1-line fix) |

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Fixed Maven `<relativePath>` off-by-one in drift-versions.sh**
- **Found during:** Task 2 — tests 16 and 17 failed with `MANAGED` output instead of resolved versions
- **Issue:** `awk` extracting `<relativePath>` used `RSTART+15` but `<relativePath>` is 14 characters. This stripped the leading character of the value: `../pom.xml` became `./pom.xml`. The parser resolved the parent POM to the child directory itself (self-reference), found no `<dependencyManagement>`, and fell back to `MANAGED` for all version-less deps.
- **Fix:** Changed offset from `RSTART+15` to `RSTART+14` in the `parent_rel` awk block.
- **Files modified:** `plugins/arcanon/scripts/drift-versions.sh` line 143
- **Commit:** 0913992

## Verification

- `bats tests/drift-versions.bats`: 25/25 pass (15 pre-existing + 10 new)
- `bats tests/`: 227/227 pass — zero regression
- All 7 fixture files confirmed present and minimal
- `maven-parent/child/pom.xml` has no inline `<version>` in `<dependencies>` block
- `gradle-kotlin/build.gradle.kts` uses double-quote Kotlin DSL syntax
- `nuget-cpm/App.csproj` has `<PackageReference>` with no `Version=` attribute
- `gemfile-allsections/Gemfile.lock` contains GEM, GIT, and PATH section headers

## Known Stubs

None.

## Threat Flags

None — no new network endpoints, auth paths, or schema changes introduced.

## Self-Check: PASSED
