# Requirements: Arcanon v0.1.5 — Identity & Privacy

**Defined:** 2026-04-27
**Core Value:** Every edit is automatically formatted and linted, every quality check runs with one command, and breaking changes across repos are caught before they ship.

**Milestone intent:** Adopt the hub's new personal-credential auth model and stop home-dir PII from leaking out of the worker. Two cross-cutting trust gaps that block public-beta credibility — handled in one milestone because both touch hub-sync and MCP egress paths.

**Linear tickets covered:** THE-1029 (auth, blocked by hub-side THE-1030), THE-1031 (PII).

**Hard dependency:** THE-1029 plugin work cannot ship until arcanon-hub THE-1030 lands. THE-1031 is independent — schedule the PII phase first so the milestone has shippable scope even if THE-1030 slips.

## v1 Requirements (Milestone v0.1.5)

### Hub Auth Header (AUTH) — THE-1029

Personal-credential auth: every upload carries `X-Org-Id`; the plugin discovers a sensible default at login via `whoami`.

- [ ] **AUTH-01**: `uploadScan(opts)` accepts `orgId` and sends `X-Org-Id: <orgId>` on every request. Missing `orgId` → throws `HubError` (status 400, code `missing_org_id`) **before** the network call. No retry.

- [ ] **AUTH-02**: New module `worker/hub-sync/whoami.js` exports `getKeyInfo(apiKey, hubUrl)` that calls `GET /api/v1/auth/whoami`, parses the response, returns `{ user_id, key_id, scopes, grants }`. Auth error → `AuthError`; network error → `HubError`.

- [ ] **AUTH-03**: `resolveCredentials(opts)` returns `{ apiKey, hubUrl, orgId, source }` with precedence `opts.orgId` → `ARCANON_ORG_ID` env → `~/.arcanon/config.json` `default_org_id`. Missing org id → throws `AuthError` whose message names the three resolution sources and suggests `/arcanon:login --org-id <uuid>`.

- [ ] **AUTH-04**: `storeCredentials()` persists `default_org_id` to `~/.arcanon/config.json` (mode 0600) alongside `api_key` and `hub_url`. Existing key/hub fields are preserved.

- [ ] **AUTH-05**: `worker/scan/manager.js _readHubConfig` reads per-repo `cfg.hub.org_id` override from `arcanon.config.json` and threads it into `uploadScan` ahead of the resolver chain (so per-repo override beats env beats machine default).

- [ ] **AUTH-06**: `/arcanon:login arc_xxx [--org-id <uuid>]` flow:
  - With `--org-id`: store the triple after calling `whoami` for verification (warn-but-allow if the key isn't authorized for that org — server will reject at upload time).
  - Without `--org-id`: call `whoami`. Exactly **1 grant** → auto-select and announce. **N grants** → prompt via AskUserQuestion. **0 grants** → fail loud with "key has no org grants — ask your admin".

- [ ] **AUTH-07**: `/arcanon:status` adds an Identity block showing: resolved org id + source (env / repo config / machine default), key preview (`arc_xxxx…1234`), scopes, and the list of orgs the key is authorized for. Shows `(missing)` when no org id resolves.

- [ ] **AUTH-08**: `uploadScan` parses these server error codes and surfaces actionable messages (no opaque "401 Unauthorized"):
  - `missing_x_org_id`, `invalid_x_org_id`
  - `insufficient_scope`
  - `key_not_authorized_for_org` ("key not authorized for this org — run `/arcanon:login --org-id <uuid>` to switch")
  - `not_a_member`, `forbidden_scan`, `invalid_key`

- [ ] **AUTH-09**: `commands/login.md`, `arcanon.config.json.example`, and the three docs (`docs/hub-integration.md`, `docs/getting-started.md`, `docs/configuration.md`) document the new field, env var, login flow, and resolution order.

- [ ] **AUTH-10**: Tests:
  - `worker/hub-sync/client.test.js` — header lands; missing `orgId` fails fast; each new error code produces its own message; success → `scan_upload_id`.
  - `worker/hub-sync/whoami.test.js` (new) — returns parsed grants; auth error → `AuthError`; network error → `HubError`.
  - `worker/hub-sync/integration.test.js` — login with/without `--org-id`; resolution order; per-repo override beats machine default.

### PII Path Masking (PII) — THE-1031

Mask `$HOME` at every serialization seam where a path could leave the worker process. DB storage stays absolute (needed for git operations); masking is at egress only.

- [x] **PII-01
**: New module `worker/lib/path-mask.js` exports:
  - `maskHome(p)` — replaces `$HOME` prefix with `~`. Idempotent. Non-string input passes through. Exact-`$HOME` match returns `~`.
  - `maskHomeDeep(obj)` — walks an object/array, masks any string property whose key is path-y (`path`, `repo_path`, `source_file`, `target_file`, `root_path`, plus a configurable allowlist).

- [x] **PII-02
**: `worker/mcp/server.js` — every MCP tool response payload that references `repo.path`, `path`, `source_file`, `target_file`, or `root_path` runs through `maskHomeDeep` before returning to the client. **Highest priority** — only egress to a third party (Anthropic).

- [x] **PII-03
**: `worker/server/http.js` — `/api/scan-freshness`, `/projects`, and `/graph` responses run through `maskHomeDeep` before serialization. The `repo_path` column from `query-engine.js:1591` is masked. (Note: prior REQ wording referenced `/api/repos`; that route does not exist — the actual surface is `GET /projects` plus `repos[].path` arrays nested inside `/api/scan-freshness` and `/graph` response bodies.)

- [x] **PII-04
**: `worker/lib/logger.js` — `extra` fields and stack-trace strings are masked before write to `~/.arcanon/logs/worker.log`. Console output (TTY mode) uses the same mask path.

- [x] **PII-05
**: `worker/cli/export*.js` — mermaid, dot, and html exports run repo path strings through `maskHome` before emitting.

- [x] **PII-06
**: `worker/scan/findings.js parseAgentOutput` rejects `source_file` values starting with `/` — log WARN with the offending value (also masked), drop the field, do not fail the scan. Belt-and-suspenders against future agent regressions.

- [x] **PII-07
**: Tests:
  - `worker/lib/path-mask.test.js` — round-trip cases: HOME prefix, no prefix, exact HOME match, `${HOME}other` (no false positive), nested object walk, idempotency.
  - bats — grep-assertion that no `/Users/` strings appear in MCP tool responses (`tools/list` + sample tool call), default-mode `/arcanon:export` outputs, worker log lines after a clean scan, `/api/scan-freshness` JSON.

### Release Gate (VER) — milestone close

- [ ] **VER-01**: Manifests bumped to `0.1.5` (4 manifests: `package.json`, `plugins/arcanon/package.json`, `plugins/arcanon/.claude-plugin/plugin.json`, repo-root `.claude-plugin/marketplace.json`). `package-lock.json` regenerated.

- [ ] **VER-02**: CHANGELOG `[0.1.5]` section pinned with categorized entries (Added / Changed / Fixed / BREAKING as applicable). Hub-side dependency on THE-1030 noted explicitly under BREAKING.

- [ ] **VER-03**: bats suite green. Node test suite green. No new pre-existing-mock carryforwards.

- [ ] **VER-04**: Verification phase confirms: `/arcanon:login` end-to-end against a real hub instance honoring THE-1030; `/arcanon:status` shows the expected identity block; an MCP tool call's response inspected and asserted to contain zero `/Users/` strings.

## Future Requirements (Deferred)

Captured but explicitly out of scope for v0.1.5. To be picked up in a later milestone.

- **Multi-level scope grants** (product/project/repo) per arcanon-hub APIKEY-01 — v0.1.6 candidate.
- **Service-account credentials** per arcanon-hub APIKEY-02 — v0.1.6 candidate.
- **Multi-org switching from the plugin** (per-org credential profiles) — explicitly deferred per THE-1029 Out of Scope.
- **DB schema change to store relative paths** — bigger refactor, not necessary if masking-at-egress works (PII-02..05).
- **ChromaDB vector content audit** — separate audit; embeddings could carry path text. Not in PII-01..07 scope.
- **arcanon-hub side PII audit** — separate codebase, separate issue under arcanon-hub project.

## Out of Scope

Explicit non-goals for v0.1.5.

- **Backwards compatibility with previous plugin versions** — none have shipped publicly. Plugin config schema can change freely.
- **Backwards-compatible auth fallback** — old `arc_…` credentials without an org id fail at upload time with a clear message; users re-run `/arcanon:login`. No two-read shim.
- **Skills/agents work** — remains v0.2.0; intentionally deferred since v0.1.1.
- **MCP-zombie cleanup** — needs separate investigation (Claude Code's plugin lifecycle ownership). Not in this milestone.
- **Hub-side server changes** — owned by arcanon-hub THE-1030.

## Traceability

Filled by `/gsd-roadmapper` after roadmap approval (2026-04-27).

| REQ-ID | Phase | Status |
|--------|-------|--------|
| AUTH-01 | Phase 124 | not started |
| AUTH-02 | Phase 124 | not started |
| AUTH-03 | Phase 124 | not started |
| AUTH-04 | Phase 124 | not started |
| AUTH-05 | Phase 124 | not started |
| AUTH-06 | Phase 125 | not started |
| AUTH-07 | Phase 125 | not started |
| AUTH-08 | Phase 125 | not started |
| AUTH-09 | Phase 125 | not started |
| AUTH-10 | Phase 126 | not started |
| PII-01 | Phase 123 | not started |
| PII-02 | Phase 123 | not started |
| PII-03 | Phase 123 | not started |
| PII-04 | Phase 123 | not started |
| PII-05 | Phase 123 | not started |
| PII-06 | Phase 123 | not started |
| PII-07 | Phase 123 | not started |
| VER-01 | Phase 127 | not started |
| VER-02 | Phase 127 | not started |
| VER-03 | Phase 127 | not started |
| VER-04 | Phase 127 | not started |

**Coverage: 21/21 v1 REQs mapped to exactly one phase. No orphans, no duplicates.**

---

*Generated: 2026-04-27 — milestone v0.1.5 Identity & Privacy*
