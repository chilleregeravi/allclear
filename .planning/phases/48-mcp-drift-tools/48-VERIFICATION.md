---
phase: 48-mcp-drift-tools
verified: 2026-03-20T21:00:00Z
status: passed
score: 14/14 must-haves verified
re_verification: false
---

# Phase 48: MCP Drift Tools Verification Report

**Phase Goal:** Agents can query cross-repo dependency version, shared type, and OpenAPI spec mismatches via MCP
**Verified:** 2026-03-20T21:00:00Z
**Status:** PASSED
**Re-verification:** No — initial verification

---

## Goal Achievement

### Observable Truths

| #  | Truth | Status | Evidence |
|----|-------|--------|----------|
| 1  | An agent calling `drift_versions` receives a `findings` array with CRITICAL entries when package versions differ across repos | VERIFIED | `queryDriftVersions` at server.js:581 — exact version comparison logic lines 612-621; test passes at server-drift.test.js:92 |
| 2  | An agent calling `drift_versions` receives a `findings` array with WARN entries when range specifiers differ | VERIFIED | `normalizeVersion` + `hasRangeSpecifier` helpers; WARN path at server.js:624-627; test passes at server-drift.test.js:125 |
| 3  | `drift_versions` returns `{ findings: [], repos_scanned: 0 }` when db is null | VERIFIED | `getDriftRepos` returns `[]` on null db (server.js:461); early return at server.js:583; test passes |
| 4  | The `drift_versions` tool is registered via `server.tool()` and appears in the MCP manifest | VERIFIED | `server.tool("drift_versions", ...)` at server.js:1366-1383; calls `queryDriftVersions(qe?._db ?? null, params)` |
| 5  | An agent calling `drift_types` receives a CRITICAL finding when a shared type name has different field bodies across repos of the same language | VERIFIED | `extractTypeBody` + sorted-line comparison in `queryDriftTypes`; test passes at server-drift.test.js:285 |
| 6  | `drift_types` only compares repos that share the same language (ts vs go never compared) | VERIFIED | `langGroups` Map in `queryDriftTypes` groups by language; `lang === 'unknown'` guard at server.js:867; cross-language test passes |
| 7  | `drift_types` caps at 50 type names per repo | VERIFIED | `const cap = 50` at server.js:697; checked in `extractTypeNames` for all four languages |
| 8  | `drift_types` returns `{ findings: [], repos_scanned: 0 }` when db is null | VERIFIED | Same `getDriftRepos` null-guard path; test passes |
| 9  | The `drift_types` tool is registered via `server.tool()` | VERIFIED | `server.tool("drift_types", ...)` at server.js:1386-1403 |
| 10 | An agent calling `drift_openapi` receives an informational message when oasdiff is not installed — tool never crashes | VERIFIED | `compareOpenApiSpecs` outer try/catch returns INFO finding at server.js:319-326; test shape checks pass |
| 11 | `drift_openapi` returns `{ findings: [], repos_scanned: 0, tool_available: false }` when fewer than 2 repos have OpenAPI specs | VERIFIED | Early return at server.js:1078-1080; test passes at server-drift.test.js:428 |
| 12 | `drift_openapi` uses execSync with 5-second timeout to prevent MCP server hangs | VERIFIED | `timeout: 5000` present at server.js:980 and server.js:1010 (both oasdiff calls) |
| 13 | `drift_openapi` finds spec files at well-known paths using `OPENAPI_CANDIDATES` | VERIFIED | `const OPENAPI_CANDIDATES` at server.js:930-942 (12 paths); `findOpenApiSpec` at server.js:944 |
| 14 | The `drift_openapi` tool is registered via `server.tool()` with pairwise/hub-and-spoke logic | VERIFIED | `server.tool("drift_openapi", ...)` at server.js:1406-1423; pairwise N<=5 at server.js:1102, hub-and-spoke N>5 at server.js:1110 |

**Score:** 14/14 truths verified

---

## Required Artifacts

| Artifact | Expected | Status | Details |
|----------|----------|--------|---------|
| `worker/mcp/server.js` | `queryDriftVersions` export + `drift_versions` tool registration | VERIFIED | Export at line 581; registration at lines 1366-1383 |
| `worker/mcp/server.js` | `queryDriftTypes` export + `drift_types` tool registration | VERIFIED | Export at line 855; registration at lines 1386-1403 |
| `worker/mcp/server.js` | `queryDriftOpenapi` export + `drift_openapi` tool registration | VERIFIED | Export at line 1054; registration at lines 1406-1423 |
| `worker/mcp/server-drift.test.js` | Test scaffold with `createDriftTestDb`, `createTempRepo`, 19 tests | VERIFIED | File has 19 `test()` calls; both helpers present at lines 30-81 |

---

## Key Link Verification

| From | To | Via | Status | Details |
|------|----|-----|--------|---------|
| `server.tool('drift_versions')` handler | `queryDriftVersions(qe?._db ?? null, params)` | `resolveDb(params.project)` pattern | WIRED | server.js:1376-1381 — exact pattern match |
| `queryDriftVersions` | `repos` table `SELECT path, name FROM repos` | `getDriftRepos(db)` | WIRED | server.js:460-465 — prepares and calls `.all()` |
| `queryDriftTypes` | `services` table (via language grouping) | `detectRepoLanguage` filesystem detection | WIRED | `detectRepoLanguage` at server.js:653; language groups built at server.js:860-878 |
| `queryDriftTypes` | Filesystem file scanning per language | `collectFiles` + `extractTypeNames`/`extractTypeBody` | WIRED | `collectFiles` at server.js:668; `extractTypeNames` at server.js:695 |
| `queryDriftOpenapi` | `execSync('oasdiff breaking ...')` | `try/catch` with 5s timeout | WIRED | `compareOpenApiSpecs` at server.js:967; `execSync` with `timeout: 5000` at lines 980 and 1010 |
| `queryDriftOpenapi` | `findOpenApiSpec(repoPath)` | `OPENAPI_CANDIDATES` fast path + `collectFiles` fallback | WIRED | `OPENAPI_CANDIDATES` at server.js:930; `findOpenApiSpec` at server.js:944 |

---

## Requirements Coverage

| Requirement | Source Plan | Description | Status | Evidence |
|-------------|------------|-------------|--------|---------|
| MCP-01 | 48-01-PLAN.md | Add `drift_versions` MCP tool — query dependency version mismatches across scanned repos | SATISFIED | `export async function queryDriftVersions` at server.js:581; `server.tool("drift_versions")` at server.js:1367; 7 tests pass |
| MCP-02 | 48-02-PLAN.md | Add `drift_types` MCP tool — query shared type/struct/interface mismatches across repos | SATISFIED | `export async function queryDriftTypes` at server.js:855; `server.tool("drift_types")` at server.js:1387; 6 tests pass |
| MCP-03 | 48-03-PLAN.md | Add `drift_openapi` MCP tool — query OpenAPI spec breaking changes across repos | SATISFIED | `export async function queryDriftOpenapi` at server.js:1054; `server.tool("drift_openapi")` at server.js:1407; 6 tests pass |

No orphaned requirements — all three MCP-0x IDs were claimed by a plan and all have verified implementations.

---

## Anti-Patterns Found

None. Scanned `worker/mcp/server.js` and `worker/mcp/server-drift.test.js` for TODO/FIXME/PLACEHOLDER comments, empty return stubs, console.log-only handlers, and unimplemented exports. No issues found.

---

## Test Run Results

Full test run via `timeout 60 node --test worker/mcp/server-drift.test.js`:

- queryDriftVersions: 7/7 tests pass (null-db, CRITICAL, WARN, INFO, repos_scanned, severity filter, no-manifest)
- queryDriftTypes: 6/6 tests pass (null-db, CRITICAL diff, INFO match, cross-language suppression, repos_scanned, severity filter)
- queryDriftOpenapi: 6/6 tests pass (null-db, single-spec, no-specs, two-specs shape, repos_scanned, tool_available boolean)
- Total: 19/19 passing

The test runner is interrupted after tests complete — this is a pre-existing behavior from `await server.connect(transport)` at module level, not a test failure. All 19 assertions pass before the hang.

---

## Human Verification Required

None. All behaviors are programmatically verifiable:
- Tool registration verified by grepping `server.tool()` calls
- Query logic verified by the passing test suite
- Severity filtering verified by dedicated tests
- Graceful degradation (oasdiff absent) verified by tests that check `tool_available` boolean and `findings` array shape

---

## Gaps Summary

None. All 14 must-have truths verified, all 3 requirements satisfied, all key links wired, no anti-patterns detected, 19/19 tests pass.

---

_Verified: 2026-03-20T21:00:00Z_
_Verifier: Claude (gsd-verifier)_
