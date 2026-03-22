# Technology Stack

**Analysis Date:** 2026-03-22

## Languages

**Primary:**
- JavaScript (ES modules) - Main plugin and worker code
- Shell Script (Bash) - CLI automation and hooks

**Secondary:**
- HTML - UI templates for graph visualization
- SQL - SQLite database schema and migrations

## Runtime

**Environment:**
- Node.js 20.0.0 or higher

**Package Manager:**
- npm
- Lockfile: `package-lock.json` (present)

## Frameworks

**Core:**
- Fastify 5.8.2 - HTTP REST server for worker process and graph UI
- Model Context Protocol (MCP) SDK 1.27.1 - Cross-agent tool exposure for Claude integration

**Web UI:**
- D3.js 3 (via CDN) - Force-directed graph simulation and visualization
- Vanilla JavaScript/Canvas - Interactive graph rendering and interactions

**Testing:**
- Node.js built-in test runner (`node --test`) - Configured in `package.json` via `test:storage` script
- Test files use synchronous database queries for snapshot testing

**Build/Dev:**
- Zod 3.25.0 - Runtime schema validation for tool parameters and config
- Better-sqlite3 12.8.0 - Synchronous SQLite database access
- picomatch 4.0.3 - Glob pattern matching for file exclusion/inclusion

## Key Dependencies

**Critical:**
- `better-sqlite3` 12.8.0 - Synchronous SQLite database client for deterministic query results
- `@modelcontextprotocol/sdk` 1.27.1 - MCP server/transport for Claude integration
- `fastify` 5.8.2 - Lightweight HTTP framework hosting REST API and graph UI
- `chromadb` 3.3.3 - Optional vector database for semantic search (non-blocking fallback)

**Infrastructure:**
- `@fastify/cors` 10.0.0 - CORS middleware for cross-origin graph UI requests
- `@fastify/static` 8.0.0 - Static file serving for HTML/CSS/JS graph UI
- `zod` 3.25.0 - Schema validation for MCP tool parameters
- `@chroma-core/default-embed` 1.0.0 - Optional embeddings for ChromaDB (only if ChromaDB enabled)

## Configuration

**Environment:**
- Machine-wide settings stored in `~/.ligamen/settings.json` (read at startup)
- Per-project data stored in `~/.ligamen/projects/<hash>/` (one per linked repository)
- Optional ChromaDB configuration loaded from settings at worker startup

**Key Configuration Variables:**
- `LIGAMEN_DATA_DIR` - Override default `~/.ligamen` data directory
- `LIGAMEN_LOG_LEVEL` - Set worker/MCP log verbosity (DEBUG/INFO/WARN/ERROR)
- `LIGAMEN_WORKER_PORT` - Override default worker port 37888
- `LIGAMEN_CHROMA_MODE` - Enable ChromaDB ('local' or empty for disabled)
- `LIGAMEN_CHROMA_HOST` - ChromaDB hostname (default: localhost)
- `LIGAMEN_CHROMA_PORT` - ChromaDB port (default: 8000)
- `LIGAMEN_CHROMA_SSL` - Use HTTPS for ChromaDB ('true' or empty)
- `LIGAMEN_CHROMA_API_KEY` - Bearer token for ChromaDB authentication
- `LIGAMEN_CHROMA_TENANT` - ChromaDB tenant name (default: default_tenant)
- `LIGAMEN_CHROMA_DATABASE` - ChromaDB database name (default: default_database)

**Build:**
- No build step required — runs as ES modules directly
- `hooks.json` at `plugins/ligamen/hooks/hooks.json` defines Claude Code session hooks

## Platform Requirements

**Development:**
- Node.js 20.0.0+
- bash (for plugin installation and session hooks)
- jq (optional, for settings inspection in scripts)
- curl (optional, for version checks via HTTP API)

**Production (Claude Code Integration):**
- Deployment target: Claude Code plugin system
- Worker runs as background daemon process on developer's machine
- Exposes HTTP API on localhost (default port 37888)
- Optional ChromaDB instance (if semantic search enabled)

## Database

**Storage:**
- SQLite 3 with WAL mode for concurrent read access
- Location: `~/.ligamen/projects/<sha256(projectRoot).slice(0,12)>/impact-map.db`
- Per-project database — one DB per linked repository

**Schema Migrations:**
- 9 migrations in `plugins/ligamen/worker/db/migrations/` (001–009)
- Applied automatically on database open via `database.js`
- Covers: services, connections, exposed endpoints, deduplication, scan versioning, confidence enrichment

---

*Stack analysis: 2026-03-22*
