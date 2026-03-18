# Technology Stack

**Analysis Date:** 2026-03-18

## Languages

**Primary:**
- JavaScript (Node.js) - Worker daemon, MCP server, HTTP API, CLI tools
- Bash (POSIX shell) - Hook implementations, scripts, version detection

**Secondary:**
- HTML5 - Graph visualization UI (zero build step)
- JSON - Configuration and data interchange

## Runtime

**Environment:**
- Node.js 20.0.0 or higher (specified in `package.json` engines)

**Package Manager:**
- npm - Manages dependencies and lockfile
- Lockfile: `package-lock.json` (present, committed)

## Frameworks

**Core:**
- Fastify 5.8.2 - HTTP server for REST API and static file serving
- @modelcontextprotocol/sdk 1.27.1 - MCP (Model Context Protocol) server for Claude agent integration
- better-sqlite3 12.8.0 - SQLite driver for impact-map database (Native C++ bindings for performance)

**Testing:**
- Node.js built-in `node --test` - Native test runner (used in `tests/storage/query-engine.test.js`)

**Build/Dev:**
- None detected - Project is zero-build: Bash scripts, Node.js as-is ESM, HTML served directly

## Key Dependencies

**Critical:**
- `better-sqlite3` 12.8.0 - SQLite database access with WAL mode support. Powers all impact-map queries and persistence.
- `@modelcontextprotocol/sdk` 1.27.1 - Enables MCP protocol for Claude agent communication. Provides stdio server transport for structured tool calling.
- `fastify` 5.8.2 - HTTP server framework. Handles graph queries, UI serving, project resolution per-request.
- `chromadb` 3.3.3 - Optional vector search database for semantic graph queries. Fire-and-forget sync with FTS5 fallback.

**Infrastructure:**
- `@fastify/cors` 10.0.0 - CORS middleware for localhost dev (enables http://localhost:5173, http://127.0.0.1:*)
- `@fastify/static` 8.0.0 - Static file serving for worker UI (`worker/ui/` directory)
- `zod` 3.25.0 - Schema validation for MCP tool schemas and configuration parsing
- `@chroma-core/default-embed` 1.0.0 (optional) - Default embedding model for ChromaDB vector storage

## Configuration

**Environment:**
- Machine-level: `~/.allclear/settings.json` - Log level, port, ChromaDB connection params, data directory
- Project-level: `allclear.config.json` - Linked repos, impact-map history flag
- Environment variables: `ALLCLEAR_DISABLE_FORMAT`, `ALLCLEAR_DISABLE_LINT`, `ALLCLEAR_DISABLE_GUARD`, `ALLCLEAR_LOG_LEVEL`, `ALLCLEAR_CHROMA_MODE`, `ALLCLEAR_DATA_DIR`

**Build:**
- No build configuration required
- Entry points:
  - `worker/index.js` - Main worker process (Node.js background daemon)
  - `worker/mcp/server.js` - MCP stdio server
  - Script wrappers in `scripts/` directory are shell wrappers that invoke worker or external tools

## Platform Requirements

**Development:**
- Node.js >= 20.0.0
- Bash (POSIX-compatible shell)
- jq (for configuration parsing in shell scripts)
- SQLite3 (native library bundled with better-sqlite3)

**Production:**
- Deployment target: Any system with Node.js 20+ (macOS, Linux, Windows via WSL)
- Worker runs as background daemon at port 37888 (configurable)
- Data persisted to `~/.allclear/` directory
- No external cloud dependency required (ChromaDB is optional)

---

*Stack analysis: 2026-03-18*
