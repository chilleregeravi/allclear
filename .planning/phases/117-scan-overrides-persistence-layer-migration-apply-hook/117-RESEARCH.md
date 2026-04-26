# Phase 117: scan_overrides Persistence Layer — Research

**Researched:** 2026-04-25
**Domain:** SQLite migration shape, query-engine CRUD helper conventions, scan-pipeline injection between `persistFindings` and `endScan`
**Confidence:** HIGH (every claim cited to file:line)
**Note:** Phase 117 carried `requires_discuss: true` in ROADMAP. Per orchestrator instruction, the discuss-phase questions are resolved INSIDE this research + plan pair instead of via a separate `/gsd-discuss-phase` round. Section 5 below contains the locked-in schema and the rationale for each design decision; Section 6 documents the polymorphic-FK / conflict-resolution / apply-granularity decisions; Section 7 documents the `applyPendingOverrides` signature.

## Summary

Phase 117 ships migration `017_scan_overrides.js` (a new write-side table) and the persistence + apply path that lets operators stage manual corrections which the next scan applies idempotently. Three deliverables compose the phase:

1. **Migration 017** creates `scan_overrides` with the columns CORRECT-01 specifies, plus two indexes (one for the per-scan apply lookup, one for "show pending overrides" queries). The migration follows the `CREATE TABLE IF NOT EXISTS` / `CREATE INDEX IF NOT EXISTS` pattern of migration 016 (`enrichment_log`) — no PRAGMA guard needed.
2. **Three new query-engine helpers** — `upsertOverride`, `getPendingOverrides`, `markOverrideApplied` — modeled on the `logEnrichment` / `getEnrichmentLog` / `upsertNodeMetadata` pattern at `query-engine.js:1080-1170`. Each is wrapped in a `try/catch` so a pre-017 db cleanly disables the writers/readers (returns null / empty array) — matches the existing fallback convention.
3. **A new `applyPendingOverrides(scanVersionId, queryEngine)` function** in a new file `worker/scan/overrides.js`, called from `manager.js` at the exact gap between `persistFindings` (line 797) and `endScan` (line 798). The function applies pending overrides via direct UPDATE/DELETE writes to `connections` and `services`, then stamps `applied_in_scan_version_id` on each override row. **This is the first plan in v0.1.4 that writes to existing domain tables (`connections`, `services`) — every prior write-side phase (Phase 111-113 audit log, enrichment log, quality_score) wrote only to NEW tables or to nullable additive columns. The threat model in Plan 117-02 explicitly calls this boundary crossing out.**

The injection-site question that ROADMAP §117 flags as a pre-flight blocker is resolved in Section 7 below: `manager.js:797-798` are adjacent in the Phase B success path, and the apply-hook slots in as a single new line BETWEEN them, taking `r.scanVersionId` and `queryEngine` as parameters and the `slog` closure for logging.

## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| CORRECT-01 | Migration 017 creates `scan_overrides` table | Section 5 (locked schema) + Section 1 (migration shape) |
| CORRECT-02 | `/arcanon:correct` writes to `scan_overrides` | Section 4 (`upsertOverride` helper). Note: the `/arcanon:correct` command itself ships in Phase 118; Phase 117 only ships the persistence helper. |
| CORRECT-03 | Scan pipeline reads pending overrides BEFORE `endScan` and stamps `applied_in_scan_version_id` | Section 7 (`applyPendingOverrides` function + `manager.js:797-798` injection) |

---

## 1. Migration shape conventions (013-016)

Migration 017 follows the **`CREATE TABLE IF NOT EXISTS` + `CREATE INDEX IF NOT EXISTS`** pattern from migration 016 (`enrichment_log` at `migrations/016_enrichment_log.js:34-53`). This is the right pattern for a brand-new table — natively idempotent, no `PRAGMA table_info` probe required.

Patterns observed across the recent migration set:

- **`CREATE TABLE IF NOT EXISTS` (mig 016)** — used when the migration adds a brand-new table. Native idempotency. Mig 017 follows this.
- **`PRAGMA table_info` + conditional `ALTER TABLE`** (migs 011, 014, 015) — used when adding a column to an existing table. Mig 017 does NOT need this.
- **`PRAGMA index_list` + conditional `CREATE UNIQUE INDEX`** (mig 013) — used when the index has dedup pre-work. Mig 017's indexes are non-UNIQUE, so plain `CREATE INDEX IF NOT EXISTS` is sufficient.

**Migration file shape** (mirrors `016_enrichment_log.js`):

```javascript
/**
 * Migration NNN — <one-line summary>.
 *
 * <2-3 paragraph rationale referencing CONTEXT.md / RESEARCH.md decisions>
 *
 * Idempotent natively via `CREATE TABLE IF NOT EXISTS` and
 * `CREATE INDEX IF NOT EXISTS` — no PRAGMA guard needed.
 *
 * Note: db.exec is better-sqlite3's SQL execution method (not Node's
 * child_process). It runs DDL against the SQLite database — no shell.
 */

export const version = NN;

const DDL = `<multiline DDL>`;

/**
 * @param {import('better-sqlite3').Database} db
 */
export function up(db) {
  db.exec(DDL);
}
```

**File:line summary:**
- Mig 016 native-idempotent template: `migrations/016_enrichment_log.js:32-60`
- Mig 015 PRAGMA-guarded ALTER template: `migrations/015_scan_versions_quality_score.js:23-40`
- Mig 014 PRAGMA-guarded ALTER template: `migrations/014_services_base_path.js:23-40`
- Mig 013 PRAGMA-guarded UNIQUE index pattern: `migrations/013_connections_path_template.js:44-114`

**Loader behavior:** `database.js:41-68` sorts migrations by exported `version` integer (the gap from 11 → 13 in the v0.1.3 sequence is intentional and harmless — the loader skips missing numbers). Migration 017 is `version: 17` and runs after 016.

---

## 2. Query-engine CRUD helper conventions

Three helpers ship: `upsertOverride`, `getPendingOverrides`, `markOverrideApplied`. All three follow the `logEnrichment` / `getEnrichmentLog` template at `query-engine.js:1080-1170`:

1. **Prepared statement armed in the constructor**, wrapped in `try/catch`. If the table is absent (pre-mig-017 db), the prepared statement is set to `null` and the helper becomes a no-op (returns `null` or `[]`). Mirrors `_stmtInsertEnrichmentLog` at `query-engine.js:670-690`.
2. **Public method** at the bottom of the class with full JSDoc, including the "MUST NOT call beginScan/endScan" note where relevant. Mirrors `logEnrichment(...)` at `query-engine.js:1120-1142`.
3. **Bind parameters by position OR named** — `logEnrichment` uses positional, `upsertNodeMetadata` uses named (`@service_id`). Plan 117-01 uses named parameters for `upsertOverride` (matches the more-recent style at `query-engine.js:580-590`).

**Statement-arming template** (excerpt from `query-engine.js:670-690`, the closest existing analog):

```javascript
this._stmtInsertOverride = null;
this._stmtSelectPendingOverrides = null;
this._stmtMarkOverrideApplied = null;
try {
  this._stmtInsertOverride = db.prepare(`
    INSERT INTO scan_overrides
      (kind, target_id, action, payload, created_by)
    VALUES
      (@kind, @target_id, @action, @payload, @created_by)
  `);
  this._stmtSelectPendingOverrides = db.prepare(`
    SELECT override_id, kind, target_id, action, payload, created_at, created_by
    FROM scan_overrides
    WHERE applied_in_scan_version_id IS NULL
    ORDER BY created_at ASC, override_id ASC
  `);
  this._stmtMarkOverrideApplied = db.prepare(`
    UPDATE scan_overrides
    SET applied_in_scan_version_id = ?
    WHERE override_id = ?
  `);
} catch {
  // scan_overrides table absent (pre-migration-017 db)
  this._stmtInsertOverride = null;
  this._stmtSelectPendingOverrides = null;
  this._stmtMarkOverrideApplied = null;
}
```

**Public method shape** (mirrors `logEnrichment` at `query-engine.js:1120-1142`):

```javascript
/**
 * Insert a pending override row. (CORRECT-01 / CORRECT-02 — migration 017.)
 *
 * No-op (returns null) when migration 017 is not applied — the table is
 * absent and the prepared statement could not arm in the constructor.
 *
 * MUST NOT call beginScan/endScan — overrides are persisted by the
 * /arcanon:correct command (Phase 118), which runs OUTSIDE any scan bracket.
 *
 * @param {{ kind: 'connection'|'service', target_id: number,
 *           action: 'delete'|'update'|'rename'|'set-base-path',
 *           payload: object, created_by?: string }} row
 * @returns {number|null} override_id (lastInsertRowid), or null on pre-017 db
 */
upsertOverride(row) {
  if (!this._stmtInsertOverride) return null;
  const result = this._stmtInsertOverride.run({
    kind: row.kind,
    target_id: row.target_id,
    action: row.action,
    payload: JSON.stringify(row.payload ?? {}),
    created_by: row.created_by ?? 'system',
  });
  return Number(result.lastInsertRowid);
}

/**
 * Read all overrides where applied_in_scan_version_id IS NULL.
 * Sort: created_at ASC, override_id ASC (stable).
 * Returns [] on pre-017 db, on read error, or when no pending rows exist.
 * Caller is responsible for JSON.parse on each row.payload.
 *
 * @returns {Array<{override_id:number, kind:string, target_id:number,
 *   action:string, payload:string, created_at:string, created_by:string|null}>}
 */
getPendingOverrides() {
  if (!this._stmtSelectPendingOverrides) return [];
  try { return this._stmtSelectPendingOverrides.all(); }
  catch { return []; }
}

/**
 * Stamp applied_in_scan_version_id on a single override row.
 * No-op (returns null) on pre-017 db.
 *
 * @param {number} overrideId
 * @param {number} scanVersionId
 * @returns {number|null} rows-affected count, or null on pre-017
 */
markOverrideApplied(overrideId, scanVersionId) {
  if (!this._stmtMarkOverrideApplied) return null;
  const result = this._stmtMarkOverrideApplied.run(scanVersionId, overrideId);
  return result.changes;
}
```

**File:line summary:**
- `logEnrichment` reference template: `query-engine.js:1100-1170`
- Constructor statement-arming pattern: `query-engine.js:670-690`
- `upsertNodeMetadata` named-param template: `query-engine.js:1080-1098`

---

## 3. Manager.js injection point — confirmed

ROADMAP §117 pre-flight states: "v0.1.3's `worker/scan/manager.js` has no extension point between `persistFindings` and `endScan` (calls are adjacent at manager.js:797–798)."

**Verified.** `manager.js:796-798`:

```javascript
    // 10. Persist findings and close scan bracket — success path only
    queryEngine.persistFindings(r.repoId, r.findings, r.currentHead, r.scanVersionId);
    queryEngine.endScan(r.repoId, r.scanVersionId);
```

The two calls are adjacent inside the Phase B `for (const r of agentResults)` loop (`manager.js:788-880`). Phase B is sequential, single-DB-handle. The injection is a single line BETWEEN 797 and 798, taking `r.scanVersionId` and `queryEngine` as parameters and the `slog` closure for logging:

```javascript
    // 10. Persist findings and close scan bracket — success path only
    queryEngine.persistFindings(r.repoId, r.findings, r.currentHead, r.scanVersionId);

    // 10b. CORRECT-03: apply pending operator overrides BEFORE endScan finalizes.
    //      Reads `scan_overrides WHERE applied_in_scan_version_id IS NULL`, applies
    //      each via direct UPDATE/DELETE on connections/services, stamps the override
    //      row with r.scanVersionId. Idempotent re-application: already-applied rows
    //      are filtered by the SELECT WHERE clause.
    await applyPendingOverrides(r.scanVersionId, queryEngine, slog);

    queryEngine.endScan(r.repoId, r.scanVersionId);
```

Three properties of this injection site matter:

1. **It runs in the success path only.** The Phase B loop's `if (!r._writeDb) continue;` at `manager.js:789` already filters out skip/noop/error results. Overrides ONLY apply on a real successful scan — they never fire on `incremental-noop` or skipped repos.
2. **It runs INSIDE the open scan bracket** (after `persistFindings` writes the findings rows tagged with `scanVersionId`, before `endScan` closes the bracket and removes stale rows). This means an override-driven DELETE on a connection/service deletes the row that `persistFindings` JUST wrote with the current `scanVersionId` — the override "wins" without needing to touch the agent's findings before they hit the DB. No re-design of `persistFindings` required.
3. **`endScan`'s stale cleanup runs AFTER the apply-hook.** This means if the apply-hook deletes connection X (via a `delete` override), and the same scan also produced connection X via the agent (which was re-written by `persistFindings`), the delete is the latest write; `endScan`'s stale cleanup operates only on rows whose `scan_version_id != current`, so the now-deleted row is gone (good) and is not subject to a subsequent restore.

**File:line summary:**
- Adjacent call site: `manager.js:797-798`
- Phase B loop boundaries: `manager.js:788` (start) — `manager.js:879` (end of loop body before HUB-01 block at 882)
- `slog` closure definition: `manager.js:609-611`
- `endScan` stale-cleanup behavior: `query-engine.js:1310-1395`

---

## 4. Existing connection / service mutation patterns

The apply-hook needs to perform UPDATE / DELETE on `connections` and `services`. The existing query-engine has `upsertConnection` (`query-engine.js:888-906`) and `upsertService` (`query-engine.js:856-881`) but NO targeted DELETE or UPDATE-by-id. The apply-hook does direct SQL via `queryEngine._db.prepare(...).run(...)` — same pattern as the back-fill block at `manager.js:805-807` and the inline writes inside `endScan` at `query-engine.js:1346-1383`.

**Why direct SQL and not new helpers in QueryEngine:**

- The override actions are operator-driven, not scan-driven; they don't need the sanitization / FTS5 trigger machinery `upsertConnection` provides (the existing INSERT/UPDATE/DELETE triggers fire automatically on raw SQL writes — see `migrations/001_initial_schema.js:120-135`).
- A `delete` override is `DELETE FROM connections WHERE id = ?` — one line. Wrapping that in a `deleteConnection(id)` helper adds a layer with no callers other than the apply-hook itself.
- A `rename` service override is `UPDATE services SET name = ? WHERE id = ?` — one line. Same argument.

If a future phase wants reusable mutators, they can be extracted then. Phase 117 keeps the surface area minimal.

**Existing direct-SQL precedent inside the scan path:**

```javascript
// manager.js:805-807 — direct prepare/all for back-fill
const dbServices = queryEngine._db
  .prepare('SELECT id, name FROM services WHERE repo_id = ?')
  .all(r.repoId);
```

```javascript
// query-engine.js:1346-1353 — direct prepare inside endScan stale cleanup
this._db.prepare(`
  DELETE FROM ... WHERE ...
`).run(...);
```

**Note on FTS5 triggers:** `services` and `connections` both have `AFTER DELETE` and `AFTER UPDATE` triggers (`migrations/001_initial_schema.js:107-114, 125-135`) that keep the FTS5 mirror tables in sync. Direct `DELETE FROM services WHERE id = ?` and `UPDATE services SET name = ? WHERE id = ?` will fire the triggers correctly — no manual FTS5 sync needed in the apply-hook.

**File:line summary:**
- FTS5 triggers (auto-fire on DELETE/UPDATE): `migrations/001_initial_schema.js:103-152`
- Direct-SQL precedent: `manager.js:805-807`, `query-engine.js:1346-1383`
- `upsertConnection` (NOT used by apply-hook): `query-engine.js:888-906`
- `upsertService` (NOT used by apply-hook): `query-engine.js:856-881`

---

## 5. Locked-in schema (resolves discuss-phase Q1: column types + payload shape)

Migration 017 ships this exact DDL. Each design decision has rationale below the SQL.

```sql
CREATE TABLE IF NOT EXISTS scan_overrides (
  override_id                INTEGER PRIMARY KEY AUTOINCREMENT,
  kind                       TEXT    NOT NULL CHECK(kind IN ('connection', 'service')),
  target_id                  INTEGER NOT NULL,
  action                     TEXT    NOT NULL CHECK(action IN ('delete', 'update', 'rename', 'set-base-path')),
  payload                    TEXT    NOT NULL DEFAULT '{}',
  created_at                 TEXT    NOT NULL DEFAULT (datetime('now')),
  applied_in_scan_version_id INTEGER REFERENCES scan_versions(id) ON DELETE SET NULL,
  created_by                 TEXT    NOT NULL DEFAULT 'system'
);

CREATE INDEX IF NOT EXISTS idx_scan_overrides_kind_target
  ON scan_overrides(kind, target_id);

CREATE INDEX IF NOT EXISTS idx_scan_overrides_pending
  ON scan_overrides(applied_in_scan_version_id);
```

### Per-column rationale

| Column | Type | Decision rationale |
|---|---|---|
| `override_id` | `INTEGER PRIMARY KEY AUTOINCREMENT` | Standard surrogate key, matches every other table. AUTOINCREMENT (vs implicit ROWID) prevents ID reuse if a row is deleted — important because `applied_in_scan_version_id` may reference an `override_id` from external logging. |
| `kind` | `TEXT NOT NULL CHECK(...)` | Discriminant for the polymorphic `target_id`. CHECK constraint enforces the closed set; matches the pattern used by `enrichment_log.target_kind` (`migrations/016_enrichment_log.js:39`). |
| `target_id` | `INTEGER NOT NULL` | **No FK** because the target is polymorphic (`connections.id` OR `services.id` based on `kind`). SQLite has no polymorphic FK support; the apply-hook validates target existence at apply time and logs+skips dangling rows (Section 6, decision D-04). Same approach as `enrichment_log.target_id` (`migrations/016_enrichment_log.js:40`). |
| `action` | `TEXT NOT NULL CHECK(...)` | Closed set of 4 verbs the apply-hook understands. CHECK rejects unknown actions at INSERT time — fail-fast prevents an unknown action sitting silently in the table waiting to confuse the apply-hook. |
| `payload` | `TEXT NOT NULL DEFAULT '{}'` | JSON-encoded action params. NOT NULL with a `'{}'` default lets callers omit payload for `delete` (which carries no params) without writing a literal NULL. The apply-hook always `JSON.parse`s and tolerates `{}`. |
| `created_at` | `TEXT NOT NULL DEFAULT (datetime('now'))` | ISO-string timestamp, matches existing convention at `migrations/016_enrichment_log.js:45`, `migrations/001_initial_schema.js:69`. **Decision D-01 (timestamp format)**: TEXT ISO-string (not INTEGER epoch-seconds/millis). Matches every other table in the schema — uniformity wins. |
| `applied_in_scan_version_id` | `INTEGER REFERENCES scan_versions(id) ON DELETE SET NULL` | Nullable until applied. **`ON DELETE SET NULL` is intentional**: if a scan_versions row is deleted (during retention cleanup), the override row becomes "pending again" rather than being deleted. This is the safer default — it means an override that was applied on a since-purged scan_version will be re-applied on the next scan. If we wanted "stay applied even if the scan_version is gone", we'd use `ON DELETE NO ACTION`, but that risks a dangling FK. SET NULL has clean semantics. |
| `created_by` | `TEXT NOT NULL DEFAULT 'system'` | Operator identifier. Defaults to `'system'` per CORRECT-01 spec. NOT NULL with default avoids three-valued logic in queries that group by author. |

### `payload` JSON shape per action (resolves discuss-phase Q1: payload shape)

Each row's `payload` MUST conform to the per-action schema below. The apply-hook validates shape at apply time (not at INSERT time — keeps Phase 117 SQL-only and lets Phase 118's `/arcanon:correct` ship richer validation if needed):

```jsonc
// action='delete'  (kind='connection' | kind='service')
//   target_id is sufficient. Payload carries no params.
{}

// action='update'  (kind='connection' only)
//   Repoint a connection's source/target service id, and optionally
//   reword the evidence string. All three fields optional; at least one
//   MUST be present (apply-hook logs + skips no-op updates).
{
  "source_service_id": 12,   // optional INTEGER — new source
  "target_service_id": 34,   // optional INTEGER — new target
  "evidence": "..."          // optional TEXT — replacement evidence
}

// action='rename'  (kind='service' only)
//   Change a service's name. new_name MUST be non-empty.
{
  "new_name": "billing-api"
}

// action='set-base-path'  (kind='service' only)
//   Change a service's base_path (mig 014 column). Empty string means
//   clear the base_path back to NULL.
{
  "base_path": "/api"
}
```

**Why per-action shape and not a single fat object:** keeps the JSON parseable and keeps the apply-hook's switch statement readable. No field appears in two action shapes with different meanings. The apply-hook validates per-action via a small dispatch table (Plan 117-02 §4).

**`kind` x `action` validity matrix** (the apply-hook enforces this in JS, not SQL — keeps the migration simple):

| | delete | update | rename | set-base-path |
|---|---|---|---|---|
| **connection** | yes | yes | no - log+skip | no - log+skip |
| **service**    | yes | no - log+skip | yes | yes |

`kind='service' AND action='update'` is intentionally absent (a service `update` doesn't have a meaningful payload — services are mutated via `rename` or `set-base-path`). Future extensions (e.g., `service` x `set-language`) ship as new actions in a future migration, not as a payload variant.

### Index rationale

- `idx_scan_overrides_kind_target` — used by future "is there an override for this connection/service?" lookups (could be useful in `/arcanon:correct` itself when checking for collisions). Cheap to maintain, cheap to drop later if unused.
- `idx_scan_overrides_pending` — used by `getPendingOverrides()`'s `WHERE applied_in_scan_version_id IS NULL` filter. SQLite indexes NULL values, so this filter is a fast scan of the NULL-valued portion of the index.

---

## 6. Conflict resolution + apply granularity (resolves discuss-phase Q2 + Q3)

### D-02 Conflict resolution: override wins.

The apply-hook runs INSIDE the open scan bracket (after `persistFindings`, before `endScan`). When an override targets a connection/service that the agent ALSO produced in the current scan, the order of operations is:

1. `persistFindings` writes the agent's row with `scan_version_id = current`.
2. `applyPendingOverrides` UPDATEs / DELETEs that same row.
3. `endScan` runs stale cleanup (rows where `scan_version_id != current AND NOT NULL`).

**Result:** the override's mutation is the final state. If the override was DELETE, the row is gone. If the override was UPDATE/RENAME/SET-BASE-PATH, the agent's freshly-written values are overwritten by the override's values. The agent CANNOT "win" because the override runs after `persistFindings`.

This matches the orchestrator's stated rule ("override wins") and is documented in the apply-hook's JSDoc.

**Note on re-introduction:** if the agent re-emits the same connection in a SUBSEQUENT scan (no override pending — the override was already applied and stamped), the agent's emission will be persisted normally. To make a delete sticky across re-scans, the operator stages a NEW override (the workflow `/arcanon:correct connection N --action delete` per re-scan). This is intentional and documented in CORRECT-03's "applied overrides skipped on subsequent scans" — the table is an apply-once log, not a permanent rule store. Permanent rules (e.g., always-ignore-this-connection) are a future-phase concern.

### D-03 Apply granularity: per-override.

`applied_in_scan_version_id` is set ON EACH override row individually as it is applied, NOT in a single batch UPDATE at the end of the apply pass. This is the correct call for two reasons:

1. **Crash recovery:** if the apply-hook crashes halfway through 10 overrides, the 5 that succeeded are stamped and won't be re-applied; the 5 that didn't are still pending and will retry on the next scan. Per-batch stamping would either (a) lose the partial progress (if stamp-at-end and crash before stamp) or (b) require a transaction wrap across all 10 overrides plus all the connection/service writes — much more invasive.
2. **Auditability:** per-override stamping means the table tells you exactly when each correction took effect. Per-batch stamping loses that resolution.

The cost is one extra UPDATE per override (`markOverrideApplied(id, scanVersionId)`). At expected volumes (operators stage tens of overrides, not thousands), this is negligible.

### D-04 Dangling target_id handling: log + skip.

If a `delete` override targets `connection_id = 42` and connection 42 was deleted between the override's creation and the next scan's apply pass (e.g., a previous `endScan` stale-cleanup removed it), the override's UPDATE/DELETE affects 0 rows. The apply-hook does NOT throw — it logs at WARN level (`slog('WARN', 'override target missing - skipping', {...})`) and STILL stamps the override as applied. Stamping is correct because the user's intent (the row is gone) is satisfied; leaving it pending would cause the WARN to repeat on every future scan.

Same handling for an `update` whose target_id doesn't match any current connection — log + stamp + move on.

This is the gentlest behavior consistent with idempotency. Documented explicitly in the apply-hook's JSDoc and tested in Plan 117-02.

---

## 7. `applyPendingOverrides` function signature (resolves discuss-phase Q4)

**File:** new `worker/scan/overrides.js`.

```javascript
/**
 * worker/scan/overrides.js — Apply pending operator overrides to the current
 * scan_version, between persistFindings and endScan.
 *
 * CORRECT-03: scan pipeline reads scan_overrides BEFORE endScan and applies
 * pending overrides to the persisted findings. Override is marked
 * applied_in_scan_version_id on apply. Already-applied overrides skipped
 * on subsequent scans (filtered by the SELECT WHERE applied_in_scan_version_id IS NULL).
 *
 * Conflict resolution (RESEARCH section 6 D-02): override wins. The apply pass runs
 * AFTER persistFindings has written the agent's rows for this scan_version,
 * so any UPDATE/DELETE here overrides what the agent just wrote.
 *
 * Apply granularity (RESEARCH section 6 D-03): per-override. Each override is stamped
 * with applied_in_scan_version_id immediately after its mutation succeeds.
 *
 * Dangling target handling (RESEARCH section 6 D-04): UPDATE/DELETE that affects 0
 * rows is logged at WARN and the override is STILL stamped — the user's intent
 * is satisfied (the row is already gone) and leaving it pending would repeat
 * the WARN on every future scan.
 *
 * Threat model: this is the FIRST function in v0.1.4 that writes to the
 * EXISTING `connections` and `services` domain tables (every prior v0.1.4 phase
 * wrote only to NEW tables or nullable additive columns). All writes here go
 * through the existing FTS5 triggers (mig 001) so the search index stays in
 * sync. No raw user strings are interpolated into SQL — payload values bind
 * via parameter placeholders.
 *
 * @param {number} scanVersionId - The ID returned by beginScan; stamped onto
 *   each applied override.
 * @param {import('../db/query-engine.js').QueryEngine} queryEngine
 * @param {(level: string, msg: string, extra?: object) => void} slog -
 *   The scan-local log helper from manager.js (no-ops silently when logger
 *   not injected).
 * @returns {Promise<{applied: number, skipped: number, errors: number}>}
 *   Counters useful for the per-scan slog summary line. `applied` = override
 *   stamped; `skipped` = mismatched kind x action or unknown action (no stamp);
 *   `errors` = SqliteError thrown during apply (override left pending).
 */
export async function applyPendingOverrides(scanVersionId, queryEngine, slog) {
  // Implementation in Plan 117-02.
}
```

**Why a separate file (not inlined in manager.js):**

- `manager.js` is already 961 lines with 14 exports. The override apply pass is a self-contained unit with its own action-dispatch switch — it deserves its own file like `enrichment.js` (its closest analog).
- Phase 118's `/arcanon:correct` command will live in `worker/cli/hub.js` and call `queryEngine.upsertOverride(...)` directly — it does NOT need to import `applyPendingOverrides`. Keeping the apply-hook in its own file is fine for both consumers.
- Tests are simpler: `worker/scan/overrides.test.js` can stub `queryEngine` without pulling in the full `manager.js` import graph.

**Why `async`:** the function is `async` for symmetry with the rest of the Phase B loop, even though all DB calls inside it are synchronous (better-sqlite3 is sync). Keeping it `async` lets a future enricher-style hook be added without changing the call signature.

**Logging contract** (used by Plan 117-02):

- `slog('INFO', 'overrides apply BEGIN', { count })` — at the top, with the count from `getPendingOverrides()`.
- `slog('INFO', 'override applied', { override_id, kind, target_id, action })` — per-override success.
- `slog('WARN', 'override target missing - skipping', { override_id, kind, target_id, action })` — dangling target.
- `slog('WARN', 'override invalid kind x action - skipping', { override_id, kind, action })` — matrix violation (Section 5 matrix).
- `slog('ERROR', 'override apply failed', { override_id, error })` — SqliteError caught; override left pending.
- `slog('INFO', 'overrides apply DONE', counters)` — at the bottom.

**File:line anchors for Plan 117-02:**
- Manager.js inject site: `manager.js:797-798`
- slog signature: `manager.js:609-611`
- Direct-SQL DELETE/UPDATE precedent: `query-engine.js:1346-1383`
- enrichment.js architecture (file-shape model): `worker/scan/enrichment.js`

---

## 8. Test surface

Phase 117 ships the following tests:

1. **Node test — migration idempotency** (`worker/db/migrations/017_scan_overrides.test.js`): apply 017 twice on a fresh db; verify `scan_overrides` exists with the correct columns and indexes; verify second apply is a no-op (no error). Mirrors `migrations/016_enrichment_log.test.js` if it exists; otherwise mirrors `query-engine.quality-score.test.js` setup.
2. **Node test — query-engine helpers** (`worker/db/query-engine.scan-overrides.test.js`): round-trip insert via `upsertOverride`, read via `getPendingOverrides` (assert sort order), stamp via `markOverrideApplied`, re-read via `getPendingOverrides` (assert no longer pending). Test the pre-017 fallback (helpers return null/[] without throwing).
3. **Node test — apply-hook unit** (`worker/scan/overrides.test.js`): stub `queryEngine` with `getPendingOverrides` returning [delete-conn, rename-svc, update-conn-dangling]; call `applyPendingOverrides(42, qe, slogStub)`; assert: deleted connection is gone, renamed service has new name, dangling override is stamped + WARN logged. Also test invalid kind x action combo logs WARN + skips.
4. **bats E2E — manager.js integration** (`tests/scan-overrides-apply.bats`): seed an override in a fixture db, run a scan via the CLI, assert the override was applied + stamped.

Test fixtures live at `plugins/arcanon/tests/fixtures/overrides/`. Bats files at repo-root `tests/` (per orchestrator hard constraint).

---

## 9. Risk register

| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| Apply-hook crashes mid-pass leaving partial state | LOW | MEDIUM | Per-override stamping (D-03) + try/catch per override (counters increment, WARN logged, next scan retries the unstamped ones) |
| Apply-hook deletes the wrong row (target_id mismatch / stale id) | LOW | HIGH | UPDATE/DELETE specifies `WHERE id = ?` only — no fuzzy matching. Dangling targets are no-op (0 rows affected) and stamped; cannot mistakenly delete an unrelated row. |
| FTS5 mirror desync after override-driven UPDATE/DELETE | LOW | LOW | Mig 001's AFTER UPDATE/DELETE triggers fire on raw SQL writes — no manual sync needed. Verified in Section 4. |
| Operator stages 10K+ overrides degrading scan latency | LOW | LOW | At realistic operator volumes (tens), the apply pass adds <50ms per scan. If volumes ever grow, batching is a future-phase optimization. |
| Migration 017 collides with a future hand-applied 017 in a user db | NEAR-ZERO | LOW | `CREATE TABLE IF NOT EXISTS` is the safety net. If the user pre-created a `scan_overrides` table with a different schema, the migration is a no-op and the prepared-statement try/catch in query-engine takes over (helpers cleanly disable). Documented in migration 017 header. |
| Polymorphic target_id corrupts on a kind change after creation | NEAR-ZERO | LOW | `kind` is set at INSERT time and there is no public mutator for it. The apply-hook uses `kind` to choose the table; an INSERT-time mistake would be caught at apply time (target_id not found in the chosen table → log+skip). |

---

*Researched 2026-04-25 by gsd-phase-researcher (Phase 117).*
