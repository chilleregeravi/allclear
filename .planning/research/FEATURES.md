# Feature Research

**Domain:** Developer tool — type-specific detail panels for a local service dependency graph UI
**Researched:** 2026-03-17
**Confidence:** HIGH (based on codebase inspection of v2.2 source + industry reference from Backstage catalog model)

> **Scope note:** This document covers v2.3 features only. All prior capabilities (graph rendering,
> agent scanning, connections storage, service detail panel, scan data integrity) are **already
> shipped** and are **dependencies**, not targets. Features below extend the detail panel system to
> handle library and infra nodes — they must not break the existing service detail panel.

---

## Current State (Evidence Base)

Read directly from the v2.2 source. These are facts, not assumptions.

| What exists | File | Notes |
|-------------|------|-------|
| Service detail panel (calls / called-by with mismatch flags) | `worker/ui/modules/detail-panel.js` | Works correctly; not changed in v2.3 |
| Library panel scaffold (`renderLibraryConnections`) | `worker/ui/modules/detail-panel.js:61–96` | Renders connection edges using `e.method` and `e.path`; reads same format as service panel; shows "Provides (N)" and "Used by (N services)" |
| `exposed_endpoints` table (migration 003) | `worker/db/migrations/003_exposed_endpoints.js` | Schema: `(service_id, method, path, handler)` — designed for "GET /users" REST endpoints only; not structured for library exports or infra resources |
| `persistFindings()` exposes parser | `worker/db/query-engine.js:797–815` | Splits `svc.exposes` strings on whitespace: `parts[0]` = method, `parts[1]` = path; treats all entries as REST-style; a library export `"createClient(config: ClientConfig): EdgeworksClient"` would store `"createClient(config:"` as `method` and `"ClientConfig):"` as `path` — unusable |
| Agent prompts produce correct data | `worker/scan/agent-prompt-library.md`, `agent-prompt-infra.md` | Library exposes: `"functionName(params): ReturnType"` and type names. Infra exposes: `"k8s:deployment/payment-service"`, `"tf:output/db_connection_string"`, `"helm:values/env.DATABASE_URL"`. Data is structurally correct; only the storage and display layers are wrong. |
| No infra panel rendering | `worker/ui/modules/detail-panel.js:43–49` | `isLib` check covers `library` and `sdk`; infra nodes fall through to `renderServiceConnections` which shows REST-style method/path for k8s/tf/helm paths |

The core problem: `persistFindings()` stores `svc.exposes` through a "GET /path" parser, and the
panel renders everything as `method + path`. Library and infra data is structurally incompatible
with this format at both storage and display layers.

---

## Feature Landscape

### Table Stakes (Users Expect These)

These are the minimum for v2.3 to feel correct. Without them, clicking a library or infra node
produces confusing output (truncated function signatures as "method", empty or garbled paths).

| Feature | Why Expected | Complexity | Depends On |
|---------|--------------|------------|------------|
| Library detail panel shows exported API surface | Any tool that shows library nodes (Backstage Component kind=library, GitHub Dependency Graph, DependenTree) shows what the library exports, not just who calls it. The library's exports ARE the thing that changes and breaks callers. | MEDIUM | New `exposed_items` table or `exposed_endpoints` schema extension; storage fix in `persistFindings()`; `renderLibraryPanel()` in detail-panel.js |
| Library panel shows consumer list (deduplicated by service name) | The current scaffold already does dedup via a `Set` in `renderLibraryConnections`. This behavior is correct and expected — users want "which 3 services use this SDK?" not a list of individual import edges. | LOW | Already partially built; depends on correct data being stored first |
| Infra detail panel shows managed resources with typed prefixes | When clicking an infra diamond node, users need to see what it manages: `k8s:deployment/payment-service`, `k8s:configmap/payment-env`, not a garbled REST representation. The `k8s:`, `tf:`, `helm:`, `compose:` prefixes from the agent prompt are the display format — they should be preserved as-is. | MEDIUM | New storage column (or separate `exposed_items` table) that stores raw exposes strings without parsing them as REST endpoints; new `renderInfraPanel()` function |
| Infra panel shows configured/deployed services | Infra → service connections have `method: "deploy"` or `method: "configure"` and a structured path like `k8s:configmap/payment-env → PAYMENT_DB_URL`. The panel should show "Configures: payment-service (via k8s:configmap/payment-env → PAYMENT_DB_URL)". This is already stored in the `connections` table — only the display is wrong. | LOW | No storage changes needed; `renderInfraPanel()` reads existing connection edges with k8s/tf/helm protocols |
| `persistFindings()` stores library/infra exposes without garbling them | The current `parts = endpoint.trim().split(/\s+/)` parser must not run on library function signatures or infra resource strings. A `"k8s:deployment/payment-service"` must be stored as a single displayable unit, not split into nonsense method+path. | MEDIUM | Schema: add `item_type` column to `exposed_endpoints` OR create separate `exposed_items` table; update `persistFindings()` with type-conditional storage; migration 007 |

### Differentiators (Competitive Advantage)

Features that go beyond "not broken" and actively add value for v2.3 specifically.

| Feature | Value Proposition | Complexity | Depends On |
|---------|-------------------|------------|------------|
| Library panel groups exports by kind (functions vs types) | Backstage and GitHub Dependency Graph both distinguish interface/type exports from callable function exports. Showing `"Types (3): ClientConfig, EventHandler, Subscription"` vs `"Functions (4): createClient, publishEvent..."` makes the library surface immediately scannable. Parsing is trivial: strings containing `(` are functions, others are types. | LOW | Correct data in storage first; purely a `renderLibraryPanel()` classification step — no schema change needed |
| Infra panel groups resources by prefix (k8s / tf / helm) | When an infra repo manages 15 resources, grouping by `k8s:` (8), `tf:` (4), `helm:` (3) mirrors how operators think. No additional data needed — the prefix is already in the stored string. Pure display logic. | LOW | Correct data in storage first; purely a `renderInfraPanel()` grouping step — no schema change needed |
| Source file link for library exports | The agent stores `boundary_entry` (e.g., `src/index.ts`) on each library service. Showing this in the panel gives developers a one-click navigation target. Already in the `services` table as `root_path` / can be stored in handler column of `exposed_endpoints`. | LOW | `boundary_entry` is already in the agent JSON; needs to be persisted to `services` table (add `boundary_entry` column in migration 007) or read from handler column |

### Anti-Features (Commonly Requested, Often Problematic)

| Feature | Why Requested | Why Problematic | Alternative |
|---------|---------------|-----------------|-------------|
| Expand/collapse sections inside the panel | "Show me only the types, hide the functions" | Adds stateful UI complexity (section open/closed state, animations, JS event overhead) for a panel that typically shows <20 items. Premature optimization. | Render everything; CSS scroll handles long lists. Revisit if users report panels with 50+ exports. |
| Click-to-navigate from a library export to its source file | "Click `createClient` and open `src/client.ts` in editor" | Requires editor integration (deep-link protocol or file:// open), which is OS-dependent, requires user permission, and is outside the AllClear scope (no external service deps). | Show the source file path as plain text. Users can copy-paste. |
| Live "who's importing this function right now" from AST | "Instead of scan data, show real-time import analysis" | Requires a language server per repo (TypeScript Language Service, pylsp, rust-analyzer). Multi-language, multi-version, out-of-process. Out of scope for v2.3. | Use connection edges from the last scan; users re-scan when they need fresh data. |
| Infra panel with kubectl live status | "Show whether `k8s:deployment/payment-service` is currently Running vs CrashLoopBackOff" | `/allclear:pulse` already covers live service health. Mixing scan-derived static data (what the IaC says should exist) with live cluster state in the same panel creates confusion about data freshness. | Link to `/allclear:pulse` output for live state; keep the detail panel as scan-derived static data only. |
| Separate "Exports" tab vs "Connections" tab in the panel | "Library panel should have tabs for its own exports and its outgoing calls" | Tab UI requires layout changes that affect the panel for all node types. Current panel has no tabs. Scope creep. | Render exports section above connections section. Vertical layout with section headers is sufficient. |

---

## Feature Dependencies

```
[Migration 007: schema for type-aware exposes storage]
    └──required by──> [Fix persistFindings() to not garble library/infra exposes]
    └──required by──> [Library panel shows exported API surface (correct data)]
    └──required by──> [Infra panel shows managed resources (correct data)]

[Fix persistFindings() storage]
    └──required by──> [renderLibraryPanel() — needs correct stored exports]
    └──required by──> [renderInfraPanel() — needs correct stored resources]
    └──NOT required by──> [Infra panel shows configured/deployed services]
                              (connections already stored correctly; display only)

[renderLibraryPanel()]
    └──enhances──> [Groups exports by kind (functions vs types) — pure display logic]
    └──enhances──> [Source file link — reads boundary_entry from services table]

[renderInfraPanel()]
    └──enhances──> [Groups resources by prefix (k8s/tf/helm) — pure display logic]

[Existing renderServiceConnections() in detail-panel.js]
    └──unchanged by all of the above — service panel is not touched in v2.3]

[Existing connections table (protocol, method, path)]
    └──already correct for infra connections (deploy/configure with k8s: paths)]
    └──already correct for library connections (sdk/import protocol)]
```

### Dependency Notes

- **The storage fix must ship before any panel rendering work.** Writing `renderLibraryPanel()` against the current garbled data would require the renderer to undo the parser's damage — fragile and wrong.
- **Migration 007 is the foundation.** It must handle existing users who have library/infra repos already scanned (their `exposed_endpoints` rows have garbled data — the migration should truncate those rows for non-service types or add a `raw_text` column to store the original string alongside the broken method/path).
- **The infra "configured services" panel section needs no storage changes.** Connection edges for infra repos already have correct protocol (`k8s`, `tf`, `helm`) and method (`deploy`, `configure`). Only `renderInfraPanel()` needs to display them differently from REST connections.
- **`renderLibraryConnections()` already exists.** It is a scaffold that will be replaced/extended — not built from scratch. The "Used by" dedup logic (`Set` of consumer names) is correct and should be kept.
- **`boundary_entry` from the agent prompt is not currently persisted.** The agent emits it, `agent-schema.json` documents it, but `persistFindings()` does not write it to the `services` table. This is a minor gap; storing it in migration 007 as a new column enables the source file link differentiator.

---

## MVP Definition (v2.3)

### Launch With (v2.3 core)

Minimum for the milestone goal: "Make library and infra nodes show type-appropriate data in the
detail panel."

- [ ] Migration 007: add `raw_text` column to `exposed_endpoints` (stores original agent string
  verbatim); add `boundary_entry` column to `services` (optional, for source file display) — handles
  existing rows safely by defaulting `raw_text = path` for existing service rows
- [ ] Fix `persistFindings()`: detect node type from `svc.type`; for `service` nodes continue
  using the existing "GET /path" parser; for `library`/`sdk` nodes store the full export string in
  `raw_text` with `method=null`; for `infra` nodes store the full resource string in `raw_text`
  with `method=null`; persist `boundary_entry` to services row
- [ ] `renderLibraryPanel()` in `detail-panel.js`: show exports grouped as Functions and Types
  (classify by presence of `(`); show source file from `boundary_entry`; show "Used by" consumer
  list (keep existing dedup Set logic)
- [ ] `renderInfraPanel()` in `detail-panel.js`: show managed resources from `exposed_endpoints.raw_text`
  grouped by prefix (`k8s:`, `tf:`, `helm:`, `compose:`); show deploy/configure connections to
  services from existing connection edges with correct method labels
- [ ] Update `showDetailPanel()` dispatch: add `infra` to the type check (currently only `library`
  and `sdk` get non-service rendering); route `infra` type nodes to `renderInfraPanel()`

### Add After Validation (v2.3.x)

- [ ] `/api/graph` endpoint enrichment: include `exposed_items` count per node so the UI can show
  "14 exports" or "8 resources" on the node tooltip — add only if users ask for it
- [ ] Re-scan existing library/infra repos to populate `raw_text` correctly — no code needed, just
  operator action; document in CHANGELOG

### Future Consideration (v2.4+)

- [ ] Diff panel: "these 3 exports were removed since last scan" — requires scan version history UI
  (deferred to v2.4, depends on map_versions browsability)
- [ ] Filter panel content (show only functions, hide types) — revisit only if users report panels
  with 50+ exports

---

## Feature Prioritization Matrix

| Feature | User Value | Implementation Cost | Priority |
|---------|------------|---------------------|----------|
| Migration 007 (raw_text + boundary_entry columns) | HIGH — foundation for everything else | LOW — additive migration, no data loss | P1 — must ship first |
| Fix `persistFindings()` type-conditional storage | HIGH — current data is unusable for library/infra | MEDIUM — branch on `svc.type`, keep REST path for services | P1 — required |
| `renderLibraryPanel()` with functions/types grouping | HIGH — library node clicks currently show confusing data | MEDIUM — new render function replacing scaffold | P1 — required |
| `renderInfraPanel()` with resource grouping | HIGH — infra node clicks currently show garbled REST output | MEDIUM — new render function, uses existing connection data for deploy/configure | P1 — required |
| Update `showDetailPanel()` dispatch for `infra` type | HIGH — without this the infra panel function is never called | LOW — add one branch to existing type check | P1 — required |
| Source file link (boundary_entry) | MEDIUM — nice to have, helps navigation | LOW — store one extra field, display in panel header | P2 — ship in same PR if easy |
| Groups by prefix in infra panel | MEDIUM — improves scannability for repos with many resources | LOW — pure display logic, no data changes | P2 — include in renderInfraPanel() |

**Priority key:**
- P1: Required for v2.3 to meet its stated goal
- P2: Include in same PR if it adds no risk; defer if it does
- P3: Future consideration

---

## Industry Reference: How Comparable Tools Handle This

| Tool | Type differentiation in detail panel | Library panel content | Infra/resource panel content |
|------|-------------------------------------|-----------------------|-----------------------------|
| **Backstage catalog** | Separate entity pages per Kind (Component, Resource, API, Library). Each Kind has a different default tab set. Library components show "Provided APIs", "Consumed APIs", "Dependencies". | Exported APIs listed by name and type; dependencies on other catalog entities | Resource entities show owner, system, and linked components — not raw IaC files |
| **GitHub Dependency Graph** | Differentiates packages (libraries) from runtime services. Library packages show: exports (from package manifest), consumers (repositories that depend on it), vulnerability alerts. | Exports derived from `package.json` exports field or SBOM manifest; shown as package name + version | No infra node type; closest equivalent is the "environments" tab which shows deployment targets per repo |
| **Novatec Service Dependency Graph (Grafana)** | All nodes are services; no library or infra distinction. Detail tooltip shows: response time, error rate, request rate per connection. | N/A | N/A |
| **DependenTree (Square)** | Differentiates library packages from service applications. Library nodes show exports at function level (which functions are actually called by consumers, derived from static analysis). | Function-level export + call-site mapping — the "what is actually used" view, not just "what is exported" | N/A |
| **AllClear v2.3 (target)** | Three types: service (circle), library (hexagon), infra (diamond). Service panel: unchanged (calls/called-by with mismatch detection). Library panel: exported API surface + consumer list. Infra panel: managed resources grouped by prefix + deploy/configure connections. | Exports from scan data (function signatures + type names); consumers from connection edges | Resources from scan data (k8s/tf/helm prefixed strings); deploy/configure targets from connection edges |

**Key insight from industry reference:** Backstage and DependenTree both show the library's exports as the primary content of a library node — not just its connections. This validates the v2.3 design direction. No tool in this category shows the "Used by" list as the primary content for a library; it is secondary to the export surface. AllClear's current scaffold has this inverted (connections first, no exports).

---

## Sources

- Codebase inspection: `worker/ui/modules/detail-panel.js`, `worker/db/query-engine.js:797–815`, `worker/db/migrations/003_exposed_endpoints.js`, `worker/scan/agent-prompt-library.md`, `worker/scan/agent-prompt-infra.md`, `worker/scan/agent-schema.json` — HIGH confidence (source of truth)
- Backstage Software Catalog system model — [backstage.io/docs/features/software-catalog/system-model](https://backstage.io/docs/features/software-catalog/system-model/) — MEDIUM confidence (industry reference for type-differentiated catalog UI)
- DependenTree, Square's graph visualization library — [developer.squareup.com/blog/dependentree-graph-visualization-library](https://developer.squareup.com/blog/dependentree-graph-visualization-library/) — MEDIUM confidence (function-level library export display reference)
- GitHub Dependency Graph documentation — [docs.github.com/code-security/supply-chain-security](https://docs.github.com/code-security/supply-chain-security/understanding-your-software-supply-chain/about-the-dependency-graph) — MEDIUM confidence (library vs service type distinction)
- Novatec Service Dependency Graph panel — [grafana.com/grafana/plugins/novatec-sdg-panel](https://grafana.com/grafana/plugins/novatec-sdg-panel/) — MEDIUM confidence (comparison: service-only tool with no library/infra differentiation)

---
*Feature research for: AllClear v2.3 — Type-Specific Detail Panels*
*Researched: 2026-03-17*
