---
phase: 92-manifest-parsers
verified: 2026-04-19T17:40:00+02:00
status: passed
score: 15/15
overrides_applied: 0
re_verification: false
---

# Phase 92: Manifest Parser Foundation + Language Detection + Type Extraction — Verification Report

**Phase Goal:** drift-versions.sh gains parsers for Maven, Gradle (Groovy + Kotlin DSL), NuGet (including CPM), and Bundler; detect.sh and discovery.js gain Java/dotnet/Ruby language branches; drift-types.sh gains java/cs/rb type extractors.
**Verified:** 2026-04-19T17:40:00+02:00
**Status:** PASSED
**Re-verification:** No — initial verification

---

## Goal Achievement

### Observable Truths

| # | Truth | Status | Evidence |
|---|-------|--------|----------|
| 1 | `extract_versions` emits `pkg=version` for Maven `pom.xml` with parent `<dependencyManagement>` resolution (not empty/MANAGED) | VERIFIED | drift-versions.sh lines 122-173; `_mvn_dm_extract` helper + tac lookup; child fixture has no inline version; bats tests 16-17 pass asserting `org.springframework.boot:spring-boot-starter-web=3.2.1` and `com.fasterxml.jackson.core:jackson-databind=2.16.1` |
| 2 | `extract_versions` emits `pkg=version` for Gradle Groovy DSL (`build.gradle`) AND Kotlin DSL (`build.gradle.kts`) with separate passes | VERIFIED | drift-versions.sh lines 175-227; two independent `if` branches with separate `gradle_catalog` / `gradle_catalog_kts` tmpfiles; Kotlin branch uses double-quote + mandatory-parentheses regex; bats tests 18-20 assert `org.jetbrains.kotlinx:kotlinx-coroutines-core=1.7.3` and `com.squareup.okhttp3:okhttp=4.12.0` |
| 3 | `extract_versions` resolves `gradle/libs.versions.toml` `[versions]` catalog aliases and emits `BOM:<alias>=<version>` | VERIFIED | drift-versions.sh lines 179-198 (Groovy) and 206-225 (Kotlin); `libs.versions.toml` fixture has `[versions]` with `spring-boot = "3.2.1"`; bats test asserts `BOM:spring-boot=3.2.1` |
| 4 | `extract_versions` resolves NuGet `<PackageReference>` including CPM (`Directory.Packages.props`) — CPM-only projects produce non-empty lists | VERIFIED | drift-versions.sh lines 229-256; `cpm_map` built from `<PackageVersion>` entries; `App.csproj` has two `<PackageReference>` with NO `Version=` attributes; bats asserts `Newtonsoft.Json=13.0.3` and `Serilog=3.1.1` |
| 5 | `extract_versions` parses `Gemfile.lock` covering GEM, GIT, and PATH sections (never bare `Gemfile`) | VERIFIED | drift-versions.sh lines 258-274; awk state machine tracks GEM/GIT/PATH section headers; `gemfile-allsections/Gemfile.lock` has all three sections; bats asserts `rails=7.1.2`, `internal-lib=0.1.0`, `local-gem=0.2.0` |
| 6 | Existing npm / pypi / go / cargo branches unchanged — no regression | VERIFIED | `grep '^-[^-]' git diff` shows zero lines removed from existing branches (SUMMARY 92-01 confirms); bats 227/227 pass including all pre-existing DRFT-01/05/06 tests |
| 7 | All new parsers use POSIX awk/grep/sed only — zero new runtime deps, Bash 3.2 compatible (no new `declare -A`) | VERIFIED | drift-versions.sh has no `declare -A` anywhere; new parser branches use only `mktemp`, `awk`, `grep`, `sed`, `tac`, `find`, `compgen -G` (all POSIX/bash builtins); TYPE-05 confirmed below |
| 8 | `detect_language` returns `java` / `csharp` / `ruby` for `.java` / `.cs` / `.rb` file extensions | VERIFIED | detect.sh lines 19-21: `java) echo "java"`, `cs) echo "csharp"`, `rb) echo "ruby"`; detect.bats tests pass for all three |
| 9 | `detect_project_type` returns `java` for pom.xml/build.gradle/build.gradle.kts; `dotnet` for *.csproj/*.sln; `ruby` for Gemfile — priority: python > rust > node > go > java > dotnet > ruby | VERIFIED | detect.sh lines 42-47 show three new `elif` clauses appended after `go.mod`; `compgen -G` used for glob-based dotnet detection; priority tests (python-over-java, node-over-ruby) in detect.bats pass |
| 10 | `detect_all_project_types` lists java/dotnet/ruby alongside existing types when multiple manifests present | VERIFIED | detect.sh lines 64-66 append three `types+=` lines; detect.bats confirms multi-type detection passes |
| 11 | `discovery.js` MANIFESTS includes `build.gradle`, `build.gradle.kts`, `Gemfile` (pom.xml was already present) | VERIFIED | discovery.js lines 23-32: MANIFESTS array contains all eight entries including the three new ones; pom.xml confirmed present from pre-Phase-92 state |
| 12 | `detect_repo_language` in drift-types.sh returns `java` / `cs` / `rb` for appropriate repos | VERIFIED | drift-types.sh lines 25-29: java (pom.xml/build.gradle/build.gradle.kts), cs (compgen -G *.csproj or *.sln), rb (Gemfile); drift-types.bats TYPE-01 tests pass |
| 13 | `extract_java_types` captures `public interface\|class\|record\|enum <Name>` including generic bounds | VERIFIED | drift-types.sh lines 91-106; Java fixture `User<T extends Comparable<T>>` is captured as `User` (generic bound stripped by `sed -E 's/[<({].*//'`); TYPE-02 bats test passes with `refute_output --regexp '^User<'` |
| 14 | `extract_cs_types` captures `public interface\|class\|record\|struct\|enum <Name>`; `partial class` documented as limitation | VERIFIED | drift-types.sh lines 113-123; cs fixture has `public class User` and `public record UserDto`; both captured; code comment documents partial class limitation per plan D2; bats TYPE-03 tests pass |
| 15 | `extract_ruby_types` captures top-level `class\|module <Name>`; no false positive on `self.class_eval` or stdlib names (String/Array/Hash...) | VERIFIED | drift-types.sh lines 131-139; Ruby fixture has `class User` (captured) and `String.class_eval` block (not matched because `String.class_eval` doesn't match `^(class\|module)`); stdlib blacklist grep at line 138 covers 20 core names; bats TYPE-04 tests pass including `refute_output --regexp '^String$'` |

**Score:** 15/15 truths verified

---

## Required Artifacts

| Artifact | Expected | Status | Details |
|----------|----------|--------|---------|
| `plugins/arcanon/scripts/drift-versions.sh` | Maven, Gradle (Groovy+Kotlin+catalog), NuGet CPM, Bundler parsers in `extract_versions()` | VERIFIED | Contains `# ---- pom.xml`, `# ---- build.gradle`, `# ---- build.gradle.kts`, `# ---- *.csproj`, `# ---- Gemfile.lock` branches; 274 lines |
| `plugins/arcanon/lib/detect.sh` | `detect_language` + `detect_project_type` + `detect_all_project_types` extended with java/csharp/ruby | VERIFIED | All three functions extended; docstring updated with new priority chain |
| `plugins/arcanon/worker/scan/discovery.js` | MANIFESTS extended with `build.gradle`, `build.gradle.kts`, `Gemfile` | VERIFIED | Lines 23-32 show 8-entry array |
| `plugins/arcanon/scripts/drift-types.sh` | `extract_java_types`, `extract_cs_types`, `extract_ruby_types`; `detect_repo_language` extended; `extract_type_names` dispatcher extended; `--test-only` guard | VERIFIED | All three extractors present (lines 91-140); dispatcher case at lines 151-155; `--test-only` guard at lines 195-201 |
| `tests/fixtures/drift/maven-parent/pom.xml` | Parent POM with `<dependencyManagement>` | VERIFIED | Contains `<dependencyManagement>` block with spring-boot-starter-web=3.2.1 and jackson-databind=2.16.1 |
| `tests/fixtures/drift/maven-parent/child/pom.xml` | Child POM with `<parent>` relativePath + version-less `<dependency>` | VERIFIED | `<relativePath>../pom.xml</relativePath>` present; both deps have NO `<version>` element |
| `tests/fixtures/drift/gradle-kotlin/build.gradle.kts` | Kotlin DSL double-quote syntax | VERIFIED | Uses `implementation("...")` with double-quotes and parentheses (not Groovy single-quote) |
| `tests/fixtures/drift/gradle-kotlin/gradle/libs.versions.toml` | Version catalog `[versions]` section | VERIFIED | Contains `[versions]` section with `spring-boot = "3.2.1"` |
| `tests/fixtures/drift/nuget-cpm/Directory.Packages.props` | CPM `<PackageVersion>` entries | VERIFIED | Exists with `PackageVersion` entries for Newtonsoft.Json and Serilog |
| `tests/fixtures/drift/nuget-cpm/App.csproj` | CPM-style `<PackageReference>` with NO `Version=` | VERIFIED | Both `<PackageReference>` entries have no `Version=` attribute |
| `tests/fixtures/drift/gemfile-allsections/Gemfile.lock` | GEM + GIT + PATH sections, one gem each | VERIFIED | GIT section: `internal-lib (0.1.0)`; PATH section: `local-gem (0.2.0)`; GEM section: `rails (7.1.2)` |
| `tests/drift-versions.bats` | New test cases for each fixture | VERIFIED | 10 new tests added (lines 184-287); all 25 tests pass |
| `tests/fixtures/drift/java-types-repo-a/src/main/java/com/example/User.java` | Java User class fixture | VERIFIED | `public class User<T extends Comparable<T>>` |
| `tests/fixtures/drift/cs-types-repo-a/User.cs` | C# User class fixture | VERIFIED | `public class User` + `public record UserDto` |
| `tests/fixtures/drift/rb-types-repo-a/user.rb` | Ruby User class fixture with monkey-patch trap | VERIFIED | `class User` + `String.class_eval` block (tests the non-capture path) |
| `tests/drift-types.bats` | TYPE-01..04 bats coverage | VERIFIED | 11 tests covering detect_repo_language, extract_java_types, extract_cs_types, extract_ruby_types, and dispatcher wiring |
| `tests/detect.bats` | LANG-01/02 bats coverage | VERIFIED | 9 new tests appended (lines 127-200): 3 detect_language, 4 detect_project_type manifest tests, 2 priority-order regression tests |

---

## Key Link Verification

| From | To | Via | Status | Details |
|------|----|-----|--------|---------|
| `drift-versions.sh extract_versions()` | pom.xml / build.gradle / build.gradle.kts / *.csproj / Gemfile.lock | POSIX awk/grep/sed per manifest | VERIFIED | Pattern `pom\.xml\|build\.gradle\|\.csproj\|Gemfile\.lock` confirmed in each branch's `if [[ -f ... ]]` guard |
| `detect.sh detect_project_type` | session-start.sh banner | sourced function call | VERIFIED | `detect_project_type` function exists and is exported; detect.sh is source-only (guarded at line 6) |
| `discovery.js MANIFESTS` | linked-repo discovery fs.existsSync | MANIFESTS array | VERIFIED | `discoverNew()` at line 76 iterates MANIFESTS; all 8 entries present |
| `drift-types.sh detect_repo_language` | `extract_type_names` dispatcher | case dispatch on java/cs/rb tokens | VERIFIED | `extract_type_names` case at lines 147-155 handles `java`, `cs`, `rb`; `detect_repo_language` emits those exact tokens |

---

## Data-Flow Trace (Level 4)

Not applicable — all deliverables are shell script functions and static config arrays, not components rendering dynamic data from a DB/API. The bats tests serve as functional proof of data flow: fixture files on disk → parser function → `pkg=version` output lines.

---

## Behavioral Spot-Checks

| Behavior | Command | Result | Status |
|----------|---------|--------|--------|
| Maven parent inheritance resolves to non-empty version | `source drift-versions.sh --test-only; extract_versions tests/fixtures/drift/maven-parent/child` | `org.springframework.boot:spring-boot-starter-web=3.2.1` | PASS (confirmed via bats) |
| Kotlin DSL double-quote deps extracted | bats test 18 | `org.jetbrains.kotlinx:kotlinx-coroutines-core=1.7.3` | PASS (confirmed via bats) |
| NuGet CPM version-less PackageReference resolved | bats test 22 | `Newtonsoft.Json=13.0.3` | PASS (confirmed via bats) |
| Gemfile.lock GIT section captured | bats test 25 | `internal-lib=0.1.0` | PASS (confirmed via bats) |
| Ruby stdlib blacklist prevents `String` emission | bats `refute_output --regexp '^String$'` | No String in output | PASS (confirmed via bats) |
| Full suite — no regressions | `bats tests/` | 227/227 pass, 0 failures | PASS (confirmed live run) |

---

## Requirements Coverage

| Requirement | Source Plan | Description | Status | Evidence |
|-------------|------------|-------------|--------|----------|
| MF-01 | 92-01 | Maven pom.xml parent inheritance resolution | SATISFIED | `_mvn_dm_extract` + tac lookup in drift-versions.sh; REQUIREMENTS.md marked [x] |
| MF-02 | 92-01 | Gradle Groovy + Kotlin DSL separate passes | SATISFIED | Two independent branches; separate tmpfile variables |
| MF-03 | 92-01 | Gradle libs.versions.toml catalog resolution | SATISFIED | `[versions]` awk section in both Groovy and Kotlin branches |
| MF-04 | 92-01 | NuGet PackageReference + CPM Directory.Packages.props | SATISFIED | `cpm_map` built from `<PackageVersion>`; inline-Version fallback to CPM fallback to MANAGED |
| MF-05 | 92-01 | Bundler Gemfile.lock GEM+GIT+PATH (never bare Gemfile) | SATISFIED | awk state machine; no Gemfile branch anywhere in drift-versions.sh |
| MF-06 | 92-02 | Bats fixtures for each parser edge case | SATISFIED | 4 fixture directories; 7 fixture files; 10 bats tests |
| MF-07 | 92-01/02 | No regression in npm/pypi/go/cargo; bats suite green | SATISFIED | 227/227 pass; 0 lines removed from existing branches |
| LANG-01 | 92-03 | detect_language returns java/csharp/ruby | SATISFIED | detect.sh lines 19-21 |
| LANG-02 | 92-03 | Priority order: existing four kept, java/dotnet/ruby appended | SATISFIED | detect.sh comment line 30: "python > rust > node > go > java > dotnet > ruby"; code matches |
| LANG-03 | 92-03 | discovery.js MANIFESTS includes pom.xml + build.gradle + build.gradle.kts + Gemfile | SATISFIED | 8-entry MANIFESTS array; pom.xml was pre-existing |
| TYPE-01 | 92-04 | detect_repo_language returns java/cs/rb; extract_type_names dispatches correctly | SATISFIED | drift-types.sh lines 25-29 + 147-155 |
| TYPE-02 | 92-04 | Java extractor captures public interface/class/record/enum with generic bounds | SATISFIED | drift-types.sh lines 91-106; generic bound stripped by sed |
| TYPE-03 | 92-04 | C# extractor captures public interface/class/record/struct/enum; partial class documented | SATISFIED | drift-types.sh lines 113-123; code comment at line 110-112 documents limitation |
| TYPE-04 | 92-04 | Ruby extractor captures class/module; no false positive on class_eval or stdlib | SATISFIED | drift-types.sh lines 131-139; stdlib blacklist 20 names at line 138; `^(class\|module)` anchor prevents `String.class_eval` match |
| TYPE-05 | 92-04 | New extractors use NO new `declare -A` — tmpdir pattern or pipe-only | SATISFIED | Java/C#/Ruby extractors are pure grep/sed/awk/find pipelines; no WORK_DIR or declare -A added by Phase 92. Pre-existing `declare -A lang_repos` at line 205 is Phase 95 scope (DSP-10). |

---

## Anti-Patterns Found

| File | Line | Pattern | Severity | Impact |
|------|------|---------|----------|--------|
| `drift-types.sh` | 224, 278 | `declare -A type_repos` (unset+re-declare per language loop iteration) | Info | Pre-existing from baseline; Phase 95 (DSP-10) owns the fix. Not introduced by Phase 92. |

No blockers or warnings found in Phase 92 additions.

---

## Human Verification Required

None. All success criteria are verifiable programmatically through the bats suite and direct code inspection.

---

## Gaps Summary

No gaps. All 15 requirements verified. Bats suite passes 227/227 with zero regressions.

---

_Verified: 2026-04-19T17:40:00+02:00_
_Verifier: Claude (gsd-verifier)_
