# Phase 121 Research — Integration Consumption Layer

**Phase:** 121
**Wave:** 5
**Owned REQs:** INT-06, INT-07, INT-08, INT-09, INT-10 (5 reqs)
**Risk:** Low
**Depends on:** Phase 120 (ships `data/known-externals.yaml`), Phase 114 (ships `/arcanon:list`)
**Researched:** 2026-04-25

---

## Goal recap

Consume the catalog shipped by Phase 120 to:

1. **INT-06**: A new scan enrichment pass loads `known-externals.yaml`, matches actor URLs/host patterns against the catalog, and assigns a friendly `label` to matched actors.
2. **INT-07**: Users can extend the catalog via `arcanon.config.json` `external_labels` key — same shape, user wins on collision.
3. **INT-08**: `/arcanon:list` (Phase 114) and graph UI render the friendly label instead of the raw URL/hostname when present.
4. **INT-09**: Node tests cover loader, match logic, and merge.
5. **INT-10**: Bats test for `/arcanon:drift openapi --spec X --spec Y` happy path (per ROADMAP detail block).

The intent is plain: consumers of `actor.name` (graph UI, `/arcanon:list`, eventually MCP `impact` results) see "Stripe" instead of `api.stripe.com`. The raw `actor.name` is preserved as the canonical identifier; `label` is a display-layer overlay.

---

## §1 — Existing actor / enrichment infrastructure

### Actors table (migration 008)

`plugins/arcanon/worker/db/migrations/008_actors_metadata.js`:

```sql
CREATE TABLE actors (
  id        INTEGER PRIMARY KEY AUTOINCREMENT,
  name      TEXT    NOT NULL,
  kind      TEXT    NOT NULL DEFAULT 'system',
  direction TEXT    NOT NULL DEFAULT 'outbound',
  source    TEXT    NOT NULL DEFAULT 'scan',
  UNIQUE(name)
);
```

The `actors.name` column today holds whatever the scan agent emitted — typically a hostname (`api.stripe.com`), a service ID with a URL-shaped string, or sometimes a friendlier name if the agent inferred one. There is **no `label` column** today and no URL/host normalization.

### Enrichment framework

`plugins/arcanon/worker/scan/enrichment.js` (~64 LOC):

- `registerEnricher(name, fn)` — module-level array of enrichers
- `runEnrichmentPass(service, db, logger, repoAbsPath)` — invoked **per service** in `manager.js:826` AFTER `endScan()`
- Each enricher is `(ctx) => Promise<Record<string, string|null>>` and writes to `node_metadata` rows keyed `(service_id, view='enrichment', key, value)`

**Critical observation:** the existing enrichment framework is **per-service**. Actor enrichment is conceptually **per-actor**, not per-service. We have two clean paths:

(a) **Add an actor-enrichment pass alongside `runEnrichmentPass`** — a sibling function called once per repo (after the per-service loop). This matches the existing seam at `manager.js:874` where the per-service loop has already finished but the scan complete log has not yet fired.

(b) **Repurpose `runEnrichmentPass` to also walk actors** — adds complexity to a single-purpose function and couples actor enrichment to the per-service loop count.

**Recommendation:** Option (a) — add `runActorEnrichment(repoId, db, logger, catalog)` invoked once per repo at `manager.js:875` (right before the `slog('INFO', 'enrichment done', ...)` line; or just after the per-service loop, before dep-scan). One pass per repo, not N passes per service.

### Manager.js wire-in point

`manager.js:816-866` — the enrichment block already lives inside the per-repo loop. The actor pass slots in at line ~865 (before the `slog('INFO', 'enrichment done', ...)` line) so that:

- Enrichment log captures actor enrichment too
- The actor enrichment runs after per-service enrichment (in case future per-service enrichers populate auxiliary actor metadata)
- Failure handling already wraps the entire enrichment block in `try/catch` at line 819

---

## §2 — `known-externals.yaml` shape (assumptions about Phase 120)

Phase 120 ships `plugins/arcanon/data/known-externals.yaml`. The directory `plugins/arcanon/data/` does NOT exist today (verified). Phase 120 creates it.

### Assumed shape (must be confirmed against Phase 120's deliverable)

Based on the REQUIREMENTS.md INT-05 description and competitive-tool conventions, the assumed shape is:

```yaml
# plugins/arcanon/data/known-externals.yaml
version: 1
entries:
  stripe:
    label: "Stripe API"
    hosts:
      - "api.stripe.com"
  auth0:
    label: "Auth0"
    hosts:
      - "*.auth0.com"
  github:
    label: "GitHub API"
    hosts:
      - "api.github.com"
  slack:
    label: "Slack"
    hosts:
      - "hooks.slack.com"
  sentry:
    label: "Sentry"
    hosts:
      - "sentry.io"
      - "*.ingest.sentry.io"
  datadog:
    label: "Datadog"
    hosts:
      - "*.datadoghq.com"
  opentelemetry:
    label: "OpenTelemetry Collector"
    ports:
      - 4317
      - 4318
  # ... ~15 more entries
```

**Field assumptions** (Phase 121 plan must be defensive about these):

- Top-level `version: 1` (so future schema changes can be detected and rejected)
- `entries` is a map keyed by stable slug (e.g., `stripe`, `github`) — the slug is opaque to Phase 121
- Each entry has a `label` (string, required — this is what we render)
- Each entry has at least one of `hosts` (string[]) and/or `ports` (number[])
- `hosts` MAY contain wildcard patterns like `*.auth0.com` (single-asterisk subdomain wildcard, NOT a glob)
- `ports` is a number array used for actors whose name starts with `:port:` or matches a port-shaped pattern

**Variant we should also tolerate:** Phase 120 might use a flat list:

```yaml
entries:
  - id: stripe
    label: "Stripe API"
    hosts: ["api.stripe.com"]
```

The loader in Phase 121 should detect both shapes (`Array.isArray(entries)` → list form; otherwise → map form) and normalize internally to the map form.

### Decision: defensive loader

The loader in Phase 121 will:
1. Read the file via `fs.readFileSync` + `js-yaml.load`
2. Validate top-level shape: `version: 1`, `entries` is map-or-array
3. Normalize to a map: `{ slug: { label, hosts: [], ports: [] } }`
4. Reject malformed entries with a `slog('WARN', ...)` and skip them (do NOT abort the scan)
5. Cache the parsed catalog in module memory for the process lifetime (re-read on `--reload-catalog` future flag, but not now)

---

## §3 — Match logic (actor → catalog entry)

### Actor name shapes observed today

From the migration 008 backfill query and the agent prompts, `actors.name` typically holds:
- Bare hostnames: `api.stripe.com`, `hooks.slack.com`
- Full URLs: `https://api.github.com/repos/...`
- Service IDs that look hostname-shaped: `auth0-tenant.us.auth0.com`
- Occasionally a port-shaped string for in-cluster collectors: `otel-collector:4317`
- Occasionally a friendlier name if the agent inferred one: `Stripe API`

### Match algorithm

```
function matchActor(actorName, catalog) {
  // 1. Try to extract hostname.
  let hostname = null;
  if (looksLikeURL(actorName)) {
    try { hostname = new URL(actorName).hostname; } catch {}
  } else if (isHostnameShaped(actorName)) {
    hostname = actorName.split(':')[0].split('/')[0].toLowerCase();
  }

  if (hostname) {
    for (const [slug, entry] of catalog.entries) {
      for (const pattern of entry.hosts || []) {
        if (matchHost(hostname, pattern)) return entry.label;
      }
    }
  }

  // 2. Try port-shape match.
  const portMatch = actorName.match(/:(\d+)$/);
  if (portMatch) {
    const port = parseInt(portMatch[1], 10);
    for (const [slug, entry] of catalog.entries) {
      if ((entry.ports || []).includes(port)) return entry.label;
    }
  }

  return null;  // no match — leave actor.name unchanged
}

function matchHost(hostname, pattern) {
  if (!pattern.includes('*')) {
    return hostname === pattern.toLowerCase();
  }
  // Single-asterisk subdomain wildcard: *.auth0.com matches foo.auth0.com,
  // foo.bar.auth0.com, but NOT auth0.com bare.
  const escaped = pattern
    .toLowerCase()
    .split('.')
    .map(part => part === '*' ? '[^.]+(?:\\.[^.]+)*' : part.replace(/[.+?^${}()|[\]\\]/g, '\\$&'))
    .join('\\.');
  return new RegExp('^' + escaped + '$').test(hostname);
}
```

**Decision: case-insensitive host matching.** Hostnames are case-insensitive per RFC; matching must lowercase both sides.

**Decision: no protocol matching.** `https://api.stripe.com` and `http://api.stripe.com` both match Stripe — protocol does not affect identity.

**Decision: no path matching.** `https://api.github.com/repos` and `https://api.github.com/orgs` both match GitHub — Phase 121 labels at the host granularity. Path-aware labels are deferred to a future milestone.

---

## §4 — Storage decision: persist `actors.label` column

### Two options considered

**Option A — Persistent column** (`actors.label TEXT NULL`, populated during scan, read by all consumers):

- Pros: zero per-read overhead; consumers do `SELECT name, label FROM actors`; survives catalog file removal between runs; consistent across all callsites without each one re-running the loader.
- Cons: requires migration 018; label staleness when catalog is updated → next scan refreshes it (acceptable per the rescan-on-catalog-change pattern users already expect).

**Option B — On-the-fly compute** (loader runs once per process, every consumer enriches actor rows on read):

- Pros: no migration; always reflects latest catalog without rescan; lower scan-time work.
- Cons: every consumer (`/arcanon:list`, graph UI via `/graph` endpoint, MCP impact) must duplicate the loader + match logic; higher per-read cost; harder to test (each consumer needs catalog-loaded fixtures); harder to audit "what label does Stripe have right now" — the answer depends on which consumer asks.

### Decision: **Option A — persist via migration 018**

- Migration `018_actors_label.js` adds `label TEXT` column to `actors` (nullable, default NULL).
- Scan enrichment pass writes `label` during the actor enrichment pass (per §1 recommendation).
- All consumers read `actors.label` directly — no per-read loader work.
- Catalog updates take effect on next scan, which matches user mental model ("rescan to pick up changes").

**Migration sequencing check:** Migration 016 (Phase 113 enrichment_log) is the current head. Phase 117 in this milestone introduces 017 (`scan_overrides`). So Phase 121's migration is **018** — confirmed correct sequencing. No collision risk because Phase 117 plans pin migration 017 explicitly (per ROADMAP Phase 117 detail).

**Note on Phase 117 dependency:** Phase 121 does NOT depend on Phase 117 functionally — only on the migration number. If Phase 117 slips, Phase 121's migration number must shift to 017 (and Phase 117's becomes 018). Plan must call this out as an assumption.

---

## §5 — User extension: `arcanon.config.json external_labels` key

### Config shape (mirrors catalog)

```json
{
  "linked-repos": ["../api", "../ui"],
  "external_labels": {
    "internal-billing": {
      "label": "Internal Billing API",
      "hosts": ["billing.internal.example.com"]
    },
    "stripe": {
      "label": "Stripe (Production)",
      "hosts": ["api.stripe.com"]
    }
  }
}
```

### Merge semantics

The merged catalog is the input to `matchActor()`:

```
mergedCatalog = {
  ...shippedCatalog,  // from data/known-externals.yaml
  ...userCatalog,     // from arcanon.config.json external_labels
  // user keys override shipped keys on collision (e.g., user's "stripe" wins)
}
```

**Important:** the merge happens **in memory at scan time**. The shipped YAML file is **never mutated**. The user config is the source of truth for overrides; if the user removes their `external_labels.stripe` entry, the next scan reverts to the shipped Stripe label.

### Loader merge implementation

```javascript
export function loadMergedCatalog(projectRoot) {
  const shipped = loadShippedCatalog();   // reads data/known-externals.yaml
  const userExt = loadUserExtensions(projectRoot);  // reads arcanon.config.json
  return { entries: { ...shipped.entries, ...userExt.entries } };
}
```

**Validation:** user entries get the same shape validation as shipped entries. Malformed user entries log a warning and are skipped — never crash the scan.

---

## §6 — UI surfacing (graph UI label rendering)

### Current actor rendering path

`worker/db/query-engine.js:1576` — `getGraph()` returns `actors: [{ id, name, kind, direction, source, connected_services }, ...]`.

`worker/ui/graph.js:166-178` — for each actor, creates a synthetic node `{ id: -actor.id, name: actor.name, type: 'actor', _isActor: true, _actorData: actor }`.

`worker/ui/modules/renderer.js:456` — `const label = truncate(node.name, LABEL_MAX_CHARS);` — the rendered label is `node.name`.

`worker/ui/modules/detail-panel.js:330` — `<h3>${escapeHtml(actor.name)}</h3>` — the detail panel header is `actor.name`.

### Three changes required

1. **`getGraph()`** — extend the SELECT to include `label`: `SELECT id, name, kind, direction, source, label FROM actors`. Each actor row carries `label` in the response.

2. **`graph.js`** — when creating the synthetic actor node, set `name: actor.label || actor.name`. The display name on the canvas is the label when present; the raw name is preserved on `_actorData.name` for the detail panel "raw URL" line.

3. **`detail-panel.js renderActorDetail`** — render the label as the heading and add a small subtitle line `<div class="detail-subtle">${escapeHtml(actor.name)}</div>` showing the raw URL. So users see "Stripe API" big with "api.stripe.com" small underneath.

**Decision: do NOT mutate `actor.name` itself in the response.** Add a separate `label` field. UI logic picks `label || name`. This preserves the contract that `actor.name` is the canonical identifier; `label` is purely presentational.

### Renderer label fallback

```javascript
// graph.js:166-178 — modified:
for (const actor of state.graphData.actors) {
  const syntheticId = -actor.id;
  state.graphData.nodes.push({
    id: syntheticId,
    name: actor.label || actor.name,  // CHANGED — render label when present
    raw_name: actor.name,             // NEW — kept for detail panel & search
    type: 'actor',
    _isActor: true,
    _actorData: actor,
    language: null,
    repo_name: null,
    exposes: [],
  });
}
```

Search filter (`renderer.js:59`) already searches `n.name` — no change needed; users searching for "Stripe" will find the Stripe-labeled actor.

---

## §7 — `/arcanon:list` actor display (INT-08)

### Today

`hub.js:660-663, 763-768` — actors render as a single number: `Actors: 4 external`. No labels, no names.

### INT-08 says

> `/arcanon:list` displays labeled names instead of raw URLs.

This implies the user wants to **see which external actors** are in the project, not just the count. Two approaches:

**(a) Extend the existing 5-line overview** — append a 6th line:

```
Actors:       4 external (Stripe, GitHub, Slack, Datadog)
```

When `len(labels) > 5`, truncate: `(Stripe, GitHub, Slack, Datadog, +3 more)`.

**(b) Add a `--actors` flag** — `/arcanon:list --actors` prints a table.

### Decision: **Option (a)** — inline label list

Reasons:
1. Matches the spirit of `/arcanon:list` as a "concise overview" (per NAV-01 spec).
2. Zero new flag surface; users discover labels just by running `/arcanon:list`.
3. The 5-line spec is a soft constraint — adding labels to an existing line is a superset of the original behavior, not a new line.

Format:

```
Arcanon map for /path (scanned 2d ago)
  Repos:        3 linked
  Services:     12 mapped (5 services, 4 libraries, 3 infra)
  Connections:  47 (41 high-conf, 6 low-conf)
  Actors:       4 external (Stripe, GitHub, Slack, Datadog)
  Hub:          synced, 0 queued
```

When labels are absent (no catalog match), fall back to the bare hostname:

```
  Actors:       4 external (api.example.com, GitHub, internal-svc.local, Slack)
```

When `actors.length > 5`, truncate to `(label1, label2, label3, label4, label5, +N more)`.

### `--json` mode

JSON output gains a sibling field:

```json
{
  ...,
  "actors_count": 4,
  "actors": [
    {"name": "api.stripe.com", "label": "Stripe"},
    {"name": "api.github.com", "label": "GitHub"},
    {"name": "hooks.slack.com", "label": "Slack"},
    {"name": "internal.example.com", "label": null}
  ]
}
```

This requires extending `getGraph()` to include `label` (already required by §6) — same single shape change covers UI + list.

---

## §8 — `/arcanon:drift openapi --spec X --spec Y` test (INT-10)

### Status

`/arcanon:drift openapi --spec` is implemented in **Phase 120** (per ROADMAP Phase 120 detail). Phase 121 owns only the bats happy-path test.

### Test fixture

Two real OpenAPI fixtures under `plugins/arcanon/tests/fixtures/externals/`:
- `spec-a.yaml` — minimal valid OpenAPI 3.0 spec with one path `/users` returning `{id, name}`.
- `spec-b.yaml` — same shape but one breaking change (e.g., `/users` returns `{id, full_name}` — renamed field).

Bats test:

```bash
@test "/arcanon:drift openapi --spec X --spec Y reports the rename" {
  run bash "$HUB_SH" drift openapi --spec "$FIXTURES/spec-a.yaml" --spec "$FIXTURES/spec-b.yaml"
  [ "$status" -eq 0 ]
  [[ "$output" == *"rename"* || "$output" == *"breaking"* ]]
}
```

Test lives at **repo-root `tests/drift-openapi.bats`** per the convention.

---

## §9 — `js-yaml` dependency

### Current state

`plugins/arcanon/package.json` does NOT have `js-yaml`. The current dependencies are:

```json
"dependencies": {
  "@fastify/cors": "^10.0.0",
  "@fastify/static": "^9.1.1",
  "@modelcontextprotocol/sdk": "^1.27.1",
  "better-sqlite3": "^12.9.0",
  "chromadb": "^3.3.3",
  "fastify": "^5.8.5",
  "picomatch": "^4.0.4",
  "zod": "^3.25.0"
}
```

**Decision: add `js-yaml` as a runtime dep in Phase 120** (since 120 ships the YAML file and likely the loader stub). Phase 121 assumes it is present. If Phase 120 does not ship the dep, Phase 121 must add it as part of plan 121-01.

**Fallback if Phase 120 doesn't add it:** Phase 121 can use a minimal hand-rolled YAML subset parser (no anchors, no flow style — just nested maps + scalar strings + flow-array `[a, b, c]`). The shape we need is shallow enough that ~80 LOC of regex parsing is feasible. Plan 121-01 will note this contingency.

---

## §10 — Failure modes and graceful degradation

| Failure | Behavior |
| ------- | -------- |
| `data/known-externals.yaml` missing | Loader returns empty catalog; no labels assigned; warning logged once per scan. |
| YAML parse error | Loader returns empty catalog; ERROR-level log with file path + parse error message; scan continues. |
| User config has malformed `external_labels` | Skip the malformed entries with WARN log; valid entries still merge. |
| `actors.label` column missing (pre-migration 018 DB) | `getGraph()` SELECT wraps `label` in COALESCE-with-NULL fallback; UI renders `name` as today. |
| User catalog has key collision with shipped | User wins (per INT-07); no warning (intentional override is a feature, not a bug). |
| Catalog references a port that's also used by an internal service | The port match runs only against actors (not services); no cross-contamination. |

---

## §11 — Open questions / assumptions on Phase 120

These are EXPLICIT assumptions Phase 121 plans encode. If Phase 120 deviates, plan-checker will flag.

<assumptions_about_phase_120>

1. **File location:** `plugins/arcanon/data/known-externals.yaml` (NOT `plugins/arcanon/worker/data/...`, NOT `data/...` at repo root). Justification: matches "ships *with* the plugin" semantics; survives plugin reinstall via `${CLAUDE_PLUGIN_ROOT}/data/...` pattern.

2. **Shape:** Top-level `version: 1` + `entries` map (slug → `{label, hosts[], ports[]}`). Plan 121-01's loader normalizes both map and list forms (see §2).

3. **`label` field is required per entry, is a non-empty string.** Loader rejects entries without `label`.

4. **`hosts` can include single-asterisk subdomain wildcards** (`*.foo.com`). NOT general globs — no `?`, no `[abc]`, no double-asterisk.

5. **`ports` is an array of integers.** Used only when the actor name is port-shaped (`:4317`).

6. **`js-yaml` is added as a runtime dependency in Phase 120.** If not, plan 121-01 owns adding it.

7. **No mutation of the YAML file by Phase 120 runtime code.** It's a read-only catalog ship-only artifact. User extensions live in `arcanon.config.json`, not in the YAML.

8. **The catalog file is loaded via path** `${CLAUDE_PLUGIN_ROOT}/data/known-externals.yaml` **at runtime**, not bundled into JS. This lets users (or future MCP catalog-update tooling) override the file without rebuilding the plugin.

9. **Phase 120 does NOT add the `actors.label` column.** Phase 121 owns migration 018. Phase 120 is data-layer only; consumption is Phase 121's scope.

10. **Phase 120 does NOT modify enrichment.js or manager.js.** All consumption-side wiring is Phase 121's scope.

</assumptions_about_phase_120>

If Phase 120 ships a different shape, plan 121-01's loader needs an adapter shim. The plan deliberately puts the loader behind a single `loadShippedCatalog()` function so the adapter is a one-place change.

---

## §12 — Plan partition

Three plans:

- **121-01-PLAN.md** — Catalog loader + match logic + migration 018 (`actors.label` column) + actor enrichment pass + node tests for loader/match/merge (INT-06, INT-09).
- **121-02-PLAN.md** — User extension via config + UI surfacing (graph UI label rendering) + `/arcanon:list` actor label display (INT-07, INT-08).
- **121-03-PLAN.md** — `/arcanon:drift openapi --spec X --spec Y` happy-path bats test with two real OpenAPI fixtures (INT-10).

Plans 121-01 and 121-02 are sequential (02 consumes the schema and loader from 01). Plan 121-03 is parallel — owns only test fixtures + one bats file.

---

## §13 — Cross-references

| Source | Use |
| ------ | --- |
| `plugins/arcanon/worker/scan/enrichment.js` | Enrichment pattern (per-service); 121-01 mirrors with per-repo actor pass. |
| `plugins/arcanon/worker/scan/manager.js:816-880` | Wire-in site for new actor enrichment pass. |
| `plugins/arcanon/worker/db/migrations/008_actors_metadata.js` | Actors table schema being extended. |
| `plugins/arcanon/worker/db/migrations/016_enrichment_log.js` | Last shipped migration; 017 is Phase 117, 018 is Phase 121. |
| `plugins/arcanon/worker/db/query-engine.js:1481-1644` | `getGraph()` — actors SELECT extended for `label`. |
| `plugins/arcanon/worker/ui/graph.js:153-194` | Synthetic actor node creation — display name picks label. |
| `plugins/arcanon/worker/ui/modules/renderer.js:456` | Canvas label rendering — uses `node.name` (now label-or-name). |
| `plugins/arcanon/worker/ui/modules/detail-panel.js:325-346` | Actor detail panel — add raw-name subtitle. |
| `plugins/arcanon/worker/cli/hub.js:571-774` | `cmdList` — extend to show actor labels inline. |
| `plugins/arcanon/worker/lib/config-path.js` | `resolveConfigPath()` — used by user-extension loader. |
| `plugins/arcanon/lib/worker-client.sh` | `_arcanon_is_project_dir()` (Phase 114) — referenced for actor-test fixtures. |
| `plugins/arcanon/tests/fixtures/list/seed.js` | Pattern for seed scripts — 121-01 mirrors for actors fixtures. |
| `tests/list.bats` | Bats test convention — 121-02 extends list.bats with one new actor-label test. |

---

*Research complete. Plans 121-01 / 121-02 / 121-03 follow.*
