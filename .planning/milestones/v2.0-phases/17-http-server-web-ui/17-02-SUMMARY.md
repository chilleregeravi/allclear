---
phase: 17-http-server-web-ui
plan: "02"
subsystem: ui
tags: [d3, canvas, web-worker, force-directed, esm, no-build]

# Dependency graph
requires:
  - phase: 17-http-server-web-ui
    plan: "01"
    provides: "Fastify HTTP server with /graph, /impact routes, static file serving from worker/ui/"
provides:
  - "worker/ui/index.html — single-file web UI shell, no build step, ESM module script"
  - "worker/ui/graph.js — Canvas 2D force-directed graph renderer with all interactions"
  - "worker/ui/force-worker.js — Web Worker running D3 force simulation off main thread"
affects: [18-agent-scanning, 20-command-layer]

# Tech tracking
tech-stack:
  added: [d3-force@3 via CDN ESM]
  patterns:
    - "Canvas 2D context for all rendering — no SVG elements"
    - "Web Worker offloads D3 force simulation to avoid main thread blocking"
    - "Math.hypot point-in-circle hit detection for Canvas node interaction"
    - "Transform state {x, y, scale} for pan/zoom applied via ctx.translate+ctx.scale"
    - "Impact cache (blastCache) prevents redundant /impact fetches per session"

key-files:
  created:
    - worker/ui/index.html
    - worker/ui/graph.js
    - worker/ui/force-worker.js
  modified: []

key-decisions:
  - "Canvas not SVG — SVG DOM elements degrade at 30+ nodes, Canvas scales to 100+ nodes"
  - "Web Worker for D3 force simulation — keeps main thread free for smooth interaction"
  - "D3 CDN ESM import in force-worker.js only — graph.js uses no external libraries"
  - "alphaDecay tuned for 300-tick convergence then simulation stops automatically"
  - "blastCache per session — avoids repeated /impact fetches for same node"

patterns-established:
  - "Canvas hit detection: iterate nodes, Math.hypot(offsetX - pos.x, offsetY - pos.y) < NODE_RADIUS"
  - "Worker protocol: {type: init/reheat/stop/drag} in, {type: tick/end} out"
  - "Transform-aware hit test: toWorld(px, py) converts canvas pixels to world coordinates before hit test"

requirements-completed: [WEBUI-01, WEBUI-02, WEBUI-03, WEBUI-04, WEBUI-05, WEBUI-06]

# Metrics
duration: 3min
completed: 2026-03-15
---

# Phase 17 Plan 02: Web UI Summary

**Single-file D3 Canvas force-directed graph UI with node click, shift-click blast radius, protocol filters, search, and pan/zoom — Web Worker runs simulation off main thread, no build step**

## Performance

- **Duration:** ~3 min
- **Started:** 2026-03-15T17:14:44Z
- **Completed:** 2026-03-15T17:17:10Z
- **Tasks:** 2 of 3 (Task 3 is human verification checkpoint — pending)
- **Files created:** 3

## Accomplishments

- `force-worker.js`: Web Worker runs D3 force simulation. Handles `init`, `reheat`, `stop`, `drag` messages. Posts `{type:'tick', nodes:[{id,x,y}]}` on each tick. Stops after 300 ticks via tuned alphaDecay.
- `graph.js`: Canvas 2D renderer (not SVG). All interactions: click-to-highlight neighbors (orange), shift-click blast radius via `/impact` (red), protocol filter by checkbox, search filter by name substring, mouse wheel zoom (0.2x–5x), node drag with worker sync, tooltip on hover.
- `index.html`: Single HTML file with no build artifacts. Loads `graph.js` as `type="module"`. Canvas, toolbar, search input, protocol checkboxes, tooltip element — all CSS inline.

## Task Commits

1. **Task 1: Build force-worker.js** — `459d7c0` (feat)
2. **Task 2: Build index.html and graph.js** — `96e2f69` (feat)
3. **Task 3: Human verify — interactive Canvas graph** — pending browser verification

## Files Created

- `worker/ui/force-worker.js` — D3 force simulation in Web Worker, handles init/reheat/stop/drag
- `worker/ui/graph.js` — Canvas renderer, interactions, blast radius, filter, search, zoom
- `worker/ui/index.html` — HTML shell with canvas, search, protocol checkboxes, ESM module script

## Decisions Made

- **Canvas not SVG:** SVG DOM elements have poor performance at 30+ nodes (layout thrashing, style recalculation). Canvas scales linearly and gives full control over rendering order.
- **Web Worker for force simulation:** D3 force simulation is CPU-intensive on large graphs. Running it in a Worker keeps the main thread free for 60fps rendering and immediate interaction response.
- **D3 via CDN ESM:** Zero npm install, zero build step. Users open index.html directly from the server. `d3-force@3` is the only dependency, imported in force-worker.js only.
- **blastCache:** `/impact` calls are cached per node name for the session lifetime, avoiding redundant network requests when the user shift-clicks the same node multiple times.
- **toWorld() coordinate conversion:** Hit detection converts canvas pixel coordinates to world coordinates before the Math.hypot test, ensuring click targets are correct at all zoom levels.

## Deviations from Plan

None — plan executed exactly as written.

## Human Verification Checkpoint (Task 3)

**Status: Pending human verification**

Per the execution note, Task 3 is a `checkpoint:human-verify` gate. All code is complete and committed. To verify:

1. Start the Fastify server with stub data:
   ```bash
   node -e "
   import('./worker/http-server.js').then(async ({ createHttpServer }) => {
     const qe = {
       getGraph: () => ({
         nodes: [
           { id: 1, name: 'auth-service', language: 'ts', repo_id: 1, root_path: '/repos/auth' },
           { id: 2, name: 'api-gateway', language: 'ts', repo_id: 1, root_path: '/repos/api' },
           { id: 3, name: 'billing-service', language: 'python', repo_id: 2, root_path: '/repos/billing' },
           { id: 4, name: 'user-service', language: 'go', repo_id: 2, root_path: '/repos/users' },
           { id: 5, name: 'notification-service', language: 'ts', repo_id: 1, root_path: '/repos/notify' },
         ],
         edges: [
           { id: 1, source_service_id: 2, target_service_id: 1, protocol: 'rest', method: 'POST', path: '/api/token', source_file: 'gateway/auth.ts:12', target_file: 'auth/routes.ts:8' },
           { id: 2, source_service_id: 3, target_service_id: 2, protocol: 'rest', method: 'GET', path: '/users/:id', source_file: 'billing/client.py:44', target_file: 'api/users.ts:22' },
           { id: 3, source_service_id: 4, target_service_id: 1, protocol: 'grpc', method: 'call', path: '/auth.AuthService/Verify', source_file: 'users/auth.go:18', target_file: 'auth/grpc.ts:5' },
           { id: 4, source_service_id: 5, target_service_id: 3, protocol: 'events', method: 'consume', path: 'billing.invoice.created', source_file: 'notify/consumer.ts:30', target_file: 'billing/events.py:15' },
           { id: 5, source_service_id: 2, target_service_id: 4, protocol: 'internal', method: 'call', path: 'UserService.GetById', source_file: 'gateway/users.ts:9', target_file: 'users/service.go:44' },
         ]
       }),
       getImpact: (ep) => ({ affected: [{ id: 3, name: 'billing-service' }, { id: 5, name: 'notification-service' }] }),
       getService: (name) => ({ service: { id: 1, name }, upstream: [], downstream: [] }),
       getVersions: () => [],
     };
     const server = await createHttpServer(qe, { port: 37888 });
     console.log('Open http://127.0.0.1:37888');
   });"
   ```

2. Open http://127.0.0.1:37888 in a browser.

3. Verify all 8 behaviors: Canvas renders nodes, click highlights neighbors, click again clears, shift-click shows blast radius, search filters, protocol unchecking hides edges, scroll zooms, drag moves node.

## Issues Encountered

None.

## User Setup Required

None — no external service configuration required.

## Next Phase Readiness

- All three UI files are in `worker/ui/`, served by the Phase 17-01 Fastify static route.
- Phase 18 (agent scanning) can now proceed — the `POST /scan` route stub is already in http-server.js.
- Phase 20 (command layer) can invoke `createHttpServer` with a real query engine to display live data.

---
*Phase: 17-http-server-web-ui*
*Completed: 2026-03-15*
