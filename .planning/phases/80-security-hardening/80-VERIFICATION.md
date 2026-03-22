---
phase: 80-security-hardening
verified: 2026-03-22T21:55:00Z
status: passed
score: 9/9 must-haves verified
re_verification: false
---

# Phase 80: Security Hardening Verification Report

**Phase Goal:** The MCP server, scan manager, and auth extractor are protected against path traversal attacks, credential leakage, and concurrent scan corruption
**Verified:** 2026-03-22T21:55:00Z
**Status:** passed
**Re-verification:** No — initial verification

---

## Goal Achievement

### Observable Truths

| #  | Truth                                                                                                                  | Status     | Evidence                                                                 |
|----|------------------------------------------------------------------------------------------------------------------------|------------|--------------------------------------------------------------------------|
| 1  | `resolveDb("../../../etc/passwd")` returns null and never opens a file outside `~/.ligamen/projects/`                 | VERIFIED   | server.js line 80-82: `path.resolve` + `startsWith(baseDir + path.sep)` |
| 2  | Absolute paths with `..` segments anywhere in the string are rejected even after normalization                         | VERIFIED   | Test "resolveDb path traversal: /tmp/../../../etc/passwd returns null" passes |
| 3  | 12-char hex hashes that contain encoded traversal are blocked in `getQueryEngineByHash`                                | VERIFIED   | pool.js line 162: `path.resolve(dir).startsWith(projectsDir + path.sep)` |
| 4  | High-entropy strings (>= 4.0 bits/char) are never stored in `auth_mechanism` or `db_backend` fields                   | VERIFIED   | `isCredential()` returns true for entropy >= ENTROPY_REJECT_THRESHOLD    |
| 5  | Near-threshold strings (entropy 3.5-4.0) are logged at warn level but NOT rejected                                    | VERIFIED   | `_logger.warn('near-threshold entropy...')` only; `return false` follows |
| 6  | Low-entropy labels (jwt, oauth2, postgresql, redis) pass the entropy check                                             | VERIFIED   | Tests confirm all four pass; entropy well below 3.5 threshold            |
| 7  | A concurrent `/ligamen:map` on the same project returns a clear "scan already in progress" error                       | VERIFIED   | manager.js line 491: Error message string + test at line 1511 passes     |
| 8  | A stale lock file (PID no longer running) is cleaned up and does not block new scans                                   | VERIFIED   | `isProcessRunning` via `process.kill(pid, 0)`; stale test passes         |
| 9  | Lock is always released after scan completion or error (no leaked locks)                                               | VERIFIED   | manager.js lines 748-750: `finally { releaseScanLock(lockPath); }`       |

**Score:** 9/9 truths verified

---

### Required Artifacts

| Artifact                                                              | Provides                                        | Status   | Details                                                     |
|-----------------------------------------------------------------------|-------------------------------------------------|----------|-------------------------------------------------------------|
| `plugins/ligamen/worker/mcp/server.js`                                | Hardened `resolveDb` with `path.resolve` + `startsWith` | VERIFIED | Lines 79-82: full base-dir guard present                 |
| `plugins/ligamen/worker/db/pool.js`                                   | Base directory guard in `getQueryEngineByHash`  | VERIFIED | Line 162: `startsWith(projectsDir + path.sep)` guard       |
| `plugins/ligamen/worker/mcp/server.test.js`                           | Path traversal rejection tests (SEC-01)         | VERIFIED | Lines 412-440: 5 tests, all pass; "traversal" in test names |
| `plugins/ligamen/worker/scan/enrichment/auth-db-extractor.js`         | `shannonEntropy` + `ENTROPY_REJECT_THRESHOLD`   | VERIFIED | Lines 48-101: full implementation confirmed                 |
| `plugins/ligamen/worker/scan/enrichment/auth-db-extractor.test.js`    | Entropy rejection and near-threshold logging tests | VERIFIED | Lines 433-568: 11 new tests, all pass                   |
| `plugins/ligamen/worker/scan/manager.js`                              | `acquireScanLock` / `releaseScanLock` / `scanLockHash` | VERIFIED | Lines 455-519 + 561 + 748-750: full lock lifecycle   |
| `plugins/ligamen/worker/scan/manager.test.js`                         | Concurrent scan rejection and stale lock tests  | VERIFIED | Lines 1400-1535: "concurrent scan locking (SEC-03)" block  |

---

### Key Link Verification

| From                              | To                                       | Via                                             | Status  | Details                                                                |
|-----------------------------------|------------------------------------------|-------------------------------------------------|---------|------------------------------------------------------------------------|
| `server.js resolveDb`             | `pool.js getQueryEngineByHash`           | `resolveDb` calls `getQueryEngineByHash`         | WIRED   | Both harden path at their own boundary; server.js line 88              |
| `auth-db-extractor.js`            | `isCredential` pipeline                  | `shannonEntropy` called inside `isCredential`   | WIRED   | Lines 91-99: entropy gate integrated after regex checks                |
| `manager.js scanRepos`            | `~/.ligamen/scan-{hash}.lock`            | `acquireScanLock` / `releaseScanLock` with `writeFileSync`/`unlinkSync` | WIRED | Lock acquired line 561, released in `finally` lines 748-750 |

---

### Requirements Coverage

| Requirement | Source Plan | Description                                                                              | Status    | Evidence                                                            |
|-------------|------------|------------------------------------------------------------------------------------------|-----------|---------------------------------------------------------------------|
| SEC-01      | 80-01      | MCP resolveDb() uses path normalization + base directory validation against path traversal | SATISFIED | `path.resolve` + `startsWith` in server.js; pool.js guard; 5 passing tests |
| SEC-02      | 80-02      | Auth-db enricher rejects high-entropy strings; logs near-threshold for credential leak prevention | SATISFIED | `shannonEntropy`, `ENTROPY_REJECT_THRESHOLD=4.0`, `ENTROPY_WARN_THRESHOLD=3.5`; 11 passing tests |
| SEC-03      | 80-03      | Scan manager acquires project lock before scanning, rejects concurrent scans with clear error | SATISFIED | `acquireScanLock`/`releaseScanLock` in `finally`; "scan already in progress" error; 6 passing tests |

All three requirements declared across plan frontmatter (`80-01-PLAN.md`, `80-02-PLAN.md`, `80-03-PLAN.md`) are satisfied. No orphaned requirements found — REQUIREMENTS.md maps SEC-01, SEC-02, SEC-03 to Phase 80 and all are fully covered.

---

### Commit Verification

All documented commits confirmed present in repo history:

| Commit    | Description                                       | Plan  |
|-----------|---------------------------------------------------|-------|
| `cc3f698` | RED: failing traversal tests (SEC-01)             | 80-01 |
| `623ab95` | GREEN: harden resolveDb + pool (SEC-01)           | 80-01 |
| `b571410` | RED: failing entropy tests (SEC-02)               | 80-02 |
| `4667b8a` | GREEN: Shannon entropy implementation (SEC-02)    | 80-02 |
| `7905ce2` | FEAT: filesystem scan lock (SEC-03)               | 80-03 |

---

### Test Suite Results

| Suite                                | Tests | Pass | Fail | Notes                                        |
|--------------------------------------|-------|------|------|----------------------------------------------|
| `worker/mcp/server.test.js`          | 25+   | all  | 0    | Process hangs on MCP transport (pre-existing); all assertions complete |
| `worker/scan/enrichment/auth-db-extractor.test.js` | 24 | 24 | 0  | 13 pre-existing + 11 new SEC-02 tests        |
| `worker/scan/manager.test.js`        | 55    | 55   | 0    | 49 pre-existing + 6 new SEC-03 tests         |

---

### Anti-Patterns Found

None. No TODO/FIXME/PLACEHOLDER comments in modified files. No stub implementations detected. All security-critical paths have real implementation.

---

### Human Verification Required

None required. All security behaviors (traversal rejection, entropy calculation, lock acquisition) are deterministic and verified programmatically via the test suites.

---

### Summary

Phase 80 fully achieves its goal. All three security controls are implemented, tested, and wired into the production code paths:

- **SEC-01 (Path Traversal):** `resolveDb` now uses `path.resolve` + `startsWith(baseDir + path.sep)` instead of the fragile `includes('..')` substring check. `getQueryEngineByHash` adds a redundant defense-in-depth guard. Five test vectors cover relative, absolute, double-dot, undefined, and valid-hex cases.

- **SEC-02 (Credential Leakage):** Shannon entropy function integrated into `isCredential()` rejects any string with >= 4.0 bits/char. Near-threshold values (3.5-4.0) are logged at warn level but not rejected. Known low-entropy mechanism labels all pass cleanly.

- **SEC-03 (Concurrent Scan Corruption):** `scanRepos` acquires a per-project filesystem lock before any scan work and releases it in a `finally` block. Active PID detection distinguishes live vs stale locks. Six tests cover export presence, hash format, normal completion, concurrent rejection, stale cleanup, and error-path release.

---

_Verified: 2026-03-22T21:55:00Z_
_Verifier: Claude (gsd-verifier)_
