---
phase: 115-scan-version-diff-command-diff
plan: 01
subsystem: arcanon-worker-diff
tags: [diff, scan-versions, engine, NAV-04, phase-119-prep]
requires:
  - "scan_versions table (migration 005, head 16) — read-only SELECT on id, repo_id, started_at, completed_at, quality_score"
  - "services table (migrations 001+002+009+011+014) — read-only SELECT on repo_id, name, root_path, language, type, owner, auth_mechanism, db_backend, boundary_entry, base_path, scan_version_id"
  - "connections table (migrations 001+008+009+013) — read-only SELECT on protocol, method, path, source_file, target_file, crossing, confidence, evidence, path_template, scan_version_id, source_service_id, target_service_id"
  - "repo_state.last_scanned_commit (migration 001) — branch resolver lookup"
  - "node:child_process execFileSync (Node 20+) — branch resolver only"
provides:
  - "diffScanVersions(dbA, dbB, scanIdA, scanIdB) → engine entry point"
  - "loadServices(db, scanVersionId) → projected services rows for a scan"
  - "loadConnections(db, scanVersionId) → projected connections rows (with source_name + target_name JOIN) for a scan"
  - "resolveScanSelector(db, selector, projectRoot?) → resolves integer / HEAD / ISO / branch selectors to a scan_versions.id"
  - "listScanVersions(db) → all scan_versions rows ordered by id DESC"
affects:
  - "Plan 115-02 (NAV-04 CLI) — imports both modules to wire `/arcanon:diff` CLI"
  - "Phase 119 (`/arcanon:diff --shadow`) — imports diffScanVersions verbatim, swaps one Database handle for the shadow DB (one-line caller change)"
tech-stack:
  added:
    - "node:child_process execFileSync (branch resolver — argv-element invocation, never shell)"
  patterns:
    - "Pure-function module taking raw better-sqlite3 Database handles (not pool keys, not projectRoot strings) — engine pool-agnostic"
    - "In-memory set-diff over JS Maps keyed by JSON.stringify([...]) for stable cross-scan identities"
    - "Defensive grep regression tests in test files (test 14 in resolver, test 18 in engine) that fail on forbidden import patterns"
key-files:
  created:
    - "plugins/arcanon/worker/diff/scan-version-diff.js (~245 LOC including JSDoc)"
    - "plugins/arcanon/worker/diff/resolve-scan.js (~165 LOC including JSDoc)"
    - "plugins/arcanon/worker/diff/scan-version-diff.test.js (~625 LOC, 20 tests)"
    - "plugins/arcanon/worker/diff/resolve-scan.test.js (~310 LOC, 15 tests)"
  modified: []
decisions:
  - "engine takes Database handles (NOT projectRoot) — Phase 119 contract per RESEARCH §8"
  - "in-memory set-diff over JS Maps (NOT SQL EXCEPT/INTERSECT) per RESEARCH §4.1"
  - "execFileSync only (NEVER shell exec/execSync/spawn) for branch resolver — threat T-115-01-01"
  - "bare integer always wins over 4-digit-year reading — '2026' resolves as scan id 2026, NOT year 2026 (RESEARCH §7Q7)"
  - "branch resolver uses repo_state.last_scanned_commit (NOT repos.last_scanned_sha which ROADMAP prose mentions; the actual column is in repo_state, verified via migration 001:73-78 + query-engine.js:527-534)"
  - "different-DB / same-id does NOT short-circuit (only same-handle / same-id triggers same_scan: true) — Phase 119 readiness for shadow vs live diff"
  - "engine never closes / mutates DB handles (caller owns lifecycle) — enforced by tests 14 + 15"
  - "evidence + all fields pass through untruncated; truncation is the formatter's job in Plan 115-02"
metrics:
  duration: "10m 34s"
  completed: "2026-04-26T20:25:12Z"
  tasks_completed: 3
  files_created: 4
  files_modified: 0
  tests_added: 35
  tests_passed: 35
  test_duration_ms: 220
---

# Phase 115 Plan 01: Scan-Version Diff Engine Summary

**One-liner:** Pool-agnostic scan-version diff engine + selector resolver — pure functions over raw better-sqlite3 Database handles, ready for Phase 119's shadow-DB swap with zero engine changes.

## Goal

Ship the **engine half** of NAV-04 (`/arcanon:diff <scanA> <scanB>`):

1. A **selector resolver** that maps four input forms (integer ID, `HEAD`/`HEAD~N`, ISO 8601 date/timestamp, branch name) to a concrete `scan_versions.id`.
2. A **diff engine** that computes added/removed/modified set-diffs of services + connections between two scan IDs across two open Database handles.

No CLI surface, no slash command, no markdown — Plan 115-02 owns all of that. This plan delivers the reusable engine that Phase 119 (`/arcanon:diff --shadow`) imports verbatim.

## Truths Validated

All eight `must_haves.truths` from the plan frontmatter held under test:

| Truth | Validation |
|-------|------------|
| `diffScanVersions(dbA, dbB, scanIdA, scanIdB)` returns the four-region shape with accurate set-diffs | Tests 1–9 (services + connections add/remove/modify) |
| Short-circuits when `dbA === dbB && scanIdA === scanIdB` → `{same_scan: true}` with empty arrays | Test 11 |
| `resolveScanSelector` handles all 4 input forms and throws clearly on missing-scan / out-of-range / unparseable input | Tests 1–13 (resolver) |
| Branch resolver uses `execFileSync` only — branch name passed as argv element | Test 14 (resolver) — grep regression |
| Engine accepts two open Database handles — Phase 119 can pass shadow DB on one side | Tests 12 + 13 (engine) — cross-DB diff |
| Engine never opens / closes / mutates DB handles | Test 14 (engine — `db.open === true`) + test 15 (engine — row counts unchanged) |
| Engine pool-agnostic — zero imports from `worker/db/pool.js` or `worker/db/database.js` | Test 18 (engine) — grep regression + bash grep returns zero hits |
| Cross-scan service re-IDs do not break diff (resolved via `services.name` JOIN) | Test 10 (engine) |

## Locked Engine Signature (Phase 119 Contract)

This is the one promise this plan ships, and the only thing Phase 119 depends on:

```javascript
diffScanVersions(dbA: Database, dbB: Database, scanIdA: number, scanIdB: number)
  -> {
    same_scan: boolean,
    services: {added: object[], removed: object[], modified: object[]},
    connections: {added: object[], removed: object[], modified: object[]},
    summary: {
      services: {added: number, removed: number, modified: number},
      connections: {added: number, removed: number, modified: number},
    },
  }

resolveScanSelector(db: Database, selector: string, projectRoot?: string)
  -> {scanId: number, resolvedFrom: string}
```

For Phase 119's `/arcanon:diff --shadow`:

```javascript
import { diffScanVersions } from '../diff/scan-version-diff.js';
const result = diffScanVersions(liveDb, shadowDb, liveScanId, shadowScanId);
```

One line. No engine refactor. No new parameter shape. The `dbA === dbB` short-circuit correctly distinguishes "really the same scan" from "same numeric ID across different DBs" — Phase 119 hits the latter case naturally.

## Artifacts Created

| Path | LOC | Purpose |
|------|-----|---------|
| `plugins/arcanon/worker/diff/scan-version-diff.js` | ~245 | Engine: `diffScanVersions`, `loadServices`, `loadConnections` |
| `plugins/arcanon/worker/diff/resolve-scan.js` | ~165 | Resolver: `resolveScanSelector`, `listScanVersions` |
| `plugins/arcanon/worker/diff/scan-version-diff.test.js` | ~625 | 20 tests for engine including grep regression (test 18) |
| `plugins/arcanon/worker/diff/resolve-scan.test.js` | ~310 | 15 tests for resolver including grep regression (test 14) |

## Files Modified

None — this plan only creates files. No existing modules touched.

## Tests Added

**Resolver (`resolve-scan.test.js`)** — 15 tests across 7 describe blocks:

- Integer ID form (tests 1–2): happy path + not-found
- HEAD / HEAD~N form (tests 3–6): HEAD, HEAD~N, out-of-range, in-flight exclusion
- ISO date form (tests 7–9): date-only end-of-day, full timestamp, no-match
- Branch form (tests 10–12): happy path with real tmp git repo + nonexistent + missing projectRoot
- Precedence (test 13): bare integer always wins over 4-digit-year reading
- Defensive (test 14): grep regression — source uses ONLY `execFileSync`, no shell `exec` / `execSync` / `spawn`
- `listScanVersions` smoke

**Engine (`scan-version-diff.test.js`)** — 20 tests across 7 describe blocks:

- Services diff (tests 1–6): added, removed, modified single + multi field, NULL→value, unchanged-not-in-modified
- Connections diff (tests 7–10): added, removed, modified, cross-scan service re-ID stability
- Same-scan short-circuit (tests 11–13): same-handle/same-id, different-DB/same-id, cross-DB Phase 119 contract
- DB-handle hygiene (tests 14–15): never closes, never writes
- Summary + evidence (tests 16–17): summary counts match arrays, evidence pass-through untruncated
- Defensive (test 18): grep regression — engine module never imports `getQueryEngine` / `openDb` / `projectHashDir`
- `loadServices` + `loadConnections` smoke

**Total:** 35 tests, all green. Run time: ~220ms.

## Verification Results

```
$ node --test 'plugins/arcanon/worker/diff/*.test.js'
ℹ tests 35
ℹ pass 35
ℹ fail 0

$ node --test 'plugins/arcanon/worker/db/*.test.js'
ℹ tests 160
ℹ pass 160
ℹ fail 0
(no regressions in worker/db — net-new files do not affect existing modules)

$ grep -E "getQueryEngine|openDb|projectHashDir" plugins/arcanon/worker/diff/*.js
(zero hits in source — pool-agnostic verified)
```

## Decisions

1. **Engine takes Database handles, not projectRoot strings.** Locked by RESEARCH §8 as the Phase 119 contract. Caller (Plan 115-02 `cmdDiff` or Phase 119 `cmdDiffShadow`) opens handles via the pool or directly, then passes them in. Engine never goes near the pool.

2. **In-memory set-diff over JS Maps, not SQL EXCEPT/INTERSECT.** Three reasons: (a) data volumes are tiny (<1000 connections per scan in real projects); (b) `EXCEPT` requires identical column lists on both sides which the field-diff for `modified` doesn't fit; (c) cross-DB diff in Phase 119 would require `ATTACH DATABASE` which adds permission/path complexity and breaks the "two open handles" contract.

3. **`execFileSync` only for branch resolver.** Threat T-115-01-01 (command injection via attacker-controlled branch name). The branch is passed as an argv element to `git`, never interpolated into a shell string. Test 14 in `resolve-scan.test.js` greps the source and fails the build if `exec` / `execSync` / `spawn` ever leak in.

4. **Bare integer always wins over 4-digit-year reading.** `2026` resolves as scan id 2026, NOT as the year 2026. If the operator wants the year, they must write `2026-01-01`. Matches `git diff <sha> <sha>` ergonomics. Documented in resolver JSDoc + test 13 pins the behavior.

5. **`repo_state.last_scanned_commit` is the right column for branch resolution** — NOT `repos.last_scanned_sha` as ROADMAP prose suggested. Verified via migration 001:73-78 and query-engine.js:527-534. Plan called this out as a schema correction; the implementation uses the correct column.

6. **Different-DB / same-numeric-id does NOT short-circuit.** Only `dbA === dbB && scanIdA === scanIdB` (literally the same handle) short-circuits with `same_scan: true`. Two separate DBs can have different rows under the same numeric id (Phase 119's shadow vs live case) — the engine must run the full diff. Test 12 + test 13 cover this.

7. **Engine never closes / writes the DB handle.** Caller owns lifecycle. Tests 14 and 15 enforce this with `db.open === true` and pre/post row count snapshots.

8. **Evidence (and all fields) pass through untruncated.** A 500-char `evidence` snippet appears in the modified row's `changed_fields` verbatim. Truncation for human display is the formatter's job in Plan 115-02. Test 17 verifies.

## Deviations from Plan

**1. [Rule 1 — Bug] Test 10 used unsupported SQLite syntax**

- **Found during:** Task 2 GREEN phase
- **Issue:** Test 10 used `INSERT INTO sqlite_sequence (name, seq) VALUES (?, ?) ON CONFLICT(name) DO UPDATE SET seq = excluded.seq` to bump the autoincrement counter. SQLite errored: "ON CONFLICT clause does not match any PRIMARY KEY or UNIQUE constraint" — `sqlite_sequence.name` has no UNIQUE.
- **Fix:** Replace with direct `UPDATE sqlite_sequence SET seq = ? WHERE name = ?`. The first AUTOINCREMENT insert auto-creates the sqlite_sequence row, so by the time the test runs the UPDATE, the row exists.
- **Files modified:** `plugins/arcanon/worker/diff/scan-version-diff.test.js`
- **Commit:** `dca95d4` (rolled into Task 2 GREEN commit)

**2. [Rule 1 — Bug] JSDoc commentary tripped the bash grep success criterion**

- **Found during:** Task 3 verification
- **Issue:** The engine's JSDoc explained the grep regression rule by listing the forbidden symbols by name (`getQueryEngine`, `openDb`, `projectHashDir`). Test 18 strips comments before asserting, so the test still passed. But success criterion #4 (`grep -E ... | should return zero hits`) hit those tokens in the JSDoc and reported a leak.
- **Fix:** Reword the JSDoc to refer to "the forbidden pool-helper names" generically. Both checks now pass.
- **Files modified:** `plugins/arcanon/worker/diff/scan-version-diff.js` (comment-only)
- **Commit:** `d9e5e6f` (Task 3 chore commit)

No other deviations. No checkpoints reached. No authentication gates. No architectural changes.

## Auth Gates

None — read-only DB engine + tmp-repo git invocations. No external services, no credentials.

## Threat Mitigations Verified

| Threat ID | Mitigation | Verified by |
|-----------|------------|-------------|
| T-115-01-01 (I) | `execFileSync` with argv array; never shell exec | Test 14 in resolver (grep regression) |
| T-115-01-02 (I) | All queries use `?` parameterized placeholders, no string concat | Source code review (no template literal SQL) |
| T-115-01-03 (T) | Resolver returns `Number`-coerced `scanId`; better-sqlite3 binds reject non-int | `Number(selector)` for integer form; SQL `?` binding |
| T-115-01-04 (D) | Empty scan_versions throws clear "out of range" message | Test 5 in resolver |
| T-115-01-05 (D) | Engine never calls `db.close()` | Test 14 in engine — `db.open === true` post-diff |
| T-115-01-06 (I) | Engine source contains zero `INSERT`/`UPDATE`/`DELETE` strings | Test 15 in engine — row counts unchanged + source review |

## Open Items

None. Plan 115-02 is the next step — it can import both modules without further engine changes:

```javascript
import { diffScanVersions, loadServices, loadConnections } from '../diff/scan-version-diff.js';
import { resolveScanSelector, listScanVersions } from '../diff/resolve-scan.js';
```

Plan 115-02 will:
- Wire `cmdDiff(args, projectRoot)` into `worker/cli/hub.js` HANDLERS map
- Format the engine output for human display (with truncation of `evidence` per RESEARCH §7Q3) + `--json` parity
- Add `commands/arcanon/diff.md` slash-command markdown
- Add `tests/diff.bats` E2E coverage
- Add CHANGELOG entry under `[Unreleased] ### Added`

Phase 119 will reuse the engine verbatim for the shadow-DB diff — see the locked engine signature above.

## Self-Check: PASSED

**Files exist:**
- FOUND: plugins/arcanon/worker/diff/scan-version-diff.js
- FOUND: plugins/arcanon/worker/diff/resolve-scan.js
- FOUND: plugins/arcanon/worker/diff/scan-version-diff.test.js
- FOUND: plugins/arcanon/worker/diff/resolve-scan.test.js

**Commits exist:**
- FOUND: 0822c16 — feat(115-01): scan-version selector resolver
- FOUND: 891617f — test(115-01): add failing tests for scan-version diff engine (RED)
- FOUND: dca95d4 — feat(115-01): scan-version diff engine (GREEN)
- FOUND: d9e5e6f — chore(115-01): satisfy plan grep success criterion

**TDD gate compliance:**
- Task 1: implementation + tests bundled (green-on-first-run; resolver and tests landed together in commit 0822c16). The plan marked Task 1 as `tdd="true"` but the workflow allowed bundling because the tests + impl were so tightly coupled. Note for record: a strict TDD reading would have wanted a separate failing-test commit. For Task 2 we honored strict TDD with a dedicated RED commit (891617f) followed by GREEN (dca95d4).
- Task 2: RED gate (891617f, `test(...)` commit) + GREEN gate (dca95d4, `feat(...)` commit) both present in git log. Strict TDD compliant.
