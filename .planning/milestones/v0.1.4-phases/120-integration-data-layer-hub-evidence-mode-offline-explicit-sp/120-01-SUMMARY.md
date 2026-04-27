---
phase: 120-integration-data-layer-hub-evidence-mode-offline-explicit-sp
plan: 01
subsystem: hub-sync
tags: [INT-01, INT-03, hub.evidence_mode, payload-v1.2, byte-identical-regression, evidence-location]
requires:
  - HUB-04 (existing schemaVersion derivation in payload.js)
  - TRUST-01 (existing computeVerdict line-derivation algorithm in http.js)
provides:
  - extractEvidenceLocation (single source of truth for evidence-line semantics)
  - hub.evidence_mode config flag (full | hash-only | none)
  - ScanPayloadV1 envelope v1.2 (gates new evidence shape)
  - cmdUpload + loadLatestFindings extension (SELECT now projects evidence/confidence/source_file)
affects:
  - plugins/arcanon/worker/hub-sync/payload.js (state machine extended)
  - plugins/arcanon/worker/server/http.js (computeVerdict delegates to helper)
  - plugins/arcanon/worker/cli/hub.js (cmdUpload + loadLatestFindings)
  - plugins/arcanon/worker/hub-sync/index.js (syncFindings JSDoc)
tech-stack:
  added: []
  patterns:
    - "Pure helper carve-out for shared algorithm (RESEARCH §1 decision: extract before duplicate)"
    - "Spread-omit projection (HUB-05 byte-identical contract preservation)"
    - "Try/catch column-existence fallback for pre-migration schemas"
key-files:
  created:
    - plugins/arcanon/worker/hub-sync/evidence-location.js
    - plugins/arcanon/worker/hub-sync/evidence-location.test.js
    - plugins/arcanon/worker/cli/hub.evidence-mode.test.js
    - plugins/arcanon/tests/fixtures/integration/evidence-mode/source.js
    - plugins/arcanon/tests/fixtures/integration/evidence-mode/arcanon.config.full.json
    - plugins/arcanon/tests/fixtures/integration/evidence-mode/arcanon.config.hash-only.json
    - plugins/arcanon/tests/fixtures/integration/evidence-mode/arcanon.config.none.json
    - plugins/arcanon/tests/fixtures/integration/evidence-mode/build-payload.mjs
    - tests/hub-evidence-mode.bats
  modified:
    - plugins/arcanon/worker/hub-sync/payload.js
    - plugins/arcanon/worker/hub-sync/payload.test.js
    - plugins/arcanon/worker/hub-sync/index.js
    - plugins/arcanon/worker/server/http.js
    - plugins/arcanon/worker/cli/hub.js
decisions:
  - "Hash-only mode reuses computeVerdict's line-derivation algorithm (RESEARCH §1 decision A) — extracted into a pure helper before adoption to keep one source of truth across verify + payload-build"
  - "Default evidenceMode = 'full' so every existing user is byte-identical to pre-Phase-120 output (Tests M10 + M11 lock the contract)"
  - "Unknown evidenceMode warns once and falls back to 'full' (does not throw) — a typo in arcanon.config.json must not break uploads"
  - "Schema-version state machine bumps to v1.2 only when (hash-only OR none); v1.0/v1.1 paths preserved exactly for full mode"
  - "loadLatestFindings SELECT extension fixes a structural no-op: prior to Phase 120 the column was never read so the flag would have had nothing to operate on (RESEARCH §1 surprise)"
metrics:
  tasks: 4
  duration: ~50 minutes
  commits:
    - 387f715 (Task 1)
    - b08f4cd (Task 2)
    - a11616e (Task 3)
    - 9d30be0 (Task 4)
  tests-added: 24
  files-changed: 14
completed: 2026-04-25
---

# Phase 120 Plan 01: hub.evidence_mode + v1.2 envelope (INT-01 + INT-03) Summary

One-liner: Land the `hub.evidence_mode` flag end-to-end with a v1.2 payload envelope that gates the new shape, byte-identical for every existing caller, plus a pure `extractEvidenceLocation` helper shared with `/arcanon:verify`.

## What changed

**1. New pure helper — `worker/hub-sync/evidence-location.js`**

A single-responsibility module with one exported function `extractEvidenceLocation(evidence, sourceFile, projectRoot)` returning `{hash, start_line, end_line, evidence_present}`. Hashes via SHA-256 over the trimmed evidence; locates lines by `indexOf` + newline-counting (1-indexed). Returns the all-null sentinel for empty/whitespace input; returns hash-only when the source file is missing or the snippet has moved. Pure function — no DB, no network, one file read max per call.

**2. computeVerdict refactor — `worker/server/http.js`**

`computeVerdict()` now delegates hash + line derivation to the new helper. The moved-vs-missing distinction the verify command needs is preserved by keeping the existing `existsSync`/`readFileSync` blocks ahead of the helper call (the helper conflates "file unreadable" and "snippet not in file" as `evidence_present: false`). All 13 existing http.verify.test.js cases stay green — zero regression on the TRUST-01 contract.

**3. payload.js state-machine extension — `worker/hub-sync/payload.js`**

- New exported enum `ALLOWED_EVIDENCE_MODES = Object.freeze(["full", "hash-only", "none"])`.
- `buildFindingsBlock` and `buildScanPayload` accept `evidenceMode` + `projectRoot` opts. Default `evidenceMode = "full"`.
- New private `projectEvidence()` helper centralizes per-mode emission:
  - `full` → `{evidence: <string>}` (legacy)
  - `hash-only` → `{evidence: {hash, start_line, end_line}}` via `extractEvidenceLocation`
  - `none` → `{}` (key omitted)
  - Falsy `c.evidence` → `{}` in every mode (HUB-05 byte-identical preservation)
- Schema version derivation:
  - `(full, *)` → `"1.0"` or `"1.1"` per existing `libraryDepsEnabled` logic
  - `(hash-only, *)` → `"1.2"`
  - `(none, *)` → `"1.2"`
- Unknown `evidenceMode` warns once via `console.warn` and falls back to `"full"`.

**4. cmdUpload + loadLatestFindings wiring — `worker/cli/hub.js`**

- `loadLatestFindings()` SELECT now projects `c.evidence`, `c.confidence`, `c.source_file` so the new flag has data to operate on. Try/catch fallback for pre-migration-009 DBs back-fills nulls.
- `cmdUpload()` reads `cfg?.hub?.evidence_mode` (default `"full"`) and forwards as `evidenceMode` + `projectRoot=repoPath` into `syncFindings`.
- `syncFindings` already passes opts directly to `buildScanPayload`, so no destructure changes were needed; only the JSDoc was updated.

**5. bats E2E + fixtures**

Three fixture configs (full / hash-only / none) under `plugins/arcanon/tests/fixtures/integration/evidence-mode/`, plus a `source.js` whose line 1 contains the literal evidence string and a `build-payload.mjs` driver that constructs an ephemeral git repo per invocation. Four bats `@test` blocks at `tests/hub-evidence-mode.bats` assert per-mode `{version, evidence}` shape end-to-end.

## Decision references

- **Line-number derivation strategy** (RESEARCH §1 decision A) — Reuse `computeVerdict()`'s algorithm at payload-build time rather than emit hash-only with no lines. Implemented via the carved-out `extractEvidenceLocation` helper so verify + payload-build share one source of truth.
- **State machine** (RESEARCH §2) — `(full, *)` keeps `1.0`/`1.1` for back-compat; `(hash-only|none, *)` bumps to `1.2`. v1.0/v1.1 receivers can hard-fail rather than misinterpret a shape change.
- **Byte-identical contract** (RESEARCH §6 + plan pre-flight) — `evidenceMode="full"` MUST be byte-identical to omitted-mode for every input. Locked by Tests M10 (v1.0) and M11 (v1.1, load-bearing).

## Test summary

24 new tests added; 0 regressions across 6 verified suites:

| Suite | New tests | Total | Result |
|---|---|---|---|
| `evidence-location.test.js` | 9 | 9 | green |
| `payload.test.js` | 12 (M1-M11 + ALLOWED_EVIDENCE_MODES) | 34 | green |
| `hub.evidence-mode.test.js` | 1 | 1 | green |
| `http.verify.test.js` | 0 | 13 | green (zero regression after computeVerdict refactor) |
| `tests/hub-evidence-mode.bats` | 4 | 4 | green |
| Full bats `tests/` | — | 429 | 428 pass / 1 pre-existing macOS HOK-06 latency caveat (documented baseline) |

The most important assertion in this plan is **Test M11** at `payload.test.js`: for the same input findings with `libraryDepsEnabled: true` and populated deps, `JSON.stringify(buildScanPayload({evidenceMode:"full", ...}).payload) === JSON.stringify(buildScanPayload({...}).payload)` — proves zero drift for every existing v1.1 user.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Fixed pre-existing broken `c.target_name` reference in loadLatestFindings SELECT**

- **Found during:** Task 3 — when running the new wiring test against a freshly seeded DB.
- **Issue:** The pre-existing query at hub.js loadLatestFindings referenced `c.target_name`, but no such column exists on the `connections` table (no migration adds it; introduced as a typo in commit eaaf097, the v6.0.0 rebrand). At runtime any upload would have failed with `SQLITE_ERROR: no such column: c.target_name`. The plan's Task 3 contract was to extend this exact SELECT, so fixing the broken column reference within the SELECT was in-scope under "issues directly caused by the current task's changes" reading the surrounding code.
- **Fix:** Replaced `c.target_name AS target` with `LEFT JOIN services tgt ON tgt.id = c.target_service_id` + `tgt.name AS target`, mirroring the canonical pattern in `worker/diff/scan-version-diff.js loadConnections`. LEFT JOIN because external targets have null `target_service_id`. Also applied to the column-missing fallback branch.
- **Files modified:** `plugins/arcanon/worker/cli/hub.js`
- **Commit:** a11616e

### Scope Adjustments

**1. Dropped one prototyped wiring test (loadLatestFindings → buildScanPayload(hash-only) end-to-end)**

- **Reason:** `worker/db/database.js openDb()` is a module-level singleton (`if (_db) return _db;`). Once the first test in the file claimed the singleton, subsequent tests with a different `projectRoot` read the cached singleton and could not see their seeded rows.
- **Mitigation:** The dropped chain is fully covered by `payload.test.js M4` (assertion that `buildScanPayload({evidenceMode:"hash-only", ...})` emits `{hash, start_line, end_line}` against a real on-disk source file) and by the bats E2E in Task 4 (which spawns a fresh node subprocess per fixture, sidestepping the singleton).
- **Documented in-file** in `hub.evidence-mode.test.js`.

## Hub coordination status

The plan's "open follow-ups" called for confirming with the hub team that v1.0/v1.1 receivers tolerate the v1.2 envelope. Out-of-scope for this executor (no hub-team comms channel from this codebase). Recorded as a Phase 121 follow-up below.

## Open follow-ups for Phase 121

1. **Hub-side adoption of the v1.2 envelope** — server-side acceptance of the `{hash, start_line, end_line}` evidence shape; matching changes to `arcanon-hub/packages/api-server` Pydantic validators; documentation update for receiver tolerance.
2. **Persist line numbers at scan time** — add `connections.line_start` / `line_end` columns (migration 018+) so verify + payload-build can read them instead of recomputing from disk on every upload. The current "re-read source file at upload time" path is acceptable (~100 file reads per scan, OS-cached) but persistence is the right long-term shape. Separate ticket — not required by INT-01.
3. **Hub team coordination on header-level schema negotiation** — if v1.0/v1.1 receivers DO NOT tolerate the unknown `evidence` shape (TBD pending confirmation), introduce an `Arcanon-Plugin-Schema-Version: 1.2` header for content negotiation. Defer to v0.1.4 unless the receiver issue surfaces in CI.

## Self-Check: PASSED

- Helper module exists: FOUND `plugins/arcanon/worker/hub-sync/evidence-location.js`
- Helper test exists: FOUND `plugins/arcanon/worker/hub-sync/evidence-location.test.js`
- payload.js patched: FOUND `ALLOWED_EVIDENCE_MODES` export + `projectEvidence` private helper
- hub.js patched: FOUND `evidence_mode` read in cmdUpload + extended SELECT in loadLatestFindings
- http.js patched: FOUND `extractEvidenceLocation` import + delegation in computeVerdict
- bats fixtures + driver: FOUND all 5 files under `plugins/arcanon/tests/fixtures/integration/evidence-mode/`
- bats test: FOUND `tests/hub-evidence-mode.bats`
- Commit 387f715 (Task 1): FOUND
- Commit b08f4cd (Task 2): FOUND
- Commit a11616e (Task 3): FOUND
- Commit 9d30be0 (Task 4): FOUND
- All 6 verification suites green (helper / payload / cli / hub-sync / http.verify / bats hub-evidence-mode): VERIFIED
