---
phase: 106-critical-hotfixes
status: passed
verified_at: 2026-04-24
---

# Phase 106: Critical Hotfixes — Verification

## Status: ✅ PASSED

Both blocker bugs from issue #18 fixed. v0.1.2 is now shippable to fresh Node 25 installs without `/arcanon:sync`, `/arcanon:upload`, `/arcanon:impact`, `/arcanon:export`, `/arcanon:drift`, or `/arcanon:status` breaking.

## Commits

- `e5adbc3` fix(106-01): bump better-sqlite3 to ^12.9.0 for Node 25 prebuilt binaries
- `98b97d5` fix(106-02): add services.boundary_entry migration + writer (issue #18 Bug 2)

## HOTFIX-01 Gate: better-sqlite3 ABI coverage

- `package.json` floor: `"^12.9.0"` ✅
- `runtime-deps.json` floor: `"^12.9.0"` ✅
- better-sqlite3 12.9.0 verified to ship prebuilt `node-v141` binary for darwin-arm64, linux-x64, linux-arm64, linuxmusl variants (via GitHub releases API)
- No rebuild-fallback needed in `install-deps.sh` since prebuilt binary now covers Node 25

## HOTFIX-02 Gate: services.boundary_entry migration

- `worker/db/migrations/011_services_boundary_entry.js` created with idempotent PRAGMA-guarded ALTER TABLE ✅
- `query-engine.js` `_stmtUpsertService` uses try/catch fallback for pre-011 databases (mirrors the migration-009 pattern for `_stmtUpsertConnection`) ✅
- `upsertService` defaults `boundary_entry` to null; `persistFindings` passes `svc.boundary_entry` through ✅
- `manager.dep-collector.test.js` workaround removed (migration now provides the column) ✅
- Other test files (`manager.test.js:866`, `codeowners.test.js:57`, `enrichment.test.js:43`) use manual DDL that already includes the column — no changes needed ✅

## HOTFIX-03 Gate: CHANGELOG + artifact updates

- `CHANGELOG.md [0.1.2] ### Fixed` subsection added with both hotfixes and issue #18 reference ✅
- `milestones/v0.1.2-ROADMAP.md` title + phase count updated (5 → 6 phases, 9 → 12 plans); Phase 106 section appended ✅
- `milestones/v0.1.2-MILESTONE-AUDIT.md` scope + date updated ✅
- `[0.1.2]` pin date bumped to 2026-04-24 (reflecting hotfix merge date)

## Test Suite Results

### bats (`make test` with `IMPACT_HOOK_LATENCY_THRESHOLD=200`)
**310/310 passing** — improved from 309/310 baseline (HOK-06 macOS p99 caveat passes at threshold=200)

### node — affected modules
- `worker/db/migrations.test.js + query-engine-*.test.js`: 25/25 ✅
- `worker/scan/manager.dep-collector.test.js + enrichment.test.js + codeowners.test.js`: 34/34 ✅

### node — full suite
Not re-run in this session (180s timeout from main-session context as noted in 105-VERIFICATION.md). Affected modules confirmed green. The 2 pre-existing failures from 105-VERIFICATION.md (`server-search.test.js` queryScan drift, `manager.test.js` incremental prompt mock) remain — confirmed unrelated to 106 changes.

## Deferred design questions (not in scope)

- **Does `services.boundary_entry` supersede `exposed_endpoints.handler`?** For now both exist and are written. Coexistence is safe; the decision belongs to a future milestone (v0.2.0+) when the scan schema is next revisited.

## Verdict

**Phase 106 passed.** v0.1.2 is ready to merge on PR #19.
