# Phase 123: PII Path Masking - Context

**Gathered:** 2026-04-28
**Status:** Ready for planning
**Mode:** Auto-generated (discuss skipped via workflow.skip_discuss)

<domain>
## Phase Boundary

`$HOME` paths no longer leak from any worker egress seam — every egress seam (MCP responses, HTTP responses, log lines, export outputs) emits `~`-prefixed paths, and the agent contract is hardened against future regressions. INDEPENDENT of hub-side THE-1030.

</domain>

<decisions>
## Implementation Decisions

### Locked decisions (from REQUIREMENTS.md + ROADMAP.md + PREDECESSOR-SURFACE.md)

- **Mask `$HOME` at egress, not in DB** — DB needs absolute paths for git operations.
- **Single-seam logger edit** (M1) — wrap masking around `Object.assign(lineObj, extra)` in `worker/lib/logger.js:42–68`. Do NOT edit ~30 call sites.
- **PII-03 actual routes** (S2) — `GET /projects` plus `repos[].path` arrays nested inside `/api/scan-freshness` and `/graph` response bodies. `/api/repos` does NOT exist.
- **`maskHome` idempotent** (S1) — relative agent paths (`src/`) round-trip unchanged.
- **PII-06 belt-and-suspenders** (X2) — `parseAgentOutput` rejects absolute `source_file`, logs WARN with masked value, drops the field, does NOT fail the scan.
- **Plan structure:** 6 sub-plans in 3 waves per 123-PLAN.md (A: helper module, B/C/D/E: four egress seams in parallel, F: agent contract + bats integration).

### Claude's Discretion

Implementation choices not specified above are at the executor's discretion — refer to the success criteria in ROADMAP.md and 123-PLAN.md.

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before implementing.**

### Plan + risks

- `.planning/phases/123-pii-path-masking/123-PLAN.md` — full plan with 6 sub-plans across 3 waves
- `.planning/REQUIREMENTS.md` — PII-01..07 definitions
- `.planning/PREDECESSOR-SURFACE.md` — S1, S2, M1, X2 risk descriptions

### Code targets

- `plugins/arcanon/worker/lib/logger.js:42–68` (PII-04 single-seam target)
- `plugins/arcanon/worker/mcp/server.js` (PII-02 — wrap all MCP tool replies)
- `plugins/arcanon/worker/server/http.js` lines 374–378, 540, 578 (PII-03)
- `plugins/arcanon/worker/cli/export.js` (PII-05)
- `plugins/arcanon/worker/scan/findings.js validateFindings` (PII-06)
- `plugins/arcanon/worker/scan/agent-prompt-service.md` (contract doc update)
- `plugins/arcanon/worker/db/query-engine.js:1591` (`r.path AS repo_path` source)

</canonical_refs>

<specifics>
## Specific Ideas

See 123-PLAN.md sections — Plans A through F define exact file:line targets, atomic commit messages, success criteria, and verification steps.

</specifics>

<deferred>
## Deferred Ideas

- DB schema change to store relative paths — bigger refactor, not necessary if masking-at-egress works.
- ChromaDB vector content audit — separate audit; embeddings could carry path text.
- arcanon-hub side PII audit — separate codebase.

</deferred>

---

*Phase: 123-pii-path-masking*
*Context auto-generated 2026-04-28 (skip_discuss=true)*
