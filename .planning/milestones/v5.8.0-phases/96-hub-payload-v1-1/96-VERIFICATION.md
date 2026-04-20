---
phase: 96-hub-payload-v1-1
verified: 2026-04-19T17:10:00Z
status: passed
score: 5/5
overrides_applied: 0
re_verification: false
---

# Phase 96: Hub Payload v1.1 + Feature Flag — Verification Report

**Phase Goal:** payload.js emits v1.1 when feature flag on + non-empty deps; falls back to v1.0 when flag off OR deps empty. Shell output unchanged.
**Verified:** 2026-04-19T17:10:00Z
**Status:** PASSED
**Re-verification:** No — initial verification

---

## Goal Achievement

### Observable Truths (from ROADMAP Success Criteria)

| # | Truth | Status | Evidence |
|---|-------|--------|----------|
| SC-1 | With `hub.beta_features.library_deps: false` (default), upload emits v1.0 regardless of deps | VERIFIED | `buildFindingsBlock` line 118: `opts.libraryDepsEnabled === true` — any falsy value (including absent) falls to v1.0. Tests: "libraryDepsEnabled=false returns schemaVersion 1.0", "buildScanPayload without libraryDepsEnabled emits version 1.0 (default)", "HUB-04 matrix #3: flag OFF + populated deps → v1.0" |
| SC-2 | With flag true + non-empty deps, upload emits v1.1 with `dependencies` array per service from `getDependenciesForService` | VERIFIED | `buildFindingsBlock` line 119–122 + line 136–138. `hub.js` loadLatestFindings maps `getDependenciesForService(s.id)` unconditionally. `manager.js` attaches `svc.dependencies = queryEngine.getDependenciesForService(svc.id)` when flag is on. Tests: "libraryDepsEnabled=true and non-empty deps returns schemaVersion 1.1", "buildScanPayload with libraryDepsEnabled=true and non-empty deps emits version 1.1" |
| SC-3 | With flag true but all services having empty deps, payload falls back to v1.0 (no `dependencies` key) | VERIFIED | `anyServiceHasDeps` gate (line 119–121) requires at least one non-empty array. Tests: "libraryDepsEnabled=true but all services have empty deps returns schemaVersion 1.0 (flag-on fallback)", "buildScanPayload with libraryDepsEnabled=true but empty deps emits version 1.0 (fallback)" |
| SC-4 | `/arcanon:drift versions` shell output unchanged — no shell script touched | VERIFIED | `git log -- plugins/arcanon/scripts/drift-versions.sh` returns no Phase-96 commits. The 5 commits in Phase 96 (bddc36a, bbc5d85, 1e0bce0, bee7f57, 4b30fcf) do not appear in that file's git log |
| SC-5 | node:test covers all three flag/data combinations: empty deps → v1.0, populated deps + flag on → v1.1, populated deps + flag off → v1.0 | VERIFIED | 22 tests total. All four flag/data combos covered: (flag OFF + empty deps), (flag OFF + non-empty deps), (flag ON + empty deps), (flag ON + non-empty deps). Matrix tests explicitly tagged HUB-04 and HUB-05 |

**Score:** 5/5 truths verified

---

## Requirements Coverage

| Requirement | Description | Status | Evidence |
|-------------|-------------|--------|----------|
| HUB-01 | `buildFindingsBlock()` emits `dependencies: []` per service from `getDependenciesForService(serviceId)` | SATISFIED | `hub.js` loadLatestFindings maps `getDependenciesForService(s.id)` onto each service before passing to syncFindings. `manager.js` does the same for auto-upload. `buildFindingsBlock` maps deps onto each service in v1.1 path |
| HUB-02 | `buildScanPayload()` sets `version: "1.1"` when any service has non-empty deps; falls back to "1.0" | SATISFIED | `payload.js` line 226: `version: findingsBlock.schemaVersion`. `schemaVersion` derived inside `buildFindingsBlock` via `anyServiceHasDeps` ternary |
| HUB-03 | Feature flag `hub.beta_features.library_deps` gates emission — when off, payload is v1.0 | SATISFIED | `hub.js` cmdUpload: `Boolean(cfg?.hub?.beta_features?.library_deps)`. `manager.js` `_readHubConfig()`: same pattern. Both forward `libraryDepsEnabled` to `syncFindings` |
| HUB-04 | node:test covers: empty deps → v1.0, populated deps + flag on → v1.1, populated deps + flag off → v1.0 | SATISFIED | 22 tests pass. HUB-04 matrix #3 (flag OFF + populated deps), matrix #5 (mixed services v1.1), plus prior 96-01 tests covering all base cases |
| HUB-05 | Existing `/arcanon:drift versions` command keeps working exactly as today | SATISFIED | Zero diff on `scripts/drift-versions.sh` across all Phase 96 commits. HUB-05 regression guard test confirms v1.0 default shape (name, language, root_path, type, connections[], schemas[], actors[]) all present |

---

## Required Artifacts

| Artifact | Expected | Status | Details |
|----------|----------|--------|---------|
| `plugins/arcanon/worker/hub-sync/payload.js` | buildFindingsBlock with libraryDepsEnabled gate + schemaVersion derivation | VERIFIED | Substantive (272 lines). `opts.libraryDepsEnabled === true` gate at line 118. `anyServiceHasDeps` at lines 119–121. `schemaVersion` ternary at line 122. `version: findingsBlock.schemaVersion` at line 226 |
| `plugins/arcanon/worker/hub-sync/payload.test.js` | 22 tests covering all HUB-04 matrix combos + HUB-05 regression guard | VERIFIED | 22 `test()` calls confirmed. 4 combos present. SAMPLE_DEP_ROW fixture defined |
| `plugins/arcanon/worker/cli/hub.js` | cmdUpload reads `hub.beta_features.library_deps` + loadLatestFindings attaches deps | VERIFIED | `libraryDepsEnabled = Boolean(cfg?.hub?.beta_features?.library_deps)` at line 196. `getDependenciesForService(s.id)` at line 175 |
| `plugins/arcanon/worker/scan/manager.js` | `_readHubConfig` returns `libraryDepsEnabled`; auto-upload loop attaches deps + back-fill ids | VERIFIED | `_readHubConfig` lines 55–62 return `libraryDepsEnabled`. Auto-upload loop lines 873–878 attach deps when flag on + id is number. Back-fill SELECT lines 774–784 assign `svc.id` after `persistFindings` |

---

## Key Link Verification

| From | To | Via | Status | Details |
|------|----|-----|--------|---------|
| `hub.js` cmdUpload | `buildScanPayload` / `syncFindings` | `libraryDepsEnabled` forwarded in opts | WIRED | Line 210–213: `libraryDepsEnabled` passed to `syncFindings`. `syncFindings` passes to `buildScanPayload` via `hub-sync/index.js` |
| `manager.js` auto-upload | `syncFindings` | `libraryDepsEnabled` from `_readHubConfig` | WIRED | Line 855 destructures `libraryDepsEnabled`. Line 887: forwarded to `syncFindings` |
| `buildScanPayload` | `buildFindingsBlock` | `{ libraryDepsEnabled }` opts | WIRED | Line 216: `buildFindingsBlock(findings, { libraryDepsEnabled })` |
| `buildFindingsBlock` | `schemaVersion` → `payload.version` | `findingsBlock.schemaVersion` | WIRED | Line 152 returns `schemaVersion`. Line 226 consumes it as `version: findingsBlock.schemaVersion` |
| `manager.js` back-fill | per-service `svc.id` | `SELECT id, name FROM services WHERE repo_id = ?` | WIRED | Lines 774–784: builds `nameToId` Map and assigns `svc.id` onto each service before dep-attach block |

---

## Spot-Check Results

### Spot-Check 1: `buildFindingsBlock` reads `opts.libraryDepsEnabled`

**Finding:** PASS. Line 118 in `payload.js`:
```javascript
const libraryDepsEnabled = opts.libraryDepsEnabled === true;
```
The strict `=== true` check ensures any non-boolean or absent value defaults to false.

### Spot-Check 2: Old hardcoded `version: "1.0"` literal is gone

**Finding:** PASS. Running `grep -n 'version:.*"1\.0"'` on `payload.js` returns:
- Line 10: doc comment only (`*   - version: "1.0" (exact literal)`)
- Line 226: `version: findingsBlock.schemaVersion,   // "1.0" or "1.1"`

The assignment site now uses `findingsBlock.schemaVersion` — the hardcoded literal is gone. The remaining `"1.0"` string in payload.js appears only in the `schemaVersion` ternary derivation (`anyServiceHasDeps ? "1.1" : "1.0"`, line 122) and in comments. No hardcoded `version: "1.0"` assignment exists.

### Spot-Check 3: `scripts/drift-versions.sh` not modified in Phase 96

**Finding:** PASS. `git log -- plugins/arcanon/scripts/drift-versions.sh` shows no Phase 96 commit hashes (bddc36a, bbc5d85, 1e0bce0, bee7f57, 4b30fcf). The most recent modification to that file predates Phase 96 entirely.

### Spot-Check 4: Test count and flag/data matrix coverage

**Finding:** PASS. `grep -c "^test(" payload.test.js` = 22. All 4 required combos:
- Flag OFF + empty deps → v1.0 (test line 166: `libraryDepsEnabled=false`)
- Flag OFF + populated deps → v1.0 (test line 268: HUB-04 matrix #3)
- Flag ON + empty deps → v1.0 fallback (test line 175: `all services have empty deps`)
- Flag ON + non-empty deps → v1.1 (test line 185: `non-empty deps returns schemaVersion 1.1`)

Shell regression guard: HUB-05 regression guard test (line 249) checks name, language, root_path, type, connections[], schemas[], actors[] all present on v1.0 default path.

---

## Anti-Patterns Scan

| File | Pattern | Severity | Assessment |
|------|---------|----------|------------|
| `payload.js` | `return null` (serializePayload, error path) | Info | Throws PayloadError, not a stub |
| `payload.js` | `"1.0"` literal in schemaVersion ternary (line 122) | Info | Intentional fallback value, not hardcoded assignment |
| `manager.js` | `return { hubAutoUpload: false, ... libraryDepsEnabled: false }` (catch path) | Info | Safe default on config-read failure — not a stub |

No blockers. No stub patterns. No TODOs or placeholder comments in modified files.

---

## Human Verification Required

None. All success criteria are mechanically verifiable. The phase touches only local payload construction and feature-flag reading — no UI rendering, no real-time behavior, no external service calls in the verification scope.

---

## Summary

Phase 96 goal is fully achieved. All 5 ROADMAP success criteria are satisfied:

1. The `anyServiceHasDeps` gate in `buildFindingsBlock` enforces the fallback: flag off → v1.0 regardless of data; flag on + all empty → v1.0.
2. The `version: findingsBlock.schemaVersion` in `buildScanPayload` eliminates the old hardcoded `"1.0"` and makes payload version dynamic.
3. Both callers (`cli/hub.js` cmdUpload and `scan/manager.js` auto-upload loop) read `hub.beta_features.library_deps`, attach deps via `getDependenciesForService`, and forward the flag to `syncFindings`.
4. The id back-fill SELECT in `manager.js` ensures auto-upload can call `getDependenciesForService(svc.id)` even though `persistFindings` does not write ids back to findings objects.
5. `scripts/drift-versions.sh` was not touched across any Phase 96 commit. Shell output is byte-identical to pre-Phase-96.

Test suite: 22 tests, 0 failures. All four flag/data matrix combinations are covered. HUB-05 regression guard validates the v1.0 default path shape.

---

_Verified: 2026-04-19T17:10:00Z_
_Verifier: Claude (gsd-verifier)_
