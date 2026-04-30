# Phase 125: Login & Status UX - Context

**Gathered:** 2026-04-28
**Status:** Ready for planning
**Mode:** Auto-generated (discuss skipped via workflow.skip_discuss)

<domain>
## Phase Boundary

Users get a guided `/arcanon:login` flow that auto-resolves org id from `whoami`, see their resolved identity in `/arcanon:status`, and receive actionable error messages on every server-side auth failure.

**Depends on Phase 124** (whoami client, resolveCredentials shape, storeCredentials). **Hard-blocked on hub-side THE-1030** (whoami endpoint live, RFC 7807 errors with `code` field).

</domain>

<decisions>
## Implementation Decisions

### Locked decisions (from 125-PLAN.md)

- **2 plans in 2 waves:**
  - Wave 1 — Plan 125-01: AUTH-06 login flow + AUTH-08 error-code parser
  - Wave 2 — Plan 125-02: AUTH-07 status Identity block + AUTH-09 docs sweep
- **D-125-01 (resolves C4 / AUTH-08):** RFC 7807 envelope `{type, title, status, detail, code}`. `HubError` gains `.code` (string|null). 7 codes mapped via frozen `HUB_ERROR_CODE_MESSAGES` constant in `client.js`. Existing `body.title` fallback at `client.js:164` PRESERVED for forward-compat.
- **D-125-02 (resolves C5 / AUTH-06):** Explicit 4×2 branch table for whoami outcomes (success / AuthError / HubError 5xx / network) crossed with `--org-id` provided/not. **Never silently store an unvalidated credential without an org id.** Multi-grant case uses exit-code 7 + `__ARCANON_GRANT_PROMPT__` stdout sentinel for markdown layer to consume via AskUserQuestion + re-invocation.
- **D-125-03 (resolves L1 / AUTH-07):** `--json` mode emits Identity as nested `identity: { org_id, org_id_source, key_preview, scopes, authorized_orgs, whoami_status }` object — existing top-level keys untouched. Human mode adds 4 indented lines under `Identity:` header. `(missing)` for no org id; `(unavailable: <reason>)` for whoami failure.

### Claude's Discretion

Implementation details not specified above are at the executor's discretion — refer to 125-PLAN.md success criteria.

</decisions>

<canonical_refs>
## Canonical References

- `.planning/phases/125-login-and-status-ux/125-PLAN.md` — full plan
- `.planning/REQUIREMENTS.md` — AUTH-06..09 definitions
- `.planning/PREDECESSOR-SURFACE.md` — C4, C5, L1 risk descriptions

### Code targets

- `plugins/arcanon/commands/login.md`, `commands/status.md`
- `plugins/arcanon/worker/cli/hub.js` (cmdLogin @ ~lines 158-163, cmdStatus @ ~line 196)
- `plugins/arcanon/worker/hub-sync/client.js` (HUB_ERROR_CODE_MESSAGES constant + HubError.code)
- `plugins/arcanon/arcanon.config.json.example`
- `plugins/arcanon/docs/{hub-integration,getting-started,configuration}.md`

</canonical_refs>

<specifics>
## Specific Ideas

See 125-PLAN.md for exact task definitions and the 4×2 branch table for whoami outcomes.

</specifics>

<deferred>
## Deferred Ideas

- Multi-org switching from plugin — explicit out-of-scope per THE-1029.
- Service-account credentials — v0.1.6 candidate.

</deferred>

---

*Phase: 125-login-and-status-ux*
*Context auto-generated 2026-04-28 (skip_discuss=true)*
