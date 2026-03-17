# Stack Research

**Domain:** AllClear v2.3 — Type-specific detail panels (library exports, infra resources)
**Researched:** 2026-03-17
**Confidence:** HIGH (primary sources: direct codebase examination, no new external dependencies required)

---

## Summary for v2.3

This milestone requires **no new npm dependencies**. All required capabilities are already present in the existing stack. The work is three targeted changes:

1. A new SQLite migration (007) to add a `kind` column to `exposed_endpoints`
2. Fixes to `persistFindings()` in `query-engine.js` to store type-appropriate data
3. UI changes to `detail-panel.js` to render `exposed_endpoints` rows per node type

---

## Recommended Stack

### Core Technologies (already installed — no changes)

| Technology | Version | Purpose | Why |
|------------|---------|---------|-----|
| `better-sqlite3` | ^12.8.0 | SQLite storage with WAL, FTS5, migrations | Already in use for all persistence; synchronous API fits worker daemon model; ALTER TABLE ADD COLUMN is safe for the migration pattern needed |
| Node.js ESM modules | >=20.0.0 | Worker daemon, query engine, migration runner | Already the project runtime; migration-007.js follows existing pattern in `worker/db/migrations/` |
| Vanilla JS (browser) | ES2020+ | Canvas UI, detail panel rendering | Already the UI layer; `detail-panel.js` is a plain ESM module — no framework needed for type-conditional HTML rendering |
| Fastify | ^5.8.2 | HTTP server exposing `/graph` | Already serves graph data; `getGraph()` on `QueryEngine` already returns services with `type` field — no API changes required |

### Data Layer Changes

The `exposed_endpoints` table (migration 003) stores what each service exposes, but was designed only for service endpoints ("METHOD PATH" format). It needs a `kind` column to distinguish three data shapes:

| Row kind | Stored in `path` | `method` | Example `path` value |
|----------|-----------------|----------|---------------------|
| `endpoint` | HTTP path | HTTP verb | `/users/{id}` |
| `export` | full signature or name | null | `createClient(config: ClientConfig): EdgeworksClient` |
| `resource` | prefixed resource identifier | null | `k8s:deployment/payment-service` |

**Migration 007** — add `kind TEXT NOT NULL DEFAULT 'endpoint'` to `exposed_endpoints`.

- SQLite `ALTER TABLE ADD COLUMN` with DEFAULT is safe on existing rows.
- Existing rows (all service endpoints) default to `'endpoint'` — no data migration needed.
- The `UNIQUE(service_id, method, path)` constraint is kept as-is; `kind` is derived from the service type at write time, not needed in the uniqueness key.

### persistFindings() Fix

Current code in `query-engine.js` lines 799-815 parses every `svc.exposes` item as "METHOD PATH" by splitting on whitespace:

```js
const parts = endpoint.trim().split(/\s+/);
const method = parts.length > 1 ? parts[0] : null;
const path = parts.length > 1 ? parts[1] : parts[0];
```

This breaks for library exports (`"createClient(config: ClientConfig): EdgeworksClient"` splits into a nonsensical method/path pair) and infra resources (`"k8s:deployment/payment-service"` gets misread as method=`k8s:deployment/payment-service`, path=undefined).

**Fix: branch on `svc.type`**

```js
for (const endpoint of svc.exposes) {
  let method = null;
  let path = endpoint.trim();
  let kind = 'endpoint';

  if (svc.type === 'library' || svc.type === 'sdk') {
    kind = 'export';
    // path = full export signature as-is; no method splitting
  } else if (svc.type === 'infra') {
    kind = 'resource';
    // path = prefixed resource string as-is; no method splitting
  } else {
    // service: parse "GET /path" or just "/path"
    kind = 'endpoint';
    const parts = path.split(/\s+/);
    method = parts.length > 1 ? parts[0] : null;
    path = parts.length > 1 ? parts[1] : parts[0];
  }

  db.prepare(
    'INSERT OR IGNORE INTO exposed_endpoints (service_id, method, path, kind, handler) VALUES (?, ?, ?, ?, ?)'
  ).run(svcId, method, path, kind, svc.boundary_entry || null);
}
```

### detail-panel.js Changes

The detail panel already has `renderLibraryConnections()` and `renderServiceConnections()`. A third renderer `renderInfraConnections()` is needed.

The current library renderer shows connection edges (`e.method`, `e.path` from `connections` table). For v2.3, each renderer should show **what the node exposes** from `exposed_endpoints`, not just edges. This means the `/graph` response needs to carry `exposes` per node, OR a separate fetch is needed.

**Option A: Embed `exposes` in `/graph` response (recommended)**

Add to `getGraph()` in `QueryEngine`:

```js
const exposedByServiceId = {};
const eeRows = this._db.prepare(
  'SELECT service_id, method, path, kind FROM exposed_endpoints'
).all();
for (const row of eeRows) {
  if (!exposedByServiceId[row.service_id]) exposedByServiceId[row.service_id] = [];
  exposedByServiceId[row.service_id].push(row);
}
// Attach to each service in the services array
services.forEach(s => { s.exposes = exposedByServiceId[s.id] || []; });
```

This keeps the UI stateless (no per-node fetch) and matches the existing pattern where the UI consumes one `/graph` response and works from `state.graphData`.

**Option B: New `/node/:id/exposes` endpoint**

Would require a fetch on each node click. Adds latency and HTTP roundtrip. Not recommended — the existing approach passes all data upfront in `/graph`.

### UI Rendering Logic

In `graph.js` `loadProject()`, the service-to-node mapping already preserves `type`. Extend it to also carry `exposes`:

```js
state.graphData.nodes = (raw.services || []).map((s) => ({
  id: s.id,
  name: s.name,
  language: s.language,
  type: s.type || 'service',
  repo_name: s.repo_name,
  exposes: s.exposes || [],   // NEW
}));
```

In `detail-panel.js`, the type dispatch already exists (`isLib` branch). Extend to three branches:

```js
const nodeType = getNodeType(node);
if (nodeType === 'library' || nodeType === 'sdk') {
  html += renderLibraryExports(node.exposes, outgoing, incoming, nameById);
} else if (nodeType === 'infra') {
  html += renderInfraResources(node.exposes, outgoing, incoming, nameById);
} else {
  html += renderServiceConnections(outgoing, incoming, nameById);
}
```

`getNodeType()` in `utils.js` already returns `node.type` for library/sdk but falls through to heuristics. Add `infra` to the explicit type check.

---

## Alternatives Considered

| Recommended | Alternative | Why Not |
|-------------|-------------|---------|
| Add `kind` column to `exposed_endpoints` | Separate `library_exports` and `infra_resources` tables | Two new tables increase migration complexity without benefit; `exposed_endpoints` already has the right FK on `service_id` |
| Embed `exposes` in `/graph` response | Per-node `/node/:id/exposes` fetch on click | Adds click latency; forces async rendering in detail panel; UI already loads entire graph upfront |
| Branch on `svc.type` in `persistFindings` | Detect type from string content | String heuristics are fragile; `svc.type` is already authoritative from agent scan |
| Reuse `exposed_endpoints` table with `kind` | Rename to `exposed_items` | Migration to rename would require re-creating all indexes and FKs; column addition is simpler and backward compatible |

---

## What NOT to Add

| Avoid | Why | Use Instead |
|-------|-----|-------------|
| New npm packages for HTML rendering | The detail panel is 143 lines of template literals — no framework needed | Template literal string concatenation in `detail-panel.js` |
| GraphQL or REST for per-node data | Adds roundtrip latency on click; breakage risk if node clicked before fetch completes | Embed `exposes` in the existing `/graph` response |
| JSON column type for `exposed_endpoints` | SQLite has no JSON column type enforcement; storing structured data in a text column makes querying harder | Flat `(kind, method, path)` columns with explicit values |
| Schema validation changes for `exposes` | `findings.js` already accepts `exposes` as `["string"]` — it does not validate structure | Keep validation permissive; type-conditional parsing is a storage concern, not a schema concern |

---

## Installation

No new packages. Zero `npm install` required for this milestone.

---

## Integration Points

| Component | File | Change Required |
|-----------|------|----------------|
| DB schema | `worker/db/migrations/007_expose_kinds.js` | New migration: `ALTER TABLE exposed_endpoints ADD COLUMN kind TEXT NOT NULL DEFAULT 'endpoint'` |
| Storage | `worker/db/query-engine.js` | `persistFindings()`: type-conditional parser; `getGraph()`: attach `exposes` to service rows |
| HTTP server | `worker/server/http.js` | No change — `getGraph()` result passes through transparently |
| Graph loader | `worker/ui/graph.js` | Map `s.exposes` into `state.graphData.nodes[].exposes` |
| Detail panel | `worker/ui/modules/detail-panel.js` | Add `renderLibraryExports()`, `renderInfraResources()`, update type dispatch |
| Node utils | `worker/ui/modules/utils.js` | Add `infra` to `getNodeType()` explicit type check |
| Upsert statement | `query-engine.js` constructor | `_stmtUpsertExposedEndpoint` — replace inline `db.prepare` in `persistFindings` with a prepared statement |

---

## Version Compatibility

| Package | Version in use | Notes |
|---------|---------------|-------|
| `better-sqlite3` | ^12.8.0 | `ALTER TABLE ADD COLUMN ... DEFAULT` is stable SQLite syntax; works on all SQLite 3.x |
| Node.js | >=20.0.0 | No new Node.js APIs required |

---

## Sources

- Direct codebase examination of `worker/db/migrations/*.js`, `worker/db/query-engine.js`, `worker/ui/modules/detail-panel.js`, `worker/ui/graph.js`, `worker/scan/agent-prompt-library.md`, `worker/scan/agent-prompt-infra.md` — HIGH confidence
- `worker/scan/agent-schema.json` and `worker/scan/findings.js` — confirmed `exposes` is already in schema as `["string"]`, no validator changes needed — HIGH confidence
- `package.json` at repo root — confirmed existing dependency versions — HIGH confidence

---

*Stack research for: AllClear v2.3 type-specific detail panels*
*Researched: 2026-03-17*
