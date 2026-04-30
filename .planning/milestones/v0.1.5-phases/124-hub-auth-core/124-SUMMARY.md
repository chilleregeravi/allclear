---
phase: 124
plan: 124
subsystem: worker.hub-sync + worker.scan.manager + worker.cli
tags: [auth, hub-sync, x-org-id, whoami, personal-credentials, the-1029, the-1030]
requires:
  - REQUIREMENTS.md AUTH-01..AUTH-05
  - PREDECESSOR-SURFACE.md (C1, C2, C3, X1 mitigations)
  - 124-PLAN.md (single plan, 6 sequential tasks)
  - hub-side arcanon-hub THE-1030 deploy (for live e2e — Phase 127)
provides:
  - "uploadScan sends X-Org-Id header; missing orgId throws HubError(code='missing_org_id') BEFORE network call"
  - "New whoami client (worker/hub-sync/whoami.js) calls GET /api/v1/auth/whoami → { user_id, key_id, scopes, grants }"
  - "resolveCredentials() returns { apiKey, hubUrl, orgId, source } with precedence opts → env → home-config"
  - "resolveCredentials({ orgIdRequired: false }) opt-out for non-upload callers (doctor check 8)"
  - "storeCredentials() persists default_org_id alongside api_key + hub_url; spread-merge preserves unrelated keys; mode 0600"
  - "manager.js _readHubConfig threads per-repo cfg.hub.org_id into syncFindings"
  - "Drafted v0.1.5 CHANGELOG ### BREAKING entry (124-CHANGELOG-DRAFT.md, picked up verbatim by Phase 127)"
affects:
  - "Every uploadScan call site — orgId is now required (or fails fast)"
  - "Doctor check 8 (NAV-03) — uses orgIdRequired:false to round-trip without an org_id"
  - "Existing v0.1.4 users on upgrade — first /arcanon:sync fails until /arcanon:login is re-run with --org-id"
tech-stack:
  added: []
  patterns:
    - "Personal-credential model: one key, one default_org_id, multi-org via grants list (THE-1030 server-side)"
    - "Tolerant hasCredentials, strict resolveCredentials (C2 option a) — auto-sync gate stays open; user sees actionable AuthError on next manager.js:983 WARN log"
    - "orgIdRequired opt-out for callers that only need apiKey + hubUrl"
key-files:
  created:
    - "plugins/arcanon/worker/hub-sync/whoami.js"
    - ".planning/phases/124-hub-auth-core/124-CHANGELOG-DRAFT.md"
  modified:
    - "plugins/arcanon/worker/hub-sync/auth.js (resolveCredentials shape + storeCredentials default_org_id + orgIdRequired opt-out)"
    - "plugins/arcanon/worker/hub-sync/client.js (uploadScan X-Org-Id header + missing-orgId fail-fast)"
    - "plugins/arcanon/worker/hub-sync/index.js (call sites read creds.orgId)"
    - "plugins/arcanon/worker/scan/manager.js (X1: thread cfg.hub.org_id through to syncFindings)"
    - "plugins/arcanon/worker/cli/hub.js (doctor check 8 uses orgIdRequired:false)"
    - "plugins/arcanon/worker/hub-sync/auth.test.js (extended for AUTH-03/04 + S2 spread-merge regression test)"
decisions:
  - "C2 — option (a): resolveCredentials throws on missing org_id, but hasCredentials() stays org_id-tolerant so HUB-01 auto-sync gate doesn't silently turn OFF on upgrade. User sees the actionable AuthError via existing manager.js:983 WARN."
  - "Doctor check 8 is the only non-upload caller that read all of resolveCredentials's return — opt-out via orgIdRequired:false is cleaner than a separate resolveApiKey export"
  - "C3 — spread-merge regression test pinned: writing api_key over {api_key, hub_url, default_org_id} preserves all three"
  - "X1 — manager.js threading verified: existing manager.test.js fixtures pass with additive orgId field"
metrics:
  duration_minutes: ~80 (executor session) + ~15 (inline finalization)
  completed_date: 2026-04-28
  tasks_total: 6 (single plan, 6 sequential commits) + 1 regression fix + 1 SUMMARY
  files_created: 2
  files_modified: 6
  commits: 7 (6 atomic feature commits + 1 regression fix)
---

# Phase 124: Hub Auth Core Summary

Landed the coupled signature/contract block that adopts the hub's new personal-credential auth model. Every scan upload now carries `X-Org-Id`, the plugin discovers a sensible default at login via `whoami`, and per-repo overrides cascade through the manager. Hard-blocked on hub-side arcanon-hub THE-1030 for live e2e — but all 6 commits land locally because the contract is mock-tested via `fakeFetch`.

## Per-Task Commits

| # | Task | REQ | Commit |
|---|------|-----|--------|
| 1 | resolveCredentials precedence chain (opts → env → home-config) | AUTH-03 | `554d487` |
| 2 | uploadScan sends X-Org-Id; missing orgId throws before fetch | AUTH-01 | `330ddc8` |
| 3 | storeCredentials persists default_org_id with spread-merge | AUTH-04 | `ede7023` |
| 4 | New whoami.js client | AUTH-02 | `4ab4022` |
| 5 | manager.js threads per-repo cfg.hub.org_id | AUTH-05 | `f3964ed` |
| 6 | Integration test + drafted CHANGELOG BREAKING | (e2e wire) | `94b33ab` |
| — | Doctor check 8 regression fix (orgIdRequired:false opt-out) | — | `e107463` |

## C2 Decision (option a) — Evidenced

`hasCredentials()` stays org_id-tolerant; throw deferred to upload time. Pinned by `auth.test.js` Test A7. The HUB-01 auto-sync gate at `manager.js:941, 949` stays open for users who upgrade with api_key but no default_org_id; their next `/arcanon:sync` fails with the actionable AuthError surfaced via `manager.js:983-986 slog('WARN', 'hub upload failed', …)`. **No silent gating regression.**

## Acceptance Gate

| Suite | Post-Phase-123 baseline | Post-Phase-124 | Delta |
|-------|------------------------|----------------|-------|
| Node (`plugins/arcanon`) | 790/791 | 820/821 | **+30 tests, +0 new failures** |
| Bats (`tests/`) | 458/459 | 458/461 → fixed → 461/461 *(modulo HOK-06)* | **+2 tests, +0 new failures (after fix commit)** |

**Carried failures (unchanged from baseline):**
- Node: `worker/mcp/server-search.test.js:159 — queryScan: returns unavailable when port file does not exist`. Pre-existing v0.1.2 mock issue.
- Bats: `tests/impact-hook.bats:240 — HOK-06 p99 latency` perf flake (load-dependent on dev machine).

## Regression Caught and Fixed Inline

The original Phase 124 executor agent committed all 6 tasks but stalled before writing the SUMMARY and noticed 2 doctor.bats failures it couldn't resolve. Inline finalization caught that:

- **Cause:** AUTH-03's strict `resolveCredentials()` throws `AuthError` when no `default_org_id` is configured. Doctor check 8 calls `resolveCredentials()` directly inside a `try/catch`; on throw, it returned `SKIP` ("no credentials configured") instead of running the round-trip. But the bats fixtures seed `{api_key, hub_url}` only — that's a creds-present-but-no-org-id config, which check 8 should still PASS/WARN on (the round-trip doesn't need X-Org-Id).
- **Fix:** added `{ orgIdRequired: false }` opt to `resolveCredentials()`. When set, it returns `orgId: null` (or best-effort env/config) instead of throwing. Doctor check 8 opts out.
- **Commit:** `e107463`. All 12 doctor.bats tests green.

The opt-out is the right shape because doctor check 8 is the only non-upload caller in the codebase that read all of resolveCredentials's return — every other caller is an upload path that legitimately needs orgId.

## Hub-Side Dependency

THE-1029 plugin work is meaningless until arcanon-hub THE-1030 deploys. The implementation lands locally; live e2e is deferred to Phase 127 Task 4 (human-verify against a real hub). All Phase 124 tests pass against `fakeFetch` so the plugin ships regardless of hub timing — the user gets a clear AuthError if they sync against a hub that doesn't yet enforce X-Org-Id.

## Drafted CHANGELOG (handed to Phase 127)

`.planning/phases/124-hub-auth-core/124-CHANGELOG-DRAFT.md` contains the v0.1.5 ### BREAKING + ### Added entries. Phase 127 (VER-02) pins them verbatim.

## Deviations from 124-PLAN.md

1. **Inline regression fix** — the `orgIdRequired:false` opt-out wasn't in the plan; needed because doctor check 8 was tighter coupled to `resolveCredentials` than the predecessor audit caught (audit noted `manager.js` HUB-01 as the only auto-sync gate; check 8 is a separate non-upload caller). Documented above. Test contract preserved.

2. **Single plan, not the roadmap-estimated 2** — both proposed sub-plans wrote to the same files (auth.js, index.js); splitting forced sequencing anyway with no parallelism gain. Consolidated to 6 sequentially-ordered atomic commits.

## Self-Check: PASSED

- All 5 ROADMAP success criteria met (verify with grep on commit messages).
- C1 ordering: AUTH-03 (`554d487`) precedes AUTH-01 (`330ddc8`) ✓
- C2 surface evidence: `hasCredentials()` returns true when api_key resolves but org_id doesn't (Test A7) ✓
- C3 spread-merge: Test S2 in auth.test.js ✓
- X1 manager threading: Test M4 ✓
- Doctor check 8 fix: 12/12 doctor.bats green ✓
