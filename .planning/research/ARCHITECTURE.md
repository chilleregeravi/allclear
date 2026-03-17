# Architecture Research

**Domain:** AllClear v2.3 — Type-Specific Detail Panels (library exports, infra resources)
**Researched:** 2026-03-17
**Confidence:** HIGH — based on direct source code inspection of all affected modules

---

## Context

This file covers v2.3 integration architecture only. Previous v2.2 migration research has been superseded. The question answered here: how do type-specific detail panels integrate with the existing architecture, what components change, what is new, and in what order should work proceed?

---

## Existing System Overview

```
┌──────────────────────────────────────────────────────────────────────────┐
│                          Agent Scan Layer                                │
│  agent-prompt-service.md   agent-prompt-library.md   agent-prompt-infra.md│
│          ↓                         ↓                         ↓           │
│          └──────── agent-schema.json (shared output shape) ──────────────┘
│                                                                          │
│  exposes format is TYPE-CONDITIONAL:                                     │
│    service  → "METHOD /path"  e.g. "GET /users"                         │
│    library  → "fnName(param: T): R"  or just "TypeName"                 │
│    infra    → "k8s:deployment/name"  "tf:output/name"  etc.             │
└──────────────────────────────┬───────────────────────────────────────────┘
                               │ findings JSON → POST /scan
┌──────────────────────────────▼───────────────────────────────────────────┐
│                      Persistence Layer (query-engine.js)                 │
│  persistFindings(repoId, findings, commit, scanVersionId)                │
│                                                                          │
│  BROKEN SECTION (lines 797-815):                                         │
│    for (const endpoint of svc.exposes) {                                 │
│      const parts = endpoint.trim().split(/\s+/);   // "METHOD PATH" only │
│      const method = parts.length > 1 ? parts[0] : null;                 │
│      const path   = parts.length > 1 ? parts[1] : parts[0];             │
│      INSERT INTO exposed_endpoints(service_id, method, path, handler)   │
│    }                                                                     │
│  → library exports: method="createClient(config:", path="ClientConfig):" │
│  → infra resources: method="k8s:deployment/payment-service", path=null  │
└──────────────────────────────┬───────────────────────────────────────────┘
                               │ SQLite (WAL, per-project DB)
┌──────────────────────────────▼───────────────────────────────────────────┐
│                        Database Layer                                    │
│  exposed_endpoints (id, service_id, method TEXT, path TEXT NOT NULL,     │
│                     handler TEXT)                                        │
│  UNIQUE(service_id, method, path)                                        │
│                                                                          │
│  services (id, repo_id, name, root_path, language, type,                 │
│            scan_version_id)   ← `type` column added in migration 002    │
└──────────────────────────────┬───────────────────────────────────────────┘
                               │ getGraph() → { services, connections,
                               │               repos, mismatches }
                               │ NOTE: exposes NOT included in getGraph() today
┌──────────────────────────────▼───────────────────────────────────────────┐
│                        HTTP API Layer (http.js)                          │
│  GET /graph   → qe.getGraph()      (passes result through unchanged)     │
│  Services array includes `type` field from DB — detail panel uses it    │
└──────────────────────────────┬───────────────────────────────────────────┘
                               │ JSON
┌──────────────────────────────▼───────────────────────────────────────────┐
│                          UI Layer                                        │
│  loadProject() → state.graphData.nodes (each node has id/name/type/      │
│                  language/repo_name — NO exposes field today)            │
│                                                                          │
│  interactions.js click → showDetailPanel(node)                           │
│                                                                          │
│  detail-panel.js:                                                        │
│    getNodeType(node):                                                    │
│      "library"|"sdk" → renderLibraryConnections(outgoing, incoming, ...) │
│      else             → renderServiceConnections(outgoing, incoming, ...) │
│    MISSING: no "infra" branch in getNodeType() or detail-panel routing   │
└──────────────────────────────────────────────────────────────────────────┘
```

---

## Component Responsibilities

| Component | Current Responsibility | v2.3 Change |
|-----------|----------------------|-------------|
| `migrations/007_expose_kind.js` | Does not exist | NEW: add `kind` column to `exposed_endpoints` |
| `persistFindings()` in `query-engine.js` | Stores exposes via "METHOD PATH" split (broken for lib/infra) | MODIFIED: dispatch on `svc.type` to set correct `kind`, store raw string for lib/infra |
| `getGraph()` in `query-engine.js` | Returns services/connections/repos/mismatches — no exposes | MODIFIED: attach `exposes` array per service node |
| `GET /graph` in `http.js` | Passes `qe.getGraph()` through | UNCHANGED: additive response shape change is transparent |
| `loadProject()` in UI JS | Builds `state.graphData.nodes` from API response | UNCHANGED: nodes will now carry `exposes` array automatically |
| `utils.js getNodeType()` | Returns "library", "sdk", "frontend", "service" — no "infra" | MODIFIED: add `if (node.type === 'infra') return 'infra'` guard |
| `state.js NODE_TYPE_COLORS` | Colors for library/sdk/frontend/service | MODIFIED: add `infra` color entry |
| `detail-panel.js showDetailPanel()` | Routes to renderLibraryConnections or renderServiceConnections | MODIFIED: add `infra` branch; pass `node` to library renderer |
| `detail-panel.js renderLibraryConnections()` | Shows "Provides" (outgoing) and "Used by" (incoming) | MODIFIED: add `node` param; render `node.exposes` (kind=export) as "Exports" section |
| `detail-panel.js renderInfraConnections()` | Does not exist | NEW: show `node.exposes` (kind=resource) and outgoing edges labeled deploy/configure |

---

## Key Integration Points

### 1. Migration 007: Add `kind` Column to `exposed_endpoints`

**File:** `worker/db/migrations/007_expose_kind.js`
**Type:** New file

The existing `exposed_endpoints` table was designed for HTTP endpoints only. For v2.3 it becomes a generic "service surface" table by adding a `kind` discriminant:

```sql
ALTER TABLE exposed_endpoints ADD COLUMN kind TEXT NOT NULL DEFAULT 'endpoint';
```

`kind` values:
- `'endpoint'` — HTTP verb + path (service type; existing rows default to this)
- `'export'`   — function signature or exported type name (library/sdk)
- `'resource'` — infrastructure resource reference (infra; k8s/tf/helm/compose prefixed)

The UNIQUE constraint `(service_id, method, path)` continues to work correctly:
- For `endpoint` rows: method = HTTP verb, path = URL path
- For `export` rows: method = NULL, path = full function signature string
- For `resource` rows: method = NULL, path = full resource ref string

No column rename needed. `path` holding non-URL strings for lib/infra is semantically odd but practically fine — it is never parsed by the mismatch detection query, only displayed.

**Why not separate tables:** A single table with `kind` means one query to fetch all surface data for any node, one FTS5 virtual table covers all types in the future, and the `detectMismatches()` query keeps its existing `EXISTS (SELECT 1 FROM exposed_endpoints WHERE service_id = ...)` check — no JOIN across tables.

### 2. `persistFindings()` — Type-Conditional Dispatch

**File:** `worker/db/query-engine.js` — lines 797-815
**Type:** Modify existing

Current code treats every `svc.exposes` item as `"METHOD PATH"`. Replace with dispatch on `svc.type`:

```javascript
// Replace lines 797-815 in persistFindings():
for (const svc of findings.services || []) {
  const svcId = serviceIdMap.get(svc.name);
  if (!svcId || !svc.exposes) continue;

  for (const item of svc.exposes) {
    let method = null;
    let path = item.trim();
    let kind = 'endpoint';

    if (svc.type === 'service') {
      const parts = item.trim().split(/\s+/);
      if (parts.length > 1) { method = parts[0]; path = parts[1]; }
      kind = 'endpoint';
    } else if (svc.type === 'library' || svc.type === 'sdk') {
      kind = 'export';
      // method stays null, path is raw function signature or type name
    } else if (svc.type === 'infra') {
      kind = 'resource';
      // method stays null, path is raw resource ref ("k8s:deployment/name")
    }

    try {
      this._db.prepare(
        'INSERT OR IGNORE INTO exposed_endpoints (service_id, method, path, handler, kind) VALUES (?, ?, ?, ?, ?)'
      ).run(svcId, method, path, svc.boundary_entry || null, kind);
    } catch { /* ignore duplicates */ }
  }
}
```

The `INSERT OR IGNORE` (matching existing code style) relies on the UNIQUE(service_id, method, path) constraint. For library/infra rows, `method` is always NULL so uniqueness is purely by `(service_id, path)`.

### 3. `getGraph()` — Attach exposes to Service Nodes

**File:** `worker/db/query-engine.js` — `getGraph()` method
**Type:** Modify existing

Currently `getGraph()` returns services with no `exposes` field. The detail panel needs exposes to render export/resource sections without an additional API call.

Add after the services query:

```javascript
// After the services.all() call in getGraph():
const allExposes = this._db.prepare(
  'SELECT service_id, method, path, kind FROM exposed_endpoints'
).all();

const exposesByServiceId = {};
for (const row of allExposes) {
  if (!exposesByServiceId[row.service_id]) exposesByServiceId[row.service_id] = [];
  exposesByServiceId[row.service_id].push(row);
}
for (const svc of services) {
  svc.exposes = exposesByServiceId[svc.id] || [];
}
```

The response shape change is additive — callers that ignore `exposes` (e.g. MCP tools, `/impact` route) are unaffected.

### 4. `utils.js` — Add `infra` to `getNodeType()` and Color Map

**File:** `worker/ui/modules/utils.js` and `worker/ui/modules/state.js`
**Type:** Modify existing

Without this fix, `infra` nodes fall through to `getNodeType()` returning `"service"`, and `showDetailPanel()` never reaches the infra renderer branch.

In `utils.js`:
```javascript
export function getNodeType(node) {
  if (node.type === 'infra') return 'infra';           // ADD THIS LINE
  if (node.type === 'library' || node.type === 'sdk') return node.type;
  if (node.name && /sdk|lib|client|shared|common/i.test(node.name)) return 'library';
  if (node.name && /ui|frontend|web|dashboard|app/i.test(node.name)) return 'frontend';
  return 'service';
}
```

In `state.js` `NODE_TYPE_COLORS`:
```javascript
export const NODE_TYPE_COLORS = {
  library:  '#9f7aea',
  sdk:      '#9f7aea',
  infra:    '#68d391',   // green — infrastructure/ops
  frontend: '#f6ad55',
  service:  '#4299e1',
};
```

`getNodeColor()` in `utils.js` also needs the infra guard:
```javascript
export function getNodeColor(node) {
  if (node.type === 'infra') return NODE_TYPE_COLORS.infra;   // ADD
  if (node.type === 'library' || node.type === 'sdk') return NODE_TYPE_COLORS.library;
  ...
}
```

### 5. `detail-panel.js` — Three Render Paths

**File:** `worker/ui/modules/detail-panel.js`
**Type:** Modify existing

**Routing change in `showDetailPanel()`:**
```javascript
// Replace the isLib conditional:
if (nodeType === 'infra') {
  html += renderInfraConnections(node, outgoing, nameById);
} else if (nodeType === 'library' || nodeType === 'sdk') {
  html += renderLibraryConnections(node, outgoing, incoming, nameById);
} else {
  html += renderServiceConnections(outgoing, incoming, nameById);  // unchanged
}
```

**`renderLibraryConnections` signature change** (add `node` as first param):

The function currently renders "Provides" and "Used by" from edge data alone. With `node.exposes` available, it should render an "Exports" section listing the actual function signatures:

```javascript
function renderLibraryConnections(node, outgoing, incoming, nameById) {
  let html = '';

  // Exports section — from exposes data
  const exports = (node.exposes || []).filter(e => e.kind === 'export');
  if (exports.length > 0) {
    html += `<div class="detail-section">
      <div class="detail-label">Exports (${exports.length})</div>`;
    for (const ex of exports) {
      html += `<div class="connection-item">
        <div class="conn-path">${ex.path}</div>
      </div>`;
    }
    html += `</div>`;
  }

  // Used by — from incoming edges (deduplicated by service name)
  if (incoming.length > 0) {
    html += `<div class="detail-section">
      <div class="detail-label">Used by (${incoming.length} services)</div>`;
    const users = new Set();
    for (const e of incoming) {
      const source = nameById[e.source_service_id] || '?';
      if (!users.has(source)) {
        users.add(source);
        html += `<div class="connection-item">
          <div><span class="conn-target">${source}</span></div>
          ${e.source_file ? `<div class="conn-file">${e.source_file}</div>` : ''}
        </div>`;
      }
    }
    html += `</div>`;
  }

  return html;
}
```

**New `renderInfraConnections()` function:**

```javascript
function renderInfraConnections(node, outgoing, nameById) {
  let html = '';

  // Managed resources — from exposes data
  const resources = (node.exposes || []).filter(e => e.kind === 'resource');
  if (resources.length > 0) {
    html += `<div class="detail-section">
      <div class="detail-label">Manages (${resources.length})</div>`;
    for (const r of resources) {
      html += `<div class="connection-item">
        <div class="conn-path">${r.path}</div>
      </div>`;
    }
    html += `</div>`;
  }

  // Configures/Deploys — outgoing connections
  if (outgoing.length > 0) {
    html += `<div class="detail-section">
      <div class="detail-label">Wires (${outgoing.length})</div>`;
    for (const e of outgoing) {
      const target = nameById[e.target_service_id] || '?';
      html += `<div class="connection-item">
        <div><span class="conn-method">${e.method || e.protocol}</span>
             <span class="conn-path">${e.path || ''}</span></div>
        <div class="conn-direction">→ <span class="conn-target">${target}</span></div>
        ${e.source_file ? `<div class="conn-file">${e.source_file}</div>` : ''}
      </div>`;
    }
    html += `</div>`;
  }

  return html;
}
```

---

## What Does NOT Change

| Component | Reason |
|-----------|--------|
| `agent-prompt-service.md` | Service exposes format ("METHOD PATH") is correct as-is |
| `agent-schema.json` | Already documents `exposes` as type-conditional; no structural change |
| `GET /graph` route in `http.js` | Passes `qe.getGraph()` through; additive response shape is transparent |
| `connections` table and all queries | Infra connections already store correctly (protocol=k8s/tf/helm, method=deploy/configure) |
| `detectMismatches()` | Already filters on `protocol NOT IN ('internal','sdk','import')` — infra protocols (k8s/tf/helm) are excluded, so the mismatch query won't fire on infra nodes even after exposes data is stored |
| `renderServiceConnections()` | Service panel is correct; no changes needed |
| Web Worker / force simulation | Pure layout; unaffected |
| MCP server tools | No `exposed_endpoints` queries in MCP tools; unaffected |
| `loadProject()` in UI | Builds nodes from API response; `exposes` will flow through automatically once `getGraph()` returns it |

---

## Data Flow: v2.3 Changes

```
Agent scan → findings.services[i].exposes (type-conditional strings)
    │
    ▼
persistFindings() → dispatch on svc.type:
    service  → kind='endpoint',  method=HTTP verb, path=URL path
    library  → kind='export',    method=null,      path=fn signature / type name
    infra    → kind='resource',  method=null,      path=k8s/tf/helm ref
    │
    ▼
exposed_endpoints rows with kind discriminant
    │
    ▼
getGraph() → attach svc.exposes = [{kind, method, path}, ...] to each service row
    │
    ▼
GET /graph response → services[i].exposes present
    │
    ▼
state.graphData.nodes[i].exposes = [...]  (loadProject() unchanged)
    │
    ▼
showDetailPanel(node) → node.exposes available to all renderers:
    infra   → renderInfraConnections(node, ...)
              → node.exposes.filter(e => e.kind === 'resource')  "Manages" section
              → outgoing edges labeled by method (deploy/configure)  "Wires" section
    library → renderLibraryConnections(node, ...)
              → node.exposes.filter(e => e.kind === 'export')    "Exports" section
              → incoming edges deduplicated by source              "Used by" section
    service → renderServiceConnections(...)  UNCHANGED
```

---

## Recommended Build Order

Dependencies flow strictly bottom-up. Schema changes must land before application code that relies on them.

### Step 1 — Migration 007: Add `kind` column (NEW FILE)

**File:** `worker/db/migrations/007_expose_kind.js`
**What:** `ALTER TABLE exposed_endpoints ADD COLUMN kind TEXT NOT NULL DEFAULT 'endpoint'`
**Why first:** All subsequent steps depend on this column. Adding a column with DEFAULT is instant and non-destructive on existing rows (they get `kind='endpoint'` automatically).
**Risk:** None — pure schema addition, no query changes required.

### Step 2 — Fix `persistFindings()`: Type-Conditional Storage (MODIFY `query-engine.js`)

**What:** Replace "METHOD PATH" string split (lines 797-815) with `svc.type` dispatch that sets `kind` correctly for library and infra exposes.
**Why second:** Depends on Step 1 (kind column must exist in INSERT). This is the core correctness fix.
**Risk:** Low — only the INSERT path changes; all existing read queries are unaffected. Service exposes behavior unchanged.

### Step 3 — Update `getGraph()`: Attach Exposes to Service Nodes (MODIFY `query-engine.js`)

**What:** Query all `exposed_endpoints` rows after loading services; group by `service_id`; attach as `svc.exposes` array in the response.
**Why third:** Depends on Step 2 producing correct `kind` values. Must precede UI changes so nodes carry exposes data.
**Risk:** Low — additive change to response shape; no existing consumer breaks.

### Step 4 — Fix `utils.js`: Add `infra` to Type Detection (MODIFY `utils.js` + `state.js`)

**What:** Add `if (node.type === 'infra') return 'infra'` guard in `getNodeType()`; add infra guard in `getNodeColor()`; add `infra` color to `NODE_TYPE_COLORS` in `state.js`.
**Why fourth:** Without this, the routing in Step 5 never reaches the infra branch. Must precede panel changes.
**Risk:** None — purely additive guards; does not change behavior for service/library/sdk/frontend nodes.

### Step 5 — Expand `detail-panel.js`: Three Render Paths (MODIFY `detail-panel.js`)

**What:**
- Update routing in `showDetailPanel()` to detect `nodeType === 'infra'`
- Add `node` as first param to `renderLibraryConnections()`; add "Exports" section from `node.exposes`
- Add new `renderInfraConnections(node, outgoing, nameById)` function; render "Manages" + "Wires" sections
**Why last:** Depends on all prior steps — needs `node.type === 'infra'` routed correctly (Step 4), `node.exposes` present (Step 3), and correct `kind` values (Step 2).
**Risk:** Moderate — `renderLibraryConnections` signature changes (old 3-arg → new 4-arg with `node` as first). Confirm no other callers exist (currently only called from `showDetailPanel()` in the same file — confirmed safe).

---

## Integration Boundaries

| Boundary | Communication | Notes |
|----------|---------------|-------|
| Migration 007 ↔ `persistFindings()` | Direct SQLite schema | Migration must run before any INSERT with `kind` column |
| `getGraph()` ↔ `loadProject()` in UI | HTTP JSON | `exposes` is additive; old UI ignores unknown fields gracefully |
| `detail-panel.js` ↔ `utils.js` | ES module import | `getNodeType()` must return `'infra'` before panel routing works |
| `renderLibraryConnections()` ↔ callers | Module-internal function | Only called once from `showDetailPanel()` — safe to change signature |
| `detectMismatches()` ↔ `exposed_endpoints` | Direct SQL query | Mismatch query filters by `protocol NOT IN ('internal','sdk','import')` — infra protocols (k8s, tf, helm) are already excluded; adding `kind` column does not affect this query |

---

## Anti-Patterns

### Anti-Pattern 1: Fetch Exposes on Panel Click

**What people do:** Add `GET /node-detail/:id` that returns exposes for a single node when the panel opens.
**Why wrong:** Adds a round-trip latency on every click. The `/graph` response already loads all node data at project switch time. A per-click request adds 20-200ms and requires error handling for the loading state.
**Do this instead:** Attach `exposes` to service rows in `getGraph()`. One network call at project load covers all panel data needs.

### Anti-Pattern 2: Parse exposes Format at Render Time

**What people do:** Store the raw agent string and split "METHOD PATH" in the UI renderer, with special cases per node type.
**Why wrong:** The parser belongs at storage time where `svc.type` is known. Parsing in the UI duplicates the same broken "METHOD PATH" logic and requires the renderer to know about three different string formats.
**Do this instead:** Parse and tag with `kind` at `persistFindings()` time. UI receives pre-classified rows with explicit `kind`, `method`, and `path` fields.

### Anti-Pattern 3: Separate Tables per Type

**What people do:** Create `library_exports (service_id, signature, file)` and `infra_resources (service_id, resource_ref, file)` tables, keeping `exposed_endpoints` HTTP-only.
**Why wrong:** Any cross-type "what does this node expose?" query requires a three-way UNION. FTS5 indexing would need separate virtual tables per type. The mismatch detection query cannot reference a single table. Every future cross-cutting feature (search, export reports) must be updated for each table.
**Do this instead:** Single `exposed_endpoints` table with `kind` discriminant. One query, one index, one table.

### Anti-Pattern 4: Skipping the `infra` Guard in `getNodeType()`

**What people do:** Add infra rendering to `detail-panel.js` without first fixing `getNodeType()` in `utils.js`.
**Why wrong:** `showDetailPanel()` calls `getNodeType(node)` to determine which renderer to use. Without the `infra` guard, infra nodes return `"service"` from `getNodeType()` and route to `renderServiceConnections()` — the infra renderer is never reached.
**Do this instead:** Fix `utils.js` (Step 4) before modifying `detail-panel.js` (Step 5).

---

## Recommended Project Structure Changes

```
worker/
├── db/
│   ├── migrations/
│   │   ├── 001_initial_schema.js       # unchanged
│   │   ├── 002_service_type.js         # unchanged
│   │   ├── 003_exposed_endpoints.js    # unchanged
│   │   ├── 004_dedup_constraints.js    # unchanged (from v2.2)
│   │   ├── 005_scan_versions.js        # unchanged (from v2.2)
│   │   ├── 006_dedup_repos.js          # unchanged (from v2.2)
│   │   └── 007_expose_kind.js          # NEW: kind column on exposed_endpoints
│   └── query-engine.js                 # MODIFIED: persistFindings dispatch + getGraph exposes
└── ui/
    └── modules/
        ├── state.js                    # MODIFIED: add infra to NODE_TYPE_COLORS
        ├── utils.js                    # MODIFIED: getNodeType + getNodeColor infra guard
        └── detail-panel.js             # MODIFIED: 3-way routing + new renderInfraConnections
```

---

## Confidence Assessment

| Area | Confidence | Source |
|------|------------|--------|
| Broken parser location | HIGH | Direct read of query-engine.js lines 797-815 |
| exposed_endpoints schema | HIGH | Migration 003 read directly |
| getGraph() response shape | HIGH | query-engine.js getGraph() read directly |
| detail-panel routing | HIGH | detail-panel.js and interactions.js read directly |
| utils.js type detection gap | HIGH | utils.js getNodeType() confirmed — no infra guard exists |
| Migration numbering (007) | HIGH | Migrations 004-006 confirmed in directory listing |
| renderLibraryConnections caller count | HIGH | Only called from showDetailPanel() in same file — confirmed |
| detectMismatches() compatibility | HIGH | Query filter confirmed: `protocol NOT IN ('internal','sdk','import')` excludes infra |

---

## Sources

- `worker/db/query-engine.js` — persistFindings() broken parser (lines 797-815), getGraph() shape, detectMismatches() filter (source code, HIGH)
- `worker/db/migrations/003_exposed_endpoints.js` — current exposed_endpoints schema (source code, HIGH)
- `worker/db/migrations/` directory — confirmed 001-006 exist; next migration is 007 (source code, HIGH)
- `worker/server/http.js` — GET /graph passthrough, no exposes in response (source code, HIGH)
- `worker/ui/modules/detail-panel.js` — routing logic, renderLibraryConnections/renderServiceConnections (source code, HIGH)
- `worker/ui/modules/utils.js` — getNodeType() confirmed missing infra guard (source code, HIGH)
- `worker/ui/modules/state.js` — NODE_TYPE_COLORS missing infra entry (source code, HIGH)
- `worker/scan/agent-prompt-library.md` — library exposes format: function signatures (source code, HIGH)
- `worker/scan/agent-prompt-infra.md` — infra exposes format: k8s:/tf:/helm: prefixed refs (source code, HIGH)
- `worker/scan/agent-schema.json` — exposes as string array, format type-conditional (source code, HIGH)
- `.planning/PROJECT.md` — v2.3 milestone goals and out-of-scope constraints (source code, HIGH)

---

*Architecture research for: AllClear v2.3 Type-Specific Detail Panels*
*Researched: 2026-03-17*
