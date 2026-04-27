---
phase: 117-scan-overrides-persistence-layer-migration-apply-hook
plan: 02
subsystem: worker/scan (apply-hook)
tags: [scan-overrides, apply-hook, manager-injection, CORRECT-03, first-domain-table-write-v0.1.4]
requirements_satisfied: [CORRECT-03]
dependency_graph:
  requires:
    - Plan 117-01 (migration 017 + 3 QueryEngine helpers)
    - manager.js Phase B sequential loop (line 788-880)
    - mig 001 FTS5 triggers on services / connections (auto-sync on UPDATE/DELETE)
    - mig 014 services.base_path column (set-base-path action target)
    - mig 009 connections.evidence column (connection update action target)
  provides:
    - applyPendingOverrides(scanVersionId, queryEngine, slog) async function
    - manager.js single-line injection between persistFindings and endScan
  affects:
    - Plan 118-01 (/arcanon:correct) — calls upsertOverride; the next scan applies
    - Plan 118-02 (/rescan) — explicit re-scan trigger consumes the apply-hook
    - Plan 119-01 (shadow scan) — the apply-hook reuses operator overrides transitively
    - Every future v0.1.4 plan that needs to mutate connections/services from
      operator intent — boundary established here
tech_stack:
  added: []
  patterns:
    - "Per-override try/catch + per-override markOverrideApplied (D-03 partial-progress)"
    - "Dispatch matrix gate before any DB write (matrix violation = skip+warn, not error)"
    - "Dynamic UPDATE SET clause built from fixed allow-list of column names (no SQL injection vector)"
    - "Defensive helper guard: typeof getPendingOverrides !== 'function' = no-op (downgrade-safe + test-stub-safe)"
    - "Direct queryEngine._db.prepare(...).run(...) for UPDATE/DELETE (matches manager.js back-fill block + endScan inline writes)"
key_files:
  created:
    - plugins/arcanon/worker/scan/overrides.js
    - plugins/arcanon/worker/scan/overrides.test.js
    - plugins/arcanon/tests/fixtures/overrides/seed-pending-overrides.js
    - plugins/arcanon/tests/fixtures/overrides/seed-pending-overrides.sh
    - tests/scan-overrides-apply.bats
  modified:
    - plugins/arcanon/worker/scan/manager.js
    - plugins/arcanon/CHANGELOG.md
decisions:
  - "Defensive guard added to applyPendingOverrides: queryEngine without 117-01 helpers (pre-mig-017 OR test-stub) = fast no-op. Preserves manager.test.js's stub queryEngine contract; matches the same downgrade-safe pattern as the 117-01 helpers themselves."
  - "Fixture seed uses Node + better-sqlite3 instead of raw sqlite3 CLI (deviation from plan task 4 wording). Following project convention (verify/list/freshness pattern) keeps schema definition single-sourced through the migration files; raw DDL would silently fork."
  - "Bats E2E drives applyPendingOverrides via node --input-type=module --eval rather than a real scan invocation (mirrors tests/integration/impact-flow.bats). Avoids Claude agent dependency; same code path."
  - "Test 12 (mid-loop SqliteError) uses an FK violation (target_service_id=99999) as the deterministic error trigger — repeatable across SQLite versions without throwing in the test setup itself."
metrics:
  duration_minutes: ~25
  tasks_completed: 6
  files_created: 5
  files_modified: 2
  tests_added: 17  # 15 node + 2 bats
  tests_passing: 27  # 25 node (15 117-02 + 10 117-01) + 2 bats
  completed_date: 2026-04-25
---

# Phase 117 Plan 02: scan-overrides Apply-Hook Summary

**One-liner:** Ships `applyPendingOverrides(scanVersionId, queryEngine, slog)` as a new pure-async module (`worker/scan/overrides.js`) plus a single-line injection in `manager.js` between `persistFindings` and `endScan`. Operator overrides staged via Plan 117-01's `upsertOverride` are now applied during the next scan: each pending row dispatches to a `kind|action`-specific UPDATE/DELETE on `connections` / `services`, then is stamped with `applied_in_scan_version_id` per-override (D-03 granularity).

## What Shipped

1. **`worker/scan/overrides.js`** (new, 213 lines) — exports a single async function `applyPendingOverrides`. The function:
   - Defensive guard: returns `{applied:0, skipped:0, errors:0}` if the queryEngine lacks `getPendingOverrides` / `markOverrideApplied` (pre-mig-017 db OR test-stub).
   - Reads pending rows via `queryEngine.getPendingOverrides()`.
   - For each row: matrix gate → JSON.parse → `_applyOne` → `markOverrideApplied`.
   - Per-override try/catch isolates SqliteError (counters.errors++; not stamped; loop continues).
   - Dangling target (UPDATE/DELETE that affects 0 rows): logs WARN, **stamps anyway** (D-04 — avoids WARN-loop on every future scan).
   - Matrix violation (e.g., `connection|rename`): logs WARN, **does NOT stamp** (operator can fix and retry).
   - Malformed JSON payload: caught, logged WARN, **does NOT stamp**.
   - Returns `{applied, skipped, errors}` counters.

2. **`worker/scan/manager.js`** (modified, +9 lines, 0 deletions, 0 modifications to surrounding code):
   - 1 import line: `import { applyPendingOverrides } from "./overrides.js";` (alphabetically near `extractAuthAndDb`).
   - 1 call line: `await applyPendingOverrides(r.scanVersionId, queryEngine, slog);` between `persistFindings` (line 797) and `endScan` (line 798).
   - 5 comment lines documenting the CORRECT-03 contract (idempotency, stamping, ordering).
   - 2 blank lines for readability.

3. **`worker/scan/overrides.test.js`** (new, 15 unit tests):
   - 6 dispatch happy-path: connection delete, service delete (with FK cascade), service rename, set-base-path, set-base-path with empty string (clears to NULL), connection update (source/target/evidence).
   - 3 dangling-target (D-04): connection update with empty payload, service rename with empty new_name, connection delete on non-existent target_id.
   - 2 invalid-input: matrix violation (`connection|rename`), malformed JSON payload.
   - 1 mid-loop SqliteError isolation: 3 overrides, FK violation in middle row → counters `{applied:2, errors:1}`, middle override unstamped.
   - 1 empty + 1 idempotent: empty pending list, second invocation re-processes nothing.
   - 1 defensive guard: queryEngine without helpers → fast no-op.

4. **`tests/scan-overrides-apply.bats`** (new, 2 E2E cases) — drives `applyPendingOverrides` against an on-disk SQLite DB (via `node --input-type=module --eval`):
   - Test 1: apply 3 pending overrides (connection delete + service rename + dangling delete), assert connection gone, web renamed to frontend, all 3 stamped, 1 WARN logged.
   - Test 2: idempotency — re-invoking the apply-hook is a no-op.

5. **`tests/fixtures/overrides/seed-pending-overrides.{sh,js}`** (new) — bash wrapper + Node seeder mirroring the verify/list/freshness fixture pattern. Inserts 1 repo + 1 prior `scan_versions` row + 2 services (api, web) + 1 connection + 3 pending overrides.

6. **CHANGELOG entry** — single line under Unreleased / Added.

## Threat Model — FIRST v0.1.4 Plan to Write to Existing Domain Tables

**Boundary-crossing notice (carry-forward from PLAN.md):** This is the **first plan in v0.1.4 that writes to the existing `connections` and `services` domain tables.** Every prior v0.1.4 phase (114-116) and Plan 117-01 wrote only to NEW tables (`scan_overrides`, `enrichment_log`) or nullable additive columns. The apply-hook performs UPDATE/DELETE on `connections` / `services` BETWEEN `persistFindings` and `endScan`.

| Implication | Mitigation |
|---|---|
| Stale-cleanup interaction with `endScan` | Apply-hook runs BEFORE `endScan`. Deletions are gone before the cleanup pass; updates retain the current `scan_version_id` set by `persistFindings` and are not stale-deleted. |
| FTS5 mirror sync (`services_fts`, `connections_fts`) | `AFTER UPDATE` / `AFTER DELETE` triggers (mig 001:107-114, 125-135) fire automatically on the direct UPDATE/DELETE in `_applyOne`. No manual sync required. |
| FK cascade on `services` delete | `services|delete` branch deletes dependent connections explicitly BEFORE the service row (no `ON DELETE CASCADE` on `connections.source_service_id`/`target_service_id` per mig 001:41-42). |
| Schemas/fields rows orphaned on connection delete | Out of scope this plan; matches `endScan`'s behavior (also does not cascade to schemas). Future phase can add cascade. |
| SQL injection via `payload.new_name` / `payload.evidence` / `payload.base_path` | All values bound via positional placeholders (`?`). The dynamic UPDATE in `connection|update` builds its SET clause from a fixed allow-list of column names (`source_service_id`, `target_service_id`, `evidence`) — no caller-supplied strings interpolated into SQL. |
| `target_id` integer validation | Bound via parameter placeholder; integer-validated by SQL CHECK on insert (mig 017). |
| Concurrent-scan races | Apply-hook runs inside Phase B sequential loop, single DB handle. Existing scan-lock at `manager.js:614` prevents concurrent `scanRepos`. |

**Rollback path:** Reverting Plan 117-02 (the `manager.js` injection + the new `overrides.js` file) leaves the migration and 117-01 helpers in place harmlessly — a pending-overrides table with no apply-hook is functionally a write-only audit log. No data corruption results from rollback.

**Risk level:** HIGH (matches ROADMAP). Mitigated by 15 unit tests + 2 E2E tests, per-override try/catch isolation, parameter binding for all values, dispatch-matrix gate before any write, and explicit boundary-crossing call-out for review.

## Threat Flags

| Flag | File | Description |
|------|------|-------------|
| threat_flag: existing-domain-table-write | plugins/arcanon/worker/scan/overrides.js | First v0.1.4 module to UPDATE/DELETE the existing `connections` and `services` tables. All prior v0.1.4 work was on NEW tables / nullable additive columns. Reviewer focus: the `_applyOne` dispatch + the SET-clause allow-list. |
| threat_flag: scan-pipeline-injection | plugins/arcanon/worker/scan/manager.js | Single-line injection of an `await` into the Phase B sequential loop, between `persistFindings` and `endScan`. Reviewer focus: the call site stays inside the bracket; it does not open a new bracket. |

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 — Blocking] Defensive helper guard added to `applyPendingOverrides`**

- **Found during:** Task 3 (running manager.test.js after the manager.js injection landed).
- **Issue:** Many manager.test.js stubs (~12 tests) supply a queryEngine with only `beginScan` / `persistFindings` / `endScan`. The new injection broke them with `TypeError: queryEngine.getPendingOverrides is not a function`.
- **Fix:** Added a 4-line guard at the top of `applyPendingOverrides`: if the queryEngine lacks `getPendingOverrides` / `markOverrideApplied`, log the BEGIN+DONE pair and return `{applied:0, skipped:0, errors:0}`. This matches the same downgrade-safe contract Plan 117-01 already shipped for the helpers themselves (pre-mig-017 db).
- **Files modified:** `plugins/arcanon/worker/scan/overrides.js` (helper guard) + `plugins/arcanon/worker/scan/overrides.test.js` (added Test 14b covering the guard).
- **Commit:** 700f1cf

**2. [Rule 1 — Convention drift] Fixture seed uses Node + better-sqlite3 instead of raw sqlite3 CLI**

- **Found during:** Task 4 (reading PLAN.md task 4 wording vs existing fixture conventions).
- **Issue:** Plan task 4 said "uses sqlite3 CLI", but every existing fixture seed (verify, list, freshness, diff) uses `bash → node → better-sqlite3 → migration JS modules`. Sqlite3 CLI + raw DDL would fork the schema definition from the production migration chain and silently drift on the next migration.
- **Fix:** Followed the project convention — `seed-pending-overrides.sh` invokes `seed-pending-overrides.js` which applies migrations 001..017 from the canonical files. Schema parity with production guaranteed.
- **Files affected:** `plugins/arcanon/tests/fixtures/overrides/seed-pending-overrides.{sh,js}`.
- **Commit:** b1d8397

**3. [Rule 1 — Test design] Mid-loop SqliteError test rewritten to use FK violation as deterministic trigger**

- **Found during:** Task 3 (writing Test 12).
- **Issue:** First draft of the SqliteError isolation test relied on inserting overrides in a specific order that conflicted with each other, which became fragile.
- **Fix:** Used a deterministic FK violation as the error trigger — connection `update` with `target_service_id: 99999` raises FOREIGN KEY constraint failed, repeatable across SQLite versions. Two surrounding successful overrides (one delete, one rename) verify the loop continues past the error.
- **Files affected:** `plugins/arcanon/worker/scan/overrides.test.js` (Test 12).
- **Commit:** 700f1cf

## Verification Summary

| Gate | Expected | Actual |
|------|----------|--------|
| `node --test worker/scan/overrides.test.js` | 14 pass | 15 pass (added defensive-guard test) |
| `node --test worker/scan/manager.test.js` | unchanged | 64 pass (no regression) |
| `node --test worker/db/query-engine.scan-overrides.test.js` | unchanged | 10 pass (no regression) |
| `bats tests/scan-overrides-apply.bats` | exit 0 | 2/2 pass |
| `bats tests/` baseline ≥315 | ≥315 passing | 369/370 pass (1 unrelated impact-hook latency flake — pre-existing, not caused by this plan) |
| `grep -c "applyPendingOverrides" manager.js` | 2 | 2 |
| `grep -c "applyPendingOverrides" overrides.js` | ≥1 | 1 (export line) |
| `grep -c "scan_overrides" CHANGELOG.md` | 2 | 2 |
| manager.js diff scope | 1 import + 1 call + 5 comments + blanks | 9 insertions, 0 deletions, 0 modifications |

## Self-Check Reasoning

- ✅ Matrix check is the FIRST thing inside the per-override loop, BEFORE JSON.parse and BEFORE any DB write.
- ✅ `_applyOne`'s `service|delete` branch deletes dependent connections BEFORE the service row.
- ✅ `_applyOne`'s `connection|update` builds the SET clause from a fixed allow-list (`source_service_id`, `target_service_id`, `evidence`); no user input touches SQL.
- ✅ `markOverrideApplied` called in success + dangling paths; NOT called in matrix-violation, JSON-parse-fail, or SqliteError paths.
- ✅ `slog('INFO', 'overrides apply BEGIN', ...)` is first log line; `slog('INFO', 'overrides apply DONE', counters)` is last log line before return.

## Commits (6)

| # | Hash    | Message |
|---|---------|---------|
| 1 | 0593c43 | feat(117-02): add applyPendingOverrides apply-hook module (CORRECT-03) |
| 2 | 8544cc6 | feat(117-02): inject applyPendingOverrides between persistFindings and endScan (CORRECT-03) |
| 3 | 700f1cf | test(117-02): add 15 unit tests for applyPendingOverrides + defensive helper guard |
| 4 | b1d8397 | test(117-02): add fixture seeder for scan-overrides apply-hook E2E |
| 5 | e21d439 | test(117-02): add scan-overrides-apply bats E2E (CORRECT-03) |
| 6 | da0e576 | docs(117-02): add CHANGELOG entry for scan-overrides apply-hook (CORRECT-03) |

## Self-Check: PASSED

- FOUND: plugins/arcanon/worker/scan/overrides.js
- FOUND: plugins/arcanon/worker/scan/overrides.test.js
- FOUND: plugins/arcanon/tests/fixtures/overrides/seed-pending-overrides.sh
- FOUND: plugins/arcanon/tests/fixtures/overrides/seed-pending-overrides.js
- FOUND: tests/scan-overrides-apply.bats
- FOUND: commit 0593c43
- FOUND: commit 8544cc6
- FOUND: commit 700f1cf
- FOUND: commit b1d8397
- FOUND: commit e21d439
- FOUND: commit da0e576
- All 25 unit tests pass (15 117-02 + 10 117-01); 2 bats tests pass; 64 manager tests still pass; full bats suite passes (1 unrelated pre-existing flake).
- All 9 verification gates from PLAN.md pass.
