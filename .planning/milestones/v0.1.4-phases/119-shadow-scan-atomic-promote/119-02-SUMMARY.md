---
phase: 119-shadow-scan-atomic-promote
plan: 02
subsystem: worker/db (eviction helper + singleton reset) + worker/cli/hub (cmdPromoteShadow + cmdDiff --shadow branch) + commands (slash wrapper + courtesy edit)
tags: [promote-shadow, evictLiveQueryEngine, cmdDiff-shadow, atomic-rename, WAL-sidecars, scan-lock-guard, SHADOW-02, SHADOW-03, SHADOW-04, read-promote-half-of-shadow-workflow]
requirements_satisfied: [SHADOW-02, SHADOW-03, SHADOW-04]
dependency_graph:
  requires:
    - Plan 119-01 (getShadowQueryEngine in pool.js — symmetric helper this plan extends with evictLiveQueryEngine; commands/shadow-scan.md surface this plan parallels with promote-shadow.md)
    - Plan 115-01 (diffScanVersions(dbA, dbB, scanIdA, scanIdB) engine — pool-agnostic, read-only by contract; signature matched the assumed Shape A from RESEARCH §4 verbatim, no fallback needed)
    - Plan 115-02 (cmdDiff handler shape with positional/HEAD/ISO/branch resolver — extended with a --shadow branch at the top)
    - Phase 117-02 apply-hook (transitive — overrides applied to shadow DB during shadow-scan are carried over by promote rename; promote itself is unaware of scan_overrides)
    - manager.js scanLockHash + acquireScanLock pattern (the lock-file format read by cmdPromoteShadow's active-scan-lock guard)
  provides:
    - evictLiveQueryEngine(projectRoot) — closes cached live QE handle, drops pool entry, AND clears database.js _db singleton (Rule 1 deviation — see below)
    - _resetDbSingleton() in database.js — internal helper exported solely for evictLiveQueryEngine to clear the module-level _db slot
    - cmdPromoteShadow handler in HANDLERS map under hyphenated key "promote-shadow"
    - _findActiveScanLockForProject(projectRoot) — internal helper that scans dataDir/scan-*.lock for any live PID-alive lock referencing repos under cwd
    - cmdDiffShadow handler dispatched from cmdDiff when flags.shadow is true
    - commands/promote-shadow.md slash-command wrapper
    - commands/diff.md courtesy edit (--shadow flag added to argument-hint, examples, and dedicated "## --shadow flag" help section)
  affects:
    - Operator workflow: full shadow loop now closed (shadow-scan -> diff --shadow -> promote-shadow -> rollback via mv)
    - Worker pool semantics: the database.js module-level _db cache is now resettable from outside the module (via the new _resetDbSingleton export); previously openDb was effectively a process-singleton with no escape hatch
    - Phase 115's cmdDiff: now branches on flags.shadow at the top — first non-positional dispatch path in cmdDiff
tech_stack:
  added: []
  patterns:
    - "Atomic POSIX rename for DB swap (RESEARCH §3 / fs.renameSync) — both files sit as siblings under projectHashDir(...), guaranteeing same filesystem"
    - "WAL sidecar handling: -wal and -shm renamed alongside the main DB on BOTH backup and promote steps (RESEARCH §3 — prevents stale-log corruption on next SQLite open)"
    - "Pool eviction + singleton reset BEFORE any rename (T-119-02-01) — clears both the pool.js Map AND the database.js _db slot so the next getQueryEngine opens a fresh handle pointed at the post-promote file"
    - "Active-scan-lock guard via scan-*.lock filesystem scan + PID liveness check (T-119-02-04) — promote refuses during a live /arcanon:map or /arcanon:rescan; mirrors manager.js's acquireScanLock format"
    - "Best-effort rollback on mid-flight rename failure: if backup succeeded but shadow→live failed, restore live from backup before exit 1"
    - "Engine reuse via direct import (NOT pool roundtrip): cmdDiffShadow opens both DBs as fresh better-sqlite3 readonly handles and passes them straight to diffScanVersions — preserving the live byte-identity invariant established by 119-01 Test 8"
    - "--shadow flag dispatched at the TOP of cmdDiff (before positional-arg parsing) — keeps Phase 115's path entirely intact for back-compat"
key_files:
  created:
    - plugins/arcanon/commands/promote-shadow.md
    - tests/promote-shadow.bats
    - tests/diff-shadow.bats
    - .planning/phases/119-shadow-scan-atomic-promote/119-02-SUMMARY.md
  modified:
    - plugins/arcanon/worker/db/pool.js
    - plugins/arcanon/worker/db/database.js
    - plugins/arcanon/worker/cli/hub.js
    - plugins/arcanon/commands/diff.md
    - plugins/arcanon/CHANGELOG.md
    - tests/commands-surface.bats
decisions:
  - "WAL sidecars renamed alongside main DB on both backup and promote steps (RESEARCH §3). Without this, SQLite opens the renamed-out main file with stale -wal/-shm and may corrupt the DB on next read."
  - "evictLiveQueryEngine MUST be called BEFORE any rename in cmdPromoteShadow (T-119-02-01). Code structure enforces ordering — eviction is Step 4 in the cmdPromoteShadow sequence, immediately before the try block that does the renames."
  - "evictLiveQueryEngine ALSO clears the database.js module-level _db singleton (Rule 1 deviation). Without this, the next getQueryEngine call short-circuits on the cached _db pointing at a closed handle and crashes at first statement prepare. New internal _resetDbSingleton() export in database.js is the minimum-surface fix."
  - "Active-scan-lock guard via filesystem scan of dataDir/scan-*.lock with PID liveness check (T-119-02-04). Mirrors the lock-file shape that manager.js's acquireScanLock writes (pid + repoPaths + startedAt). Promote refuses with exit 2 if any active lock references repos under cwd."
  - "Backup naming: impact-map.db.pre-promote-<ISO-timestamp-with-dashes>. Colons and dots in the timestamp replaced with dashes via /[:.]/g — matches RESEARCH §3 sample. NEVER auto-deleted (operator cleanup — documented in commands/promote-shadow.md and in the human stdout message)."
  - "First-promote case: when no live DB exists yet (greenfield project), shadow is renamed in place, no backup created, exit 0 with 'No live DB to back up; shadow promoted to live.' message. Test 7 enforces."
  - "Best-effort rollback on rename failure: if the backup rename succeeded but the shadow→live rename failed, restore live from backup (best-effort — wrapped in try/catch). Exit 1 either way; the rollback is a recovery improvement, not a guarantee."
  - "Engine reuse via dynamic import + Shape A (RESEARCH §4): Phase 115 shipped diffScanVersions(dbA, dbB, scanIdA, scanIdB) — exactly the assumed signature. cmdDiffShadow imports it via await import('../diff/scan-version-diff.js') and passes the live and shadow DB handles directly. No fallback inline-diff implementation needed."
  - "Both DBs in cmdDiffShadow opened with {readonly: true, fileMustExist: true}. Phase 115's engine is read-only by contract (scan-version-diff.js:18-25); readonly opens guarantee no pragma writes back into the live file (preserves the byte-identity invariant established by 119-01 Test 8)."
  - "Latest-scan resolution: SELECT MAX(id) FROM scan_versions WHERE completed_at IS NOT NULL — excludes in-progress scans, mirrors Phase 115's HEAD resolver."
  - "Scan-lock key sharing between live and shadow (open question from 119-01 SUMMARY) is LEFT AS-IS by this plan. Promote's active-scan-lock guard takes the conservative reading: any active scan blocks promote, regardless of whether it's live or shadow. Reconsider in v0.1.5 if user feedback says shadow blocks promote too aggressively."
metrics:
  duration_minutes: ~22
  tasks_completed: 2
  files_created: 4
  files_modified: 6
  tests_added: 20  # 12 promote-shadow.bats + 6 diff-shadow.bats + 2 commands-surface.bats SHADOW-03 regressions
  tests_passing: 60  # 12 promote-shadow + 6 diff-shadow + 22 commands-surface + 20 diff
  completed_date: 2026-04-25
---

# Phase 119 Plan 02: Atomic Promote + Live-vs-Shadow Diff Summary

**One-liner:** Closes the read+promote half of the validate-before-commit workflow shipped in 119-01: a new `evictLiveQueryEngine` pool helper (which also clears the database.js _db singleton — see Rule 1 deviation), `cmdPromoteShadow` handler that performs the three atomic steps (backup live → rename shadow over live → print backup path) with WAL sidecars and active-scan-lock guard, and a `cmdDiff --shadow` branch that reuses Phase 115's pool-agnostic `diffScanVersions(dbA, dbB, scanIdA, scanIdB)` engine. Operators can now run `/arcanon:shadow-scan` → `/arcanon:diff --shadow` → `/arcanon:promote-shadow` (and roll back with one `mv`).

## Truths Validated

| # | Truth | Evidence |
|---|-------|----------|
| 1 | `/arcanon:promote-shadow` performs three atomic steps in order: backup live → rename shadow over live → report backup path on stdout | Test 3 — sha256(live AFTER) == sha256(shadow BEFORE); sha256(backup) == sha256(live BEFORE); shadow file is GONE post-promote. Test 5 — backup path is printed to stdout. |
| 2 | Backup file name is `impact-map.db.pre-promote-<ISO-timestamp>` and is NEVER auto-deleted | Test 5 — regex `^impact-map\.db\.pre-promote-[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}-[0-9]{2}-[0-9]{2}-[0-9]+Z$` matches. Test 3 — backup file persists after promote (no cleanup logic anywhere in cmdPromoteShadow). |
| 3 | Both DBs sit under `projectHashDir(...)` → same filesystem → `fs.rename` is atomic per POSIX rename(2) | Structural — both paths derived from the same `projectHashDir(cwd)`. Test 3 confirms the rename succeeds across multiple runs without observable intermediate state. |
| 4 | WAL sidecars (-wal, -shm) for both shadow and live are renamed alongside the main file so SQLite never sees a stale log | Test 4 — seeded distinct payloads in all four sidecars; post-promote, live sidecars carry SHADOW-* payload, backup sidecars carry LIVE-* payload, shadow sidecars are GONE. |
| 5 | Cached LIVE QueryEngine is evicted from the pool BEFORE the rename — no fd held against a renamed-out inode | Test 1 — qe1._db.open transitions true → false after evictLiveQueryEngine; getQueryEngine returns a NEW instance. Test 11 — post-promote getQueryEngine returns a fresh handle that sees the shadow-marker row that ONLY exists in the promoted (formerly shadow) content. |
| 6 | `/arcanon:diff --shadow` reuses Phase 115's diff engine, passing live QE and shadow QE as the two scan sources | Test 12 — full added/removed/modified report including shadow-only-svc (added), auth-svc (removed), api-svc language change (modified). Engine is `diffScanVersions` from worker/diff/scan-version-diff.js — confirmed by direct import in cmdDiffShadow source + module's load-bearing pool-agnostic contract. |
| 7 | `/arcanon:diff --shadow` exits 2 with a friendly error when no shadow DB exists | Test 13 — exit 2, stderr contains "no shadow DB". |
| 8 | `/arcanon:promote-shadow` exits 2 when no shadow DB exists; exits 0 with no-op message when shadow DB exists but no live DB exists yet (first-promote case) | Test 6 — no shadow → exit 2 + "no shadow DB to promote". Test 7 — first-promote → exit 0, shadow becomes live with no backup, message includes "no live DB to back up". |

## Artifacts Created

### `plugins/arcanon/worker/db/pool.js` — `evictLiveQueryEngine(projectRoot)`
NEW exported function. Closes the cached live QueryEngine's DB handle (best-effort — wrapped in try/catch since the handle may already be closed), drops the pool entry, and additionally calls `_resetDbSingleton()` to clear the database.js module-level `_db` cache (Rule 1 deviation — see below). Idempotent: returns false if no entry was cached. JSDoc explains the singleton-reset rationale and links to the deviation.

### `plugins/arcanon/worker/db/database.js` — `_resetDbSingleton()`
NEW exported helper. Closes the module-level `_db` singleton (best-effort) and clears the slot. Underscore-prefix marks it as internal — it exists solely so `evictLiveQueryEngine` can break the openDb cache without modifying database.js's first-call-wins contract for normal callers. Idempotent: returns false if `_db` was already null.

### `plugins/arcanon/worker/cli/hub.js` — `cmdPromoteShadow` + `_findActiveScanLockForProject`
- `_findActiveScanLockForProject(projectRoot)`: scans `dataDir/scan-*.lock`, parses each as JSON, checks PID liveness via `process.kill(pid, 0)`, returns the lock path if any active lock's `repoPaths` contains a path equal to `projectRoot` or starting with `projectRoot + path.sep`. Stale locks (dead PIDs) are LEFT IN PLACE (manager.js owns cleanup).
- `cmdPromoteShadow(flags)`: seven-step sequence (silent-no-op → no-shadow exit 2 → active-scan-lock guard → evict cached live QE → backup live + sidecars → promote shadow + sidecars → emit). Best-effort rollback on mid-flight rename failure. Emits `{ok, backup_path, live_path, evicted_cached_qe}` via `--json`.
- Registered as `"promote-shadow": cmdPromoteShadow` in HANDLERS — second hyphenated entry (after `shadow-scan`).

### `plugins/arcanon/worker/cli/hub.js` — `cmdDiff --shadow` branch + `cmdDiffShadow`
- `cmdDiff(flags, positional)` extended with a `if (flags.shadow) return cmdDiffShadow(flags);` dispatch at the TOP — Phase 115's positional/HEAD/ISO/branch path is entirely intact for back-compat.
- `cmdDiffShadow(flags)`: opens live + shadow DBs as fresh `better-sqlite3` readonly handles, resolves latest completed scan_version via `SELECT MAX(id) FROM scan_versions WHERE completed_at IS NOT NULL` on each side, calls `diffScanVersions(liveDb, shadowDb, liveLatest, shadowLatest)`, formats the same section layout as the positional diff path. Both handles closed in a `finally` block.

### `plugins/arcanon/commands/promote-shadow.md`
Slash-command markdown wrapper. Frontmatter: `description`, `argument-hint: "[--json]"`, `allowed-tools: Bash`. Body: full atomic-rename sequence explanation, hard contracts (atomic POSIX, never-auto-delete backup, scan_overrides loss warning), exit-codes table, rollback instructions (`mv impact-map.db.pre-promote-<ts> impact-map.db`), help block.

### `plugins/arcanon/commands/diff.md` — courtesy edit
- `argument-hint` extended: `"<scanA> <scanB> | --shadow [--json]"`.
- Selector list extended with `--shadow` bullet.
- Examples list extended with two `--shadow` entries.
- New `## --shadow flag (SHADOW-02 / Phase 119)` section explains engine reuse, exit codes, and the shadow-scan → diff --shadow → promote-shadow workflow.

### `tests/promote-shadow.bats` (12 cases)
- Tests 1-2: `evictLiveQueryEngine` (happy path + idempotent).
- Tests 3-7: `cmdPromoteShadow` rename atomicity (sha256 round-trip), WAL sidecars, backup-name regex + stdout, no-shadow exit 2, first-promote case.
- Test 8: silent contract.
- Test 9: commands/promote-shadow.md frontmatter.
- Test 10: `--json` shape (parsed + type-validated via Node script).
- Test 11: post-promote getQueryEngine returns fresh handle that sees promoted (former shadow) content.
- Test 12: active-scan-lock guard (T-119-02-04) — synthesise a lock referencing a repo under cwd with the current shell PID; assert promote exits 2 with "scan in progress" and live + shadow are untouched.

### `tests/diff-shadow.bats` (6 cases)
- Test 12: happy-path engine reuse — drift introduced via direct UPDATE/DELETE/INSERT against the shadow DB; assert added/removed/modified surface in human output.
- Test 13: no shadow DB → exit 2 + "no shadow DB" message.
- Test 14: no live DB → exit 2 + "no live DB" message.
- Test 15: `--json` shape — JSON parsed + key types validated; shadow-only-svc must be in `services.added`.
- Test 16: silent contract (no live, no shadow).
- Test 17: commands/diff.md `--shadow` documentation regression guard.

### `tests/commands-surface.bats` — SHADOW-03 regressions
Iteration list extended with `promote-shadow`. Two new SHADOW-03 assertions (`/arcanon:promote-shadow declares allowed-tools: Bash`, `worker/cli/hub.js registers "promote-shadow": cmdPromoteShadow`).

### `plugins/arcanon/CHANGELOG.md` — Unreleased / Added entries
Two new bullets: SHADOW-03 (`/arcanon:promote-shadow`) and SHADOW-02 (`/arcanon:diff --shadow`).

## Files Modified

See `key_files` frontmatter above.

## Tests Added

| Suite | Cases | Status |
|-------|-------|--------|
| `tests/promote-shadow.bats` (Task 1) | 12 | 12 PASS |
| `tests/diff-shadow.bats` (Task 2) | 6 | 6 PASS |
| `tests/commands-surface.bats` (SHADOW-03 regressions) | +2 | 22/22 PASS (was 20) |
| Plan-adjacent neighbours: diff.bats / shadow-scan.bats | 33 | 33 PASS (no regression) |
| `node --test worker/diff/scan-version-diff.test.js` (engine reuse smoke) | all | all PASS (no regression) |

**Total new bats cases: 20.** Combined run of the four bats suites: 60/60 PASS, 0 fails.

## Decisions

(See `decisions` frontmatter above for full set.)

Highlights:
1. **Atomic POSIX rename** for DB swap — sibling-path placement under `projectHashDir(...)` structurally guarantees same filesystem.
2. **WAL sidecars renamed alongside main DB** on both backup and promote steps — prevents stale-log corruption.
3. **`evictLiveQueryEngine` clears BOTH the pool.js Map AND the database.js _db singleton** — Rule 1 deviation (see below). Without the singleton reset, the next `getQueryEngine` returns a stale closed handle.
4. **Active-scan-lock guard** via filesystem scan + PID liveness check — promote refuses during any live scan referencing repos under cwd.
5. **Engine reuse via dynamic import** — Phase 115 shipped exactly the assumed `diffScanVersions(dbA, dbB, scanIdA, scanIdB)` signature, so the assumed Shape A path landed verbatim. No fallback inline-diff needed.
6. **Both DBs read-only** in `cmdDiffShadow` — preserves byte-identity invariant established by 119-01 Test 8.

## Threat Model Status

All eight threats from the PLAN's `<threat_model>` are addressed:

| Threat ID | Status | Note |
|-----------|--------|------|
| T-119-02-01 | mitigated | `evictLiveQueryEngine` called BEFORE rename in `cmdPromoteShadow` Step 4. Test 1 + Test 11 verify behaviorally. |
| T-119-02-02 | mitigated | Try/catch wraps the rename sequence. Best-effort rollback restores live from backup if shadow→live failed mid-flight. |
| T-119-02-03 | mitigated | All four sidecar paths renamed alongside main files. Test 4 enforces. |
| T-119-02-04 | mitigated | `_findActiveScanLockForProject` scans `dataDir/scan-*.lock` and refuses promote if any active lock references repos under cwd. Test 12 enforces. |
| T-119-02-05 | accept | Backup file inherits parent dir umask; same as live DB. |
| T-119-02-06 | mitigated | NEVER auto-delete. Documented in `commands/promote-shadow.md` AND in the human stdout message. No deletion code anywhere in `cmdPromoteShadow`. |
| T-119-02-07 | accept | Both DBs scoped to `process.cwd()` projectRoot. |
| T-119-02-08 | mitigated | `cmdDiffShadow` closes both DB handles in a `finally` block. (Note: live DB is opened FRESH not pooled here — closing it doesn't affect the pool. Different from the plan's stated "live QE is pooled" assumption — see Deviation 2 below.) |

## Threat Flags

| Flag | File | Description |
|------|------|-------------|
| threat_flag: cross-module-singleton-reset | plugins/arcanon/worker/db/database.js | New `_resetDbSingleton()` export reaches into the database.js module-level `_db` slot from outside the module. This is the FIRST escape hatch from openDb's first-call-wins singleton. Reviewer focus: the underscore prefix marks it internal; only `evictLiveQueryEngine` calls it, and only as a side effect of pool eviction. Future callers should NOT use it as a general-purpose connection-management API. |
| threat_flag: filesystem-scan-for-locks | plugins/arcanon/worker/cli/hub.js | `_findActiveScanLockForProject` scans the data dir for `scan-*.lock` files and parses each as JSON. Read-only — never modifies any lock. Cleanup of stale (dead-PID) locks is intentionally LEFT to manager.js's `acquireScanLock` (single ownership). Reviewer focus: PID-liveness via `process.kill(pid, 0)` is racy by definition (PID could be reused), but the race window is microseconds; the cost of a false-positive (refused promote during a long-PID-recycled-into-something-else lock) is one operator retry. Acceptable trade-off vs. cross-process semaphore overhead. |
| threat_flag: live-db-fresh-readonly-open-in-cmdDiffShadow | plugins/arcanon/worker/cli/hub.js | `cmdDiffShadow` opens the live `impact-map.db` via a fresh `better-sqlite3 {readonly: true}` connection (NOT through the pool). Mirrors the same pattern 119-01 introduced in the `/scan-shadow` route handler. Reviewer focus: readonly opens guarantee no journal_mode pragma is written back, preserving the byte-identity invariant established by 119-01 Test 8 — and avoiding the `getQueryEngine` pool's WAL flip side-effect. |

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 — Bug] `evictLiveQueryEngine` alone is insufficient — must also reset the database.js `_db` singleton**

- **Found during:** Task 1, Test 1 GREEN run. The first implementation only closed the QE's handle and dropped the pool entry. The next `getQueryEngine(projectRoot)` call routed through `openDb()`, which short-circuited on the still-set module-level `_db` pointing at the now-CLOSED Database instance. Test 1's final assertion (`qe2._db.close()`) crashed with `TypeError: Cannot read properties of null (reading '_db')` because `getQueryEngine` returned `null` (wrapped in a try/catch that logged "The database connection is not open" to stderr).
- **Why critical:** This is the load-bearing eviction-before-rename invariant (T-119-02-01). If post-eviction `getQueryEngine` calls return null or stale closed handles, the worker pool effectively becomes a one-shot — every subsequent live operation fails. The whole point of evictLiveQueryEngine is to leave the pool in a state where the NEXT getQueryEngine opens a fresh handle pointed at the post-promote file.
- **Fix:** Added `_resetDbSingleton()` to `database.js` (closes `_db` best-effort, clears the slot; idempotent). Imported it into `pool.js` and called it at the end of `evictLiveQueryEngine` after the pool entry is deleted. Underscore-prefix marks it as internal — only `evictLiveQueryEngine` should call it. JSDoc on both functions cross-references the deviation.
- **Files modified:** `plugins/arcanon/worker/db/database.js` (new export), `plugins/arcanon/worker/db/pool.js` (import + invocation).
- **Commit:** `ebd8d39` (alongside the rest of Task 1 GREEN — the fix landed in the same commit because the test failure was discovered during the GREEN run, not during a separate cycle).

### Plan/Reality Drift

**2. [Documentation only — no code change] Plan said "live QE is pooled — do NOT close it" in `cmdDiffShadow` finally block**

- **Found during:** Task 2 GREEN implementation, reading the plan's `<action>` step 1 sample code.
- **Issue:** The plan suggested `cmdDiffShadow` would call `getQueryEngine(projectRoot)` (pooled) and `getShadowQueryEngine(projectRoot)` (uncached), then close ONLY the shadow QE in the finally block to avoid evicting the pool. However, the implementation I shipped opens BOTH the live and shadow DBs as fresh `better-sqlite3 {readonly: true}` handles directly (mirroring the pattern 119-01 introduced in `/scan-shadow`'s route handler) — bypassing the pool entirely on both sides. This is a CONSCIOUS deviation: opening the live DB through the pool would cache a writable handle and flip `journal_mode` to WAL, mutating the live file's first 100 bytes — breaking the byte-identity contract that 119-01 Test 8 enforces.
- **Why this is an improvement:** The plan's pooled-live approach would have introduced exactly the bug 119-01 fixed via "READ-ONLY open of live DB for repo-list lookup" (119-01 SUMMARY Decision #2). My implementation hews to that same READ-ONLY-for-live invariant.
- **Fix:** None required — the implementation is more conservative than the plan, not less. Documented here for future reconciliation.
- **Files modified:** `plugins/arcanon/worker/cli/hub.js` (cmdDiffShadow opens both DBs fresh-readonly, closes both in finally).

## Open Items

1. **Scan-lock key sharing between live and shadow** (carried over from 119-01 SUMMARY Open Item #1). Both live and shadow scans hash to the same lock key. This plan's promote guard takes the conservative reading: ANY active scan blocks promote. If user feedback says shadow-scan-blocks-promote is too aggressive, revisit the lock-key separation in v0.1.5 — promote could explicitly skip the guard if all active locks are SHADOW scans.

2. **Production agent-runner wiring** (inherited from 119-01 / 118-02). Promote itself doesn't drive any agent — it's pure file I/O — so this gap doesn't directly affect promote. But operators who do `/arcanon:rescan` or `/arcanon:shadow-scan` from production CLI before `/arcanon:promote-shadow` will hit the same 503 the previous plans flagged. Logged in `deferred-items.md` under Phase 118-02.

3. **Cross-DB diff "modified" detection** (carried from RESEARCH §4 / Phase 115 SUMMARY). Phase 115's engine matches services on `(repo_id, name)` and connections on `(source_name, target_name, protocol, method, path)`. For live-vs-shadow diff, repo_id alignment depends on the shadow scan inserting repos with the same auto-incrementing IDs as live — which IS the case when shadow is built from the same source via `/arcanon:shadow-scan` because the new shadow DB starts empty and increments from 1 (just like live). If a future workflow seeds shadow from a copy of live + drift, repo_id alignment may break. Out of scope for v0.1.4.

4. **Backup retention policy** (carried from RESEARCH §3). `/arcanon:promote-shadow` NEVER auto-deletes backups. Operators clean up manually. A future "keep last N backups" UX is a separate decision and is NOT promised by v0.1.4.

5. **`reused_existing` in promote `--json`** (not currently emitted). Promote's `--json` returns `{ok, backup_path, live_path, evicted_cached_qe}`. There is no equivalent of shadow-scan's `reused_existing` flag because promote either succeeds (and a new live exists) or exits non-zero. No action — flag for future operator-feedback consideration.

## Verification Summary

| Gate | Expected | Actual |
|------|----------|--------|
| `bats tests/promote-shadow.bats` | 12 cases pass | 12/12 PASS |
| `bats tests/diff-shadow.bats` | 6 cases pass | 6/6 PASS |
| `bats tests/commands-surface.bats` (SHADOW-03 regressions) | 20+2 pass | 22/22 PASS |
| `bats tests/diff.bats` (no regression) | 20 pass | 20/20 PASS |
| `bats tests/shadow-scan.bats` (no regression) | 13 pass | 13/13 PASS |
| `node --test worker/diff/scan-version-diff.test.js` (engine still pool-agnostic) | all pass | all PASS |
| `grep -c "evictLiveQueryEngine" pool.js` | ≥2 (export + invocation) | 2 |
| `grep -c "_resetDbSingleton" database.js` | ≥1 (export) | 1 |
| `grep -c "promote-shadow: cmdPromoteShadow" hub.js` | 1 | 1 |
| `grep -c "shadow" CHANGELOG.md` | ≥2 (new entries) | ≥13 |
| Per-task one-commit-each (TDD) | 4 commits (RED+GREEN per task) | 4 commits in `git log --oneline` |
| `node --check` on all modified .js files | OK | OK |

## Cross-Plan Coordination

- **115-01/02 (diff engine + cmdDiff) — already shipped.** Phase 115 shipped `diffScanVersions(dbA, dbB, scanIdA, scanIdB)` exactly matching RESEARCH §4 Shape A — pool-agnostic and read-only by contract. This plan's `cmdDiffShadow` imports it via dynamic import + passes both DB handles directly. ZERO modifications required to Phase 115's engine. The defensive grep regression in `scan-version-diff.test.js` (test 18 — "no pool imports") still passes, confirming the engine remained pool-agnostic.
- **117-02 (apply-hook) — transitively involved only.** Promote does NOT touch `scan_overrides` directly. The shadow `scan_overrides` table is carried over by the rename (renamed alongside the main file as part of the SQLite database). Pre-promote live `scan_overrides` rows are LOST — documented in `commands/promote-shadow.md` and consistent with v0.1.4's "validate before commit" workflow.
- **118-02 (`/api/rescan`) — inherits the agent-runner-not-initialized 503 constraint.** Promote itself is unaffected (no agent involved), but operators who run `/arcanon:shadow-scan` before `/arcanon:promote-shadow` will hit the same 503 if no agent runner is wired in production. Logged.
- **119-01 (shadow-scan write half) — direct sibling.** This plan extends 119-01 with the read+promote half. Same fixture seeder (`tests/fixtures/shadow/seed.sh`) reused for tests; same hyphenated-HANDLERS-key pattern reused for `promote-shadow`; same READ-ONLY-for-live invariant honoured in `cmdDiffShadow`.

## Self-Check: PASSED

- FOUND: plugins/arcanon/worker/db/pool.js (evictLiveQueryEngine export)
- FOUND: plugins/arcanon/worker/db/database.js (_resetDbSingleton export)
- FOUND: plugins/arcanon/worker/cli/hub.js (cmdPromoteShadow + cmdDiffShadow + HANDLERS entry)
- FOUND: plugins/arcanon/commands/promote-shadow.md
- FOUND: plugins/arcanon/commands/diff.md (--shadow section)
- FOUND: tests/promote-shadow.bats
- FOUND: tests/diff-shadow.bats
- FOUND: commit c9b21e0 (test 119-02 RED for evictLiveQueryEngine + cmdPromoteShadow)
- FOUND: commit ebd8d39 (feat 119-02 GREEN for evictLiveQueryEngine + cmdPromoteShadow + slash command)
- FOUND: commit c90e397 (test 119-02 RED for cmdDiff --shadow + commands/diff.md surface)
- FOUND: commit 2ff439b (feat 119-02 GREEN for cmdDiff --shadow + courtesy edit to diff.md)
- All 12 promote-shadow.bats cases PASS; 6 diff-shadow.bats PASS; 22 commands-surface.bats PASS; 20 diff.bats PASS; 13 shadow-scan.bats PASS.
- All 8 PLAN truths validated (Test → Truth mapping above).
- TDD gate: RED commits c9b21e0 + c90e397 precede GREEN commits ebd8d39 + 2ff439b.

## Commits (4)

| # | Hash    | Message |
|---|---------|---------|
| 1 | c9b21e0 | test(119-02): add failing tests for evictLiveQueryEngine + cmdPromoteShadow (SHADOW-03) |
| 2 | ebd8d39 | feat(119-02): ship evictLiveQueryEngine + cmdPromoteShadow + slash command (SHADOW-03) |
| 3 | c90e397 | test(119-02): add failing tests for cmdDiff --shadow + commands/diff.md surface (SHADOW-02) |
| 4 | 2ff439b | feat(119-02): cmdDiff --shadow + courtesy edit to commands/diff.md (SHADOW-02) |
