---
phase: 96-hub-payload-v1-1
plan: "01"
subsystem: hub-sync/payload
tags: [hub-sync, payload, feature-flag, schema-version, HUB-01, HUB-02, HUB-03]

dependency_graph:
  requires:
    - plugins/arcanon/worker/db/query-engine.js (getDependenciesForService — Phase 93-02)
    - plugins/arcanon/worker/hub-sync/index.js (syncFindings — forwards opts to buildScanPayload)
  provides:
    - buildFindingsBlock(findings, opts) with libraryDepsEnabled gate + schemaVersion derivation
    - buildScanPayload with libraryDepsEnabled opt + dynamic version field
    - cmdUpload (cli/hub.js) reads hub.beta_features.library_deps, attaches deps, forwards flag
    - manager.js auto-upload loop reads flag, attaches deps per service, forwards flag
  affects:
    - Phase 96-02 (tests for v1.1 payload shape end-to-end)

tech_stack:
  added: []
  patterns:
    - "opts-object pattern for optional second parameter — buildFindingsBlock(findings, opts={})"
    - "schemaVersion derived inside buildFindingsBlock; consumed by buildScanPayload for payload.version"
    - "anyServiceHasDeps gate — flag=true AND at least one non-empty dep array → v1.1; otherwise v1.0"
    - "Back-fill service ids onto r.findings.services after persistFindings via name→id SELECT"
    - "_readHubConfig() extended to return libraryDepsEnabled alongside existing fields"

key_files:
  created: []
  modified:
    - plugins/arcanon/worker/hub-sync/payload.js
    - plugins/arcanon/worker/hub-sync/payload.test.js
    - plugins/arcanon/worker/cli/hub.js
    - plugins/arcanon/worker/scan/manager.js

decisions:
  - "schemaVersion lives inside buildFindingsBlock return value (not a parameter) — keeps payload.js pure; buildScanPayload reads it from the findings block rather than computing it separately"
  - "anyServiceHasDeps gate: flag=true + all-empty deps → schemaVersion 1.0 fallback, no per-service dependencies keys — existing hub deployments never receive unexpected keys"
  - "Back-fill ids after persistFindings (Edit 4): single SELECT name+id after endScan; avoids threading ids through the agent/findings pipeline"
  - "getDependenciesForService called unconditionally in loadLatestFindings (hub.js) — returns [] gracefully on pre-migration-010 DBs; the flag determines whether payload emits them"
  - "_readHubConfig extended to include libraryDepsEnabled — single config-read point; mirrors existing hubAutoUpload pattern"

metrics:
  duration: "~4 minutes"
  completed: "2026-04-19T16:47:00Z"
  tasks_completed: 2
  files_created: 0
  files_modified: 4
---

# Phase 96 Plan 01: Hub Payload v1.1 — Feature-Flag-Gated Dependencies Summary

**One-liner:** `buildFindingsBlock` gains a `libraryDepsEnabled` opts gate that derives `schemaVersion` and emits per-service `dependencies` only when the flag is on and data exists; both syncFindings callers (cmdUpload + manager.js auto-upload) read `hub.beta_features.library_deps` and attach deps via `getDependenciesForService`.

## What Was Built

Three files modified, zero new files:

### payload.js — Core logic changes

**Before (buildFindingsBlock):**
```javascript
export function buildFindingsBlock(findings) {
  // ... maps services → { name, root_path, language, type, exposes, ... }
  return { services, connections, schemas, actors, warnings };
  // No schemaVersion. No per-service dependencies.
}
```

**After (buildFindingsBlock):**
```javascript
export function buildFindingsBlock(findings, opts = {}) {
  // libraryDepsEnabled gate:
  const libraryDepsEnabled = opts.libraryDepsEnabled === true;
  const anyServiceHasDeps =
    libraryDepsEnabled &&
    services.some((s) => Array.isArray(s.dependencies) && s.dependencies.length > 0);
  const schemaVersion = anyServiceHasDeps ? "1.1" : "1.0";

  return {
    services: services.map((s) => ({
      ...existingFields,
      ...(anyServiceHasDeps
        ? { dependencies: Array.isArray(s.dependencies) ? s.dependencies : [] }
        : {}),
    })),
    ...,
    schemaVersion,   // consumed by buildScanPayload; not forwarded to wire payload directly
    warnings,
  };
}
```

**Before (buildScanPayload):**
```javascript
export function buildScanPayload(opts) {
  const { findings, repoPath, ..., /* no libraryDepsEnabled */ } = opts || {};
  const findingsBlock = buildFindingsBlock(findings);
  const payload = { version: "1.0", ... };   // hardcoded
}
```

**After (buildScanPayload):**
```javascript
export function buildScanPayload(opts) {
  const { findings, repoPath, ..., libraryDepsEnabled = false } = opts || {};
  const findingsBlock = buildFindingsBlock(findings, { libraryDepsEnabled });
  const payload = {
    version: findingsBlock.schemaVersion,   // "1.0" or "1.1" — derived by buildFindingsBlock
    ...
  };
}
```

### cli/hub.js — cmdUpload + loadLatestFindings

- `loadLatestFindings`: SELECT now includes `id`; maps each raw service to `{ ...s, dependencies: qe.getDependenciesForService(s.id) }`. Deps fetch is unconditional — safe because `getDependenciesForService` returns `[]` on pre-migration-010 DBs.
- `cmdUpload`: reads `Boolean(cfg?.hub?.beta_features?.library_deps)` from `readProjectConfig()` and forwards as `libraryDepsEnabled` in the `syncFindings` opts.

### scan/manager.js — _readHubConfig + auto-upload loop + id back-fill

- `_readHubConfig`: extended to return `libraryDepsEnabled: Boolean(cfg?.hub?.beta_features?.library_deps)` (mirrors existing `hubAutoUpload` pattern). Catch-path returns `libraryDepsEnabled: false`.
- Auto-upload loop: destructures `libraryDepsEnabled` from `_readHubConfig()`, attaches `svc.dependencies = queryEngine.getDependenciesForService(svc.id)` per service when `libraryDepsEnabled && typeof svc.id === 'number'`, forwards `libraryDepsEnabled` to `syncFindings`.
- **Edit 4 — id back-fill**: After `persistFindings` + `endScan`, a `SELECT id, name FROM services WHERE repo_id = ?` builds a name→id map and assigns `svc.id` onto each entry in `r.findings.services`. This is required because `persistFindings` builds a `serviceIdMap` internally but does not write ids back onto the findings objects.

## Feature Flag Path and Default

```
arcanon.config.json
└── hub
    └── beta_features
        └── library_deps : boolean   (default: false — absent key → v1.0)
```

Read pattern (both callers):
```javascript
Boolean(cfg?.hub?.beta_features?.library_deps)
```

## Per-Service Dep Attach Points

| Caller | Attach point | Method |
|--------|-------------|--------|
| `cli/hub.js loadLatestFindings` | After services SELECT, before return | `qe.getDependenciesForService(s.id)` |
| `scan/manager.js auto-upload loop` | After id back-fill, before syncFindings | `queryEngine.getDependenciesForService(svc.id)` |

## Services id Field in Findings

- **cli/hub.js**: `loadLatestFindings` SELECT now includes `id` — services carry id naturally.
- **scan/manager.js**: Services in `r.findings` come from the agent/findings pipeline (no DB ids). A back-fill SELECT runs after `persistFindings` + `endScan` to assign `svc.id = nameToId.get(svc.name)` for every service. This is bounded to manager.js and does not change the agent contract or findings.js.

## Scripts Untouched

`git diff plugins/arcanon/scripts/` is empty. HUB-05 shell-output invariant preserved — `/arcanon:drift versions` output is byte-identical to pre-Phase-96.

## Test Results

```
tests 32  pass 32  fail 0

Task 1 tests (18 total — 11 existing backward-compat + 7 new):
  ✔ buildFindingsBlock drops connections whose source is not a known service
  ✔ buildFindingsBlock sets defaults for missing optional fields
  ✔ buildScanPayload requires repoPath
  ✔ buildScanPayload rejects unknown tool names
  ✔ buildScanPayload derives commit_sha from git
  ✔ buildScanPayload requires findings.services to have at least one entry
  ✔ buildScanPayload omits project_slug when not provided
  ✔ buildScanPayload includes project_slug when provided
  ✔ KNOWN_TOOLS matches the server enum
  ✔ serializePayload rejects payloads larger than MAX_PAYLOAD_BYTES
  ✔ serializePayload returns body + byte count under the limit
  ✔ buildFindingsBlock(findings) with no opts returns schemaVersion 1.0 (backward compat)
  ✔ buildFindingsBlock with libraryDepsEnabled=false returns schemaVersion 1.0 and no per-service deps
  ✔ buildFindingsBlock with libraryDepsEnabled=true but all services have empty deps returns schemaVersion 1.0 (flag-on fallback)
  ✔ buildFindingsBlock with libraryDepsEnabled=true and non-empty deps returns schemaVersion 1.1 with per-service dependencies
  ✔ buildScanPayload without libraryDepsEnabled emits version 1.0 (default)
  ✔ buildScanPayload with libraryDepsEnabled=true and non-empty deps emits version 1.1
  ✔ buildScanPayload with libraryDepsEnabled=true but empty deps emits version 1.0 (fallback)

Phase 93-02 regression (14 total):
  ✔ migration 010 — 7 tests
  ✔ QueryEngine dependencies API (DEP-08) — 7 tests
```

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 2 - Missing critical functionality] r.findings.services lacked DB ids**
- **Found during:** Task 2, implementing Edit 3 (auto-upload dep attach)
- **Issue:** `persistFindings` builds a name→id map internally but does not write ids back onto service objects in `r.findings.services`. The dep-attach block checks `typeof svc.id === 'number'` — without ids, every service would silently skip dep-fetching even with the flag on.
- **Fix:** Added Edit 4 (back-fill) after `persistFindings` + `endScan`: single `SELECT id, name FROM services WHERE repo_id = ?`, builds a `Map`, assigns `svc.id` onto each `r.findings.services` entry. Bounded to manager.js; does not touch agent contract or findings.js.
- **Files modified:** `plugins/arcanon/worker/scan/manager.js`
- **Commit:** `1e0bce0`

## Known Stubs

None. All three data paths (payload derivation, cmdUpload flag read, manager.js auto-upload) are fully wired.

## Threat Flags

None. No new network endpoints, auth paths, or external trust boundary changes. The `libraryDepsEnabled` flag is read from the local `arcanon.config.json` (same trust level as existing hub config reads).

## Self-Check: PASSED

- `plugins/arcanon/worker/hub-sync/payload.js` — FOUND
- `plugins/arcanon/worker/hub-sync/payload.test.js` — FOUND
- `plugins/arcanon/worker/cli/hub.js` — FOUND
- `plugins/arcanon/worker/scan/manager.js` — FOUND
- commit `bddc36a` (test RED) — FOUND
- commit `bbc5d85` (feat GREEN Task 1) — FOUND
- commit `1e0bce0` (feat GREEN Task 2) — FOUND
