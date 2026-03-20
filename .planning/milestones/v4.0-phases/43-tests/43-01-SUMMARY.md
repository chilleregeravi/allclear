---
phase: 43-tests
plan: 01
subsystem: tests
tags: [rename, ligamen, bats, js-tests, fixtures]
dependency_graph:
  requires: [phase-40-env-vars, phase-42-source-rename]
  provides: [ligamen-renamed-test-suite]
  affects: [tests/*, worker/**/*.test.js, tests/fixtures/]
tech_stack:
  patterns: [bats-core, node:test, exact-string-replacement]
key_files:
  modified:
    - tests/config.bats
    - tests/session-start.bats
    - tests/worker-lifecycle.bats
    - tests/worker-index.bats
    - tests/file-guard.bats
    - tests/mcp-server.bats
    - tests/lint.bats
    - tests/siblings.bats
    - tests/drift-versions.bats
    - tests/integration/impact-flow.bats
    - tests/storage/query-engine.test.js
    - tests/storage/query-engine-upsert.test.js
    - tests/storage/api-surface.test.js
    - tests/storage/migration-007.test.js
    - tests/storage/scan-version-bracket.test.js
    - tests/worker/scan-bracket.test.js
    - worker/db/database.test.js
    - worker/db/migrations.test.js
    - worker/db/pool-repo.test.js
    - worker/db/query-engine-enrich.test.js
    - worker/db/query-engine-search.test.js
    - worker/db/snapshot.test.js
    - worker/scan/discovery.test.js
    - worker/scan/manager.test.js
    - worker/server/http.test.js
  created:
    - tests/fixtures/config/ligamen.config.json
  deleted:
    - tests/fixtures/config/allclear.config.json
decisions:
  - ALLCLEAR_CHROMA_MODE renamed to LIGAMEN_CHROMA_MODE in INTG-E2E-06 test (matches phase-40 env var rename)
  - test@allclear git email left unchanged (identity, not brand)
  - AllClear Test git user.name left unchanged (test infrastructure identity)
metrics:
  completed: "2026-03-19"
  tasks: 5
  files: 26
---

# Phase 43 Plan 01: Tests Rename — AllClear to Ligamen Summary

All 10 bats test files, 15 JavaScript test files, and the test fixture config file have been updated to use ligamen naming throughout.

## What Was Done

### Plan 01 — Bats Tests (10 files)

**Task 1: Core bats files (6 files)**

| File | Changes |
|------|---------|
| tests/config.bats | `_ALLCLEAR_CONFIG_LOADED` → `_LIGAMEN_CONFIG_LOADED`, `ALLCLEAR_CONFIG_FILE` → `LIGAMEN_CONFIG_FILE`, `ALLCLEAR_CONFIG_LINKED_REPOS` → `LIGAMEN_CONFIG_LINKED_REPOS`, `ALLCLEAR_DISABLE_FORMAT/LINT/GUARD` → `LIGAMEN_*`, `ALLCLEAR_LINT_THROTTLE` → `LIGAMEN_LINT_THROTTLE`, `ALLCLEAR_EXTRA_BLOCKED` → `LIGAMEN_EXTRA_BLOCKED`, `allclear.config.json` → `ligamen.config.json`, header comment updated |
| tests/worker-lifecycle.bats | `ALLCLEAR_DATA_DIR` → `LIGAMEN_DATA_DIR`, `ALLCLEAR_WORKER_PORT` → `LIGAMEN_WORKER_PORT`, header comment updated |
| tests/worker-index.bats | `ALLCLEAR_DATA_DIR` → `LIGAMEN_DATA_DIR`, `ALLCLEAR_WORKER_PORT` → `LIGAMEN_WORKER_PORT`, `ALLCLEAR_LOG_LEVEL` → `LIGAMEN_LOG_LEVEL` |
| tests/mcp-server.bats | Header `AllClear →` Ligamen, `ALLCLEAR_DB_PATH` → `LIGAMEN_DB_PATH`, `.allclear/nonexistent-test.db` → `.ligamen/nonexistent-test.db` |
| tests/lint.bats | Header updated, `/tmp/allclear_clippy_*` → `/tmp/ligamen_clippy_*` |
| tests/drift-versions.bats | `allclear.config.json` → `ligamen.config.json` in fake config creation |

**Task 2: Assertion + command ref bats files (4 files)**

| File | Changes |
|------|---------|
| tests/session-start.bats | `ALLCLEAR_DISABLE_SESSION_START` → `LIGAMEN_DISABLE_SESSION_START`, `/tmp/allclear_session_` → `/tmp/ligamen_session_`, `/tmp/allclear_test_worker_started_` → `/tmp/ligamen_test_worker_started_`, all `allclear.config.json` → `ligamen.config.json`, `AllClear active.` → `Ligamen active.`, `/allclear:quality-gate` → `/ligamen:quality-gate`, `AllClear active` → `Ligamen active`, `AllClear worker:` → `Ligamen worker:`, test name updated |
| tests/file-guard.bats | Header updated, denial message comment updated, test name updated, `assert_output --partial "AllClear"` → `"Ligamen"` (both occurrences), `ALLCLEAR_DISABLE_GUARD` → `LIGAMEN_DISABLE_GUARD` |
| tests/siblings.bats | Header updated, test name updated, `allclear.config.json` → `ligamen.config.json` |
| tests/integration/impact-flow.bats | `/tmp/allclear_test_intg_worker_started` → `/tmp/ligamen_test_intg_worker_started`, `/tmp/allclear_test_intg_worker_no_impact_map` → `/tmp/ligamen_test_intg_worker_no_impact_map`, all `allclear.config.json` → `ligamen.config.json`, `/tmp/allclear_session_intg-` → `/tmp/ligamen_session_intg-`, `allclear-intg-e2e-05-` → `ligamen-intg-e2e-05-`, `AllClear worker:` → `Ligamen worker:`, `ALLCLEAR_CHROMA_MODE` → `LIGAMEN_CHROMA_MODE` in INTG-E2E-06 |

### Plan 02 — JavaScript Tests (15 files)

| File | Changes |
|------|---------|
| tests/storage/query-engine.test.js | `allclear-test-` → `ligamen-test-` (2 occurrences) |
| tests/storage/query-engine-upsert.test.js | `allclear-upsert-test-` → `ligamen-upsert-test-` |
| tests/storage/api-surface.test.js | `allclear-test-` → `ligamen-test-` (2 occurrences) |
| tests/storage/migration-007.test.js | `allclear-test-` → `ligamen-test-` |
| tests/storage/scan-version-bracket.test.js | `allclear-svb-` → `ligamen-svb-` |
| tests/worker/scan-bracket.test.js | `allclear-bracket-test-` → `ligamen-bracket-test-` |
| worker/db/database.test.js | `allclear-test-` → `ligamen-test-`, `".allclear"` → `".ligamen"` in home dir path |
| worker/db/migrations.test.js | `allclear-schema-test-` → `ligamen-schema-test-` |
| worker/db/pool-repo.test.js | `allclear-test-` → `ligamen-test-` (4 occurrences) |
| worker/db/query-engine-enrich.test.js | `allclear-enrich-test-` → `ligamen-enrich-test-`, comment updated, `allclear.config.json` → `ligamen.config.json` |
| worker/db/query-engine-search.test.js | `allclear-search-test-` → `ligamen-search-test-`, `".allclear"` → `".ligamen"` in homedir path |
| worker/db/snapshot.test.js | `allclear-snap-test-` → `ligamen-snap-test-`, `allclear-snap-test2-` → `ligamen-snap-test2-`, `allclear-retention-test-` → `ligamen-retention-test-` |
| worker/scan/discovery.test.js | `allclear-test-` → `ligamen-test-`, all `allclear.config.json` → `ligamen.config.json` (8 occurrences including test descriptions) |
| worker/scan/manager.test.js | `allclear-test-` → `ligamen-test-`, `allclear-nogit-` → `ligamen-nogit-` |
| worker/server/http.test.js | `allclear-test-` → `ligamen-test-` (3 occurrences), `/allclear:map` → `/ligamen:map` in error message assertion |

### Plan 03 — Fixtures (1 file)

- `tests/fixtures/config/allclear.config.json` deleted
- `tests/fixtures/config/ligamen.config.json` created with identical content: `{"linked-repos": ["../api", "../ui", "/opt/repos/sdk"]}`

## Verification Results

```
ALLCLEAR_ env vars in plan bats files:   0
AllClear brand strings in plan bats:     0
/tmp/allclear_ temp paths in bats:       0
allclear.config.json refs in bats:       0
allclear refs in JS test files:          0
tests/fixtures/config/allclear.config.json: absent
tests/fixtures/config/ligamen.config.json: present
```

## Deviations from Plan

None — plan executed exactly as written.

## Self-Check: PASSED

All renamed files verified against `grep -c` acceptance criteria. Old fixture absent, new fixture present with correct content.
