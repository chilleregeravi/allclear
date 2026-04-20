# Feature Research

**Domain:** Library-drift detection + multi-language service scanning (Claude Code plugin — arcanon v5.8.0)
**Researched:** 2026-04-19
**Confidence:** HIGH (direct codebase inspection + domain knowledge of Dependabot, Renovate, Snyk patterns)

---

## Context: What This Milestone Adds

This is a **subsequent milestone** on an existing plugin. "MVP" language in the template maps to "what ships in v5.8.0" vs. "what comes after." All feature areas below are scoped additions on top of a working scan + drift + hub-sync pipeline.

Existing baseline (do not re-build):
- SQLite schema: repos / services / connections / schemas / fields / actors / node_metadata
- Drift: versions (npm/go/cargo/pypi), types (ts/go/py/rs), openapi — subcommand-based
- Enrichment: auth_mechanism + db_backend on `services` for ts/py/go/rs
- Payload: ScanPayloadV1 v1.0 (services, connections, schemas, actors — no deps field)
- Hub-sync: queue, client, upload command

---

## Feature Landscape

### Table Stakes (Users Expect These)

| Feature | Why Expected | Complexity | Depends On |
|---------|--------------|------------|------------|
| User can see which library version each service uses in the detail panel | Any dep-drift tool (Renovate, Dependabot) shows this; without persistence the drift output is disconnected from the map | MEDIUM | New `service_dependencies` table + scan-time manifest parsing wired into findings.js |
| User can run `/arcanon:drift versions` and see Java/Maven packages alongside npm/go/cargo/pypi | A Java shop's first ask when adopting the plugin; missing language coverage makes the command feel broken for polyglot orgs | MEDIUM | pom.xml parser in drift-versions.sh; `java` language tag in detect |
| User can run `/arcanon:drift versions` and see C#/NuGet packages | Same as Java — .NET shops treat missing language support as "not for us" | MEDIUM | .csproj parser in drift-versions.sh; `csharp` language tag |
| User can run `/arcanon:drift versions` and see Ruby/Bundler packages | Gemfile.lock is the pinned ground truth (not Gemfile ranges); Ruby shops expect exact-version diff | LOW-MEDIUM | Gemfile.lock parser; simpler than pom.xml since it contains already-resolved versions |
| User can run `/arcanon:drift` without a subcommand and get all checks including new language packages | Current no-subcommand behavior already works for ts/py/go/rs; parity means same UX for Java/C#/Ruby orgs | LOW | Language parsers above wired; no UX change to the command itself |
| CRITICAL/WARN/INFO severity grouping applies identically to new language findings | Users have learned the severity contract from existing drift output; inconsistency breaks trust | LOW | existing `emit_finding` in drift-common.sh — no changes needed |
| `/arcanon:upload` includes library deps in the scan payload | Once deps are persisted locally, users uploading to the hub expect them in the cloud record; omitting them makes persistence feel pointless | LOW-MEDIUM | `service_dependencies` table must exist first; v1.1 payload serialization in payload.js |
| Plugin emits v1.0 payload when no deps are stored | Older hub deployments reject unknown payload versions; backwards compat is non-negotiable for any API versioning story | LOW | payload.js version field conditional; no new DB work |

### Differentiators (Competitive Advantage)

| Feature | Value Proposition | Complexity | Depends On |
|---------|-------------------|------------|------------|
| User can see auth mechanism and DB backend for Java services (Spring SecurityFilterChain, Spring Data) | Dependabot/Renovate show no auth context; Arcanon's enrichment panel is unique — Java is a major gap that undercuts the polyglot claim | MEDIUM | New `java` entry in AUTH_SIGNALS + DB_SOURCE_SIGNALS; `.java` in LANG_EXTENSIONS in auth-db-extractor.js |
| User can see auth mechanism and DB backend for C# services (ASP.NET `[Authorize]`, Entity Framework) | Same reasoning as Java; .NET shops at enterprise scale are a high-value segment | MEDIUM | New `csharp` entry in signal tables; `.cs` extension |
| User can see auth mechanism and DB backend for Ruby services (Devise, has_secure_password, ActiveRecord) | Ruby/Rails is opinionated — Devise is nearly universal; detection is high-signal/low-noise | LOW-MEDIUM | New `ruby` entry in signal tables; `.rb` extension |
| User gets a unified dispatcher: one `drift` entry point, consistent subcommand syntax | Competitors require per-ecosystem or per-tool commands; a single dispatcher with predictable `drift [subcommand] [--flags]` is a better default DX for polyglot orgs | LOW | Unified drift.sh dispatcher; no new logic, only clean wiring of existing scripts |
| User can run `/arcanon:drift types` and see Java class / C# interface name mismatches | Type consistency across polyglot boundaries is a gap no competitor addresses; extends the existing heuristic grep approach to two high-demand languages | MEDIUM | New extract_java_classes / extract_csharp_interfaces in drift-types.sh; `java`/`csharp` in detect_repo_language |

### Anti-Features (Commonly Requested, Often Problematic)

| Feature | Why Requested | Why Problematic | Alternative |
|---------|---------------|-----------------|-------------|
| Store full transitive dependency tree per service | "I want to see if log4shell affects me" — feels like the next step after direct deps | Transitive trees for Maven/Gradle/NuGet are 500–2000 entries per service; bloats SQLite, slows scans, makes drift output unreadable; Snyk/Dependabot already do this better with live feeds | Store direct deps only in `service_dependencies`; transitive queries are a hub-side feature (THE-1018, explicitly out of scope) |
| Resolve `^1.2.3` ranges to pinned versions at scan time | Users want to know the "real" installed version, not the declared range | Requires running `npm install` / `go mod download` / `bundle install` — network I/O, side effects, breaks air-gapped and offline environments; violates no-external-service-deps constraint | Record range strings as-is; normalize only for comparison (current `normalize_version` approach is correct and must be preserved) |
| devDependencies included in drift-versions output by default | npm `devDependencies` appear in package.json and drift-versions.sh currently includes them | dev deps are noise for cross-service drift: they rarely cause runtime mismatches; they inflate output 3–5x; test-only package versions legitimately vary across repos | Include devDependencies only behind an explicit `--include-dev` flag; `service_dependencies` table stores production deps only by default |
| `drift licenses` subcommand | "While you're at it, tell me if we're mixing MIT and GPL" | License data requires SPDX mapping per package, not just manifest parsing; wrong or stale data is a legal liability if surfaced as fact | Reserve the `licenses` subcommand slot in the dispatcher without implementing it; future work can add it cleanly without breaking callers |
| `drift security` / CVE subcommand | "Can you tell me if a dep has a known CVE?" | CVE data requires an external feed (NVD, OSV); breaks no-external-service-deps constraint; freshness and false-positive risk are high | Reserved subcommand slot only; real CVE checking belongs in hub companion work (THE-1018) |
| Auto-upgrade PRs for drifted packages | "Just fix it for me" | Plugin runs inside Claude Code sessions with write access to source files; creating PRs without explicit review is unsafe; explicitly out of scope per project constraints | Surface drift with actionable version info; let the developer decide whether to pin, upgrade, or accept the difference |

---

## Feature Dependencies

```
service_dependencies table (migration 010)
    └──requires──> existing scan pipeline (manager.js + findings.js)
    └──enables──>  ScanPayloadV1 v1.1 (deps array per service in hub upload)
    └──enables──>  dep count in scan output UX

ScanPayloadV1 v1.1
    └──requires──> service_dependencies table populated
    └──requires──> existing hub-sync client (client.js / queue.js) — no changes
    └──fallback──> emit v1.0 when deps array is empty (backwards compat with older hubs)

Java/C#/Ruby language detection in detect.sh + discovery.js
    └──enables──> drift versions: pom.xml / .csproj / Gemfile.lock parsing in drift-versions.sh
    └──enables──> drift types: Java class / C# interface extraction in drift-types.sh
    └──enables──> auth+db enrichment: Spring / ASP.NET / Devise signal tables in auth-db-extractor.js
    └──no dependency on--> service_dependencies table (orthogonal work stream)

Unified drift dispatcher (drift.sh)
    └──requires──> all drift-*.sh scripts support new languages (so dispatcher output is complete)
    └──enhances──> /arcanon:drift command (single clean entry point)
    └──no dependency on--> service_dependencies table

auth+db enrichment for Java/C#/Ruby
    └──requires──> LANG_EXTENSIONS + AUTH_SIGNALS + DB_SOURCE_SIGNALS additions in auth-db-extractor.js
    └──requires──> existing enrichment pass architecture (enrichment.js) — no structural changes
    └──no dependency on--> drift versions/types changes (parallel work)
```

### Dependency Notes

- **service_dependencies requires scan pipeline changes:** findings.js must emit a `dependencies` array per service (production deps only); manager.js must persist it via a new upsert path. This is the critical path for THE-1019 — everything else in that ticket depends on the table existing.
- **v1.1 fallback to v1.0 is unconditional on hub version:** payload.js checks whether any service in the findings has a non-empty `dependencies` array. If yes, emit `"version": "1.1"`. If no, emit `"version": "1.0"`. No hub version negotiation needed — the condition is purely data-driven.
- **Language detection gates all three Java/C#/Ruby feature areas:** pom.xml / .csproj / Gemfile detection in detect.sh is the shared prerequisite. Once detect is updated, all three areas (drift, types, enrichment) proceed independently.
- **Dispatcher is fully independent:** drift.sh cleanup (THE-1021) has no blocking dependency on THE-1019 or THE-1020. It can be implemented and tested in isolation.
- **devDependencies in current drift-versions.sh:** The existing npm extractor pulls `dependencies + devDependencies` together via `jq`. The `service_dependencies` table should store production deps only. The drift-versions.sh script may remain as-is (cross-repo dev dep drift is low value but not harmful); the new persistence layer is the place to enforce the production-only default.

---

## MVP Definition (v5.8.0 scope)

### Must Ship (v5.8.0)

- [ ] User can persist direct production dependencies per service to SQLite — enables all future drift-persistence and hub-sync features
- [ ] User can run `/arcanon:drift versions` and see Maven (pom.xml) package drift — Java is the highest-volume language gap
- [ ] User can run `/arcanon:drift versions` and see NuGet (.csproj) package drift — .NET is the second-highest-volume gap
- [ ] User can run `/arcanon:drift versions` and see Bundler (Gemfile.lock) package drift — Gemfile.lock gives pinned versions, simpler to parse
- [ ] User can run `/arcanon:upload` and have library deps included in the payload (v1.1)
- [ ] User sees v1.0 emitted from `/arcanon:upload` when no deps are stored — older hub deployments remain compatible
- [ ] User can see auth mechanism and DB backend for Java services in the detail panel
- [ ] User can see auth mechanism and DB backend for C# services in the detail panel
- [ ] User can see auth mechanism and DB backend for Ruby services in the detail panel
- [ ] User can run a single `/arcanon:drift` (no subcommand) and get unified output including new languages — unified dispatcher
- [ ] Existing drift output for npm/go/cargo/pypi is unaffected — no regressions

### Add After Validation (v5.9.x)

- [ ] User can run `/arcanon:drift types` and see Java class / C# interface name mismatches — type-level parity; lower urgency than version parity
- [ ] User can filter drift output by language (`--lang java`) — useful once polyglot output volume grows
- [ ] User can query persisted deps via an MCP tool (`list_service_deps`) — enables agent-autonomous dep analysis

### Future Consideration (v6.x / hub-side)

- [ ] User can see transitive dep trees in the hub UI — requires hub-side resolution (THE-1018), not plugin-side
- [ ] User can see CVE alerts on persisted deps — requires OSV/NVD feed, breaks no-external-deps constraint
- [ ] User can see license conflicts across services — requires SPDX mapping; legal liability risk if data is wrong

---

## Feature Prioritization Matrix

| Feature | User Value | Implementation Cost | Priority |
|---------|------------|---------------------|----------|
| service_dependencies table + scan persistence | HIGH | MEDIUM | P1 |
| Java (Maven) drift versions | HIGH | MEDIUM | P1 |
| C# (NuGet) drift versions | HIGH | MEDIUM | P1 |
| Ruby (Bundler/Gemfile.lock) drift versions | MEDIUM | LOW | P1 |
| ScanPayloadV1 v1.1 with deps | HIGH | LOW | P1 |
| v1.0 fallback on empty deps | HIGH | LOW | P1 |
| Java auth/db enrichment (Spring Security + Spring Data) | HIGH | MEDIUM | P1 |
| C# auth/db enrichment (ASP.NET Identity + EF Core) | HIGH | MEDIUM | P1 |
| Ruby auth/db enrichment (Devise + ActiveRecord) | MEDIUM | LOW | P1 |
| Unified drift dispatcher + shell cleanup | MEDIUM | LOW | P1 |
| Java/C# type drift (class/interface name mismatches) | MEDIUM | MEDIUM | P2 |
| `--include-dev` flag for devDependencies | LOW | LOW | P2 |
| MCP tool for persisted dep queries | MEDIUM | MEDIUM | P2 |
| Reserved subcommand slots (licenses, security) in dispatcher | LOW | LOW | P2 |

---

## User-Centric Requirement Statements (for Requirements Phase)

**Library persistence (THE-1019):**
- User can run `/arcanon:map` and have direct production dependencies for each service recorded automatically — no extra command needed
- User can run `/arcanon:upload` and see library dependencies reflected in the hub per-service view
- User with an older hub deployment continues to receive valid v1.0 payloads when no deps were captured
- User sees a dep count summary in scan output ("captured 34 dependencies for auth-service")

**Language parity (THE-1020):**
- User in a Java shop can run `/arcanon:drift versions` and see `com.fasterxml.jackson.core:jackson-databind` version mismatches across their repos
- User in a .NET shop can run `/arcanon:drift versions` and see `Microsoft.EntityFrameworkCore` version mismatches
- User in a Ruby shop can run `/arcanon:drift versions` and see `devise` version mismatches from Gemfile.lock pinned versions
- User sees `auth_mechanism: spring-security` in the detail panel for a Java service using Spring SecurityFilterChain
- User sees `db_backend: postgresql` in the detail panel for a Java service using Spring Data JPA with a postgres driver
- User sees `auth_mechanism: asp-net-identity` in the detail panel for a C# service using ASP.NET Identity
- User sees `auth_mechanism: devise` in the detail panel for a Rails service using Devise

**Drift dispatcher (THE-1021):**
- User can run `/arcanon:drift` with no subcommand and get all drift types in one output, including new language packages
- User can run `/arcanon:drift versions` alone and get only version drift (existing behavior preserved)
- User encounters no duplicate or conflicting worker-restart logic across shell scripts (internal cleanup; no visible behavior change)

---

## Competitor Comparison

| Feature | Dependabot / Renovate | Snyk | Arcanon v5.8.0 Approach |
|---------|----------------------|------|-------------------------|
| Library version drift across repos | Per-repo only; no cross-repo unified view | Per-repo only | Cross-repo unified view — unique |
| Auth/DB enrichment per service | None | None | Arcanon-only: Spring / ASP.NET / Devise detection in detail panel |
| Works inside Claude Code session | No — CI/GitHub App only | No — CI/CLI only | Native plugin — instant, no CI setup required |
| Java/Maven support | Yes (per-repo PRs) | Yes (per-repo scans) | v5.8.0: cross-repo drift + Spring enrichment |
| C#/NuGet support | Yes (per-repo PRs) | Yes (per-repo scans) | v5.8.0: cross-repo drift + ASP.NET enrichment |
| Ruby/Bundler support | Yes (per-repo PRs) | Yes (per-repo scans) | v5.8.0: cross-repo drift (Gemfile.lock) |
| Service graph context | None — flat dep lists only | None | Deps linked to service owner / auth / db in graph |

---

## Sources

- Direct codebase inspection: `plugins/arcanon/scripts/drift-versions.sh` — existing manifest parsers cover package.json / go.mod / Cargo.toml / pyproject.toml only; Java/C#/Ruby absent
- Direct codebase inspection: `plugins/arcanon/scripts/drift-types.sh` — `detect_repo_language` returns `ts | go | py | rs | unknown`; no java/csharp/ruby cases
- Direct codebase inspection: `plugins/arcanon/worker/scan/enrichment/auth-db-extractor.js` — AUTH_SIGNALS + DB_SOURCE_SIGNALS cover python/javascript/typescript/go/rust; java/csharp/ruby keys absent; LANG_EXTENSIONS does not include .java / .cs / .rb
- Direct codebase inspection: `plugins/arcanon/worker/hub-sync/payload.js` — ScanPayloadV1 v1.0; `buildFindingsBlock` has no `dependencies` field; `buildScanPayload` hardcodes `version: "1.0"`
- Direct codebase inspection: `plugins/arcanon/worker/db/migrations/` (001–009) — no `service_dependencies` table exists in any migration
- Direct codebase inspection: `plugins/arcanon/commands/drift.md` — subcommand UX contract (graph / versions / types / openapi); `--all` flag for INFO
- `.planning/PROJECT.md`: milestone scope (THE-1019/1020/1021), out-of-scope items, project constraints (no external deps, framework-agnostic, AGPL-3.0)
- Domain knowledge: Renovate/Dependabot are per-repo dep updaters with no cross-repo drift view; Snyk is per-repo CVE scanner with no service graph; no tool in the space combines cross-repo library drift + auth/db enrichment + service graph — per competitive analysis in project memory

---

*Feature research for: arcanon v5.8.0 — Library Drift & Language Parity*
*Researched: 2026-04-19*
