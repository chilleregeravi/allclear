# External Integrations

**Analysis Date:** 2026-03-18

## APIs & External Services

**Claude Code Plugin:**
- Claude Code IDE - Primary consumer of AllClear functionality
  - SDK: Custom hook protocol (PostToolUse, PreToolUse, SessionStart, UserPromptSubmit)
  - Integration: Hooks defined in `hooks/hooks.json`, invoked by Claude Code when file ops trigger

**Model Context Protocol (MCP):**
- Claude AI agents - Can invoke AllClear tools via MCP interface
  - SDK: `@modelcontextprotocol/sdk` 1.27.1
  - Transport: Stdio (process communication)
  - Server: `worker/mcp/server.js`
  - Tools exposed: Graph queries, impact analysis, configuration (5+ tools via MCP)

## Data Storage

**Databases:**
- SQLite 3 (better-sqlite3 driver)
  - Connection: `~/.allclear/projects/<project-hash>/impact-map.db`
  - Client: `better-sqlite3` 12.8.0 (native bindings)
  - Features: WAL mode, FTS5 full-text search, 7+ migrations
  - Schema: Service graph (nodes, edges), findings, external endpoints, deduplication tracking

**Vector Database (Optional):**
- ChromaDB 3.3.3
  - Connection: `localhost:8000` (configurable via `ALLCLEAR_CHROMA_HOST`, `ALLCLEAR_CHROMA_PORT`)
  - Auth: Optional API key (`ALLCLEAR_CHROMA_API_KEY`)
  - Purpose: Semantic search over findings (non-blocking fallback to FTS5)
  - Mode: Configurable via `ALLCLEAR_CHROMA_MODE` setting

**File Storage:**
- Local filesystem only - No cloud storage
  - Data directory: `~/.allclear/` (configurable via `ALLCLEAR_DATA_DIR`)
  - Per-project structure: `projects/<sha256-hash>/`
  - Snapshots: Version history stored in same directory

**Caching:**
- In-memory pool in `worker/db/pool.js`
  - Per-project database handles cached in worker memory
  - No external cache system

## Authentication & Identity

**Auth Provider:**
- No external auth required
- Plugin runs as authenticated Claude Code user (implicit)
- MCP stdio authentication: Implicit via process lifecycle
- Optional ChromaDB API key: `ALLCLEAR_CHROMA_API_KEY` (passed via settings)

## Monitoring & Observability

**Error Tracking:**
- None (no external error service)

**Logs:**
- Local file logging to `~/.allclear/logs/` directory
  - Format: Structured JSON logs with timestamps
  - Components: worker, http, mcp, scan
  - Log level configurable via `ALLCLEAR_LOG_LEVEL` in settings
  - Files: `worker.log` created via `nohup` in `worker-start.sh`

**Health Checks:**
- Internal: GET `/api/readiness` (always returns 200)
- Version check: GET `/api/version` (for auto-restart on mismatch)

## CI/CD & Deployment

**Hosting:**
- Plugin distribution: GitHub releases (https://github.com/AetherHQ/allclear)
- Installation: npm global or local to Claude Code plugin directory
- Worker deployment: Managed by plugin (auto-starts on demand)

**CI Pipeline:**
- None detected in codebase (no GitHub Actions, Jenkins, CircleCI config)
- Testing: Manual via `npm run test:storage` or shell tests

## Environment Configuration

**Required env vars:**
- None (all defaults functional)

**Optional env vars (machine-wide settings preferred):**
- `ALLCLEAR_DATA_DIR` - Override default `~/.allclear` location
- `ALLCLEAR_WORKER_PORT` - Override default 37888
- `ALLCLEAR_LOG_LEVEL` - Set verbosity (INFO, DEBUG)
- `ALLCLEAR_CHROMA_MODE` - Enable ChromaDB ("local" or empty)
- `ALLCLEAR_CHROMA_HOST` - ChromaDB server hostname (default: localhost)
- `ALLCLEAR_CHROMA_PORT` - ChromaDB server port (default: 8000)
- `ALLCLEAR_CHROMA_SSL` - Enable HTTPS for ChromaDB (default: false)
- `ALLCLEAR_CHROMA_API_KEY` - API key for ChromaDB authentication
- `ALLCLEAR_CHROMA_TENANT` - ChromaDB tenant ID (default: default_tenant)
- `ALLCLEAR_CHROMA_DATABASE` - ChromaDB database name (default: default_database)

**Hook control env vars:**
- `ALLCLEAR_DISABLE_FORMAT=1` - Skip auto-format hook
- `ALLCLEAR_DISABLE_LINT=1` - Skip auto-lint hook
- `ALLCLEAR_DISABLE_GUARD=1` - Skip file guard hook
- `ALLCLEAR_DISABLE_SESSION_START=1` - Skip session context hook
- `ALLCLEAR_LINT_THROTTLE=<seconds>` - Delay before re-running Rust linter (default: 30)
- `ALLCLEAR_EXTRA_BLOCKED=<patterns>` - Colon-separated glob patterns to block (file guard)

**Secrets location:**
- Environment variables (process.env)
- `~/.allclear/settings.json` (machine-local, never committed)
- Env file not used (no .env pattern in codebase)

## Webhooks & Callbacks

**Incoming:**
- None (this is a pull-based system)

**Outgoing:**
- None detected

## Integration Points

**Claude Code Hook Events:**
- `PostToolUse` (Write/Edit/MultiEdit) → format.sh → lint.sh
- `PreToolUse` (Write/Edit/MultiEdit) → file-guard.sh
- `SessionStart` → session-start.sh (project detection)
- `UserPromptSubmit` → session-start.sh (context reload)

**Worker HTTP API Routes:**
- GET `/api/readiness` - Health check
- GET `/api/version` - Worker version
- GET `/graph?hash=<project-hash>` - Graph visualization data
- GET `/api/search?q=<query>&limit=<n>` - Impact search (FTS5 or ChromaDB)
- GET `/api/logs?component=<filter>` - Streaming logs
- GET `/projects` - List available projects
- Other internal routes per Fastify registration

**External Tool Invocations:**
- `prettier` - Auto-format (if installed)
- `eslint` / `biome` - Linting (if installed)
- `cargo clippy` - Rust linting (if in Rust project)
- `git` - Version control queries
- `jq` - JSON parsing in shell scripts
- Language-specific formatters/linters detected per-project type

---

*Integration audit: 2026-03-18*
