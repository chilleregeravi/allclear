---
phase: 114-read-only-navigability-commands-list-view-doctor
plan: 01
subsystem: arcanon-plugin / cli
tags: [nav-01, read-only, command-surface, navigability]
requirements_completed: [NAV-01]
dependency_graph:
  requires:
    - "worker/server/http.js GET /graph + GET /api/scan-quality (existing)"
    - "worker/hub-sync queueStats + resolveCredentials (existing)"
    - "lib/worker-client.sh worker_running + worker_start_background (existing)"
  provides:
    - "lib/worker-client.sh _arcanon_is_project_dir() — sourceable 0/1 project-detection helper (consumed by Plan 114-03)"
    - "worker/db/pool.js projectHashDir export — sha256(cwd)[0:12] resolver (consumed by Plan 114-03)"
    - "worker/cli/hub.js cmdList — registered in HANDLERS, dispatched by /arcanon:list"
  affects:
    - "tests/commands-surface.bats iteration list — extended from 7 to 10 commands; 114-02/03 will append `view` and `doctor` additively"
tech_stack:
  added: []
  patterns:
    - "parallel HTTP fetch with per-request AbortController timeout"
    - "graceful-degradation JSON: null fields rather than omitted keys when an upstream endpoint fails"
key_files:
  created:
    - "plugins/arcanon/commands/list.md (slash-command markdown wrapper)"
    - "tests/list.bats (7-test bats E2E suite, repo-root location)"
    - "plugins/arcanon/tests/fixtures/list/seed.sh (CLI wrapper)"
    - "plugins/arcanon/tests/fixtures/list/seed.js (Node seeder)"
  modified:
    - "plugins/arcanon/lib/worker-client.sh (+_arcanon_is_project_dir helper)"
    - "plugins/arcanon/worker/cli/hub.js (+cmdList handler, +HANDLERS registration, +import projectHashDir)"
    - "plugins/arcanon/worker/db/pool.js (projectHashDir made public via `export`)"
    - "tests/commands-surface.bats (iteration list extended; +allowed-tools regression for list.md)"
    - "plugins/arcanon/CHANGELOG.md (Added entry under [Unreleased])"
decisions:
  - "Repo count via direct sqlite3 SELECT COUNT(*) FROM repos rather than extending GET /graph response — RESEARCH §3 / §7 Q3. One consumer today; if a second arrives later we extend."
  - "_arcanon_is_project_dir returns 0/1 ONLY (no $DB_PATH echo) per NIT 10 — pure predicate; sibling helper if a callsite needs the resolved path."
  - "tests/list.bats lives at the REPO ROOT, mirroring every other bats file in this repo — fixtures stay under plugins/arcanon/tests/fixtures/list/."
  - "tests/commands-surface.bats iteration list extended to all 10 current commands (was 7 — pre-existing gap that missed `verify` and `update`). Per NIT 8."
  - "5s per-request timeout (AbortController) on /graph and /api/scan-quality — same pattern as cmdVerify but slightly more generous since cmdList may be called against a cold worker."
  - "Graceful degradation in --json mode: null fields on upstream failure, never omitted keys. Callers (CI, scripts) can rely on a stable shape."
metrics:
  duration: ~22 minutes (planning → final commit)
  tasks_completed: 2 / 2
  files_created: 4
  files_modified: 5
  tests_added: 7 (list.bats) + 1 (commands-surface.bats allowed-tools regression) = 8 net new
  tests_passing: 14 / 14 (bats tests/list.bats tests/commands-surface.bats)
  completed_date: 2026-04-25
---

# Phase 114 Plan 01: `/arcanon:list` (NAV-01) Summary

`/arcanon:list` ships — a read-only, silent-in-non-Arcanon-directory command that prints the headline numbers of the current project's impact map (repos, services by type, connections by confidence, external actors, hub sync status). Composes from existing worker HTTP endpoints + a single `SELECT COUNT(*) FROM repos`; no schema changes, no DB writes, no new auth surface.

## Goal

Fill the NAV-01 gap: operators currently have no single command that surfaces "what's in this project map" without launching the graph UI. `/arcanon:list` is the foundation of the navigability track of v0.1.4.

## Truths Validated

| Truth | How |
| ----- | --- |
| `/arcanon:list` in a scanned project prints a 5-line overview | Test 5 in `tests/list.bats` — asserts header + Repos + Services + Connections + Actors + Hub lines, with pinned per-type and per-confidence counts. |
| `/arcanon:list` in a non-Arcanon dir produces zero output and exits 0 | Test 4 — `[ -z "$output" ]` + `status -eq 0` after `bash hub.sh list` in a fresh tmp dir. |
| `/arcanon:list --json` emits a single JSON object with the documented fields | Test 6 — round-trips through `jq -e '.repos_count == 3'` plus 9 more field assertions. |
| `/arcanon:list` does not crash when `scan_versions` is empty | Test 7 — `--no-scan` fixture mode; output contains `scanned never` and exit code is 0. |
| `_arcanon_is_project_dir()` is sourceable and returns 0/1 only | Tests 1-3 — happy path, non-project, ARCANON_DATA_DIR override. All assert `[ -z "$output" ]` to enforce NIT 10. |

## Artifacts Created

- **`plugins/arcanon/commands/list.md`** — slash-command markdown wrapper. Sources `lib/worker-client.sh`, bails silently when not a project dir, auto-starts the worker if needed, then `exec`s `bash scripts/hub.sh list $ARGUMENTS`.
- **`plugins/arcanon/worker/cli/hub.js cmdList`** — full composition (parallel `/graph` + `/api/scan-quality` with 5s timeouts, direct sqlite3 repo count, hub status reuse). Registered in `HANDLERS` at hub.js:537.
- **`plugins/arcanon/lib/worker-client.sh _arcanon_is_project_dir()`** — pure 0/1 predicate. Mirrors session-start.sh:104-117 hash-and-stat, with no stdout echo (NIT 10). Consumable by Plan 114-03's `/arcanon:doctor`.
- **`plugins/arcanon/tests/fixtures/list/seed.{sh,js}`** — fixture seeder. Builds 3 repos / 8 services (5 svc, 2 lib, 1 infra) / 47 connections (41 high, 6 low) / 4 actors / 1 scan_versions row. `--no-scan` mode skips the scan_versions insert for Test 7.
- **`tests/list.bats`** — 7 bats E2E tests. Lives at the repo root (matches every other bats file in this repo).

## Files Modified

| File | Change | Reason |
| ---- | ------ | ------ |
| `plugins/arcanon/lib/worker-client.sh` | +`_arcanon_is_project_dir()` after `worker_start_background` | NAV-01 silent-no-op contract; reusable by 114-03. |
| `plugins/arcanon/worker/cli/hub.js` | +`cmdList`, +`list: cmdList` in HANDLERS, +`import { projectHashDir }` | NAV-01 handler. |
| `plugins/arcanon/worker/db/pool.js` | `function projectHashDir` → `export function projectHashDir` | One-line additive change; required by `cmdList` Node-side project detection. Verified no existing import-by-default callers exist (function was module-private). |
| `tests/commands-surface.bats` | Iteration list extended to `map drift impact sync login status export verify update list` (was 7 commands, missed `verify` and `update`); +1 regression assertion for list.md `allowed-tools: Bash` | NIT 8 — bring the surface test in sync with the actual `commands/` directory. |
| `plugins/arcanon/CHANGELOG.md` | `### Added` line under `[Unreleased]` for `/arcanon:list` | Keep-a-Changelog discipline. No version pin (Phase 122 cuts v0.1.4). |

## Tests Added

| # | Test | Asserts |
| --- | ---- | ------- |
| 1 | helper returns 0 when impact-map.db exists | exit 0, empty stdout |
| 2 | helper returns 1 when no impact-map.db | exit 1, empty stdout |
| 3 | helper honors ARCANON_DATA_DIR override | exit 0 against custom data dir, default unset |
| 4 | bash hub.sh list silent in non-project | exit 0, empty stdout |
| 5 | list happy path 5-line overview | regex `Services:[[:space:]]+8 mapped` + 3× `grep -q` per-type, plus Repos/Connections/Actors/Hub lines |
| 6 | list --json structured object | 11× `jq -e` field assertions (repos_count, services.total, services.by_type.{service,library,infra}, connections.{total,high_confidence,low_confidence}, actors_count, hub object, project_root string) |
| 7 | list does not crash on empty scan_versions | exit 0, output contains `scanned never` |
| 8 (commands-surface) | /arcanon:list declares `allowed-tools: Bash` | `grep -E '^allowed-tools:'` returns 0 + `grep -q 'Bash'` |

All 14 tests in `bats tests/list.bats tests/commands-surface.bats` pass.

## Decisions

1. **Direct sqlite3 over /graph extension for the repo count** (RESEARCH §3 / §7 Q3). One consumer today. If `/arcanon:doctor` or `/arcanon:diff` ends up needing repos as well, we'll fold it into the `/graph` response then — extension-when-needed beats speculative API churn.
2. **`_arcanon_is_project_dir` returns 0/1 only** (NIT 10). Pure predicate composes with `if` cleanly. A sibling helper that echoes the resolved DB path can land later when an actual callsite needs it; no callsite does today.
3. **`projectHashDir` exported from `pool.js`, not `database.js`** (RESEARCH §1, §6). `pool.js` already exports `getQueryEngine` and `listProjects` — it is the natural home for project-path utilities. The `database.js` copy stays module-private (it is internal to `openDb()`).
4. **`tests/list.bats` lives at the repo root.** Every other bats file in this repo is at `tests/`. Fixture files live under `plugins/arcanon/tests/fixtures/list/`. No deviation.
5. **`tests/commands-surface.bats` iteration list extended to 10 commands** (NIT 8). Pre-existing gap: the loop missed `verify` (TRUST-01) and `update` (UPD-01) shipped in v0.1.3. Adding `list` would be incomplete without backfilling these. 114-02 / 114-03 will append `view` and `doctor` additively.
6. **5s per-request timeout via AbortController** on the parallel `/graph` + `/api/scan-quality` fetches. A single hung endpoint cannot block the other (Promise.all races independently), and graceful degradation prints `unknown` per line + still exits 0 in human mode (and a `null` field in JSON mode).
7. **CHANGELOG entry under `[Unreleased]` with no version pin.** Phase 122 owns the v0.1.4 cut and will demote `[Unreleased]` to `[0.1.4] - YYYY-MM-DD` then.

## Open Items

None — Plan 114-01 is fully landed and verified.

Cross-plan handoff for 114-02 / 114-03:

- 114-03 (`/arcanon:doctor`) can `source ${CLAUDE_PLUGIN_ROOT}/lib/worker-client.sh` and call `_arcanon_is_project_dir` directly — same silent-no-op pattern.
- 114-03 can `import { projectHashDir } from '../db/pool.js'` for the Node-side project detection inside `cmdDoctor`.
- 114-02 (`/arcanon:view`) and 114-03 should append their commands to the `tests/commands-surface.bats` iteration list — same single-line edit pattern as this plan, no merge conflict expected.

## Self-Check: PASSED

- All 4 created files present on disk:
  - `plugins/arcanon/commands/list.md`
  - `tests/list.bats`
  - `plugins/arcanon/tests/fixtures/list/seed.sh`
  - `plugins/arcanon/tests/fixtures/list/seed.js`
- Both task commits present in `git log --oneline --all`:
  - `5c428ca` (Task 1: scaffold + helper)
  - `865fc33` (Task 2: composition + ship)
- Key code landmarks verified:
  - `_arcanon_is_project_dir` in `plugins/arcanon/lib/worker-client.sh`
  - `list: cmdList` in `plugins/arcanon/worker/cli/hub.js` HANDLERS map
  - `export function projectHashDir` in `plugins/arcanon/worker/db/pool.js`
- `bats tests/list.bats tests/commands-surface.bats` → 14/14 green.
