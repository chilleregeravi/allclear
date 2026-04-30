---
gsd_state_version: 1.0
milestone: v0.1.5
milestone_name: Identity & Privacy
status: executing
stopped_at: Phase 127 (Verification & Release Gate) Tasks 1-3 COMPLETE (commits b27eccc + 4070a8c, SUMMARY at .planning/phases/127-verification-and-release-gate/127-01-SUMMARY.md). Manifests pinned at 0.1.5, CHANGELOG [0.1.5] section drafted, bats 458/459 + node 823/824 green at v0.1.4 flake floors. Task 4 (VER-04 operator e2e walkthrough) BLOCKED pending arcanon-hub THE-1030 deploy — same dependency as deferred Phase 125 T4 checkpoints.
last_updated: "2026-04-30T17:30:00Z"
last_activity: 2026-04-30 -- Phase 127 Tasks 1-3 (VER-01..03) shipped 2 atomic commits inline + SUMMARY; Task 4 BLOCKED on hub-side THE-1030 deploy
progress:
  total_phases: 5
  completed_phases: 4
  total_plans: 5
  completed_plans: 5
  percent: 95
---

# Project State

## Project Reference

See: .planning/PROJECT.md (updated 2026-04-27)

**Core value:** Every edit is automatically formatted and linted, every quality check runs with one command, and breaking changes across repos are caught before they ship.
**Current focus:** v0.1.5 ship gate — awaiting arcanon-hub THE-1030 deploy for the 3 deferred operator e2e walkthroughs

## Current Position

Phase: 127 (Verification & Release Gate) — Tasks 1-3 COMPLETE; Task 4 BLOCKED on hub-side THE-1030
Plan: 1 of 1 (VER-01 manifest bumps ✓, VER-02 CHANGELOG ✓, VER-03 test suites green ✓, VER-04 e2e walkthrough ⛔)
Status: All implementation work landed. v0.1.5 ship blocked on operator e2e walkthrough against THE-1030-honoring hub.
Last activity: 2026-04-30 -- 127-01-SUMMARY.md created; 2 atomic commits in main (b27eccc manifest bump + 4070a8c CHANGELOG)

## Performance Metrics

**Velocity:**

- Total plans completed: 228 (v1.0–v5.8.0 + v0.1.0 + v0.1.1 12 + v0.1.2 9 + v0.1.3 14 + v0.1.4 21)
- Total milestones shipped: 23 (Ligamen v1.0–v5.8.0 + Arcanon v0.1.0 + v0.1.1 + v0.1.2 + v0.1.3 + v0.1.4)

## Accumulated Context

### Cross-Milestone Decisions (durable)

- **Single credential triple in `~/.arcanon/config.json`** (apiKey + hubUrl + default_org_id). No multi-cred map. THE-1030 personal-credential model: one key serves all authorized orgs.
- **`hub.evidence_mode` defaults to `"full"` for back-compat.** `"hash-only"` and `"none"` are opt-in.
- **Shadow-scan namespace at `$ARCANON_DATA_DIR/projects/<hash>/impact-map-shadow.db`** (sibling of `impact-map.db`). Atomic promote = backup + swap, WAL sidecars renamed alongside main DB.
- **`/arcanon:view` ships as a pure markdown command** (no Node handler) per dispatch-precedence constraint. Negative regression test guards against future contributors adding `view: cmdView` to `hub.js HANDLERS`.
- **`ARCANON_TEST_AGENT_RUNNER` env-var stub** in `worker/index.js` is the canonical mechanism for tests that drive scans inside the worker; production never sets it.
- **Live DB reads via fresh better-sqlite3 handle** (NOT through `getQueryEngine` pool) for shadow workflows — going through pool flips `journal_mode` and breaks byte-identity.
- **`evictLiveQueryEngine` clears BOTH the pool.js Map AND the database.js _db singleton** via `_resetDbSingleton` export.
- **Three-value crossing semantics** (external/cross-service/internal) with post-scan reconciliation that downgrades false externals.
- **Externals catalog ships as YAML data**, loader accepts both `entries:` and `externals:` top-level keys, both map and list forms.
- **Pure-bash PreToolUse impact hook** (no Node cold-start). p99 <50ms Linux, ~130ms macOS (BSD fork overhead caveat).

### v0.1.5 Decisions (in-flight, pending validation)

- **Auto-default-org via `whoami` at login** — forcing user to type a UUID is hostile; hub knows which orgs the key is authorized for. ✓ shipped Phase 125 (D-125-02 4×2 branch table).
- **Mask `$HOME` at egress seams, not in DB** — DB needs absolute paths for git operations; masking-at-egress preserves runtime correctness while closing the third-party leak (MCP → Anthropic).
- **THE-1029 ships only after hub-side THE-1030 lands** — brief upload outage between merges accepted (nothing has shipped publicly).
- **Phase 123 (PII) ordered first** — independent of hub-side THE-1030; ships even if the hub PR slips. Phases 124-127 sequenced behind the hub deploy.
- **AUTH-01 + AUTH-03 + AUTH-05 land in one phase (124)** — coupled signature/contract block per predecessor-audit C1+X1; AUTH-02 included in same phase since AUTH-06 depends on it.
- **`hasCredentials()` semantics in C2** — option (a) chosen in Phase 124: tolerates missing org_id; defers throw to upload time so the AuthError lands in scan-end logs verbatim.
- **AUTH-08 server error JSON shape (D-125-01)** — RFC 7807 `{type, title, status, detail, code}` with custom `code` extension. Plugin reads `body.code` first; falls back to `body.title` for forward-compat. 7 codes pinned via frozen `HUB_ERROR_CODE_MESSAGES` in client.js. ✓ shipped Phase 125.
- **D-125-03 nested identity contract** — `/arcanon:status --json` emits identity as nested `identity: {…}` object; existing top-level keys (plugin_version, data_dir, config_file, project_slug, hub_auto_sync, credentials, queue, scan_freshness) unchanged. ✓ shipped Phase 125.
- **CLI exit-code-7 + `__ARCANON_GRANT_PROMPT__` stdout sentinel** — markdown-layer ↔ Node-CLI re-entry pattern for multi-grant AskUserQuestion. Established in Phase 125 cmdLogin; reusable for any future CLI flow that needs human-in-the-loop choice.
- **PII-04 logger seam** — single masking edit at `worker/lib/logger.js:42–68` between `Object.assign` and `JSON.stringify`; NOT 30 call-site edits.
- **PII-03 routes** — REQUIREMENTS.md mentions `/api/repos`; the actual surface is `GET /projects` plus `repos[].path` arrays nested inside `/api/scan-freshness` and `/graph` response bodies. Plan must target the correct routes.

### Pending Todos

- Phase 127 Tasks 1-3 SHIPPED. v0.1.5 ship is gated on a single operator session against a THE-1030-honoring hub instance:
  1. **125-01 Task 4** — Manual login walkthrough (8 e2e steps: auto-select / multi-grant prompt / mismatch warn / AuthError / network error / hub-unreachable refuse).
  2. **125-02 Task 4** — Manual `/arcanon:status` Identity block populated against real grants + docs read-through.
  3. **127-01 Task 4** — VER-04 4-step walkthrough (login round-trip / Identity block / MCP zero-`/Users/` / `/arcanon:sync` with server-side `X-Org-Id` proof via hub admin endpoint, log line, or DB row).
- Run all 3 in a single session — same hub instance covers all of them. Then update each phase's SUMMARY with the operator-confirmed PASS marks and run `/gsd-complete-milestone v0.1.5`.

### Blockers/Concerns

- **THE-1029 hard-blocked by arcanon-hub THE-1030** (server-side personal-credential rewrite + `whoami` endpoint + `X-Org-Id` enforcement). Coordinate merge order so the hub PR lands first. Phase 123 (PII) is independent and can ship before the hub deploy lands.
- macOS HOK-06 hook p99 latency caveat — platform constraint carried over from v0.1.1; CI uses threshold=100, not a regression.

## Deferred Items

Carried forward from v0.1.4 close (2026-04-27):

| Category | Item | Status |
|----------|------|--------|
| uat_gap | Phase 114: 114-UAT.md (7 pending operator scenarios — cold-start, list, view, doctor x4) | testing |
| checkpoint_deferred | Phase 125 / Plan 125-01 Task 4: Manual login walkthrough (8 e2e steps against deployed hub) | pending THE-1030 deploy |
| checkpoint_deferred | Phase 125 / Plan 125-02 Task 4: Manual /arcanon:status Identity block + docs read-through | pending THE-1030 deploy |
| checkpoint_deferred | Phase 127 / Plan 127-01 Task 4: VER-04 4-step e2e walkthrough (login + status + MCP zero-/Users/ + /arcanon:sync server-side X-Org-Id proof) | pending THE-1030 deploy — v0.1.5 ship blocker |

The Phase 114 entries are operator-facing manual scenarios — phase 114 automated VERIFICATION.md is `passed` (31/31 bats green); the UAT is the operator's own "feels-right" gate, not a release blocker. Run them in a real terminal at your convenience and update `114-UAT.md` results in place.

The Phase 125 deferred checkpoints are pre-approved deferrals (per executor 2026-04-28 session): the manual e2e walkthroughs require arcanon-hub THE-1030 deployed against the dev hub for the whoami round-trips to produce real grants. All per-task `<automated>` smoke verifies passed before deferral. Phase 127 (Release Gate) plan owner must re-run them before v0.1.5 final ship.

## Session Continuity

Last session: 2026-04-30T17:30:00Z
Stopped at: Phase 127 (Verification & Release Gate) Tasks 1-3 (VER-01..03) COMPLETE — manifests pinned at 0.1.5 (commit b27eccc, lockfile regenerated), CHANGELOG [0.1.5] section drafted with BREAKING/Added/Changed (commit 4070a8c), bats 458/459 + node 823/824 green at v0.1.4 flake floors with no new pre-existing-mock carryforwards. Task 4 (VER-04 operator e2e walkthrough) BLOCKED on arcanon-hub THE-1030 deploy — bundles with the 2 deferred Phase 125 checkpoints.
Resume file: .planning/phases/127-verification-and-release-gate/127-01-SUMMARY.md (defer-list at the bottom) → run all 3 walkthroughs in a single operator session once THE-1030 lands, then `/gsd-complete-milestone v0.1.5`.
