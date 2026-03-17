# Project Research Summary

**Project:** AllClear v2.3 — Type-Specific Detail Panels
**Domain:** Local service dependency graph UI with type-aware data model (library exports, infra resources)
**Researched:** 2026-03-17
**Confidence:** HIGH

## Executive Summary

AllClear v2.3 is a targeted correctness release. The agent scanning layer already produces structurally correct data for library and infra nodes, but the storage and display layers were never updated to handle it. The "METHOD PATH" whitespace-split parser in `persistFindings()` silently garbles every library export and infra resource it processes, and the detail panel has no rendering path for infra nodes at all — they fall through to the service rendering path and appear with misleading "Calls"/"Called by" labels. The recommended approach is a strict bottom-up sequence: schema migration first, storage fix second, API surface extension third, UI panel changes last. No new npm dependencies are required.

The core technical pattern is a `kind` discriminant column on the existing `exposed_endpoints` table, combined with type-conditional dispatch in `persistFindings()` that branches on `svc.type`. This keeps all cross-cutting concerns (mismatch detection, FTS5 search, future export reports) pointing at a single table. The main risk is data pollution: users who have already scanned library or infra repos have malformed rows in `exposed_endpoints` that will block correct rows from inserting on re-scan via `INSERT OR IGNORE` unless migration 007 explicitly deletes them first. The migration must purge those rows before the fixed parser is deployed.

The entire feature surface is contained within five existing files and one new migration file. All research is HIGH confidence — every finding is sourced from direct codebase inspection with no external dependencies to evaluate.

## Key Findings

### Recommended Stack

No new packages are required. The entire milestone is internal refactoring of the existing Node.js / `better-sqlite3` / Fastify / vanilla-JS stack. The relevant capability gap is not a missing library — it is a missing `kind` column (20-character schema addition) and a 20-line parser fix in `persistFindings()`.

See `.planning/research/STACK.md` for full detail including code-level patches for each changed file.

**Core technologies:**
- `better-sqlite3` ^12.8.0: SQLite persistence — `ALTER TABLE ADD COLUMN ... DEFAULT` is safe and instant on existing rows; `INSERT OR IGNORE` with `UNIQUE(service_id, method, path)` handles deduplication correctly for NULL-method library/infra rows
- Node.js ESM (>=20.0.0): worker daemon and migration runner — migration 007 follows the established pattern in `worker/db/migrations/`
- Vanilla JS (browser ES2020+): detail panel rendering — `detail-panel.js` is 143-line template-literal module; no framework needed for the three-branch type dispatch

### Expected Features

See `.planning/research/FEATURES.md` for full detail including industry comparison table (Backstage, DependenTree, GitHub Dependency Graph) and feature prioritization matrix.

**Must have (P1 — v2.3 core):**
- Migration 007: add `kind TEXT NOT NULL DEFAULT 'endpoint'` to `exposed_endpoints`; optionally add `boundary_entry` column to `services` — additive, no data loss, ships first
- Fix `persistFindings()`: type-conditional dispatch on `svc.type`; library/sdk stores full export string as `path` with `method=null, kind='export'`; infra stores full resource ref as `path` with `method=null, kind='resource'`; service keeps existing "GET /path" split with `kind='endpoint'`
- `renderLibraryPanel()` in `detail-panel.js`: "Exports" section grouped as Functions (signature strings containing `(`) and Types; "Used by" consumer list with existing dedup `Set` logic preserved
- `renderInfraPanel()` in `detail-panel.js`: "Manages" section from `exposed_endpoints` rows with `kind='resource'` grouped by prefix (`k8s:`, `tf:`, `helm:`); "Wires" section from existing connection edges with deploy/configure method labels
- Update `showDetailPanel()` dispatch to add `infra` branch before all panel rendering work; add `infra` guard to `getNodeType()` in `utils.js` and `getNodeColor()` to prevent infra nodes falling to the service renderer
- Extend `getGraph()` to attach `exposes: [{kind, method, path}]` per service node (embed in `/graph` response — not a separate per-click fetch)

**Should have (P2 — include in same PR if no added risk):**
- Source file link from `boundary_entry` in library panel header (field already emitted by agent; not currently persisted)
- Text overflow handling for long function signatures (`text-overflow: ellipsis` on `.conn-path` for library/infra panels)
- Prefix-grouped resource counts in infra panel (`k8s: (8)`, `tf: (4)`, `helm: (3)`)

**Defer (v2.4+):**
- Export diff panel ("these 3 exports removed since last scan") — requires scan version history UI
- Panel filter controls (show only functions, hide types) — revisit only if users report 50+ export panels
- Live cluster state in infra panel — conflicts with scan-derived static data; covered by `/allclear:pulse`

### Architecture Approach

The data flow is strictly layered with a clear dependency chain. Agent prompts produce type-conditional `exposes` strings; `persistFindings()` classifies and stores them with a `kind` tag; `getGraph()` aggregates them onto service nodes; the HTTP layer passes them through unchanged; the UI reads them from `state.graphData.nodes[i].exposes` at click time. No component outside this chain changes. The `detectMismatches()` query, MCP server tools, web worker, and `connections` table are all unaffected.

See `.planning/research/ARCHITECTURE.md` for full data-flow diagrams, exact code patches, build order rationale, and anti-pattern documentation.

**Major components and their v2.3 changes:**
1. `worker/db/migrations/007_expose_kind.js` (NEW) — `ALTER TABLE exposed_endpoints ADD COLUMN kind TEXT NOT NULL DEFAULT 'endpoint'`
2. `worker/db/query-engine.js` (MODIFIED) — `persistFindings()` type-conditional dispatch; `getGraph()` exposes attachment
3. `worker/ui/modules/utils.js` + `state.js` (MODIFIED) — `getNodeType()` and `getNodeColor()` infra guards; `NODE_TYPE_COLORS.infra = '#68d391'`
4. `worker/ui/modules/detail-panel.js` (MODIFIED) — three-way routing; updated `renderLibraryConnections(node, ...)`; new `renderInfraConnections(node, ...)`
5. `worker/ui/graph.js` (MODIFIED) — map `s.exposes` into `state.graphData.nodes[i].exposes`

Unchanged: `agent-schema.json`, `http.js` (GET /graph passthrough), `connections` table and all queries, `detectMismatches()`, MCP server tools, web worker, `loadProject()` in UI.

### Critical Pitfalls

See `.planning/research/PITFALLS.md` for full coverage including recovery strategies, UX pitfalls, security mistakes, and a "looks done but isn't" verification checklist.

1. **"METHOD PATH" parser silently garbles all library/infra exposes** — fix by dispatching on `svc.type` in `persistFindings()` before any string splitting; verify after re-scan with `SELECT path FROM exposed_endpoints WHERE service_id = <lib_id>` — should return full function signatures, not split fragments
2. **Migration 007 without data cleanup leaves malformed rows that permanently block correct inserts** — migration must DELETE all non-REST rows from `exposed_endpoints` (rows whose path does not match the `"VERB /path"` REST format) before deploying the fixed parser; `INSERT OR IGNORE` silently skips correct rows when a malformed row already occupies the same `(service_id, method, path)` key
3. **Infra nodes fall through to service rendering path** — add `else if (nodeType === 'infra')` branch in `showDetailPanel()` as the very first panel change, even as a stub, before building `renderInfraConnections()`; the service fallthrough "works" (shows something) and masks the missing infra path
4. **`getGraph()` does not include exposes — UI has no data source for panels** — extend `getGraph()` to attach `svc.exposes` from `exposed_endpoints` before any UI panel work begins; do NOT defer to a per-click fetch (adds 20-200ms latency, forces async rendering state)
5. **XSS via function signatures rendered as raw innerHTML** — audit all `${e.path}`, `${e.method}`, `${e.source_file}` insertions in detail panel template literals; use `textContent` assignment or explicit HTML escaping for all user-controlled strings from scan results

## Implications for Roadmap

The dependency chain is strict and non-negotiable: schema before storage, storage before API, API before UI. Each phase is independently testable and produces a shippable artifact. Three phases cover the full milestone.

### Phase 1: Schema + Storage Correctness

**Rationale:** Migration 007 is the foundation for everything. The `kind` column must exist in the DB before any INSERT can set it, and the `persistFindings()` fix cannot land before the column exists. Existing malformed rows from the broken parser must be purged in this same phase — if they are not, re-scan after the fix still produces no new data because `INSERT OR IGNORE` silently skips correct rows that conflict with stale malformed ones.

**Delivers:** A clean `exposed_endpoints` table with `kind` discriminant; correct storage of library exports as `kind='export'` (full function signature in `path`) and infra resources as `kind='resource'` (full resource ref in `path`); zero malformed rows; no existing service panel behavior changed.

**Addresses:** FEATURES.md P1 items 1 and 2 (migration + persistFindings fix)

**Avoids:** Pitfall 1 (garbled parser), Pitfall 3 (malformed rows blocking re-scan inserts)

**Files:** `worker/db/migrations/007_expose_kind.js` (new), `worker/db/query-engine.js` (persistFindings only)

### Phase 2: API Surface Extension

**Rationale:** The UI cannot show exposes data that is not in the graph response. `getGraph()` must be extended and `graph.js` must forward `exposes` into node objects before any panel rendering work begins. This phase is low-risk (additive response shape change; all existing consumers ignore unknown fields) and short (one query + one grouping loop).

**Delivers:** `/graph` response includes `exposes: [{kind, method, path}]` per service node; `state.graphData.nodes[i].exposes` populated automatically after `loadProject()` runs; no UI panel changes yet — phase is complete when `node.exposes` is populated and verified in browser devtools.

**Addresses:** Pitfall 5 (no data source for panel); STACK.md "Option A: Embed exposes in /graph response"

**Avoids:** Per-click fetch anti-pattern (adds click latency; forces async rendering; must handle loading and error states); embedding all exposes in graph response is acceptable here because library/infra nodes are rare relative to service nodes and exposes counts are small

**Files:** `worker/db/query-engine.js` (getGraph only), `worker/ui/graph.js` (map exposes into node objects)

### Phase 3: UI Detail Panel — Three Render Paths

**Rationale:** All data is now correct and available in `node.exposes`. This is the user-visible payoff of Phases 1 and 2. The `utils.js` infra guard must be the very first commit within this phase before `detail-panel.js` is touched — without it, infra nodes return `"service"` from `getNodeType()` and route to `renderServiceConnections()` regardless of what `renderInfraConnections()` does.

**Delivers:** Clicking a library node shows "Exports" (functions grouped separately from types, optionally with source file link) + "Used by" consumer list. Clicking an infra node shows "Manages" (resources grouped by `k8s:`/`tf:`/`helm:` prefix) + "Wires" (deploy/configure connections). Service panel is completely unchanged.

**Addresses:** All remaining P1 features; P2 differentiators (prefix grouping, source file link, text overflow handling)

**Avoids:** Pitfall 4 (infra fallthrough to service renderer), XSS via raw innerHTML, UX pitfall of "Used by" displayed as primary content for libraries (industry reference: Backstage and DependenTree both show exports as primary, consumers as secondary)

**Files:** `worker/ui/modules/utils.js`, `worker/ui/modules/state.js`, `worker/ui/modules/detail-panel.js`

### Phase Ordering Rationale

- Phase 1 before Phase 2: the `kind` column must exist in the DB before `getGraph()` can SELECT and attach typed exposes to nodes
- Phase 2 before Phase 3: `node.exposes` must be populated in `state.graphData` before the panel renderers can filter on `e.kind === 'export'` or `e.kind === 'resource'`
- Phase 3 is self-contained once Phases 1 and 2 are complete — all UI changes carry no back-end dependencies and can be reviewed in isolation
- Within Phase 3, `utils.js` infra guard commits before `detail-panel.js` changes — makes a potential partial revert cleaner

### Research Flags

No phase requires `/gsd:research-phase`. All uncertainties were resolved during this research pass through direct codebase inspection.

Phases with standard patterns (skip research-phase):
- **Phase 1:** SQLite `ALTER TABLE ADD COLUMN ... DEFAULT` behavior confirmed; migration pattern identical to existing 001-006 migrations; `INSERT OR IGNORE` UNIQUE NULL semantics confirmed from SQLite docs
- **Phase 2:** `getGraph()` shape change is additive; no API versioning needed; existing consumers ignore unknown fields; pattern already used in this codebase
- **Phase 3:** All function signatures, caller counts, and module boundaries confirmed by direct source inspection; `renderLibraryConnections()` has exactly one caller (`showDetailPanel()`) — safe to change signature

## Confidence Assessment

| Area | Confidence | Notes |
|------|------------|-------|
| Stack | HIGH | No external deps; all findings from direct package.json + migration file inspection; zero new packages required |
| Features | HIGH | Current panel scaffold confirmed by reading detail-panel.js line-by-line; agent output formats confirmed by reading agent-prompt-library.md and agent-prompt-infra.md; Backstage/DependenTree cross-validation supports export-first panel design |
| Architecture | HIGH | All component boundaries confirmed by source inspection; broken parser located at exact lines (797-815); `renderLibraryConnections()` caller count verified (called from one location only); `detectMismatches()` filter confirmed compatible |
| Pitfalls | HIGH | All failure modes traced to actual code paths; SQLite NULL UNIQUE behavior confirmed from SQLite documentation; `INSERT OR IGNORE` blocking scenario reproduced analytically |

**Overall confidence:** HIGH

### Gaps to Address

- **Malformed-row DELETE predicate in migration 007:** The exact SQLite-compatible DELETE predicate for purging non-REST `exposed_endpoints` rows must be finalized during Phase 1. SQLite has no built-in `REGEXP` without an extension, so `path NOT LIKE '% %'` is the first-pass proxy (REST endpoints always have a space between verb and path). However, some infra resource strings also contain spaces (e.g., `"k8s:ingress/payment → payment.example.com"`). A safer predicate: delete rows where `method IS NULL AND path NOT LIKE '/%'` — REST rows with no method have paths starting with `/`; library/infra rows have non-URL-path strings. Validate this predicate against a real database with pre-existing malformed rows before shipping migration 007.

- **`boundary_entry` persistence decision:** The agent already emits `boundary_entry` and `agent-schema.json` documents it, but `persistFindings()` does not write it to the `services` table. The decision to add a `boundary_entry` column to `services` in migration 007 (enabling the source file link differentiator in Phase 3) should be made at the start of Phase 1. Adding it later requires a separate migration 008.

- **Infra ingress format with embedded spaces:** `agent-prompt-infra.md` documents `"k8s:ingress/payment → payment.example.com"` which contains a space. Confirm at Phase 1 test time that `INSERT OR IGNORE` handles this string correctly as `(service_id, NULL, "k8s:ingress/payment → payment.example.com")` — the UNIQUE constraint allows two rows with `method=NULL` only if their `path` values differ; this string is unique per service as a whole, so it should insert without conflict.

## Sources

### Primary (HIGH confidence)
- `worker/db/query-engine.js` — `persistFindings()` broken parser (lines 797-815), `getGraph()` response shape, `detectMismatches()` filter
- `worker/db/migrations/003_exposed_endpoints.js` — current `exposed_endpoints` schema (`method TEXT`, `path TEXT NOT NULL`, `UNIQUE(service_id, method, path)`)
- `worker/db/migrations/` directory — confirmed 001-006 exist; next migration is 007
- `worker/server/http.js` — GET /graph passthrough; no exposes in current response
- `worker/ui/modules/detail-panel.js` — routing logic; `renderLibraryConnections()`/`renderServiceConnections()` scaffold; sole caller of `renderLibraryConnections()` confirmed
- `worker/ui/modules/utils.js` — `getNodeType()` confirmed missing infra guard
- `worker/ui/modules/state.js` — `NODE_TYPE_COLORS` confirmed missing infra entry
- `worker/scan/agent-prompt-library.md` — library exposes format (function signatures: `"functionName(param: T): R"`)
- `worker/scan/agent-prompt-infra.md` — infra exposes format (`"k8s:deployment/name"`, ingress format with spaces)
- `worker/scan/agent-schema.json` — `exposes` as `["string"]`; format type-conditional
- `package.json` — confirmed no new dependencies needed

### Secondary (MEDIUM confidence — industry reference)
- Backstage Software Catalog system model (backstage.io/docs/features/software-catalog/system-model) — validates showing library exports as primary panel content, not just connections
- DependenTree by Square (developer.squareup.com/blog/dependentree-graph-visualization-library) — validates function-level export display for library nodes
- GitHub Dependency Graph (docs.github.com/code-security/supply-chain-security) — validates library vs service type distinction

### Tertiary
- SQLite NULL UNIQUE behavior (sqlite.org/nulls.html) — confirmed: each NULL is distinct in UNIQUE indexes; `(service_id, NULL, "path1")` and `(service_id, NULL, "path2")` do NOT conflict; `(service_id, NULL, "path1")` inserted twice DOES conflict

---
*Research completed: 2026-03-17*
*Ready for roadmap: yes*
