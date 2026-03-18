# Architecture

**Analysis Date:** 2026-03-18

## Pattern Overview

**Overall:** Distributed multi-tier agent-driven scanning system with persistent storage and web visualization.

**Key Characteristics:**
- **Project-agnostic worker:** Single long-lived worker service handles multiple projects via per-project databases
- **Agent-driven scanning:** Claude agents analyze code to extract services and connections; findings are validated and persisted
- **Layered storage:** SQLite database with migration system; optional ChromaDB semantic search overlay; FTS5 keyword fallback
- **Stateless HTTP layer:** Fastify REST API for graph queries, project listing, and UI serving
- **MCP protocol server:** Exposes tools for agents to search impact data and trigger scans
- **Interactive web UI:** Canvas-based force-directed graph visualization with detail panels

## Layers

**CLI Entry Point:**
- Purpose: Parse command arguments, start services, orchestrate scans
- Location: `bin/allclear-init.js`, `/commands/` documentation
- Contains: Command handlers for quality-gate, map, drift, impact, pulse, deploy-verify
- Depends on: Shell utilities (`lib/*.sh`), agent invocation
- Used by: User via Claude Code plugin or direct shell invocation

**Worker Process:**
- Purpose: Long-running HTTP server + MCP service for all projects
- Location: `worker/index.js`
- Contains: HTTP server initialization, database pool, logger setup, graceful shutdown
- Depends on: `worker/server/http.js`, `worker/db/pool.js`, `worker/mcp/server.js`
- Used by: All requests from UI, agents, and external tools

**HTTP Server Layer:**
- Purpose: REST API and static file serving
- Location: `worker/server/http.js`
- Contains: Fastify routes for readiness checks, project listing, graph queries, FTS search, impact queries
- Depends on: Database pool, query engine, logger
- Used by: UI frontend, external HTTP clients

**Scanning & Agent Invocation:**
- Purpose: Orchestrate multi-repo scanning, validate findings, persist results
- Location: `worker/scan/manager.js`, `worker/scan/findings.js`, `worker/scan/confirmation.js`
- Contains: Repo type detection, scan context building, agent runner injection, findings schema validation
- Depends on: Git operations, query engine, findings parser
- Used by: `/allclear:map` command, agent-invoked repeatedly for each repo

**Database & Query Layer:**
- Purpose: Store and retrieve service graph, handle migrations, provide search
- Location: `worker/db/` (database.js, pool.js, query-engine.js, migrations/)
- Contains: SQLite initialization, per-project DB pooling, transitive impact calculation, FTS5/ChromaDB search
- Depends on: better-sqlite3, ChromaDB client (optional), zod for validation
- Used by: HTTP routes, agent confirmation, UI graph rendering

**MCP Server:**
- Purpose: Protocol channel for agents to call tools
- Location: `worker/mcp/server.js`
- Contains: Tool registration, input validation, project resolution, agent runner injection
- Depends on: MCP SDK, query engine, scan manager
- Used by: Agents running in Claude Code context

**UI Layer:**
- Purpose: Interactive visualization of service dependency graph
- Location: `worker/ui/` (index.html, graph.js, modules/*)
- Contains: Canvas-based force simulation, project picker, detail panels, log terminal
- Depends on: Force simulation worker, server REST API
- Used by: User interaction in browser

**Persistence & State:**
- Purpose: Manage per-project databases and settings
- Location: `~/.allclear/` (projects/, settings.json, logs/, worker.pid, worker.port)
- Contains: SQLite DBs per project, logs, configuration
- Depends on: Worker process, migration system
- Used by: All layers for reading/writing project state

## Data Flow

**Scan Workflow:**

1. User invokes `/allclear:map` → command handler reads linked-repos.config or parent directory discovery
2. Command handler invokes agent runner with list of repos
3. Agent analyzes each repo code (services, endpoints, connections) → outputs fenced JSON findings
4. `worker/scan/findings.js` validates output against schema
5. `worker/scan/confirmation.js` presents findings to user for approval
6. Approved findings passed to `worker/db/database.js::writeScan()` → upserts into services, connections, schemas tables
7. Scan version recorded for incremental updates
8. Worker logs events to `~/.allclear/logs/`

**Graph Query Workflow:**

1. UI loads at `http://localhost:PORT`
2. GET `/projects` → list all project DBs from `~/.allclear/projects/`
3. User picks project hash
4. GET `/graph?hash=<hash>` → `query-engine.js` fetches services, connections, mismatches
5. UI receives JSON, maps to nodes/edges, starts force simulation in Web Worker
6. User clicks node → detail panel loads via `detail-panel.js`
7. GET `/endpoint-schema?service_id=...` → query engine returns schema fields

**Impact Query Workflow:**

1. Agent or external tool calls MCP tool: `impact(service, direction, transitive)`
2. MCP server resolves project via env or parameter
3. `query-engine.js::queryImpact()` traverses connections with cycle detection
4. Returns downstream/upstream services and breaking change classifications
5. Tool output returned to caller

**Search Workflow (3-tier fallback):**

1. UI or MCP tool calls search endpoint
2. Tier 1: If ChromaDB available → semantic search via embeddings
3. Tier 2: If ChromaDB unavailable → FTS5 keyword search on services, connections, schemas
4. Tier 3: If FTS5 fails → simple SQL LIKE queries
5. Results ranked by score and type

**State Management:**

- **Current project:** Stored in `state.currentProject` (UI module/state.js)
- **Graph positions:** Computed in-memory by force-worker.js, never persisted
- **Scan status:** Stored in `scan_versions` table with repo ID and timestamp
- **Settings:** Read from `~/.allclear/settings.json` at worker startup
- **Logs:** Streamed to per-day files in `~/.allclear/logs/`

## Key Abstractions

**QueryEngine:**
- Purpose: Encapsulates all database queries behind a clean API
- Examples: `worker/db/query-engine.js` (class definition ~900 lines)
- Pattern: Class with methods for impact, search, upsert; uses prepared statements for efficiency

**Findings Schema:**
- Purpose: Validate agent output against expected structure
- Examples: `worker/scan/findings.js` (exports validateFindings, parseAgentOutput)
- Pattern: Declarative field lists (service_name, services[], connections[]) with confidence and evidence requirements

**Project Pool:**
- Purpose: Cache QueryEngine instances per project root
- Examples: `worker/db/pool.js` (Map<projectRoot, QueryEngine>)
- Pattern: Lazy initialization on first access; null if DB doesn't exist; hashes long paths for directory names

**MCP Tool Resolver:**
- Purpose: Map project identifiers (path/hash/name) to QueryEngine
- Examples: `worker/mcp/server.js::resolveDb()`
- Pattern: Multi-branch dispatch (absolute path → hash → repo name); uses same pool as HTTP layer

**Force Simulation Worker:**
- Purpose: Offload physics computation from main thread
- Examples: `worker/ui/force-worker.js`
- Pattern: Web Worker running independent d3-force simulation; sends tick events with updated positions

## Entry Points

**HTTP Server:**
- Location: `worker/index.js` (lines 1-103)
- Triggers: `node worker/index.js --port 37888 --data-dir ~/.allclear`
- Responsibilities: Parse CLI args, setup logging, initialize ChromaDB, create Fastify server, listen on port, cleanup on SIGTERM/SIGINT

**MCP Server:**
- Location: `worker/mcp/server.js` (shebang: `#!/usr/bin/env node`)
- Triggers: Spawned by Claude Code when plugin initializes; inherits stdio transport
- Responsibilities: Register tools, handle stdin, route tool calls to handlers, write responses to stdout

**Scan Manager:**
- Location: `worker/scan/manager.js::scanRepos(repoPaths, options, queryEngine)`
- Triggers: Called from `/allclear:map` command handler after user confirms repos
- Responsibilities: Detect repo types, build scan context (changed files / full), invoke agents, validate findings, upsert to DB

**UI Initialization:**
- Location: `worker/ui/graph.js::loadProject(hash, canvas)`
- Triggers: User selects project from picker or switches via switcher
- Responsibilities: Fetch graph data, map to UI shape, initialize force worker, setup interaction handlers

## Error Handling

**Strategy:** Multi-level fallback with logged errors; graceful degradation prioritized over failure.

**Patterns:**

- **Database fallback:** If DB doesn't exist, return null; HTTP returns 503 with guidance
- **ChromaDB fallback:** If unavailable at startup, log and continue; search downgrades to FTS5
- **FTS5 fallback:** If FTS5 fails, query engine downgrades to SQL LIKE
- **Migration errors:** Logged to stderr and file; scan continues but may fail later
- **Agent timeout:** Parent command waits N seconds; timeout triggers user prompt for retry
- **Invalid findings:** Validator logs specific errors (missing fields, invalid protocols); findings rejected but scan continues
- **Network errors:** HTTP layer returns 500 with error message; UI shows "Cannot reach server"

## Cross-Cutting Concerns

**Logging:**
- Framework: Custom structured logger in `worker/lib/logger.js` (exports createLogger)
- Usage: Injected into worker, HTTP server, scan manager, MCP server; writes to `~/.allclear/logs/<date>_<component>.log`
- Format: JSON lines (timestamp, level, message, component, extra fields)

**Validation:**
- Schema validation: `worker/scan/findings.js` for agent output; `worker/db/query-engine.js` for upsert operations
- Framework: Zod in package.json (optional but used in MCP tool schemas)
- Pattern: Parse/validate/reject with detailed error messages; never silently drop invalid data

**Authentication:**
- Strategy: None at worker/HTTP layer; assumes localhost-only or VPN access
- CORS: Restricted to `http://localhost:5173`, `127.0.0.1:*` (for dev)
- MCP: No auth; runs in Claude Code process with user's privileges

**Transactions:**
- Pattern: Individual prepared statements for reads; batch upserts in writeScan use SQLite transactions
- Example: `worker/db/database.js::writeScan()` wraps multiple INSERT/UPDATE in transaction

**Concurrency:**
- SQLite WAL mode enabled (`pragma journal_mode = WAL`)
- Per-project pools prevent concurrent access to same DB
- UI force simulation runs in Web Worker (separate thread)
- Worker process is single-threaded Node.js; handles requests sequentially

---

*Architecture analysis: 2026-03-18*
