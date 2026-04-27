---
phase: 121-integration-consumption-layer
plan: 01
subsystem: integration-consumption-layer
tags: [int-06, int-09, externals, catalog, actor-labeling, migration-018]
requires:
  - "plugins/arcanon/data/known-externals.yaml (Phase 120-03)"
  - "actors table (migration 008)"
provides:
  - "actors.label TEXT NULL column (migration 018)"
  - "loadShippedCatalog() + matchActor() — pure loader + match logic"
  - "runActorLabeling(repoId, db, logger, catalog) — per-repo enrichment pass"
  - "getGraph().actors[].label exposed via /graph endpoint"
affects:
  - "scan pipeline (manager.js): per-repo labeling pass after per-service enrichment"
  - "graph UI consumers (read-only — Plan 121-02 wires UI rendering)"
tech_added: [js-yaml@^4.1.0]
patterns:
  - "PRAGMA table_info guard for idempotent ALTER TABLE ADD COLUMN (mirrors mig 008)"
  - "module-level cache keyed by absolute path for read-only catalogs"
  - "self-healing UPDATE-with-NULL on non-match — removes stale labels next scan"
  - "graceful pre-migration column fallback in getGraph (mirrors confidence/evidence)"
key_files:
  created:
    - plugins/arcanon/worker/db/migrations/018_actors_label.js
    - plugins/arcanon/worker/db/migration-018.test.js
    - plugins/arcanon/worker/scan/enrichment/externals-catalog.js
    - plugins/arcanon/worker/scan/enrichment/externals-catalog.test.js
    - plugins/arcanon/worker/scan/enrichment/actor-labeler.js
    - plugins/arcanon/worker/scan/enrichment/actor-labeler.test.js
    - plugins/arcanon/worker/db/query-engine-actors-label.test.js
    - plugins/arcanon/tests/fixtures/externals/known-externals.yaml
    - plugins/arcanon/tests/fixtures/externals/malformed.yaml
  modified:
    - plugins/arcanon/package.json
    - plugins/arcanon/package-lock.json
    - plugins/arcanon/worker/scan/manager.js
    - plugins/arcanon/worker/db/query-engine.js
    - plugins/arcanon/CHANGELOG.md
decisions:
  - "Per-repo actor labeling pass over per-service: actors live in a global table; one DB write per actor regardless of how many services connect to it. Slots cleanly between the per-service enrichment loop and the 'enrichment done' slog."
  - "Self-healing UPDATE-with-NULL on non-match: removing a catalog entry clears the stale label on the next scan rather than leaving an orphaned label."
  - "Module-level loader cache keyed by absolute path: parse known-externals.yaml once per worker lifetime; restart to pick up edits. No --reload flag in this plan."
  - "Loader accepts both 'entries:' (plan-assumed) and 'externals:' (Phase 120 actual) top-level keys; both map and list forms; list items may carry id or name. Single point of adaptation per the plan's assumptions block."
  - "Wildcard semantics: leading '*.foo.com' matches one-or-more leading DNS labels (excludes bare 'foo.com'); middle '*' matches exactly one DNS label (lambda.*.amazonaws.com works on shipped catalog). Plan test 2.9 required multi-label match for the leading-asterisk form, so the regex was tuned accordingly."
  - "Graceful pre-018 fallback in getGraph: catches 'no such column: label' specifically; falls back to old SELECT and synthesizes label: null per row. Mirrors the pattern already used for confidence/evidence."
  - "Failure-isolated labeling: actor-labeler swallows errors internally and returns {0,0}; the manager.js wire-in adds defense-in-depth try/catch. A bad scan never aborts on labeling."
metrics:
  duration: ~11 minutes
  completed: 2026-04-27
---

# Phase 121 Plan 01: Externals catalog consumption (loader + match + migration 018 + per-repo labeling pass) Summary

Wired the data-layer half of the externals consumption story. Migration 018 adds `actors.label TEXT NULL`. A pure YAML loader + `matchActor()` consume the Phase 120 catalog. A per-repo enrichment pass writes labels at scan time, repo-scoped and self-healing. `getGraph()` now returns `actors[].label`, gracefully falling back on pre-018 databases. 35 plan-scope tests green.

## Goal

Land the foundation Plan 121-02 (UI surfacing + user extension) needs:

1. Schema column for the friendly label.
2. Pure loader + match against the catalog Phase 120 shipped (`data/known-externals.yaml`).
3. Per-repo enrichment pass that runs at scan time and writes `actors.label`.
4. API surface (`getGraph().actors[].label`) so consumers can read it without re-running the matcher.

## Truths Validated

- After scan, actors whose name matches a catalog entry have `actors.label` populated; non-matching actors have `actors.label = NULL`. (Test 3.1, 3.4)
- Migration 018 is idempotent: PRAGMA-guarded ALTER, running twice is a no-op. (Test "is idempotent", "no-op when label already exists")
- Loader rejects malformed entries (missing label) with a WARN log; valid entries still load. (Test 2.5)
- Wildcard `*.auth0.com` matches `foo.auth0.com` AND `a.b.auth0.com`; does NOT match bare `auth0.com` or wrong TLD `foo.auth0.io`. (Test 2.9)
- Actor enrichment pass failure is caught and logged — never aborts the per-repo scan. (Test 3.7)
- Catalog file missing results in zero labels assigned and one WARN log; scan completes normally. (Test 2.3 + manager.js wire-in)
- Smoke test against the shipped 20-entry catalog: Stripe, AWS Lambda, S3 (both wildcard styles), OTel Collector by port, Auth0, Dex by port, Sentry — all label correctly.

## Artifacts Created

| Path | Purpose |
|------|---------|
| `plugins/arcanon/worker/db/migrations/018_actors_label.js` | Migration: ALTER TABLE actors ADD COLUMN label TEXT (PRAGMA-guarded idempotent) |
| `plugins/arcanon/worker/scan/enrichment/externals-catalog.js` | Loader (`loadShippedCatalog`) + match (`matchActor`) — pure, cached, failure-tolerant |
| `plugins/arcanon/worker/scan/enrichment/actor-labeler.js` | `runActorLabeling(repoId, db, logger, catalog)` — per-repo pass |
| `plugins/arcanon/worker/db/migration-018.test.js` | 5 tests: version, schema, idempotency, no-op, no-autopopulation |
| `plugins/arcanon/worker/scan/enrichment/externals-catalog.test.js` | 13 tests across loader (6) and matchActor (7) |
| `plugins/arcanon/worker/scan/enrichment/actor-labeler.test.js` | 7 tests covering happy path, idempotency, self-healing, scoping, edge cases, failure isolation |
| `plugins/arcanon/worker/db/query-engine-actors-label.test.js` | 3 tests: label round-trip, null-label, pre-018 graceful fallback |
| `plugins/arcanon/tests/fixtures/externals/known-externals.yaml` | Loader fixture (5 entries — stripe, auth0, github, slack, opentelemetry) |
| `plugins/arcanon/tests/fixtures/externals/malformed.yaml` | Malformed-entry fixture (one missing label, one valid) |

## Files Modified

- `plugins/arcanon/package.json` + `package-lock.json` — added `js-yaml ^4.1.0` (Phase 120 did not ship it).
- `plugins/arcanon/worker/scan/manager.js` — import + load catalog once per scanRepos; call `runActorLabeling` per repo with structured slog before the existing 'enrichment done' line; defense-in-depth try/catch.
- `plugins/arcanon/worker/db/query-engine.js` — `getGraph()` SELECT now includes `label`, with a graceful pre-018 fallback ("no such column: label" → fall back to old SELECT, synthesize `label: null`).
- `plugins/arcanon/CHANGELOG.md` — `### Added` line under `[Unreleased]` describing INT-06.

## Tests Added

| Suite | Tests |
|-------|-------|
| `migration-018.test.js` | 5 |
| `externals-catalog.test.js` | 13 |
| `actor-labeler.test.js` | 7 |
| `query-engine-actors-label.test.js` | 3 |
| **Total** | **28 new tests** |

Plan-scope verification command (`node --test`) covers 35 tests across the 5 plan-relevant suites + the existing `query-engine-graph.test.js` regression: all green. `migrations.test.js` regression: green (loader auto-discovers `018_actors_label.js` alphabetically).

## Decisions Made

See frontmatter `decisions:` for the canonical list. The two non-obvious ones:

1. **Wildcard semantics differ from Phase 120's documented "one DNS label per `*`"**: Plan 121-01 test 2.9 explicitly requires `a.b.auth0.com` to match `*.auth0.com` (multi-label). The leading-`*.` form treats the asterisk as one-or-more leading labels (excluding the bare suffix). Mid-string `*` still matches exactly one DNS label (so `lambda.*.amazonaws.com` matches `lambda.us-east-1.amazonaws.com` but not `lambda.us.east.1.amazonaws.com`). Plan test takes precedence; documented in matchHost JSDoc.
2. **Loader accepts both top-level keys**: plan assumed `entries:`, Phase 120 actually shipped `externals:`. Per the plan's own `<assumptions_about_phase_120>` block ("the loader is the single point of adaptation"), I broadened the normalizer to accept both keys + both map/list forms + both `id`/`name` slug fields. This avoids fragility against the catalog file being renormalized later.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Phase 120 deliverable shape divergence**
- **Found during:** Task 2 (loader implementation)
- **Issue:** Plan's `<assumptions_about_phase_120>` posited top-level `entries:` with map shape and `id` field on list items. Phase 120 actually shipped top-level `externals:` with `name` field on list items, plus `category` and `evidence_url` extras.
- **Fix:** Generalized the loader's `normalizeCatalog` to accept both `entries:` and `externals:` top-level keys, both map and list forms, and both `id` and `name` slug fields. The plan explicitly identified this as the single adaptation point. Extra fields (`category`, `evidence_url`) are simply ignored — only `label`, `hosts`, `ports` flow through.
- **Files modified:** `plugins/arcanon/worker/scan/enrichment/externals-catalog.js`
- **Commit:** `f02bd05`

**2. [Rule 1 - Bug] Wildcard regex too narrow**
- **Found during:** Task 2 (test 2.9 `a.b.auth0.com` → null instead of 'Auth0')
- **Issue:** Initial implementation used `[^.]+` for `*`, restricting wildcards to one DNS label per `*`. Plan test 2.9 requires multi-label match for the leading-`*.` form.
- **Fix:** Special-cased the leading-`*.` form to use `[^.]+(?:\.[^.]+)*\.` (one-or-more leading labels), preserving the bare-host exclusion. Mid-string `*` retains one-label semantics (still works for `lambda.*.amazonaws.com`).
- **Files modified:** `plugins/arcanon/worker/scan/enrichment/externals-catalog.js`
- **Commit:** `f02bd05`

**3. [Rule 3 - Blocking] QueryEngine constructor needs more migrations than 001+008+018**
- **Found during:** Task 4 (RED for query-engine-actors-label.test.js)
- **Issue:** Initial test seeded only migrations 001 + 008 + 018; QueryEngine constructor's prepared-statement initialization needs 002, 003, 004, 005, 006, 007, 009 too (it references `services.type`, `exposed_endpoints`, `scan_versions`, etc.).
- **Fix:** Extended `applyCore()` helper to apply 001-009 in sequence (mirroring `query-engine-graph.test.js`'s migration chain), then 018.
- **Files modified:** `plugins/arcanon/worker/db/query-engine-actors-label.test.js`
- **Commit:** `372e671`

## Open Items

- **Plan 121-02** consumes `actors.label` in the UI (graph node label display) and `/arcanon:list` actor section, and adds the `arcanon.config.json#external_labels` user-extension merge (user wins on slug collision).
- **Plan 121-03** ships the `/arcanon:drift openapi --spec X --spec Y` happy-path bats test (INT-10).
- **Future enhancement:** module-level cache has no `--reload-catalog` flag. Restart the worker to pick up catalog edits. Defer until user demand surfaces.
- **Future enhancement:** `evidence_url` (in shipped catalog entries) is currently dropped by the normalizer. Plan 121-02 may surface it in the UI as a clickable link from the labeled actor; if so, extend `CatalogEntry` to carry it through.

## Self-Check: PASSED

- [x] FOUND: `plugins/arcanon/worker/db/migrations/018_actors_label.js`
- [x] FOUND: `plugins/arcanon/worker/db/migration-018.test.js`
- [x] FOUND: `plugins/arcanon/worker/scan/enrichment/externals-catalog.js`
- [x] FOUND: `plugins/arcanon/worker/scan/enrichment/externals-catalog.test.js`
- [x] FOUND: `plugins/arcanon/worker/scan/enrichment/actor-labeler.js`
- [x] FOUND: `plugins/arcanon/worker/scan/enrichment/actor-labeler.test.js`
- [x] FOUND: `plugins/arcanon/worker/db/query-engine-actors-label.test.js`
- [x] FOUND: `plugins/arcanon/tests/fixtures/externals/known-externals.yaml`
- [x] FOUND: `plugins/arcanon/tests/fixtures/externals/malformed.yaml`
- [x] FOUND commit `2cd527f` (Task 0 — js-yaml dep)
- [x] FOUND commit `c096e72` (Task 1 RED)
- [x] FOUND commit `43c108e` (Task 1 GREEN)
- [x] FOUND commit `3494964` (Task 2 RED)
- [x] FOUND commit `f02bd05` (Task 2 GREEN)
- [x] FOUND commit `ffb0b0f` (Task 3 RED)
- [x] FOUND commit `7868bc1` (Task 3 GREEN)
- [x] FOUND commit `372e671` (Task 4 — wire-in + getGraph + CHANGELOG)
- [x] All 35 plan-scope tests pass (`node --test ...`)
- [x] `migrations.test.js` regression: green (loader auto-picks 018)
