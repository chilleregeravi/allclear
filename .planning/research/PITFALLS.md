# Pitfalls Research

**Domain:** Type-specific detail panels and type-conditional data models in an existing SQLite-backed service dependency graph (AllClear v2.3)
**Researched:** 2026-03-17
**Confidence:** HIGH — based on direct codebase inspection of all relevant files; all failure modes confirmed against actual code paths in `worker/db/query-engine.js`, `worker/scan/findings.js`, `worker/ui/modules/detail-panel.js`, `worker/db/migrations/003_exposed_endpoints.js`, and the three type-specific agent prompts

---

## Critical Pitfalls

### Pitfall 1: The "METHOD PATH" Parser Silently Discards All Library and Infra Exposes Data

**What goes wrong:**
`persistFindings()` in `query-engine.js` (lines 797–815) processes `svc.exposes` with a single split on whitespace: `parts = endpoint.trim().split(/\s+/)`. For service endpoints this works — `"GET /users"` splits into `["GET", "/users"]`. For library exports it fails silently: `"createClient(config: ClientConfig): EdgeworksClient"` splits into `["createClient(config:", "ClientConfig):", "EdgeworksClient"]` and stores method `"createClient(config:"`, path `"ClientConfig):"`. For infra resources it also fails: `"k8s:deployment/payment-service"` stores method `null` (only one part), path `"k8s:deployment/payment-service"` — which is correct by accident, but `"k8s:ingress/payment → payment.example.com"` splits on the space before `→` and stores method `"k8s:ingress/payment"`, path `"→"`. None of these throw errors — they insert silently into `exposed_endpoints` with malformed data.

**Why it happens:**
The `exposed_endpoints` table and `persistFindings()` were written for REST services before library and infra types were added. The schema assumes all exposes entries are `"METHOD PATH"` pairs. The parser was never updated when the library and infra agent prompts were added in a later phase.

**How to avoid:**
Type-dispatch in `persistFindings()` before parsing `svc.exposes`. Use `svc.type` to decide the parse strategy:
- `service`: existing `split(/\s+/)` for `"METHOD PATH"` format
- `library` / `sdk`: store the entire string as `path`, leave `method` null. The path IS the function signature or type name.
- `infra`: extract the typed prefix (`k8s:`, `tf:`, `helm:`, `compose:`) as a structured identifier. Store the full string as `path`, leave `method` null.

This also means the `exposed_endpoints` UNIQUE constraint `UNIQUE(service_id, method, path)` may need to accommodate `method = null` for library/infra rows — verify that `NULL` values are handled correctly by SQLite's UNIQUE index (they are: SQLite treats each NULL as distinct, so two rows with the same `path` but `method = NULL` do NOT conflict).

**Warning signs:**
- Library nodes show "No connections" in the detail panel despite having exported functions
- `SELECT * FROM exposed_endpoints WHERE service_id = <lib_id>` shows rows with `path = "→"` or `path = "ClientConfig):"`
- Infra nodes show zero exposes in the detail panel despite agent scanning them

**Phase to address:**
Data storage phase (Schema migration + `persistFindings()` rewrite). Must be done before the UI detail panel phase — the panel cannot show correct data until the storage layer stores it correctly.

---

### Pitfall 2: renderLibraryConnections() Shows Nothing Because Libraries Have No Edges in This Schema

**What goes wrong:**
`renderLibraryConnections()` in `detail-panel.js` filters `state.graphData.edges` for connections where the library is the source or target. This works correctly — IF there are edges between the library and its consumers. But in the current schema, `exposed_endpoints` stores what a service exposes; it does NOT create edges in the `connections` table between a library and its consumers. A library node appears in the graph with `type = "library"` but `incoming.length === 0` and `outgoing.length === 0`, so the panel renders the "No connections" fallback even though the library has consumers.

The root issue is that connections are only created when an agent scans the consuming service and reports a connection to the library. If only the library repo has been scanned (but not its consumers), there are no edges, and the panel correctly shows nothing. But even when consumer repos have been scanned, `renderLibraryConnections()` retrieves the function signature from `e.method` and `e.path` on the connection edge — which were set by the consuming service's scanner, not the library's `exposes` list. The library's own exposes data (its public API surface) is stored in `exposed_endpoints` but is never fetched by the UI.

**Why it happens:**
The detail panel was built on top of the `connections` graph (edges between nodes). Library/infra exposes data is in a separate table (`exposed_endpoints`) that the UI never queries. There is no API endpoint that returns a service's exposed endpoints to the UI.

**How to avoid:**
The detail panel for library and infra nodes needs to query `exposed_endpoints` directly, not derive information from edges. Add a new HTTP route `GET /api/exposes?service_id=<id>` (or include exposes in the `GET /graph` response) so the UI can show a library's exported functions alongside (or instead of) the edge-derived connection list. The existing `renderLibraryConnections()` then becomes a secondary section ("Consumer services using this library") while the new primary section shows "Exported API" from `exposed_endpoints`.

**Warning signs:**
- Library detail panel always shows "No connections" regardless of scan results
- The `exposed_endpoints` table has rows for the library but the panel never shows them
- `renderLibraryConnections()` is not broken — it just has no data to show because edges are never populated from `exposed_endpoints`

**Phase to address:**
HTTP API + UI panel phase. Cannot be addressed by fixing `persistFindings()` alone — requires a new data fetch path from UI to DB.

---

### Pitfall 3: Migration for Type-Conditional Storage Breaks the UNIQUE Constraint on exposed_endpoints

**What goes wrong:**
The current `exposed_endpoints` schema has `UNIQUE(service_id, method, path)`. When the parser is fixed (Pitfall 1) to store library exports as `method = NULL, path = "functionName(...)"`, two separate exports with different signatures insert fine. But when the agent re-scans and produces the same export list, `INSERT OR IGNORE` fires correctly on `(service_id, NULL, "createClient(config: ClientConfig): EdgeworksClient")`. This is correct.

However, if the existing `exposed_endpoints` table already contains rows with malformed data from the broken parser (e.g., `path = "→"`, `path = "ClientConfig):"`) and a migration adds a `type` column to distinguish service vs. library vs. infra rows without first cleaning up the malformed rows, the `exposed_endpoints` table becomes permanently polluted. The UNIQUE constraint prevents the corrected rows from being inserted on next scan (`INSERT OR IGNORE` silently skips the new row because the old malformed row still exists for the same `(service_id, method, path)` triple).

**Why it happens:**
The migration adds a column but does not clean up existing data. The `INSERT OR IGNORE` in `persistFindings()` treats the existing malformed row as a successful match and does not update it. The table stays malformed until the row is explicitly deleted or replaced.

**How to avoid:**
Migration 007 must:
1. Add the `expose_type` column to `exposed_endpoints` (TEXT, nullable, default null)
2. DELETE all existing `exposed_endpoints` rows whose `path` does not match `^[A-Z]+ /` (service REST format) — these are malformed library/infra rows from the broken parser
3. Set `expose_type = 'rest'` on all remaining rows (they are service rows)

Alternatively, change `persistFindings()` to use `INSERT OR REPLACE` (not `INSERT OR IGNORE`) for `exposed_endpoints` so that re-scans always update stale rows. But verify that `INSERT OR REPLACE` does not cascade-delete anything referencing `exposed_endpoints` — the current schema has no child tables referencing it, so this is safe.

**Warning signs:**
- After deploying the fix, library exposes still show malformed data
- Re-scan of a library repo does not update the exposed functions list
- `SELECT * FROM exposed_endpoints WHERE service_id = X` returns both old malformed rows and new correct rows for the same service

**Phase to address:**
Schema migration phase (Migration 007). Must run before `persistFindings()` fix is deployed, or at least atomically with it.

---

### Pitfall 4: The Detail Panel Falls Into the Service Rendering Path for Infra Nodes

**What goes wrong:**
`showDetailPanel()` in `detail-panel.js` checks `getNodeType(node)` and routes to `renderLibraryConnections()` if `nodeType === "library" || nodeType === "sdk"`. All other types — including `"infra"` — fall through to `renderServiceConnections()`. An infra node then shows a "Calls" / "Called by" panel in service format, which misrepresents infra connections. An infra node's connections use `method: "deploy"` or `method: "configure"` and `protocol: "k8s"` — these display as `"deploy"` in the method badge and `"k8s:deployment/payment-service"` in the path field, which is technically accurate but contextually wrong ("Calls" implies an API call, not a deployment).

More importantly: if infra-specific detail content (managed resources list) is later added to `renderInfraConnections()`, forgetting to add the `nodeType === "infra"` branch to the routing condition means the new function is never called. This is easy to miss because the service fallthrough "works" (shows something), hiding the bug.

**Why it happens:**
The routing condition was written for the original two types (service and library). Infra was added as a third type after the panel was written. The condition was not updated.

**How to avoid:**
Immediately add an `else if (nodeType === "infra")` branch, even before `renderInfraConnections()` is fully built. A stub that renders `<div>Infra node — managed resources panel coming soon</div>` is better than silently falling through to service rendering. This makes the routing explicit and prevents the service fallthrough from masking missing infra-specific content.

**Warning signs:**
- Infra nodes show "Calls" and "Called by" section headers instead of "Manages" or "Deployed services"
- `renderInfraConnections()` exists in the file but never appears in the rendered panel for any node
- Clicking an infra node and a service node produces visually identical panel layouts

**Phase to address:**
UI panel phase. Add the routing branch as the very first change before building any infra-specific HTML.

---

### Pitfall 5: getGraph() Does Not Return exposed_endpoints — UI Has No Source for Library/Infra Exposes

**What goes wrong:**
The `/graph` endpoint returns `{ services, connections, repos, mismatches }`. The `state.graphData` object in the UI contains `nodes` (from services) and `edges` (from connections). There is no `exposes` collection in graph state. When the detail panel needs to show a library's exported API, it has no data to work with unless a separate fetch is made. If the panel is built under the assumption that exposes data is embedded in the node object (e.g., `node.exposes`), it will always render empty because the node objects from `getGraph()` do not include exposes data.

**Why it happens:**
`getGraph()` was written for the service-to-service connection graph. Exposes data is a per-service property stored in a separate table. The connection was never made between the graph data model and the exposes table.

**How to avoid:**
Two valid approaches:
1. **Embed in node**: Extend `getGraph()` to LEFT JOIN `exposed_endpoints` and attach `exposes: [{method, path, expose_type}]` directly to each service node. This is simpler for the UI but increases graph payload size.
2. **Separate fetch**: Add `GET /api/service/:id/exposes` and fetch lazily when the user clicks a node. This is more efficient for large graphs (most nodes are services with no exposes).

Approach 2 is better for the existing architecture because the detail panel already opens on click — the fetch can happen at click time. Avoid approach 1 for now because it increases payload size for every graph load even when the user never opens the detail panel.

**Warning signs:**
- `node.exposes` is `undefined` in the detail panel render function
- The exposes section renders empty even after `persistFindings()` is fixed
- No API route exists that accepts a service ID and returns its exposed endpoints

**Phase to address:**
HTTP API phase. Must precede the UI detail panel phase.

---

## Technical Debt Patterns

| Shortcut | Immediate Benefit | Long-term Cost | When Acceptable |
|----------|-------------------|----------------|-----------------|
| Re-use `exposed_endpoints` table for library/infra without adding an `expose_type` column | No schema migration needed | Library function signatures and infra resources mixed with REST endpoints in same table; mismatch detection queries must filter by service type to avoid false positives | Never — mismatch detection already queries this table and will flag function signatures as "missing endpoints" |
| Add infra routing to detail panel by piggybacking on library branch (`nodeType === "library" \|\| nodeType === "infra"`) | One-line change | Infra and library have different semantics; library shows "Provided by" but infra should show "Manages"; shared rendering path produces confusing labels | Acceptable only as a temporary stub; give infra its own render function before the phase is marked complete |
| Skip the `/api/service/:id/exposes` endpoint and embed exposes in `getGraph()` | No second fetch needed in UI | Graph payload grows by `(num_library_nodes + num_infra_nodes) × avg_exposes_count` entries; hits the browser DOM size limit at ~50 nodes with 30+ exports each | Acceptable only for single-team installs with < 10 library/infra nodes |
| Use `INSERT OR IGNORE` instead of `INSERT OR REPLACE` for fixed `exposed_endpoints` parser | Simpler, no cascades possible (no child tables) | Existing malformed rows from old scanner block correct rows from being inserted; re-scan never fixes old stale data | Never after migration cleanup — only safe once migration deletes all malformed rows first |

---

## Integration Gotchas

| Integration | Common Mistake | Correct Approach |
|-------------|----------------|------------------|
| `exposed_endpoints` UNIQUE(service_id, method, path) + `method = NULL` for library rows | Assuming two NULL methods won't conflict; or assuming they WILL conflict and using a workaround | SQLite treats each NULL as distinct in UNIQUE indexes — `(service_id=1, method=NULL, path="fn1")` and `(service_id=1, method=NULL, path="fn2")` are allowed; `(service_id=1, method=NULL, path="fn1")` inserted twice DOES conflict |
| Detail panel state + project switcher teardown | Forgetting to clear exposes fetch cache on project switch | If exposes are fetched lazily per click and cached, the cache must be cleared in the project-switcher teardown path (see known tech debt: `setupControls()` listener accumulation) |
| `getNodeType()` in `utils.js` returns `"library"` for both `type="library"` and `type="sdk"` nodes | Building infra logic that checks `getNodeType()` and misses raw `node.type === "infra"` | Verify whether `getNodeType()` maps `"infra"` or falls through to a default; add explicit `"infra"` handling in `getNodeType()` before using it in routing conditions |
| New HTTP route for exposes + existing Fastify CORS config | Adding `/api/service/:id/exposes` without verifying it respects existing CORS origin whitelist | The CORS config in `http.js` is an allowlist — new routes inherit it automatically via `@fastify/cors` plugin registration order; no per-route CORS config needed |

---

## Performance Traps

| Trap | Symptoms | Prevention | When It Breaks |
|------|----------|------------|----------------|
| Embedding all exposes in `getGraph()` response | Graph load latency increases; UI DOM builds large invisible data structure for every node | Lazy fetch exposes only on click (Pitfall 5 approach 2) | At ~30 library/infra nodes with 20+ exports each (~600 extra rows in graph response) |
| Loading all exposes upfront on graph load even for unfocused nodes | 300ms+ delay before graph renders; user perceives slow map | Fetch exposes per-click with `AbortController` to cancel in-flight fetch on panel close | Immediately visible for any infra repo with > 50 k8s resources |
| Querying `exposed_endpoints` without a covering index on `(service_id)` | Detail panel exposes fetch is slow for large graphs | The existing table has no explicit index on `service_id` alone (only on the composite UNIQUE key) — `(service_id, method, path)` covers `service_id` as the leftmost column so index scans work correctly; verify with `EXPLAIN QUERY PLAN` | At ~10,000 exposed endpoint rows across all services |

---

## Security Mistakes

| Mistake | Risk | Prevention |
|---------|------|------------|
| Rendering `node.exposes` HTML directly without escaping function signatures | XSS: a library export named `"<img src=x onerror=alert(1)>"` injected by a malicious scan result renders as HTML | Always use `textContent` or explicit HTML escaping when rendering user-controlled strings in the detail panel; the current panel uses template literals with direct string interpolation — audit all `${e.method}`, `${e.path}`, `${e.source_file}` insertions |
| No sanitization of `expose_type` column values in migration | If a row with an unexpected `expose_type` value slips in, UI rendering switches on the value and falls through to undefined behavior | Constrain `expose_type` to a CHECK constraint in migration 007: `CHECK(expose_type IN ('rest', 'function', 'type', 'k8s', 'tf', 'helm', 'compose') OR expose_type IS NULL)` |

---

## UX Pitfalls

| Pitfall | User Impact | Better Approach |
|---------|-------------|-----------------|
| Library detail panel shows "No connections" when library has no consumer edges yet | User believes the library is unused; runs unnecessary re-scans | Show "Exported API" from `exposed_endpoints` even when no consumer edges exist; separate "API Surface" section from "Used by" section so an unlinked library still shows its exports |
| Infra detail panel shows connection labels from service rendering ("Calls", "Called by") | User confused — infra doesn't "call" services; it deploys/configures them | Rename labels to "Manages" (for deploy connections) and "Configures" (for configure connections) in `renderInfraConnections()` |
| Clicking a library node with 40+ exported functions overflows the detail panel | Detail panel grows past viewport; user must scroll within the panel to see consumers | Cap exposes display to first 20 entries with a "Show all (N)" expand link; or truncate long function signatures |
| Long function signatures like `"createRenderPipeline(descriptor: GPURenderPipelineDescriptor): Promise<GPURenderPipeline>"` overflow the panel | Text overflows connection item container; panel layout breaks | Apply `overflow: hidden; text-overflow: ellipsis; white-space: nowrap` to `.conn-path` for library nodes; show full signature in a tooltip on hover |

---

## "Looks Done But Isn't" Checklist

- [ ] **Parser dispatches on type:** After `persistFindings()` fix, scan a library repo and verify `SELECT path FROM exposed_endpoints WHERE service_id = X` returns full function signatures, not split fragments
- [ ] **Infra exposes stored correctly:** After fix, scan an infra repo and verify `SELECT path FROM exposed_endpoints WHERE service_id = Y` returns `"k8s:deployment/..."` format, not `"→"` or empty
- [ ] **Migration cleans malformed rows:** Run migration 007 against a DB with pre-existing malformed exposes rows; verify zero rows remain with `path = '→'` or `path LIKE '%ClientConfig):%'`
- [ ] **Infra panel uses infra rendering:** Click an infra node and verify the panel does NOT show "Calls" or "Called by" section headers
- [ ] **Library panel shows exports:** Click a library node after a re-scan and verify exported function names appear under an "Exported API" section
- [ ] **Exposes fetch API exists:** `GET /api/service/:id/exposes` returns `[{method, path, expose_type}]` for a scanned library — not 404
- [ ] **XSS escaping in panel:** The detail panel HTML template uses safe escaping (not raw `innerHTML` concatenation) for all user-controlled fields including function signatures
- [ ] **UNIQUE NULL handling verified:** Insert two library exports with `method = NULL` and different `path` values into `exposed_endpoints` for the same service — verify both rows insert without UNIQUE constraint error

---

## Recovery Strategies

| Pitfall | Recovery Cost | Recovery Steps |
|---------|---------------|----------------|
| Malformed library/infra exposes in `exposed_endpoints` | LOW | `DELETE FROM exposed_endpoints WHERE path IN ('→') OR path LIKE '%):%'` via SQLite CLI; re-scan affected repos |
| Migration 007 deployed without data cleanup — malformed rows block correct inserts | MEDIUM | Run cleanup query manually, then change `INSERT OR IGNORE` to `INSERT OR REPLACE` in `persistFindings()` for exposes, then re-scan |
| Library detail panel shows service-format connections | LOW | Fix the `showDetailPanel()` routing condition to include `"sdk"` check; re-test with click — no data loss, UI-only fix |
| Infra nodes falling through to service rendering | LOW | Add `nodeType === "infra"` branch in `showDetailPanel()`; pure UI fix, no data migration needed |
| `getGraph()` does not include exposes, panel renders empty | MEDIUM | Add `/api/service/:id/exposes` route, add fetch call in detail panel click handler, re-test |

---

## Pitfall-to-Phase Mapping

| Pitfall | Prevention Phase | Verification |
|---------|------------------|--------------|
| "METHOD PATH" parser discards library/infra exposes | Phase 1: `persistFindings()` type-dispatch rewrite | After scan, `exposed_endpoints` has full function signatures for library nodes |
| Migration doesn't clean malformed existing rows | Phase 1: Migration 007 | Zero rows with malformed paths after migration; re-scan inserts correct rows |
| `renderLibraryConnections()` has no data to show | Phase 2: HTTP route for exposes | `GET /api/service/:id/exposes` returns correct data before panel phase begins |
| Detail panel has no exposes data source | Phase 2: HTTP route for exposes | UI can fetch and render exposes before wiring to full panel design |
| Infra nodes fall through to service rendering | Phase 3: UI panel routing | Infra click shows distinct panel content, not service labels |
| Library panel shows "No connections" instead of exports | Phase 3: UI panel — exposes section | Library click shows "Exported API" section populated from exposes fetch |
| XSS via function signatures in panel | Phase 3: UI panel | HTML escaping audit passes; no raw `innerHTML` with user-controlled strings |

---

## Sources

- Codebase inspection: `worker/db/query-engine.js` lines 797–815 (`persistFindings()` exposes parser — confirmed split logic and `INSERT OR IGNORE` behavior)
- Codebase inspection: `worker/ui/modules/detail-panel.js` (`showDetailPanel()` routing condition, `renderLibraryConnections()` vs. `renderServiceConnections()`)
- Codebase inspection: `worker/db/migrations/003_exposed_endpoints.js` (schema: `method TEXT`, `path TEXT NOT NULL`, `UNIQUE(service_id, method, path)`)
- Codebase inspection: `worker/scan/agent-prompt-library.md` (exposes format: `"functionName(param: Type): ReturnType"` — confirmed multi-word strings with spaces)
- Codebase inspection: `worker/scan/agent-prompt-infra.md` (exposes format: `"k8s:deployment/service"`, `"k8s:ingress/name → host"` — confirmed space in ingress format breaks the parser)
- Codebase inspection: `worker/scan/agent-schema.json` (`exposes: ["string — format depends on type (see prompt)"]` — confirms type-conditional format expectation)
- Codebase inspection: `worker/server/http.js` (GET /graph returns `qe.getGraph()` — no exposes included in response)
- [SQLite UNIQUE index and NULL values](https://sqlite.org/nulls.html) — Confirmed: SQLite treats each NULL as distinct in UNIQUE constraints; two rows with `method = NULL` and the same `path` DO conflict (same service_id + NULL method + same path = UNIQUE violation); two rows with `method = NULL` and DIFFERENT paths do not conflict
- Known issue: `PROJECT.md` v2.3 milestone description — "exposed_endpoints parsing assumes 'METHOD PATH' format — breaks for function signatures and k8s resources"

---

*Pitfalls research for: AllClear v2.3 — Type-Specific Detail Panels (library exports, infra resources)*
*Researched: 2026-03-17*
