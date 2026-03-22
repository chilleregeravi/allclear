---
phase: 78-scan-reliability
verified: 2026-03-22T00:00:00Z
status: passed
score: 7/7 must-haves verified
re_verification: false
---

# Phase 78: Scan Reliability Verification Report

**Phase Goal:** Discovery and deep-scan agents run in parallel across repos where possible, failed agents retry once before being skipped with a user-visible warning, and the graph UI filters stale actor data as a defense-in-depth layer
**Verified:** 2026-03-22
**Status:** PASSED
**Re-verification:** No — initial verification

---

## Goal Achievement

### Observable Truths

| # | Truth | Status | Evidence |
|---|-------|--------|----------|
| 1 | Scanning multiple repos invokes agentRunner for all repos concurrently via Promise.allSettled, not sequentially | VERIFIED | `manager.js:606` — `Promise.allSettled(repoPaths.map((rp) => scanOneRepo(rp)))` |
| 2 | When agentRunner throws on first attempt, a single retry is issued before skipping the repo | VERIFIED | `manager.js:556-568` — try/catch wraps agentRunner; inner try/catch retries; double-failure returns `skipped: true` |
| 3 | A skipped repo produces a WARN log naming the repo and does not abort remaining repos | VERIFIED | `manager.js:562-565` — `slog('WARN', 'scan failed after retry — repo skipped', { repoPath, repoName: basename(repoPath), ... })`; Promise.allSettled ensures all repos run |
| 4 | DB writes (persistFindings, endScan, enrichment) remain sequential — only agentRunner calls are parallelized | VERIFIED | `manager.js:622-654` — Phase B is a plain `for...of` over `agentResults`; `persistFindings`, `endScan`, and `runEnrichmentPass` are called inside that loop |
| 5 | An actor whose name exactly matches a known service name is absent from the rendered graph nodes | VERIFIED | `graph.js:111-113` — `state.graphData.actors = state.graphData.actors.filter((actor) => !(actor.name in serviceNameToId))` before synthetic node loop |
| 6 | Connections that would have pointed to a filtered actor are not created — the synthetic edge loop iterates the same filtered list | VERIFIED | `graph.js:134` — edge loop is `for (const actor of state.graphData.actors)` which uses the filtered list |
| 7 | Actors whose names do NOT match any service name still render as normal actor hexagons | VERIFIED | Filter uses `!(actor.name in serviceNameToId)` — actors not in map pass through and are pushed as synthetic nodes normally |

**Score:** 7/7 truths verified

---

### Required Artifacts

| Artifact | Expected | Status | Details |
|----------|----------|--------|---------|
| `plugins/ligamen/worker/scan/manager.js` | Parallel scan orchestration with retry-once logic | VERIFIED | Contains `Promise.allSettled`, `scanOneRepo` helper, retry try/catch, `skipped: true`, Phase A / Phase B structure |
| `plugins/ligamen/worker/scan/manager.test.js` | Tests for parallel execution, retry, and skip-with-warning | VERIFIED | Contains renamed "parallel fan-out" test + 4 new tests in `scanRepos — retry-once on agentRunner failure` describe block; 49/49 pass |
| `plugins/ligamen/worker/ui/graph.js` | Actor dedup filter in loadProject before synthetic node creation | VERIFIED | `serviceNameToId` filter at line 111-113 with SREL-02 comment; `state.graphData.actors` reassigned |
| `tests/ui/graph-actor-dedup.test.js` | Source analysis tests verifying actor dedup filter | VERIFIED | 4 tests all pass; verifies `.filter(`, `serviceNameToId` in filter, double assignment, loop iteration |

---

### Key Link Verification

| From | To | Via | Status | Details |
|------|----|-----|--------|---------|
| `manager.js` | `agentRunner` | `Promise.allSettled` fan-out of per-repo `scanOneRepo` | WIRED | `manager.js:606` fans out via `Promise.allSettled(repoPaths.map((rp) => scanOneRepo(rp)))`; agentRunner called inside `scanOneRepo` at line 555 and 559 (retry) |
| `graph.js` | `serviceNameToId` | actor.name lookup before synthetic node push | WIRED | Filter at lines 111-112 references `serviceNameToId` directly — map populated at lines 58-86 in same scope |

---

### Requirements Coverage

| Requirement | Source Plan | Description | Status | Evidence |
|-------------|-------------|-------------|--------|----------|
| SREL-01 | 78-01-PLAN.md | Discovery agents run in parallel across repos; failed agents retry once then skip with user warning | SATISFIED | `Promise.allSettled` fan-out at `manager.js:606`; retry pattern at lines 556-568; WARN log at 562-565; all 49 manager tests pass |
| SREL-02 | 78-02-PLAN.md | Graph UI filters out actors whose name matches a known service — defense in depth for stale actor data | SATISFIED | Filter at `graph.js:111-113`; SREL-02 comment at line 109; 4 dedup tests pass |

No orphaned requirements: REQUIREMENTS.md maps both SREL-01 and SREL-02 to Phase 78, and both are claimed by plans 78-01 and 78-02 respectively.

---

### Anti-Patterns Found

| File | Line | Pattern | Severity | Impact |
|------|------|---------|----------|--------|
| `tests/ui/graph-fit-to-screen.test.js` | 43, 46 | Stale assertions for `function fitToScreen()` which was inlined into `loadProject()` in Phase 26 | Info | 2 of 6 tests in this file fail; pre-existing since commit `1a7f23f` (2026-03-16), six days before Phase 78; SUMMARY documents it as a deferred item; not caused by Phase 78 changes |

No blocker anti-patterns found. The stale fitToScreen tests are pre-existing and unrelated to the phase goal.

---

### Human Verification Required

None. All goal-critical behaviors are verifiable by source analysis and the test suite.

The following item is informational only:

**Stale fitToScreen tests (pre-existing, deferred)**
- Test: Run `node --test tests/ui/graph-fit-to-screen.test.js`
- Expected: 2 tests currently fail ("fitToScreen() function is defined" and "fitToScreen() calls render() after updating transform")
- Why noted: These tests predate Phase 78 (introduced 2026-03-16, six days before this phase) and were already failing before Phase 78 modified the path. The SUMMARY documents them as deferred cleanup. They are out of scope for this phase's goal.

---

### Gaps Summary

No gaps. All must-haves are verified.

---

## Test Results Summary

**manager.test.js:** 49 pass, 0 fail, 0 skip
- Includes: renamed "agents run via Promise.allSettled — parallel fan-out" test
- Includes: describe block "scanRepos — retry-once on agentRunner failure" with 4 tests:
  - "failed agentRunner retries once then succeeds" — PASS
  - "skipped repo after retry failure — WARN with repo name" — PASS
  - "skipped repo does not abort other repos" — PASS
  - "no retry on parse failure — only on agentRunner throw" — PASS

**graph-actor-dedup.test.js:** 4 pass, 0 fail
- "graph.js filters actors whose name matches a known service" — PASS
- "graph.js filter uses serviceNameToId for known-service lookup" — PASS
- "graph.js assigns filtered actors to state.graphData.actors" — PASS
- "graph.js synthetic node loop iterates state.graphData.actors" — PASS

---

_Verified: 2026-03-22_
_Verifier: Claude (gsd-verifier)_
