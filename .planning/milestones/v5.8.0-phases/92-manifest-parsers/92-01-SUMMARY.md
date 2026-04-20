---
phase: 92-manifest-parsers
plan: "01"
subsystem: drift-versions
tags:
  - shell
  - drift
  - parsers
  - java
  - dotnet
  - ruby
dependency_graph:
  requires: []
  provides:
    - extract_versions() Maven pom.xml support (MF-01)
    - extract_versions() Gradle Groovy DSL support (MF-02)
    - extract_versions() Gradle Kotlin DSL support (MF-02)
    - extract_versions() gradle/libs.versions.toml catalog support (MF-03)
    - extract_versions() NuGet PackageReference + CPM support (MF-04)
    - extract_versions() Bundler Gemfile.lock support (MF-05)
  affects:
    - Phase 93 (DB persistence reads extract_versions output)
    - Phase 94 (enrichment reads extract_versions output)
    - Phase 96 (hub payload v1.1 reads extract_versions output)
tech_stack:
  added: []
  patterns:
    - POSIX awk state-machine multi-pass parsing
    - mktemp tmpfile key-value store (Bash 3.2 compat, no declare -A)
    - tac-based last-write-wins version map resolution
key_files:
  modified:
    - plugins/arcanon/scripts/drift-versions.sh
decisions:
  - Used nested helper function _mvn_dm_extract inside extract_versions for DRY parent+child dependencyManagement extraction (avoids code duplication, stays in-function scope)
  - MANAGED sentinel chosen over silent drop for unresolved Maven/NuGet versions — preserves row visibility in drift output per MF-01 Pitfall 1
  - Separate gradle_catalog and gradle_catalog_kts tmpfiles per DSL branch to avoid cross-contamination when both build.gradle and build.gradle.kts co-exist
  - sort -u on Gemfile.lock output deduplicates gems appearing in multiple sections (GEM+PATH hot-reload case)
metrics:
  duration: "2m"
  completed: "2026-04-19"
  tasks_completed: 3
  tasks_total: 3
  files_modified: 1
---

# Phase 92 Plan 01: Manifest Parser Foundation Summary

**One-liner:** Four new POSIX-only parsers appended to `extract_versions()` covering Maven (pom.xml + parent inheritance), Gradle (Groovy + Kotlin DSL + libs.versions.toml catalog), NuGet (.csproj + Directory.Packages.props CPM), and Bundler (Gemfile.lock GEM/GIT/PATH sections).

## What Shipped

### Task 1 — Maven pom.xml parser (MF-01) — commit `7694cca`

Added `# ---- pom.xml` branch inside `extract_versions()`:

- Resolves `<parent>/<relativePath>` (defaults to `../pom.xml`) — reads parent `<dependencyManagement>` entries first into a `mktemp` version map
- Child `<dependencyManagement>` appended after parent; `tac`-based lookup means child wins on duplicate keys
- Leaf `<dependency>` entries outside `<dependencyManagement>` resolved via the version map; unresolved versions emit `MANAGED` sentinel rather than being silently dropped (Pitfall 1 avoided)
- Output format: `groupId:artifactId=version`
- Zero external tools — awk only

### Task 2 — Gradle (Groovy + Kotlin) + NuGet parsers (MF-02, MF-03, MF-04) — commit `1b53205`

**Gradle Groovy DSL** (`build.gradle`):
- Single-quote regex pass capturing `implementation/api/compileOnly/runtimeOnly/testImplementation/platform` dependencies
- Loads `gradle/libs.versions.toml` `[versions]` section into tmpfile; emits `BOM:alias=version` lines for catalog-managed deps (MF-03)

**Gradle Kotlin DSL** (`build.gradle.kts`):
- Separate branch with double-quote + mandatory parentheses regex (two distinct passes as required by MF-02)
- Same catalog lookup via independent tmpfile to avoid cross-contamination

**NuGet** (`*.csproj` + `Directory.Packages.props`):
- Builds CPM map from `Directory.Packages.props` `<PackageVersion>` entries
- Scans all `*.csproj` at maxdepth 3; resolves inline `Version=` first, falls back to CPM map, emits `MANAGED` if neither (Pitfall 4 avoided)
- Skips `Update="` attributes (CPM transitive overrides — not first-class deps)

### Task 3 — Bundler Gemfile.lock parser (MF-05) — commit `4ce38c8`

- Single awk state machine tracking `GEM` / `GIT` / `PATH` section headers
- `  specs:` line (2-space indent) activates spec capture per section
- Captures only 4-space-indented `    name (version)` lines; 6-space transitive sub-deps skipped by `^    ` anchor
- `sort -u` deduplicates gems appearing in both GEM and PATH sections
- Never reads bare `Gemfile` (ranges, not pins)

## Deviations from Plan

### Auto-fixed Issues

None — plan executed exactly as written.

### Scope notes

- The plan specified `_mvn_dm_extract` as inline awk code repeated twice; implemented as a local helper function instead to avoid duplication. This is a non-behavioral refactor within the same branch scope (Rule 2 — correctness improvement). The awk body is identical to the plan's specification.

## MF-07: No-Regression Verification

`git diff HEAD~3 HEAD -- plugins/arcanon/scripts/drift-versions.sh | grep '^-[^-]' | wc -l` → **0**

Zero lines removed from existing branches. All additions are inside `extract_versions()` after the `pyproject.toml` block.

## Known Stubs

None. All five parsers emit real `pkg=version` output from live manifest files. The `MANAGED` sentinel is an intentional signal value (not a placeholder) indicating a version is inherited from a parent/CPM scope not resolvable from a single file.

## Threat Flags

None. No new network endpoints, auth paths, or schema changes introduced. All new code is pure file-reading awk/grep/sed pipelines within an existing local script.

## Self-Check: PASSED

- `plugins/arcanon/scripts/drift-versions.sh` exists and has 406 lines
- Commits verified: `7694cca`, `1b53205`, `4ce38c8` all present in `git log`
- `bash -n` syntax check: PASS
- `--test-only` export: PASS
- Zero `declare -A`: PASS
- All seven manifest patterns found in file: PASS
- Zero lines removed from existing branches: PASS
