# CHANGELOG draft for v0.1.5 — Phase 124 (Hub Auth Core)

> Pin into `CHANGELOG.md` `[0.1.5]` section in Phase 127 (VER-02). Reorder /
> consolidate with PII-01..07 entries from Phase 123 and any Phase 125
> additions before pinning.

## Pin into CHANGELOG.md `[0.1.5]` BREAKING section in Phase 127:

### BREAKING

- **Hub uploads now require `org_id` (THE-1029, paired with arcanon-hub THE-1030).**
  Every scan upload sends an `X-Org-Id: <uuid>` HTTP header. Calling `uploadScan`
  without an `orgId` throws `HubError(status=400, code='missing_org_id')` BEFORE the
  network attempt. Resolution precedence: `opts.orgId` → `ARCANON_ORG_ID` env →
  `~/.arcanon/config.json#default_org_id`. Per-repo override (`hub.org_id` in
  `arcanon.config.json`) beats env beats machine default.

  **Upgrade path for v0.1.4 users:** Existing `~/.arcanon/config.json` files contain
  `{api_key, hub_url}` but no `default_org_id`. The next `/arcanon:sync` (or any
  auto-sync on scan-end) will fail with:

  ```
  AuthError: Missing org_id (sources tried: opts.orgId, ARCANON_ORG_ID env, ~/.arcanon/config.json#default_org_id).
    Run /arcanon:login --org-id <uuid> to set the machine default.
    Or set ARCANON_ORG_ID in your environment.
    Or add hub.org_id to this repo's arcanon.config.json for a per-repo override.
  ```

  Re-run `/arcanon:login arc_xxx --org-id <uuid>` (Phase 125 wires the UX) to populate
  `default_org_id` and resume uploads.

- **`HubError` now carries a `.code` field** (string|null, default null). Forward-compat
  with arcanon-hub THE-1030 RFC 7807 error responses. Existing `.status`, `.retriable`,
  `.body`, `.attempts` fields unchanged.

- **Hard prerequisite: arcanon-hub THE-1030 deploy.** v0.1.5 plugin code targets the
  server-side personal-credential rewrite + `whoami` endpoint + `X-Org-Id` enforcement
  shipped in arcanon-hub THE-1030. Brief upload outage between merges accepted —
  neither has shipped publicly. If you upgrade the plugin without the hub deploy,
  every upload returns 400 (hub doesn't recognize `X-Org-Id` yet) or worse —
  a hub honoring an OLDER protocol may accept the upload but ignore the org context.

### Added

- **`worker/hub-sync/whoami.js`** — `getKeyInfo(apiKey, hubUrl)` calls
  `GET /api/v1/auth/whoami`, returns `{user_id, key_id, scopes, grants}`. Used by
  Phase 125's `/arcanon:login` and `/arcanon:status` flows. Throws `AuthError` on
  401/403; throws `HubError` on transport/5xx. Re-exported from
  `worker/hub-sync/index.js`.

### Changed

- **`resolveCredentials` return shape** extended to `{apiKey, hubUrl, orgId, source}`.
  The `source` field continues to describe the api_key origin only (existing
  destructures at `worker/cli/hub.js:179, 777, 1282` unaffected). Missing `orgId`
  throws `AuthError` whose message names all three resolution sources and recommends
  `/arcanon:login --org-id <uuid>`.
- **`hasCredentials()` semantics (C2 option-a)** — stays org_id-tolerant. It only
  reports on api_key presence; the missing-org_id throw is deferred to upload time
  so the actionable AuthError lands in scan-end logs verbatim. Preserves the
  v0.1.4 → v0.1.5 upgrade path (no silent auto-sync gating-off on first upgrade).
- **`storeCredentials(apiKey, opts)`** accepts `opts.defaultOrgId` and persists it as
  `default_org_id` in `~/.arcanon/config.json`. Existing keys preserved via spread-merge.
  File mode 0600 / dir mode 0700 unchanged.
- **`worker/scan/manager.js _readHubConfig`** reads per-repo `hub.org_id` from
  `arcanon.config.json` and threads it into `syncFindings` → `uploadScan`. Now
  exported (alongside the existing `_readHubAutoSync`) for testability.

### Internal

- **`uploadScan` signature change:** additive `orgId` field on the opts object.
  `worker/hub-sync/index.js` (syncFindings + drainQueue) updated to thread
  `creds.orgId` through. Two call sites at `index.js:71`, `index.js:146` previously.
- **`HubError` constructor** accepts `code` in the options object (additive).
- **C2 decision recorded:** option-a (hasCredentials org_id-tolerant) — see
  `124-PLAN.md` `<c2_decision>` block for the 4-bullet rationale.
