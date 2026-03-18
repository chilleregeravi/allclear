# Codebase Structure

**Analysis Date:** 2026-03-18

## Directory Layout

```
allclear/
├── .planning/                    # GSD planning and codebase docs
├── .claude-plugin/               # Claude Code plugin metadata
├── bin/                          # CLI entry points (empty — deprecated)
├── commands/                     # Command handler documentation
│   ├── quality-gate.md          # /allclear:quality-gate command spec
│   ├── map.md                   # /allclear:map (scan) command spec
│   ├── cross-impact.md          # Cross-repo impact analysis command
│   ├── deploy-verify.md         # Deployment verification
│   ├── drift.md                 # Type/API drift detection
│   └── pulse.md                 # Health check aggregation
├── docs/                         # User documentation
├── hooks/                        # Git hooks and CLI hooks (shell scripts)
│   ├── config.sh               # Hook configuration
│   ├── detect.sh               # Project type detection
│   ├── linked-repos.sh         # Discover linked repos
│   └── worker-client.sh        # Worker process communication
├── lib/                         # Shared utilities (shell scripts)
│   ├── config.sh               # Configuration helpers
│   ├── detect.sh               # Project detection
│   ├── linked-repos.sh         # Repo discovery
│   └── worker-client.sh        # Worker IPC
├── node_modules/                # Dependencies
├── plugins/                      # Claude Code plugin symlink
│   └── allclear -> /path/to/allclear (symlink for local dev)
├── scripts/                      # Operational scripts (shell)
│   ├── worker-start.sh          # Start worker process
│   ├── worker-stop.sh           # Stop worker process
│   ├── mcp-wrapper.sh           # MCP server wrapper
│   ├── format.sh                # Code formatting orchestration
│   ├── lint.sh                  # Linting orchestration
│   ├── session-start.sh         # Claude Code session initialization
│   ├── file-guard.sh            # Pre-commit file guard
│   ├── impact.sh                # Impact query script
│   ├── pulse-check.sh           # Health check script
│   ├── drift-common.sh          # Shared drift detection
│   ├── drift-types.sh           # Type signature drift
│   ├── drift-versions.sh        # Version compatibility drift
│   └── drift-openapi.sh         # OpenAPI spec drift
├── skills/                       # Agent skill definitions (stub directory)
│   ├── impact/                  # Impact analysis skill
│   └── quality-gate/            # Quality gate skill
├── tests/                        # Test suite
│   ├── bats/                    # Bash Automated Test System (shell integration tests)
│   ├── ui/                      # UI rendering tests (browser/canvas tests)
│   ├── storage/                 # Database and query engine tests
│   └── worker/                  # Worker process and logging tests
├── worker/                       # Main worker service (Node.js)
│   ├── index.js                # Worker main entry point
│   ├── db/                      # Database layer
│   │   ├── database.js         # DB initialization and migrations
│   │   ├── pool.js             # Per-project QueryEngine caching
│   │   ├── query-engine.js     # Query interface and business logic (900+ lines)
│   │   ├── migrations/         # Schema migration modules (versions 1-7)
│   │   └── *.test.js           # Database layer tests
│   ├── server/                  # HTTP server and integrations
│   │   ├── http.js             # Fastify server and REST routes
│   │   ├── chroma.js           # ChromaDB integration (semantic search)
│   │   └── *.test.js           # Server tests
│   ├── scan/                    # Agent scanning orchestration
│   │   ├── manager.js          # Scan workflow, agent invocation
│   │   ├── findings.js         # Findings schema validation
│   │   ├── discovery.js        # Repo discovery and git operations
│   │   ├── confirmation.js     # User confirmation prompts
│   │   └── *.test.js           # Scan layer tests
│   ├── mcp/                     # Model Context Protocol server
│   │   ├── server.js           # MCP tool handlers and registration
│   │   └── *.test.js           # MCP tests
│   ├── ui/                      # Web UI (frontend)
│   │   ├── index.html          # Main HTML page
│   │   ├── graph.js            # Graph initialization and orchestration
│   │   ├── force-worker.js     # Web Worker for force simulation
│   │   ├── modules/            # UI component modules
│   │   │   ├── state.js       # Shared UI state
│   │   │   ├── renderer.js    # Canvas rendering
│   │   │   ├── interactions.js# Node/edge click handlers
│   │   │   ├── detail-panel.js# Service detail panel
│   │   │   ├── project-picker.js      # Project selection dropdown
│   │   │   ├── project-switcher.js    # Runtime project switching
│   │   │   ├── log-terminal.js       # Scan log streaming
│   │   │   ├── utils.js              # Utility functions
│   │   │   └── *.test.js            # UI module tests
│   └── lib/                     # Shared utilities (Node.js)
│       └── logger.js           # Structured logging
├── package.json                 # Node.js dependencies
├── README.md                    # Project overview
└── .gitignore                   # VCS exclusions
```

## Directory Purposes

**`.planning/codebase/`:**
- Purpose: GSD (Golden Section Design) codebase analysis documents
- Contains: ARCHITECTURE.md, STRUCTURE.md, CONVENTIONS.md, TESTING.md, CONCERNS.md
- Key files: None (read-only generated docs)

**`commands/`:**
- Purpose: Command handler specifications (read by Claude Code plugin)
- Contains: Markdown files defining behavior for /allclear:* commands
- Key files: `quality-gate.md`, `map.md` (primary commands)

**`lib/` (shell scripts):**
- Purpose: Shared shell utilities for CLI and hooks
- Contains: Project detection, repo discovery, worker communication
- Key files: `detect.sh` (project type), `linked-repos.sh` (repo enumeration)

**`scripts/`:**
- Purpose: Operational automation (start/stop, hooks, scanning)
- Contains: Worker lifecycle, formatting/linting dispatch, drift detection
- Key files: `worker-start.sh`, `mcp-wrapper.sh`, `format.sh`, `lint.sh`

**`tests/`:**
- Purpose: Comprehensive test coverage
- Contains: Integration tests (BATS), storage layer tests, UI tests
- Key files: `tests/storage/query-engine.test.js`, `tests/ui/` suite

**`worker/`:**
- Purpose: Main service — long-running Node.js process
- Contains: HTTP API, MCP server, scanning orchestration, database, UI
- Key files: `index.js` (entry point), `db/query-engine.js` (core logic), `ui/graph.js` (UI orchestration)

**`worker/db/`:**
- Purpose: Persistence layer
- Contains: SQLite setup, migration system, query builder, per-project pooling
- Key files: `query-engine.js` (900+ lines, all read/write queries), `pool.js` (project isolation), `database.js` (schema)

**`worker/server/`:**
- Purpose: HTTP REST API and external integrations
- Contains: Fastify routes, ChromaDB client, request/response handling
- Key files: `http.js` (all REST endpoints), `chroma.js` (semantic search)

**`worker/scan/`:**
- Purpose: Agent-driven repository scanning
- Contains: Repo type detection, scan orchestration, findings validation, user confirmation
- Key files: `manager.js` (scan workflow), `findings.js` (schema validation), `discovery.js` (git operations)

**`worker/mcp/`:**
- Purpose: Model Context Protocol server for Claude Code agents
- Contains: Tool registration, MCP request handlers, project resolution
- Key files: `server.js` (all tools)

**`worker/ui/`:**
- Purpose: Interactive visualization of service dependency graph
- Contains: Canvas rendering, force simulation, project management, detail panels
- Key files: `graph.js` (initialization), `modules/renderer.js` (drawing), `modules/detail-panel.js` (service info)

## Key File Locations

**Entry Points:**
- `worker/index.js`: Worker process startup (long-running service)
- `worker/mcp/server.js`: MCP protocol handler (shebang executable)
- `commands/map.md`: /allclear:map command specification
- `scripts/worker-start.sh`: Worker lifecycle control

**Configuration:**
- `package.json`: Node dependencies (better-sqlite3, chromadb, fastify, zod, @modelcontextprotocol/sdk)
- `~/.allclear/settings.json`: Runtime configuration (ALLCLEAR_LOG_LEVEL, ALLCLEAR_WORKER_PORT, ALLCLEAR_CHROMA_MODE)
- `allclear.config.json`: (Optional) project-specific linked repos list

**Core Logic:**
- `worker/db/query-engine.js`: All database queries, impact calculation, search (primary business logic)
- `worker/scan/manager.js`: Scan orchestration, repo type detection, agent invocation
- `worker/server/http.js`: REST API routes and project resolution
- `worker/mcp/server.js`: Tool registration and handlers

**Testing:**
- `tests/storage/query-engine.test.js`: Query engine functionality
- `tests/bats/`: Shell integration tests (BATS framework)
- `worker/**/*.test.js`: Unit tests (Node.js built-in test runner)

## Naming Conventions

**Files:**
- JavaScript/Node.js: `camelCase.js` (e.g., `queryEngine.js`, `forceWorker.js`)
- Shell scripts: `kebab-case.sh` (e.g., `worker-start.sh`, `linked-repos.sh`)
- Markdown docs: `kebab-case.md` (e.g., `quality-gate.md`, `cross-impact.md`)
- HTML: `index.html` (single file, served as root)

**Directories:**
- Module directories: `lowercase` (e.g., `db`, `scan`, `server`, `mcp`, `ui`)
- Test fixtures: `fixtures/` or `test/` within directories
- Data/config: `.allclear/` in user home (hidden directory)

**Module Exports:**
- Classes: PascalCase (e.g., `QueryEngine`, `McpServer`)
- Functions: camelCase (e.g., `getQueryEngine()`, `validateFindings()`, `scanRepos()`)
- Constants: UPPER_SNAKE_CASE (e.g., `VALID_PROTOCOLS`, `VALID_CONFIDENCE`)

## Where to Add New Code

**New Feature (e.g., new query type):**
- Primary code: `worker/db/query-engine.js` (add method to QueryEngine class)
- HTTP route: `worker/server/http.js` (add GET/POST endpoint)
- Tests: `tests/storage/query-engine-*.test.js` (new test file)
- MCP tool: `worker/mcp/server.js` (register if agent needs access)

**New Component (e.g., new scanning type):**
- Implementation: `worker/scan/*.js` (new file or extend manager.js)
- Orchestration: `worker/scan/manager.js::buildScanContext()` or new function
- Validation: `worker/scan/findings.js` (extend schema if needed)
- Tests: `tests/worker/scan-*.test.js`

**New HTTP Endpoint:**
- Route handler: `worker/server/http.js` (add route with getQE pattern)
- Query logic: `worker/db/query-engine.js` (new method on class)
- Integration tests: `tests/integration/http-*.test.js` (new test file)

**New UI Feature:**
- Module: `worker/ui/modules/<feature>.js` (new feature module)
- Export: `worker/ui/graph.js` (import and initialize)
- Tests: `worker/ui/modules/<feature>.test.js` (co-located)
- Styles: In-line canvas rendering or inline CSS in modules

**New Shell Utility:**
- Location: `scripts/<task>.sh` (operational scripts) or `lib/<name>.sh` (shared utilities)
- Convention: Source other scripts with `source "${SCRIPT_DIR}/other.sh"`
- Testing: Add BATS test in `tests/bats/test/fixtures/`

**New Database Migration:**
- Location: `worker/db/migrations/<N>_<description>.js`
- Exports: `export const version = N;` and `export function up(db) { ... }`
- Pattern: Follow existing migration files (001-007)
- Apply: Automatically on next worker startup via `runMigrations()`

## Special Directories

**`~/.allclear/` (user home, created at runtime):**
- Purpose: Persistent state storage
- Generated: Yes (created by worker on startup)
- Committed: No (user-local, excluded from git)
- Structure:
  ```
  ~/.allclear/
  ├── projects/           # Per-project DBs
  │   ├── <hash>/
  │   │   └── impact-map.db
  │   └── <hash>/
  │       └── impact-map.db
  ├── logs/               # Per-day log files
  │   ├── 2026-03-18_worker.log
  │   ├── 2026-03-18_mcp.log
  │   └── 2026-03-18_http.log
  ├── settings.json       # Global configuration
  ├── worker.pid          # Running worker PID
  └── worker.port         # Running worker HTTP port
  ```

**`tests/bats/test/fixtures/`:**
- Purpose: BATS test fixture repos and configurations
- Generated: No (committed)
- Contains: Example repo structures, shell test files, expected outputs
- Usage: Referenced by BATS tests to verify scanning behavior

**`node_modules/`:**
- Purpose: npm dependencies
- Generated: Yes (created by npm install)
- Committed: No (excluded via .gitignore)
- Key packages: better-sqlite3 (DB), chromadb (search), fastify (HTTP), zod (validation), @modelcontextprotocol/sdk (MCP)

---

*Structure analysis: 2026-03-18*
