# Architecture Research

**Domain:** Claude Code plugin — Library Drift & Language Parity milestone
**Researched:** 2026-04-19
**Confidence:** HIGH (all findings derived from direct file inspection)

---

## Integration Analysis by Ticket

### THE-1019: Library Dependency Persistence

#### 1. Where `collectDependencies()` slots in `manager.js`

The scan pipeline has two sequential phases inside `scanRepos()`:

- **Phase A** (`manager.js` line 733): parallel `Promise.allSettled` fan-out — agent calls per repo.
- **Phase B** (`manager.js` line 756): sequential DB writes and enrichment.

`collectDependencies(repoPath, svc.id, svc.root_path)` must run **inside Phase B, after `persistFindings()` and `endScan()`, within the existing enrichment loop** (`manager.js` lines 771–782). The exact slot:

```
queryEngine.persistFindings(...)        ← line 765
queryEngine.endScan(...)                ← line 766
// enrichment loop starts (line 771)
const services = queryEngine._db
  .prepare('SELECT id, root_path, language, boundary_entry FROM services WHERE repo_id = ?')
  .all(r.repoId);                       ← line 773 — root_path already fetched here
for (const service of services) {
  await runEnrichmentPass(...)          ← line 776 — existing enricher dispatch
  await collectDependencies(...)        ← NEW: insert after runEnrichmentPass, same loop body
}
```

Rationale: `collectDependencies` needs `service.id` (the DB row FK), which only exists after `persistFindings`. It must run after `endScan` so its writes are not removed by stale-row cleanup — the `service_dependencies` table uses `ON DELETE CASCADE` from `services(id)`, not `scan_version_id` stamping, so the cleanup in `endScan` does not affect it. Running inside the existing loop keeps sequential DB access intact (better-sqlite3 is not concurrent-safe). The `services` query at line 773 already selects `root_path`, so no second query is needed.

#### 2. `service_dependencies` — new table vs. JSON column on `services`

**New table is correct.** Reasons:

- `services` uses `ON CONFLICT(repo_id, name) DO UPDATE` upserts. Adding a JSON column means re-serializing the full array on every scan update, awkward with the existing prepared statement in `query-engine.js` lines 355–364.
- A child table with `ON DELETE CASCADE` from `services(id)` gives stale-row cleanup for free — when `endScan()` deletes stale services via `_stmtDeleteStaleServices` (line 816), dependency rows follow automatically. No new cleanup statements needed.
- Querying by package name, version, or ecosystem across repos requires a normalized table. A JSON column forces `json_each()` or application-side parsing.
- The `node_metadata` table (migration 008) is the established precedent for side-car data keyed to `service_id`. `service_dependencies` follows the same pattern.

Schema for migration 010:

```sql
CREATE TABLE IF NOT EXISTS service_dependencies (
  id           INTEGER PRIMARY KEY,
  service_id   INTEGER NOT NULL REFERENCES services(id) ON DELETE CASCADE,
  ecosystem    TEXT NOT NULL,   -- 'npm' | 'pip' | 'cargo' | 'maven' | 'gem'
  name         TEXT NOT NULL,
  version      TEXT,
  dev          INTEGER NOT NULL DEFAULT 0,  -- 0=prod, 1=dev/test dep
  UNIQUE(service_id, ecosystem, name)
);
CREATE INDEX IF NOT EXISTS idx_service_deps_service ON service_dependencies(service_id);
CREATE INDEX IF NOT EXISTS idx_service_deps_name    ON service_dependencies(ecosystem, name);
```

Stale cleanup: `ON DELETE CASCADE` means no change to `endScan()`. This is simpler than the schemas/fields pattern (which requires explicit child-first deletes before connection deletion, because schemas FK connections, not services). `service_dependencies` → `services` is single-level cascade, making it self-managing.

#### 3. `buildFindingsBlock()` — version bump to 1.1 only when deps present

`buildScanPayload()` hard-codes `version: "1.0"` at `payload.js` line 201. The cleanest approach is to have `buildFindingsBlock()` derive and return a `schemaVersion` field, then let `buildScanPayload()` use it:

In `buildFindingsBlock()` (`payload.js` line 93):

```javascript
const deps = Array.isArray(findings?.dependencies) ? findings.dependencies : [];

return {
  services: ...,
  connections: ...,
  schemas,
  actors: ...,
  dependencies: deps,
  schemaVersion: deps.length > 0 ? "1.1" : "1.0",  // NEW
  warnings,
};
```

In `buildScanPayload()` (`payload.js` line 201), replace the literal:

```javascript
version: findingsBlock.schemaVersion,  // "1.0" or "1.1"
```

And conditionally include `dependencies` in the payload `findings` block:

```javascript
findings: {
  services: findingsBlock.services,
  connections: findingsBlock.connections,
  schemas: findingsBlock.schemas,
  actors: findingsBlock.actors,
  ...(findingsBlock.dependencies.length > 0
    ? { dependencies: findingsBlock.dependencies }
    : {}),
},
```

This preserves the v1.0 payload shape for all existing scans and only emits the new field when deps were collected — zero breakage for hub consumers not yet on 1.1.

#### 4. `endScan()` stale-row extension for `service_dependencies`

No change to `endScan()` required. The `ON DELETE CASCADE` on `service_dependencies.service_id` means stale service rows deleted by `_stmtDeleteStaleServices` (line 816) automatically cascade to their dependency rows. This contrasts with the `schemas`/`fields` cleanup (lines 799–812) which requires explicit child-first deletes because schemas FK connections (not services), and connections are deleted before services. `service_dependencies` is a direct child of `services`, making cascade safe and sufficient.

---

### THE-1020: Three New Language Ecosystems

#### 1. `detect.sh` priority order — significance

`detect_project_type()` (`detect.sh` lines 29–42) uses priority order `python > rust > node > go`. This function is consumed **only** by `session-start.sh` line 114 for the "Detected: X" banner message. It does not gate agent-prompt selection. The JS `detectRepoType()` in `manager.js` line 155 is entirely independent of `detect.sh` and drives actual scan behavior. Conclusion: priority order in `detect.sh` affects only the session-start banner, not scan routing.

Changes needed in `detect.sh` for new ecosystems:

- `detect_project_type()` lines 29–42: add `build.gradle` / `build.gradle.kts` → `java` and `Gemfile` → `ruby` cases. Rust (`Cargo.toml`) is already handled at line 34.
- `detect_all_project_types()` lines 48–56: same additions.
- `detect_language()` lines 10–23: add `java` case (currently falls to `unknown`); add `rb` → `ruby`.

These changes are cosmetic (banner only) and safe to land at any time without blocking other work.

#### 2. `discovery.js` MANIFESTS list — agent-prompt impact

`discovery.js` lines 23–29:

```javascript
const MANIFESTS = [
  "package.json",
  "pyproject.toml",
  "go.mod",
  "Cargo.toml",
  "pom.xml",
];
```

Adding `"build.gradle"`, `"build.gradle.kts"`, and `"Gemfile"` affects **only** the `discoverNew()` function — it controls whether sibling directories are surfaced as "new repos" to link in the `/arcanon:map` flow. It does not affect agent prompt selection or scan logic. The `discoveryContext` JSON blob is assembled by the agent reading the repo directly; the MANIFESTS list just gates the repo link-suggestion UI.

No agent-prompt changes are required. The additions are additive with zero downstream risk.

#### 3. `auth-db-extractor.js` — file-discovery scoping per new language

File-discovery is already scoped by `language` via the `LANG_EXTENSIONS` map (`auth-db-extractor.js` lines 193–200). Adding Java and Ruby requires only two additions to that map:

```javascript
java: ['.java'],
ruby: ['.rb'],
```

`collectSourceFiles()` (line 208) handles the rest automatically — it walks the tree filtering by extension. No structural changes to the extractor.

The auth/DB signal dispatch uses plain object lookups (`AUTH_SIGNALS[lang]`, `DB_SOURCE_SIGNALS[lang]`) at lines 267–270. Adding new language keys to those objects is sufficient. The `language` value comes from `services.language` (set by the agent scan, fetched in the Phase B loop query at `manager.js` line 773) — no changes to that query.

New entries to add:

```javascript
// AUTH_SIGNALS
AUTH_SIGNALS.java = [
  { mechanism: 'jwt',     regex: /(jjwt|java-jwt|nimbus-jose)/i },
  { mechanism: 'oauth2',  regex: /(spring-security-oauth2|OAuthClientDetails|KeycloakSecurityContext)/i },
  { mechanism: 'session', regex: /(HttpSession|SessionCreationPolicy)/i },
];
AUTH_SIGNALS.ruby = [
  { mechanism: 'jwt',     regex: /(jwt\.decode|jwt\.encode|ruby-jwt)/i },
  { mechanism: 'oauth2',  regex: /(OmniAuth|doorkeeper|rack-oauth2)/i },
  { mechanism: 'session', regex: /(session\[:user|Devise|has_secure_password)/i },
  { mechanism: 'api-key', regex: /(authenticate_with_http_token|API_KEY)/i },
];
// DB_SOURCE_SIGNALS
DB_SOURCE_SIGNALS.java = [
  { backend: 'postgresql', regex: /(postgresql|PGSimpleDataSource|pgjdbc)/i },
  { backend: 'mysql',      regex: /(mysql-connector|MysqlDataSource)/i },
  { backend: 'mongodb',    regex: /(MongoClient|spring-data-mongodb)/i },
  { backend: 'redis',      regex: /(Jedis|Lettuce|RedisConnectionFactory)/i },
];
DB_SOURCE_SIGNALS.ruby = [
  { backend: 'postgresql', regex: /(pg\b|ActiveRecord.*postgresql)/i },
  { backend: 'mysql',      regex: /(mysql2|ActiveRecord.*mysql)/i },
  { backend: 'mongodb',    regex: /(Mongoid|Mongo::Client)/i },
  { backend: 'redis',      regex: /(Redis\.new|redis-rb)/i },
];
```

Note: `manager.js` `detectRepoType()` already handles `build.gradle` at lines 226–238 for Java library/service classification. No changes to that function are needed for THE-1020.

---

### THE-1021: Unified Drift Dispatcher

#### 1. `lib/worker-restart.sh` — minimum API surface

`worker-restart.sh` does not yet exist. It is a new file in `plugins/arcanon/lib/`. The duplicate logic it replaces lives in:

- `session-start.sh` lines 43–68: version check + `worker_start_background` call.
- `worker-start.sh` lines 28–61: stale-PID detection + version comparison + graceful/forceful kill.

Minimum API surface:

```bash
# lib/worker-restart.sh
# Source this file; do not execute directly.
# Requires worker-client.sh (for resolve_arcanon_data_dir) to be sourced first.

# should_restart_worker
# Sets _should_restart=true and _restart_reason=<string> if restart is warranted.
# Returns 0 always. Reads PID_FILE and PORT_FILE from DATA_DIR.
should_restart_worker() { ... }

# restart_worker_if_stale
# Calls should_restart_worker; kills and restarts if needed.
# Sets _worker_restarted=true if restart occurred.
# Returns 0 always (restart errors are non-fatal).
restart_worker_if_stale() { ... }
```

`worker-restart.sh` should source `data-dir.sh` directly (or rely on it being sourced already via `worker-client.sh`) — do not duplicate `resolve_arcanon_data_dir`. The `wait_for_worker` bc fork issue in `worker-client.sh` line 44 (`sleep "$(echo "scale=3; $interval_ms/1000" | bc)"`) is a pre-existing problem in the client, not the restart lib — do not fix it in this ticket.

Callers after refactor:

- `session-start.sh`: remove lines 43–68, add `source "$WORKER_CLIENT_LIB"` (already present) then `source worker-restart.sh` and call `restart_worker_if_stale`.
- `worker-start.sh`: remove lines 28–61, source `worker-restart.sh` and call `restart_worker_if_stale` early in the script body.

#### 2. `scripts/drift.sh` dispatcher — argv ownership

The dispatcher passes `"$@"` through to each subcommand. Each subcommand continues to source `drift-common.sh` and call `parse_drift_args "$@"` itself. The dispatcher does not own flag parsing internally — it is a thin router:

```bash
#!/usr/bin/env bash
# scripts/drift.sh — Unified drift dispatcher
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

SUBCOMMAND="${1:-all}"
shift || true

case "$SUBCOMMAND" in
  versions) exec bash "${SCRIPT_DIR}/drift-versions.sh" "$@" ;;
  types)    exec bash "${SCRIPT_DIR}/drift-types.sh"    "$@" ;;
  openapi)  exec bash "${SCRIPT_DIR}/drift-openapi.sh"  "$@" ;;
  all)
    bash "${SCRIPT_DIR}/drift-versions.sh" "$@"
    bash "${SCRIPT_DIR}/drift-types.sh"    "$@"
    bash "${SCRIPT_DIR}/drift-openapi.sh"  "$@"
    ;;
  *) echo "Unknown subcommand: $SUBCOMMAND" >&2; exit 1 ;;
esac
```

`exec` is used for single-subcommand dispatch (replaces the dispatcher process with the subcommand process — saves one fork). The `all` case uses plain `bash` so all three run sequentially and failures in one do not abort the others (matches the spirit of `set -euo pipefail` being per-script).

#### 3. Migration path — dual-invocability during transition

The critical invariant: each subcommand sources `drift-common.sh` at its own top level. This means direct invocation (`bash drift-versions.sh --all`) is always self-contained and works identically before and after the dispatcher lands.

Why this is safe:
- The dispatcher calls subcommands as subprocesses (`bash subcommand.sh "$@"`), never via `source`. No variable leakage.
- `DRIFT_TEST_LINKED_REPOS` is `export`ed by `drift-common.sh` line 63 and is inherited by subprocesses.
- No subcommand changes are required for the dispatcher to work.
- Existing callers that hardcode `bash drift-versions.sh` continue to work without modification.

The only coordination required: update the `/arcanon:drift` slash command (in `commands/`) to call `drift.sh` instead of individual subcommand scripts. That is additive.

---

## New Files vs. Modified Files

| Action | File | Ticket |
|--------|------|--------|
| NEW | `plugins/arcanon/worker/db/migrations/010_service_dependencies.js` | THE-1019 |
| NEW | `plugins/arcanon/worker/scan/enrichment/dep-collector.js` | THE-1019 |
| NEW | `plugins/arcanon/lib/worker-restart.sh` | THE-1021 |
| NEW | `plugins/arcanon/scripts/drift.sh` | THE-1021 |
| EDIT | `plugins/arcanon/worker/db/query-engine.js` — add `upsertDependency()` method + prepared statement in constructor | THE-1019 |
| EDIT | `plugins/arcanon/worker/hub-sync/payload.js` — `buildFindingsBlock` deps + `schemaVersion`; `buildScanPayload` version field | THE-1019 |
| EDIT | `plugins/arcanon/worker/scan/manager.js` — Phase B enrichment loop (~line 776): call `collectDependencies` after `runEnrichmentPass` | THE-1019 |
| EDIT | `plugins/arcanon/worker/scan/discovery.js` — MANIFESTS lines 23–29: add `build.gradle`, `build.gradle.kts`, `Gemfile` | THE-1020 |
| EDIT | `plugins/arcanon/worker/scan/enrichment/auth-db-extractor.js` — LANG_EXTENSIONS lines 193–200 + AUTH_SIGNALS + DB_SOURCE_SIGNALS | THE-1020 |
| EDIT | `plugins/arcanon/lib/detect.sh` — `detect_project_type` lines 29–42, `detect_all_project_types` lines 48–56, `detect_language` lines 10–23 | THE-1020 |
| EDIT | `plugins/arcanon/scripts/session-start.sh` — lines 43–68: replace inline restart logic with `source worker-restart.sh` + `restart_worker_if_stale` | THE-1021 |
| EDIT | `plugins/arcanon/scripts/worker-start.sh` — lines 28–61: replace inline restart logic with `source worker-restart.sh` + `restart_worker_if_stale` | THE-1021 |

---

## Data Flow Changes

### Scan Pipeline with THE-1019 insertion

```
Phase A (parallel agent invocations)
    ↓
Phase B (sequential, per-repo):
  persistFindings()         ← unchanged
  endScan()                 ← unchanged; CASCADE handles dep cleanup automatically
  enrichment loop:
    runEnrichmentPass()     ← existing: auth-db enricher + codeowners enricher
    collectDependencies()   ← NEW: reads manifest files, writes service_dependencies rows
  ↓
hub-sync (optional, fire-and-log):
  buildFindingsBlock()      ← reads deps from findings, emits schemaVersion
  buildScanPayload()        ← uses schemaVersion for version field ("1.0" or "1.1")
```

### Drift Dispatch with THE-1021

```
/arcanon:drift [subcommand] [flags]
    ↓
scripts/drift.sh
    ↓ (subprocess, passes "$@")
  versions → drift-versions.sh (self-contained, sources drift-common.sh)
  types    → drift-types.sh    (self-contained, sources drift-common.sh)
  openapi  → drift-openapi.sh  (self-contained, sources drift-common.sh)
  all      → all three sequentially
```

### Worker Restart with THE-1021

```
session-start.sh                  worker-start.sh
  source worker-client.sh    ←→     source data-dir.sh
  source worker-restart.sh         source worker-restart.sh
  restart_worker_if_stale()        restart_worker_if_stale()
       ↓ (shared logic)                  ↓ (shared logic)
  check PID liveness
  compare /api/version vs package.json version
  kill + respawn if mismatch
```

---

## Build Order and Parallelism

**Batch 1 — fully parallel, no cross-dependencies:**
- THE-1020: `discovery.js` MANIFESTS addition (2-line edit, zero risk)
- THE-1020: `detect.sh` language additions (additive, no callers break)
- THE-1021: `lib/worker-restart.sh` creation (new file, no callers yet)
- THE-1021: `scripts/drift.sh` creation (new file, additive)

**Batch 2 — depends on Batch 1 being merged:**
- THE-1020: `auth-db-extractor.js` Java/Ruby signal tables (safe once language decisions are confirmed)
- THE-1021: `session-start.sh` + `worker-start.sh` refactor (requires `worker-restart.sh` to exist)

**Batch 3 — THE-1019 in internal dependency order (serialized):**
1. `010_service_dependencies.js` migration (must land first — table must exist before writes)
2. `query-engine.js` `upsertDependency()` (requires migration table shape to be known)
3. `dep-collector.js` (new module — can be written once QE interface is defined)
4. `manager.js` Phase B loop edit (calls `dep-collector.js` — requires it to exist)
5. `payload.js` `buildFindingsBlock` + `buildScanPayload` changes (hub shape — land last to avoid partial state)

**THE-1019 is fully independent of THE-1020 and THE-1021.** The `discovery.js` MANIFESTS list (THE-1020) is for the repo link-suggestion UI and does not block dep collection — `dep-collector.js` reads manifests from disk directly. THE-1021 is entirely orthogonal to both.

---

## Test Strategy

| New/changed module | Test file | Framework | Key assertions |
|---|---|---|---|
| `010_service_dependencies.js` | `worker/db/migration-010.test.js` (NEW) | node:test | `up()` idempotent, `UNIQUE(service_id, ecosystem, name)` constraint, `ON DELETE CASCADE` removes rows when service deleted |
| `dep-collector.js` | `worker/scan/enrichment/dep-collector.test.js` (NEW) | node:test | npm/pip/cargo/maven/gem extraction from fixture manifest files in temp dirs; null-safe on missing manifests; `dev` flag set correctly |
| `query-engine.js` `upsertDependency` | `worker/db/query-engine-deps.test.js` (NEW) | node:test | insert, upsert-update (same name+ecosystem → version updated), cascade-on-service-delete |
| `payload.js` version bump | `worker/hub-sync/payload.test.js` (EXISTING — extend) | node:test | `schemaVersion="1.0"` when no deps; `schemaVersion="1.1"` when deps present; `dependencies` key absent from payload when empty |
| `auth-db-extractor.js` Java/Ruby | `worker/scan/enrichment/auth-db-extractor.test.js` (EXISTING — extend) | node:test | Java JWT fixture (`jjwt`), Ruby Devise fixture (`has_secure_password`), Java postgresql fixture (`pgjdbc`) |
| `lib/worker-restart.sh` | `lib/worker-restart.bats` (NEW) | bats | `should_restart_worker` returns no-restart when versions match; returns restart when mismatch; `restart_worker_if_stale` sets `_worker_restarted=true` |
| `scripts/drift.sh` | `scripts/drift.bats` (NEW) | bats | `versions` subcommand delegates to `drift-versions.sh`; `all` runs all three; unknown subcommand exits 1; `--all` flag passed through |
| `discovery.js` MANIFESTS | `worker/scan/discovery.test.js` (EXISTING — extend) | node:test | `discoverNew()` returns dirs containing `build.gradle`; returns dirs containing `Gemfile` |

Fixture strategy for `dep-collector.test.js`: create minimal temp-dir manifests — `package.json` with 2 deps, `Cargo.toml` with 1 dep, `pyproject.toml` with 1 PEP 621 dep, `pom.xml` with 1 dependency element, `Gemfile` with 1 `gem` line. No live repos required.

---

## Component Boundaries

| Component | Responsibility | Communicates With |
|-----------|---------------|-------------------|
| `dep-collector.js` | Read manifest files from disk, return normalized `{ecosystem, name, version, dev}` array; write to DB via `queryEngine.upsertDependency` | Called by `manager.js` Phase B loop; writes via `QueryEngine` |
| `010_service_dependencies.js` | Create `service_dependencies` table with `ON DELETE CASCADE` FK | Loaded by `database.js` migration runner at worker start |
| `QueryEngine.upsertDependency()` | Prepared `INSERT OR REPLACE INTO service_dependencies` | Called by `dep-collector.js` |
| `payload.js buildFindingsBlock` | Collect deps from findings, set `schemaVersion` | Called by `hub-sync/index.js` |
| `worker-restart.sh` | Encapsulate stale-PID + version-mismatch restart logic | Sourced by `session-start.sh` and `worker-start.sh` |
| `drift.sh` | Subcommand dispatcher — thin router, no own logic | Spawns `drift-versions.sh`, `drift-types.sh`, `drift-openapi.sh` as subprocesses |

---

## Anti-Patterns to Avoid

### Anti-Pattern 1: Opening a scan bracket inside `dep-collector.js`

`dep-collector.js` MUST NOT call `beginScan`/`endScan`. It runs after `endScan()` has already closed the bracket. A second `beginScan` would leave `scan_versions.completed_at = NULL` permanently, preserving stale rows forever. The rule is stated at `manager.js` line 769: "Enrichment MUST NOT call beginScan/endScan — never opens a new bracket." `dep-collector` is a post-scan writer, same category.

### Anti-Pattern 2: Using `source` to invoke drift subcommands from the dispatcher

The dispatcher must use `bash subcommand.sh "$@"` (subprocess), never `source`. Sourcing merges `set -euo pipefail` and all variable state. In the `all` case, a failure in `drift-versions.sh` would abort the dispatcher before `drift-types.sh` and `drift-openapi.sh` run.

### Anti-Pattern 3: Adding a `scan_version_id` column to `service_dependencies`

Because `service_dependencies` uses `ON DELETE CASCADE` from `services(id)`, a `scan_version_id` column is unnecessary. Adding one creates a two-path cleanup (cascade AND explicit stale-delete) that can diverge, potentially leaving orphans. The cascade is the single source of truth.

### Anti-Pattern 4: Confusing `discovery.js` MANIFESTS with `manager.js` `detectRepoType`

`discovery.js` MANIFESTS controls repo link-suggestion UI discovery. `manager.js` `detectRepoType()` controls scan-prompt routing. They are independent. Adding `build.gradle` to MANIFESTS (THE-1020) does not require any change to `detectRepoType()` — that function already handles `build.gradle` / `build.gradle.kts` at lines 226–238 for Java library/service classification.

---

## Sources

All findings derived from direct inspection of:
- `plugins/arcanon/worker/scan/manager.js` (full — 854 lines)
- `plugins/arcanon/worker/scan/discovery.js` (full)
- `plugins/arcanon/worker/db/query-engine.js` (full — 1505 lines)
- `plugins/arcanon/worker/hub-sync/payload.js` (full — 248 lines)
- `plugins/arcanon/worker/scan/enrichment/auth-db-extractor.js` (lines 1–350)
- `plugins/arcanon/worker/db/migrations/009_confidence_enrichment.js` (full — canonical migration pattern)
- `plugins/arcanon/lib/detect.sh` (full)
- `plugins/arcanon/lib/worker-client.sh` (full)
- `plugins/arcanon/scripts/drift-common.sh` (full)
- `plugins/arcanon/scripts/drift-versions.sh` (lines 1–200)
- `plugins/arcanon/scripts/session-start.sh` (full)
- `plugins/arcanon/scripts/worker-start.sh` (full)
- Migration inventory: 001–009 confirmed via glob
- Drift scripts inventory: `drift-common.sh`, `drift-openapi.sh`, `drift-types.sh`, `drift-versions.sh` confirmed via glob
- `lib/worker-restart.sh` and `scripts/drift.sh` confirmed absent (glob returned empty)

*Architecture research for: Library Drift & Language Parity milestone (THE-1019, THE-1020, THE-1021)*
*Researched: 2026-04-19*
