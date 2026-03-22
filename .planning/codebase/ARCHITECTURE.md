# Architecture

**Analysis Date:** 2026-03-22

## Pattern Overview

**Overall:** Multi-layer service discovery and impact analysis platform with agent-driven scanning, persistent storage, REST API, MCP (Model Context Protocol) server, and browser-based visualization UI.

**Key Characteristics:**
- **Agent-driven scanning**: Uses Claude agent to discover services, connections, and data models
- **Per-project database isolation**: Each project root gets isolated SQLite DB hashed to `~/.ligamen/projects/<hash>/impact-map.db`
- **3-tier search fallback**: ChromaDB (semantic) → FTS5 (keyword) → SQL (structured), with independent skip options
- **Dual API layer**: Both REST (for UI) and MCP (for Claude agent integration)
- **Incremental scanning**: Supports full and incremental (diff-based) scanning modes based on repo state
- **Enrichment pipeline**: Post-scan enrichment via registered enricher functions (CODEOWNERS, auth/DB extraction)
- **Transitive impact analysis**: Recursive graph traversal with cycle detection for upstream/downstream impact

## Layers

**CLI & Command Entry Points:**
- Purpose: Accept user commands (`/ligamen:map`, `/ligamen:cross-impact`, `/ligamen:drift`)
- Location: `plugins/ligamen/commands/` (shell-based)
- Contains: Markdown command specs defining prompts for agent
- Depends on: MCP server for agent integration
- Used by: Claude Code when user invokes `/ligamen:*`

**Worker Process:**
- Purpose: Long-running background service exposing REST and MCP APIs
- Location: `plugins/ligamen/worker/`
- Contains: HTTP server, database management, query engine, scanning orchestration
- Depends on: Fastify, better-sqlite3, Model Context Protocol SDK, ChromaDB
- Used by: CLI commands, UI, agent invocations

**Database & Query Layer:**
- Purpose: Persistent storage of service map and transitive impact calculations
- Location: `plugins/ligamen/worker/db/`
- Contains: Database initialization, migrations, query engine with prepared statements
- Key files:
  - `database.js` - DB lifecycle and migrations loader
  - `pool.js` - Per-project DB cache and resolver
  - `query-engine.js` - Graph queries, search, upsert operations
  - `migrations/` - 9 numbered migration files for schema evolution
- Depends on: better-sqlite3, filesystem
- Used by: HTTP routes, MCP server, scanning engine

**HTTP Server & REST API:**
- Purpose: Serve UI static files and expose graph data + scan endpoints
- Location: `plugins/ligamen/worker/server/http.js`
- Contains: Fastify routes for graph retrieval, impact analysis, service details, scan persistence, version history
- Key routes:
  - `GET /api/readiness` - Health check
  - `GET /api/version` - Worker version
  - `GET /projects` - List all project DBs
  - `GET /graph?project=` - Full service dependency graph
  - `GET /impact?change=` - Impacted services for a change
  - `GET /service/:name` - Service details
  - `POST /scan` - Persist scan findings
  - `GET /versions` - Map version snapshots
  - `GET /api/logs` - Tail worker logs
- Depends on: Query engine, filesystem (for logs)
- Used by: UI, scan manager

**MCP Server:**
- Purpose: Integrate impact analysis into Claude agent workflows
- Location: `plugins/ligamen/worker/mcp/server.js`
- Contains: MCP tool definitions for impact queries, search, drift detection
- Depends on: Model Context Protocol SDK, query engine
- Used by: Claude agent when executing commands

**Scanning & Discovery Engine:**
- Purpose: Orchestrate agent-driven discovery and incremental scanning
- Location: `plugins/ligamen/worker/scan/`
- Key modules:
  - `manager.js` - Scan orchestration, mode detection, agent invocation
  - `discovery.js` - Repo detection and configuration management
  - `findings.js` - Findings schema validation and parsing
  - `enrichment.js` - Post-scan enrichment pipeline
  - `codeowners.js` - CODEOWNERS-based ownership extraction
  - `confirmation.js` - User confirmation flow for repo lists
  - `enrichment/auth-db-extractor.js` - Database and auth pattern extraction
- Depends on: Query engine, findings validator, enrichers
- Used by: Agent workflow, MCP server

**Browser UI:**
- Purpose: Visualize service dependency graph and enable impact analysis
- Location: `plugins/ligamen/worker/ui/`
- Contains: Canvas-based force-directed graph visualization + detail panels
- Key modules in `ui/modules/`:
  - `graph.js` - Entry point and project loading
  - `renderer.js` - Canvas rendering with node/edge styling
  - `layout.js` - Force simulation for node positioning
  - `interactions.js` - Click/hover/drag handlers
  - `state.js` - UI state management
  - `detail-panel.js` - Service detail view
  - `filter-panel.js` - Filter/search UI
  - `project-picker.js` - Project selection
  - `project-switcher.js` - Multi-project navigation
  - `keyboard.js` - Keyboard shortcuts
  - `log-terminal.js` - Real-time log viewing
  - `export.js` - Graph export functionality
  - `utils.js` - Shared utilities
- Depends on: HTTP API (/graph, /impact, /service endpoints)
- Used by: Browser when visiting worker URL

**Logging & Observability:**
- Purpose: Structured JSON logging for worker lifecycle and scans
- Location: `plugins/ligamen/worker/lib/logger.js`
- Contains: Level-based structured logger with JSON output
- Depends on: Filesystem
- Used by: All worker modules

## Data Flow

**Scanning Flow (Agent-Driven):**

1. User invokes `/ligamen:map` command
2. CLI loads linked repos from `ligamen.config.json` or discovers new ones
3. Agent (via MCP server) requests scan for each repo
4. `scanRepos()` builds scan context: determines full vs. incremental mode
5. Agent performs discovery pass (Phase 1) — identifies services + connections
6. Agent output parsed into structured findings via `parseAgentOutput()`
7. `persistFindings()` upserts services/connections/fields into DB
8. `runEnrichmentPass()` executes registered enrichers (CODEOWNERS, auth/DB)
9. `endScan()` closes scan version bracket
10. UI receives updated graph via REST API

**Query Flow (Impact Analysis):**

1. UI requests `/graph?project=` with project path
2. HTTP server resolves project hash → opens DB via pool
3. QueryEngine runs recursive CTEs to compute transitive impact
4. Graph data returned with services, connections, mismatch set
5. UI renders force-directed graph with filters and details

**Search Flow (3-Tier):**

1. Query enters `search(text, options)`
2. Tier 1: ChromaDB semantic search (if available and not skipped)
3. Tier 2: FTS5 full-text search across 3 tables (if Tier 1 fails or skipped)
4. Tier 3: SQL exact match on services/connections (fallback)
5. Results ranked by score and returned to caller

**Enrichment Flow:**

1. After service upsert, `runEnrichmentPass(service, db, logger, repoAbsPath)` called
2. For each registered enricher:
   - Enricher receives context: serviceId, repoPath, language, entryFile
   - Enricher returns key→value map
   - Values written to `node_metadata` table with 'enrichment' view
   - Failures logged as warns, never abort scan

**State Management:**

- **DB State**: SQLite database per project; migrations run on first openDb()
- **In-Memory State**: Per-project QueryEngine cached in pool for request lifetime
- **Transient State**: UI state (selected service, filters, zoom level) stored in browser
- **Log State**: Worker logs streamed to `~/.ligamen/logs/worker.log` as JSON lines

## Key Abstractions

**QueryEngine:**
- Purpose: Encapsulates all database queries for graph operations
- File: `plugins/ligamen/worker/db/query-engine.js`
- Pattern: Class wrapping better-sqlite3.Database with prepared statements
- Methods: `getGraph()`, `getImpact()`, `getService()`, `search()`, `persistFindings()`, etc.
- Cycle detection: Transitive queries use path strings to detect cycles: `',' || id || ','`

**Scan Context:**
- Purpose: Determine scan mode (full vs. incremental) and inject constraints
- File: `plugins/ligamen/worker/scan/manager.js`
- Pattern: `buildScanContext(repoPath, repoId, qe, opts) → { mode, constraint?, ...}`
- Modes: 'full', 'incremental', 'incremental-noop'
- Constraint injection (SREL-01): When incremental, appends hard constraint block listing changed files

**Enricher:**
- Purpose: Register and run post-scan metadata extraction
- File: `plugins/ligamen/worker/scan/enrichment.js`
- Pattern: `registerEnricher(name, async (ctx) => ({ key, value }) | null)`
- Context keys: `serviceId`, `repoPath`, `repoAbsPath`, `language`, `entryFile`, `db`, `logger`
- Isolation: Enricher failures caught and logged; never propagate to scan abort

**Findings Schema:**
- Purpose: Validate agent output structure and extract typed data
- File: `plugins/ligamen/worker/scan/findings.js`
- Pattern: `validateFindings(obj) → { valid, findings?, error?, warnings }`
- Validated fields: service_name, services[], connections[], schemas[], confidence

**DB Pool:**
- Purpose: Cache QueryEngine per project root for request lifetime
- File: `plugins/ligamen/worker/db/pool.js`
- Pattern: Module-level `pool: Map<projectRoot, QueryEngine>`
- Methods: `getQueryEngine(projectRoot)`, `getQueryEngineByHash(hash)`, `getQueryEngineByRepo(name)`, `listProjects()`

**Logger:**
- Purpose: Structured JSON logging with component tags
- File: `plugins/ligamen/worker/lib/logger.js`
- Pattern: `createLogger({ dataDir, port?, logLevel, component }) → { log, info, warn, error, debug }`
- Output: JSON lines to `~/.ligamen/logs/worker.log` + stderr

**Repo Discovery:**
- Purpose: Load, discover, and deduplicate repos for scanning
- File: `plugins/ligamen/worker/scan/discovery.js`
- Pattern: Pure functions: `loadFromConfig()`, `discoverNew()`, `deduplicateRepos()`, `saveConfirmed()`

## Entry Points

**Worker Process:**
- Location: `plugins/ligamen/worker/index.js`
- Triggers: `node worker/index.js --port 37888 --data-dir ~/.ligamen`
- Responsibilities:
  1. Parse CLI args (port, data-dir)
  2. Load settings.json for log level and port override
  3. Initialize logger
  4. Initialize ChromaDB if configured
  5. Create and start HTTP server
  6. Write PID file to enable graceful shutdown

**CLI Command: /ligamen:map**
- Location: `plugins/ligamen/commands/map.md`
- Triggers: User enters `/ligamen:map` in Claude Code
- Responsibilities:
  1. Discover/load linked repos
  2. Run discovery pass via agent
  3. Run enrichment pass
  4. Persist findings to DB
  5. Display results

**HTTP GET /graph**
- Location: `plugins/ligamen/worker/server/http.js:92`
- Triggers: UI loads or refreshes
- Responsibilities: Resolve project → fetch full graph → return with boundaries

**HTTP POST /scan**
- Location: `plugins/ligamen/worker/server/http.js:167`
- Triggers: Agent completes scan findings
- Responsibilities: Upsert repo → begin scan → persist findings → end scan

**MCP Tool: impact**
- Location: `plugins/ligamen/worker/mcp/server.js`
- Triggers: Agent or Claude requests impact analysis
- Responsibilities: Query transitive impact graph via QueryEngine

## Error Handling

**Strategy:** Exceptions propagate up; most routes catch and return HTTP error codes. Enrichers silently fail with warning logs.

**Patterns:**

1. **Route-level**: Try/catch in HTTP route handlers, return `code(500).send({ error: msg })`
2. **Enricher-level**: Try/catch in enrichment loop; log warn and continue
3. **DB initialization**: Return null from pool getters on file-not-found; 503 from routes
4. **Scan validation**: `validateFindings()` returns `{ valid: false, error: msg }` — caller checks and throws
5. **Agent invocation**: Scan manager wraps agent runner; if returns null/error, scan aborts with error result

**Failure modes:**

- No DB yet → 503 "No map data yet"
- Corrupt findings JSON → 400 "Invalid findings schema"
- Missing project param → Use fallback to test queryEngine or search env var
- ChromaDB unavailable → Fall through to FTS5 (logged as tier switch)

## Cross-Cutting Concerns

**Logging:**
- Structured JSON via `createLogger()`, bound to component tag
- All worker modules log via injected logger
- Scan manager uses injected logger for lifecycle events
- HTTP routes log errors to separate component: 'http'

**Validation:**
- Input validation at HTTP route handler level (query params, request body)
- Findings validation via schema in `findings.js`
- SQL injection prevention: All DB queries use prepared statements with parameter binding

**Authentication:**
- No authentication in HTTP server (assumes localhost-only dev use)
- MCP server auth: Handled by Claude agent (MCP protocol built-in)
- File permission: PID file, port file, config files rely on OS filesystem permissions

**Database Transactions:**
- Scan lifecycle uses transaction brackets: `beginScan()` → `persistFindings()` → `endScan()`
- If `persistFindings()` throws, `endScan()` NOT called; bracket remains open (signals incomplete scan)
- Enrichers run after `persistFindings()` completes; failures don't roll back findings

**Concurrency:**
- Worker is single-threaded Node.js; HTTP requests processed serially
- DB uses WAL mode for multi-reader concurrency
- Per-project pool caching ensures single QueryEngine instance per project

---

*Architecture analysis: 2026-03-22*
