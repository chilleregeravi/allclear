# Pitfalls Research

**Domain:** Library-drift persistence + multi-language parity + shell cleanup additions to the arcanon Claude Code plugin
**Researched:** 2026-04-19
**Confidence:** HIGH (code-grounded; all pitfalls derived from direct inspection of existing files)

---

## Critical Pitfalls

### Pitfall 1: Maven `<parent>` inheritance silently inflates the dep list

**What goes wrong:**
A multi-module Maven project has a root `pom.xml` that declares `<dependencyManagement>` versions and a child module `pom.xml` that lists dependencies with no version (because the parent supplies it via `${project.version}` or the BOM). A naive reader of the child POM produces packages with blank versions — the `pkg=` lines are emitted with an empty right-hand side and filtered out by the existing `[[ -z "${ver:-}" ]] && continue` guard in the main loop, silently dropping those packages entirely. The drift report then shows fewer deps than the service actually has.

**Why it happens:**
Maven's version inheritance is a two-document lookup: version lives in `<parent>` or `<dependencyManagement>`, not in the leaf `<dependency>` element. Single-file parsers always miss this.

**How to avoid:**
Parse both files: read `<parent>/<relativePath>` (default `../pom.xml`), extract `<dependencyManagement>` entries into a name-to-version map, then resolve leaf `<dependency>` nodes against that map. Record unresolved versions as `MANAGED` (a sentinel string) rather than dropping them — drift output should say `"version: MANAGED (parent)"` so the operator knows the dep exists. Write a unit test with a two-level pom fixture that asserts the child dep appears in output.

**Warning signs:**
- A Java service shows zero or suspiciously few deps from `pom.xml` parsing
- `pkg=` lines with empty version halves appearing in debug output of `extract_versions`

**Phase to address:** Phase 1 (Maven + Gradle manifest parser foundation) — correctness must be established before the DB persistence layer is built on top, because wrong parse output feeds wrong DB rows.

---

### Pitfall 2: Gradle Kotlin DSL vs. Groovy DSL — same semantics, incompatible syntax

**What goes wrong:**
`build.gradle` (Groovy) uses single-quoted strings and method-call syntax: `implementation 'com.example:lib:1.0'`. `build.gradle.kts` (Kotlin) requires double-quoted strings and parenthesis-wrapped arguments: `implementation("com.example:lib:1.0")`. A single regex matching one will fail silently on the other. Additionally, `platform(libs.spring.bom)` BOM references in a version catalog (`gradle/libs.versions.toml`) produce no inline version string at all — the version lives in the TOML file under `[versions]`. Missing these means entire BOM-managed dependency trees vanish from drift output.

**Why it happens:**
The existing `drift-versions.sh` only handles `package.json`, `go.mod`, `Cargo.toml`, and `pyproject.toml` — Gradle is entirely new territory. It is easy to only implement one DSL dialect when writing the initial parser.

**How to avoid:**
Implement two separate awk/grep passes: one for `build.gradle` (single-quote, space-separated) and one for `build.gradle.kts` (double-quote, parenthesis-wrapped). For `platform()` BOM entries, parse `gradle/libs.versions.toml` as a secondary source: extract `[versions]` key-value pairs and produce `BOM:alias=version` lines so the operator knows BOM-managed deps exist even when individual versions are not pinned. Add a test fixture with both DSL variants.

**Warning signs:**
- Kotlin-DSL repos show empty or partial dep lists while equivalent Groovy-DSL repos scan correctly
- Repos using `gradle/libs.versions.toml` show zero deps

**Phase to address:** Phase 1 (manifest parsers). The two-dialect problem is a known day-one issue that must be test-driven from the start, not retrofitted.

---

### Pitfall 3: Gemfile.lock section parsing — GEM vs GIT vs PATH sections have different formats

**What goes wrong:**
`Gemfile.lock` has multiple source sections. The `GEM` section lists gems with indented `specs:` blocks. The `GIT` section (for gems sourced from GitHub) uses a different indented structure where the gem name and version appear under the repo URL. The `PATH` section (local gems) has yet another layout. A parser that only handles `GEM > specs:` will miss all git-sourced and path-sourced gems, which are often the most version-sensitive (internal libraries pinned to exact commits or local paths that drift independently).

Separately: if you parse `Gemfile` instead of `Gemfile.lock`, you get constraint expressions like `gem 'rails', '~> 7.0'`, not the resolved pin. Drift comparison requires resolved pins — two repos both saying `~> 7.0` but running 7.0.2 vs. 7.1.3 will appear identical.

**Why it happens:**
`Gemfile.lock` format is underdocumented. The natural first instinct is to parse `Gemfile` because it is simpler and well-understood.

**How to avoid:**
Always parse `Gemfile.lock` (not `Gemfile`) as the canonical source. Implement all three section parsers: `GEM > specs:` (name (version)), `GIT > specs:` (name (version) under remote URL), `PATH > specs:` (same structure). Write a fixture covering all three and assert each gem appears in the output.

**Warning signs:**
- Ruby repos report significantly fewer deps than `bundle list` would show
- Git-sourced gems (e.g., internal shared libraries) never appear in drift findings
- Two repos pinned to different patch versions of Rails show no drift finding

**Phase to address:** Phase 1 (manifest parsers).

---

### Pitfall 4: NuGet Central Package Management — `Directory.Packages.props` as the version source

**What goes wrong:**
Modern .NET repos use Central Package Management: all versions are declared once in `Directory.Packages.props` using `<PackageVersion Include="Foo" Version="1.0" />`, and individual `.csproj` files use `<PackageReference Include="Foo" />` with no `Version` attribute. A parser that only reads `.csproj` `PackageReference` elements and requires a `Version` attribute will produce entirely empty dep lists for CPM-enabled repos.

Additionally, `<PackageReference Update="Bar" Version="1.0" />` (using `Update=` instead of `Include=`) overrides a transitively-pulled dep and must not be confused with a first-class dep declaration.

**Why it happens:**
CPM was introduced in NuGet 6.2 (2022) and is now the recommended pattern for large .NET solutions, but much documentation still shows the per-project `Version=` attribute style.

**How to avoid:**
Check for `Directory.Packages.props` before parsing `.csproj` files. If found: build a `packageName -> version` map from `<PackageVersion Include=... Version=... />` entries, then use `.csproj` `<PackageReference Include=...>` entries as the dep list, resolving versions from the map. Log `CPM` as the version source. Only fall back to per-project `Version=` attribute parsing when `Directory.Packages.props` is absent. Explicitly skip `Update=` attributes (they are overrides, not new deps).

**Warning signs:**
- A .NET repo with dozens of packages shows zero deps
- `.csproj` files have `<PackageReference>` elements with no `Version` attribute

**Phase to address:** Phase 1 (manifest parsers).

---

### Pitfall 5: `UNIQUE(service_id, ecosystem, package_name)` breaks when the same package appears in multiple manifests

**What goes wrong:**
A service may have both a root `pom.xml` and a `build.gradle` (Gradle wrapper project with Maven parent), or a Python service may have both `pyproject.toml` and a `requirements.txt`. If the same package appears in two manifests at different versions, an `ON CONFLICT DO UPDATE` upsert will silently overwrite the first row with the second, losing the original version.

A subtler variant: a monorepo scans multiple service roots, each with their own `package.json`, and two services both depend on `express` at different versions. If the schema key is `(package_name, ecosystem)` without `service_id`, all rows collapse into one — correct uniqueness requires all three columns minimum.

**Why it happens:**
Schema design for a new table happens before the full parsing surface area is understood. It is tempting to keep the schema minimal.

**How to avoid:**
The UNIQUE constraint must be `(service_id, ecosystem, package_name, manifest_file)` — four columns, where `manifest_file` is the relative path of the source manifest (e.g., `pom.xml` vs. `build.gradle`). On conflict, keep the row with the most-specific version (prefer an exact pinned version over a range or `MANAGED` sentinel). Write a test that inserts the same package from two manifests and asserts both rows exist with distinct `manifest_file` values.

**Warning signs:**
- After adding a second manifest type for Java, dep counts drop instead of increasing
- `ON CONFLICT` fires unexpectedly during scan

**Phase to address:** Phase 2 (DB schema migration for library deps) — schema correctness must be established before any insert logic is written.

---

### Pitfall 6: Transient deps mixed with direct deps under the same `scan_version_id`

**What goes wrong:**
If the `library_deps` table uses a single `scan_version_id` FK column to tie both direct and transient rows to the same scan bracket, then `endScan()` stale-row cleanup (`DELETE ... WHERE scan_version_id != ?`) will delete both categories equally — which is correct on the success path. But if the dep-parsing step only emits direct deps (because transient parsing is complex and deferred), `endScan` will delete any pre-existing transient rows from the prior scan, even though no new transient rows were written. The result is a DB that only ever contains direct deps, silently, even after transient parsing is added in a later phase.

**Why it happens:**
The existing scan bracket pattern (used for services/connections) was designed for a single category of row. Extending it to two categories (direct vs. transient) without a discriminant column creates a cleanup ambiguity.

**How to avoid:**
Add a `dep_kind TEXT NOT NULL CHECK(dep_kind IN ('direct', 'transient'))` column to the `library_deps` table. Make `endScan` (or a new `endDepScan`) delete only `dep_kind = 'direct'` rows when only direct parsing ran — leave transient rows from the prior scan intact until transient parsing is implemented. Document this explicitly in the migration comment so the partial-cleanup behaviour is intentional, not accidental.

**Warning signs:**
- After adding transient dep parsing, rows from the previous scan disappear even though the new scan succeeded
- `SELECT COUNT(*) FROM library_deps WHERE dep_kind = 'transient'` returns 0 after a scan that should have produced transient rows

**Phase to address:** Phase 2 (DB schema migration). The `dep_kind` discriminant must be in the initial migration, not retrofitted.

---

### Pitfall 7: `drift-versions.sh` direct-invocation compatibility breaks when `source drift-common.sh` moves into a dispatcher

**What goes wrong:**
`drift-versions.sh` currently sources `drift-common.sh` at the top (line 13). If the new unified dispatcher (`drift.sh`) also sources `drift-common.sh` and then calls `drift-versions.sh` as a subcommand, `drift-common.sh` will be sourced twice in the same shell. This is safe in the current code (the file uses `export` but no state-modifying side effects beyond setting `LINKED_REPOS`). The real risk is different: `drift-common.sh` currently calls `list_linked_repos` and exits via `return 0` when no linked repos are found. In a subshell invoked by the dispatcher, `return 0` has no effect — only `exit` would stop the subshell. If someone refactors `drift-common.sh` to `exit` instead of `return` to "fix" the subshell case, then direct-invocation (sourcing from a test or legacy call) breaks.

**How to avoid:**
Leave `drift-common.sh`'s `return 0` guard exactly as-is. The double-source is harmless because all assignments are idempotent. The dispatcher should call subcommand scripts via `bash "${SCRIPT_DIR}/drift-versions.sh" "$@"` (explicit subshell), not `source`. Add a comment in `drift.sh`: "subcommands are called as subshells — each sources drift-common.sh independently, which is intentional." Write a test that calls `drift-versions.sh` both directly and via the dispatcher and asserts identical output.

**Warning signs:**
- `drift-common.sh` is edited to `exit` instead of `return`
- The dispatcher uses `source` rather than `bash` for subcommand dispatch

**Phase to address:** Phase 4 (shell cleanup / unified dispatcher).

---

### Pitfall 8: Worker restart race condition on concurrent `UserPromptSubmit` fires

**What goes wrong:**
`session-start.sh` fires on both `SessionStart` and `UserPromptSubmit`. The version mismatch check (lines 44–67) calls `worker-stop.sh` and then `worker_start_background` when a version mismatch is detected. If two `UserPromptSubmit` events fire in rapid succession, both may detect the mismatch and both attempt `worker-stop + worker_start_background`. The second invocation of `worker-start.sh` reads the PID file, finds a still-running PID from the first restart, and exits early. This is currently safe. The risk emerges if new initialization logic (e.g., for dependency scanning DB setup) is added to `worker-start.sh` BEFORE the PID-alive check — that new logic could execute twice concurrently with non-idempotent effects.

**Why it happens:**
Shell scripts do not have mutex primitives. The existing code relies on the PID-file check as an implicit lock, which only works if new logic is added AFTER the check.

**How to avoid:**
Enforce the rule: all new logic in `worker-start.sh` must be added after the `kill -0 "$PID"` guard (line 30). The PID-file acts as the mutex. If new dispatcher initialization (e.g., `library_deps` DB table creation) is needed at worker start, add it as a worker-side HTTP endpoint initialization, not in the shell script. Mark the constraint explicitly with a comment: `# MUTEX BOUNDARY: all new logic below this point runs only when no worker is active`.

**Warning signs:**
- New code added to `worker-start.sh` above the PID-file existence check
- Worker startup logic that is not idempotent (e.g., `CREATE TABLE` without `IF NOT EXISTS`)

**Phase to address:** Phase 4 (shell cleanup). The dispatcher refactor is when new shell logic is most likely to be inserted at the wrong location.

---

### Pitfall 9: Bash 3.2 floor on macOS — `declare -A` associative arrays fail silently

**What goes wrong:**
`drift-types.sh` (lines 129, 148) uses `declare -A lang_repos` and `declare -A type_repos` — Bash 4+ associative arrays. On macOS, `/bin/bash` is version 3.2 (Apple has not shipped Bash 4+ due to GPLv3). The script uses `#!/usr/bin/env bash`, which picks up Homebrew-installed Bash 5 if present — but many devs have never run `brew install bash`. On Bash 3.2, `declare -A` silently creates a regular variable, not an associative array; subsequent indexed access either produces empty strings or causes cryptic parse errors. The new parsers for Java/C#/Ruby will likely want `declare -A` for their own field-map lookups.

**Why it happens:**
CI runs on GitHub Actions (Bash 5) and passes. Local macOS developers with only the system Bash silently get wrong results or no output.

**How to avoid:**
Add a Bash version check at the top of any script using `declare -A`:
```bash
if (( BASH_VERSINFO[0] < 4 )); then
  echo "arcanon drift requires Bash 4+. Install with: brew install bash" >&2
  exit 1
fi
```
Alternatively, replace `declare -A` with the tmpdir-based key-value store pattern that `drift-versions.sh` already uses (`$WORK_DIR/<pkg_safe>` files) — this is Bash 3.2 safe and already established in the codebase. Prefer the tmpdir pattern for new parsers to stay consistent.

**Warning signs:**
- New parser script adds `declare -A` for type-body maps
- Script passes CI but produces empty output on a fresh macOS dev machine

**Phase to address:** Phase 1 (manifest parsers) and Phase 3 (Java/C#/Ruby regex extractors) — before any new `declare -A` usage is added.

---

### Pitfall 10: Spring Security 6+ deprecates `@EnableWebSecurity` — regex misses the new pattern

**What goes wrong:**
Spring Security 5.x uses `@EnableWebSecurity` as the canonical auth marker. Spring Security 6.0 (Spring Boot 3.0, released Nov 2022) deprecated `@EnableWebSecurity` and the `WebSecurityConfigurerAdapter` extends pattern. The new pattern is a `@Bean`-annotated `SecurityFilterChain` method — no class-level annotation. A regex that only matches `@EnableWebSecurity` will miss all Spring Boot 3+ services and report them as having no auth mechanism, a false negative that is worse than a false positive since it suggests a service is unprotected.

**Why it happens:**
The existing `auth-db-extractor.js` was written against Spring Boot 2.x patterns. Spring Boot 3 reached wide adoption in 2023–2024 and many new services are Boot 3 only.

**How to avoid:**
Match both patterns: (1) `@EnableWebSecurity` (Boot 2.x), and (2) `SecurityFilterChain` as a `@Bean` return type (Boot 3.x). Also look for `http.authorizeHttpRequests` and `http.authorizeRequests` (the latter is the deprecated Boot 2.x variant). Record `spring_security` as the `auth_mechanism` value for both; add an optional sub-field for version if the distinction is needed. Write a test fixture with a Boot 3 `SecurityFilterChain` bean and assert `auth_mechanism = 'spring_security'` is emitted.

**Warning signs:**
- All Spring Boot 3 repos in the linked-repo set have `auth_mechanism = null` after enrichment
- `@EnableWebSecurity` is the only Spring auth pattern in the extractor

**Phase to address:** Phase 3 (auth/DB extractor expansion).

---

### Pitfall 11: EF Core minimal API DbContext — `builder.Services.AddDbContext<T>()` not detected

**What goes wrong:**
Classic EF Core registers the DbContext via a class that inherits `DbContext`. Extractors match this via class-body inheritance patterns. Minimal API style (ASP.NET Core 6+) registers via `builder.Services.AddDbContext<MyContext>()` in `Program.cs` — there may be no class visibly inheriting `DbContext` in the scanned file if the context class is in a separate assembly or if the DI registration is all that exists in the entry point. The extractor emits no `db_backend` finding for these services.

**Why it happens:**
The class-inheritance pattern is simpler to grep. The DI registration pattern requires scanning a different file type (`Program.cs` / top-level statements) with different syntax.

**How to avoid:**
Add a secondary extraction pass on `Program.cs` and `Startup.cs` that matches `AddDbContext<(\w+)>`. Use the generic type argument to infer the backend from the connection string context if resolvable. As a fallback, emit `db_backend = 'ef_core'` without a specific backend when the provider cannot be inferred. Write a test fixture using the minimal API pattern.

**Warning signs:**
- ASP.NET 6+ services with EF Core show `db_backend = null`
- `Program.cs` is present but not scanned by the auth/DB extractor

**Phase to address:** Phase 3 (auth/DB extractor expansion).

---

### Pitfall 12: Ruby open classes and `class_eval` — same type name across files is not drift

**What goes wrong:**
Ruby allows a class to be reopened in any file: `class Order; def new_method; end; end` in `order_extensions.rb` is the same class as `class Order` in `order.rb`. The type extractor collects class names across files and then looks for the same name in multiple repos — it assumes "same name in two repos = potentially drifted type." For Ruby, the same name in two files within the same repo (due to open classes) looks identical to the extractor and triggers a false-positive CRITICAL drift finding.

Monkey-patching (`String.class_eval { ... }`) adds methods to built-in classes — the class name `String` would appear as a "type" and trivially match `String` in any other Ruby repo, generating noise.

**Why it happens:**
The existing extractor treats "same name in N repos" as the signal. For languages with closed classes (Go, Rust, TypeScript), this heuristic works. For Ruby, it breaks.

**How to avoid:**
For Ruby, scope class extraction to `class [A-Z]` definitions only at the top level of their file (indentation = 0, not inside a module block). Skip names that match Ruby stdlib classes: `String`, `Array`, `Hash`, `Integer`, `Symbol`, `Numeric`, `Object`, `BasicObject`. Document that Ruby open-class drift detection is best-effort and will produce false positives on heavily monkey-patched codebases. Consider adding a `--skip-ruby-classes` flag to suppress Ruby from type drift if noise is high.

**Warning signs:**
- Ruby repos generate CRITICAL findings for `String`, `Array`, `Integer`
- Same class name appears 3+ times within a single Ruby repo's grep output (sign of reopening)

**Phase to address:** Phase 3 (Java/C#/Ruby regex extractor additions).

---

### Pitfall 13: C# `partial class` — type body lives across multiple files, body comparison always diverges

**What goes wrong:**
C# allows a class to be split across multiple files: `partial class Customer { public string Name; }` in `Customer.cs` and `partial class Customer { public void Validate(); }` in `Customer.Validation.cs`. The existing type-body extractor finds the first file containing the type name and extracts its body only. For a partial class, this gives a fragment — two repos with the same `Customer` partial class will differ if each extractor happened to pick a different fragment file. The body comparison fires a false-positive CRITICAL drift finding.

**Why it happens:**
`partial class` is a C#-specific construct with no equivalent in other supported languages. The extractor was not designed with it in mind.

**How to avoid:**
For C# files (`*.cs`): find all files containing `partial class TypeName` (not just the first), concatenate their field declarations, sort, and compare the combined body. Write a test fixture with a two-file partial class and assert no CRITICAL is emitted when both repos have the same combined body. Also note: the ticket says "match only public" but `internal` APIs drift too — add a `--include-internal` flag defaulting to off so the behaviour is opt-in rather than always-on noise.

**Warning signs:**
- C# repos with EF Core or ASP.NET models (which commonly use partial classes for generated scaffolding) generate spurious CRITICAL type-drift findings
- Type body comparison always shows a diff even when developers believe the types match

**Phase to address:** Phase 3 (C# extractor addition).

---

### Pitfall 14: THE-1019 vs THE-1020 ordering gap — `/arcanon:map` emits partial deps silently

**What goes wrong:**
If THE-1020 (shell-side manifest parsers for Maven/NuGet/Bundler in `drift-versions.sh`) lands before THE-1019 (`worker/scan/dependencies.js` with the same coverage), then the state is:

- `drift-versions.sh` reports drift for all 7 ecosystems (TS/Py/Go/Rust/Java/C#/Ruby)
- `worker/scan/dependencies.js` (invoked by `/arcanon:map`) only persists deps for TS/Py/Go/Rust

The operator runs `/arcanon:map` and the resulting payload reflects only 4 ecosystems. Java/C#/Ruby services show 0 deps in the hub — visually indistinguishable from "not yet scanned." There is no warning in the scan output.

**Why it happens:**
THE-1019 and THE-1020 are parallel tracks. Shell-side parsing is easier to prototype independently of the Node.js worker.

**How to avoid:**
Emit a WARN from `worker/scan/dependencies.js` when it encounters a manifest file it cannot parse: `slog('WARN', 'dep-scan: unsupported manifest skipped', { file: 'pom.xml', ecosystem: 'maven' })`. This surfaces the coverage gap in scan logs. Add an `ecosystems_scanned` array to the dep scan result so the hub payload can report `["ts", "go"]` vs. the full set — the hub can flag partial coverage when THE-1018 lands. Do not add `library_deps` to the hub payload until THE-1018 is ready (see Pitfall 15), but add the `ecosystems_scanned` field to the local result immediately so it is visible in logs.

**Warning signs:**
- `drift-versions.sh` finds Maven drift but `/arcanon:map` shows no Java deps in the hub or local DB
- Scan logs have no WARN for `pom.xml` or `Gemfile.lock` files encountered during scan

**Phase to address:** Phase 1 (define the `ecosystems_scanned` contract) and Phase 2 (implement the WARN emission in the worker scanner). Both tickets should reference this contract explicitly.

---

### Pitfall 15: Hub payload v1.1 shipped before hub THE-1018 — upload silently succeeds but deps are dropped

**What goes wrong:**
If the plugin emits a v1.1 payload (with `library_deps` array) to a hub instance that only understands v1.0, two failure modes are possible: (a) the hub returns HTTP 200 but silently ignores unknown fields — `library_deps` is dropped, the operator never knows; (b) the hub returns HTTP 422 due to strict schema validation — the upload fails and `slog('WARN', 'hub upload failed', ...)` fires, but the error message only says "validation error" without specifying which field.

**Why it happens:**
Hub-side THE-1018 is explicitly out of scope for this milestone. The temptation is to add `library_deps` to the payload immediately since the data is available locally.

**How to avoid:**
Gate the `library_deps` field behind a config flag: only include it in the payload when `hub.beta_features.library_deps = true` is set in `arcanon.config.json`. Default to omitting the field (v1.0 behaviour). Add an integration test that asserts a default-config upload does not contain `library_deps`. Document the upgrade path: "Set `hub.beta_features.library_deps = true` once the hub deploys THE-1018."

**Warning signs:**
- `library_deps` is added to the payload unconditionally in `hub-sync/index.js`
- The hub's upload endpoint returns 200 but dep data is absent from the hub UI

**Phase to address:** Phase 5 (payload v1.1 / hub sync) — explicitly after hub THE-1018 deploys or behind the feature flag.

---

## Technical Debt Patterns

| Shortcut | Immediate Benefit | Long-term Cost | When Acceptable |
|----------|-------------------|----------------|-----------------|
| Skip `<parent>` resolution in Maven parser, emit `MANAGED` as version | Ships Phase 1 faster | Drift report shows false "version unknown" for all parent-managed deps | Never — the parent POM is always co-located with the child |
| Parse only `build.gradle` (Groovy), skip Kotlin DSL | Halves parser complexity | All Kotlin-first projects (Android, modern Spring) show zero deps | Only if no Kotlin repos exist in linked set — verify first |
| Use `dep_kind = 'direct'` only, never model transients | Avoids transient parsing complexity | Drift report misses the most common version divergence vector (indirect dep upgrades) | Acceptable for v1 if clearly labeled "direct deps only" in UI |
| Use `declare -A` in new scripts, document Bash 4 requirement | Simpler code | Silent failures on macOS system Bash 3.2 | Never — the tmpdir pattern already exists in `drift-versions.sh` and is safer |
| Emit `library_deps` in v1.0 payload unconditionally | One payload version to maintain | Hub drops data silently; operator has no visibility | Never — use the feature flag gate |

## Integration Gotchas

| Integration | Common Mistake | Correct Approach |
|-------------|----------------|------------------|
| `endScan` stale-row cleanup | Adding `library_deps` cleanup to `endScan` without checking `dep_kind` | Only delete `dep_kind = 'direct'` rows when the direct pass ran; leave transient rows intact until transient parsing is implemented |
| Hub sync `syncFindings` | Passing `library_deps` to `syncFindings` before hub supports v1.1 | Gate behind `hub.beta_features.library_deps` config flag |
| Drift dispatcher calling subcommands | Using `source` to call `drift-versions.sh` from dispatcher | Always use `bash "${SCRIPT_DIR}/drift-versions.sh" "$@"` — subshell, not source |
| `session-start.sh` version check | Adding dep-scan initialization logic before the PID-file mutex in `worker-start.sh` | All new initialization logic goes after the `kill -0 "$PID"` guard |
| `drift-common.sh` `return 0` guard | Changing `return` to `exit` to make it work in subshells | Leave as `return` — the dispatcher calls scripts as subshells, not sources them |

## Performance Traps

| Trap | Symptoms | Prevention | When It Breaks |
|------|----------|------------|----------------|
| Parsing `build.gradle` with full-file regex on monorepos with many submodules | `drift-versions.sh` hangs 30–60s on large Java monorepos | Cap module traversal depth at 3; skip `.gradle/` cache directories | Repos with 20+ Gradle submodules |
| Ruby `Gemfile.lock` grep across all files in repo | Finds multiple lock files (gemspec + engine lock files); produces duplicate deps | Only scan root `Gemfile.lock` and `*/Gemfile.lock` at depth 1 | Gems-as-submodules patterns |
| Type-body comparison for C# with large Entity Framework models | `extract_type_body` on a 500-field EF model entity runs a slow awk loop | Cap field extraction at 100 lines, same as the existing `head -50` cap on type names in `drift-types.sh` | Any EF Core repo with auto-generated model classes |

## Security Mistakes

| Mistake | Risk | Prevention |
|---------|------|------------|
| Storing manifest paths in DB with unsanitized repo-path prefix | Path traversal if a linked repo path contains `..` | Use the existing path-traversal guards from the shipped scan pipeline; apply same guards to manifest path construction in `extract_versions` |
| Logging Maven `<parent>` POM content verbatim in WARN messages | POM files can contain internal dependency coordinates or private artifact server URLs | Log only package name and version, never raw POM content |
| Hub payload including `library_deps` before operator opts in | Leaks dep inventory to hub before operator explicitly enables it | The feature-flag gate (Pitfall 15) also serves as the security gate |

## "Looks Done But Isn't" Checklist

- [ ] **Maven parser:** Passes test with child-only `pom.xml` (version present inline) — verify it also handles child POM where version is absent and inherited from `<parent>`
- [ ] **Gradle parser:** Tests cover both `build.gradle` and `build.gradle.kts` fixtures — verify Kotlin DSL double-quote syntax is exercised
- [ ] **Gemfile.lock parser:** Test fixture includes a `GIT` section gem — verify it appears in output, not just `GEM > specs:` gems
- [ ] **NuGet parser:** Test fixture uses `Directory.Packages.props` with no `Version=` in `.csproj` — verify deps still appear
- [ ] **Library dep schema:** Migration has `dep_kind` column — verify `endScan` cleanup does not delete transient rows when only direct pass ran
- [ ] **Drift dispatcher:** Direct invocation of `drift-versions.sh` still works after dispatcher is added — run the existing test suite against both paths
- [ ] **Spring Security 6:** Test fixture uses `SecurityFilterChain` bean pattern — verify `auth_mechanism = 'spring_security'` is emitted
- [ ] **C# partial class:** Test fixture splits a class across two files — verify no false CRITICAL is emitted
- [ ] **THE-1019 vs THE-1020 gap:** Scan log contains WARN for unsupported manifest types when worker encounters `pom.xml` or `Gemfile.lock`
- [ ] **Payload v1.1:** A default-config upload does not contain `library_deps` field — assert in hub-sync test

## Recovery Strategies

| Pitfall | Recovery Cost | Recovery Steps |
|---------|---------------|----------------|
| Maven parent-inheritance missed in initial parse | MEDIUM | Add parent POM resolution; re-run `drift-versions.sh` for all linked repos; no DB migration needed (shell-side only) |
| Wrong UNIQUE constraint on `library_deps` | HIGH | Write migration to DROP and re-add constraint with 4-column key; existing rows may have conflicts requiring manual resolution |
| `dep_kind` column missing from initial migration | HIGH | Add migration 011 with `ALTER TABLE library_deps ADD COLUMN dep_kind TEXT`; backfill all existing rows as `'direct'`; update `endScan` cleanup query |
| Worker restart race condition caused data corruption | LOW | The PID-file mutex already prevents double-start; if corruption occurs, `rm ~/.arcanon/worker.pid` and restart |
| Hub silently drops v1.1 payload fields | LOW | Toggle `hub.beta_features.library_deps = false` in config; no data loss (local DB is source of truth) |
| Bash 3.2 `declare -A` silently wrong output | LOW | Replace with tmpdir pattern; no data migration needed |

## Pitfall-to-Phase Mapping

| Pitfall | Prevention Phase | Verification |
|---------|------------------|--------------|
| Maven `<parent>` inheritance (P1) | Phase 1 — manifest parsers | Test fixture: child POM with no inline version; assert dep appears with resolved version |
| Gradle DSL dialect split (P2) | Phase 1 — manifest parsers | Test fixture: both `build.gradle` and `build.gradle.kts`; assert identical dep list |
| Gemfile.lock section parsing (P3) | Phase 1 — manifest parsers | Test fixture: lock file with GEM + GIT + PATH sections; assert all 3 appear |
| NuGet CPM `Directory.Packages.props` (P4) | Phase 1 — manifest parsers | Test fixture: `.csproj` with no Version + `Directory.Packages.props`; assert deps appear |
| UNIQUE constraint 3 vs 4 columns (P5) | Phase 2 — DB schema migration | Migration test: same package from two manifest files inserts 2 rows, not 1 |
| Transient dep `dep_kind` discriminant (P6) | Phase 2 — DB schema migration | `endScan` unit test asserts transient rows survive a direct-only scan |
| Dispatcher double-source / `return` vs `exit` (P7) | Phase 4 — shell cleanup | Integration test: `drift-versions.sh` run directly and via dispatcher produces identical output |
| Worker restart race condition (P8) | Phase 4 — shell cleanup | Code review gate: all new `worker-start.sh` logic must be after PID-file mutex |
| Bash 3.2 `declare -A` (P9) | Phase 1 + Phase 3 | Version check added to any script using `declare -A`; or tmpdir pattern used instead |
| Spring Security 6 pattern (P10) | Phase 3 — auth/DB extractor | Test fixture: Boot 3 `SecurityFilterChain` bean; assert `auth_mechanism` emitted |
| EF Core minimal API DbContext (P11) | Phase 3 — auth/DB extractor | Test fixture: `Program.cs` with `AddDbContext<T>()`; assert `db_backend` emitted |
| Ruby open-class false positives (P12) | Phase 3 — Ruby extractor | Test fixture: class reopened in 2 files within same repo; assert no cross-repo CRITICAL |
| C# partial class false positives (P13) | Phase 3 — C# extractor | Test fixture: partial class split across 2 files; assert no CRITICAL with combined body |
| THE-1019 vs THE-1020 partial dep coverage gap (P14) | Phase 1 (contract) + Phase 2 (WARN emission) | Scan log test: worker encounters `pom.xml`; asserts WARN logged; `ecosystems_scanned` excludes `maven` |
| Hub v1.1 before THE-1018 (P15) | Phase 5 — hub sync | Unit test: default config produces v1.0 payload with no `library_deps` field |

## Sources

- Direct code inspection: `plugins/arcanon/scripts/drift-versions.sh` (lines 1–200) — existing extract_versions pattern, pkg_safe tmpdir approach, Bash 3.2 `declare -A` usage absent here
- Direct code inspection: `plugins/arcanon/scripts/drift-types.sh` (lines 1–200) — `declare -A` usage on lines 129/148; Bash 4 dependency confirmed
- Direct code inspection: `plugins/arcanon/scripts/drift-common.sh` — `return 0` guard confirmed; `export` pattern confirmed idempotent
- Direct code inspection: `plugins/arcanon/scripts/session-start.sh` — version-check + restart logic confirmed on lines 44–67
- Direct code inspection: `plugins/arcanon/scripts/worker-start.sh` — PID-file mutex confirmed on line 30; double-start protection confirmed
- Direct code inspection: `plugins/arcanon/worker/db/query-engine.js` — `endScan` stale-row cleanup pattern (lines 784–838); `dep_kind` discriminant gap confirmed absent
- Direct code inspection: `plugins/arcanon/worker/db/migrations/001–009` — `library_deps` table confirmed absent; existing UNIQUE patterns on `services` confirmed
- Direct code inspection: `plugins/arcanon/worker/scan/manager.js` — scan bracket, PID lock, `slog` WARN pattern confirmed
- Maven: Apache Maven POM reference — Dependency Management (official docs, HIGH confidence)
- Gradle: Gradle version catalog docs, Kotlin DSL primer (official docs, HIGH confidence)
- NuGet: Central Package Management — Microsoft Docs (official docs, HIGH confidence)
- Bundler: Bundler Gemfile.lock format man page (official docs, HIGH confidence)
- Spring Security 6: Spring Security 6 migration guide (official docs, HIGH confidence)
- EF Core minimal APIs: ASP.NET Core 6+ minimal API with EF Core (official docs, HIGH confidence)

---
*Pitfalls research for: Library Drift & Language Parity milestone (arcanon plugin)*
*Researched: 2026-04-19*
