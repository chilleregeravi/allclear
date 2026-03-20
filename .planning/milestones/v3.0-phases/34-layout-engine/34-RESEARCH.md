# Phase 34: Layout Engine & Node Rendering — Research

**Researched:** 2026-03-18
**Domain:** Canvas 2D layout algorithms, node shape rendering, boundary box rendering
**Confidence:** HIGH — all findings drawn from direct codebase inspection

---

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|-----------------|
| LAYOUT-01 | Deterministic layered layout: services top, libraries middle, infra bottom | Grid-based position calculator replaces random init + force worker |
| LAYOUT-02 | Stable positions across page reloads (no force randomness) | Computed deterministically from node type + sort order; no Worker involved |
| LAYOUT-03 | Grid-based algorithmic spacing within each layer | Row layout math: colW = canvasW / colCount, rowH = layerHeight / rowCount |
| LAYOUT-04 | Services visually grouped into boundary boxes (from allclear.config.json) | Config already parsed in discovery.js; add `boundaries` key; pass via /graph |
| LAYOUT-05 | Boundary boxes as dashed rounded rectangles with semi-transparent fill + label | Canvas API: ctx.setLineDash, ctx.roundRect, ctx.fillStyle with alpha, ctx.fillText |
| NODE-01 | Services render as filled circles | Already implemented — `ctx.arc`; no shape change needed |
| NODE-02 | Libraries/SDKs render as outline diamonds | Currently: hexagon shape. Must change to diamond outline (stroke only, no fill) |
| NODE-03 | Infrastructure nodes render as filled diamonds | Currently: filled diamond but same diamond code as above; keep fill, add distinct size |
| NODE-05 | Hovering a node shows tooltip with type and connection count | Tooltip exists; upgrade `textContent` to include connection count |

</phase_requirements>

---

## Summary

Phase 34 replaces the D3 force simulation with a deterministic custom grid layout, changes node shapes to match the design spec, adds boundary box rendering, and upgrades the hover tooltip. No new dependencies are required — everything uses the existing Canvas 2D API and vanilla JS already in the codebase.

The force simulation lives entirely in `force-worker.js` (a Web Worker), loaded from `graph.js` via `new Worker('./force-worker.js', { type: 'module' })`. Removing it requires (a) deleting the Worker instantiation from `graph.js`, (b) replacing the random position init with a deterministic layout function, and (c) removing the `state.forceWorker` field and all `.postMessage` calls. The `onMouseMove` drag path in `interactions.js` also sends drag messages to the Worker and must be cleaned up.

Boundary box data does not yet exist in the system — it must be added to `allclear.config.json` under a new `boundaries` key and surfaced through the `/graph` API so the UI renderer can draw boundary boxes around the correct service nodes. The layout engine must respect boundaries when placing service nodes: services in the same boundary should be placed in adjacent columns.

**Primary recommendation:** Implement layout as a pure `computeLayout(nodes, boundaries, canvasW, canvasH)` function that returns a `positions` map; inject it at the exact point where `state.positions` was previously populated by random init.

---

## Standard Stack

### Core
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| Canvas 2D API | Browser built-in | All drawing — shapes, paths, transforms | Already used throughout renderer.js |
| Vanilla ES modules | Project standard | Module structure | Project uses ESM throughout; no bundler |
| Node.js built-ins (fs, path) | >=20 | Config file reading | Already used in discovery.js |

### No New Dependencies
The decision from the discussion phase (see User Constraints) explicitly excludes Dagre and ELK. No npm packages are needed for this phase. The layout algorithm is pure arithmetic.

---

## Architecture Patterns

### Current Data Flow (to be preserved)

```
fetch /graph  →  state.graphData.nodes/edges  →  positions map  →  render()
                                                      ^
                                               [REPLACE THIS]
                                    (was: random init + forceWorker ticks)
                                    (new: computeLayout() — synchronous)
```

### Recommended Module Structure

```
worker/ui/
├── graph.js                  # Entry: remove Worker, call computeLayout()
├── force-worker.js           # DELETE after phase
└── modules/
    ├── layout.js             # NEW: computeLayout() pure function
    ├── renderer.js           # UPDATE: boundary boxes, node shapes
    ├── state.js              # UPDATE: remove forceWorker field; add boundaries
    ├── interactions.js       # UPDATE: remove forceWorker.postMessage in drag path
    └── utils.js              # UPDATE: connection count helper for tooltip
```

### Pattern 1: Deterministic Grid Layout Algorithm

**What:** Pure function that partitions nodes by type layer, then positions them left-to-right in rows with even spacing. Returns a flat `{ [nodeId]: { x, y } }` map identical in shape to `state.positions`.

**When to use:** Called once in `graph.js` after fetching `/graph`, replacing both the random position init and the Worker startup.

```javascript
// worker/ui/modules/layout.js
// (Source: custom — no external library)

const LAYER_ORDER = ['service', 'frontend', 'library', 'sdk', 'infra'];

/**
 * Compute deterministic grid positions for all nodes.
 *
 * @param {Array} nodes       - graph nodes with .id and .type
 * @param {Array} boundaries  - [{name, label, services:[...names]}] from config
 * @param {number} canvasW    - CSS pixel width
 * @param {number} canvasH    - CSS pixel height
 * @returns {{ positions: Object, boundaryBoxes: Array }}
 */
export function computeLayout(nodes, boundaries, canvasW, canvasH) {
  // 1. Partition nodes into layers
  const layers = {
    service: [],
    library: [],  // includes sdk
    infra: [],
  };
  for (const node of nodes) {
    if (node.type === 'infra') layers.infra.push(node);
    else if (node.type === 'library' || node.type === 'sdk') layers.library.push(node);
    else layers.service.push(node);  // service, frontend default to service layer
  }

  // 2. Assign vertical bands — services get 50%, libraries 25%, infra 25%
  const PADDING = 40;
  const usableH = canvasH - PADDING * 2;
  const bands = {
    service: { y: PADDING, h: usableH * 0.50 },
    library: { y: PADDING + usableH * 0.50, h: usableH * 0.25 },
    infra:   { y: PADDING + usableH * 0.75, h: usableH * 0.25 },
  };

  const positions = {};

  // 3. Position each layer: spread nodes evenly across width
  for (const [layerName, nodesInLayer] of Object.entries(layers)) {
    const { y: bandY, h: bandH } = bands[layerName];
    const n = nodesInLayer.length;
    if (n === 0) continue;
    const cellW = (canvasW - PADDING * 2) / n;
    nodesInLayer.forEach((node, i) => {
      positions[node.id] = {
        x: PADDING + cellW * i + cellW / 2,
        y: bandY + bandH / 2,
      };
    });
  }

  // 4. Compute boundary boxes from service positions
  const boundaryBoxes = [];
  for (const boundary of (boundaries || [])) {
    const memberIds = nodes
      .filter(n => boundary.services.includes(n.name))
      .map(n => n.id);
    if (memberIds.length === 0) continue;
    const xs = memberIds.map(id => positions[id]?.x).filter(Boolean);
    const ys = memberIds.map(id => positions[id]?.y).filter(Boolean);
    const BOX_PAD = 28;
    boundaryBoxes.push({
      label: boundary.label || boundary.name,
      x: Math.min(...xs) - BOX_PAD,
      y: Math.min(...ys) - BOX_PAD,
      w: Math.max(...xs) - Math.min(...xs) + BOX_PAD * 2,
      h: Math.max(...ys) - Math.min(...ys) + BOX_PAD * 2,
    });
  }

  return { positions, boundaryBoxes };
}
```

**Key insight:** Services in the same boundary will naturally cluster because boundary-grouped nodes should be sorted together before the grid assignment. Sort `layers.service` so boundary members appear contiguously before computing x positions.

### Pattern 2: Boundary Box Rendering (Canvas 2D)

**What:** Draw dashed rounded rectangle with semi-transparent fill before drawing any nodes (so nodes appear on top).

```javascript
// Inside render(), before drawing edges — Source: Canvas 2D API (MDN)
for (const box of state.boundaryBoxes) {
  ctx.save();
  ctx.globalAlpha = 0.08;
  ctx.fillStyle = '#63b3ed';
  ctx.beginPath();
  ctx.roundRect(box.x, box.y, box.w, box.h, 8);
  ctx.fill();

  ctx.globalAlpha = 0.6;
  ctx.strokeStyle = '#63b3ed';
  ctx.lineWidth = 1 / state.transform.scale;
  ctx.setLineDash([6 / state.transform.scale, 4 / state.transform.scale]);
  ctx.stroke();
  ctx.setLineDash([]);

  // Label at top-left
  ctx.globalAlpha = 0.8;
  ctx.fillStyle = '#63b3ed';
  ctx.font = `${Math.round(11 / state.transform.scale)}px system-ui, sans-serif`;
  ctx.textAlign = 'left';
  ctx.textBaseline = 'top';
  ctx.fillText(box.label, box.x + 6, box.y + 4);
  ctx.restore();
}
```

**Caveat:** `ctx.roundRect` was added in Chrome 99 / Firefox 112 / Safari 15.4. This is a Claude Code plugin — users are on modern browsers. Confidence HIGH that it is available.

### Pattern 3: Node Shape Rendering (Updated Spec)

Current code already has shape dispatch by `getNodeType()`. The shapes must change:

| Node Type | Current Shape | Required Shape | Change |
|-----------|--------------|----------------|--------|
| service / frontend | filled circle (`ctx.arc`) | filled circle | No change |
| library / sdk | hexagon (6-sided polygon) | outline diamond (stroke only) | Replace hex with diamond, stroke not fill |
| infra | filled diamond | filled diamond | Keep; ensure distinct from library |

```javascript
// Library/SDK — outline diamond (stroke, no fill):
const r = NODE_RADIUS * 1.2;
ctx.moveTo(pos.x, pos.y - r);
ctx.lineTo(pos.x + r, pos.y);
ctx.lineTo(pos.x, pos.y + r);
ctx.lineTo(pos.x - r, pos.y);
ctx.closePath();
// Do NOT call ctx.fill() — call ctx.stroke() with library color

// Infra — filled diamond (existing code, keep as-is):
const r = NODE_RADIUS * 1.1;
ctx.moveTo(pos.x, pos.y - r);
// ... existing diamond path
ctx.fill();  // solid fill
```

The distinction between outline diamond (library) and filled diamond (infra) is purely whether `ctx.fill()` or `ctx.stroke()` is called after the same diamond path.

### Pattern 4: Tooltip with Connection Count

Tooltip currently shows: `node.name [type] (language)`. Upgrade to include connection count.

```javascript
// In onMouseMove, after hitTest succeeds — utils.js getConnectionCount
export function getConnectionCount(nodeId) {
  let count = 0;
  for (const e of state.graphData.edges) {
    if (e.source_service_id === nodeId || e.target_service_id === nodeId) count++;
  }
  return count;
}

// In interactions.js tooltip line:
const count = getConnectionCount(node.id);
_tooltip.textContent = `${node.name} [${tt}] • ${count} connection${count !== 1 ? 's' : ''}`;
```

### Pattern 5: Removing the Force Worker

Three touch points in the codebase:

1. **`graph.js`** — Remove `state.forceWorker = new Worker(...)`, the `onmessage` callback, the `postMessage({type:'init'})` call. Replace random position init + Worker startup with `const { positions, boundaryBoxes } = computeLayout(...)`.

2. **`interactions.js` `onMouseMove`** — The drag path calls `state.forceWorker.postMessage({type:'drag',...})`. Since drag is optional (from the design discussion), the simplest safe path is to remove the Worker postMessage and instead directly update `state.positions[state.dragNodeId]` on mousemove. Alternatively, disable node drag entirely.

3. **`state.js`** — Remove `forceWorker: null` field; add `boundaryBoxes: []` field.

### Pattern 6: Config Schema for Boundaries

The `allclear.config.json` currently only has `linked-repos`. Add a `boundaries` key:

```json
{
  "linked-repos": ["../api", "../ui"],
  "boundaries": [
    { "name": "platform", "label": "Platform", "services": ["api-gateway", "auth-svc"] },
    { "name": "payments", "label": "Payments", "services": ["payments-api", "billing"] }
  ]
}
```

**Server side:** The `/graph` API must read and forward `boundaries` from config. The `getGraph()` method in `query-engine.js` returns `{ services, connections, repos, mismatches }` — add `boundaries` to this response. The HTTP handler in `http.js` passes through `qe.getGraph()` unchanged, so this is a one-file change in `query-engine.js`.

**Config reading:** `query-engine.js` needs access to `projectRoot` to read `allclear.config.json`. It already receives this implicitly (the `QueryEngine` is constructed with a DB path that includes the project path). The cleanest approach is to pass `projectRoot` to the QueryEngine constructor and read boundaries in `getGraph()` using the same `loadFromConfig` pattern from `discovery.js`.

Alternatively: `http.js` reads the config itself and injects `boundaries` into the `/graph` response. This is simpler since `http.js` already knows `projectRoot` from `request.query.project`.

**Recommended:** HTTP handler reads boundaries and merges into `getGraph()` response — avoids touching QueryEngine.

### Anti-Patterns to Avoid

- **Calling `render()` in a loop from the layout engine** — layout is a one-shot synchronous computation; call `render()` once after positions are set.
- **Placing boundaries in `state.graphData`** — put `state.boundaryBoxes` at the top level of `state`, separate from graph data that comes from the server. `state.boundaryBoxes` is derived from the layout computation.
- **Drawing boundary boxes inside the node loop** — boundary boxes must be drawn BEFORE edges and nodes so they appear behind everything.
- **Using `ctx.roundRect` as a path continuation** — it always starts a new path; call `ctx.beginPath()` before each `roundRect` call.
- **Forgetting to reset `ctx.setLineDash([])` after dashed rect** — failure to reset causes subsequent solid lines (edges, node outlines) to inherit the dash pattern.

---

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Node-to-node overlap detection | Custom BVH / collision grid | Increase `PADDING` and use wider column widths | Grid layout inherently prevents overlap when columns >= node count |
| Bezier edge routing | Custom curve math | Straight lines (existing) — edge routing is Phase 36 | Premature; not in scope |
| Animation between old and new positions | Custom interpolation | Remove animation — positions are stable on load | No tween needed; positions are deterministic |
| Boundary color palette | Custom palette algorithm | Use single accent color (#63b3ed) with different opacity per boundary index | Simple index-mod is sufficient for v3.0 |

---

## Common Pitfalls

### Pitfall 1: Force Worker drag path left in interactions.js

**What goes wrong:** After removing `state.forceWorker`, the `onMouseMove` handler still calls `state.forceWorker.postMessage(...)` — throws `TypeError: Cannot read properties of null`.

**Why it happens:** The drag path in `onMouseMove` and `onMouseUp` both reference `state.forceWorker` without null-checking.

**How to avoid:** In the same task that removes the Worker from `graph.js`, also update both `onMouseMove` and `onMouseUp` in `interactions.js`. Use `state.positions[state.dragNodeId] = { x: wx, y: wy }` for direct drag, or remove drag entirely for simplicity.

**Warning signs:** Runtime `TypeError` on mousedown over a node.

### Pitfall 2: ctx.roundRect not available in older browsers

**What goes wrong:** `ctx.roundRect` throws `TypeError` in Firefox < 112 or Safari < 15.4.

**Why it happens:** `roundRect` is relatively new in the Canvas 2D spec.

**How to avoid:** Add a polyfill fallback:
```javascript
if (!CanvasRenderingContext2D.prototype.roundRect) {
  // Fallback: draw plain rect with manual arc corners
}
```
**Or** draw boundary boxes with manual arc corners from the start (4 arc calls at corners). Since the plugin targets Claude Code users (modern browsers), this is LOW priority.

### Pitfall 3: Boundary boxes drawn in transform-scaled space vs unscaled

**What goes wrong:** Boundary box positions are computed in CSS pixel space (world space), but the canvas transform (`ctx.translate` + `ctx.scale`) is already applied when rendering nodes. If boundary boxes are drawn outside the `ctx.save/translate/scale` block, they appear fixed on screen instead of panning/zooming with the graph.

**How to avoid:** Draw boundary boxes INSIDE the `ctx.save() ... ctx.restore()` block in `renderer.js`, after `ctx.translate(state.transform.x, state.transform.y)` and `ctx.scale(state.transform.scale, state.transform.scale)`.

**Warning signs:** Boundary boxes don't move when user pans the graph.

### Pitfall 4: Boundary box size wrong when nodes on same row

**What goes wrong:** When multiple services in a boundary sit at the same Y coordinate (same row), `maxY - minY = 0`, so the box height collapses to `2 * BOX_PAD`.

**Why it happens:** Grid layout puts all nodes of a layer at the same Y.

**How to avoid:** This is expected and fine for single-row layers. The minimum box height should be `NODE_RADIUS * 2 + BOX_PAD * 2` (enough to contain the node). Enforce a minimum:
```javascript
h: Math.max(NODE_RADIUS * 2 + BOX_PAD * 2, maxY - minY + BOX_PAD * 2)
```

### Pitfall 5: Phase 35 actor column space not reserved

**What goes wrong:** Layout fills the full canvas width with service/library/infra nodes. Phase 35 must add an external actors column on the right, but there is no space.

**Why it happens:** Phase 34 doesn't know about actors yet, but the design calls for right-side actors.

**How to avoid:** Reserve the right ~15-20% of canvas width for the future actors column. Use `const ACTOR_COLUMN_RESERVE = Math.round(canvasW * 0.18)` and constrain `usableW = canvasW - PADDING * 2 - ACTOR_COLUMN_RESERVE`. Export `ACTOR_COLUMN_RESERVE` constant so Phase 35 can place actors in the exact reserved region.

### Pitfall 6: getGraph() returns no boundaries when config has none

**What goes wrong:** Client-side code does `for (const boundary of data.boundaries)` — throws if `boundaries` is undefined.

**How to avoid:** Server always returns `boundaries: []` (empty array) when config has no boundaries key. Client guards: `for (const boundary of (data.boundaries || []))`.

---

## Code Examples

### Layout entry in graph.js (replacing force worker block)

```javascript
// Source: custom layout module
import { computeLayout } from "./modules/layout.js";

// In loadProject(), after state.graphData.nodes/edges are set:
const cssBoundsW = Math.round(canvas.width / (window.devicePixelRatio || 1));
const cssBoundsH = Math.round(canvas.height / (window.devicePixelRatio || 1));
const { positions, boundaryBoxes } = computeLayout(
  state.graphData.nodes,
  raw.boundaries || [],
  cssBoundsW,
  cssBoundsH
);
Object.assign(state.positions, positions);
state.boundaryBoxes = boundaryBoxes;
// No Worker. Call render() directly.
render();
```

### Boundary data in HTTP handler

```javascript
// Source: http.js /graph route — merge config boundaries into response
import { loadFromConfig } from "../scan/discovery.js";

fastify.get("/graph", async (request, reply) => {
  const qe = getQE(request);
  if (!qe) return reply.code(503).send({ error: "No map data yet." });
  try {
    const graph = qe.getGraph();
    // Read boundaries from project config
    const projectRoot = request.query?.project || process.cwd();
    let boundaries = [];
    try {
      const cfgPath = path.join(projectRoot, "allclear.config.json");
      const cfg = JSON.parse(fs.readFileSync(cfgPath, "utf8"));
      boundaries = cfg.boundaries || [];
    } catch { /* no config or no boundaries key */ }
    return reply.send({ ...graph, boundaries });
  } catch (err) {
    return reply.code(500).send({ error: err.message });
  }
});
```

### Outline diamond (library shape)

```javascript
// Source: Canvas 2D API — renderer.js node draw loop
if (nodeType === 'library' || nodeType === 'sdk') {
  const r = NODE_RADIUS * 1.2;
  ctx.beginPath();
  ctx.moveTo(pos.x, pos.y - r);
  ctx.lineTo(pos.x + r, pos.y);
  ctx.lineTo(pos.x, pos.y + r);
  ctx.lineTo(pos.x - r, pos.y);
  ctx.closePath();
  // Background fill (dark) to not bleed edges through
  ctx.fillStyle = '#0f1117';
  ctx.fill();
  // Outline only
  ctx.strokeStyle = nodeColor;
  ctx.lineWidth = 1.5 / state.transform.scale;
  ctx.stroke();
} else if (nodeType === 'infra') {
  // ... filled diamond — existing code unchanged
}
```

---

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Force simulation (D3) | Deterministic grid layout | Phase 34 | Stable positions, no Worker thread, instant layout |
| Random initial positions | Computed positions from type+sort | Phase 34 | Page reload shows identical layout |
| Hexagon for libraries | Outline diamond for libraries | Phase 34 | Matches agreed design spec |
| No boundary boxes | Dashed rounded rect groups | Phase 34 | User-defined service groups visible |
| Simple name tooltip | Name + type + connection count | Phase 34 | More informative on hover |

**Deprecated:**
- `force-worker.js`: Entire file removed. D3 force simulation is no longer used.
- `state.forceWorker`: Field removed from `state.js`.
- `state.graphData` storing library-specific geometry: layout moves to `state.positions` + `state.boundaryBoxes`.

---

## Open Questions

1. **Boundary-aware node sort order**
   - What we know: Services in the same boundary should be placed contiguously in the service row to make the boundary box compact.
   - What's unclear: Should un-boundaried services be grouped together (at end), or interleaved? No spec on this.
   - Recommendation: Sort service nodes: first alphabetically within each boundary (in boundary declaration order), then un-boundaried services alphabetically. This is deterministic and produces tight boxes.

2. **Actor column reserve amount**
   - What we know: Phase 35 adds an external actor column on the right.
   - What's unclear: How many actors are typical? Column width needed?
   - Recommendation: Reserve 18% (`Math.round(canvasW * 0.18)`) and export a constant `ACTOR_COLUMN_WIDTH` so Phase 35 can override if needed.

3. **Drag behavior after Worker removal**
   - What we know: Force Worker drag messages `{type: 'drag', nodeId, x, y}` must be replaced.
   - What's unclear: The design discussion said drag is "optional" — implement or remove?
   - Recommendation: Implement direct drag (update `state.positions[nodeId]` on mousemove, skip `forceWorker.postMessage`). It's 2 lines and preserves UX. Drag positions are non-persistent (reset on reload), which is acceptable.

4. **Fit-to-screen button after layout change**
   - What we know: `fitBtn` in `graph.js` calculates minX/maxX/minY/maxY from `state.positions`. This logic is unchanged.
   - What's unclear: Nothing — fit still works because positions are still in `state.positions`.
   - Recommendation: No change to fit-btn code.

---

## Validation Architecture

### Test Framework
| Property | Value |
|----------|-------|
| Framework | Node.js built-in test runner (`node --test`) |
| Config file | None — scripts specified in `package.json` as `node --test <file>` |
| Quick run command | `node --test worker/ui/modules/layout.test.js` |
| Full suite command | `node --test worker/ui/modules/layout.test.js worker/ui/modules/renderer.test.js worker/ui/modules/utils.test.js worker/ui/modules/interactions.test.js` |

### Phase Requirements to Test Map

| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| LAYOUT-01 | Services at top, libraries middle, infra bottom | unit | `node --test worker/ui/modules/layout.test.js` | ❌ Wave 0 |
| LAYOUT-02 | Same nodes → same positions on repeated call | unit | `node --test worker/ui/modules/layout.test.js` | ❌ Wave 0 |
| LAYOUT-03 | N nodes → evenly spaced X positions in row | unit | `node --test worker/ui/modules/layout.test.js` | ❌ Wave 0 |
| LAYOUT-04 | Nodes named in boundary appear in box coords | unit | `node --test worker/ui/modules/layout.test.js` | ❌ Wave 0 |
| LAYOUT-05 | renderer.js calls setLineDash + roundRect for boxes | source inspection | `node --test worker/ui/modules/renderer.test.js` | ❌ Wave 0 |
| NODE-01 | Services use ctx.arc | source inspection | `node --test worker/ui/modules/renderer.test.js` | ❌ Wave 0 |
| NODE-02 | Libraries use diamond + stroke (not fill) | source inspection | `node --test worker/ui/modules/renderer.test.js` | ❌ Wave 0 |
| NODE-03 | Infra uses diamond + fill | source inspection | `node --test worker/ui/modules/renderer.test.js` | ❌ Wave 0 |
| NODE-05 | Tooltip textContent includes connection count | source inspection | `node --test worker/ui/modules/interactions.test.js` | ❌ needs update |

The project's test pattern is **source inspection** (static analysis via `readFileSync` + string checks) plus lightweight behavioral tests using EventTarget mocks. This approach works without a DOM/browser environment and runs in `< 1 second`.

### Sampling Rate

- **Per task commit:** `node --test worker/ui/modules/layout.test.js`
- **Per wave merge:** Full suite above (all 4 test files)
- **Phase gate:** Full suite green before `/gsd:verify-work`

### Wave 0 Gaps

- [ ] `worker/ui/modules/layout.test.js` — covers LAYOUT-01, LAYOUT-02, LAYOUT-03, LAYOUT-04
- [ ] `worker/ui/modules/renderer.test.js` — covers LAYOUT-05, NODE-01, NODE-02, NODE-03
- [ ] Update `worker/ui/modules/interactions.test.js` — add NODE-05 tooltip count check (file exists, needs new check block)

---

## Sources

### Primary (HIGH confidence)

- Direct codebase inspection — all findings verified against source files in `/Users/ravichillerega/sources/allclear/worker/ui/`
- Canvas 2D API — `ctx.roundRect`, `ctx.setLineDash`, `ctx.arc` — standard browser API, confirmed present in codebase usage
- `worker/ui/modules/state.js` — complete state shape documented
- `worker/ui/modules/renderer.js` — current shape dispatch logic documented
- `worker/ui/modules/interactions.js` — Worker drag path identified
- `worker/ui/force-worker.js` — complete Worker internals reviewed
- `worker/ui/graph.js` — Worker lifecycle (init, postMessage, onmessage) reviewed
- `worker/server/http.js` — `/graph` route handler confirmed; config read pattern available
- `worker/scan/discovery.js` — `loadFromConfig` pattern for allclear.config.json

### Secondary (MEDIUM confidence)

- `ctx.roundRect` browser support: Chrome 99+, Firefox 112+, Safari 15.4+ — standard Canvas API; plugin targets Claude Code (Chromium-based) so HIGH in practice

---

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — entire phase uses existing browser APIs and vanilla JS
- Architecture: HIGH — all touch points identified from direct code inspection
- Pitfalls: HIGH — identified from actual code paths in `interactions.js` and `renderer.js`
- Boundary config shape: MEDIUM — proposed schema is new; no prior implementation to verify against

**Research date:** 2026-03-18
**Valid until:** 2026-05-01 (stable domain — Canvas 2D API, vanilla JS)
