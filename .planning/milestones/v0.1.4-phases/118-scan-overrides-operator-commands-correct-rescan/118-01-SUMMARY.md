---
phase: 118-scan-overrides-operator-commands-correct-rescan
plan: 01
subsystem: worker/cli (operator commands)
tags: [scan-overrides, correct-command, cli-handler, CORRECT-02, CORRECT-04, CORRECT-06, CORRECT-07]
requirements_satisfied: [CORRECT-02, CORRECT-04, CORRECT-06, CORRECT-07]
dependency_graph:
  requires:
    - Phase 117-01 migration 017 + qe.upsertOverride helper
    - parseArgs/emit/HANDLERS dispatch in worker/cli/hub.js
    - lib/worker-client.sh _arcanon_is_project_dir
    - lib/help.sh arcanon_print_help_if_requested
  provides:
    - cmdCorrect handler in HANDLERS table (correct: cmdCorrect)
    - commands/correct.md slash-command wrapper
    - resolveServiceTarget helper (worker/cli/correct-resolver.js)
    - tests/correct.bats (11 cases) + fixture seed
  affects:
    - Plan 118-02 (/arcanon:rescan) — explicit re-scan trigger that invokes
      Phase 117-02 apply-hook on the staged overrides this plan inserts
    - Phase 117-02 apply-hook — operators now have a tool to populate the
      pending-overrides queue that hook drains
tech_stack:
  added: []
  patterns:
    - "Per-handler positional + flags dispatch (extends cmdDiff signature)"
    - "Pure resolver in separate module for testability (correct-resolver.js)"
    - "Structured-throw contract: { code, message, exitCode } — caller writes stderr + exits"
    - "Silent-contract no-op when not in Arcanon project dir (NAV-01 parity)"
    - "Bats fixture applies canonical migration chain through 017 (no schema fork)"
key_files:
  created:
    - plugins/arcanon/worker/cli/correct-resolver.js
    - plugins/arcanon/commands/correct.md
    - plugins/arcanon/tests/fixtures/correct/seed.js
    - plugins/arcanon/tests/fixtures/correct/seed.sh
    - plugins/arcanon/worker/cli/hub.correct.test.js
    - tests/correct.bats
  modified:
    - plugins/arcanon/worker/cli/hub.js
    - plugins/arcanon/CHANGELOG.md
    - tests/commands-surface.bats
decisions:
  - "Service-name resolver lives in its own file (correct-resolver.js) so the multi-match disambiguation logic is unit-testable without spawning a worker"
  - "Resolver throws structured { code, message, exitCode } objects rather than Error instances — caller (cmdCorrect) writes stderr + exits with the code; keeps the resolver pure"
  - "created_by='cli' (not 'system') distinguishes operator-staged overrides from any future system-generated rows"
  - "Did NOT trigger an immediate scan from /correct — apply happens on next /map or /rescan run, per Phase 117-02 contract"
  - "Reused existing parseArgs() positional+flags shape — no signature change required since main() at hub.js:1414 already passed positional"
metrics:
  duration_minutes: ~10
  tasks_completed: 6
  files_created: 6
  files_modified: 3
  tests_added: 17  # 11 bats + 4 node + 2 commands-surface regressions
  tests_passing: 58  # 11 correct.bats + 16 commands-surface.bats + 2 scan-overrides-apply.bats + 4 hub.correct.test + 10 query-engine.scan-overrides + 15 worker/scan/overrides
  completed_date: 2026-04-25
---

# Phase 118 Plan 01: /arcanon:correct — Stage Scan Overrides Summary

**One-liner:** Ships `/arcanon:correct <kind> --action <action> [flags]` as a new slash-command that inserts a single row into Phase 117's `scan_overrides` table per invocation — no scan triggered, no domain-table mutation. The next `/arcanon:map` or `/arcanon:rescan` (118-02) consumes the row via Phase 117-02's `applyPendingOverrides` hook.

## What Shipped

1. **`worker/cli/hub.js`** — new `cmdCorrect(flags, positional)` handler (~155 lines including JSDoc) registered as `correct: cmdCorrect` in `HANDLERS`. Handles kind validation (`connection|service`), action validation (`delete|update|rename|set-base-path`), kind/action matrix gate, target resolution (integer ID for connections, name lookup for services), per-action payload construction, and emits via the existing `emit(json, flags, human)` helper. Silent-contract no-op when no `impact-map.db` exists at the project's hash dir.

2. **`worker/cli/correct-resolver.js`** — pure helper `resolveServiceTarget(name, db)`. Returns the integer `services.id` on a unique match; throws `{code, message, exitCode}` on zero/multi/invalid input. Extracted into its own file so the disambiguation branch is unit-testable without spawning the worker.

3. **`commands/correct.md`** — slash-command wrapper. Frontmatter declares `description`, `argument-hint`, `allowed-tools: Bash`. Body sources `lib/help.sh` + `lib/worker-client.sh`, exits silently when `_arcanon_is_project_dir` returns false, then dispatches `bash hub.sh correct $ARGUMENTS`. Includes the action × kind matrix table, per-action payload flag table, exit-code table, `## Help` section.

4. **`tests/correct.bats`** — 11 E2E cases driving the real `hub.sh` wrapper:
   - silent contract (no DB → exit 0, empty output)
   - 4 happy paths (connection delete/update; service rename/set-base-path) — each asserts the row goes IN with the locked payload shape (extracted via `sqlite3 -line` + `jq` when available)
   - 4 error paths (bad kind, kind/action mismatch, unknown connection, unknown service) — exit 2 with friendly message
   - `--json` structured output asserted via `jq -e`
   - `created_by='cli'` regression — distinguishes operator from system

5. **`worker/cli/hub.correct.test.js`** — 4 pure node tests for the resolver. In-memory better-sqlite3, no migrations needed (resolver only reads 4 cols). Covers: 1-match returns id; 0-match → `NOT_FOUND/2`; multi-match → `AMBIGUOUS/2` with disambiguation lines; empty/non-string name → `INVALID/2`.

6. **`plugins/arcanon/tests/fixtures/correct/{seed.js,seed.sh}`** — fixture seeder mirroring the `overrides/`, `diff/`, and `freshness/` shape. Applies canonical migration chain 001..017 (no schema fork), seeds 1 repo + 1 prior scan_versions row + 2 services (`svc-a`, `svc-b`) + 1 connection (`svc-a → svc-b`). Echoes resolved IDs as JSON on stdout for tests to capture.

7. **`tests/commands-surface.bats`** — extended with `correct` in both iteration lists; added 2 regression assertions (`CORRECT-04: /arcanon:correct declares allowed-tools: Bash` and `CORRECT-04: worker/cli/hub.js registers correct: cmdCorrect`) mirroring the diff/doctor pattern.

8. **CHANGELOG entry** — single line under Unreleased / Added.

## Phase 117 Assumptions — All Held

| # | Assumption | Status |
|---|------------|--------|
| P117-A | Migration 017 ships before 118 | ✅ — confirmed via `ls plugins/arcanon/worker/db/migrations/017_scan_overrides.js` |
| P117-B | `qe.upsertOverride({...}) → number` exists | ✅ — confirmed at `worker/db/query-engine.js:1231` |
| P117-C | Schema columns match the assumed shape | ✅ — Test 11 reads `created_by` directly; tests 2-5 read `kind`, `target_id`, `action`, `payload` |
| P117-D | Per-action payload field names locked | ✅ — Tests 3/4/5 assert `{source,target}`, `{new_name}`, `{base_path}` exact field names |
| P117-E | `target_id` is integer pointing at connections.id / services.id | ✅ — bats test 4 asserts the resolved svc-a ID lands in `target_id` |
| P117-F | `created_by='cli'` distinguishes from default 'system' | ✅ — passed in upsertOverride args; Test 11 asserts |
| P117-G | DB CHECK is the safety net for kind/action | ✅ — JS pre-validates for friendly errors; CHECK is backstop |

No drift detected at execution time.

## Deviations from Plan

**None — plan executed exactly as written.**

The plan called for "stub `qe.upsertOverride` ONLY if Phase 117 hasn't shipped" (Task 2 fallback). Phase 117 had shipped both 117-01 (helpers) and 117-02 (apply-hook), so Task 2 was a no-op as the plan intended. Verified via `grep -n upsertOverride worker/db/query-engine.js` (returned line 1231).

Two minor additive deviations stayed within plan intent:

1. **Added Test 11** (`created_by='cli'` regression) beyond the 8 cases the plan called for. Justified because the plan's success criteria (#118-01-PLAN.md line 32) note `created_by='cli'` is the operator-vs-system marker; the regression guard was cheap and pins the contract.

2. **Added bonus node test** for `INVALID` (empty/non-string) input to `resolveServiceTarget` (4th test case). The plan called for 3 cases (one/zero/multi); the 4th covers the defensive guard at the top of the resolver.

## Verification Summary

| Gate | Expected | Actual |
|------|----------|--------|
| `bats tests/correct.bats` | ≥8 pass | 11 pass |
| `bats tests/commands-surface.bats` | unchanged | 16 pass (was 14, +2 CORRECT-04 regressions) |
| `bats tests/scan-overrides-apply.bats` | unchanged | 2 pass (no regression from 117-02) |
| `node --test worker/cli/hub.correct.test.js` | ≥3 pass | 4 pass |
| `node --test worker/db/query-engine.scan-overrides.test.js` | unchanged | 10 pass (no regression from 117-01) |
| `node --test worker/scan/overrides.test.js` | unchanged | 15 pass (no regression from 117-02) |
| `grep -c "correct: cmdCorrect" hub.js` | 1 | 1 |
| `grep -c "scan_overrides" CHANGELOG.md` | ≥3 | 3 |
| Manual smoke: row-shape per (kind × action) | matches D | confirmed via `/tmp` smoke tests |

## Cross-Plan Coordination

- **118-02 (`/arcanon:rescan`)** — next plan in this phase. Will trigger `applyPendingOverrides` via an explicit re-scan; will use the same QE pool. The /correct command does NOT call rescan from inside.
- **117-02 (apply-hook)** — already shipped. The apply-hook reads `kind`, `target_id`, `action`, `payload` exactly as this plan writes them (D-locked field names verified end-to-end via test assertions on both sides).

## Self-Check: PASSED

- FOUND: plugins/arcanon/worker/cli/correct-resolver.js
- FOUND: plugins/arcanon/commands/correct.md
- FOUND: plugins/arcanon/tests/fixtures/correct/seed.js
- FOUND: plugins/arcanon/tests/fixtures/correct/seed.sh
- FOUND: plugins/arcanon/worker/cli/hub.correct.test.js
- FOUND: tests/correct.bats
- FOUND: commit 6eaa434 (cmdCorrect handler + resolver)
- FOUND: commit 0ac8b1f (commands/correct.md)
- FOUND: commit 619ede8 (commands-surface.bats)
- FOUND: commit 06e735a (correct.bats + fixture)
- FOUND: commit f1a84aa (node test)
- FOUND: commit 72184b5 (CHANGELOG)
- All 11 correct.bats + 16 commands-surface.bats + 4 node + adjacent 117 suites pass with no regression.
- `git log --oneline | grep '118-01'` shows the 6 task commits in order.

## Commits (6)

| # | Hash    | Message |
|---|---------|---------|
| 1 | 6eaa434 | feat(118-01): add cmdCorrect handler + service-name resolver (CORRECT-02) |
| 2 | 0ac8b1f | feat(118-01): add /arcanon:correct slash-command wrapper (CORRECT-04) |
| 3 | 619ede8 | test(118-01): extend commands-surface.bats for /arcanon:correct (CORRECT-04) |
| 4 | 06e735a | test(118-01): add correct.bats E2E + fixture seeder (CORRECT-06) |
| 5 | f1a84aa | test(118-01): add node tests for resolveServiceTarget (CORRECT-02) |
| 6 | 72184b5 | docs(118-01): add CHANGELOG entry for /arcanon:correct (CORRECT-02/04/06) |
