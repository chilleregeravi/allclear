# Command reference

Every `/arcanon:*` command, what it does, and its exit-code contract.

## Scanning

### `/arcanon:map [view|full]`

Scan linked repos and (re)build the local service graph.

- No argument → incremental scan when possible, full otherwise.
- `view` → open the local graph UI without scanning.
- `full` → force a full re-scan.

Side effects: writes to `~/.arcanon/projects/<hash>/impact-map.db`. With
`hub.auto-upload: true` + credentials, also POSTs to the hub.

---

## Hub sync

### `/arcanon:login <arc_…>`

Store an API key in `~/.arcanon/config.json` (mode `0600`). Prompts
interactively when no argument is supplied. Keys are issued exclusively
through the web dashboard at https://app.arcanon.dev/settings/api-keys —
the hub exposes no programmatic login flow (no device-code, no OAuth).

To check whether credentials are stored, run `/arcanon:status`. To
validate that a key actually works, run `/arcanon:upload` — 401/403
indicates a bad key.

### `/arcanon:upload [--project <slug>] [--repo <path>]`

Upload the latest local scan for the current (or specified) repo.

Exit codes: `0` on 202 / 409, `1` on any other hub failure. A retriable
failure auto-enqueues and still exits `1` — the user gets a queue id.

### `/arcanon:sync [--limit N]`

Drain the offline queue. Prints `attempted/succeeded/failed/dead`
counts. Default limit: 50 rows per call.

### `/arcanon:status`

Single-screen health: plugin version, config file path, project slug,
credential presence, auto-upload flag, queue stats, data dir.

---

## Drift

### `/arcanon:drift [graph|versions|types|openapi] [--all]`

- `graph` *(new in v6)* — diff the two most recent scan snapshots.
- `versions` — cross-repo dependency version drift.
- `types` — shared type/interface drift (best-effort, same-language).
- `openapi` — OpenAPI spec diff via `oasdiff` when available.

With no subcommand, runs all four and groups output by severity
(`CRITICAL`, `WARN`, `INFO`). `--all` shows `INFO` lines too.

---

## Impact & cross-impact

### `/arcanon:impact <target> [--direction downstream|upstream] [--hops N]`

Cross-repo impact query. Answers *"If I change this, what breaks?"*.

- `<target>` → service name, endpoint path, or schema name.
- `--direction downstream` *(default)* → what does `<target>` affect?
- `--direction upstream` → what affects `<target>`?
- `--hops N` *(default 3)* → transitive traversal depth.

Prefers the MCP tool (`mcp__arcanon__impact`), falls back to the HTTP
worker endpoint.

### `/arcanon:cross-impact [file-or-symbol]`

Legacy repo-local transitive impact query from the v5 line.
`/arcanon:impact` is the preferred command going forward.

---

## Export

### `/arcanon:export [--format mermaid|dot|json|html|all] [--out <dir>]`

Emit the local service graph. The HTML output is a single self-contained
page backed by cytoscape.js + fcose layout — open it in any browser
without a server.

Defaults: `--format all`, `--out .arcanon/reports/<timestamp>/`.

---

## Exit codes

| Code | Meaning |
| --- | --- |
| `0` | Success |
| `1` | Command-level error (missing scan, bad input, hub failure) |
| `2` | Usage error (wrong subcommand, missing required arg) |
| `127` | Missing system dependency (Node, jq, git) |

## Environment variables

| Variable | Purpose |
| --- | --- |
| `ARCANON_API_KEY` | Bearer token for the hub (starts with `arc_`). |
| `ARCANON_API_TOKEN` | Alias for `ARCANON_API_KEY` (preferred by CI vendors). |
| `ARCANON_HUB_URL` | Override the hub URL (default `https://api.arcanon.dev`). |
| `ARCANON_DATA_DIR` | Override `~/.arcanon/`. |
| `ARCANON_DISABLE_SESSION_START` | Silence the session-start banner. |
| `LIGAMEN_*` | Legacy aliases — still honored, deprecated. |
