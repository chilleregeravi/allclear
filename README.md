# AllClear

Quality gates, cross-repo impact analysis, and service dependency intelligence for [Claude Code](https://docs.anthropic.com/en/docs/claude-code).

AllClear is a Claude Code **plugin** that auto-formats, auto-lints, guards sensitive files, and maps service dependencies across your repositories — with an interactive layered graph UI.

## Installation

### As a Plugin (recommended)

Install AllClear as a Claude Code plugin from any project directory:

```bash
claude plugin install allclear --repo chilleregeravi/allclear --scope user
```

This registers AllClear globally — all your Claude Code sessions will have access to the hooks and commands.

### From Source (development)

For contributing or local development:

```bash
git clone https://github.com/chilleregeravi/allclear.git
cd allclear
git submodule update --init --recursive
npm install

# Option A: Register as a local marketplace plugin
make install

# Option B: Quick test without installing (session only)
claude --plugin-dir /path/to/allclear
```

See [Development](docs/development.md) for testing and contributing.

## What It Does

**Runs automatically (hooks):**
- Auto-format on every edit (Python, Rust, TypeScript, Go)
- Auto-lint with issues surfaced to Claude
- Block writes to `.env`, lock files, credentials
- Session context with project type detection

**On-demand (commands):**
- `/allclear:quality-gate` — lint, format, test, typecheck
- `/allclear:map` — scan repos and build service dependency graph
- `/allclear:cross-impact` — find what breaks when you change something
- `/allclear:drift` — check dependency version alignment across repos
- `/allclear:pulse` — Kubernetes service health check
- `/allclear:deploy-verify` — compare expected vs actual cluster state

**Graph UI (http://localhost:37888):**
- Deterministic layered layout (services, libraries, infrastructure)
- Boundary grouping with labeled boxes
- External actor detection (hexagon nodes)
- Protocol-differentiated edges (solid/dashed/dotted)
- Collapsible filter panel (protocol, layer, boundary, language)
- Click-to-inspect detail panels per node type

## Configuration

Zero-config by default. Optional overrides:

### Project Config: `allclear.config.json`

Lives in your project root. Committed to git.

```json
{
  "linked-repos": [
    "../api",
    "../auth",
    "../sdk"
  ],
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
| `boundaries` | Optional service grouping for the graph UI. Services are enclosed in labeled boxes. |

### Machine Settings: `~/.allclear/settings.json`

Machine-specific settings. Never committed.

```json
{
  "ALLCLEAR_WORKER_PORT": "37888",
  "ALLCLEAR_LOG_LEVEL": "INFO"
}
```

### ChromaDB (optional)

AllClear can sync service graph data to [ChromaDB](https://www.trychroma.com/) for semantic search. This is optional — without it, AllClear falls back to SQLite FTS5 full-text search.

**1. Run ChromaDB locally:**

```bash
# Docker
docker run -p 8000:8000 chromadb/chroma

# Or pip
pip install chromadb
chroma run --host localhost --port 8000
```

**2. Enable in `~/.allclear/settings.json`:**

```json
{
  "ALLCLEAR_CHROMA_MODE": "local",
  "ALLCLEAR_CHROMA_HOST": "localhost",
  "ALLCLEAR_CHROMA_PORT": "8000"
}
```

**3. Re-scan your project:**

```
/allclear:map
```

Findings are synced to ChromaDB automatically after each scan. MCP tools and `/allclear:cross-impact` will use ChromaDB for semantic search when available.

**All ChromaDB settings:**

| Setting | Default | Description |
|---------|---------|-------------|
| `ALLCLEAR_CHROMA_MODE` | _(empty)_ | Set to `"local"` to enable ChromaDB sync |
| `ALLCLEAR_CHROMA_HOST` | `localhost` | ChromaDB server hostname |
| `ALLCLEAR_CHROMA_PORT` | `8000` | ChromaDB server port |
| `ALLCLEAR_CHROMA_SSL` | `false` | Enable HTTPS for ChromaDB connection |
| `ALLCLEAR_CHROMA_API_KEY` | _(empty)_ | API key for authenticated ChromaDB instances |
| `ALLCLEAR_CHROMA_TENANT` | `default_tenant` | ChromaDB tenant ID |
| `ALLCLEAR_CHROMA_DATABASE` | `default_database` | ChromaDB database name |

### Environment Variables

| Variable | Effect |
|----------|--------|
| `ALLCLEAR_DISABLE_FORMAT=1` | Skip auto-formatting |
| `ALLCLEAR_DISABLE_LINT=1` | Skip auto-linting |
| `ALLCLEAR_DISABLE_GUARD=1` | Skip file guard |
| `ALLCLEAR_DISABLE_SESSION_START=1` | Skip session context |

## Documentation

| Doc | Description |
|-----|-------------|
| [Hooks](docs/hooks.md) | Auto-format, auto-lint, file guard, session context |
| [Commands](docs/commands.md) | All slash commands with usage examples |
| [Service Map](docs/service-map.md) | Dependency graph scanning, storage, visualization |
| [Configuration](docs/configuration.md) | Config files, environment variables, settings |
| [Architecture](docs/architecture.md) | Project structure, worker process, MCP server |
| [Development](docs/development.md) | Testing, linting, contributing |

## License

Apache-2.0
