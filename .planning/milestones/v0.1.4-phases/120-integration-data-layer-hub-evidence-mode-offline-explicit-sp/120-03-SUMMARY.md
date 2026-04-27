---
phase: 120-integration-data-layer-hub-evidence-mode-offline-explicit-sp
plan: 03
subsystem: integration-data-layer
tags: [int-05, catalog, yaml, externals, data-only]
requires: []
provides:
  - "plugins/arcanon/data/known-externals.yaml (catalog of 20 third-party externals)"
  - "tests/known-externals-yaml.bats (9 schema-validation tests)"
affects: []
tech_added: []
patterns: [data-as-yaml, catalog-with-glob-host-patterns, kebab-case-identifiers]
key_files:
  created:
    - plugins/arcanon/data/known-externals.yaml
    - tests/known-externals-yaml.bats
  modified:
    - plugins/arcanon/CHANGELOG.md
decisions:
  - "Glob-style host patterns (NOT regex) — header comment defines glob semantics: '*' matches one DNS label."
  - "Top-level externals: list (not map keyed by name) — consumers can iterate ordered, optionally index by name."
  - "Categories enum: api | webhook | observability | storage | auth | infra — narrow enough to be enforceable, broad enough to cover all 20 seeded entries plus realistic future additions."
  - "evidence_url is optional metadata — UX hint for the consumer renderer; absence is not an error."
  - "Phase 120 ships ZERO Node loader code; Phase 121 owns ingestion (per orchestrator hard constraint)."
  - "kebab-case names enforced by the test — matches existing project identifier convention; prevents Phase 121 ambiguity on dictionary keys."
metrics:
  duration: ~10 minutes
  completed: 2026-04-27
---

# Phase 120 Plan 03: Ship known-externals.yaml Catalog Summary

Curated 20-entry third-party externals catalog at `plugins/arcanon/data/known-externals.yaml`, with 9 bats schema-validation tests. Pure data ship — zero Node code, ready for Phase 121's matcher to consume.

## Objective

Ship the `known-externals.yaml` catalog (INT-05) as a data file with comprehensive schema-validation tests, while strictly respecting the Phase 120/121 boundary: Phase 120 ships only the data; Phase 121 ships the loader and matcher.

## What Changed

### New Files

- **`plugins/arcanon/data/known-externals.yaml`** — 20 catalog entries spanning all 6 categories:
  - **api (6):** github, mailgun, pagerduty, sendgrid, stripe, twilio
  - **auth (3):** auth0, dex, okta
  - **infra (2):** aws-lambda, cloudflare
  - **observability (5):** datadog, mixpanel, otel-collector, segment, sentry
  - **storage (3):** azure-blob, gcs, s3
  - **webhook (1):** slack-webhooks
  - Documented header comment block: schema fields, valid category enum, glob-vs-regex rules for hosts, user-extension precedence rule (`arcanon.config.json#external_labels` wins on `name` collision), entry-add guidance.
  - Each entry has a `name` (kebab-case unique id), `label`, `category`, at least one of `hosts`/`ports`, and an optional `evidence_url`.

- **`tests/known-externals-yaml.bats`** — 9 schema-and-shape tests:
  1. File exists at documented path.
  2. Valid YAML, top-level `externals:` key.
  3. ≥20 entries.
  4. Every entry has `name` + `label` + `category`.
  5. Every entry's `category` is in the documented enum.
  6. Every entry has at least one of `hosts` or `ports`.
  7. All `name` values are kebab-case (`^[a-z][a-z0-9-]*$`).
  8. All `name` values are unique.
  9. Header comment block present.

### Modified

- **`plugins/arcanon/CHANGELOG.md`** — single `### Added` line documenting the catalog ship and the Phase 120/121 boundary.

## Decisions Made

Schema rationale traces back to RESEARCH §5:

1. **Glob hosts, not regex.** Catalog editors aren't regex experts; glob patterns (`*.auth0.com`) read like hostnames. Phase 121's matcher will implement DNS-label-aware glob expansion. The header comment defines the semantics so editors know `*.foo.com` does not match `a.b.foo.com`.
2. **List shape (`externals: [...]`), not map (`externals: { stripe: {...} }`).** Lists preserve a deterministic ordering for diffing, allow comments between entries, and let Phase 121's loader build a `Map<name, entry>` once at startup if it wants O(1) lookup. Map-keyed YAML would force the loader to re-key.
3. **Six categories chosen for realism.** The 20 seeded entries exercise every value in the enum — proves the enum isn't aspirational. Future categories (`queue`, `cache`, `cdn`) can be added with one line plus a test threshold bump.
4. **`evidence_url` is optional.** UX hint for the consumer (a clickable link from the labeled actor in the graph UI). Absent `evidence_url` doesn't block matching.
5. **Hard scope boundary respected.** Zero Node loader code. The boundary check is encoded as a `grep -rn 'known-externals' plugins/arcanon/{worker,lib,scripts}` exit-1 invariant; Phase 121 will be the first commit that flips that invariant.
6. **Kebab-case enforced.** Test 7 prevents future contributors from sneaking in `OktaPreview` or `slack_webhooks`. Matches the established identifier convention for catalog keys in the project.

## Tests

| Test                                                        | Result |
| ----------------------------------------------------------- | ------ |
| INT-05: file exists at the documented path                  | PASS   |
| INT-05: valid YAML, externals top-level key                 | PASS   |
| INT-05: ≥20 entries                                         | PASS   |
| INT-05: every entry has name + label + category             | PASS   |
| INT-05: every entry's category is in the documented enum    | PASS   |
| INT-05: every entry has at least one match signal           | PASS   |
| INT-05: all names are kebab-case                            | PASS   |
| INT-05: all names are unique                                | PASS   |
| INT-05: file has the documented header comment block        | PASS   |

**0 regressions.** No existing tests touched. No Node code shipped.

## TDD Gate Compliance

- **RED gate (commit `5948a4e`):** `test(120-03): add failing schema validation for known-externals.yaml` — 8/9 tests fail as expected (Test 8 trivially passes on missing file because empty input has no duplicates).
- **GREEN gate (commit `49c01cc`):** `feat(120-03): ship known-externals.yaml catalog (INT-05)` — all 9 tests green.
- **REFACTOR gate:** None required (single small data file).

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Helper-load path mismatch**
- **Found during:** Test authoring (Step 1 of Task 1)
- **Issue:** Plan stub used `load test_helper/common`, but the project doesn't have a `test_helper/common` file — existing bats files (e.g., `drift-openapi-explicit-spec.bats`) use `test_helper/bats-support/load` and `test_helper/bats-assert/load` directly.
- **Fix:** Used the actual project convention (`load 'test_helper/bats-support/load'` + `load 'test_helper/bats-assert/load'`) so the test loader doesn't error.
- **Files modified:** `tests/known-externals-yaml.bats`
- **Commit:** `5948a4e`

**2. [Rule 3 - Blocking] yq not installed locally**
- **Found during:** Pre-RED tooling check
- **Issue:** `yq` (mikefarah/yq, used by `drift-openapi.sh` as an optional fallback) was not on `$PATH`; the bats tests would `skip` with no useful signal.
- **Fix:** Installed via `brew install yq` (now `v4.53.2` at `/opt/homebrew/bin/yq`). The test still has the `command -v yq || skip` guard so CI environments without yq degrade gracefully — but locally we can now actually run the tests.
- **Files modified:** None (host tooling).
- **Commit:** N/A (environment).

## Phase 121 Handoff

Phase 121 (INT-06..08) consumes this catalog. The forgiving schema gives 121 room to evolve:

- **INT-06 (matcher):** Implement glob-host matching (one DNS label per `*`) and exact-port matching. The catalog already exercises both signals (otel-collector / dex use ports; everything else uses hosts).
- **INT-07 (user-extension merge):** Read `arcanon.config.json#external_labels`, merge into the catalog with user entries winning on `name` collision. The header comment documents this contract — the `js-yaml` runtime dep should be added by Plan 121-01 Task 0 (per orchestrator brief).
- **INT-08 (UI labels):** Render `label` as the actor's display name; surface `evidence_url` as a link from the labeled node when present.

The 20 seeded entries are realistic enough to drive end-to-end Phase 121 dogfooding from day one (Stripe, GitHub, S3, Datadog all show up in real service graphs).

## Self-Check: PASSED

- [x] FOUND: `plugins/arcanon/data/known-externals.yaml`
- [x] FOUND: `tests/known-externals-yaml.bats`
- [x] FOUND commit `5948a4e` (RED — test commit)
- [x] FOUND commit `49c01cc` (GREEN — catalog commit)
- [x] FOUND commit `660a2d9` (CHANGELOG entry)
- [x] All 9 bats tests PASS
- [x] Scope grep `known-externals` against `plugins/arcanon/{worker,lib,scripts}` returns no matches (exit 1) — Phase 121 boundary intact.
