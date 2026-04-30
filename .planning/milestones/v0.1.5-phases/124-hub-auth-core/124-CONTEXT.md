# Phase 124: Hub Auth Core - Context

**Gathered:** 2026-04-28
**Status:** Ready for planning
**Mode:** Auto-generated (discuss skipped via workflow.skip_discuss)

<domain>
## Phase Boundary

Every scan upload carries `X-Org-Id` derived from a deterministic precedence chain (per-repo override → env → machine default), backed by a `whoami`-aware client and a config-file extension that preserves existing keys.

**Hard dependency:** Hub-side arcanon-hub THE-1030 deploy. Tests use `fakeFetch` so phase ships locally regardless of hub timing.

</domain>

<decisions>
## Implementation Decisions

### Locked decisions (from 124-PLAN.md + REQUIREMENTS.md + PREDECESSOR-SURFACE.md)

- **Single plan, 6 sequential atomic commits.** Both proposed sub-plans would have written to the same files (auth.js, index.js); splitting forced sequencing anyway with no parallelism gain.
- **Task order (per C1):** AUTH-03 → AUTH-01 → AUTH-04 → AUTH-02 → AUTH-05 → integration test + CHANGELOG draft.
- **C2 decision: option (a)** — `hasCredentials()` stays org_id-tolerant. Throw deferred to upload time. Rationale: prevents silent auto-sync gating-off on v0.1.4 → v0.1.5 upgrade. Pinned by Test A7.
- **C3 mitigation:** spread-merge regression test (`{...existing, api_key}` preserves `default_org_id`).
- **X1:** Thread `orgId` through `manager.js:937` destructure and `manager.js:962` `syncFindings` call.
- **CHANGELOG draft:** BREAKING entry calls out THE-1030 dependency + existing v0.1.4 users must re-run `/arcanon:login`. Drafted in Phase 124 by executor; pinned in Phase 127.

### Claude's Discretion

Implementation details not specified above are at the executor's discretion — refer to 124-PLAN.md success criteria.

</decisions>

<canonical_refs>
## Canonical References

- `.planning/phases/124-hub-auth-core/124-PLAN.md` — full plan (810 lines, 6 tasks)
- `.planning/REQUIREMENTS.md` — AUTH-01..05 definitions
- `.planning/PREDECESSOR-SURFACE.md` — C1, C2, C3, X1 risk descriptions

### Code targets

- `plugins/arcanon/worker/hub-sync/auth.js` (resolveCredentials, storeCredentials, hasCredentials @ ~line 120, spread-merge @ ~line 137)
- `plugins/arcanon/worker/hub-sync/client.js` (uploadScan @ ~line 94, body.title fallback @ ~line 164)
- `plugins/arcanon/worker/hub-sync/index.js` (uploadScan call sites @ ~lines 71, 146)
- `plugins/arcanon/worker/hub-sync/whoami.js` (NEW — created in this phase)
- `plugins/arcanon/worker/hub-sync/payload.js` (envelope v1.0/v1.1/v1.2 — confirm AUTH-01 doesn't regress)
- `plugins/arcanon/worker/scan/manager.js` (lines 937, 941, 949, 962)

</canonical_refs>

<specifics>
## Specific Ideas

See 124-PLAN.md for exact task definitions, file:line targets, atomic commit messages, and verification steps.

</specifics>

<deferred>
## Deferred Ideas

- Per-org credential profiles in plugin (multi-org switching) — explicit out-of-scope per THE-1029.
- Multi-level scope grants (product/project/repo) — v0.1.6 candidate per APIKEY-01.
- Service-account credentials — v0.1.6 candidate per APIKEY-02.

</deferred>

---

*Phase: 124-hub-auth-core*
*Context auto-generated 2026-04-28 (skip_discuss=true)*
