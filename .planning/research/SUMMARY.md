# Project Research Summary

**Project:** arcanon Claude Code plugin — v5.8.0 Library Drift & Language Parity
**Domain:** Claude Code plugin extension — SQLite persistence, shell manifest parsing, Node.js enrichment
**Researched:** 2026-04-19
**Confidence:** HIGH (all findings grounded in direct codebase inspection)

---

## Executive Summary

v5.8.0 adds three Linear tickets (THE-1019, THE-1020, THE-1021) to an already-shipping plugin. THE-1020 (Java/C#/Ruby language parity) and THE-1021 (drift dispatcher + shell cleanup) are largely additive, extending established patterns with no structural changes. THE-1019 (library dependency persistence) is the only ticket that introduces a new DB table, a new enrichment module, and a payload schema version bump — it is the critical path and must be sequenced carefully inside the existing scan pipeline. The combined scope is achievable without any new runtime dependencies: every parser uses POSIX awk, grep, or sed already present in the plugin's shell layer, and the Node.js layer stays entirely within better-sqlite3 and the standard library.

The recommended approach is to build in three batches. Batch 1 is fully parallel: the new manifest parsers, detect.sh language branches, `lib/worker-restart.sh`, and `scripts/drift.sh` are all new files or purely additive edits with zero cross-dependencies. Batch 2 wires batch-1 foundations into the enrichment layer (auth-db-extractor.js signals for Java/Ruby, and the session-start/worker-start shell refactor). Batch 3 is THE-1019's internal chain: migration 010 -> `query-engine.js upsertDependency()` -> `dep-collector.js` -> `manager.js` Phase B loop -> `payload.js` v1.1 -- each step depends on the previous and the whole chain is independent of batches 1 and 2. THE-1019 and THE-1020/1021 can therefore be worked in parallel by different developers.

The primary risks are correctness risks in the manifest parsers, not architectural risks. Maven `<parent>` inheritance, Gradle's dual Groovy/Kotlin DSL, Gemfile.lock's three-section format, and NuGet Central Package Management (`Directory.Packages.props`) are all "looks done but isn't" traps where a parser passes a simple fixture but silently drops real-world dependencies. The DB schema for `service_dependencies` must include a `dep_kind` discriminant column (direct vs. transient) and a four-column UNIQUE constraint `(service_id, ecosystem, name, manifest_file)` from the initial migration -- retrofitting either after data is in production is a HIGH-cost recovery. The payload v1.1 `dependencies` field must be gated behind a feature flag until hub THE-1018 ships; emitting it unconditionally risks silent data loss at older hub instances.

---

## Key Findings

### Recommended Stack

**Decision already made: zero new runtime dependencies.** All new functionality is implemented with tools already required by the plugin. The shell layer uses POSIX awk, grep, and sed. The Node.js layer uses `node:fs`, `node:path`, and the already-present `better-sqlite3`. No `npm install` is required. The `yq` optional fast-path for Cargo/pypi is irrelevant here -- it cannot parse XML, so Maven/NuGet parsers are pure POSIX awk/grep regardless. `jq` (already required per PLGN-07) is unchanged.

**Core technologies for v5.8.0 additions:**

- **POSIX awk (state machine)** -- `pom.xml` and `Gemfile.lock` parsing; 20-25 lines per parser; no xmlstarlet required
- **grep + awk/sed** -- Gradle (both DSL flavours) and NuGet `.csproj` parsing; simpler than awk state machine for line-oriented formats
- **better-sqlite3** -- `service_dependencies` table upserts via `ON CONFLICT DO UPDATE`; established project decision, row-ID stability preserved
- **POSIX sh / Bash 4+** -- `drift.sh` dispatcher and `worker-restart.sh`; new files, additive only
- **node:test** -- unit test framework for all new Node.js modules; existing pattern in the codebase

**Version decisions:**
- SQLite migration sequence: next is `010_service_dependencies.js` (migrations 001-009 confirmed shipped)
- `ScanPayloadV1` bumps to `"1.1"` only when `dependencies` array is non-empty; falls back to `"1.0"` unconditionally when empty -- Hub receives valid v1.0 for all existing scans

### Expected Features

**Must ship (v5.8.0 table stakes):**
- User can see which library version each service uses -- requires `service_dependencies` table + scan-time manifest parsing (THE-1019 critical path)
- `/arcanon:drift versions` shows Maven (pom.xml) packages -- Java is the highest-volume language gap
- `/arcanon:drift versions` shows NuGet (.csproj) packages -- .NET is the second-highest-volume gap
- `/arcanon:drift versions` shows Bundler (Gemfile.lock) packages -- Gemfile.lock gives pinned resolved versions; never parse `Gemfile` (ranges only)
- `/arcanon:upload` includes `dependencies` in payload (v1.1) -- once deps are persisted locally, omitting them from upload makes persistence feel pointless
- Plugin emits v1.0 payload when no deps are stored -- non-negotiable backwards compat
- Auth mechanism + DB backend visible in detail panel for Java services (Spring Security / Spring Data)
- Auth mechanism + DB backend visible in detail panel for C# services (ASP.NET Identity / EF Core)
- Auth mechanism + DB backend visible in detail panel for Ruby services (Devise / ActiveRecord)
- Single `/arcanon:drift` entry point dispatches to all checks -- unified DX for polyglot orgs
- No regressions in existing npm/go/cargo/pypi drift output

**Should ship (competitive differentiators):**
- Unified drift dispatcher with reserved subcommand slots (`licenses`, `security`) -- clean extension points, no implementation needed yet
- `dep_kind` discriminant in `service_dependencies` schema -- required for correct future transient-dep handling; zero cost to add now

**Defer to v5.9.x / future:**
- `/arcanon:drift types` for Java class / C# interface name mismatches -- P2, lower urgency than version parity
- `--include-dev` flag for devDependencies in persistence -- current npm extractor includes dev deps in drift-versions.sh (low harm), but `service_dependencies` stores production only by default
- MCP tool `list_service_deps` -- P2, enables agent-autonomous dep analysis
- Transitive dependency trees -- hub-side feature (THE-1018), not plugin-side; would bloat SQLite with 500-2000 rows per service
- CVE alerts, license conflict checks -- require external feeds; violate no-external-service-deps constraint

**Anti-features (do not build):**
- `xmlstarlet` or AST parsers (JavaParser, Roslyn, tree-sitter) -- violate zero-external-dep and agent-first constraints
- `mvn`/`gradle`/`dotnet list` invocations -- require buildable project; fail on bare clones
- Resolve `^1.2.3` ranges to pinned versions at scan time -- requires `npm install` / `bundle install`; breaks offline/air-gapped environments
- Auto-upgrade PRs -- out of scope per project constraints; plugin has write access, unsafe without review

**Open questions for requirements phase:**
1. `devDependencies` in `service_dependencies`? Features says production-only by default; drift-versions.sh currently includes them. Requirements must align both layers or accept divergence.
2. Transient deps in scope? Pitfalls says add `dep_kind` column now but no transient parsing in v5.8.0. Requirements must confirm column-in, parsing-out.
3. Spring Security 5 vs 6 -- ship both patterns? Pitfalls + Stack both say yes (both already in Stack researcher's AUTH_SIGNALS.java). Requirements must make explicit.
4. Gemfile vs Gemfile.lock -- Stack + Features converged: Gemfile.lock only. Decision is made, not an open question.

### Architecture Integration Points

The following file:line anchors are exact edit locations derived from direct codebase inspection (ARCHITECTURE.md, HIGH confidence):

**THE-1019 -- Library Dependency Persistence:**

| File | Location | Change |
|------|----------|--------|
| `worker/db/migrations/010_service_dependencies.js` | NEW | `service_dependencies` table + 3 indexes |
| `worker/scan/enrichment/dep-collector.js` | NEW | Reads manifests -> normalised array -> `queryEngine.upsertDependency()` |
| `worker/db/query-engine.js` | add method + prepared statement in constructor | `upsertDependency()` via `ON CONFLICT DO UPDATE` |
| `worker/scan/manager.js` | line 776 -- after `runEnrichmentPass` in Phase B loop | `await collectDependencies(...)` call |
| `worker/hub-sync/payload.js` | line 93 (`buildFindingsBlock`) + line 201 (`buildScanPayload`) | `deps` array + `schemaVersion` field; conditional `version` field |

Critical constraint: `dep-collector.js` MUST NOT call `beginScan`/`endScan`. It runs after `endScan()` has closed the bracket (line 766). The existing `services` query at manager.js line 773 already selects `root_path` -- no second query needed. `ON DELETE CASCADE` from `services(id)` means `endScan()` stale-service cleanup automatically removes orphan dep rows; no new cleanup statements in `endScan` needed.

**THE-1020 -- Three New Language Ecosystems:**

| File | Location | Change |
|------|----------|--------|
| `lib/detect.sh` | lines 29-42, 48-56, 10-23 | `java`/`dotnet`/`ruby` branches; banner-only, safe to land anytime |
| `worker/scan/discovery.js` | lines 23-29 (MANIFESTS array) | Add `build.gradle`, `build.gradle.kts`, `Gemfile` -- repo link-suggestion UI only |
| `worker/scan/enrichment/auth-db-extractor.js` | lines 193-200 (LANG_EXTENSIONS) + AUTH_SIGNALS + DB_SOURCE_SIGNALS | Java (`.java`), Ruby (`.rb`), C# (`.cs`) entries |

Note: `manager.js` `detectRepoType()` at lines 226-238 already handles `build.gradle`/`build.gradle.kts` for Java -- no change needed there. The `discovery.js` MANIFESTS list and `detectRepoType()` are independent.

**THE-1021 -- Unified Drift Dispatcher + Shell Cleanup:**

| File | Location | Change |
|------|----------|--------|
| `lib/worker-restart.sh` | NEW | `should_restart_worker()` + `restart_worker_if_stale()` functions |
| `scripts/drift.sh` | NEW | Thin subcommand router -- `exec bash` for single commands, plain `bash` for `all` |
| `scripts/session-start.sh` | lines 43-68 | Replace inline restart logic with `source worker-restart.sh` + `restart_worker_if_stale` |
| `scripts/worker-start.sh` | lines 28-61 | Same replacement |

Dispatcher must use `bash "${SCRIPT_DIR}/subcommand.sh" "$@"` (subprocess), never `source`. The `drift-common.sh` `return 0` guard (not `exit`) must not be changed -- subcommands are called as subshells, each sources drift-common.sh independently.

**`EXCLUDED_DIRS` additions (auth-db-extractor.js):**
- Add `target` (Maven build output) -- currently missing; allows traversal of `target/generated-sources/*.java`
- Add `obj` and `bin` (MSBuild output) -- currently missing; allows traversal of generated `.cs` files

**`detectDbFromEnv()` addition:**
- Add `config/database.yml` to probed files list; match `adapter:` key for Rails DB backend detection (not just `DATABASE_URL`)

### Critical Pitfalls

The five pitfalls the roadmapper must explicitly schedule into phases:

**1. Maven `<parent>` inheritance silently drops managed deps (CRITICAL -- Phase 1)**
Naive single-file pom.xml parsing produces `pkg=` lines with empty version right-hand sides, which the existing `[[ -z "${ver:-}" ]] && continue` guard silently drops. Fix: parse `<parent>/<relativePath>`, build a version map from `<dependencyManagement>`, resolve leaf deps against it. Emit `MANAGED` as sentinel for unresolved. Write a two-level pom fixture test. Phase 1 correctness -- wrong parse output feeds wrong DB rows downstream.

**2. Gradle dual DSL -- Groovy single-quote vs. Kotlin double-quote (CRITICAL -- Phase 1)**
One regex cannot match both `implementation 'g:a:v'` (Groovy) and `implementation("g:a:v")` (Kotlin). Additionally `platform(libs.spring.bom)` version-catalog entries have no inline version. Fix: two separate awk/grep passes, one per DSL. Parse `gradle/libs.versions.toml` `[versions]` section as secondary source; emit `BOM:alias=version` lines. Two-DSL test fixture required from day one.

**3. `dep_kind` discriminant missing from migration 010 -- unrecoverable without migration 011 (CRITICAL -- Phase 2)**
Without `dep_kind TEXT NOT NULL CHECK(dep_kind IN ('direct', 'transient'))`, `endScan()` cleanup cannot distinguish direct-only from transient scans. When transient parsing lands later, the first scan silently deletes prior transient rows. Recovery requires ALTER TABLE + full backfill (HIGH cost). Fix: include `dep_kind` in migration 010 from the start even though transient parsing ships later.

**4. THE-1019 vs. THE-1020 ordering gap -- partial dep coverage silent in hub payload (HIGH -- Phase 1 + Phase 2)**
If THE-1020 shell parsers (maven/nuget/bundler) land before THE-1019 worker-side `dep-collector.js` gains parity, `/arcanon:map` persists only 4 ecosystems while `drift-versions.sh` reports 7. Java/C#/Ruby services show 0 deps in hub, visually indistinguishable from "not yet scanned," with no warning. Fix: `dep-collector.js` must emit `slog('WARN', 'dep-scan: unsupported manifest skipped', { file, ecosystem })` for any manifest it cannot parse. Add `ecosystems_scanned` array to dep scan result so coverage gaps are visible in logs immediately.

**5. Bash 3.2 x `declare -A` -- silent failure on macOS system bash (HIGH -- Phase 1 + Phase 3)**
`drift-types.sh` lines 129 and 148 already use `declare -A` (Bash 4+ only). macOS `/bin/bash` is 3.2; `#!/usr/bin/env bash` picks up Homebrew Bash 5 only if installed. On 3.2, `declare -A` silently creates a regular variable. Fix: use the `$WORK_DIR/<pkg_safe>` tmpdir key-value pattern already established in `drift-versions.sh` for all new parsers. Or add Bash version guard at top of any script using associative arrays. Prefer tmpdir pattern for consistency.

**Additional pitfalls for phase scheduling (lower urgency):**
- **NuGet Central Package Management** (`Directory.Packages.props`) -- `.csproj` with no `Version=` produces empty dep lists unless props file is parsed first (Phase 1)
- **Gemfile.lock GIT + PATH sections** -- parser covering only `GEM > specs:` misses git-sourced and path-sourced gems (Phase 1)
- **Spring Security 6 `SecurityFilterChain` bean pattern** -- `@EnableWebSecurity` alone misses all Spring Boot 3+ services, producing false "no auth" (Phase 3)
- **C# `partial class`** -- type body lives across multiple files; body comparison always diverges on fragment (Phase 3)
- **Hub payload v1.1 before THE-1018** -- emit `library_deps` unconditionally risks silent drop at older hub instances; gate behind `hub.beta_features.library_deps` config flag (Phase 5)

---

## Implications for Roadmap

The Architecture and Pitfalls researchers converged on the same build order. The phasing below reflects that convergence.

### Phase 1: Manifest Parser Foundation (THE-1020 shell layer)

**Rationale:** All downstream work -- DB persistence, hub payload, auth/db enrichment, drift dispatcher -- depends on correct manifest parsing. Wrong parse output feeds wrong DB rows. Must be test-driven from day one with two-dialect, two-section, and two-manifest-file fixtures. Can land and be validated independently of the DB work.

**Parallelism:** THE-1020 shell work (Phase 1) and THE-1019 DB schema work (Phase 2) are independent -- two developers can work them simultaneously.

**Delivers:** `drift-versions.sh` extended with Maven, Gradle (Groovy + Kotlin DSL), NuGet, and Bundler parsers. `detect.sh` and `discovery.js` updated with Java/dotnet/ruby language branches. Validated against multi-level pom, dual-DSL Gradle, all three Gemfile.lock section types, and Directory.Packages.props.

**Addresses:** Maven drift versions, NuGet drift versions, Bundler drift versions, language detection

**Avoids:** Maven `<parent>` (P1), Gradle dual DSL (P2), Gemfile.lock sections (P3), NuGet CPM (P4), Bash 3.2 `declare -A` (P9)

**Edit locations:**
- `scripts/drift-versions.sh` -- new `extract_java_versions`, `extract_dotnet_versions`, `extract_ruby_versions` functions
- `lib/detect.sh` -- lines 29-42, 48-56, 10-23
- `worker/scan/discovery.js` -- lines 23-29

---

### Phase 2: DB Schema + Dep Collector (THE-1019 internal chain, serialized)

**Rationale:** Migration 010 must exist before any write code. `query-engine.js` upsert must exist before `dep-collector.js`. `dep-collector.js` must exist before `manager.js` calls it. The chain is strictly serialized. The `dep_kind` discriminant and four-column UNIQUE constraint must be in migration 010 -- not retrofittable.

**Parallelism:** Runs in parallel with Phase 1. Blocked only by its own internal ordering: migration -> QE -> collector -> manager.

**Delivers:** `service_dependencies` table in SQLite with `dep_kind`, `version_raw`, `scope`, `manifest_file`, and correct `UNIQUE(service_id, ecosystem, name, manifest_file)`. `dep-collector.js` reads ecosystem manifests, writes production deps. `manager.js` Phase B loop calls `collectDependencies` after `runEnrichmentPass`. WARN logged for unsupported manifest types.

**Addresses:** Library persistence (THE-1019), dep count in scan output, `ecosystems_scanned` coverage field

**Avoids:** `dep_kind` discriminant (P6), UNIQUE constraint correctness (P5), scan bracket violation (dep-collector must not call beginScan/endScan), THE-1019 vs THE-1020 ordering gap (P14)

**Edit locations (serialized):**
1. NEW: `worker/db/migrations/010_service_dependencies.js`
2. EDIT: `worker/db/query-engine.js` -- `upsertDependency()` + prepared statement
3. NEW: `worker/scan/enrichment/dep-collector.js`
4. EDIT: `worker/scan/manager.js` -- line 776 (after `runEnrichmentPass`)

---

### Phase 3: Auth/DB Extractor Expansion (THE-1020 Node.js layer)

**Rationale:** Depends on Phase 1 language detection being in place (language tags must be established before signal dispatch can be keyed on them). Blocked by Phase 2 only if type extraction writes to `service_dependencies` -- it does not. Auth/DB enrichment writes to the existing `services` table columns.

**Delivers:** `AUTH_SIGNALS`, `DB_SOURCE_SIGNALS`, and `LANG_EXTENSIONS` entries for `java`, `csharp`, and `ruby` in `auth-db-extractor.js`. `EXCLUDED_DIRS` updated with `target`, `obj`, `bin`. `detectDbFromEnv()` updated with `config/database.yml` probe. Type extractors for Java (`extract_java_types`) and C# (`extract_cs_types`) in `drift-types.sh`.

**Addresses:** Java auth/DB enrichment (Spring Security 5 + 6, Spring Data), C# auth/DB enrichment (ASP.NET Identity + EF Core), Ruby auth/DB enrichment (Devise + ActiveRecord)

**Avoids:** Spring Security 6 `SecurityFilterChain` pattern (P10), EF Core minimal API `AddDbContext<T>()` (P11), Ruby open-class false positives (P12), C# partial class false positives (P13), Bash 3.2 `declare -A` in new scripts (P9)

**Edit locations:**
- EDIT: `worker/scan/enrichment/auth-db-extractor.js` -- lines 193-200 + signal objects + EXCLUDED_DIRS
- EDIT: `scripts/drift-types.sh` -- new extractor functions + `detect_repo_language` branches

---

### Phase 4: Shell Cleanup + Unified Dispatcher (THE-1021)

**Rationale:** Fully independent of Phases 1-3. Can land at any point. The dispatcher is a thin router with no logic of its own -- safest to implement after the parsers it dispatches are stable. The worker-restart refactor is purely internal; no visible behaviour change.

**Delivers:** `lib/worker-restart.sh` with `should_restart_worker` + `restart_worker_if_stale`. `scripts/drift.sh` unified dispatcher with `versions|types|openapi|all` subcommands and reserved `licenses|security` slots. `session-start.sh` lines 43-68 and `worker-start.sh` lines 28-61 replaced with sourced calls.

**Addresses:** Unified drift entry point, no-duplicate restart logic

**Avoids:** Dispatcher using `source` instead of `bash` subprocess (P7), drift-common.sh `return 0` guard change (P7), new worker-start.sh logic above PID-file mutex (P8)

**Edit locations:**
- NEW: `lib/worker-restart.sh`
- NEW: `scripts/drift.sh`
- EDIT: `scripts/session-start.sh` -- lines 43-68
- EDIT: `scripts/worker-start.sh` -- lines 28-61

---

### Phase 5: Hub Payload v1.1 + Feature Flag (THE-1019 hub-sync)

**Rationale:** Must land last. Depends on Phase 2 (table populated). Requires a feature flag gate (`hub.beta_features.library_deps`) so default uploads remain v1.0 until hub THE-1018 ships. Changing `payload.js` before the table is populated would emit empty `dependencies` arrays with no value.

**Delivers:** `buildFindingsBlock` in `payload.js` emits `dependencies` array and derives `schemaVersion` ("1.0" or "1.1"). `buildScanPayload` uses `schemaVersion` for the `version` field. Conditional inclusion: `dependencies` key absent from payload when array is empty or feature flag is off. Default config = v1.0 behaviour.

**Addresses:** `/arcanon:upload` includes library deps, v1.0 fallback on empty deps, backwards compat with older hub

**Avoids:** Hub v1.1 before THE-1018 (P15) -- feature flag gate; flag off always produces v1.0 regardless of deps array content

**Edit locations:**
- EDIT: `worker/hub-sync/payload.js` -- line 93 (`buildFindingsBlock`) + line 201 (`buildScanPayload`)

---

### Phase Ordering Rationale

- **Phases 1 and 2 run in parallel** -- shell manifest parsers and DB schema chain share no dependencies; two developers can work simultaneously
- **Phase 3 follows Phase 1** -- auth/DB extractor language dispatch is keyed on language tags from detect.sh; signal tables before language detection is premature
- **Phase 4 is free-floating** -- THE-1021 has zero dependencies on THE-1019 or THE-1020; placed after Phase 3 to avoid wiring the dispatcher before parsers it dispatches are stable
- **Phase 5 is a strict last step** -- payload v1.1 requires table populated (Phase 2) and feature flag gate implemented simultaneously
- **THE-1019 internal chain (Phase 2) is strictly serialized:** migration 010 -> `upsertDependency()` -> `dep-collector.js` -> manager.js Phase B loop; no step can be written before the previous defines its interface

### Research Flags

**Phases needing closer attention during requirements / planning:**
- **Phase 1 (manifest parsers):** Four separate parsers with known edge cases. Each needs a dedicated fixture test covering the non-obvious path (parent POM, Kotlin DSL, GIT section, CPM). Explicit acceptance criteria per parser required before implementation.
- **Phase 2 (DB schema):** `dep_kind` column and `UNIQUE(service_id, ecosystem, name, manifest_file)` four-column key must be locked in requirements before migration is written. Schema mistakes are HIGH-cost to recover post-shipping.
- **Phase 3 (auth/DB extractor):** Spring Security 5 vs. 6 dual-pattern decision and C# partial class handling both need explicit requirements sign-off.
- **Phase 5 (payload v1.1):** The `hub.beta_features.library_deps` flag path, its config schema location, and the test assertion ("default config upload does not contain `library_deps`") must be requirements-defined.

**Phases with standard patterns (skip research-phase):**
- **Phase 4 (shell cleanup):** Dispatcher pattern is straightforward `case` routing. Worker-restart extraction is a refactor of existing code. Architecture researcher provided minimum API surface and exact caller sites.

---

## Confidence Assessment

| Area | Confidence | Notes |
|------|------------|-------|
| Stack | HIGH | Zero new deps confirmed by Stack + Pitfalls researchers. All tool choices (POSIX awk, grep+sed) verified against existing plugin patterns. `ON CONFLICT DO UPDATE` is established project decision per PROJECT.md. |
| Features | HIGH | Based on direct codebase inspection of all affected files. Competitive differentiation grounded in project memory. devDependencies and transient dep scope questions are real open items, not confidence gaps. |
| Architecture | HIGH | All file:line anchors derived from direct inspection of manager.js (854 lines), query-engine.js (1505 lines), payload.js (248 lines), and all shell scripts. Build order convergence between Architecture and Pitfalls researchers strengthens confidence. |
| Pitfalls | HIGH (parser pitfalls) / MEDIUM (signal regex accuracy) | Parser pitfalls (Maven parent, Gradle DSL, Gemfile.lock sections, NuGet CPM) are code-grounded and confirmed by format documentation. Auth/DB signal regex for Java/C# are MEDIUM -- Spring Security 5 vs. 6 transition patterns are from doc review, not live test corpus. |

**Overall confidence: HIGH**

### Gaps to Address in Requirements Phase

1. **devDependencies scope in `service_dependencies`:** Features says production-only by default with optional `--include-dev` flag. Existing `drift-versions.sh` npm extractor includes dev deps -- behaviour divergence between shell drift layer and DB persistence layer. Requirements must choose: (a) align both on production-only, (b) accept divergence with documentation, or (c) add `--include-dev` flag to both layers together.

2. **Transient deps -- column in but parsing out:** Requirements must explicitly state that `dep_kind = 'direct'` is the only value populated in v5.8.0. Column must exist in migration 010 but transient parsing is deferred. Must be written into migration comment and `endScan` cleanup query so future transient work lands without a schema change.

3. **Spring Security 5 vs. 6 auth signal:** Requirements must confirm both `@EnableWebSecurity` (Boot 2.x) and `SecurityFilterChain` bean (Boot 3.x) are shipped in `AUTH_SIGNALS.java`. Stack researcher's AUTH_SIGNALS.java definition already includes `SecurityFilterChain` -- the two research files agree; requirements just needs to make it explicit.

4. **Four-column UNIQUE constraint vs. three-column:** Stack researcher proposed `UNIQUE(service_id, name, ecosystem)` (three columns). Pitfalls researcher identified this as insufficient when the same package appears in two manifests (e.g., root `pom.xml` and child `build.gradle`). Requirements must resolve: include `manifest_file` as fourth column (Pitfalls recommendation) or accept that duplicate manifest entries overwrite via upsert (simpler, acceptable if mono-manifest assumption holds for v5.8.0 scope).

5. **`schemaVersion` conditional logic with feature flag:** Architecture researcher proposes `schemaVersion` derived inside `buildFindingsBlock`. Requirements must confirm the feature flag (`hub.beta_features.library_deps`) interacts correctly: flag off = always v1.0 regardless of deps array; flag on = v1.0 when empty, v1.1 when non-empty.

---

## Sources

### Primary (HIGH confidence)
- Direct codebase inspection: `plugins/arcanon/worker/scan/manager.js` (854 lines) -- Phase B loop lines 733-782, enrichment loop lines 771-782
- Direct codebase inspection: `plugins/arcanon/worker/db/query-engine.js` (1505 lines) -- `_stmtDeleteStaleServices` line 816, `node_metadata` pattern as precedent
- Direct codebase inspection: `plugins/arcanon/worker/hub-sync/payload.js` (248 lines) -- `buildFindingsBlock` line 93, `buildScanPayload` line 201
- Direct codebase inspection: `plugins/arcanon/worker/scan/enrichment/auth-db-extractor.js` (lines 1-350) -- LANG_EXTENSIONS lines 193-200, signal dispatch lines 267-270
- Direct codebase inspection: `plugins/arcanon/worker/db/migrations/009_confidence_enrichment.js` -- canonical migration pattern
- Direct codebase inspection: `plugins/arcanon/lib/detect.sh` -- lines 29-42, 48-56, 10-23
- Direct codebase inspection: `plugins/arcanon/scripts/session-start.sh` -- restart logic lines 44-67
- Direct codebase inspection: `plugins/arcanon/scripts/worker-start.sh` -- PID-file mutex line 30
- Direct codebase inspection: `plugins/arcanon/scripts/drift-types.sh` -- `declare -A` lines 129/148
- Direct codebase inspection: `plugins/arcanon/scripts/drift-common.sh` -- `return 0` guard
- SQLite UPSERT: https://sqlite.org/lang_upsert.html
- NuGet PackageReference: https://learn.microsoft.com/en-us/nuget/consume-packages/package-references-in-project-files
- Gemfile.lock format: https://blog.saeloun.com/2022/08/16/understanding-gemfile-and-gemfile-lock/
- Java record (JEP 440): https://openjdk.org/jeps/440
- ASP.NET Core Identity / JWT: https://learn.microsoft.com/en-us/aspnet/core/security/authentication/identity
- Devise (Ruby): https://github.com/heartcombo/devise
- Gradle dependency string format: https://docs.gradle.org/current/userguide/viewing_debugging_dependencies.html

### Secondary (MEDIUM confidence)
- Spring Boot JWT patterns (2025): https://www.javacodegeeks.com/2025/05/how-to-secure-rest-apis-with-spring-security-and-jwt-2025-edition.html -- jjwt + spring-security-oauth2-jose signals
- pom.xml awk parsing: https://commandlinefanatic.com/cgi-bin/showarticle.cgi?article=art020 -- awk feasibility for XML parsing

---
*Research completed: 2026-04-19*
*Ready for roadmap: yes*
