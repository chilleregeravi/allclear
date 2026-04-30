---
phase: 124-hub-auth-core
plan: 124
type: execute
milestone: v0.1.5
wave: 1
depends_on: ["123-pii-path-masking"]
hard_external_dependency: "arcanon-hub THE-1030 deploy must land before any plugin in this phase ships"
files_modified:
  - plugins/arcanon/worker/hub-sync/auth.js
  - plugins/arcanon/worker/hub-sync/auth.test.js
  - plugins/arcanon/worker/hub-sync/client.js
  - plugins/arcanon/worker/hub-sync/client.test.js
  - plugins/arcanon/worker/hub-sync/index.js
  - plugins/arcanon/worker/hub-sync/whoami.js
  - plugins/arcanon/worker/hub-sync/whoami.test.js
  - plugins/arcanon/worker/scan/manager.js
autonomous: true
requirements: [AUTH-01, AUTH-02, AUTH-03, AUTH-04, AUTH-05]

tags: [auth, hub-sync, identity, credentials, http-headers]

# C2 decision recorded as plan-level metadata so checkers/reviewers see it.
# Option (a): hasCredentials() stays org_id-tolerant; throw is deferred to upload time.
# Surface a manager.js WARN at scan-end if upload fails specifically for missing_org_id.
hasCredentials_semantics: "option-a: api-key-only is sufficient for hasCredentials()=true; resolveCredentials() throws AuthError on missing org_id at upload time only"

must_haves:
  truths:
    - "uploadScan(payload, {apiKey, hubUrl, orgId}) sends X-Org-Id: <orgId> header on POST to ${hubUrl}/api/v1/scans/upload"
    - "uploadScan(payload, {apiKey, hubUrl}) without orgId throws HubError(status=400, code='missing_org_id') BEFORE any fetch is invoked"
    - "getKeyInfo(apiKey, hubUrl) returns {user_id, key_id, scopes, grants} on 200 from a hub honoring THE-1030"
    - "getKeyInfo throws AuthError on 401/403 and HubError on transport/5xx failures"
    - "resolveCredentials(opts) returns {apiKey, hubUrl, orgId, source} where source is one of 'explicit'|'env'|'home-config' for the api_key origin"
    - "resolveCredentials precedence: opts.orgId -> ARCANON_ORG_ID -> ~/.arcanon/config.json#default_org_id"
    - "resolveCredentials with no resolvable orgId throws AuthError whose message names all three sources and recommends /arcanon:login --org-id <uuid>"
    - "hasCredentials() returns true when api_key resolves regardless of org_id presence (option-a)"
    - "storeCredentials(apiKey, {hubUrl, defaultOrgId}) preserves any unrelated keys in ~/.arcanon/config.json via spread-merge"
    - "storeCredentials writes mode-0600 file permission preserved on every write"
    - "Per-repo arcanon.config.json hub.org_id beats ARCANON_ORG_ID beats ~/.arcanon/config.json default_org_id"
    - "manager.js scan-end auto-sync surfaces a WARN with the resolution-source list when upload fails because of missing_org_id"
  artifacts:
    - path: "plugins/arcanon/worker/hub-sync/auth.js"
      provides: "resolveCredentials({apiKey, hubUrl, orgId}) -> {apiKey, hubUrl, orgId, source}; storeCredentials(apiKey, {hubUrl, defaultOrgId}); hasCredentials() (org_id-tolerant)"
      contains: "default_org_id, ARCANON_ORG_ID, resolveCredentials, storeCredentials"
    - path: "plugins/arcanon/worker/hub-sync/whoami.js"
      provides: "getKeyInfo(apiKey, hubUrl) -> Promise<{user_id, key_id, scopes, grants}>"
      exports: ["getKeyInfo"]
    - path: "plugins/arcanon/worker/hub-sync/client.js"
      provides: "uploadScan(payload, {apiKey, hubUrl, orgId, ...}) sends X-Org-Id header; missing orgId fail-fast"
      contains: "X-Org-Id, missing_org_id"
    - path: "plugins/arcanon/worker/hub-sync/index.js"
      provides: "syncFindings forwards orgId from creds to uploadScan; drainQueue forwards orgId"
      contains: "creds.orgId"
    - path: "plugins/arcanon/worker/scan/manager.js"
      provides: "_readHubConfig returns orgId; scanRepos threads it into syncFindings"
      contains: "cfg.hub.org_id, orgId"
  key_links:
    - from: "plugins/arcanon/worker/hub-sync/index.js"
      to: "plugins/arcanon/worker/hub-sync/auth.js"
      via: "resolveCredentials({apiKey, hubUrl, orgId})"
      pattern: "resolveCredentials\\(\\{[^}]*orgId"
    - from: "plugins/arcanon/worker/hub-sync/index.js"
      to: "plugins/arcanon/worker/hub-sync/client.js"
      via: "uploadScan(payload, {apiKey, hubUrl, orgId, log})"
      pattern: "uploadScan\\([^)]*orgId"
    - from: "plugins/arcanon/worker/scan/manager.js"
      to: "plugins/arcanon/worker/hub-sync/index.js"
      via: "syncFindings({...orgId})"
      pattern: "syncFindings\\([^)]*orgId"
    - from: "plugins/arcanon/worker/hub-sync/client.js"
      to: "external: arcanon-hub THE-1030"
      via: "X-Org-Id HTTP request header"
      pattern: "X-Org-Id"
---

<objective>
Land the coupled `X-Org-Id` signature/contract block (AUTH-01, AUTH-03, AUTH-05) plus the `whoami` client (AUTH-02) and the `~/.arcanon/config.json` schema extension (AUTH-04). After this phase, every hub upload carries `X-Org-Id` derived from a deterministic precedence chain (per-repo override -> env -> machine default), the plugin can call `whoami` for grant resolution, and the credential store persists `default_org_id` alongside `api_key` and `hub_url`.

Purpose: Phase 124 is the unbreakable coupled block of THE-1029. AUTH-01 cannot land without AUTH-03 (no `orgId` to thread); AUTH-05 cannot compile without AUTH-01 (`uploadScan` opts have no `orgId` field). They must ship together. AUTH-02 (whoami) is included in this phase because Phase 125 (AUTH-06 login flow) consumes it; we don't want a 1-REQ phase. AUTH-04 (`storeCredentials` extension) is the safe-upgrade primitive Phase 125 needs.

Output: A working but not-yet-user-exposed auth core. After this phase the local code path is end-to-end functional (a unit test exercising `uploadScan -> X-Org-Id` against a fake fetch is green); the only remaining gap is Phase 125's UX (login flow + status block + error-code messages). Hard-blocked on hub-side THE-1030 deploy for any real-hub end-to-end run; mock-fetch tests run today.
</objective>

<execution_context>
@$HOME/.claude/get-shit-done/workflows/execute-plan.md
@$HOME/.claude/get-shit-done/templates/summary.md
</execution_context>

<context>
@.planning/PROJECT.md
@.planning/ROADMAP.md
@.planning/STATE.md
@.planning/REQUIREMENTS.md
@.planning/PREDECESSOR-SURFACE.md

@plugins/arcanon/worker/hub-sync/auth.js
@plugins/arcanon/worker/hub-sync/auth.test.js
@plugins/arcanon/worker/hub-sync/client.js
@plugins/arcanon/worker/hub-sync/index.js
@plugins/arcanon/worker/scan/manager.js

<interfaces>
<!-- Key contracts the executor needs. Extracted from current codebase pre-modification. -->
<!-- Executor should use these directly — no codebase exploration needed. -->

From plugins/arcanon/worker/hub-sync/auth.js (current shape, pre-AUTH-03):
```js
export class AuthError extends Error { /* name = "AuthError" */ }
export const DEFAULT_HUB_URL = "https://api.arcanon.dev";
export const API_KEY_PREFIX = "arc_";
// Returns { apiKey, hubUrl, source } today; AUTH-03 adds orgId.
export function resolveCredentials(opts = {}): { apiKey, hubUrl, source };
export function hasCredentials(): boolean; // wraps resolveCredentials in try/catch
export function storeCredentials(apiKey, opts = {}): string; // returns file path
```

From plugins/arcanon/worker/hub-sync/client.js (current shape, pre-AUTH-01):
```js
export class HubError extends Error {
  constructor(message, { status, retriable, body, attempts } = {}) { /* fields: status, retriable, body, attempts */ }
}
export const UPLOAD_PATH = "/api/v1/scans/upload";
// Today: uploadScan(payload, { apiKey, hubUrl, attempts, backoffsMs, timeoutMs, log, fetchImpl })
// AUTH-01: add orgId; throw HubError(status=400, code='missing_org_id') BEFORE fetchImpl is called.
export async function uploadScan(payload, opts): Promise<{ scan_upload_id, status, latest_payload_version? }>;
```

From plugins/arcanon/worker/hub-sync/index.js (current call sites of uploadScan):
- Line 71: `await uploadScan(payload, { apiKey: creds.apiKey, hubUrl: creds.hubUrl, log })` (in syncFindings)
- Line 146: `await uploadScan(payload, { apiKey: creds.apiKey, hubUrl: creds.hubUrl, log })` (in drainQueue)
Both must add `orgId: creds.orgId` after AUTH-03 lands.

From plugins/arcanon/worker/scan/manager.js (current _readHubConfig and HUB-01 gate):
- Line 84-97: `_readHubConfig()` returns `{ hubAutoSync, hubUrl, projectSlug, libraryDepsEnabled }` — AUTH-05 adds `orgId`.
- Line 937: destructure of `_readHubConfig()` return — must add `orgId`.
- Line 941: `if (hubAutoSync && !hasCredentials())` — option-a means this gate is unchanged.
- Line 949: `if (hasCredentials() && hubAutoSync)` — option-a means this gate is unchanged.
- Line 962-971: `syncFindings({...})` call — must add `orgId` to the opts object so it rides the new wire.

Persisted shape of ~/.arcanon/config.json today:
```json
{ "api_key": "arc_xxx", "hub_url": "https://..." }
```
After AUTH-04:
```json
{ "api_key": "arc_xxx", "hub_url": "https://...", "default_org_id": "<uuid>" }
```
File mode 0600, dir mode 0700, single read site (auth.js:43 readHomeConfig), single write site (auth.js:129 storeCredentials).

Hub error response shape (assumed RFC 7807 from THE-1030 contract; full enumeration is Phase 125's AUTH-08):
```json
{ "type": "...", "title": "missing X-Org-Id header", "status": 400, "detail": "...", "code": "missing_org_id" }
```
Phase 124 only needs to emit `missing_org_id` from the *client side* (fail-fast before fetch). Server-side code parsing is Phase 125.

Externals not in scope this phase (deferred to Phase 125):
- `/arcanon:login` UX flow (AUTH-06)
- `/arcanon:status` Identity block (AUTH-07)
- Server error code parser for the other 6 codes (AUTH-08)
- Docs (AUTH-09)
</interfaces>

<predecessor_audit_pinned_risks>
<!-- Verbatim mitigations from .planning/PREDECESSOR-SURFACE.md — bake into tasks below. -->

C1 (AUTH-01 / AUTH-03 / AUTH-05 ordering): Plan must sequence AUTH-03 before AUTH-01: AUTH-03 expands `resolveCredentials` return shape with `orgId`; AUTH-01 then reads `creds.orgId` at the 2 worker/hub-sync/index.js call sites (lines 71, 146). Confirm zero callers destructure with `Object.keys` or otherwise depend on field-set parity. AUTH-01, AUTH-03, AUTH-05 are a coupled signature/contract block — none is buildable alone; they must land together in this phase.

C2 (AUTH-03 hasCredentials decision): Plan must spec how `hasCredentials()` (auth.js:120) handles missing-org-id. Two options: (a) keep `hasCredentials()` returning true when api_key resolves but org_id doesn't — defer the throw to upload time; (b) tighten `hasCredentials()` to require org_id, with a manager.js:941 WARN when auto-sync gates off. **THIS PLAN PICKS OPTION (a).** See decision rationale below. The HUB-01 auto-sync gate (manager.js:941, 949) MUST surface why uploads are silently skipped — silent gating is a regression.

C3 (AUTH-04 spread-merge): Plan must verify `storeCredentials`' existing spread-merge (`{...existing, api_key}` at auth.js:137) preserves `default_org_id` when only `api_key` is being rewritten. Add a unit test pinning: writing `api_key` on top of `{api_key, hub_url, default_org_id}` keeps all three. CHANGELOG `### BREAKING` entry must call out the upgrade path: existing v0.1.4 users will fail on next `/arcanon:sync` until they re-run `/arcanon:login` (or `/arcanon:login --org-id <uuid>`).

X1 (AUTH-05 manager threading): Plan must thread `orgId` through manager.js:937 destructure and manager.js:962 `syncFindings` call. Confirm the `_readHubConfig` return shape extension doesn't break manager.test.js fixtures. Phase ordering: AUTH-03 + AUTH-01 + AUTH-05 land together (single phase); landing AUTH-05 alone won't compile.
</predecessor_audit_pinned_risks>

<c2_decision>
**C2 Decision: option (a) — `hasCredentials()` stays org_id-tolerant; the throw is deferred to upload time.**

Rationale:
1. **Upgrade safety.** Existing v0.1.4 users have `{api_key, hub_url}` in `~/.arcanon/config.json` with no `default_org_id`. Option (b) would silently flip `hasCredentials()` to `false` on first upgrade, which then short-circuits the HUB-01 auto-sync gate at `manager.js:941, 949` — auto-sync turns off with no upload attempted, so the user never sees the actionable AuthError message naming the three resolution sources. They just see "hub auto-sync skipped — no api_token configured" (which is wrong; the api_token *is* configured) and have no breadcrumb to follow.
2. **Surface-of-failure correctness.** Option (a) keeps `hasCredentials()` semantically what its name says: "is there an api_key?" The org_id question is asked at upload time, where the actionable error message (AuthError naming all three resolution sources + recommending `/arcanon:login --org-id <uuid>`) lands directly in the scan-end log via the existing `slog('WARN', 'hub upload failed', { ... })` site at `manager.js:983-986`. Users see a coherent failure with a remediation, not a silent no-op.
3. **No silent gating.** The HUB-01 gate at `manager.js:941, 949` continues to fire upload attempts when `hasCredentials()` is true. The first upload throws `AuthError("Missing org_id...")`. `syncFindings()` already wraps `resolveCredentials` in a try/catch at `index.js:62-68` and returns `{ ok: false, error: err, warnings }` on `AuthError`. The existing `slog('WARN', 'hub upload failed', { ... })` at `manager.js:983-986` already surfaces `outcome.error.message` — meaning the AuthError's "Missing org_id, sources tried: ..." message lands verbatim in the scan-end WARN log. No new WARN seam needed, but Task 5 verifies this end-to-end by inspecting the log fixture.
4. **Test simplicity.** Option (a) keeps existing `auth.test.js` tests for `hasCredentials()` semantics unchanged (they assert "true when api_key set"). New tests pin the new contract: missing-org-id throws at upload time only, and the AuthError message lists all three sources.

**Implication for CHANGELOG (drafted in Task 6, pinned in Phase 127):**
> ### BREAKING — v0.1.5
> The plugin now requires an `org_id` (THE-1030 personal-credential model). `hasCredentials()` continues to report true on api-key-only configs for backward semantics, but the next `/arcanon:sync` will fail with `AuthError: Missing org_id (sources tried: opts.orgId, ARCANON_ORG_ID env, ~/.arcanon/config.json#default_org_id). Run /arcanon:login --org-id <uuid> to set the machine default.` Run `/arcanon:login --org-id <uuid>` (or set `ARCANON_ORG_ID`, or set `hub.org_id` in `arcanon.config.json`) to resume uploads. Hub-side THE-1030 deploy is a hard prerequisite for v0.1.5 to function end-to-end.
</c2_decision>

</context>

<tasks>

<task type="auto" tdd="true">
  <name>Task 1: AUTH-03 — Extend resolveCredentials with orgId precedence chain (FIRST per C1 ordering)</name>
  <files>
    plugins/arcanon/worker/hub-sync/auth.js
    plugins/arcanon/worker/hub-sync/auth.test.js
  </files>
  <behavior>
    Tests written FIRST (RED). Each test exercises the new contract; existing tests must not regress.

    NEW (must pass after Task 1):
    - Test A1: `resolveCredentials({apiKey: "arc_x", hubUrl: "https://h", orgId: "org-explicit"})` returns `{apiKey: "arc_x", hubUrl: "https://h", orgId: "org-explicit", source: "explicit"}`.
    - Test A2: `resolveCredentials({apiKey: "arc_x"})` with `process.env.ARCANON_ORG_ID = "org-env"` and no config returns `orgId: "org-env"`.
    - Test A3: `resolveCredentials({apiKey: "arc_x"})` with `~/.arcanon/config.json = {api_key: "arc_x", default_org_id: "org-cfg"}` and no env returns `orgId: "org-cfg"`.
    - Test A4: Precedence — opts.orgId beats ARCANON_ORG_ID beats default_org_id when all three are present.
    - Test A5: `resolveCredentials({apiKey: "arc_x"})` with no orgId source throws `AuthError`. The error's `.message` includes the literal substrings: `"opts.orgId"`, `"ARCANON_ORG_ID"`, `"default_org_id"`, AND `"/arcanon:login --org-id"`.
    - Test A6: `resolveCredentials()` with no apiKey still throws the original "No Arcanon Hub API key found" AuthError (existing api-key error message must not change).
    - Test A7 (option-a guard): `hasCredentials()` returns `true` when `process.env.ARCANON_API_KEY = "arc_x"` is set and no org_id source is present. (Pins option-a semantics.)

    EXISTING (must still pass):
    - All existing auth.test.js cases for api_key resolution, hub_url precedence, hasCredentials() truthy on api_key alone.

    Note: Tests run with `withTempHome(...)` and `clearEnv()` helpers already in auth.test.js — extend `clearEnv()` to also `delete process.env.ARCANON_ORG_ID`.
  </behavior>
  <action>
    AUTH-03 implementation (auth.js):

    1. Extend `resolveCredentials(opts)` to also resolve `orgId`. After the existing api_key + hubUrl resolution block (auth.js:58-100), add an org_id resolution block:
       ```js
       const homeCfg = readHomeConfig(); // already read at line 59 — reuse
       let orgId = null;
       if (opts.orgId) {
         orgId = opts.orgId;
       } else if (process.env.ARCANON_ORG_ID) {
         orgId = process.env.ARCANON_ORG_ID;
       } else if (homeCfg.default_org_id) {
         orgId = homeCfg.default_org_id;
       }

       if (!orgId) {
         throw new AuthError(
           "Missing org_id (sources tried: opts.orgId, ARCANON_ORG_ID env, ~/.arcanon/config.json#default_org_id).\n" +
             "  Run /arcanon:login --org-id <uuid> to set the machine default.\n" +
             "  Or set ARCANON_ORG_ID in your environment.\n" +
             "  Or add hub.org_id to this repo's arcanon.config.json for a per-repo override."
         );
       }

       return { apiKey, hubUrl, orgId, source };
       ```
       The `source` field continues to describe the api_key origin (do NOT extend it to a tuple — would break existing destructures at hub.js:179, 777, 1282). A future REQ can add `orgIdSource` if needed; not in v0.1.5 scope.

    2. Update the JSDoc for `resolveCredentials` to declare the new `orgId` opt and the new return shape `{ apiKey, hubUrl, orgId, source }`.

    3. **DO NOT MODIFY** `hasCredentials()` (auth.js:120-127). Per C2 option-a, it stays a try/catch wrapper — but because resolveCredentials now throws on missing org_id, hasCredentials() would erroneously turn false. Fix by passing a sentinel: change `hasCredentials()` body to call `resolveCredentials({ orgId: "__has_cred_probe__" })` so the org_id resolution succeeds with the probe value, and the function only reports on api_key presence. Document the probe with an inline comment naming option-a.

       Alternative implementation (cleaner): refactor resolveCredentials to a private `_resolveApiKey(opts)` and `_resolveOrgId(opts)`, and have hasCredentials call only `_resolveApiKey`. Choose whichever the executor finds clearer; both satisfy the test contract.

    4. **DO NOT** introduce a back-compat fallback for `org_id` -> `default_org_id`. The config field name is `default_org_id` (per AUTH-04), the env var is `ARCANON_ORG_ID`, the per-repo key is `hub.org_id` (per AUTH-05). These are three distinct keys at three distinct layers; do not unify them.

    5. Verify zero callers in the repo destructure `resolveCredentials()` with `Object.keys` or otherwise depend on field-set parity. Run `grep -rn "Object.keys.*resolveCredentials\|resolveCredentials.*Object.keys" plugins/` — expect zero hits. Document the grep result in the commit message.

    6. Atomic commit message: `feat(AUTH-03): resolveCredentials returns orgId via opts->env->config precedence`
  </action>
  <verify>
    <automated>cd plugins/arcanon &amp;&amp; node --test worker/hub-sync/auth.test.js</automated>
    <automated>grep -rn "Object.keys.*resolveCredentials\|resolveCredentials.*Object.keys" plugins/ ; test $? -eq 1</automated>
    <automated>grep -n "ARCANON_ORG_ID\|default_org_id\|orgId" plugins/arcanon/worker/hub-sync/auth.js | head -20</automated>
  </verify>
  <done>
    - All 7 new tests (A1-A7) pass.
    - All existing auth.test.js cases pass (no regression).
    - `resolveCredentials` JSDoc declares the new `orgId` opt and return shape.
    - hasCredentials() returns true on api-key-only configs (option-a verified by test A7).
    - Zero callers depend on field-set parity (grep returns 1, no matches).
    - Atomic commit landed: `feat(AUTH-03): resolveCredentials returns orgId via opts->env->config precedence`
  </done>
</task>

<task type="auto" tdd="true">
  <name>Task 2: AUTH-01 — Add X-Org-Id header to uploadScan + fail-fast on missing orgId</name>
  <files>
    plugins/arcanon/worker/hub-sync/client.js
    plugins/arcanon/worker/hub-sync/client.test.js
    plugins/arcanon/worker/hub-sync/index.js
  </files>
  <behavior>
    Tests written FIRST (RED). client.test.js exercises the new opt; index.js callers update to thread the new field.

    NEW (must pass after Task 2):
    - Test C1: `uploadScan(payload, {apiKey: "arc_x", hubUrl: "https://h", orgId: "org-1", fetchImpl: fakeFetch})` invokes fakeFetch with a request whose `headers["X-Org-Id"] === "org-1"`.
    - Test C2: `uploadScan(payload, {apiKey: "arc_x", hubUrl: "https://h", fetchImpl: fakeFetch})` (NO orgId) throws `HubError` with `.status === 400` and `.code === "missing_org_id"`. Assert fakeFetch is invoked **zero times** (the throw is BEFORE the network attempt).
    - Test C3: HubError gains a `.code` field. Existing tests that construct HubError without a code must see `.code === null` (additive, not breaking).
    - Test C4 (regression): on a 4xx/5xx response with `body.title` present, the error message still contains `body.title` per existing client.js:164 fallback (forward-compat with codes the plugin doesn't recognize). The Phase 125 AUTH-08 work parses the actual `body.code`; this phase only emits `missing_org_id` from the client side.

    EXISTING (must still pass):
    - All existing client.test.js cases for retry, timeout, 202 success, 4xx fail-fast, 429 backoff.
  </behavior>
  <action>
    AUTH-01 implementation (client.js):

    1. Extend `HubError` constructor (client.js:30-39) to accept and store a `code` field:
       ```js
       constructor(message, { status, retriable, body, attempts, code } = {}) {
         super(message);
         this.name = "HubError";
         this.status = status ?? null;
         this.retriable = Boolean(retriable);
         this.body = body ?? null;
         this.attempts = attempts ?? null;
         this.code = code ?? null; // NEW — AUTH-01/AUTH-08
       }
       ```
       Existing callers passing no `code` see `.code === null` (additive).

    2. Extend `uploadScan(payload, opts)` (client.js:94-186):
       - Destructure `orgId` from `opts` alongside `apiKey, hubUrl, ...`.
       - After the existing `if (!hubUrl) throw new HubError("hubUrl is required")` line (client.js:109), add BEFORE the serializePayload call:
         ```js
         if (!orgId) {
           throw new HubError(
             "Missing X-Org-Id header — orgId is required (THE-1029)",
             { status: 400, retriable: false, code: "missing_org_id" }
           );
         }
         ```
         Critical: this throw lands BEFORE `serializePayload(payload)` and BEFORE the for-loop that calls `fetchImpl`. Test C2 asserts fakeFetch is invoked zero times.
       - Inside the request (client.js:128-138), add `"X-Org-Id": orgId` to the headers object.
       - Update the JSDoc to declare the new `opts.orgId` parameter and its required-not-optional status.

    3. Update both call sites in worker/hub-sync/index.js to thread `creds.orgId`:
       - Line 71-75 (syncFindings): change to `await uploadScan(payload, { apiKey: creds.apiKey, hubUrl: creds.hubUrl, orgId: creds.orgId, log })`.
       - Line 146 (drainQueue): change to `await uploadScan(payload, { apiKey: creds.apiKey, hubUrl: creds.hubUrl, orgId: creds.orgId, log })`.
       Both index.js call sites already consume `creds = resolveCredentials({ apiKey: opts.apiKey, hubUrl: opts.hubUrl })` — extend those calls to also pass `orgId: opts.orgId` so AUTH-05 can later inject the per-repo override:
       - Line 64: `creds = resolveCredentials({ apiKey: opts.apiKey, hubUrl: opts.hubUrl, orgId: opts.orgId })`
       - Line 114: `creds = resolveCredentials({ apiKey: opts.apiKey, hubUrl: opts.hubUrl, orgId: opts.orgId })`
       Update syncFindings and drainQueue JSDoc to declare the new `opts.orgId` parameter.

    4. Atomic commit message: `feat(AUTH-01): uploadScan sends X-Org-Id; missing orgId throws HubError(code=missing_org_id) before fetch`
  </action>
  <verify>
    <automated>cd plugins/arcanon &amp;&amp; node --test worker/hub-sync/client.test.js</automated>
    <automated>grep -n "X-Org-Id" plugins/arcanon/worker/hub-sync/client.js</automated>
    <automated>grep -n "missing_org_id" plugins/arcanon/worker/hub-sync/client.js</automated>
    <automated>grep -n "creds.orgId\|orgId: creds" plugins/arcanon/worker/hub-sync/index.js</automated>
  </verify>
  <done>
    - All 4 new tests (C1-C4) pass.
    - All existing client.test.js cases pass.
    - `X-Org-Id` header lands on the request when orgId is present.
    - Missing orgId throws HubError(status=400, code='missing_org_id') BEFORE fetch is invoked (Test C2 fakeFetch call-count assertion).
    - HubError gained `.code` field (additive, default null).
    - index.js syncFindings + drainQueue both thread `orgId` from resolveCredentials -> uploadScan.
    - Existing body.title fallback (client.js:164) preserved (Test C4).
    - Atomic commit landed: `feat(AUTH-01): uploadScan sends X-Org-Id; missing orgId throws HubError(code=missing_org_id) before fetch`
  </done>
</task>

<task type="auto" tdd="true">
  <name>Task 3: AUTH-04 — Persist default_org_id in ~/.arcanon/config.json with spread-merge preservation</name>
  <files>
    plugins/arcanon/worker/hub-sync/auth.js
    plugins/arcanon/worker/hub-sync/auth.test.js
  </files>
  <behavior>
    Tests written FIRST (RED). The C3 spread-merge preservation test is the load-bearing assertion.

    NEW (must pass after Task 3):
    - Test S1: `storeCredentials("arc_new", {hubUrl: "https://h", defaultOrgId: "org-1"})` writes `{api_key: "arc_new", hub_url: "https://h", default_org_id: "org-1"}` to `~/.arcanon/config.json`.
    - Test S2 (C3 spread-merge): given an existing file `{api_key: "arc_old", hub_url: "https://h", default_org_id: "org-existing"}`, calling `storeCredentials("arc_rotated")` (api_key only, no opts.hubUrl, no opts.defaultOrgId) writes `{api_key: "arc_rotated", hub_url: "https://h", default_org_id: "org-existing"}` — both unrelated keys preserved.
    - Test S3: file mode is 0600 after every write; dir mode is 0700 after creation.
    - Test S4: `storeCredentials("arc_x", {defaultOrgId: "org-2"})` with no `hubUrl` opt and no existing file writes `{api_key: "arc_x", default_org_id: "org-2"}` (no hub_url field) — does NOT default-fill DEFAULT_HUB_URL into the file (matches existing semantics; resolveCredentials handles defaulting at read time).
    - Test S5: passing an unknown key on existing config — `storeCredentials("arc_x")` on `{api_key: "x", hub_url: "h", future_field: "preserved"}` keeps `future_field`. Pins the spread-merge for forward-compat.
  </behavior>
  <action>
    AUTH-04 implementation (auth.js:129-146):

    1. Extend `storeCredentials(apiKey, opts)` to accept `opts.defaultOrgId`:
       ```js
       export function storeCredentials(apiKey, opts = {}) {
         if (!apiKey || !apiKey.startsWith(API_KEY_PREFIX)) {
           throw new AuthError(`api_key must start with "${API_KEY_PREFIX}"`);
         }
         const dir = path.join(os.homedir(), ".arcanon");
         fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
         const file = path.join(dir, "config.json");
         const existing = readJsonSafe(file) || {};
         const next = { ...existing, api_key: apiKey };
         if (opts.hubUrl) next.hub_url = opts.hubUrl;
         if (opts.defaultOrgId) next.default_org_id = opts.defaultOrgId; // NEW — AUTH-04
         fs.writeFileSync(file, JSON.stringify(next, null, 2) + "\n", { mode: 0o600 });
         try { fs.chmodSync(file, 0o600); } catch { /* non-POSIX FS */ }
         return file;
       }
       ```
       The spread-merge `{ ...existing, api_key: apiKey }` (auth.js:137) ALREADY preserves `default_org_id` when `opts.defaultOrgId` is undefined — confirm by writing Test S2 and watching it pass without touching the spread line. The change is a single conditional `if (opts.defaultOrgId)` line, NOT a refactor of the spread.

    2. Update the JSDoc for `storeCredentials` to declare the new `opts.defaultOrgId` parameter.

    3. **DO NOT** update `worker/cli/hub.js:163 cmdLogin` to thread `defaultOrgId` yet — that's AUTH-06 in Phase 125. This phase only adds the storage primitive; Phase 125 wires it into the login UX.

    4. Atomic commit message: `feat(AUTH-04): storeCredentials persists default_org_id with spread-merge preservation`
  </action>
  <verify>
    <automated>cd plugins/arcanon &amp;&amp; node --test worker/hub-sync/auth.test.js</automated>
    <automated>grep -n "default_org_id\|defaultOrgId" plugins/arcanon/worker/hub-sync/auth.js</automated>
  </verify>
  <done>
    - All 5 new tests (S1-S5) pass; S2 (C3 spread-merge preservation) is the critical regression guard.
    - All existing auth.test.js cases pass.
    - File mode 0600 + dir mode 0700 preserved.
    - Spread-merge primitive untouched at auth.js:137 (additive `if (opts.defaultOrgId)` only).
    - Atomic commit landed: `feat(AUTH-04): storeCredentials persists default_org_id with spread-merge preservation`
  </done>
</task>

<task type="auto" tdd="true">
  <name>Task 4: AUTH-02 — New whoami.js client calling GET /api/v1/auth/whoami</name>
  <files>
    plugins/arcanon/worker/hub-sync/whoami.js
    plugins/arcanon/worker/hub-sync/whoami.test.js
    plugins/arcanon/worker/hub-sync/index.js
  </files>
  <behavior>
    Tests written FIRST (RED). New module; new tests.

    NEW (must pass after Task 4):
    - Test W1: `getKeyInfo("arc_x", "https://h")` against a fakeFetch returning 200 + `{user_id: "u1", key_id: "k1", scopes: ["read","write"], grants: [{org_id: "o1", org_name: "Acme"}]}` returns the parsed object verbatim.
    - Test W2: `getKeyInfo("arc_x", "https://h")` against a fakeFetch returning 401 throws `AuthError`. Error message includes the api-key preview (`arc_xxxx…`) but NEVER the full key.
    - Test W3: `getKeyInfo("arc_x", "https://h")` against a fakeFetch returning 403 throws `AuthError`.
    - Test W4: `getKeyInfo("arc_x", "https://h")` against a fakeFetch that throws (network error) wraps and throws `HubError` with `.retriable = true` and `.message` including the underlying error message.
    - Test W5: `getKeyInfo("arc_x", "https://h")` against a fakeFetch returning 500 throws `HubError` with `.status = 500` and `.retriable = true`.
    - Test W6: Request shape — fakeFetch is called with URL = `https://h/api/v1/auth/whoami`, method = `GET`, and headers including `Authorization: Bearer arc_x` and `Accept: application/json`. **NO `X-Org-Id` header on this endpoint** (whoami is the bootstrap call that discovers org_id; can't require it).
    - Test W7: Empty grants array — server returns `{user_id, key_id, scopes, grants: []}` — `getKeyInfo` returns the empty grants verbatim. Phase 125 AUTH-06 decides what to do with N=0; whoami client doesn't make the call.

    NEW: integration export — `index.js` re-exports `getKeyInfo`.
  </behavior>
  <action>
    AUTH-02 implementation (new file whoami.js):

    1. Create `plugins/arcanon/worker/hub-sync/whoami.js`:
       ```js
       /**
        * worker/hub-sync/whoami.js — Arcanon Hub /auth/whoami client (THE-1030).
        *
        * Calls GET ${hubUrl}/api/v1/auth/whoami with Bearer token. Returns the
        * parsed `{user_id, key_id, scopes, grants}` payload on 200. Used by
        * /arcanon:login (AUTH-06) and /arcanon:status (AUTH-07).
        *
        * Does NOT carry X-Org-Id — whoami is the bootstrap that DISCOVERS the
        * org_id. Requiring it would create a chicken-and-egg.
        */
       import { AuthError } from "./auth.js";
       import { HubError } from "./client.js";

       export const WHOAMI_PATH = "/api/v1/auth/whoami";
       export const DEFAULT_TIMEOUT_MS = 10_000;

       function previewKey(apiKey) {
         if (!apiKey || apiKey.length < 8) return "arc_***";
         return `${apiKey.slice(0, 7)}…${apiKey.slice(-4)}`;
       }

       /**
        * @param {string} apiKey — must start with arc_
        * @param {string} hubUrl
        * @param {{ timeoutMs?: number, fetchImpl?: typeof fetch, log?: Function }} [opts]
        * @returns {Promise<{ user_id: string, key_id: string, scopes: string[], grants: Array<{org_id, org_name}> }>}
        * @throws {AuthError} on 401/403
        * @throws {HubError} on network/transport/5xx
        */
       export async function getKeyInfo(apiKey, hubUrl, opts = {}) {
         const fetchImpl = opts.fetchImpl || globalThis.fetch;
         const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;
         const log = opts.log || (() => {});
         if (!fetchImpl) throw new HubError("fetch() unavailable — Node.js >= 18 required");
         if (!apiKey) throw new AuthError("apiKey is required");
         if (!hubUrl) throw new HubError("hubUrl is required");

         const url = new URL(WHOAMI_PATH, hubUrl).toString();
         const controller = new AbortController();
         const timer = setTimeout(() => controller.abort(), timeoutMs);

         let response;
         try {
           response = await fetchImpl(url, {
             method: "GET",
             headers: {
               Authorization: `Bearer ${apiKey}`,
               Accept: "application/json",
               "User-Agent": "arcanon-plugin-hub-sync",
             },
             signal: controller.signal,
           });
         } catch (err) {
           clearTimeout(timer);
           throw new HubError(`whoami network error: ${err.message}`, { retriable: true });
         }
         clearTimeout(timer);

         let body = null;
         try { body = await response.json(); } catch { body = null; }

         if (response.status === 200) {
           return body;
         }
         if (response.status === 401 || response.status === 403) {
           throw new AuthError(
             `whoami rejected for key ${previewKey(apiKey)} (status ${response.status}${body?.title ? `: ${body.title}` : ""})`
           );
         }
         throw new HubError(
           `whoami returned ${response.status}${body?.title ? `: ${body.title}` : ""}`,
           { status: response.status, retriable: response.status >= 500, body }
         );
       }
       ```

    2. Update `worker/hub-sync/index.js` to re-export `getKeyInfo`. Add to the existing export block (after line 33):
       ```js
       export { getKeyInfo } from "./whoami.js";
       ```

    3. Atomic commit message: `feat(AUTH-02): add whoami.js client for GET /api/v1/auth/whoami`
  </action>
  <verify>
    <automated>cd plugins/arcanon &amp;&amp; node --test worker/hub-sync/whoami.test.js</automated>
    <automated>grep -n "getKeyInfo" plugins/arcanon/worker/hub-sync/index.js</automated>
    <automated>test -f plugins/arcanon/worker/hub-sync/whoami.js</automated>
  </verify>
  <done>
    - All 7 new whoami.test.js tests (W1-W7) pass.
    - whoami.js exports `getKeyInfo` and `WHOAMI_PATH`.
    - index.js re-exports `getKeyInfo` for downstream Phase 125 consumers.
    - No `X-Org-Id` header on whoami requests (Test W6 explicit assertion).
    - Atomic commit landed: `feat(AUTH-02): add whoami.js client for GET /api/v1/auth/whoami`
  </done>
</task>

<task type="auto" tdd="true">
  <name>Task 5: AUTH-05 — Thread per-repo cfg.hub.org_id through manager.js into syncFindings</name>
  <files>
    plugins/arcanon/worker/scan/manager.js
    plugins/arcanon/worker/scan/manager.test.js
  </files>
  <behavior>
    Tests written FIRST (RED). manager.js is large; this task touches `_readHubConfig`, the destructure at line 937, and the `syncFindings` call at line 962-971.

    NEW (must pass after Task 5):
    - Test M1: `_readHubConfig()` (private — tested via export-for-test or via injecting cwd) returns `{hubAutoSync, hubUrl, projectSlug, libraryDepsEnabled, orgId}` when `arcanon.config.json` contains `{"hub": {"org_id": "org-repo"}}`.
    - Test M2: `_readHubConfig()` returns `orgId: undefined` when no `hub.org_id` is set.
    - Test M3 (precedence wire test): given a stub syncFindings spy, scanRepos called with config containing `hub.org_id: "org-repo"` AND `process.env.ARCANON_ORG_ID = "org-env"` invokes syncFindings with `{...orgId: "org-repo"}` — repo override wins. (This is the integration-style assertion. If manager.test.js doesn't already inject syncFindings as a dep, mock via vi/sinon-style or by exposing a setter; pick whatever pattern manager.test.js already uses.)
    - Test M4 (existing fixture compatibility): existing manager.test.js fixtures using `_readHubConfig` mocks/stubs continue to pass without modification (the new `orgId` field is purely additive; default `undefined` is safe).

    EXISTING (must still pass):
    - All existing manager.test.js cases.
  </behavior>
  <action>
    AUTH-05 implementation (manager.js):

    1. Extend `_readHubConfig` (manager.js:84-97) to read `cfg?.hub?.org_id`:
       ```js
       function _readHubConfig() {
         try {
           const cfgPath = resolveConfigPath(process.cwd());
           const cfg = JSON.parse(readFileSync(cfgPath, "utf8"));
           return {
             hubAutoSync: _readHubAutoSync(cfg?.hub),
             hubUrl: cfg?.hub?.url,
             projectSlug: cfg?.hub?.["project-slug"] || cfg?.["project-name"],
             libraryDepsEnabled: Boolean(cfg?.hub?.beta_features?.library_deps),
             orgId: cfg?.hub?.org_id, // NEW — AUTH-05 (per-repo override)
           };
         } catch {
           return { hubAutoSync: false, hubUrl: undefined, projectSlug: undefined, libraryDepsEnabled: false, orgId: undefined };
         }
       }
       ```
       Update the JSDoc `@returns` annotation to include `orgId`.

    2. Extend the destructure at manager.js:937:
       ```js
       const { hubAutoSync, hubUrl, projectSlug, libraryDepsEnabled, orgId } = _readHubConfig();
       ```

    3. Extend the syncFindings call at manager.js:962-971 to thread `orgId`:
       ```js
       const outcome = await syncFindings({
         findings: r.findings,
         repoPath: r.repoPath,
         projectSlug,
         hubUrl,
         orgId, // NEW — AUTH-05; per-repo override into AUTH-03 precedence chain (opts.orgId beats env beats default)
         scanMode: r.mode,
         libraryDepsEnabled,
         log: (level, msg, data) => slog(level, `hub-sync: ${msg}`, data),
       });
       ```
       Because `syncFindings` (index.js:48-98) calls `resolveCredentials({ apiKey: opts.apiKey, hubUrl: opts.hubUrl, orgId: opts.orgId })` (after Task 2), and `resolveCredentials` precedence is `opts.orgId > env > home-config` (after Task 1), the per-repo override beats env beats machine default automatically.

    4. **C2/option-a verification step.** Run a manual integration check (NOT a unit test — verified by code inspection): the existing `slog('WARN', 'hub upload failed', { repoPath: r.repoPath, error: outcome.error?.message })` at manager.js:983-986 already surfaces `outcome.error.message`. Because `syncFindings` (index.js:62-68) catches `AuthError` and returns `{ ok: false, error: err, warnings }`, an `AuthError("Missing org_id ...")` raised at upload time lands as `outcome.error.message` in the WARN log. **Verify by inspecting the log fixture in Test M3: when orgId is missing AND hasCredentials returns true, the WARN log line MUST contain the literal substring "Missing org_id" and must NOT contain "no api_token configured" (which is the wrong-cause message).**

    5. Verify existing manager.test.js fixtures don't break. If any fixture stubs `_readHubConfig` to return a fixed object, audit those stubs — the new `orgId` field is additive, returning `undefined` is safe for any consumer that doesn't read it. If a stub uses strict deep-equal against the return value, update it to include `orgId: undefined`.

    6. Atomic commit message: `feat(AUTH-05): thread per-repo cfg.hub.org_id through manager.js into syncFindings`
  </action>
  <verify>
    <automated>cd plugins/arcanon &amp;&amp; node --test worker/scan/manager.test.js</automated>
    <automated>grep -n "cfg?.hub?.org_id\|orgId:" plugins/arcanon/worker/scan/manager.js | head -10</automated>
    <automated>cd plugins/arcanon &amp;&amp; node --test worker/hub-sync/</automated>
  </verify>
  <done>
    - All 4 new manager.test.js tests (M1-M4) pass.
    - All existing manager.test.js cases pass.
    - `_readHubConfig` returns `orgId` (additive field).
    - manager.js:937 destructure includes `orgId`.
    - syncFindings call at manager.js:962 threads `orgId`.
    - Per-repo override beats env beats default (Test M3 confirms via end-to-end wire).
    - Manager.js WARN log surfaces "Missing org_id ..." message at scan-end when applicable (option-a / C2 surface check).
    - Atomic commit landed: `feat(AUTH-05): thread per-repo cfg.hub.org_id through manager.js into syncFindings`
  </done>
</task>

<task type="auto">
  <name>Task 6: Phase 124 integration test + drafted CHANGELOG BREAKING entry</name>
  <files>
    plugins/arcanon/worker/hub-sync/integration.test.js
    .planning/phases/124-hub-auth-core/124-CHANGELOG-DRAFT.md
  </files>
  <action>
    1. Add a new integration test case to `plugins/arcanon/worker/hub-sync/integration.test.js` (file already exists per `ls hub-sync/`). Pin the end-to-end wire: per-repo `hub.org_id` -> `_readHubConfig` -> `syncFindings` -> `resolveCredentials` opts.orgId precedence -> `uploadScan` -> X-Org-Id header. Use a fakeFetch and a tempdir-based arcanon.config.json + ~/.arcanon/config.json. Test name: `"AUTH-01..05 e2e: per-repo hub.org_id beats ARCANON_ORG_ID beats default_org_id; X-Org-Id header lands"`.

       Test outline:
       - Setup: tempdir HOME with `~/.arcanon/config.json = {api_key: "arc_x", default_org_id: "org-default"}`. Set `process.env.ARCANON_ORG_ID = "org-env"`. CWD'd into a tempdir with `arcanon.config.json = {hub: {auto-sync: true, org_id: "org-repo", project-slug: "p"}}`.
       - Invoke `syncFindings({ findings: stubFindings, repoPath: tempCwd, projectSlug: "p", orgId: "org-repo", fetchImpl: fakeFetch })` (orgId is threaded by manager.js in real flow; integration test injects directly).
       - Assert: fakeFetch was called once with `headers["X-Org-Id"] === "org-repo"`. NOT "org-env", NOT "org-default".
       - Bonus: a second case where `orgId` is omitted and ARCANON_ORG_ID is set — fakeFetch sees `X-Org-Id: "org-env"`. Third case — only `default_org_id` in config, fakeFetch sees `X-Org-Id: "org-default"`.

    2. Draft the v0.1.5 CHANGELOG BREAKING entry to be pinned in Phase 127 (VER-02). Write `.planning/phases/124-hub-auth-core/124-CHANGELOG-DRAFT.md`:

       ```markdown
       # CHANGELOG draft for v0.1.5 — Phase 124 (Hub Auth Core)

       ## Pin into CHANGELOG.md `[0.1.5]` BREAKING section in Phase 127:

       ### BREAKING
       - **Hub uploads now require `org_id` (THE-1029, paired with arcanon-hub THE-1030).**
         Every scan upload sends an `X-Org-Id: <uuid>` HTTP header. Calling `uploadScan`
         without an `orgId` throws `HubError(status=400, code='missing_org_id')` BEFORE the
         network attempt. Resolution precedence: `opts.orgId` -> `ARCANON_ORG_ID` env ->
         `~/.arcanon/config.json#default_org_id`. Per-repo override beats env beats machine default.

         **Upgrade path for v0.1.4 users:** Existing `~/.arcanon/config.json` files contain
         `{api_key, hub_url}` but no `default_org_id`. The next `/arcanon:sync` (or any auto-sync
         on scan-end) will fail with:

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
         401/403; throws `HubError` on transport/5xx.

       ### Changed
       - **`resolveCredentials` return shape** extended to `{apiKey, hubUrl, orgId, source}`.
         The `source` field continues to describe the api_key origin only (existing
         destructures unaffected). Missing `orgId` throws `AuthError` whose message names
         all three resolution sources.
       - **`storeCredentials(apiKey, opts)`** accepts `opts.defaultOrgId` and persists it as
         `default_org_id` in `~/.arcanon/config.json`. Existing keys preserved via spread-merge.
         File mode 0600 / dir mode 0700 unchanged.
       - **`worker/scan/manager.js _readHubConfig`** reads per-repo `hub.org_id` from
         `arcanon.config.json` and threads it into `syncFindings` -> `uploadScan`.
       ```

    3. Atomic commit message: `test(124): integration test for AUTH-01..05 e2e wire + draft CHANGELOG BREAKING entry`
  </action>
  <verify>
    <automated>cd plugins/arcanon &amp;&amp; node --test worker/hub-sync/integration.test.js</automated>
    <automated>cd plugins/arcanon &amp;&amp; node --test worker/hub-sync/ worker/scan/manager.test.js</automated>
    <automated>test -f .planning/phases/124-hub-auth-core/124-CHANGELOG-DRAFT.md</automated>
  </verify>
  <done>
    - integration.test.js gains 3 new e2e cases pinning the precedence wire and X-Org-Id header.
    - All 3 cases pass.
    - 124-CHANGELOG-DRAFT.md exists with BREAKING + Added + Changed sections drafted for Phase 127 pin.
    - All hub-sync tests green; manager.test.js green.
    - Atomic commit landed: `test(124): integration test for AUTH-01..05 e2e wire + draft CHANGELOG BREAKING entry`
  </done>
</task>

</tasks>

<test_plan>

## Per-REQ Test Coverage

| REQ | Unit Tests | Integration Tests | File |
|-----|------------|-------------------|------|
| AUTH-01 | C1 (X-Org-Id header lands), C2 (missing orgId fail-fast pre-fetch), C3 (HubError.code additive), C4 (body.title fallback preserved) | "AUTH-01..05 e2e: per-repo hub.org_id beats env beats default; X-Org-Id lands" | client.test.js, integration.test.js |
| AUTH-02 | W1 (200 returns parsed grants), W2 (401 -> AuthError), W3 (403 -> AuthError), W4 (network -> HubError retriable), W5 (5xx -> HubError retriable), W6 (no X-Org-Id on whoami), W7 (empty grants array passes through) | (none — Phase 125 AUTH-06 exercises end-to-end) | whoami.test.js |
| AUTH-03 | A1 (explicit orgId), A2 (env), A3 (config), A4 (precedence), A5 (missing throws + message format), A6 (api_key error unchanged), A7 (hasCredentials option-a) | (covered by integration test wire) | auth.test.js, integration.test.js |
| AUTH-04 | S1 (write all three), S2 (spread-merge preserves default_org_id when only api_key rewritten), S3 (mode 0600), S4 (no hub_url default-fill), S5 (forward-compat unknown keys preserved) | (none required) | auth.test.js |
| AUTH-05 | M1 (`_readHubConfig` returns orgId), M2 (undefined when not set), M3 (per-repo wins via syncFindings spy), M4 (existing fixture compat) | (covered by integration test wire) | manager.test.js, integration.test.js |

## Test Execution Order

```bash
# Unit tests (per-task verification)
cd plugins/arcanon && node --test worker/hub-sync/auth.test.js       # Tasks 1, 3
cd plugins/arcanon && node --test worker/hub-sync/client.test.js     # Task 2
cd plugins/arcanon && node --test worker/hub-sync/whoami.test.js     # Task 4
cd plugins/arcanon && node --test worker/scan/manager.test.js        # Task 5

# Integration test (Task 6 + final acceptance gate)
cd plugins/arcanon && node --test worker/hub-sync/integration.test.js

# Full hub-sync suite (final smoke)
cd plugins/arcanon && node --test worker/hub-sync/ worker/scan/manager.test.js
```

## Tests Explicitly NOT Added in Phase 124

These are AUTH-10 territory (Phase 126) and are explicitly deferred:

- Full enumeration of all 7 AUTH-08 server error codes (`missing_x_org_id`, `invalid_x_org_id`, `insufficient_scope`, `key_not_authorized_for_org`, `not_a_member`, `forbidden_scan`, `invalid_key`) — Phase 125 ships AUTH-08 parser, Phase 126 ships the test suite enumerating the codes.
- `/arcanon:login` flow tests (with vs without `--org-id`, N=0/1/N grants behavior) — AUTH-06 is Phase 125.
- `/arcanon:status` Identity block tests — AUTH-07 is Phase 125.

</test_plan>

<verification>

## Phase-Level Acceptance Gate (every success criterion must be true)

| Criterion (verbatim from ROADMAP.md) | Verification |
|--------------------------------------|--------------|
| 1. `uploadScan(payload, {apiKey, hubUrl, orgId})` sends `X-Org-Id: <orgId>` header on POST to `${hubUrl}/api/v1/scans/upload`; calling without orgId throws `HubError(status=400, code='missing_org_id')` BEFORE the network attempt. | Tests C1 + C2. C2 specifically asserts fakeFetch invocation count = 0 when orgId is missing. |
| 2. `getKeyInfo(apiKey, hubUrl)` against a hub honoring THE-1030 returns `{user_id, key_id, scopes, grants}`; auth failures throw `AuthError`; transport failures throw `HubError`. | Tests W1, W2, W3, W4, W5. |
| 3. `resolveCredentials(opts)` returns `{apiKey, hubUrl, orgId, source}` with precedence opts -> env -> config; missing org id throws `AuthError` whose message names all three sources. | Tests A1, A2, A3, A4, A5. A5 explicitly asserts message contains `"opts.orgId"`, `"ARCANON_ORG_ID"`, `"default_org_id"`, AND `"/arcanon:login --org-id"`. |
| 4. `storeCredentials(apiKey, {hubUrl, defaultOrgId})` on existing config preserves any unrelated keys via spread-merge; mode-0600 file permission preserved. | Tests S1, S2, S3, S5. S2 is the load-bearing C3 spread-merge regression test. |
| 5. Per-repo `hub.org_id` in `arcanon.config.json` causes that repo's scan upload to send the override even when `ARCANON_ORG_ID` is set globally. | Test M3 + the integration test "AUTH-01..05 e2e" — the latter is the gold acceptance assertion (asserts fakeFetch sees `X-Org-Id: "org-repo"` when both env and default are also set). |

## C1/C2/C3/X1 Risk Mitigation Verification

- **C1 (ordering):** Tasks 1 (AUTH-03) -> 2 (AUTH-01) -> 3 (AUTH-04) -> 4 (AUTH-02) -> 5 (AUTH-05) -> 6 (integration). Sequential within the wave by design — Task 2 cannot pass tests until Task 1 ships `creds.orgId`; Task 5 cannot pass tests until Task 2 ships `uploadScan` accepting `orgId`. Atomic commits land in this order.
- **C2 (hasCredentials option-a):** Pinned by Test A7 (hasCredentials returns true with api-key-only) AND by inspection in Task 5's option-a surface check (manager.js WARN log surfaces "Missing org_id" verbatim).
- **C3 (spread-merge):** Pinned by Test S2.
- **X1 (manager threading):** Pinned by Tests M1, M2, M4 (no fixture regression) and the integration test wire.

## Manual Verification (NOT in this phase)

- Real-hub end-to-end: deferred to Phase 127 VER-04 (verification phase). Requires arcanon-hub THE-1030 deployed.
- `/arcanon:login` UX: deferred to Phase 125.

</verification>

<success_criteria>

Phase 124 ships when ALL of the following are true:

1. All 5 success criteria from ROADMAP.md (verbatim above) verified by automated tests.
2. All 6 tasks committed with their atomic commit messages.
3. `node --test plugins/arcanon/worker/hub-sync/ plugins/arcanon/worker/scan/manager.test.js` exits 0 with zero new pre-existing-mock carryforwards.
4. `grep -rn "Object.keys.*resolveCredentials\|resolveCredentials.*Object.keys" plugins/` returns zero hits (C1 field-set parity audit).
5. C2 decision (option-a) recorded in plan frontmatter and verified by Test A7.
6. C3 spread-merge regression guard (Test S2) green.
7. X1 manager.js fixture compatibility (Test M4) green.
8. `124-CHANGELOG-DRAFT.md` exists in the phase directory with BREAKING + Added + Changed sections.
9. `124-SUMMARY.md` written by execute-plan capturing the C2 decision rationale and the AUTH-08 deferral note (Phase 125's job).

**Acceptance gate (one-liner):**

```bash
cd /Users/ravichillerega/sources/arcanon && \
  cd plugins/arcanon && \
  node --test worker/hub-sync/ worker/scan/manager.test.js && \
  cd ../.. && \
  test -f .planning/phases/124-hub-auth-core/124-CHANGELOG-DRAFT.md && \
  echo "PHASE 124 ACCEPTANCE: GREEN"
```

</success_criteria>

<output>
After completion, create `.planning/phases/124-hub-auth-core/124-SUMMARY.md` per `$HOME/.claude/get-shit-done/templates/summary.md`. The summary MUST include:

1. **C2 decision recorded:** Option (a) — hasCredentials() org_id-tolerant; throw deferred to upload time. Rationale (4 bullets) verbatim from this plan's `<c2_decision>` block.
2. **Phase 125 handoff notes:**
   - AUTH-06 (`/arcanon:login --org-id <uuid>`) consumes `getKeyInfo` from `worker/hub-sync/whoami.js` (re-exported via `index.js`) and `storeCredentials(apiKey, {hubUrl, defaultOrgId})` from `worker/hub-sync/auth.js`.
   - AUTH-07 (`/arcanon:status` Identity block) consumes the same `getKeyInfo` plus `resolveCredentials` (which now returns `orgId` + `source`).
   - AUTH-08 (server error code parser) extends the `HubError` `.code` field added in Task 2; `body.title` fallback preserved per Test C4.
3. **CHANGELOG draft pointer:** "See `124-CHANGELOG-DRAFT.md` for the BREAKING entry to be pinned in Phase 127 VER-02."
4. **Hard external dependency reminder:** "End-to-end against a real hub is gated on arcanon-hub THE-1030 deploy. All Phase 124 tests pass against fakeFetch."
5. **Files modified inventory** (5 source files + 1 new file + 3 test files + 1 plan-dir markdown).
</output>
