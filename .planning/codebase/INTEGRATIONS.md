# External Integrations

**Analysis Date:** 2026-03-22

## APIs & External Services

**Claude Code Integration:**
- Claude Code Plugin System - Host for Ligamen plugin
  - SDK: `@modelcontextprotocol/sdk` 1.27.1
  - Integration: Plugin manifest at `plugins/ligamen/.claude-plugin/plugin.json`, hooks at `plugins/ligamen/hooks/hooks.json`
  - Hooks: PostToolUse (format/lint), PreToolUse (file guard), SessionStart (deps install)

**Anthropic/Claude-specific:**
- Claude Task Runner - Used by `plugins/ligamen/worker/scan/manager.js` to invoke background agents
  - Auth: Implicit via Claude Code context
  - Constraint: Background agents cannot access MCP tools per Claude Code limitation

## Data Storage

**Databases:**
- SQLite 3 - Primary persistent storage
  - Client: `better-sqlite3` 12.8.0 (synchronous)
  - Connection: `~/.ligamen/projects/<hash>/impact-map.db`
  - Features: WAL mode for concurrent reads, FTS5 keyword search, VACUUM INTO snapshots

**Vector Search (Optional):**
- ChromaDB - Optional semantic search layer for service discovery
  - Client: `chromadb` 3.3.3 (Node.js client)
  - Connection: Configured via `LIGAMEN_CHROMA_MODE`, `LIGAMEN_CHROMA_HOST`, `LIGAMEN_CHROMA_PORT`
  - Auth: Optional Bearer token via `LIGAMEN_CHROMA_API_KEY`
  - Multi-tenant: Supports `LIGAMEN_CHROMA_TENANT` and `LIGAMEN_CHROMA_DATABASE`
  - Embeddings: Optional `@chroma-core/default-embed` 1.0.0 for vector generation
  - Fallback: Non-blocking — if ChromaDB unavailable, falls back to FTS5 then SQL
  - Collection: `ligamen-impact` — stores service names and endpoint paths

**File Storage:**
- Local filesystem only
  - User data: `~/.ligamen/` directory (machine-wide)
  - Per-project data: `~/.ligamen/projects/<hash>/`
  - Logs: `~/.ligamen/logs/worker.log`
  - PID/port files: `~/.ligamen/worker.pid`, `~/.ligamen/worker.port`

**Caching:**
- None — SQLite handles query caching via PRAGMA cache_size
- ChromaDB collection kept in memory after initialization

## Authentication & Identity

**Auth Provider:**
- Custom — No external auth provider
- Implementation:
  - Claude Code plugin system manages authentication implicitly
  - MCP server access is implicit via Claude Code context
  - Settings stored locally in `~/.ligamen/settings.json` (unencrypted JSON)
  - Optional ChromaDB Bearer token stored in settings

**Credentials:**
- No user credentials handled
- Optional `LIGAMEN_CHROMA_API_KEY` stored in `~/.ligamen/settings.json`
- File guard prevents accidental writes to `.env` and credential files

## Monitoring & Observability

**Error Tracking:**
- None — All errors logged locally

**Logs:**
- Structured JSON logging to `~/.ligamen/logs/worker.log`
- Log levels: DEBUG, INFO, WARN, ERROR
- Configurable via `LIGAMEN_LOG_LEVEL` environment variable
- Logs include: timestamp, level, message, PID, port (if applicable), component tag (worker/http/mcp/scan)

**Heartbeat & Health:**
- Worker exposes `/api/version` HTTP endpoint for version checks
- Worker writes PID and port files at startup for process discovery
- ChromaDB health checked via `heartbeat()` call at initialization
- Connection errors logged but never block worker startup

## CI/CD & Deployment

**Hosting:**
- Developer's local machine running Claude Code
- No cloud/server deployment required
- Worker runs as background daemon (spawned by `plugins/ligamen/scripts/worker-start.sh`)

**Installation:**
- Claude Code plugin system (`claude plugin install`)
- Marketplace registration via `ligamen.config.json` and plugin.json
- Runtime dependencies auto-installed via `plugins/ligamen/scripts/install-deps.sh` on SessionStart hook

**Version Management:**
- Package version defined in `plugins/ligamen/package.json` (5.4.0)
- Version mismatch detection: worker checks installed vs running version and restarts if different
- Version endpoint: `GET /api/version` returns `{ version: string }`

## Environment Configuration

**Required Environment Variables:**
- None (all optional with sensible defaults)

**Optional Environment Variables:**
- `LIGAMEN_DATA_DIR` - Override `~/.ligamen` (default: `$HOME/.ligamen`)
- `LIGAMEN_LOG_LEVEL` - Log level (default: INFO)
- `LIGAMEN_WORKER_PORT` - Worker HTTP port (default: 37888)
- `LIGAMEN_PROJECT_ROOT` - MCP server fallback project root
- `LIGAMEN_DB_PATH` - MCP server fallback database path
- `LIGAMEN_CHROMA_MODE` - Enable ChromaDB ('local' or empty)
- `LIGAMEN_CHROMA_HOST` - ChromaDB host (default: localhost)
- `LIGAMEN_CHROMA_PORT` - ChromaDB port (default: 8000)
- `LIGAMEN_CHROMA_SSL` - Use HTTPS for ChromaDB ('true')
- `LIGAMEN_CHROMA_API_KEY` - ChromaDB Bearer token
- `LIGAMEN_CHROMA_TENANT` - ChromaDB tenant (default: default_tenant)
- `LIGAMEN_CHROMA_DATABASE` - ChromaDB database (default: default_database)

**Secrets Location:**
- `~/.ligamen/settings.json` - Machine-wide configuration (plaintext JSON)
- `LIGAMEN_CHROMA_API_KEY` stored here if ChromaDB enabled
- File guard prevents commits of `.env` and `*credentials*` files

## Webhooks & Callbacks

**Incoming:**
- None

**Outgoing:**
- None — Ligamen is read-only by design for the graph/search layer
- Scanning phase uses Claude Task runner for agent invocation (async callback pattern)

## External Dependencies - Detail

**D3.js (Graph Visualization):**
- Version: 3.x
- Source: CDN (cdn.jsdelivr.net/npm/d3-force@3/+esm)
- Used in: `plugins/ligamen/worker/ui/force-worker.js`
- Purpose: Force-directed graph layout and physics simulation

**Node.js Built-in Modules:**
- better-sqlite3 for synchronous database access
- child_process module for shell command execution (format/lint)
- fs, path, os, crypto for filesystem and utility operations

---

*Integration audit: 2026-03-22*
