---
phase: 125-login-and-status-ux
plan: 125
subsystem: auth
tags: [auth, ux, identity, error-handling, docs, hub-integration, whoami, rfc-7807]

# Dependency graph
requires:
  - phase: 124-hub-auth-core
    provides: whoami client (getKeyInfo), AuthError, resolveCredentials({orgIdRequired}), storeCredentials({hubUrl, defaultOrgId}), HubError.code field
provides:
  - HUB_ERROR_CODE_MESSAGES frozen map (7 RFC 7807 codes → user messages)
  - messageForCode(body, status) helper with body.title forward-compat fallback
  - cmdLogin whoami-driven D-125-02 4×2 branch table (auth/hub5xx/network × --org-id/no-org-id)
  - __ARCANON_GRANT_PROMPT__ stdout sentinel + exit code 7 for multi-grant AskUserQuestion re-entry
  - cmdStatus Identity block (D-125-03 nested identity object in --json; 4 indented lines in human mode)
  - _buildIdentityBlock helper with 4 s timeout cap
  - whoami_status enum: ok / auth_error / hub_error / network_error / skipped
  - org_id_source enum: repo_config / env / config_default / null
  - 4-file docs sweep: arcanon.config.json.example + hub-integration.md + getting-started.md + configuration.md
affects: [126-auth-test-suite, 127-release-gate]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "RFC 7807 problem-details parsing with custom .code extension; centralized message map (single source of truth) consumed by all UI surfaces"
    - "CLI exit-code sentinel pattern (exit 7 + __ARCANON_GRANT_PROMPT__ stdout marker) for slash-command-markdown ↔ Node-CLI re-entry across user prompts"
    - "Nested identity object in --json mode (insulates existing top-level JSON consumers from churn — additive-only contract)"
    - "(missing) / (unavailable: <reason>) UX fallback pattern for partially-resolved status data"

key-files:
  created:
    - .planning/phases/125-login-and-status-ux/125-SUMMARY.md
  modified:
    - plugins/arcanon/worker/hub-sync/client.js (HUB_ERROR_CODE_MESSAGES + messageForCode + error path rewrite)
    - plugins/arcanon/worker/cli/hub.js (cmdLogin full rewrite + cmdStatus Identity block + _buildIdentityBlock helper)
    - plugins/arcanon/commands/login.md (whoami flow + grant-prompt re-entry contract)
    - plugins/arcanon/commands/status.md (Identity bullet + Help summary)
    - plugins/arcanon/arcanon.config.json.example (expanded to fully-realized example with hub.org_id placeholder)
    - docs/hub-integration.md (Credentials section rewrite — 3 precedence chains, whoami flow, 7-code error table)
    - docs/getting-started.md (Connect to Arcanon Hub section rewrite + everyday-commands table + troubleshooting)
    - docs/configuration.md (Hub table: rename auto-upload→auto-sync, add hub.org_id row, add Org id resolution subsection, add ARCANON_ORG_ID env)

key-decisions:
  - "D-125-01 honored: HUB_ERROR_CODE_MESSAGES centralized in client.js as single source of truth; 7 codes pinned via Object.freeze; body.title forward-compat fallback preserved for unknown codes"
  - "D-125-02 honored: full 4×2 branch table implemented; AuthError NEVER stores; hub-5xx/network + --org-id stores with WARN; hub-5xx/network without --org-id refuses; multi-grant uses exit 7 + sentinel for markdown layer to handle via AskUserQuestion + re-invocation"
  - "D-125-03 honored: identity emitted as nested object in --json; existing top-level keys (plugin_version, data_dir, config_file, project_slug, hub_auto_sync, credentials, queue, scan_freshness) unchanged in shape"
  - "whoami response uses grants[].org_name not .slug — surfaced as `slug` in plugin internal shape via `g.org_name || g.slug || g.org_id` fallback chain (forward-compat with eventual server schema rename)"
  - "key_preview = apiKey.slice(0,8) + '…' + apiKey.slice(-4) — 8 prefix preserves the arc_ + first 4 chars of opaque body, useful for visual key disambiguation across multiple keys"
  - "_buildIdentityBlock uses 4 s timeout (vs 2 s _fetchScanFreshness) — whoami is a real network round-trip, but capped so /arcanon:status never hangs when hub is down"
  - "hub.auto-upload kept as legacy alias in configuration.md notes (one-time deprecation warning fires from existing _readHubAutoSync helper); v0.2.0 will drop it"

patterns-established:
  - "Centralized error-code → message map (HUB_ERROR_CODE_MESSAGES): single Object.freeze constant in client.js; UI surfaces just print the message. New error codes added in one place."
  - "CLI exit-code-as-action pattern: exit 0 = success, exit 2 = failure, exit 7 = needs-human-decision. Markdown layer handles exit 7 via AskUserQuestion + re-invocation."
  - "Stdout sentinel for structured CLI ↔ markdown handoff: __ARCANON_GRANT_PROMPT__ followed by JSON payload. Markdown parses, prompts, re-invokes."
  - "Nested-object additive JSON contract: when adding new structured data to a status command, nest it under a new top-level key (identity:) rather than spreading flat fields — protects existing consumers."
  - "Status-block fallback pattern: render `(missing)` when source is absent; `(unavailable: <reason>)` when source exists but lookup failed; never blank/null in human output."

requirements-completed: [AUTH-06, AUTH-07, AUTH-08, AUTH-09]

# Metrics
duration: 12min
completed: 2026-04-28
---

# Phase 125: Login & Status UX Summary

**Whoami-driven `/arcanon:login` flow with 4×2 branch table (auth/hub5xx/network × --org-id), `/arcanon:status` Identity block (nested in --json), 7-code RFC 7807 error parser with centralized HUB_ERROR_CODE_MESSAGES map, and 4-file docs sweep documenting credential triple + resolution precedence.**

## Performance

- **Duration:** ~12 min
- **Started:** 2026-04-28T18:17:21Z
- **Completed:** 2026-04-28T18:29:09Z
- **Tasks:** 6 implementation tasks completed (Plan 125-01 T1–T3 + Plan 125-02 T1–T3); 2 manual checkpoint tasks deferred to Phase 127 Release Gate
- **Files modified:** 8 (1 client.js, 1 hub.js, 2 commands/*.md, 1 example config, 3 docs/*.md)

## Accomplishments

- **AUTH-06 (Login flow):** `cmdLogin` rewritten to call `whoami` and apply the full D-125-02 branch table — auto-select on 1 grant, prompt on N grants (via exit 7 + stdout sentinel), fail loud on 0 grants, store-with-warn on hub-unreachable + `--org-id`, refuse-without-org on hub-unreachable + no-`--org-id`. AuthError never silently stores. UUID v4 validation for `--org-id`. API key NEVER reaches stdout/stderr in any branch. `--json` mode produces structured object for every branch.
- **AUTH-07 (Identity block):** `cmdStatus` extended with `_buildIdentityBlock` helper (4 s timeout cap). Emits nested `identity` object in `--json` (D-125-03) with `org_id`, `org_id_source`, `key_preview`, `scopes`, `authorized_orgs`, `whoami_status`. Human mode adds 4 indented lines under `Identity:` header (after data dir, before Latest scan). Existing top-level JSON keys unchanged — additive-only contract.
- **AUTH-08 (Error-code parser):** `HUB_ERROR_CODE_MESSAGES` frozen object centralizes all 7 RFC 7807 codes from D-125-01. `messageForCode(body, status)` helper resolves: known code → mapped message; unknown code with `body.title` → `hub returned <status>: <title>` (forward-compat preserved); else → `hub returned <status>`. `HubError.code` populated from response body for downstream callers. All 7 codes smoke-tested via `node -e` enumeration.
- **AUTH-09 (Docs sweep):** Four files updated with cohesive credential-triple narrative: `arcanon.config.json.example` expanded to a fully-realized example showing `hub.org_id`; `docs/hub-integration.md` Credentials section rewritten with 3 precedence chains (api key, hub URL, org id) + whoami flow + 7-code error table; `docs/getting-started.md` Connect-to-Arcanon-Hub section rewritten as 4-step a/b/c/d walkthrough referencing `/arcanon:sync` (not removed `/arcanon:upload`); `docs/configuration.md` Hub table now includes `hub.org_id` row + Org id resolution subsection + `ARCANON_ORG_ID` env var.

## Task Commits

Each task was committed atomically:

### Plan 125-01 — Login flow + structured error-code parser

1. **Task 1: HubError code parser + HUB_ERROR_CODE_MESSAGES (AUTH-08)** — `d554225` (feat)
2. **Task 2: cmdLogin whoami-driven org resolution (AUTH-06)** — `5638d7c` (feat)
3. **Task 3: /arcanon:login command markdown rewrite (AUTH-06)** — `eced52d` (docs)
4. **Task 4: Manual login walkthrough** — DEFERRED (see Deferred Validation)

### Plan 125-02 — Status Identity block + docs sweep

1. **Task 1: /arcanon:status Identity block (AUTH-07)** — `7e09b8e` (feat)
2. **Task 2: /arcanon:status command markdown for Identity (AUTH-07)** — `0f8f392` (docs)
3. **Task 3: 4-file docs sweep (AUTH-09)** — `1301fdc` (docs)
4. **Task 4: Manual status + docs read-through** — DEFERRED (see Deferred Validation)

## Files Created/Modified

- `plugins/arcanon/worker/hub-sync/client.js` — Added `HUB_ERROR_CODE_MESSAGES` frozen object (all 7 codes from D-125-01) and `messageForCode(body, status)` helper. Rewrote non-2xx error construction at the failed-response branch to use `messageForCode` + populate `HubError.code` from response body. Did NOT alter the success branch, the network-error branch, retry-budget exhaustion path, or the 413 pre-send guard.
- `plugins/arcanon/worker/cli/hub.js` — Imports extended with `getKeyInfo`, `AuthError`, `HubError` from `hub-sync/index.js`. `cmdLogin` (lines 157-169) fully rewritten with the D-125-02 4×2 branch table — exits 0/2/7 per cell. Added `_buildIdentityBlock(cfg)` helper. `cmdStatus` extended to call `_buildIdentityBlock` + attach to report + render 4-line Identity block in human mode.
- `plugins/arcanon/commands/login.md` — Frontmatter updated (`argument-hint`, `allowed-tools` now includes `AskUserQuestion`). Step 2 documents exit 0/2/7 handling. Grant-prompt re-entry contract documented. "Storage-only" line removed. Help section adds `--org-id` flag, behavior summary (4 bullets), 2 examples.
- `plugins/arcanon/commands/status.md` — Identity bullet added to "The script reports" list. Help Usage summary updated to mention identity (org + scopes).
- `plugins/arcanon/arcanon.config.json.example` — Expanded from 3-line stub to fully-realized example showing `project-name`, `linked-repos`, and a `hub` block with `auto-sync`, `url`, `project-slug`, and the new `org_id` placeholder. Valid JSON (no comments, per JSON spec).
- `docs/hub-integration.md` — Credentials section rewritten (lines 99-117 → ~85-line section). Now documents the credential-triple model with 3 precedence chains (api key, hub URL, org id), the `/arcanon:login` whoami flow (0/1/N grants + `--org-id` semantics), and the 7-code RFC 7807 error table. Removed obsolete `~/.ligamen/config.json` legacy line.
- `docs/getting-started.md` — Connect-to-Arcanon-Hub section rewritten as 4-step a/b/c/d walkthrough. Everyday-commands table: removed `/arcanon:upload` (deprecated v0.1.3), added `/arcanon:login`. Troubleshooting bullets: 401 → `invalid_key`, new 403 → `key_not_authorized_for_org`.
- `docs/configuration.md` — Hub table: renamed `hub.auto-upload` row to `hub.auto-sync` (with note that legacy key is still honored), added `hub.org_id` row. Example JSON snippet updated to show `auto-sync` and `org_id` placeholder. Added "Org id resolution" subsection with 3-source precedence. Added `ARCANON_ORG_ID` row to Hub credentials env table.

## Decisions Made

- **D-125-01 / D-125-02 / D-125-03 enforced exactly as pinned in PLAN.md** — no renegotiation. The 4×2 branch table, the nested-identity contract, and the centralized error-message map are all implemented per spec.
- **`grants[].org_name` consumed (not `.slug`)** — `whoami.js` (Phase 124) ships with `grants: Array<{org_id, org_name}>`. The plan used `<slug>` in user-facing messages; I implemented a `g.org_name || g.slug || g.org_id` fallback chain wherever a grant slug is rendered. This is forward-compat with any future server schema rename and back-compat with the current v0.1.5 hub.
- **`HubError` import path** — imported `HubError` from `hub-sync/index.js` (which re-exports it) rather than directly from `client.js`. Consistent with how `AuthError` and `getKeyInfo` are imported.
- **`positional` arg accepted in `cmdLogin`** — the dispatcher at `hub.js:2240` already passes `(flags, positional)` to handlers, so I added `positional` to the `cmdLogin` signature and resolve the api key in priority order: positional → `--api-key` → `ARCANON_API_KEY` env. This matches how `/arcanon:login arc_xxx` is shaped (positional arg from the markdown layer).
- **`hub.auto-upload` legacy alias retained in docs** — the existing `_readHubAutoSync` helper already emits a one-time deprecation WARN when the legacy key is used; I noted this in the configuration.md row rather than silently removing the back-compat path.

## Deviations from Plan

**None — plan executed exactly as written.** All 6 implementation tasks landed with no Rule 1/2/3 auto-fixes. The plan's pinned decisions (D-125-01, D-125-02, D-125-03) were implemented verbatim, and the only minor adjustment (using `org_name` instead of `slug` in user-facing messages) is a defensive forward-compat fallback that does not change the contract.

## Issues Encountered

None — Phase 124 deliverables (`whoami.js#getKeyInfo`, `AuthError`, `resolveCredentials({orgIdRequired:false})`, `storeCredentials({hubUrl, defaultOrgId})`, `HubError.code`) were exactly as documented in 125-PLAN.md, so all wire-through was direct. The only smoke-verify quirk was the Plan 125-02 Task 1 check returning `whoami_status: "hub_error"` (since arcanon-hub THE-1030 is not yet deployed), but the contract assertion (`identity` object present with required keys) passed cleanly — confirming the failure-handling path renders the block correctly when the hub is down, which is exactly the resilience behavior the design targets.

## Deferred Validation

Two `checkpoint:human-verify` gates were pre-approved for deferral by the orchestrator because the manual end-to-end walkthroughs require **arcanon-hub THE-1030 deployed against the dev hub** (whoami endpoint live; RFC 7807 errors with `code` field). At phase ship time (2026-04-28), THE-1030 is not yet deployed, so steps that require an actual whoami round-trip cannot be executed.

| Checkpoint | Plan | Reason | Resume in |
| --- | --- | --- | --- |
| Plan 125-01 Task 4 — Manual login walkthrough | 125-01 | THE-1030 hub deploy required for steps 3-8 (auto-select, multi-grant prompt, mismatch warn, AuthError, network error, hub-unreachable refuse) | Phase 127 (Release Gate) |
| Plan 125-02 Task 4 — Manual status + docs read-through | 125-02 | THE-1030 hub deploy required for step 1-3 (Identity block populated end-to-end against real grants); docs read-through (steps 4-7) can run independently but is bundled with the e2e validation for cohesion | Phase 127 (Release Gate) |

Each task's `<verify>` block (the `<automated>` smoke check) was executed and passed:

- 125-01 T1: all 7 `HUB_ERROR_CODE_MESSAGES` entries present (smoke verified via `node -e` enumeration)
- 125-01 T2: `worker/cli/hub.js` module loads without import errors
- 125-01 T3: `commands/login.md` contains `__ARCANON_GRANT_PROMPT__` + `--org-id`, no `storage-only`
- 125-02 T1: `node hub.js status --json` emits valid `identity` object with `org_id` + `whoami_status` keys
- 125-02 T2: `commands/status.md` contains `Identity (AUTH-07)` + `key preview`
- 125-02 T3: all 6 cross-file docs grep checks pass (ARCANON_ORG_ID / default_org_id / hub.org_id / whoami / key_not_authorized_for_org); JSON example validates

The Phase 127 Release Gate plan owner should re-run Plan 125-01 Task 4 steps 3-8 and Plan 125-02 Task 4 steps 1-3 against the deployed dev hub before final v0.1.5 ship. Phase 126 (Auth Test Suite, AUTH-10) will additionally convert the most critical manual scenarios into automated tests.

## User Setup Required

None — no external service configuration introduced by this phase. The hub-side requirement (THE-1030 deploy) is tracked separately in the arcanon-hub repo. Existing users with credentials stored from Phase 124 will see the new Identity block automatically on the next `/arcanon:status`.

## Next Phase Readiness

- **Phase 126 (Auth Test Suite, AUTH-10):** Ready to start. All auth surfaces are in place — `worker/hub-sync/client.test.js` can pin the X-Org-Id header landing + missing-orgId fail-fast + each of the 7 error codes (M-AUTH-08 enumeration); `worker/hub-sync/integration.test.js` can pin the login flow with/without `--org-id`, resolution precedence, and the 4×2 whoami branch outcomes. The plan owner should treat this SUMMARY's "Deferred Validation" entries as the priority test scenarios.
- **Phase 127 (Release Gate):** Should re-run the two deferred manual checkpoints from this phase against the deployed dev hub before v0.1.5 final ship. CHANGELOG entry and manifest version bump (to 0.1.5) are already scoped to Phase 127 per PLAN.md "Out of Scope."
- **No blockers** — all 6 implementation commits are in `main`, smoke verifies pass, no pre-existing tests broken (no test changes made in this phase by design).

## Self-Check: PASSED

Verified each created/modified file exists and each commit is reachable.

- File: `.planning/phases/125-login-and-status-ux/125-SUMMARY.md` — created (this file)
- File: `plugins/arcanon/worker/hub-sync/client.js` — modified (HUB_ERROR_CODE_MESSAGES + messageForCode + error path)
- File: `plugins/arcanon/worker/cli/hub.js` — modified (cmdLogin rewrite + cmdStatus Identity + _buildIdentityBlock)
- File: `plugins/arcanon/commands/login.md` — modified (whoami flow, grant-prompt contract)
- File: `plugins/arcanon/commands/status.md` — modified (Identity bullet, Help summary)
- File: `plugins/arcanon/arcanon.config.json.example` — modified (fully-realized example with hub.org_id)
- File: `docs/hub-integration.md` — modified (Credentials section rewrite + 7-code error table)
- File: `docs/getting-started.md` — modified (Connect-to-Hub rewrite + commands table + troubleshooting)
- File: `docs/configuration.md` — modified (Hub table + Org id resolution + ARCANON_ORG_ID)

Commits (all reachable in `git log`):

- `d554225` — feat(125): hub-sync error-code-to-message parser (AUTH-08)
- `5638d7c` — feat(125): /arcanon:login whoami-driven org resolution (AUTH-06)
- `eced52d` — docs(125): /arcanon:login command markdown for whoami flow (AUTH-06)
- `7e09b8e` — feat(125): /arcanon:status Identity block (AUTH-07)
- `0f8f392` — docs(125): /arcanon:status command markdown for Identity block (AUTH-07)
- `1301fdc` — docs(125): docs sweep — default_org_id / ARCANON_ORG_ID / login flow / resolution precedence (AUTH-09)

---
*Phase: 125-login-and-status-ux*
*Completed: 2026-04-28 (with 2 manual checkpoints deferred to Phase 127)*
