---
phase: 92-manifest-parsers
plan: "04"
subsystem: drift-types
tags:
  - shell
  - drift
  - types
  - java
  - csharp
  - ruby

dependency_graph:
  requires:
    - plugins/arcanon/scripts/drift-types.sh (baseline ts/go/py/rs extractors)
    - plugins/arcanon/scripts/drift-common.sh (emit_finding, parse_drift_args)
  provides:
    - extract_java_types (TYPE-02)
    - extract_cs_types (TYPE-03)
    - extract_ruby_types (TYPE-04)
    - detect_repo_language java/cs/rb branches (TYPE-01)
    - extract_type_names java/cs/rb dispatch (TYPE-01)
    - --test-only guard in drift-types.sh
  affects:
    - /arcanon:drift types command (now works for Java/C#/Ruby repos)

tech_stack:
  added: []
  patterns:
    - POSIX stream processing (grep | sed | awk | sort -u) — no new declare -A (TYPE-05)
    - --test-only source guard (mirrors drift-versions.sh pattern)
    - tmpdir-free extractor design (pipe-only, no associative arrays)

key_files:
  created:
    - tests/drift-types.bats
    - tests/fixtures/drift/java-types-repo-a/pom.xml
    - tests/fixtures/drift/java-types-repo-a/src/main/java/com/example/User.java
    - tests/fixtures/drift/java-types-repo-b/pom.xml
    - tests/fixtures/drift/java-types-repo-b/src/main/java/com/example/User.java
    - tests/fixtures/drift/cs-types-repo-a/App.csproj
    - tests/fixtures/drift/cs-types-repo-a/User.cs
    - tests/fixtures/drift/cs-types-repo-b/App.csproj
    - tests/fixtures/drift/cs-types-repo-b/User.cs
    - tests/fixtures/drift/rb-types-repo-a/Gemfile
    - tests/fixtures/drift/rb-types-repo-a/user.rb
    - tests/fixtures/drift/rb-types-repo-b/Gemfile
    - tests/fixtures/drift/rb-types-repo-b/user.rb
  modified:
    - plugins/arcanon/scripts/drift-types.sh

decisions:
  - id: D1
    summary: "Added --test-only guard to drift-types.sh (mirroring drift-versions.sh) because sourcing the script without it fails under set -euo pipefail when LINKED_REPOS is unset"
  - id: D2
    summary: "partial class C# limitation documented as code comment only — cross-file type merging deferred per plan (Pitfall 13, Phase 92 out-of-scope)"

metrics:
  duration: "4 minutes"
  completed: "2026-04-19"
  tasks_completed: 2
  tasks_total: 2
  files_created: 13
  files_modified: 1
---

# Phase 92 Plan 04: Java/C#/Ruby Type Extractors Summary

Java, C#, and Ruby type extractors wired into drift-types.sh with POSIX stream pipelines, stdlib blacklist for Ruby monkey-patch guard, and 11 bats assertions covering TYPE-01 through TYPE-04.

## Tasks Completed

| Task | Name | Commit | Files |
|------|------|--------|-------|
| 1 | Extend detect_repo_language + add Java/C#/Ruby extractors | 1c9f5f6 | plugins/arcanon/scripts/drift-types.sh |
| 2 | Create fixtures + bats tests | 07de537 | tests/drift-types.bats + 12 fixture files |

## Decisions Made

**D1 — --test-only guard added to drift-types.sh**

drift-types.sh uses `set -euo pipefail` and references `$LINKED_REPOS` in its main loop. Sourcing without a guard causes exit status 2 in the bats test context. Added a `--test-only` loop (3 lines, mirrors drift-versions.sh lines 303-309) that exports all public functions and returns before the main loop. This is an application of Deviation Rule 3 (blocking issue auto-fix) — without it, all 11 bats tests failed with empty output.

**D2 — partial class C# limitation documented in code, not fixed**

`extract_cs_types` matches `partial class Foo` and captures `Foo` — multiple partial class files would each emit the type name independently. The code comment and plan explicitly note this as a known limitation (Pitfall 13) out of Phase 92 scope. The `sort -u` in the pipeline means duplicate names collapse, so it causes no false duplicates in practice for single-file partial classes.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Added --test-only guard to drift-types.sh**
- **Found during:** Task 2 bats test run
- **Issue:** Sourcing `drift-types.sh` inside bats triggered main loop execution, which exits non-zero when `LINKED_REPOS` is unset — all 11 tests produced empty output and failed
- **Fix:** Added 11-line `--test-only` guard block before `declare -A lang_repos` (mirrors established drift-versions.sh pattern at lines 303-309); updated all bats `source` calls to pass `--test-only`
- **Files modified:** plugins/arcanon/scripts/drift-types.sh, tests/drift-types.bats
- **Commit:** 07de537 (bundled with Task 2 commit)

## Success Criteria Verification

- [x] TYPE-01: `detect_repo_language` returns `java` / `cs` / `rb`; `extract_type_names` dispatcher routes to correct extractor
- [x] TYPE-02: `extract_java_types` captures `public class/interface/record/enum`; generic bound `<T extends Comparable<T>>` stripped to `User`
- [x] TYPE-03: `extract_cs_types` captures `public class/record/struct/enum/interface`; `partial class` limitation documented as code comment
- [x] TYPE-04: `extract_ruby_types` captures top-level `class/module` only; `String.class_eval` and `String` stdlib name do NOT leak (bats `refute_output` proves it)
- [x] TYPE-05: `git diff HEAD~2 plugins/arcanon/scripts/drift-types.sh | grep '^+' | grep -c 'declare -A'` = 0
- [x] `bats tests/drift-types.bats` green — 11/11 assertions pass
- [x] `bats tests/` green — 217/217 tests pass, zero regressions

## Known Stubs

None — all three extractors are fully wired and produce real output from fixture files.

## Threat Flags

None — no new network endpoints, auth paths, or trust boundaries introduced. Script is a read-only local filesystem scanner.

## Self-Check: PASSED

- plugins/arcanon/scripts/drift-types.sh: FOUND
- tests/drift-types.bats: FOUND
- tests/fixtures/drift/java-types-repo-a/src/main/java/com/example/User.java: FOUND
- tests/fixtures/drift/cs-types-repo-a/User.cs: FOUND
- tests/fixtures/drift/rb-types-repo-a/user.rb: FOUND
- Commit 1c9f5f6: FOUND
- Commit 07de537: FOUND
