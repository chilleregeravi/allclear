# Configuration

Ligamen works with zero configuration. All features auto-detect project types and tools.

## Project Config: `ligamen.config.json`

Lives in your project root. Committed to git.

```json
{
  "linked-repos": [
    "../api",
    "../auth",
    "../sdk"
  ],
  "impact-map": {
    "history": true
  },
  "boundaries": [
    {
      "name": "core",
      "label": "Core Services",
      "services": ["api-gateway", "auth-service", "user-service"]
    },
    {
      "name": "adapters",
      "label": "Protocol Adapters",
      "services": ["grpc-adapter", "mqtt-adapter"]
    }
  ]
}
```

| Key | Purpose |
|-----|---------|
| `linked-repos` | Explicit list of connected repos. Auto-discovered from parent dir if absent. |
| `impact-map` | Created automatically after first `/ligamen:map`. Presence triggers worker auto-start. |
| `boundaries` | Optional service grouping for the graph UI. Each boundary draws a labeled box around its member services. |

### Boundaries

Boundaries group services visually in the graph UI. Each boundary needs:

- `name` — identifier (used in filter dropdown and `node.boundary` field)
- `label` — display text shown on the boundary box
- `services` — array of service names (must match names from scan results)

Services not assigned to any boundary appear ungrouped in the services row. A service can only belong to one boundary.

## Machine Settings: `~/.ligamen/settings.json` {#machine-settings}

Machine-specific settings. Never committed.

```json
{
  "LIGAMEN_WORKER_PORT": "37888",
  "LIGAMEN_WORKER_HOST": "127.0.0.1",
  "LIGAMEN_DATA_DIR": "/Users/you/.ligamen",
  "LIGAMEN_LOG_LEVEL": "INFO"
}
```

| Setting | Default | Description |
|---------|---------|-------------|
| `LIGAMEN_WORKER_PORT` | `37888` | Worker daemon HTTP port |
| `LIGAMEN_WORKER_HOST` | `127.0.0.1` | Worker bind address |
| `LIGAMEN_DATA_DIR` | `~/.ligamen` | Data directory for DBs, logs, settings |
| `LIGAMEN_LOG_LEVEL` | `INFO` | Log verbosity (`INFO` or `DEBUG`) |

## ChromaDB (optional) {#chromadb}

Ligamen can sync service graph data to [ChromaDB](https://www.trychroma.com/) for semantic vector search. This enhances MCP tool responses and `/ligamen:cross-impact` results with richer, context-aware matches.

Without ChromaDB, Ligamen falls back to SQLite FTS5 full-text search — still functional, but keyword-based rather than semantic.

### Setup

**1. Run ChromaDB:**

```bash
# Docker (recommended)
docker run -d -p 8000:8000 --name chromadb chromadb/chroma

# Or pip
pip install chromadb
chroma run --host localhost --port 8000
```

**2. Enable in `~/.ligamen/settings.json`:**

```json
{
  "LIGAMEN_CHROMA_MODE": "local",
  "LIGAMEN_CHROMA_HOST": "localhost",
  "LIGAMEN_CHROMA_PORT": "8000"
}
```

**3. Re-scan your project:**

```
/ligamen:map
```

After scanning, service data is synced to ChromaDB automatically. Subsequent MCP queries and impact checks use ChromaDB for semantic search when available.

### ChromaDB Settings

Add these to `~/.ligamen/settings.json`:

| Setting | Default | Description |
|---------|---------|-------------|
| `LIGAMEN_CHROMA_MODE` | _(empty)_ | Set to `"local"` to enable ChromaDB sync |
| `LIGAMEN_CHROMA_HOST` | `localhost` | ChromaDB server hostname |
| `LIGAMEN_CHROMA_PORT` | `8000` | ChromaDB server port |
| `LIGAMEN_CHROMA_SSL` | `false` | Enable HTTPS for ChromaDB connection |
| `LIGAMEN_CHROMA_API_KEY` | _(empty)_ | API key for authenticated ChromaDB instances |
| `LIGAMEN_CHROMA_TENANT` | `default_tenant` | ChromaDB tenant ID |
| `LIGAMEN_CHROMA_DATABASE` | `default_database` | ChromaDB database name |

### What Gets Synced

Each service becomes a ChromaDB document with:
- Service name, type, language
- Connected services and protocols
- Boundary membership (if configured)
- External actor relationships (detected from scan)

This enables queries like "what services handle payments" to return results even when the word "payments" doesn't appear literally in endpoint paths.

### Troubleshooting

- **ChromaDB not running:** Ligamen logs a warning and falls back to FTS5. No scan data is lost.
- **Connection refused:** Check `LIGAMEN_CHROMA_HOST` and `LIGAMEN_CHROMA_PORT` match your ChromaDB instance.
- **Stale data:** Re-run `/ligamen:map` to resync. ChromaDB collections are replaced on each scan.

## Environment Variables {#environment-variables}

| Variable | Effect |
|----------|--------|
| `LIGAMEN_DISABLE_FORMAT=1` | Skip auto-formatting |
| `LIGAMEN_DISABLE_LINT=1` | Skip auto-linting |
| `LIGAMEN_DISABLE_GUARD=1` | Skip file guard |
| `LIGAMEN_DISABLE_SESSION_START=1` | Skip session context |
| `LIGAMEN_LINT_THROTTLE=<seconds>` | Cargo clippy throttle (default: 30) |
| `LIGAMEN_EXTRA_BLOCKED=<patterns>` | Colon-separated glob patterns to block |

## Data Directory: `~/.ligamen/`

```
~/.ligamen/
├── settings.json              # machine settings
├── worker.pid                 # daemon PID
├── worker.port                # actual bound port
├── logs/                      # worker logs
└── projects/
    └── <project-hash>/
        ├── impact-map.db      # per-project graph DB (SQLite)
        └── snapshots/         # version history
```
