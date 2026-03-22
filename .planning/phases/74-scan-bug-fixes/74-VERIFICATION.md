---
phase: 74-scan-bug-fixes
verified: 2026-03-22T18:30:00Z
status: passed
score: 9/9 must-haves verified
re_verification: false
---

# Phase 74: Scan Bug Fixes Verification Report

**Phase Goal:** Known scan correctness bugs are eliminated — phantom actor hexagons no longer appear for services, repos with docker-compose are correctly typed, and CODEOWNERS ownership patterns match correctly
**Verified:** 2026-03-22T18:30:00Z
**Status:** passed
**Re-verification:** No — initial verification

---

## Goal Achievement

### Observable Truths

| # | Truth | Status | Evidence |
|---|-------|--------|----------|
| 1 | When a connection target is a known service, no actor hexagon is created for it | VERIFIED | `persistFindings` checks `_stmtCheckKnownService` before `_stmtUpsertActor.run()`; Test 8 in query-engine-actors.test.js confirms guard fires |
| 2 | CODEOWNERS enricher finds .github/CODEOWNERS using the absolute repo root path | VERIFIED | `codeowners.js` line 121: `parseCODEOWNERS(ctx.repoAbsPath ?? ctx.repoPath)` |
| 3 | CODEOWNERS enricher matches ownership patterns against the relative service root_path | VERIFIED | `codeowners.js` line 125: `findOwners(entries, ctx.repoPath)` (not repoAbsPath) |
| 4 | Existing enricher tests still pass after ctx contract change | VERIFIED | All 19 codeowners tests pass; backward-compat fallback `?? ctx.repoPath` preserves old behavior |
| 5 | A Node.js service repo with docker-compose.yml is classified as 'service', not 'infra' | VERIFIED | `detectRepoType` checks `_hasServiceEntryPoint` before returning infra for docker-compose; test confirmed |
| 6 | A pure docker-compose infra repo (no service entry-point) is still classified as 'infra' | VERIFIED | `_hasServiceEntryPoint` returns false for bare docker-compose; returns "infra"; test confirmed |
| 7 | A Go repo with go.mod but no main.go and no cmd/ directory is classified as 'library' | VERIFIED | Go library heuristic at manager.js lines 193-199; test confirmed |
| 8 | A Java repo with no Application.java or Main.java is classified as 'library' | VERIFIED | Java library heuristic using `_findJavaEntryPoint` at manager.js lines 201-214; test confirmed |
| 9 | A Poetry Python repo with [tool.poetry] but no [tool.poetry.scripts] is classified as 'library' | VERIFIED | Poetry heuristic at manager.js lines 216-225; test confirmed |

**Score:** 9/9 truths verified

---

### Required Artifacts

#### Plan 01 Artifacts (SBUG-01, SBUG-03)

| Artifact | Expected | Status | Details |
|----------|----------|--------|---------|
| `plugins/ligamen/worker/db/query-engine.js` | Known-service guard in persistFindings | VERIFIED | `_stmtCheckKnownService = db.prepare("SELECT id FROM services WHERE name = ?")` at line 398; guard at lines 1071-1092 |
| `plugins/ligamen/worker/scan/enrichment.js` | repoAbsPath field in enricher context | VERIFIED | `runEnrichmentPass(service, db, logger, repoAbsPath)` at line 36; `repoAbsPath: repoAbsPath ?? null` at line 40 |
| `plugins/ligamen/worker/scan/codeowners.js` | Separate repo root for file probe vs relative path for matching | VERIFIED | `parseCODEOWNERS(ctx.repoAbsPath ?? ctx.repoPath)` at line 121; `findOwners(entries, ctx.repoPath)` at line 125 |

#### Plan 02 Artifacts (SBUG-02)

| Artifact | Expected | Status | Details |
|----------|----------|--------|---------|
| `plugins/ligamen/worker/scan/manager.js` | Fixed detectRepoType with docker-compose exemption and Go/Java/Poetry heuristics | VERIFIED | `export function detectRepoType` at line 131; `_hasServiceEntryPoint` at line 71; `_findJavaEntryPoint` at line 108; docker-compose guard at lines 149-156; Go at 193-199; Java at 201-214; Poetry at 216-225 |
| `plugins/ligamen/worker/scan/manager.test.js` | Tests for detectRepoType classification | VERIFIED | `detectRepoType` in imports at line 25; 11-test `detectRepoType` describe block starting at line 807 |

---

### Key Link Verification

| From | To | Via | Status | Details |
|------|----|-----|--------|---------|
| `query-engine.js` | services table | `_stmtCheckKnownService` prepared statement | VERIFIED | `_stmtCheckKnownService = db.prepare("SELECT id FROM services WHERE name = ?")` at constructor line 398; used in persistFindings at line 1071 |
| `manager.js` | `enrichment.js` | `runEnrichmentPass` 4th argument (repoPath) | VERIFIED | `await runEnrichmentPass(service, queryEngine._db, _logger, repoPath)` at manager.js line 536 |
| `codeowners.js` | `parseCODEOWNERS` | `ctx.repoAbsPath` for file system probe | VERIFIED | `parseCODEOWNERS(ctx.repoAbsPath ?? ctx.repoPath)` at codeowners.js line 121 |
| `manager.test.js` | `manager.js` | `import { detectRepoType }` | VERIFIED | `detectRepoType` imported at line 25 of manager.test.js |
| `detectRepoType` | `scanRepos` | called inside scanRepos to set repo.type | VERIFIED | `detectRepoType` exported and called within manager.js scan flow |

---

### Requirements Coverage

| Requirement | Source Plan | Description | Status | Evidence |
|-------------|------------|-------------|--------|----------|
| SBUG-01 | Plan 01 | persistFindings checks target against known services before creating actor — eliminates phantom actor hexagons | SATISFIED | `_stmtCheckKnownService` guard in persistFindings confirmed; Test 8 + Tests 2/4 in query-engine-actors.test.js assert correct behavior; 8/8 actor tests pass |
| SBUG-02 | Plan 02 | detectRepoType correctly classifies service repos with docker-compose.yml for local dev; expanded Go/Java/Poetry library detection | SATISFIED | docker-compose exemption + `_hasServiceEntryPoint` + Go/Java/Poetry heuristics in manager.js; 11 new detectRepoType tests pass; 33/33 manager tests pass |
| SBUG-03 | Plan 01 | CODEOWNERS enricher passes relative service root_path to findOwners instead of absolute repo path | SATISFIED | `parseCODEOWNERS(ctx.repoAbsPath ?? ctx.repoPath)` + `findOwners(entries, ctx.repoPath)` in codeowners.js; 2 new SBUG-03 tests pass; 19/19 codeowners tests pass |

No orphaned requirements — REQUIREMENTS.md maps SBUG-01, SBUG-02, SBUG-03 to Phase 74 and all three are covered.

---

### Anti-Patterns Found

None detected. Scanned all 6 modified files for TODO/FIXME/placeholder/empty-return patterns — all clean.

---

### Test Suite Results

All three test suites run and pass:

| Test File | Tests | Pass | Fail | Exit Code |
|-----------|-------|------|------|-----------|
| `query-engine-actors.test.js` | 8 | 8 | 0 | 0 |
| `codeowners.test.js` | 19 | 19 | 0 | 0 |
| `manager.test.js` | 33 | 33 | 0 | 0 |

**Total: 60 tests, 60 passed, 0 failed**

---

### TDD Commit Verification

All 6 phase commits verified to exist in git history:

| Commit | Type | Description |
|--------|------|-------------|
| `0a134cf` | test (RED) | SBUG-01 failing test for known-service actor guard |
| `1704263` | feat (GREEN) | SBUG-01 known-service guard in persistFindings |
| `e485b67` | test (RED) | SBUG-03 failing tests for CODEOWNERS relative path matching |
| `560a2fc` | feat (GREEN) | SBUG-03 CODEOWNERS enricher path fix |
| `df93a2a` | test (RED) | SBUG-02 failing tests for detectRepoType docker-compose exemption |
| `071b11d` | feat (GREEN) | SBUG-02 detectRepoType docker-compose exemption and Go/Java/Poetry heuristics |

---

### Human Verification Required

None. All goal behaviors are verifiable programmatically:
- Actor guard: test asserts no DB row created
- CODEOWNERS path routing: test creates real tmpdir file structure and asserts owner match
- detectRepoType classification: tests create real tmpdir file structures and assert return values

---

### Gaps Summary

No gaps. All 9 observable truths verified, all artifacts substantive and wired, all 3 requirements satisfied, all 60 tests pass.

---

_Verified: 2026-03-22T18:30:00Z_
_Verifier: Claude (gsd-verifier)_
