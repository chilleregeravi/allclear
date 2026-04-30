# Phase 126: Auth Test Suite - Context

**Gathered:** 2026-04-28
**Status:** Ready for planning
**Mode:** Auto-generated (discuss skipped via workflow.skip_discuss)

<domain>
## Phase Boundary

Pin the cross-module auth contract delivered by Phases 124-125 with an executable test suite that fails closed on regression. **Regression gate only** — executor must NOT modify any non-test file. If `whoami.js` or `HubError.code` aren't shipped (Phase 124-125 not landed), STOP and surface the gap to the user.

</domain>

<decisions>
## Implementation Decisions

### Locked decisions (from 126-01-PLAN.md)

- **1 plan, 3 tasks (sequential within plan):**
  - Task 1: extend `worker/hub-sync/client.test.js` (header + 7 error codes + missing-orgId fail-fast)
  - Task 2: create `worker/hub-sync/whoami.test.js` (parsed grants + AuthError + HubError)
  - Task 3: extend `worker/hub-sync/integration.test.js` (login round-trip + precedence chain) + full `npm test`
- **Mock strategy:** `fetchImpl` injection + `jsonResponse` helper + mock-hub via `startMockHub` + AskUserQuestion mock for multi-grant prompt + `withTempHome` helper for credential storage isolation.
- **Hard pin:** zero new pre-existing-mock carryforwards relative to v0.1.4 baseline (bats 448/449, node 774/775).
- **Implementation dependency:** Phase 124 + 125 must be SHIPPED before 126 can execute.

### Claude's Discretion

The plan forbids modifying source files. If the contract under test isn't actually deployed (whoami.js missing, HubError.code missing, etc.), STOP and surface the gap rather than patching source to make tests pass.

</decisions>

<canonical_refs>
## Canonical References

- `.planning/phases/126-auth-test-suite/126-01-PLAN.md` — full plan (598 lines)
- `.planning/REQUIREMENTS.md` — AUTH-10 definition + AUTH-01..09 contracts being tested
- `.planning/PREDECESSOR-SURFACE.md`

### Test file targets (extend or create)

- `plugins/arcanon/worker/hub-sync/client.test.js` (extend)
- `plugins/arcanon/worker/hub-sync/whoami.test.js` (NEW)
- `plugins/arcanon/worker/hub-sync/integration.test.js` (extend)

### Source under test (read-only)

- `plugins/arcanon/worker/hub-sync/auth.js`
- `plugins/arcanon/worker/hub-sync/client.js`
- `plugins/arcanon/worker/hub-sync/whoami.js`
- `plugins/arcanon/worker/scan/manager.js` (precedence chain integration test)

</canonical_refs>

<specifics>
## Specific Ideas

See 126-01-PLAN.md for exact assertion specifications + threat model.

</specifics>

<deferred>
## Deferred Ideas

None — single-REQ phase.

</deferred>

---

*Phase: 126-auth-test-suite*
*Context auto-generated 2026-04-28 (skip_discuss=true)*
