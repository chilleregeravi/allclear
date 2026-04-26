# Phase 115: Scan-Version Diff Command (`/diff`) — Research

**Researched:** 2026-04-26
**Domain:** Arcanon plugin scan-version reconciliation, set-diff over services + connections, CLI input-form resolution
**Confidence:** HIGH (every load-bearing claim cited to file:line)

## Summary

Phase 115 ships `/arcanon:diff <scanA> <scanB>` — a read-only command that resolves two scan-version selectors (integer ID, `HEAD`/`HEAD~N`, ISO timestamp, or branch heuristic) to two `scan_versions.id` rows, queries the persisted services + connections rows associated with each, and emits an added/removed/modified report. The diff engine is a small in-memory set-diff over rows already grouped by `scan_version_id` (no SQL `EXCEPT`/`INTERSECT` complexity), parameterised by **DB path** so Phase 119's `/arcanon:diff --shadow` can swap one side for the shadow DB with a single argument change.

**Primary recommendation:** Two plans.
- **115-01** — pure diff engine module (`worker/diff/scan-version-diff.js`) + scan-version resolver (`worker/diff/resolve-scan.js`). No CLI surface; pure functions over a DB handle. Phase 119 imports both.
- **115-02** — `cmdDiff` in `worker/cli/hub.js` (CLI wrapper around the engine), `commands/diff.md` (slash-command markdown), `tests/diff.bats` (E2E), CHANGELOG entry.

Splitting the engine from the command keeps Phase 119's reuse story trivial: `import { diffScanVersions } from '../diff/scan-version-diff.js'; const result = diffScanVersions(shadowDbPath, liveDbPath, shadowScanId, liveScanId);` is one line and zero refactors.

## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| NAV-04 | `/arcanon:diff <scanA> <scanB>` accepting integer IDs, `HEAD`/`HEAD~N`, ISO timestamps, branch names; outputs added/removed/modified for services and connections | §1 (scan_versions schema), §2 (services + connections columns), §3 (resolver inputs), §4 (diff algorithm), §5 (CLI surface), §6 (tests) |

---

## 1. `scan_versions` table schema

**Source of truth:** `worker/db/migrations/005_scan_versions.js:25-37` (table definition) + `worker/db/migrations/015_scan_versions_quality_score.js:23-40` (added `quality_score` column).

**Effective columns at migration head 16:**

| Column | Type | Notes |
|--------|------|-------|
| `id` | `INTEGER PRIMARY KEY AUTOINCREMENT` | Globally unique across all repos in this DB. **Sufficient as the primary diff key — no per-repo reconciliation needed.** See §1.1 below. |
| `repo_id` | `INTEGER NOT NULL REFERENCES repos(id)` | One scan_versions row per repo per scan. A multi-repo scan emits N rows with N different `id`s and the same `started_at` (within milliseconds). |
| `started_at` | `TEXT NOT NULL` | ISO 8601 string from `query-engine.js:491` (`INSERT INTO scan_versions (repo_id, started_at) VALUES (?, ?)`). |
| `completed_at` | `TEXT` (nullable) | NULL while a scan is in flight; populated by `endScan()` via the prepared statement at `query-engine.js:493-495`. |
| `quality_score` | `REAL` (nullable) | Added by migration 015. NULL on scans that predate the migration or where confidence persistence was disabled. |

**`id` is `AUTOINCREMENT`** which guarantees monotonically increasing across the whole table — newer scans always have larger `id` regardless of which repo they cover. This is the foundational fact that makes `HEAD` / `HEAD~N` resolution trivial (`SELECT id FROM scan_versions ORDER BY id DESC LIMIT 1 OFFSET ?`).

**Indexes:** None explicit on this table beyond the implicit `id` PK index. `created_at` does not exist — only `started_at` and `completed_at`. **Diff queries will scan the table linearly when resolving HEAD~N or timestamps**, but the table is tiny in practice (one row per repo per scan; even projects scanning daily for a year have < 1000 rows). No index work is needed for v0.1.4. `[VERIFIED: migrations 005 + 015 read in full; no `CREATE INDEX` on scan_versions in any migration]`

### 1.1 Is `scan_versions.id` a sufficient primary diff key?

**Yes.** Three reasons:

1. **AUTOINCREMENT is monotonically increasing across all repos.** A multi-repo scan produces N rows, but `MAX(id) GROUP BY repo_id` always returns the latest scan per repo, and `MAX(id)` table-wide returns the latest scan period. Operators select `5` and `7` and the engine resolves them uniquely.
2. **HEAD / HEAD~N resolves against the global ordering, not per-repo.** "The most recent scan" means "the most recent `scan_versions.id`" — multi-repo behaviour falls out for free (HEAD~1 might be the same repo as HEAD or a different one; either way it's the previous scan event).
3. **services + connections rows are stamped with `scan_version_id`** (migration 005:34-35 + migration 009:55-66 for schemas/fields). Diff just needs to query `WHERE scan_version_id = ?` on each side — no per-repo joins.

**Edge case (documented for the planner, not blocking):** when scan A and scan B cover *different repo sets* (e.g. operator added a linked repo between scans), some services/connections will appear in only one side. The engine reports these as `added` (in the new side) or `removed` (in the old side). This is the correct semantic — the operator wants to know what changed, and "this whole repo's services appeared" is a real change worth reporting. No special handling needed.

### 1.2 Resolving "the most recent scan ≤ this timestamp"

**Query:** `SELECT id FROM scan_versions WHERE completed_at IS NOT NULL AND completed_at <= ? ORDER BY completed_at DESC LIMIT 1`.

ISO 8601 strings sort lexicographically the same as chronologically (this is the design intent of ISO 8601), so `<=` on the TEXT column works correctly without `datetime()` casting. **Use `completed_at` not `started_at`** because operators reasoning about "the state of the map at 2026-04-20" want the scan that *finished* by then, not one that started earlier and may have been incomplete.

**Filter `completed_at IS NOT NULL`** to exclude in-flight scans (NULL completed_at). An in-flight scan has no diffable state.

---

## 2. `services` + `connections` column lists (the diff target)

### 2.1 `services` columns (effective at migration head 16)

Built up across migrations 001, 002, 005, 009, 011, 014. Effective shape:

| Column | Source | Notes |
|--------|--------|-------|
| `id` | 001 | Surrogate PK; **NOT diff-comparable across scans** — re-scans get new IDs |
| `repo_id` | 001 | Diff key component (same logical service across scans must match by `(repo_id, name)`) |
| `name` | 001 | Diff key component |
| `root_path` | 001 | Diff field |
| `language` | 001 | Diff field |
| `type` | 002 | Diff field; `'service' \| 'library' \| 'infra' \| 'sdk'` |
| `scan_version_id` | 005 | **Filter key** — `WHERE scan_version_id = ?` to scope rows to one side of the diff |
| `owner` | 009 | Diff field (CODEOWNERS handle, nullable) |
| `auth_mechanism` | 009 | Diff field (nullable) |
| `db_backend` | 009 | Diff field (nullable) |
| `boundary_entry` | 011 | Diff field (nullable) |
| `base_path` | 014 | Diff field (nullable) |

**Logical identity for diff:** `(repo_id, name)`. Migration 006 added `UNIQUE(repo_id, name)` (see migration 006:99-100, recreated after dedup), so the engine can group by this pair without worrying about within-scan duplicates.

**Modified detection:** a service is `modified` if the same `(repo_id, name)` exists in both scans but any of `{root_path, language, type, owner, auth_mechanism, db_backend, boundary_entry, base_path}` differs. The engine emits a per-field diff (old → new) for each changed field.

### 2.2 `connections` columns (effective at migration head 16)

Built up across migrations 001, 005, 008, 009, 013. Effective shape:

| Column | Source | Notes |
|--------|--------|-------|
| `id` | 001 | Surrogate PK; not diff-comparable |
| `source_service_id` | 001 | Resolves to a `services.name` for the diff key |
| `target_service_id` | 001 | Resolves to a `services.name` for the diff key (or `target_name` for actor-style cross-boundary) |
| `protocol` | 001 | Diff key component |
| `method` | 001 | Diff key component (HTTP verb; nullable) |
| `path` | 001 | Diff key component (canonical path with `{_}` placeholders post-013) |
| `source_file` | 001 | Diff field |
| `target_file` | 001 | Diff field |
| `scan_version_id` | 005 | Filter key |
| `crossing` | 008 | Diff field; `'external' \| 'internal' \| NULL` |
| `confidence` | 009 | Diff field; `'high' \| 'low' \| NULL` |
| `evidence` | 009 | Diff field (snippet text; long — exclude from default human output, include in --json) |
| `path_template` | 013 | Diff field (the original templated form before canonicalization) |

**Logical identity for diff:** `(source_service_name, target_service_name, protocol, method, path)`. Migration 013:109-112 created `uq_connections_dedup` on these columns (using service IDs, but for diff we resolve through to names so cross-scan re-IDs don't matter).

**Why service NAME and not service ID?** Because `source_service_id` between scans points to *different rows* (re-scan inserted new services with new AUTOINCREMENT IDs). Joining through `services.name` is the only stable cross-scan key. Implementation: query both rows together via `JOIN services` and project the name into the row before set-diff.

**Modified detection:** a connection is `modified` if the same `(source_name, target_name, protocol, method, path)` exists in both scans but any of `{source_file, target_file, crossing, confidence, evidence, path_template}` differs.

---

## 3. Existing scan-version query helpers

**Search performed:** `grep -n "scan_version\|getScan\|listScans" worker/db/query-engine.js`. Findings:

| Helper | File:line | Purpose | Reusable for Phase 115? |
|--------|-----------|---------|------------------------|
| `_stmtBeginScan` | `query-engine.js:490-492` | INSERT into scan_versions | No (write path) |
| `_stmtEndScan` | `query-engine.js:493-495` | UPDATE completed_at | No (write path) |
| `_stmtDeleteStaleConnections` | `query-engine.js:496-503` | Re-scan cleanup | No |
| `_stmtDeleteStaleServices` | `query-engine.js:504-506` | Re-scan cleanup | No |
| `_stmtUpdateQualityScore` | `query-engine.js:628-630` | UPDATE quality_score | No |
| `_stmtSelectQualityScore` | `query-engine.js:631-633` | SELECT quality_score WHERE id = ? | Maybe (single-row lookup helper) |
| `_stmtSelectQualityBreakdown` | `query-engine.js:634-642` | Per-scan confidence counts | No (different shape) |
| `getScanQualityBreakdown(id)` | `query-engine.js:1444-1474` | Returns full quality report for one scan_version_id | **Reusable as a model** — same lookup shape, but Phase 115 needs a different projection |
| `getVersions()` | `query-engine.js:1763-1769` | Returns `map_versions` (the snapshot history table, NOT scan_versions) | **No — different table.** Common confusion source; `map_versions` is the VACUUM-INTO snapshot ledger, `scan_versions` is the per-repo scan tracker |

**Conclusion: there is NO existing helper that lists scan_versions or resolves "scan N" from a selector.** Phase 115 must add new helpers. This is intentional — no prior phase needed cross-scan reasoning.

**Recommendation:** Add three small helpers in a new module `worker/diff/resolve-scan.js`:

```javascript
// All take a Database handle (NOT projectRoot) so Phase 119 can pass a shadow-DB
// handle without going through the pool.
listScanVersions(db) -> Array<{id, repo_id, started_at, completed_at, quality_score}>
resolveScanSelector(db, selector, opts?) -> {scanId: number, resolvedFrom: string}
loadScanContents(db, scanId) -> {services: Array, connections: Array}
```

The "DB handle, not projectRoot" parameter shape is the **single change** that makes Phase 119's shadow-DB swap a one-liner. No global state, no pool lookup baked into the engine.

---

## 4. Recommended diff algorithm

**Decision: in-memory set-diff over JS Maps, NOT SQL `EXCEPT`/`INTERSECT`.**

### 4.1 Why in-memory, not SQL set ops

Three reasons:

1. **Data volume is trivial.** Real Arcanon projects have < 100 services and < 1000 connections per scan. Loading two full scans into JS Maps is < 1 MB and < 50 ms — well below any latency the operator would notice.
2. **SQL EXCEPT requires the SAME column list on both sides** of the operator. Diff needs `(repo_id, name)` for services AND the field projection for "modified" detection — this is two separate queries (one for the key set, one for the field comparison) per side, four queries total, with no payload reuse. In-memory is simpler.
3. **Phase 119 swaps DBs on different sides** of the diff. SQL `EXCEPT` requires `ATTACH DATABASE` to query across two DBs in one statement, which adds permissions/path complexity and breaks the "engine takes two open DB handles" contract. In-memory is DB-handle-agnostic.

### 4.2 Algorithm

```
function diffScanVersions(dbA, dbB, scanIdA, scanIdB):
  // Engine ignores which side is "older" — caller decides; engine reports
  // "added" = in B only, "removed" = in A only, "modified" = in both with field diffs.

  servicesA = loadServices(dbA, scanIdA)  // Map<"repoId|name", row>
  servicesB = loadServices(dbB, scanIdB)
  connsA    = loadConnections(dbA, scanIdA)  // Map<"src|tgt|proto|meth|path", row>
  connsB    = loadConnections(dbB, scanIdB)

  return {
    services: {
      added:    [...keys(B) - keys(A) projected to row payloads],
      removed:  [...keys(A) - keys(B) projected to row payloads],
      modified: [...keys(A) ∩ keys(B) where field-diff is non-empty,
                 each emitting {key, before, after, changed_fields: [field, oldVal, newVal]}],
    },
    connections: { ...same shape... },
    summary: {
      services:    {added: N, removed: N, modified: N},
      connections: {added: N, removed: N, modified: N},
    },
  }
```

The key composition uses `JSON.stringify([repoId, name])` so service names containing any character (including `|`) cannot collide. Cost is < 1µs/row at the scales involved.

### 4.3 Cross-repo loading

Both `loadServices(db, scanId)` and `loadConnections(db, scanId)` JOIN through `services` to project the service NAME into each row (for the cross-scan stable key, per §2.2). For connections this is a self-join:

```sql
SELECT
  src.name        AS source_name,
  tgt.name        AS target_name,
  c.protocol, c.method, c.path,
  c.source_file, c.target_file,
  c.crossing, c.confidence, c.evidence, c.path_template
FROM connections c
JOIN services src ON src.id = c.source_service_id
JOIN services tgt ON tgt.id = c.target_service_id
WHERE c.scan_version_id = ?
```

For services:

```sql
SELECT id, repo_id, name, root_path, language, type,
       owner, auth_mechanism, db_backend, boundary_entry, base_path
FROM services
WHERE scan_version_id = ?
```

`repo_id` stays as the integer (same DB → same repo IDs). Cross-DB diffs in Phase 119 will need to project `repo_name` instead — call out as a Phase 119 follow-up, **not** a Phase 115 concern. Phase 115's contract is "same DB, two scan IDs" and Phase 119 will fold in cross-DB by extending the engine signature when it needs to.

---

## 5. Selector resolver (CLI input forms)

Four input forms, all reduce to `{scanId: number, resolvedFrom: string}`:

### 5.1 Integer ID — `/arcanon:diff 5 7`

Resolver: `if (/^\d+$/.test(selector)) { return {scanId: Number(selector), resolvedFrom: 'id'}; }`

Validate: `SELECT id FROM scan_versions WHERE id = ?` must return a row, else throw `"scan version 5 not found"` → CLI maps to exit 2.

### 5.2 HEAD / HEAD~N — `/arcanon:diff HEAD HEAD~1`

Resolver:
```javascript
const m = selector.match(/^HEAD(?:~(\d+))?$/);
if (m) {
  const offset = m[1] ? Number(m[1]) : 0;
  const row = db.prepare(
    'SELECT id FROM scan_versions WHERE completed_at IS NOT NULL ORDER BY id DESC LIMIT 1 OFFSET ?'
  ).get(offset);
  if (!row) throw new Error(`HEAD~${offset} out of range — only N scans recorded`);
  return {scanId: row.id, resolvedFrom: `HEAD~${offset}`};
}
```

`HEAD` is `HEAD~0` (the latest completed scan). The `completed_at IS NOT NULL` filter excludes in-flight scans — same reasoning as §1.2.

### 5.3 ISO timestamp — `/arcanon:diff 2026-04-20 2026-04-25`

Detection: `if (/^\d{4}-\d{2}-\d{2}/.test(selector))`. Accept date-only (`2026-04-20`, treated as end-of-day for "≤ this date" semantics — operator probably means "the scan that was current at end of that day", so resolve as "most recent scan with `completed_at <= 2026-04-20T23:59:59.999Z`") or full ISO 8601 (`2026-04-20T14:30:00Z`).

Implementation:
```javascript
const isoMatch = selector.match(/^(\d{4}-\d{2}-\d{2})(T.*)?$/);
if (isoMatch) {
  const cutoff = isoMatch[2] ? selector : `${isoMatch[1]}T23:59:59.999Z`;
  const row = db.prepare(
    'SELECT id FROM scan_versions WHERE completed_at IS NOT NULL AND completed_at <= ? ORDER BY completed_at DESC LIMIT 1'
  ).get(cutoff);
  if (!row) throw new Error(`no scan completed on or before ${selector}`);
  return {scanId: row.id, resolvedFrom: `at:${cutoff}`};
}
```

### 5.4 Branch heuristic — `/arcanon:diff main feature-x`

Per the roadmap text (ROADMAP.md:255): "branch heuristics (resolves to the most recent scan whose `repos.last_scanned_sha` matches each branch's HEAD)".

**Critical correction from research:** the column is `repo_state.last_scanned_commit`, not `repos.last_scanned_sha`. The roadmap text is wrong. `[VERIFIED: grep -rn "last_scanned" plugins/arcanon/worker/ shows the column lives in repo_state and is named last_scanned_commit; see migration 001:73-78 + query-engine.js:527-534]`

Resolver — uses `execFileSync` (NOT shell `exec*`) to avoid command injection from a possibly-attacker-supplied branch name:

```javascript
import { execFileSync } from 'node:child_process';

function resolveBranchSelector(db, branch, projectRoot) {
  if (!projectRoot) {
    throw new Error(`branch selector "${branch}" requires a project root`);
  }
  // execFileSync — no shell, no interpolation. Branch name is an argv element.
  // Fail loudly if the branch doesn't exist — operators want to catch typos.
  let sha;
  try {
    sha = execFileSync(
      'git', ['-C', projectRoot, 'rev-parse', branch],
      { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }
    ).trim();
  } catch (e) {
    throw new Error(`git rev-parse failed for branch "${branch}": ${e.message}`);
  }
  // Find the most recent scan_versions row whose repo's last_scanned_commit
  // matches this SHA. JOIN through repo_state.
  const row = db.prepare(`
    SELECT sv.id
    FROM scan_versions sv
    JOIN repo_state rs ON rs.repo_id = sv.repo_id
    WHERE rs.last_scanned_commit = ?
      AND sv.completed_at IS NOT NULL
    ORDER BY sv.id DESC LIMIT 1
  `).get(sha);
  if (!row) throw new Error(`no scan recorded at commit ${sha.slice(0,8)} (branch ${branch})`);
  return {scanId: row.id, resolvedFrom: `branch:${branch}@${sha.slice(0,8)}`};
}
```

**Limitation acknowledged in the plan:** branch resolution only matches *exact* commits. If the operator branches off, the scan must have been run at exactly that commit. A "nearest scan along this branch's history" heuristic would need `git merge-base` walks — out of scope for v0.1.4.

### 5.5 Resolution precedence

Apply in order: (1) integer regex, (2) HEAD pattern, (3) ISO date pattern, (4) fall through to branch resolver. This precedence is needed because `2026` would match neither integer nor HEAD nor branch (no such Git ref typically), so the ISO check comes before the branch fallback to give a clearer error.

---

## 6. Test patterns to follow

Per Plan 114-01 precedent (114-01-SUMMARY.md:108):

- **Bats E2E goes to `tests/diff.bats` at the repo root.** Same convention as `tests/list.bats`, `tests/verify.bats`, etc.
- **Fixtures go to `plugins/arcanon/tests/fixtures/diff/`** (clone the structure from `plugins/arcanon/tests/fixtures/list/` — `seed.sh` + `seed.js`).

**Required test cases** (per orchestrator brief):

1. Integer ID resolution (`/arcanon:diff 5 7`) — happy path; assert services-added / removed counts.
2. HEAD shorthand (`/arcanon:diff HEAD HEAD~1`).
3. HEAD~N out-of-range (`/arcanon:diff HEAD~50` when only 3 scans exist) — exit 2 with "out of range" message.
4. ISO timestamp resolution (`/arcanon:diff 2026-04-20 2026-04-25`).
5. Branch heuristic (`/arcanon:diff main feature-x` with two seeded scans at different commits).
6. No-diff case (`/arcanon:diff 5 5`) — exits 0 with "no changes" output (or zero-counts in --json).
7. Missing scan ID (`/arcanon:diff 99999 1`) — exits 2 with "scan version 99999 not found".
8. Modified-row field diff — seed the same `(repo_id, name)` service in two scans with different `owner` values; assert output names the field with old → new values.
9. Silent-no-op in non-Arcanon dir — same contract as `/arcanon:list` / `/arcanon:doctor` (RESEARCH §6 in 114-RESEARCH).
10. `--json` parity — full structural assertion via `jq -e`.

**Node unit tests** for the engine module live alongside the source: `worker/diff/scan-version-diff.test.js` and `worker/diff/resolve-scan.test.js`. These cover the algorithm in isolation (no shell, no worker spawn) and are fast enough to run on every save. Pattern: same as `worker/db/query-engine-confidence.test.js` (in-memory DB, raw SQL seed, assert function output).

---

## 7. Open questions for the planner

1. **Single plan vs split (engine vs CLI)?** Recommendation: **split** (115-01 engine + 115-02 CLI/tests). Rationale: Phase 119 imports the engine without the CLI, so the engine module must be standalone-testable. A single plan would still produce the engine module, but two plans make the dependency contract explicit and let 115-01 ship + freeze before 115-02 starts the CLI integration. **The planner should confirm the split.**

2. **Branch resolver — git via `execFileSync` vs reading `.git/refs/heads/<branch>` directly?** Recommendation: **`execFileSync`** (not shell `exec`) for simplicity and correctness (handles packed refs, symbolic refs, worktrees). Cost is one git invocation per branch selector — negligible. **The planner should pin which one.**

3. **`evidence` field in modified-output.** Evidence snippets can be 200+ chars. Default human output should suppress them (just say `evidence changed`); `--json` always includes the full before/after. **Pin in plan.**

4. **What does the human output of "no changes" look like?** Recommendation:
   ```
   Diff: scan #5 (2026-04-20) → scan #7 (2026-04-25)
     No changes.
   ```
   Exit 0 in human mode. JSON mode returns the full structure with zero-count summaries. **Pin in plan.**

5. **Scan headers in human output — show resolved selector or original input?** Both. Format: `scan #5 [HEAD~2] (2026-04-20)` so the operator can verify the resolver did what they expected. **Pin in plan.**

6. **Does the engine need to handle the case where scanA == scanB (same scan ID)?** Yes — short-circuit at the top: if `scanIdA === scanIdB`, return all-empty result with a flag `same_scan: true` so the formatter can say "scan #5 vs scan #5 — identical". **Pin in plan.**

7. **Integer ID input collision with future selectors.** Unlikely (no other plain-integer scheme is on the roadmap), but for paranoia the resolver could require an explicit `id:5` prefix. **Recommendation: NO prefix needed** — keep `/arcanon:diff 5 7` ergonomic; this matches `git diff <sha> <sha>` UX. Document in `--help` that bare integers are treated as scan IDs.

8. **CHANGELOG entry — `### Added` with `/arcanon:diff` line.** Same pattern as 114-01 (Added section under `[Unreleased]`). No version pin (Phase 122 cuts v0.1.4).

---

## 8. Cross-phase dependency contract for Phase 119

**Phase 119 (`/arcanon:diff --shadow`) must be implementable as a one-line change to the cmdDiff handler.** Concretely, the engine signature is:

```javascript
diffScanVersions(dbA, dbB, scanIdA, scanIdB) -> {services, connections, summary, same_scan}
```

For the v0.1.4 same-DB case (Phase 115), `dbA === dbB` (literally the same Database instance). For Phase 119's shadow case, `dbA` is the live DB and `dbB` is the shadow DB — opened separately by the CLI handler before calling the engine. **No engine change needed.**

The resolver `resolveScanSelector(db, selector, projectRoot?)` similarly takes a DB handle. Phase 119's shadow scan IDs resolve against the shadow DB, live scan IDs against the live DB — same function, called twice with different `db` arguments.

**This contract is the "one-line change" promise.** Any deviation (e.g. resolver reaching for a global pool, engine assuming `dbA === dbB`) breaks the promise. Plan 115-01 must explicitly forbid such patterns in its tasks.

---

## 9. Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | `scan_versions.id` AUTOINCREMENT is monotonic across all repos in the same DB | §1, §1.1 | Low — SQLite documents AUTOINCREMENT as monotonic; verified via migration 005 schema |
| A2 | ISO 8601 strings sort lexicographically the same as chronologically | §1.2, §5.3 | None — this is the explicit design intent of ISO 8601; held true since 1988 |
| A3 | `repo_state.last_scanned_commit` is populated after every scan | §5.4 | Medium — verified via `query-engine.js:527-530` (`_stmtUpdateRepoState`); but if a scan ran without going through the standard manager.js flow (e.g., manual SQL insert), the column could be stale. Branch resolver tolerates this by erroring out, not silently selecting the wrong scan |
| A4 | `services.UNIQUE(repo_id, name)` exists and prevents within-scan duplicates | §2.1 | None — verified via migration 006:99-100 |
| A5 | Service names don't contain JSON-control chars when stringified | §4.2 | None — `JSON.stringify` quotes/escapes safely; no collision risk regardless of service name content |

**Mitigation:** All five assumptions are codebase-verified or based on long-standing standards. No primary docs needed; nothing depends on external services.

---

## 10. Sources

### Primary (HIGH confidence)
- `plugins/arcanon/worker/db/migrations/001_initial_schema.js:22-78` — repos, services, connections, repo_state shapes
- `plugins/arcanon/worker/db/migrations/002_service_type.js:13-17` — services.type column
- `plugins/arcanon/worker/db/migrations/005_scan_versions.js:25-37` — scan_versions table + scan_version_id columns
- `plugins/arcanon/worker/db/migrations/006_dedup_repos.js:99-100` — services UNIQUE(repo_id, name)
- `plugins/arcanon/worker/db/migrations/008_actors_metadata.js:25-50` — connections.crossing
- `plugins/arcanon/worker/db/migrations/009_confidence_enrichment.js:30-66` — confidence/evidence/owner/auth/db_backend, schemas/fields scan_version_id
- `plugins/arcanon/worker/db/migrations/011_services_boundary_entry.js:23-29` — services.boundary_entry
- `plugins/arcanon/worker/db/migrations/013_connections_path_template.js:60-112` — path_template + UNIQUE dedup index
- `plugins/arcanon/worker/db/migrations/014_services_base_path.js:30-39` — services.base_path
- `plugins/arcanon/worker/db/migrations/015_scan_versions_quality_score.js:30-40` — scan_versions.quality_score
- `plugins/arcanon/worker/db/query-engine.js:485-535` — beginScan/endScan + repo_state statements
- `plugins/arcanon/worker/db/query-engine.js:1444-1474` — getScanQualityBreakdown (model for new helpers)
- `plugins/arcanon/worker/db/query-engine.js:1763-1769` — getVersions (returns map_versions, NOT scan_versions; clarifies the namespace confusion)
- `plugins/arcanon/worker/db/pool.js:34` — `export function projectHashDir` (already exported by Plan 114-01)
- `plugins/arcanon/worker/cli/hub.js:78-100` — `fetchWithTimeout` helper added in Plan 114-03 (reusable for Phase 115 if any HTTP path is added; this phase does NOT need it because the diff is a direct DB read)
- `plugins/arcanon/worker/cli/hub.js:571-774` — `cmdList` (template for `cmdDiff` shape)
- `plugins/arcanon/worker/cli/hub.js:1221-1231` — HANDLERS map (insertion site for `diff: cmdDiff`)
- `plugins/arcanon/lib/worker-client.sh _arcanon_is_project_dir()` — added by Plan 114-01 (114-01-SUMMARY.md:30); usable by `commands/diff.md`
- `tests/verify.bats:1-90` — bats test scaffolding pattern (helpers + setup)
- `.planning/phases/114-read-only-navigability-commands-list-view-doctor/114-01-PLAN.md` — plan structure model
- `.planning/phases/114-read-only-navigability-commands-list-view-doctor/114-01-SUMMARY.md` — verified outcomes from 114-01 (helpers/exports Phase 115 reuses)

### Secondary (MEDIUM confidence)
- `plugins/arcanon/worker/scan/manager.js:389-412` — last_scanned_commit population path (confirms the column is normally populated post-scan)
- `.planning/REQUIREMENTS.md:45-52` — NAV-04 spec (input forms and output shape)
- `.planning/ROADMAP.md:251-256` — Phase 115 detail (acknowledged: roadmap says `repos.last_scanned_sha` but actual column is `repo_state.last_scanned_commit` — see §5.4)

---

## 11. Metadata

**Confidence breakdown:**
- scan_versions schema: HIGH — migrations read in full; column list complete
- services + connections columns: HIGH — all 7 contributing migrations read
- query-engine helpers: HIGH — exhaustive grep; explicit "no existing helper" finding
- Diff algorithm: HIGH — set-diff is well-understood; data volumes ruled out perf concerns
- Selector resolver: HIGH on the SQL/regex shape; MEDIUM on the branch-heuristic UX (operator might want fuzzier matching, but that's deferrable)
- Cross-phase contract for Phase 119: HIGH — the "DB handle, not projectRoot" parameter shape is the single concrete promise

**Research date:** 2026-04-26
**Valid until:** 2026-05-10 (14 days — schema is stable; only risk is Phase 117 landing migration 017_scan_overrides between now and Phase 119, which adds a column on `scan_versions` (`applied_in_scan_version_id` references it) but does NOT change the columns Phase 115 reads)
