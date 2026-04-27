---
description: Concise project overview (repos, services by type, connections by confidence, actors, hub status). Read-only, silent in non-Arcanon directories.
argument-hint: "[--json]"
allowed-tools: Bash
---

# Arcanon List — Project Overview

Run a read-only summary of the current project's impact map. Composes from the
existing worker HTTP endpoints (`/graph` + `/api/scan-quality`) plus a direct
`SELECT COUNT(*) FROM repos` for the repo count and the same hub-status helper
`/arcanon:status` already uses. Never writes to the database.

## When to use

- After `/arcanon:map` finishes, to confirm the scan covered what you expected
  (right number of repos, right service-type distribution).
- Before opening the graph UI, when you just need the headline numbers.
- As a non-disruptive default for "what's in this project map?" — the
  read-only contract makes it safe to run in CI or pre-commit hooks.

## Usage

| Invocation                  | Behaviour                                                   |
| --------------------------- | ----------------------------------------------------------- |
| `/arcanon:list`             | 5-line overview to stdout. Exit 0.                          |
| `/arcanon:list --json`      | Single JSON object with the same fields. Exit 0.            |

In a directory with no `impact-map.db` (i.e. a non-Arcanon project), the
command produces zero output and exits 0 — same silent-no-op contract that
`SessionStart` enrichment uses (RESEARCH §6 / SSE-05).

## Output shape (human mode)

```
Arcanon map for /path/to/project (scanned 2d ago)
  Repos:        3 linked
  Services:     8 mapped (5 services, 2 libraries, 1 infra)
  Connections:  47 (41 high-conf, 6 low-conf)
  Actors:       4 external
  Hub:          synced, 0 queued
```

The `Hub:` line mirrors `/arcanon:status`: `synced` when credentials resolve
and `hub.auto-sync` is true, `manual` when credentials resolve but auto-sync
is off, `not configured` when credentials are absent.

The `(scanned Nd ago)` header reads `scan_versions.completed_at` from the
project DB. When no completed scan exists yet, the header reads
`(scanned never)` and the per-section lines still render with whatever data
is available (typically zero connections, but the Repos and Services lines
remain meaningful).

## Output shape (`--json` mode)

```json
{
  "project_root": "/path/to/project",
  "scanned_at": "2026-04-23T17:42:00Z",
  "repos_count": 3,
  "services": {
    "total": 8,
    "by_type": { "service": 5, "library": 2, "infra": 1 }
  },
  "connections": {
    "total": 47,
    "high_confidence": 41,
    "low_confidence": 6,
    "null_confidence": 0
  },
  "actors_count": 4,
  "hub": { "status": "synced", "queued": 0 }
}
```

## Step 1 — Run the command

```bash
source ${CLAUDE_PLUGIN_ROOT}/lib/help.sh
arcanon_print_help_if_requested "$ARGUMENTS" "${CLAUDE_PLUGIN_ROOT}/commands/list.md" && exit 0
source ${CLAUDE_PLUGIN_ROOT}/lib/worker-client.sh
if ! _arcanon_is_project_dir; then
  exit 0  # silent in non-Arcanon directories per NAV-01 contract
fi
if ! worker_running; then
  bash ${CLAUDE_PLUGIN_ROOT}/scripts/worker-start.sh > /dev/null 2>&1
fi
bash ${CLAUDE_PLUGIN_ROOT}/scripts/hub.sh list $ARGUMENTS
```

Relay the output verbatim. The exit code is 0 in all normal paths (including
the silent no-op).

## Read-only guarantee

`/arcanon:list` performs **zero writes**. The only DB access is a single
`SELECT COUNT(*) FROM repos`; the rest of the data flows from the worker's
read-only HTTP endpoints. Safe to run in pre-commit, CI, or in a tight loop.

It does **not**:

- Modify any `services` / `connections` / `scan_versions` row
- Write to `enrichment_log`
- Trigger a scan or a hub sync
- Add new HTTP routes or new auth surface

## Help

**Usage:** `/arcanon:list [--json]`

Concise project overview: linked repos, services partitioned by type,
connection counts by confidence, external actors, and hub sync status.
Read-only via worker HTTP. Silent in non-Arcanon directories.

**Options:**
- *(no flags)* — 5-line overview to stdout, exit 0
- `--json` — single JSON object with the same fields, exit 0
- `--help`, `-h`, `help` — print this help and exit

**Examples:**
- `/arcanon:list` — pretty 5-line overview after a scan
- `/arcanon:list --json` — machine-readable for CI / pre-commit hooks
