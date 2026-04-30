---
phase: 125-login-and-status-ux
milestone: v0.1.5
phase_number: 125
phase_name: Login & Status UX
plans:
  - id: 125-01
    name: Login flow + structured error-code parser
    requirements: [AUTH-06, AUTH-08]
    wave: 1
    depends_on: []
    autonomous: false
    files_modified:
      - plugins/arcanon/commands/login.md
      - plugins/arcanon/worker/cli/hub.js
      - plugins/arcanon/worker/hub-sync/client.js
      - plugins/arcanon/worker/hub-sync/index.js
  - id: 125-02
    name: Status Identity block + docs sweep
    requirements: [AUTH-07, AUTH-09]
    wave: 2
    depends_on: [125-01]
    autonomous: false
    files_modified:
      - plugins/arcanon/commands/status.md
      - plugins/arcanon/worker/cli/hub.js
      - plugins/arcanon/arcanon.config.json.example
      - docs/hub-integration.md
      - docs/getting-started.md
      - docs/configuration.md
depends_on_phases: [124]
hard_dependencies:
  - "arcanon-hub THE-1030 deployed (whoami endpoint live; X-Org-Id enforced; RFC 7807 error envelope with .code field)"
tags: [auth, ux, identity, error-handling, docs, hub-integration]
---

# Phase 125 — Login & Status UX

## Goal

Users get a guided `/arcanon:login` flow that auto-resolves org id from `whoami`, see their resolved identity in `/arcanon:status`, and receive actionable error messages on every server-side auth failure. Docs and the example config document the new resolution model end-to-end.

## Phase-Level Dependencies

- **Phase 124 must be complete:** AUTH-01 (`X-Org-Id` header), AUTH-02 (`whoami.js` with `getKeyInfo()`, `AuthError` class), AUTH-03 (`resolveCredentials()` returns `{apiKey, hubUrl, orgId, source}`), AUTH-04 (`storeCredentials()` accepts and persists `default_org_id`), AUTH-05 (`hub.org_id` per-repo override) all landed.
- **arcanon-hub THE-1030 deployed:** the hub must return RFC 7807 error envelopes with a custom `code` field for the 7 enumerated codes; the `whoami` endpoint must be live. This phase ships AFTER the hub deploy.

## Pinned Decisions (resolve pre-flight notes from predecessor audit)

### Decision D-125-01 — Error envelope shape (resolves C4 / AUTH-08)

The plugin parses RFC 7807 problem-details JSON with a custom `code` extension:

```json
{
  "type": "https://api.arcanon.dev/problems/key-not-authorized-for-org",
  "title": "Key not authorized for org",
  "status": 403,
  "detail": "API key arc_xxxx…1234 has no grant for org 7f3e…",
  "code": "key_not_authorized_for_org"
}
```

- The plugin reads `body.code` first.
- If `body.code` is **unrecognized OR absent**, fall back to the existing `body.title` rendering at `client.js:164` (forward-compat for codes the plugin doesn't yet recognize).
- `HubError` gains a new `code` field (`string|null`); existing `.status`, `.retriable`, `.body`, `.attempts` are unchanged.
- Code-to-message map is centralized in `client.js` (single source of truth — UI surfaces just print the message).

The 7 codes and their user-facing messages:

| Code | Status | User-facing message |
| --- | --- | --- |
| `missing_x_org_id` | 400 | `hub rejected upload: X-Org-Id header missing — re-run /arcanon:login or set ARCANON_ORG_ID` |
| `invalid_x_org_id` | 400 | `hub rejected upload: X-Org-Id is not a valid uuid — fix arcanon.config.json hub.org_id, ARCANON_ORG_ID, or re-run /arcanon:login --org-id <uuid>` |
| `insufficient_scope` | 403 | `hub rejected upload: API key is missing the required scope for this operation — generate a key with scan:write at https://app.arcanon.dev/settings/api-keys` |
| `key_not_authorized_for_org` | 403 | `hub rejected upload: API key is not authorized for this org — run /arcanon:login --org-id <uuid> to switch, or ask your admin to grant the key` |
| `not_a_member` | 403 | `hub rejected upload: you are not a member of this org — ask an org admin to invite your user (the API key owner)` |
| `forbidden_scan` | 403 | `hub rejected upload: this scan is forbidden by org policy — contact your org admin` |
| `invalid_key` | 401 | `hub rejected upload: API key is invalid or revoked — generate a new key at https://app.arcanon.dev/settings/api-keys, then /arcanon:login arc_…` |

Unknown / absent `code` → `hub returned <status>: <body.title>` (existing behavior).

### Decision D-125-02 — `/arcanon:login` whoami branch table (resolves C5 / AUTH-06)

Behavior matrix for the four whoami outcomes × `--org-id` provided / not:

| whoami outcome | `--org-id` provided | `--org-id` not provided |
| --- | --- | --- |
| **success** | Verify the supplied org id appears in `grants[]`. If yes → store triple, announce `✓ verified: signed in to org <slug> (<uuid>) as <user_id>`. If no → store triple, emit WARN `⚠ key is not authorized for org <uuid> — server will reject uploads. Run /arcanon:login --org-id <uuid> with one of: <listed grants> to switch.` Exit 0 in both sub-cases. | Apply grant resolution: **0 grants** → fail loud (exit 2) `error: key has no org grants — ask your admin to grant the key access at https://app.arcanon.dev/settings/api-keys`. **1 grant** → auto-select; store triple; announce `✓ auto-selected org <slug> (<uuid>)`. **N grants** (N>1) → AskUserQuestion prompt with the list, then store triple with the chosen uuid; announce. |
| **AuthError (401/403)** — key invalid or revoked | Do NOT store the credential. Exit 2: `error: hub rejected the API key during whoami — generate a new key at https://app.arcanon.dev/settings/api-keys`. | Same. Do NOT store. Exit 2 with same message. |
| **HubError 5xx** — hub server error | Store the triple anyway (user gave us the org id). Emit WARN `⚠ hub whoami returned <status>; grants could not be verified — credential stored, retry /arcanon:login later to verify`. Exit 0. | Do NOT store. Exit 2: `error: hub whoami unavailable (<status>) and no --org-id provided — retry later, or run /arcanon:login arc_… --org-id <uuid> if you know the org id`. |
| **Network error** — hub unreachable | Store the triple anyway. Emit WARN `⚠ hub unreachable; grants could not be verified — credential stored, retry /arcanon:login when online`. Exit 0. | Do NOT store. Exit 2: `error: hub unreachable and no --org-id provided — connect to the network and retry, or run /arcanon:login arc_… --org-id <uuid>`. |

Invariant: **never silently store an unvalidated credential without an org id.** If whoami can't run AND user didn't supply `--org-id`, refuse.

### Decision D-125-03 — `/arcanon:status --json` Identity block shape (resolves L1 / AUTH-07)

Identity is emitted as a **nested `identity` object** (not flat top-level fields) to insulate existing JSON consumers from churn. The full report shape after this phase:

```json
{
  "plugin_version": "0.1.5",
  "data_dir": "~/.arcanon",
  "config_file": "/path/to/arcanon.config.json",
  "project_slug": "my-project",
  "hub_auto_sync": false,
  "credentials": "present",
  "queue": { "pending": 0, "dead": 0, "oldestPending": null },
  "scan_freshness": { /* unchanged */ },
  "identity": {
    "org_id": "7f3e1234-…-…",
    "org_id_source": "config_default",
    "key_preview": "arc_xxxx…1234",
    "scopes": ["scan:write", "scan:read"],
    "authorized_orgs": [
      { "id": "7f3e1234-…", "slug": "acme" },
      { "id": "9b2c5678-…", "slug": "acme-staging" }
    ],
    "whoami_status": "ok"
  }
}
```

`org_id_source` enum: `"opts"` | `"env"` (ARCANON_ORG_ID) | `"repo_config"` (per-repo `hub.org_id`) | `"config_default"` (`~/.arcanon/config.json#default_org_id`) | `null` (when `org_id` is missing).

`whoami_status` enum: `"ok"` | `"network_error"` | `"hub_error"` | `"auth_error"` | `"skipped"` (when no creds).

When no org id resolves: `identity.org_id = null`, `identity.org_id_source = null`. Human mode prints `(missing)`.

When `whoami` fails or no creds: `scopes = []`, `authorized_orgs = []`, `whoami_status` set accordingly. Human mode prints `(unavailable: <reason>)` next to the scopes line.

Human mode adds these lines to existing status output (4 new lines, all under a `Identity:` header):

```
  Identity:
    org id:        7f3e1234-…-…  (source: config_default)
    key:           arc_xxxx…1234
    scopes:        scan:write, scan:read
    authorized:    acme, acme-staging
```

Existing status lines (`project`, `credentials`, `auto-sync`, `queue`, `data dir`, `Latest scan`, `repos with new commits`) are untouched.

---

## Wave / Plan Structure

| Wave | Plan | Plan name | REQs | Autonomous |
| --- | --- | --- | --- | --- |
| 1 | 125-01 | Login flow + structured error-code parser | AUTH-06, AUTH-08 | no (1 checkpoint at end for human verify) |
| 2 | 125-02 | Status Identity block + docs sweep | AUTH-07, AUTH-09 | no (1 checkpoint for docs read-through) |

Plan 125-02 depends on 125-01 because:

1. The Identity block (`/arcanon:status`) calls `getKeyInfo()` and surfaces fields that 125-01 wires through `cmdLogin` first — keeping the call shape consistent.
2. `docs/hub-integration.md` documents both the login flow (`125-01`) and the status block (`125-02`) in the same "Credentials" section; landing them sequentially avoids a churn rewrite.
3. Both plans modify `worker/cli/hub.js`; Wave-2 sequencing prevents merge / file-ownership conflict.

---

## Plan 125-01 — Login flow + structured error-code parser

**REQ coverage:** AUTH-06, AUTH-08
**Wave:** 1
**Depends on:** Phase 124 complete (`whoami.js`, `resolveCredentials` returning `orgId`, `storeCredentials({hubUrl, defaultOrgId})`)
**Autonomous:** no — final task is a `checkpoint:human-verify`

### Objective

Wire the human-facing `/arcanon:login arc_xxx [--org-id <uuid>]` flow per Decision D-125-02, and add structured per-error-code message rendering to `uploadScan` per Decision D-125-01. Together these make the full personal-credential flow user-friendly: the user gets a guided login, and every server-side auth failure produces an actionable message.

### Files Modified

- `plugins/arcanon/worker/hub-sync/client.js` — extend `HubError` with `.code`; add error-code → message map; rewrite the non-2xx error path at lines 163-166 to emit code-driven messages.
- `plugins/arcanon/worker/cli/hub.js` — rewrite `cmdLogin` (lines 157-169) per D-125-02 branch table.
- `plugins/arcanon/worker/hub-sync/index.js` — re-export `HubError` and the new error-code map symbol if helpful (otherwise leave alone — `client.js` is already imported transitively).
- `plugins/arcanon/commands/login.md` — rewrite the "What to do" section to describe the new whoami-driven flow; remove the obsolete "storage-only" line at line 38; document `--org-id` flag; update Help section.

### Tasks

#### Task 1: Extend `HubError` and add structured error-code rendering (AUTH-08)

**Files:** `plugins/arcanon/worker/hub-sync/client.js`

**Action:**

1. Edit the `HubError` constructor (currently at lines 30-39) to accept and store `code`:
   ```js
   constructor(message, { status, retriable, body, attempts, code } = {}) {
     super(message);
     this.name = "HubError";
     this.status = status ?? null;
     this.retriable = Boolean(retriable);
     this.body = body ?? null;
     this.attempts = attempts ?? null;
     this.code = code ?? null;
   }
   ```

2. Add a top-level constant block after `DEFAULT_TIMEOUT_MS` (around line 28) named `HUB_ERROR_CODE_MESSAGES` — a frozen object mapping each of the 7 code strings from D-125-01 to its user-facing message. Export it from the module so tests can pin every code.

3. Add a helper `messageForCode(body, status)`:
   - If `body && typeof body === "object" && typeof body.code === "string" && HUB_ERROR_CODE_MESSAGES[body.code]` → return that message.
   - Else if `body?.title` → return `hub returned ${status}: ${body.title}` (preserves the existing client.js:164 fallback).
   - Else → return `hub returned ${status}` (last-resort fallback).

4. Rewrite the failed-response branch at lines 163-166 to use `messageForCode`:
   ```js
   const code = (responseBody && typeof responseBody === "object") ? (responseBody.code ?? null) : null;
   lastErr = new HubError(
     messageForCode(responseBody, response.status),
     { status: response.status, retriable, body: responseBody, attempts: attempt, code },
   );
   ```

5. Do NOT alter the success branch (lines 154-161), the network-error branch (lines 139-151), the retry-budget exhaustion path (line 185), or the 413-pre-send guard (lines 113-117).

**Per-line target:**

- `client.js:30-39` — constructor extension
- `client.js:~28` — add `HUB_ERROR_CODE_MESSAGES` constant
- `client.js:~30` — add `messageForCode()` helper
- `client.js:163-166` — rewrite the non-2xx error-construction block

**Atomic commit message:**
`feat(125): hub-sync error-code-to-message parser (AUTH-08)`

**Verify:**
```xml
<verify>
  <automated>node --test plugins/arcanon/worker/hub-sync/client.js 2>/dev/null || node -e "const m = await import('./plugins/arcanon/worker/hub-sync/client.js'); for (const k of ['missing_x_org_id','invalid_x_org_id','insufficient_scope','key_not_authorized_for_org','not_a_member','forbidden_scan','invalid_key']) { if (typeof m.HUB_ERROR_CODE_MESSAGES[k] !== 'string') { console.error('missing message for', k); process.exit(1); } } console.log('ok');"</automated>
</verify>
```

The full enumeration test lives in Phase 126 (M-AUTH-08 in `client.test.js`). The smoke check above pins the constant ships with all 7 codes mapped.

**Done:**
- `HubError` instances thrown by `uploadScan` carry `.code` when the server response body has a `code` field.
- All 7 codes from D-125-01 produce their pinned user-facing message.
- Unknown codes / absent body / absent code field still surface `body.title` (forward-compat), matching pre-phase behavior for any code the plugin doesn't recognize yet.
- No regression to existing `.status`, `.retriable`, `.body`, `.attempts` — surface tests in Phase 126 will pin these.

#### Task 2: Rewrite `cmdLogin` for whoami-driven flow (AUTH-06)

**Files:** `plugins/arcanon/worker/cli/hub.js`

**Action:**

1. Update imports near line 30 to add `getKeyInfo` from the whoami client and `AuthError` from auth.js (Phase 124 names — verify import path against the actual exported symbol from `worker/hub-sync/index.js` after Phase 124 lands; expected: `import { getKeyInfo } from "../hub-sync/whoami.js"; import { AuthError } from "../hub-sync/auth.js";`).

2. Rewrite `cmdLogin` (currently lines 157-169) to:
   - Parse `apiKey` from `flags["api-key"]` or `process.env.ARCANON_API_KEY` (existing behavior).
   - Parse `orgId` from `flags["org-id"]` (new — note: `parseArgs` at line 102 already handles `--org-id <uuid>` since it generically consumes `--<key> <val>` pairs).
   - Parse `hubUrl` from `flags["hub-url"]` (existing).
   - Reject if `apiKey` missing (existing exit-2 path).
   - Validate `apiKey.startsWith("arc_")` — if not, exit 2 with `error: api key must start with arc_`.
   - If `orgId` provided, validate it matches the uuid v4 regex `/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i` — if not, exit 2 with `error: --org-id must be a uuid (got <input>)`.
   - Resolve effective `hubUrl` for whoami: prefer `flags["hub-url"]`, else `process.env.ARCANON_HUB_URL`, else read `~/.arcanon/config.json#hub_url`, else `DEFAULT_HUB_URL` (use the existing helper pattern; `auth.js` exports the resolution chain).
   - Call `getKeyInfo(apiKey, hubUrlForWhoami)` inside try/catch.
   - Apply the D-125-02 branch table:
     - **whoami success**:
       - With `orgId`: check `grants.some(g => g.org_id === orgId)`. Match → `storeCredentials(apiKey, {hubUrl: flags["hub-url"], defaultOrgId: orgId})`; emit `✓ verified: signed in to org <slug> (<orgId>) as <user_id>`. Mismatch → store anyway; emit WARN per D-125-02; emit listing of available grants.
       - Without `orgId`: examine `grants.length`:
         - 0 → exit 2 with the admin-action message; do NOT store.
         - 1 → auto-select `grants[0].org_id`; store; announce `✓ auto-selected org <slug> (<orgId>)`.
         - N>1 → AskUserQuestion-style prompt. **Note:** since `cmdLogin` runs as a Node CLI invoked from `scripts/hub.sh`, the AskUserQuestion happens at the **slash-command markdown layer** — `cmdLogin` should **emit the grants list as JSON to stdout under a known sentinel `__ARCANON_GRANT_PROMPT__`** when in non-`--json` mode and exit with code `7` (a new sentinel exit code meaning "needs user choice"). The slash-command markdown then runs AskUserQuestion and re-invokes `cmdLogin` with `--org-id <chosen>`. Document this re-entry contract in `commands/login.md` (Task 3).
           - Sentinel format (one line, then a JSON array on the next line):
             ```
             __ARCANON_GRANT_PROMPT__
             [{"org_id":"...","slug":"acme","role":"admin"}, ...]
             ```
           - In `--json` mode, emit `{"action":"prompt_grants","grants":[…]}` and exit 7 instead.
     - **whoami AuthError (401/403)**: do NOT store; exit 2 with the pinned message from D-125-02.
     - **whoami HubError with status >= 500**:
       - With `orgId`: store the triple; emit WARN per D-125-02; exit 0.
       - Without `orgId`: do NOT store; exit 2 with the unavailable+no-org message.
     - **Network error** (caught as the network-error branch of HubError, identified by `err.status === null && err.retriable === true`):
       - With `orgId`: store; emit WARN per D-125-02; exit 0.
       - Without `orgId`: do NOT store; exit 2 with the unreachable+no-org message.

3. NEVER print the api key to stdout/stderr in any branch (preserve existing security posture from login.md line 36).

4. Honor `--json` mode for every branch — emit a structured object with `{ ok, stored_at, hub_url, org_id, org_slug, source_branch, warning?, error? }`.

**Per-line target:**

- `hub.js:~30-38` — extend imports
- `hub.js:157-169` — rewrite `cmdLogin` body

**Atomic commit message:**
`feat(125): /arcanon:login whoami-driven org resolution (AUTH-06)`

**Verify:**
```xml
<verify>
  <automated>node -e "const m = await import('./plugins/arcanon/worker/cli/hub.js'); console.log('module loaded ok');"</automated>
</verify>
```

End-to-end whoami branch tests are Phase 126 (`integration.test.js`). The smoke check pins module load + import wiring.

**Done:**
- `cmdLogin` consumes `--org-id <uuid>` and validates uuid shape.
- All 8 cells of the D-125-02 branch table are implemented.
- Zero-grant case fails loud and refuses to store.
- Multi-grant case emits the `__ARCANON_GRANT_PROMPT__` sentinel + exit 7 for the markdown layer to consume.
- Network / hub-5xx with `--org-id` stores and warns; without `--org-id` refuses.
- AuthError never stores; always exit 2.
- No api key reaches stdout / stderr.
- `--json` mode produces a structured object for every branch.

#### Task 3: Rewrite `commands/login.md` for the new flow + grant-prompt re-entry contract (AUTH-06)

**Files:** `plugins/arcanon/commands/login.md`

**Action:**

1. Replace the entire body (keep frontmatter at lines 1-5 except update `argument-hint` to `"[arc_... api key] [--org-id <uuid>]"` and `allowed-tools` to `Bash, AskUserQuestion`).

2. Rewrite "What to do" section:
   - Step 1: resolve key (unchanged) — accept positional `arc_…` arg or AskUserQuestion prompt for it; also accept `--org-id <uuid>` after the key.
   - Step 2: invoke `bash ${CLAUDE_PLUGIN_ROOT}/scripts/hub.sh login --api-key "<KEY>" [--org-id "<UUID>"]`. Capture the exit code:
     - **Exit 0** → success; relay stdout (which is `✓ …`).
     - **Exit 2** → failure; relay stderr verbatim and stop.
     - **Exit 7** → grant prompt. The Node CLI emitted `__ARCANON_GRANT_PROMPT__` followed by a JSON grants array on stdout. The markdown command must:
       1. Parse the grants array.
       2. Format an AskUserQuestion prompt: `"This key is authorized for N orgs. Pick one:"` with each option as `"<slug> (<role>) — <org_id>"`.
       3. Re-invoke `bash ${CLAUDE_PLUGIN_ROOT}/scripts/hub.sh login --api-key "<KEY>" --org-id "<CHOSEN_UUID>"`.
       4. Relay the second invocation's stdout.

3. Remove the obsolete "storage-only" line (currently line 38: "The hub exposes no way to validate an `arc_*` key without an actual upload, so treat the `/arcanon:login` step as storage-only…"). It is superseded by the whoami flow.

4. Update step 3 ("Nudge toward the next step"): keep the `hub.auto-sync` nudge but update the wording to mention `/arcanon:sync` instead of the removed `/arcanon:upload`.

5. Rewrite the "Help" section:
   - Update Usage: `/arcanon:login [arc_... api key] [--org-id <uuid>]`
   - Add `--org-id <uuid>` to Options with explanation: "skip whoami grant resolution and pin this org id; if the key isn't authorized for it, login warns but stores the credential anyway (server will reject at upload time)".
   - Add Examples:
     - `/arcanon:login arc_xxxxxxxxxxxx` — interactive: whoami picks the org or prompts among grants
     - `/arcanon:login arc_xxxxxxxxxxxx --org-id 7f3e1234-…` — non-interactive with explicit org id
   - Add a "Behavior" subsection summarizing D-125-02 in 4 bullets: success+grant-match, success+grant-mismatch (warn), no-grants (fail), hub unreachable + `--org-id` (warn-and-store).

**Per-line target:** entire file rewrite (commands/login.md is 64 lines today).

**Atomic commit message:**
`docs(125): /arcanon:login command markdown for whoami flow (AUTH-06)`

**Verify:**
```xml
<verify>
  <automated>grep -q "__ARCANON_GRANT_PROMPT__" plugins/arcanon/commands/login.md && grep -q -- "--org-id" plugins/arcanon/commands/login.md && ! grep -q "storage-only" plugins/arcanon/commands/login.md && echo ok</automated>
</verify>
```

**Done:**
- `commands/login.md` describes the whoami-driven flow.
- The grant-prompt re-entry contract (exit 7 + `__ARCANON_GRANT_PROMPT__` sentinel) is documented for any future maintainer.
- The "storage-only" line is removed.
- Help section includes `--org-id` flag and behavior summary.

#### Task 4 (checkpoint): Manual login walkthrough

**Type:** `checkpoint:human-verify`
**Gate:** blocking

**What was built:**

- `cmdLogin` rewritten with whoami-driven org resolution (Task 2)
- `commands/login.md` describing the new flow + grant-prompt sentinel (Task 3)
- `HubError.code` + 7-code message map in `client.js` (Task 1)

**How to verify:**

1. Confirm Phase 124 has shipped (`worker/hub-sync/whoami.js` exists; `resolveCredentials()` returns `orgId`).
2. Confirm arcanon-hub THE-1030 is deployed against your dev hub (whoami endpoint live; RFC 7807 errors with `code` field).
3. Run `node plugins/arcanon/worker/cli/hub.js login --api-key arc_<DEV_KEY>` against a hub where the dev key has exactly 1 grant. Expected: exits 0; stdout is `✓ auto-selected org <slug> (<uuid>)`; `~/.arcanon/config.json` now contains `default_org_id`.
4. Run `node plugins/arcanon/worker/cli/hub.js login --api-key arc_<MULTI_GRANT_KEY>`. Expected: exits 7; stdout starts with `__ARCANON_GRANT_PROMPT__`; second line is a JSON array.
5. Run `node plugins/arcanon/worker/cli/hub.js login --api-key arc_<KEY> --org-id 00000000-0000-0000-0000-000000000000` (uuid that is not in the grants). Expected: exits 0; stderr contains `⚠ key is not authorized for org`; config still updated.
6. Run `node plugins/arcanon/worker/cli/hub.js login --api-key arc_NOT_A_VALID_KEY`. Expected: exits 2; stderr contains `hub rejected the API key during whoami`.
7. Disconnect from the network and run `node plugins/arcanon/worker/cli/hub.js login --api-key arc_<KEY> --org-id 7f3e…`. Expected: exits 0; stderr contains `⚠ hub unreachable`.
8. Disconnect from the network and run `node plugins/arcanon/worker/cli/hub.js login --api-key arc_<KEY>` (no `--org-id`). Expected: exits 2; stderr contains `hub unreachable and no --org-id provided`.

**Resume signal:** Type "approved" or describe issues.

---

## Plan 125-02 — Status Identity block + docs sweep

**REQ coverage:** AUTH-07, AUTH-09
**Wave:** 2
**Depends on:** 125-01 (cmdLogin uses `getKeyInfo`; Identity block reuses the same call)
**Autonomous:** no — final task is a `checkpoint:human-verify`

### Objective

Surface the resolved identity in `/arcanon:status` per Decision D-125-03, and update the example config + the three docs files to document the new credential triple, the env var, the resolution precedence, and the login flow.

### Files Modified

- `plugins/arcanon/worker/cli/hub.js` — extend `cmdStatus` (lines 171-226) with the Identity block.
- `plugins/arcanon/commands/status.md` — describe the Identity block in the report bullet list and the Help section.
- `plugins/arcanon/arcanon.config.json.example` — show `hub.org_id` as a documented optional key (per-repo override).
- `docs/hub-integration.md` — rewrite the Credentials section to document the resolution precedence (4 sources), describe the whoami flow, list the 7 error codes + messages, and remove obsolete `~/.ligamen/` legacy reference (already historical, but the Credentials section still mentions it at line 107).
- `docs/getting-started.md` — replace the "Connect to Arcanon Hub" section's login walkthrough with the new whoami-driven flow; replace `/arcanon:upload` references with `/arcanon:sync`.
- `docs/configuration.md` — add `hub.org_id` to the Hub table (line 57); add `default_org_id` documentation to the Hub credentials section; add `ARCANON_ORG_ID` to the env-var table.

### Tasks

#### Task 1: Add Identity block to `cmdStatus` (AUTH-07)

**Files:** `plugins/arcanon/worker/cli/hub.js`

**Action:**

1. Update the imports near line 30 to include `getKeyInfo` (from Plan 125-01 work) and `AuthError`.

2. Add a helper `_buildIdentityBlock()` near `_fetchScanFreshness` (around line 248):
   - Try `resolveCredentials()`. If it throws (no creds at all, or missing org id) → return:
     ```js
     { org_id: null, org_id_source: null, key_preview: null, scopes: [], authorized_orgs: [], whoami_status: "skipped" }
     ```
   - If creds resolve, build `key_preview` as `apiKey.slice(0, 8) + '…' + apiKey.slice(-4)` (e.g., `arc_xxxx…1234`).
   - Try `getKeyInfo(apiKey, hubUrl)` with a short timeout (recommend 4000 ms — same family as `_fetchScanFreshness` 2 s but longer because whoami may be a real round-trip). Wrap in try/catch.
     - On success → populate `scopes` (from response), `authorized_orgs` (mapped from grants `[{org_id, slug}]`), `whoami_status: "ok"`.
     - On `AuthError` → `whoami_status: "auth_error"`.
     - On `HubError` with status (5xx) → `whoami_status: "hub_error"`.
     - On network error → `whoami_status: "network_error"`.
   - Return the populated identity object per D-125-03.

3. Call `_buildIdentityBlock()` inside `cmdStatus` (just after `_fetchScanFreshness` at line 194) and attach as `report.identity`. The existing `report` object literal at line 196 gains one new key: `identity: identity`.

4. In the human-mode `lines` array (lines 211-218), append a new block AFTER the queue / data dir lines and BEFORE the freshness lines (or at the end — pick the spot that reads naturally; recommend after `data dir` and before `Latest scan`). The block format from D-125-03:
   ```
     Identity:
       org id:        <org_id or "(missing)">  (source: <source or "—">)
       key:           <key_preview or "(missing)">
       scopes:        <comma-joined scopes or "(unavailable: <whoami_status>)">
       authorized:    <comma-joined slugs or "(unavailable)">
   ```
   When `credentials === "missing"` → render the block with all `(missing)` so users see explicitly that login is needed; when whoami fails but creds exist, render `org_id` + `key` + `(unavailable: <whoami_status>)` for scopes/authorized.

5. Verify the existing FRESH-01/02 freshness lines are preserved (lines 219-224).

**Per-line target:**
- `hub.js:~30` — extend imports
- `hub.js:~248` (or end of file before exports) — add `_buildIdentityBlock`
- `hub.js:194` — call `_buildIdentityBlock` and add `identity` to report
- `hub.js:196-205` — extend report shape with `identity`
- `hub.js:211-225` — extend human-mode line emission

**Atomic commit message:**
`feat(125): /arcanon:status Identity block (AUTH-07)`

**Verify:**
```xml
<verify>
  <automated>node plugins/arcanon/worker/cli/hub.js status --json | node -e "const r = JSON.parse(require('fs').readFileSync(0,'utf8')); if (!('identity' in r)) { console.error('identity missing'); process.exit(1); } if (!('org_id' in r.identity) || !('whoami_status' in r.identity)) { console.error('identity shape wrong'); process.exit(1); } console.log('ok');"</automated>
</verify>
```

(Run after `npm install` in `plugins/arcanon/`. The check works whether or not creds are stored — `whoami_status` falls back to `skipped`.)

**Done:**
- `cmdStatus` emits `identity: { … }` as a nested key in `--json` mode.
- Existing top-level keys (`plugin_version`, `data_dir`, `config_file`, `project_slug`, `hub_auto_sync`, `credentials`, `queue`, `scan_freshness`) are unchanged in shape.
- Human mode adds an `Identity:` block with 4 indented lines.
- `(missing)` fallback renders when no org id resolves.
- `(unavailable: <reason>)` fallback renders when whoami fails.
- whoami timeout cap (≤ 4 s) prevents `/arcanon:status` from hanging when the hub is down.

#### Task 2: Update `commands/status.md` to describe the Identity block (AUTH-07)

**Files:** `plugins/arcanon/commands/status.md`

**Action:**

1. Add to the bulleted "The script reports" list (currently lines 18-26) a new bullet between credential presence and queue stats:
   - `Identity (AUTH-07): resolved org id + source, key preview (`arc_xxxx…1234`), scopes, list of authorized orgs. Shows `(missing)` when no org id resolves; `(unavailable)` when the hub is unreachable.`

2. Update the trailing prose (line 28-29) — keep it but add a note: "If the Identity block shows `(missing)` org id, run `/arcanon:login` (or `/arcanon:login --org-id <uuid>`)."

3. In the Help section (lines 39-52), update the Usage block summary to: "Print a one-line health check: worker, hub credentials, identity (org + scopes), upload queue, config, and latest-scan quality."

**Atomic commit message:**
`docs(125): /arcanon:status command markdown for Identity block (AUTH-07)`

**Verify:**
```xml
<verify>
  <automated>grep -q "Identity (AUTH-07)" plugins/arcanon/commands/status.md && grep -q "key preview" plugins/arcanon/commands/status.md && echo ok</automated>
</verify>
```

**Done:**
- `commands/status.md` describes the Identity block.
- Help text updated to mention identity in the one-line summary.

#### Task 3: Update `arcanon.config.json.example` and the three docs files (AUTH-09)

**Files:**
- `plugins/arcanon/arcanon.config.json.example`
- `docs/hub-integration.md`
- `docs/getting-started.md`
- `docs/configuration.md`

**Action:**

##### a) `plugins/arcanon/arcanon.config.json.example`

Today the file is 3 lines `{"linked-repos": ["../api","../ui","../sdk"]}`. Expand it to a fully-realized example that documents AUTH-05's `hub.org_id` and AUTH-09's intent. Final shape:

```jsonc
{
  "project-name": "my-project",
  "linked-repos": ["../api", "../ui", "../sdk"],
  "hub": {
    "auto-sync": false,
    "url": "https://api.arcanon.dev",
    "project-slug": "my-project",
    "org_id": "00000000-0000-0000-0000-000000000000"
  }
}
```

(JSON does not allow comments. The docs files explain each key.)

Note for the executor: keep the file valid JSON (no `jsonc` comments). The placeholder uuid `00000000-…` is intentional — the surrounding docs will explain it must be replaced with a real org id (or the key omitted entirely to fall back to the env / machine default).

##### b) `docs/hub-integration.md` — rewrite the Credentials section (lines 99-117)

Replace it with:

```markdown
## Credentials

The plugin authenticates with a **personal credential triple**: an API key,
a hub URL, and a default org id. The hub validates all three on every
upload via the `X-Org-Id` request header.

### Storage

`/arcanon:login` writes `~/.arcanon/config.json` with mode `0600`. Shape:

```json
{
  "api_key": "arc_xxxxxxxxxxxx",
  "hub_url": "https://api.arcanon.dev",
  "default_org_id": "7f3e1234-…-…"
}
```

### API key precedence (first hit wins)

1. `--api-key` flag to `/arcanon:sync` / `scripts/hub.sh`
2. `$ARCANON_API_KEY` environment variable (alias: `$ARCANON_API_TOKEN`)
3. `~/.arcanon/config.json` → `api_key`

### Hub URL precedence

1. `--hub-url` flag
2. `$ARCANON_HUB_URL`
3. `~/.arcanon/config.json` → `hub_url`
4. Default: `https://api.arcanon.dev`

### Org id precedence

1. Per-repo `arcanon.config.json` → `hub.org_id`
2. `$ARCANON_ORG_ID` environment variable
3. `~/.arcanon/config.json` → `default_org_id`

If no org id resolves, `uploadScan` fails fast (before the network call)
with an `AuthError` whose message names all three sources and recommends
`/arcanon:login --org-id <uuid>`.

### `/arcanon:login` flow

```
/arcanon:login arc_xxxxxxxxxxxx                  # whoami picks the org
/arcanon:login arc_xxxxxxxxxxxx --org-id <uuid>  # explicit pin
```

The plugin calls `GET /api/v1/auth/whoami` against the hub to learn
which orgs the key is authorized for, then:

- **0 grants** → fails with an admin-action message; nothing stored.
- **1 grant** → auto-selects that org and stores the triple.
- **N grants** → prompts the user (via AskUserQuestion in Claude Code)
  to pick one, then stores the triple.

With `--org-id` supplied, whoami is still called for verification: if
the key isn't authorized for the supplied org, the plugin warns but
stores the credential anyway (the server rejects at upload time with
`key_not_authorized_for_org`).

If the hub is unreachable or returns 5xx during login, the plugin
**stores the credential when `--org-id` is supplied** (with a warning)
and **refuses to store when no `--org-id` is supplied** (so a user
without an org id is never silently stuck).

### Server-side error codes

`uploadScan` parses RFC 7807 problem-details responses with a custom
`code` field and surfaces an actionable message for each known code:

| `code` | User-facing message |
| --- | --- |
| `missing_x_org_id` | `X-Org-Id header missing — re-run /arcanon:login or set ARCANON_ORG_ID` |
| `invalid_x_org_id` | `X-Org-Id is not a valid uuid — fix arcanon.config.json hub.org_id, ARCANON_ORG_ID, or re-run /arcanon:login --org-id <uuid>` |
| `insufficient_scope` | `API key is missing the required scope — generate a key with scan:write` |
| `key_not_authorized_for_org` | `API key is not authorized for this org — run /arcanon:login --org-id <uuid> to switch` |
| `not_a_member` | `you are not a member of this org — ask an org admin to invite your user` |
| `forbidden_scan` | `this scan is forbidden by org policy — contact your org admin` |
| `invalid_key` | `API key is invalid or revoked — generate a new key, then /arcanon:login arc_…` |

Unknown codes fall back to the existing RFC 7807 `title` rendering.
```

Also remove the legacy `~/.ligamen/config.json` line in the precedence list (no longer authoritative — Arcanon-only since v0.1.2).

##### c) `docs/getting-started.md` — update "Connect to Arcanon Hub" section (lines 54-92)

Replace the section body with:

```markdown
## 3. Connect to Arcanon Hub

If you just want to use Arcanon locally, you can stop here. To share your
service graph across teammates and other repos:

**a) Create an API key** at
[https://app.arcanon.dev/settings/api-keys](https://app.arcanon.dev/settings/api-keys).
Keys start with `arc_`.

**b) Log in:**

```
/arcanon:login arc_xxxxxxxxxxxx
```

The plugin calls the hub's `whoami` endpoint to learn which orgs your
key is authorized for:

- If the key has **one** grant, that org is auto-selected and stored.
- If the key has **multiple** grants, you'll be prompted to pick one.
- If the key has **no** grants, login fails — ask your admin to grant
  the key access.

You can also pin an org id explicitly:

```
/arcanon:login arc_xxxxxxxxxxxx --org-id 7f3e1234-…
```

The triple (api key, hub url, default org id) is stored in
`~/.arcanon/config.json` with mode `0600`.

**c) Verify with `/arcanon:status`:**

```
/arcanon:status
```

You should see an Identity block with your resolved org id and the list
of orgs your key is authorized for.

**d) Upload your scan:**

```
/arcanon:sync
```

Or turn on auto-sync in `arcanon.config.json`:

```json
{
  "project-name": "my-service",
  "hub": { "auto-sync": true }
}
```

After that, every `/arcanon:map` run uploads automatically. Failed
uploads enqueue locally and retry via `/arcanon:sync`.
```

In the "Everyday commands" table (lines 113-122), replace `/arcanon:upload` with `/arcanon:sync` (the deprecated stub was removed in v0.1.3 — line 188 of PROJECT.md confirms).

In the "Troubleshooting" section (lines 123-131), replace `/arcanon:login` 401 wording with: `**"hub returned 401 / invalid_key"** → /arcanon:login again with a fresh key.` Add a new bullet: `**"hub returned 403 / key_not_authorized_for_org"** → /arcanon:login --org-id <uuid> to switch to an org your key has access to.`

##### d) `docs/configuration.md` — extend Hub config table + env vars (lines 53-87)

In the Hub table at lines 56-61, add a new row:

```
| `hub.org_id` | _(empty)_ | Per-repo override of the default org id. Highest-precedence source — beats `$ARCANON_ORG_ID` and `~/.arcanon/config.json` `default_org_id`. Useful when one repo lives in a different org than your machine default. |
```

Update the `hub.auto-upload` row label to `hub.auto-sync` (it was renamed in v0.1.1; line 30 of `arcanon.config.json.example` still showed `auto-upload` — so this is the moment to fix the example doc to match).

After the Hub table, add a new subsection:

```markdown
### Org id resolution

The plugin resolves the org id sent in the `X-Org-Id` header on every
upload via this precedence (first hit wins):

1. Per-repo `arcanon.config.json` → `hub.org_id`
2. `$ARCANON_ORG_ID` environment variable
3. `~/.arcanon/config.json` → `default_org_id` (set by `/arcanon:login`)

If none resolve, the upload fails fast with an actionable message
naming all three sources. See [hub-integration.md](hub-integration.md#org-id-precedence).
```

In the "Hub credentials (environment)" table (lines 83-87), add a new row:

```
| `ARCANON_ORG_ID` | Default org id sent as `X-Org-Id` on uploads. Beats `~/.arcanon/config.json` `default_org_id` but loses to per-repo `hub.org_id`. |
```

**Atomic commit message:**
`docs(125): docs sweep — default_org_id / ARCANON_ORG_ID / login flow / resolution precedence (AUTH-09)`

**Verify:**
```xml
<verify>
  <automated>grep -q "ARCANON_ORG_ID" docs/configuration.md && grep -q "default_org_id" docs/hub-integration.md && grep -q "hub.org_id" docs/configuration.md && grep -q "whoami" docs/getting-started.md && grep -q "key_not_authorized_for_org" docs/hub-integration.md && python3 -c "import json; json.load(open('plugins/arcanon/arcanon.config.json.example'))" && echo ok</automated>
</verify>
```

**Done:**
- `arcanon.config.json.example` is valid JSON and shows `hub.org_id`.
- `docs/hub-integration.md` documents the resolution precedence (4 sources for api key, 4 for hub url, 3 for org id), the whoami flow, and the 7 error codes + messages.
- `docs/getting-started.md` updates the login walkthrough to the whoami flow and replaces `/arcanon:upload` references with `/arcanon:sync`.
- `docs/configuration.md` adds `hub.org_id` to the Hub table, adds a "Org id resolution" subsection, and adds `ARCANON_ORG_ID` to the env-var table.

#### Task 4 (checkpoint): Manual status + docs read-through

**Type:** `checkpoint:human-verify`
**Gate:** blocking

**What was built:**

- `cmdStatus` Identity block (Task 1)
- `commands/status.md` updated bullet list and Help (Task 2)
- `arcanon.config.json.example` + 3 docs files updated (Task 3)

**How to verify:**

1. Run `node plugins/arcanon/worker/cli/hub.js status` against a machine with stored credentials and a working hub. Expected: an `Identity:` block appears with `org id`, `key`, `scopes`, `authorized` lines populated.
2. Run `node plugins/arcanon/worker/cli/hub.js status --json | jq .identity`. Expected: a nested object with `org_id`, `org_id_source`, `key_preview`, `scopes` (array), `authorized_orgs` (array of `{id, slug}`), `whoami_status`.
3. Delete `~/.arcanon/config.json` (back it up first), re-run `/arcanon:status`. Expected: the Identity block renders with `(missing)` for org id and key.
4. Read `docs/getting-started.md` end-to-end. Confirm: a brand-new user could follow the login walkthrough without external context.
5. Read `docs/hub-integration.md` Credentials section end-to-end. Confirm: the 7 error codes are listed; the precedence orders are unambiguous.
6. Read `docs/configuration.md` Hub table + Org id resolution subsection. Confirm: `hub.org_id` and `ARCANON_ORG_ID` both appear and the relationship between them is clear.
7. Validate `arcanon.config.json.example` with `python3 -c "import json; json.load(open('plugins/arcanon/arcanon.config.json.example'))"` (already covered by Task 3 verify; double-check manually).

**Resume signal:** Type "approved" or describe issues.

---

## Test Plan

This phase is **deliberately not unit-tested**: Phase 126 owns the cross-module auth test suite (AUTH-10) and exercises:

- `worker/hub-sync/client.test.js` — `X-Org-Id` lands; missing-orgId fail-fast; **each of the 7 error codes** produces its own message (M-AUTH-08 enumeration); success → `scan_upload_id`.
- `worker/hub-sync/whoami.test.js` — already covered by Phase 124, AUTH-02.
- `worker/hub-sync/integration.test.js` — `/arcanon:login` flow with and without `--org-id`; resolution precedence; whoami branch outcomes.

Phase 125 ships with:

- **Smoke verifies** (Task 1.verify, Task 2.verify, Task 3.verify in 125-02) — assert the constants exist, modules load, JSON shape contains `identity`, key strings appear in docs.
- **Manual checkpoints** (125-01 Task 4, 125-02 Task 4) — operator walkthrough confirming end-to-end behavior against a real hub.

The Phase 126 plan owner is responsible for converting the manual walkthroughs into test cases.

---

## Acceptance Gate (Phase 125 ships when all are true)

1. `/arcanon:login arc_xxx` (without `--org-id`) against a hub where the key has exactly **1 grant** auto-selects that org, persists the triple, and announces the chosen org id. — pinned by 125-01 Task 4 step 3.
2. `/arcanon:login arc_xxx` (without `--org-id`) where the key has **multiple grants** prompts the user via the markdown layer (exit 7 + `__ARCANON_GRANT_PROMPT__` sentinel + AskUserQuestion + re-invocation). — pinned by 125-01 Task 4 step 4.
3. `/arcanon:login arc_xxx` (without `--org-id`) where the key has **0 grants** fails with the admin-action message; nothing is stored. — pinned by 125-01 Task 2 + Task 4 (manual case 0).
4. `/arcanon:login arc_xxx --org-id <uuid>` calls `whoami` for verification, warns-but-allows on mismatch, persists the triple either way. — pinned by 125-01 Task 4 step 5.
5. `/arcanon:login` with hub unreachable + `--org-id` stores and warns; without `--org-id` refuses. — pinned by 125-01 Task 4 steps 7-8.
6. `/arcanon:status` displays an Identity block with `org_id + source`, `key_preview` (`arc_xxxx…1234`), `scopes`, `authorized_orgs`. Shows `(missing)` when no org id resolves. — pinned by 125-02 Task 4 steps 1-3.
7. `/arcanon:status --json` emits identity as a **nested `identity` object** (not flat top-level). — pinned by 125-02 Task 1.verify and Task 4 step 2.
8. `uploadScan` failed responses produce code-specific actionable messages for all 7 codes; unknown codes fall back to `body.title`. — pinned by 125-01 Task 1.verify; full enumeration in Phase 126 M-AUTH-08.
9. `commands/login.md`, `commands/status.md`, `arcanon.config.json.example`, `docs/hub-integration.md`, `docs/getting-started.md`, `docs/configuration.md` document `default_org_id`, `ARCANON_ORG_ID`, the login flow, and the resolution precedence. — pinned by 125-02 Task 3.verify and Task 4 steps 4-7.

When all 9 are true, Phase 125 is complete and the milestone advances to Phase 126 (Auth Test Suite).

---

## Risk Reminders (carried from predecessor audit)

- **C4 (AUTH-08):** the `body.title` fallback at `client.js:164` MUST remain for forward-compat with codes the plugin doesn't recognize. Implementation honored in 125-01 Task 1 step 3.
- **C5 (AUTH-06):** never silently store an unvalidated credential without an org id. Implementation honored in 125-01 Task 2 (the no-`--org-id` + whoami-fail branches refuse to store).
- **L1 (AUTH-07):** Identity goes in a nested `identity:` object in `--json` mode; existing top-level keys are unchanged. Implementation honored in 125-02 Task 1.

## Out of Scope for Phase 125

- Phase 124 work (whoami client, resolveCredentials shape, X-Org-Id header, hub.org_id per-repo override, default_org_id storage).
- Phase 126 tests (cross-module auth test suite, M-AUTH-08 enumeration).
- Multi-org switching from the plugin (deferred to v0.1.6+ per THE-1029 Out of Scope).
- Service-account credentials, multi-level scope grants — deferred to v0.1.6.
- Skills / agents work — deferred to v0.2.0.
- CHANGELOG entry — handled in Phase 127 (Release Gate).
- Manifest version bump to `0.1.5` — handled in Phase 127.
