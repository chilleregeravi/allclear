# Phase 119 — Shadow Scan + Atomic Promote — Research

**Phase:** 119
**Wave:** 4
**REQs:** SHADOW-01, SHADOW-02, SHADOW-03, SHADOW-04
**Depends on:** Phase 117 (`scan_overrides`) for override application inside the shadow scan
**Parallel-planned (assumptions surfaced):** Phase 115 (`/diff` engine), Phase 117 (`applyPendingOverrides`)
**Date:** 2026-04-25

## 1. Pre-flight Decision — Pool Key Strategy

### Context
`worker/db/pool.js:50-76` defines `getQueryEngine(projectRoot)`:

```javascript
export function getQueryEngine(projectRoot) {
  if (!projectRoot) return null;
  if (pool.has(projectRoot)) return pool.get(projectRoot);   // (A)
  const dir = projectHashDir(projectRoot);
  const dbPath = path.join(dir, "impact-map.db");            // (B) hardcoded "impact-map.db"
  if (!fs.existsSync(dbPath)) return null;
  try {
    const db = openDb(projectRoot);                          // (C) openDb singleton
    const qe = new QueryEngine(db, null);
    pool.set(projectRoot, qe);
    return qe;
  } catch (err) { ... }
}
```

Two compounding problems for shadow:

- **(A)** Cache key is the bare `projectRoot` string. Live and shadow would collide.
- **(C)** `openDb()` (worker/db/database.js:92-112) is a **process-singleton** keyed by module-level `let _db = null`. The first call wins; the second call returns the already-open handle regardless of `projectRoot`. This means even if we side-step the pool, a shadow `openDb(...)` after live `openDb(...)` would silently return the LIVE handle. This is a known limitation, but the symptom is actively dangerous for shadow.

### Options Considered

**Option A — Extend cache key (`projectRoot + ":shadow"`)**

- Pro: minimal API churn — `getQueryEngine(projectRoot, mode)` with `mode = "live" | "shadow"` (default `"live"` for back-compat).
- Pro: shadow QueryEngine survives across multiple shadow operations within one process (e.g., scan → diff → promote in the same session).
- Con: must also fix `openDb()` because the pool's success path delegates to it. Either (1) extend `openDb(root, dbName)` or (2) bypass `openDb()` in the shadow branch and open `Database(shadowDbPath)` + run pragmas + `runMigrations(db)` inline (matches the bypass pattern already used by `getQueryEngineByHash` at pool.js:213-225).
- Con: cached QueryEngine holding a fd to `impact-map-shadow.db` could survive past `/arcanon:promote-shadow` and continue serving stale reads of the renamed-out file. **MUST** add a `evictShadowQueryEngine(projectRoot)` helper called from `cmdPromoteShadow` AFTER the rename succeeds.

**Option B — Bypass pool entirely (always-fresh shadow QE)**

- Pro: zero risk of cache contamination — every shadow operation opens a new handle and closes it when done.
- Pro: no eviction logic needed; rename invalidates the now-orphaned handle naturally (the OS keeps the inode open until close — but since each shadow op closes its own QE, no reads happen against the renamed path).
- Pro: no API change to `getQueryEngine` signature — purely additive `getShadowQueryEngine(projectRoot)`.
- Con: each shadow op pays the migration-check cost on every open (~1-5ms; negligible vs scan duration).
- Con: callers must remember to call `qe._db.close()` after use. We already do this in `getQueryEngineByHash` callers, but it's a minor footgun for future code.

### Decision: **Option B — `getShadowQueryEngine(projectRoot)` always opens fresh**

Rationale:
1. Shadow operations are inherently short-lived (`shadow-scan` writes once and closes; `diff --shadow` reads once and closes; `promote-shadow` only does file I/O, never opens the shadow DB). Caching offers near-zero benefit.
2. The eviction logic Option A requires (drop cached entry on promote) is a permanent landmine — easy to forget when adding new commands that touch the shadow DB.
3. The existing `getQueryEngineByHash` (pool.js:199-232) already demonstrates the always-fresh pattern with inline pragmas + `runMigrations`. We clone that shape.
4. The `openDb` singleton problem is sidestepped — we never call `openDb` for shadow, so no risk of returning the live handle.

**Pool-key strategy summary:** `getShadowQueryEngine(projectRoot)` is a NEW exported function in `worker/db/pool.js` that NEVER caches. The existing `getQueryEngine(projectRoot)` is unchanged and continues to serve `live` only. Live and shadow can never collide because they don't share a code path.

### Implementation sketch (Plan 119-01 will land this)

```javascript
// worker/db/pool.js — add after getQueryEngineByHash
/**
 * Open a fresh QueryEngine pointed at the project's SHADOW database.
 * NEVER pools — every call opens a new handle. Caller MUST close via qe._db.close()
 * when done. Used by /arcanon:shadow-scan, /arcanon:diff --shadow, and tests.
 *
 * @param {string} projectRoot
 * @param {{ create?: boolean }} [opts] - if create=true, mkdir+open even when shadow DB absent (used by shadow-scan).
 * @returns {QueryEngine|null} null if shadow DB doesn't exist and create=false.
 */
export function getShadowQueryEngine(projectRoot, opts = {}) {
  if (!projectRoot) return null;
  const dir = projectHashDir(projectRoot);
  const shadowPath = path.join(dir, "impact-map-shadow.db");
  if (!fs.existsSync(shadowPath) && !opts.create) return null;
  fs.mkdirSync(dir, { recursive: true });
  const db = new Database(shadowPath);
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");
  db.pragma("synchronous = NORMAL");
  db.pragma("cache_size = -64000");
  db.pragma("busy_timeout = 5000");
  runMigrations(db);
  return new QueryEngine(db, null);
}
```

## 2. Scan Path Injection — How Shadow-Scan Reroutes Output

### Trace from `/arcanon:map` to `getQueryEngine`

Current flow (live scan):
1. `commands/map.md` → bash → `worker/cli/hub.js` (or POST `/scan` to worker HTTP).
2. Worker dispatches to `worker/scan/manager.js` `scanRepos(repoPaths, options, queryEngine)`.
3. **`queryEngine` is passed in by the caller** — `scanRepos` does NOT call `getQueryEngine` itself. Critical observation: the seam where the DB target is selected is **upstream of `scanRepos`**, in the worker HTTP `POST /scan` handler (or wherever the CLI route resolves the QE).

### Where the upstream selection happens

Looking at the current code path, the QE is resolved in the worker's HTTP route handler before invoking `scanRepos`. (See `worker/server/http.js` `POST /scan` — resolves project root, calls `getQueryEngine(projectRoot)`, passes the result into `scanRepos`.)

### Shadow injection seam

**The seam is the `queryEngine` argument to `scanRepos`.** No fork of the scan pipeline is needed. `scanRepos` is QE-agnostic — it calls `queryEngine.upsertRepo`, `.beginScan`, `.persistFindings`, `.endScan`, etc. Any QueryEngine pointing at any SQLite file works.

Concretely, the shadow-scan code path is:

```javascript
// New worker HTTP route OR new cmdShadowScan in hub.js (decision below)
const shadowQE = getShadowQueryEngine(projectRoot, { create: true });
try {
  const results = await scanRepos(repoPaths, options, shadowQE);
  // ... return results
} finally {
  shadowQE._db.close();   // always-fresh pattern requires explicit close
}
```

**No changes** required inside `scanRepos`, `manager.js`, `database.js`, or any extractor. The injection is purely at the call site.

### Where to add the new entry point

Two architectural options:

- **(a)** New worker HTTP route `POST /scan-shadow?project=<root>` mirroring the existing `POST /scan?project=<root>`.
- **(b)** New `cmdShadowScan` in `worker/cli/hub.js` that calls a shared internal `runScan({queryEngine, repoPaths, ...})` helper alongside `cmdMap`.

**Decision: Option (a) — new HTTP route.** Rationale:
- The existing scan path goes through HTTP (the worker is the orchestrator; the CLI is a thin client). The shadow path should match.
- Worker has the agentRunner, scan lock, and logger already wired. Reproducing those in a CLI-only path duplicates the wiring.
- `commands/shadow-scan.md` sits alongside `map.md` and posts to the same port via the same `worker_call` helper.
- Plan 119-01 owns this HTTP route + the pool change.

### Override application inside shadow scan (depends on Phase 117)

Phase 117 ships `applyPendingOverrides(scanVersionId, queryEngine)` invoked between `persistFindings` and `endScan` (per the v0.1.4 ROADMAP pre-flight note for Phase 117). Because the shadow scan reuses `scanRepos` end-to-end and the only change is the `queryEngine` argument, **overrides are applied to the shadow DB automatically with zero shadow-specific code**. The override-apply hook reads from `scan_overrides` (which is rooted in the queryEngine's DB handle), so a shadow QE reads/writes overrides in the SHADOW `scan_overrides` table.

**Subtle implication for testing:** Phase 117's `scan_overrides` table is created by migration 017. The shadow DB needs migration 017 too — handled automatically because `getShadowQueryEngine` calls `runMigrations(db)`.

**Subtle implication for promote:** When shadow is promoted, the shadow `scan_overrides` rows (which were marked `applied_in_scan_version_id` against the SHADOW scan_version_ids) become the live `scan_overrides`. Live `scan_overrides` rows from before the promote are LOST (they don't exist in the shadow DB unless the shadow scan was started from a copy of live). **This is acceptable** for v0.1.4 because shadow scans are meant for "validate before commit" workflows, not long-running parallel state — and the v0.1.4 ROADMAP doesn't promise pre-promote overrides survive. Document this limitation in `commands/promote-shadow.md` and the SUMMARY.

## 3. Atomic Promote — File System & POSIX Guarantees

### Filesystem layout (verified)

`projectHashDir(projectRoot)` (pool.js:34-41) returns:
```
${ARCANON_DATA_DIR:-$HOME/.arcanon}/projects/<sha256(projectRoot)[:12]>/
```

Both `impact-map.db` (live) and `impact-map-shadow.db` (shadow) live under THIS exact directory. Same parent → same filesystem → `fs.rename` is atomic per POSIX.

**Hard constraint (documented in plans):** Shadow DB MUST sit in the same filesystem as live. Since both are siblings under `projectHashDir(...)`, this is structurally guaranteed unless the user has a bind mount inside `~/.arcanon/projects/<hash>/` (extreme edge case — out of scope).

### `fs.rename` atomicity

POSIX `rename(2)`: "The rename() function shall be equivalent for regular files to that defined by the ISO C standard. Its inclusion here expands that definition to include actions on directories and specifies behavior when the new parameter names a file that already exists." Crucially: when `oldpath` and `newpath` are on the same filesystem, the rename is atomic — either it succeeds and `newpath` refers to the file `oldpath` formerly named, or it fails and both paths remain unchanged. There is no observable intermediate state.

Node's `fs.renameSync` calls `rename(2)` directly. Behavior matches.

### WAL sidecar files — IMPORTANT

SQLite in WAL mode produces **three files** per database:
- `impact-map.db` (the main file)
- `impact-map.db-wal` (write-ahead log; transient)
- `impact-map.db-shm` (shared-memory index; transient)

Naive `fs.rename(shadow.db, live.db)` would replace ONLY the main file, leaving stale `impact-map.db-wal` and `impact-map.db-shm` from the OLD live DB. On next open, SQLite would attempt to recover a log that no longer matches the main file → corruption.

**Mitigation (Plan 119-02 owns this):** before promote, the shadow QE must be cleanly closed via `db.pragma('wal_checkpoint(TRUNCATE)')` followed by `db.close()`. This collapses the WAL into the main file and removes the sidecar files. The promote sequence is then:

1. **Backup live:** `fs.renameSync(livePath, livePath + ".pre-promote-" + ts)` — atomic. (Renames the main file. Leftover `-wal`/`-shm` are unmapped from the renamed file but stay on disk under their original names referencing the renamed inode — they will be ignored by SQLite once the new main file is in place since they refer to a different inode. To be safe, **also rename `*-wal` and `*-shm`** with the same suffix; if they don't exist, the unlink is a no-op.)
2. **Promote shadow:** `fs.renameSync(shadowPath, livePath)` — atomic.
3. **Report backup path:** stdout one-liner.

Node-side pseudocode:
```javascript
const ts = new Date().toISOString().replace(/[:.]/g, '-');
const backupPath = `${livePath}.pre-promote-${ts}`;

// Step 1: backup live (main file + sidecars if present)
fs.renameSync(livePath, backupPath);
for (const sfx of ['-wal', '-shm']) {
  if (fs.existsSync(livePath + sfx)) fs.renameSync(livePath + sfx, backupPath + sfx);
}

// Step 2: promote shadow (main file + sidecars if present)
fs.renameSync(shadowPath, livePath);
for (const sfx of ['-wal', '-shm']) {
  if (fs.existsSync(shadowPath + sfx)) fs.renameSync(shadowPath + sfx, livePath + sfx);
}

// Step 3: report
console.log(`Promoted shadow → live. Backup at: ${backupPath}`);
```

**Critical pre-step:** before invoking the rename sequence, `cmdPromoteShadow` MUST evict any cached LIVE QueryEngine from the pool (`pool.delete(projectRoot)` and call `.close()` on the cached handle), otherwise the worker process will be holding an fd to a renamed-out inode and may write to it. Add `evictLiveQueryEngine(projectRoot)` helper in pool.js (Plan 119-02 owns this).

For shadow-side QE: shadow QE is always-fresh (per §1 decision); it will have been closed by the prior shadow-scan invocation. No eviction needed.

### Why we DON'T auto-delete backups

Per phase brief: operators clean up backups manually. Reasons:
- Recoverability — a botched promote can be reversed by `mv backup.db live.db`.
- Disk usage on multi-project workspaces is bounded (one backup per promote per project; hundreds of MB at most).
- Auto-deletion is a separate UX decision (e.g., "keep last 3 backups") that v0.1.4 explicitly does not own.

`commands/promote-shadow.md` will instruct: "Backup at `<path>`. Delete manually when no longer needed."

## 4. Diff Engine Reuse — `/arcanon:diff --shadow` (Cross-Phase 115 Coupling)

### What we need from Phase 115

Phase 115 ships `/arcanon:diff <scanA> <scanB>` — compares two scan_versions in the LIVE DB. The diff engine signature is the load-bearing interface for `/arcanon:diff --shadow`.

**Phase 115 status:** parallel-planned; phase directory exists but no PLAN.md files written yet at the time this research was authored.

### Plausible Phase 115 diff engine signatures

Three plausible shapes (Phase 115 will pick one — we surface assumptions and depend on a recognizable pattern):

**Shape A (recommended in our assumption block) — pure function over two QE's + scan IDs:**
```javascript
export function diffScanVersions(qeA, scanIdA, qeB, scanIdB) -> {
  services: { added: [...], removed: [...], modified: [...] },
  connections: { added: [...], removed: [...], modified: [...] },
}
```
This is the shape that maximally accommodates `--shadow` — pass `qeA = liveQE, qeB = shadowQE, scanIdA = liveLatest, scanIdB = shadowLatest`.

**Shape B — single-QE (assumes both versions live in the same DB):**
```javascript
export function diffScanVersions(qe, scanIdA, scanIdB) -> { ... }
```
Does NOT accommodate `--shadow` without modification. If Phase 115 lands shape B, the courtesy edit (Plan 119-02) would extend it to accept an optional second QE.

**Shape C — orchestrator that resolves scan IDs from input strings:**
```javascript
export async function runDiff(qe, inputA, inputB) -> { ... }   // resolves HEAD/HEAD~N/iso/branch internally
```
Same single-QE limitation as B.

### Our assumption (declared in plans, read in 119-02)

**Plan 119-02 assumes Phase 115 lands Shape A** (or extends to it as part of integration). If Phase 115 lands Shape B/C, Plan 119-02 has a small contingency: import the lower-level resolver (which we expect to live in Phase 115's `worker/diff/diff-engine.js` or similar) and call it with the two QE's. Worst case: 119-02 adds a 5-line wrapper to bridge the signature.

### Courtesy edit to Phase 115's `/diff` command

Plan 119-02 owns the courtesy edit to `commands/diff.md`:
- Add `--shadow` flag — when present, diff is between live LATEST and shadow LATEST.
- Routes through Phase 115's `cmdDiff` with two arguments swapped to point at live vs shadow QE.
- Optionally accept `--shadow <scanIdInShadow>` to compare a specific shadow scan vs live HEAD.

This is a **courtesy edit to a parallel-planned phase**. We surface this loudly in the `<assumptions_about_phase_115>` block so the Phase 115 planner can either (a) merge our `--shadow` flag into their plan, or (b) leave us to add it after they land.

## 5. Findings Summary (single page)

| Concern | Decision | Owner Plan |
|---|---|---|
| Pool key for shadow | `getShadowQueryEngine(projectRoot)` — always-fresh, NEVER cached | 119-01 |
| Live `getQueryEngine` | Unchanged (back-compat) | 119-01 |
| `openDb` singleton problem | Sidestepped — shadow path bypasses `openDb` entirely (inline pragmas + `runMigrations`, mirrors `getQueryEngineByHash`) | 119-01 |
| Scan path injection seam | `scanRepos(repoPaths, options, queryEngine)` already accepts the QE — pass shadow QE from new `POST /scan-shadow` HTTP route | 119-01 |
| Phase 117 override apply | Reuses `applyPendingOverrides` automatically — overrides written/read against the shadow DB's `scan_overrides` table | 119-01 (no shadow-specific code) |
| Atomic promote — same FS | Both DBs sit under `projectHashDir(...)` → same FS by construction | 119-02 |
| WAL sidecar handling | Rename `*.db`, `*.db-wal`, `*.db-shm` together; close shadow QE with `wal_checkpoint(TRUNCATE)` before promote | 119-02 |
| Live QE eviction on promote | New `evictLiveQueryEngine(projectRoot)` in pool.js, called from `cmdPromoteShadow` BEFORE the rename | 119-02 |
| Diff engine reuse | Assumes Phase 115's `diffScanVersions(qeA, scanIdA, qeB, scanIdB)` shape; courtesy edit to `commands/diff.md` adds `--shadow` flag | 119-02 |
| Backup cleanup | Manual — never auto-delete; document in `promote-shadow.md` | 119-02 |
| Test fixtures | Live in `plugins/arcanon/tests/fixtures/shadow/`; bats tests live in repo-root `tests/` | 119-01, 119-02 |

## 6. Open Questions / Items Tracked as Assumptions

1. **Phase 115 diff engine signature** — surfaced in `<assumptions_about_phase_115>` in 119-02.
2. **Phase 117 `applyPendingOverrides` exact name + arity** — surfaced in `<assumptions_about_phase_117>` in 119-01.
3. **Should `/arcanon:shadow-scan` accept all the same flags as `/arcanon:map`** (`--full`, repo path filters)? Decision: yes — symmetry with `/arcanon:map` is operator-friendly. Forwards flags through to `scanRepos(options, ...)` unchanged.
4. **Does `cmdShadowScan` warn when a shadow DB already exists?** Decision: yes — print "Existing shadow DB will be overwritten. Use /arcanon:promote-shadow first if you want to keep it." then proceed. (Non-interactive — doesn't prompt; just informs.)
5. **What does `/arcanon:diff --shadow` show when no shadow DB exists?** Decision: print "No shadow DB. Run /arcanon:shadow-scan first." and exit 2.

## 7. Constraints (carried into plans verbatim)

- All bats test files live at the **repo-root `tests/`** (NOT under `plugins/arcanon/tests/`).
- Fixtures live under `plugins/arcanon/tests/fixtures/shadow/`.
- Shadow DB MUST sit in the same filesystem as live so `fs.rename` is atomic. Structurally enforced by sibling-under-`projectHashDir(...)` placement.
- Backup name format: `impact-map.db.pre-promote-<ISO-timestamp-with-dashes>` — never auto-delete.
- Shadow QueryEngine NEVER enters the pool cache.
- Live QueryEngine MUST be evicted from the pool BEFORE the promote rename.

---
*Research complete: 2026-04-25*
