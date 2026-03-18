---
phase: 35-external-actors
verified: 2026-03-18T21:00:00Z
status: human_needed
score: 10/11 must-haves verified
re_verification: false
human_verification:
  - test: "Open graph UI with a project that has external connections (crossing='external') scanned"
    expected: "Hover over an actor hexagon node — tooltip should show the node name and a type indicator. Verify the type indicator reads 'actor' (acceptable) or 'external' (per plan truth). Either is acceptable functionally; this check confirms tooltip renders at all for actor nodes."
    why_human: "Tooltip text is rendered at runtime in a browser canvas; the code shows getNodeType returns 'actor' not 'external', which differs from the plan truth wording. Human confirms whether this is acceptable or needs adjustment."
  - test: "Visual check of actor hexagons, edges, and detail panel"
    expected: "Coral (#e06060) hexagon nodes appear in a right column. Edges connect from service circles to actor hexagons crossing the boundary area. Clicking an actor opens a detail panel listing connected services with protocol and path."
    why_human: "Canvas rendering and detail panel HTML require browser inspection — cannot verify visual layout programmatically."
---

# Phase 35: External Actors Verification Report

**Phase Goal:** External systems detected during scan are visible as distinct actor nodes outside the system boundary
**Verified:** 2026-03-18T21:00:00Z
**Status:** human_needed (all automated checks pass; 2 items require browser inspection)
**Re-verification:** No — initial verification

## Goal Achievement

### Observable Truths

| # | Truth | Status | Evidence |
|---|-------|--------|----------|
| 1 | persistFindings stores crossing field on every connection row | VERIFIED | `query-engine.js:279-290` — try/catch wraps crossing-inclusive INSERT, fallback to pre-migration version; test 1 PASS |
| 2 | persistFindings creates actor rows from connections where crossing='external' | VERIFIED | `query-engine.js:868-879` — `conn.crossing === 'external'` guard; `_stmtUpsertActor.run()`; test 2 PASS |
| 3 | persistFindings creates actor_connection rows linking actors to source services | VERIFIED | `query-engine.js:876-885` — `_stmtUpsertActorConnection.run()` after actor upsert; test 3 PASS |
| 4 | getGraph returns an actors array alongside services and connections | VERIFIED | `query-engine.js:711-733` — SELECT from actors, map connected_services, return `{services, connections, repos, mismatches, actors}`; test 6+7 PASS |
| 5 | Re-scanning the same repo upserts (not duplicates) actor rows | VERIFIED | `ON CONFLICT(name) DO UPDATE` in `_stmtUpsertActor`; test 5 PASS |
| 6 | External actor nodes render as hexagons in a dedicated column to the right of the system boundary | VERIFIED | `layout.js:39-111` — actorNodes filtered and positioned in right column at `PADDING + usableW + actorReserve/2`; `renderer.js:205-215` — `nodeType === 'actor'` draws 6-sided polygon |
| 7 | Edges from services to external actors visually cross the system boundary | VERIFIED | `graph.js:103-113` — synthetic `_isActorEdge` edges created from `service_id` to negative actor node ID; actors positioned past system boundary so edges naturally cross it |
| 8 | Clicking an external actor node opens a detail panel showing connected services and protocols | VERIFIED | `detail-panel.js:18-21` — `if (node._isActor)` branch calls `renderActorDetail(node)`; `renderActorDetail` at line 218 renders `actor.connected_services` with protocol and path |
| 9 | Actor nodes have a distinct color (coral #e06060) different from all existing node types | VERIFIED | `state.js:68` — `actor: '#e06060'`; `utils.js:59` — `getNodeColor` returns `NODE_TYPE_COLORS.actor` for `_isActor` nodes |
| 10 | hitTest detects clicks on actor hexagon nodes | VERIFIED | `utils.js:18-27` — hitTest loops `state.graphData.nodes` (which includes synthetic actor nodes); actor nodes included since `graph.js:89-99` pushes them into `state.graphData.nodes` |
| 11 | Hover tooltip shows 'external' as type for actor nodes | UNCERTAIN | `interactions.js:45-47` — tooltip shows `[${getNodeType(node)}]` which returns `'actor'` for actor nodes, not `'external'`. Plan truth specified 'external'. Functionally tooltip works but text differs from spec. Needs human confirmation of acceptability. |

**Score:** 10/11 truths automated-verified; 1 uncertain (tooltip text wording)

### Required Artifacts

| Artifact | Expected | Status | Details |
|----------|----------|--------|---------|
| `worker/db/query-engine.js` | Actor persistence in persistFindings, actors in getGraph response | VERIFIED | Lines 279-290 (crossing), 341-365 (actor stmts), 711-733 (getGraph actors), 862-885 (persistFindings actor detection) |
| `worker/db/query-engine-actors.test.js` | Tests for actor persistence and getGraph actor inclusion (min 60 lines) | VERIFIED | 568 lines, 7 tests, all PASS |
| `worker/ui/modules/layout.js` | Actor nodes positioned in right column using ACTOR_COLUMN_RESERVE_RATIO | VERIFIED | Lines 8-16 export constant, lines 39-111 actorNodes partitioned and placed in right column |
| `worker/ui/modules/renderer.js` | Hexagon drawing for actor nodes, edges to actors | VERIFIED | Lines 205-215: pointy-top hexagon with `Math.PI/3` step and `-Math.PI/2` offset |
| `worker/ui/modules/detail-panel.js` | Actor detail panel showing connected services and protocols | VERIFIED | `renderActorDetail` at line 218 (note: plan artifact said `renderActorConnections`; actual function is `renderActorDetail` — same purpose, different name) |
| `worker/ui/modules/utils.js` | getNodeType returns 'actor' for actor nodes, getNodeColor returns actor color | VERIFIED | Lines 48 (`_isActor` returns 'actor'), 59 (`_isActor` returns `NODE_TYPE_COLORS.actor`) |

### Key Link Verification

| From | To | Via | Status | Details |
|------|----|-----|--------|---------|
| `query-engine.js persistFindings` | actors table | `INSERT INTO actors (ON CONFLICT DO UPDATE)` | VERIFIED | `query-engine.js:345-352` — `_stmtUpsertActor` prepared with `ON CONFLICT(name) DO UPDATE` |
| `query-engine.js persistFindings` | actor_connections table | `INSERT OR REPLACE INTO actor_connections` | VERIFIED | `query-engine.js:353-357` — `_stmtUpsertActorConnection` uses `INSERT OR REPLACE INTO actor_connections` |
| `query-engine.js getGraph` | actors + actor_connections tables | `SELECT query joining actors with connected services` | VERIFIED | `query-engine.js:714-728` — SELECT from actors, JOIN actor_connections with services via `actorConnStmt` |
| `graph.js` | `layout.js` | passes actors (as part of graphData.nodes) to computeLayout | VERIFIED | `graph.js:89-99` pushes actor synthetic nodes into `state.graphData.nodes`; `graph.js:124-129` calls `computeLayout(state.graphData.nodes, ...)` |
| `renderer.js` | `utils.js` | getNodeType returns 'actor' to trigger hexagon shape | VERIFIED | `renderer.js:203` calls `getNodeType(node)`, then `if (nodeType === 'actor')` at line 205 draws hexagon |
| `detail-panel.js` | `state.graphData.actors` | reads actor data for detail panel content | VERIFIED | `detail-panel.js:219` — `node._actorData` (set from actor data in `graph.js:97`); `actor.connected_services` read at line 234 |
| `interactions.js` | `utils.js` | hitTest checks both regular nodes and actor nodes | VERIFIED | `interactions.js:39,56,85` calls `hitTest(px, py)`; hitTest loops `state.graphData.nodes` which includes actor synthetic nodes |

### Requirements Coverage

| Requirement | Source Plan | Description | Status | Evidence |
|-------------|------------|-------------|--------|----------|
| ACTOR-01 | 35-01 | Outbound external connections stored as external actor nodes (actors table) | SATISFIED | 7/7 actor persistence tests pass; query-engine.js fully implements crossing detection and actor/actor_connection upserts |
| ACTOR-02 | 35-02 | External actors display in dedicated column to the right of the system boundary | SATISFIED | layout.js actorNodes positioned at `PADDING + usableW + actorReserve/2`; ACTOR_COLUMN_RESERVE_RATIO=0.18 reserves 18% right side |
| ACTOR-03 | 35-02 | Edges from services to external actors cross the system boundary visually | SATISFIED | Synthetic edges created in graph.js from service_id to negative actor node IDs; actors in right column so edges cross boundary naturally |
| ACTOR-04 | 35-02 | Detail panel for external actors shows which services connect and via what protocol | SATISFIED | `renderActorDetail` in detail-panel.js renders `connected_services[]` with `cs.protocol`, `cs.path`, `cs.service_name` |
| NODE-04 | 35-02 | External system actors render as hexagons on the right side, outside the system boundary | SATISFIED | renderer.js:205-215 draws 6-sided polygon for nodeType='actor'; positioned in right column per layout.js |

No orphaned requirements — all 5 requirement IDs (ACTOR-01, ACTOR-02, ACTOR-03, ACTOR-04, NODE-04) are covered by plans 35-01 and 35-02 respectively, and all are accounted for in REQUIREMENTS.md traceability table (Phase 35, Complete).

### Anti-Patterns Found

None found. Scanned all 8 phase files for TODO/FIXME/PLACEHOLDER, empty implementations, and console.log-only stubs. No blockers or warnings detected.

### Human Verification Required

#### 1. Tooltip type text for actor nodes

**Test:** Open the graph UI in a browser (http://localhost:37888) with a project that has scanned external connections. Hover over a coral hexagon node.
**Expected:** Tooltip appears showing node name. The type shown in brackets will be `[actor]` (what the code produces). Confirm this is acceptable, or flag if it needs to show `[external]` instead.
**Why human:** The plan truth says "Hover tooltip shows 'external' as type" but `getNodeType()` returns `'actor'` for actor nodes. The tooltip format is `${node.name} [${getNodeType(node)}]`. Cannot auto-determine acceptability of `[actor]` vs `[external]` — this is a UX judgment call.

#### 2. Full visual inspection of actor rendering

**Test:** Open the graph UI with external connections present. Verify:
1. Coral hexagon nodes appear in a column to the RIGHT of regular service/library/infra nodes
2. Hexagons are coral/salmon colored (#e06060), distinct from blue services, purple libraries, green infra
3. Edges connect from service circles to actor hexagons, crossing the boundary area
4. Click an actor hexagon — detail panel opens showing actor name, "External system" type, and connected services list with protocol/path
5. Click elsewhere — panel dismisses normally

**Expected:** All 5 checks pass visually.
**Why human:** Canvas rendering requires browser execution; layout, colors, and panel HTML cannot be verified programmatically from source code alone.

### Notable Observation

The pre-existing `query-engine-upsert.test.js` failure (documented in `deferred-items.md`) predates phase 35 and is not caused by any phase 35 changes. It requires migrations 001-006 instead of 001-004 in the test setup to resolve the `ON CONFLICT(path)` constraint issue. This is tracked for a future fix.

---

_Verified: 2026-03-18T21:00:00Z_
_Verifier: Claude (gsd-verifier)_
