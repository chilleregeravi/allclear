# Codebase Structure

**Analysis Date:** 2026-03-22

## Directory Layout

```
ligamen/ (monorepo root)
├── plugins/
│   └── ligamen/                    # Main Ligamen plugin package (@ligamen/cli v5.4.0)
│       ├── bin/                    # CLI entry points
│       │   └── ligamen-init.js     # Plugin initialization script
│       ├── .mcp.json               # MCP server configuration
│       ├── ligamen.config.json.example  # Example config template
│       ├── package.json            # Plugin manifest
│       ├── runtime-deps.json       # MCP server runtime dependencies
│       ├── commands/               # Command definitions (markdown specs)
│       │   ├── map.md              # /ligamen:map command spec
│       │   ├── cross-impact.md     # /ligamen:cross-impact spec
│       │   ├── drift.md            # /ligamen:drift spec
│       │   ├── config.sh           # Helper: read configuration
│       │   ├── detect.sh           # Helper: detect project type
│       │   ├── linked-repos.sh     # Helper: manage linked repos
│       │   └── worker-client.sh    # Helper: communicate with worker
│       ├── hooks/                  # Plugin hooks (auto-format, auto-lint, etc.)
│       ├── lib/                    # Plugin-level shared code
│       ├── scripts/                # Plugin build/setup scripts
│       ├── skills/                 # Reusable agent skills
│       │   └── impact/             # Impact analysis skill
│       │       └── SKILL.md        # Skill definition for agent
│       └── worker/                 # Long-running worker service
│           ├── index.js            # Worker entrypoint (starts HTTP + MCP servers)
│           ├── db/                 # Database & query layer
│           │   ├── database.js     # DB initialization, migrations, lifecycle
│           │   ├── pool.js         # Per-project DB pool and QueryEngine cache
│           │   ├── query-engine.js # Graph queries, search, upsert operations
│           │   ├── migrations/     # Schema migrations (001-009)
│           │   │   ├── 001_initial_schema.js
│           │   │   ├── 002_service_type.js
│           │   │   ├── 003_exposed_endpoints.js
│           │   │   ├── 004_dedup_constraints.js
│           │   │   ├── 005_scan_versions.js
│           │   │   ├── 006_dedup_repos.js
│           │   │   ├── 007_expose_kind.js
│           │   │   ├── 008_actors_metadata.js
│           │   │   └── 009_confidence_enrichment.js
│           │   └── *.test.js       # Database and query engine tests
│           ├── server/             # HTTP server & static file serving
│           │   ├── http.js         # Fastify HTTP server with REST routes
│           │   ├── chroma.js       # ChromaDB initialization and search
│           │   └── *.test.js       # Server integration tests
│           ├── lib/                # Worker-level shared utilities
│           │   └── logger.js       # Structured JSON logger
│           ├── mcp/                # MCP server integration
│           │   ├── server.js       # MCP server with tool definitions
│           │   └── *.test.js       # MCP tool tests
│           ├── scan/               # Scanning orchestration
│           │   ├── manager.js      # Scan orchestration & agent invocation
│           │   ├── discovery.js    # Repo discovery & configuration
│           │   ├── findings.js     # Findings schema validation
│           │   ├── enrichment.js   # Post-scan enrichment pipeline
│           │   ├── codeowners.js   # CODEOWNERS ownership extraction
│           │   ├── confirmation.js # User confirmation flow
│           │   ├── enrichment/     # Enricher modules
│           │   │   └── auth-db-extractor.js  # Database & auth pattern extraction
│           │   └── *.test.js       # Scan module tests
│           └── ui/                 # Browser-based visualization UI
│               ├── graph.js        # Entry point, project loading
│               ├── force-worker.js # Web Worker for force simulation
│               ├── modules/        # UI component modules
│               │   ├── state.js          # Global UI state
│               │   ├── renderer.js       # Canvas rendering
│               │   ├── layout.js         # Force-directed layout
│               │   ├── interactions.js   # Click/hover/drag handlers
│               │   ├── detail-panel.js   # Service detail view
│               │   ├── filter-panel.js   # Filter & search UI
│               │   ├── project-picker.js # Project selection modal
│               │   ├── project-switcher.js # Multi-project nav
│               │   ├── keyboard.js       # Keyboard shortcuts
│               │   ├── log-terminal.js   # Real-time log viewer
│               │   ├── export.js         # Graph export functionality
│               │   ├── utils.js          # Shared utilities
│               │   └── *.test.js         # UI module tests
│               └── index.html       # HTML shell for UI
├── tests/                          # Integration and e2e tests
│   ├── ui/                         # UI-specific tests
│   └── bats/                       # Shell-based BATS tests
├── docs/                           # Documentation
├── .planning/                      # GSD planning artifacts
│   └── codebase/                   # Codebase analysis documents
│       ├── ARCHITECTURE.md         # This file
│       ├── STRUCTURE.md            # Directory layout
│       ├── STACK.md                # Technology stack
│       ├── INTEGRATIONS.md         # External integrations
│       ├── CONVENTIONS.md          # Coding conventions
│       ├── TESTING.md              # Testing patterns
│       └── CONCERNS.md             # Technical debt & issues
├── Makefile                        # Build & development targets
├── package.json                    # Root package.json (monorepo)
├── README.md                       # Root documentation
└── LICENSE                         # AGPL-3.0-only
```

## Directory Purposes

**`plugins/ligamen/`:**
- Purpose: Main plugin package for Claude Code
- Contains: All CLI commands, hooks, worker service, UI
- Key files: `package.json` (v5.4.0), `.mcp.json` (MCP server registration)

**`plugins/ligamen/commands/`:**
- Purpose: Markdown-based command definitions for Claude Code
- Contains: Prompt specs that Claude agent executes as tasks
- File format: Each .md file is a command definition
- Not code: These are configuration/specification files, not executable code

**`plugins/ligamen/worker/`:**
- Purpose: Long-running background service
- Contains: HTTP API, database, scanning, MCP server
- Lifecycle: Started once, persists across sessions
- Ports: Default 37888 (configurable, stored in `~/.ligamen/worker.port`)

**`plugins/ligamen/worker/db/`:**
- Purpose: Data persistence and graph queries
- Schema: 9 migrations evolving from initial to confidence-enriched
- DB path: `~/.ligamen/projects/<hash>/impact-map.db` (hash = sha256(projectRoot).slice(0,12))
- Key tables: services, connections, repos, fields, node_metadata, scan_versions, actors

**`plugins/ligamen/worker/server/`:**
- Purpose: HTTP API and ChromaDB integration
- Responsibilities:
  - Serve UI static files from `worker/ui/`
  - Expose REST routes (/graph, /impact, /service, /scan, etc.)
  - Manage ChromaDB semantic search (optional)
  - Stream worker logs to UI

**`plugins/ligamen/worker/mcp/`:**
- Purpose: Model Context Protocol integration for agent workflows
- Responsibilities:
  - Define MCP tools for impact analysis queries
  - Resolve project DB per tool invocation
  - Log tool usage via structured logger

**`plugins/ligamen/worker/scan/`:**
- Purpose: Orchestrate discovery and scanning phases
- Responsibilities:
  - Detect scan mode (full vs. incremental)
  - Invoke agent via injected runner
  - Parse and validate findings
  - Run enrichment pipeline
  - Manage repo discovery and confirmation

**`plugins/ligamen/worker/ui/`:**
- Purpose: Browser visualization of service dependency graph
- Framework: Vanilla JS with canvas rendering (D3-like force simulation)
- Deployment: Served statically from HTTP server at `/`
- Interaction: Point-and-click graph exploration, detail panels, filtering

**`plugins/ligamen/lib/` vs `plugins/ligamen/worker/lib/`:**
- `lib/`: Plugin-level utilities (if any) — currently mostly empty
- `worker/lib/`: Worker service utilities (logger, etc.)

## Key File Locations

**Entry Points:**

- `plugins/ligamen/worker/index.js` - Worker process start (Node.js)
- `plugins/ligamen/commands/map.md` - /ligamen:map command definition
- `plugins/ligamen/worker/ui/graph.js` - Browser UI entry point
- `bin/ligamen-init.js` - CLI initialization (npm install)

**Configuration:**

- `plugins/ligamen/.mcp.json` - MCP server registration
- `plugins/ligamen/package.json` - Plugin metadata and dependencies
- `plugins/ligamen/ligamen.config.json.example` - Linked repos template
- `~/.ligamen/settings.json` - Runtime config (log level, ports, flags)

**Core Logic:**

- `plugins/ligamen/worker/db/query-engine.js` - Graph queries and transitive impact
- `plugins/ligamen/worker/scan/manager.js` - Scan orchestration
- `plugins/ligamen/worker/server/http.js` - REST API routes
- `plugins/ligamen/worker/mcp/server.js` - MCP tool definitions

**Testing:**

- `plugins/ligamen/worker/db/query-engine*.test.js` - Query engine tests
- `plugins/ligamen/worker/server/http.test.js` - HTTP server tests
- `plugins/ligamen/worker/scan/*.test.js` - Scan module tests
- `plugins/ligamen/worker/ui/modules/*.test.js` - UI module tests
- `tests/` - Integration/e2e tests

## Naming Conventions

**Files:**

- Service modules: `<domain>.js` (e.g., `query-engine.js`, `discovery.js`)
- Test files: `<module>.test.js` (co-located with implementation)
- Migration files: `<number>_<description>.js` (e.g., `001_initial_schema.js`)
- UI modules: `<feature>.js` (e.g., `detail-panel.js`, `layout.js`)
- Command specs: `<command>.md` (e.g., `map.md`, `cross-impact.md`)
- Helpers: `<function>.sh` (e.g., `config.sh`, `worker-client.sh`)

**Directories:**

- Plural for collections: `migrations/`, `modules/`, `skills/`, `enrichment/`
- Singular for domain boundaries: `db/`, `scan/`, `server/`, `ui/`, `mcp/`, `lib/`, `commands/`, `hooks/`
- Metadata prefixes for special dirs: `.planning/`, `.claude-plugin/`, `.mcp.json`

**Exports:**

- Main module functions: Named exports (e.g., `export function getQueryEngine(projectRoot)`)
- Classes: `export class QueryEngine`
- Defaults: Not used — all modules use named exports for clarity

**Path Aliases:**

- No TypeScript path aliases — uses relative `import` with explicit paths
- Example: `import { QueryEngine } from '../db/query-engine.js'`

## Where to Add New Code

**New Feature:**
- Primary code: `plugins/ligamen/worker/<domain>/<feature>.js`
- Tests: `plugins/ligamen/worker/<domain>/<feature>.test.js` (same directory)
- Example: New search tier → `plugins/ligamen/worker/db/search-tier-<name>.js`

**New Enricher:**
- Implementation: `plugins/ligamen/worker/scan/enrichment/<name>.js`
- Registration: Call `registerEnricher(name, fn)` in `scan/manager.js` module-level
- Example: GitHub Actions enricher → `worker/scan/enrichment/github-actions.js`

**New HTTP Route:**
- Location: Add route definition in `plugins/ligamen/worker/server/http.js`
- Pattern: `fastify.get('/api/new-endpoint', async (request, reply) => { ... })`
- Logging: Use `httpLog('INFO'|'ERROR', msg, { route: '/api/new-endpoint' })`

**New UI Component:**
- Location: `plugins/ligamen/worker/ui/modules/<component-name>.js`
- Pattern: Export named function, import in `graph.js`
- Tests: `plugins/ligamen/worker/ui/modules/<component-name>.test.js`

**New Command:**
- Location: `plugins/ligamen/commands/<command-name>.md`
- Format: Markdown with command spec and prompts for agent
- Registration: Add to `commands/` directory; Claude Code auto-discovers

**Utilities (Shared):**
- Worker utilities: `plugins/ligamen/worker/lib/<utility>.js`
- Plugin utilities: `plugins/ligamen/lib/<utility>.js`
- Test utilities: Co-locate with test files or in dedicated `test-utils.js`

**Database Migrations:**
- Location: `plugins/ligamen/worker/db/migrations/<next-number>_<description>.js`
- Pattern: `export const version = N; export function up(db) { ... }`
- Loader: Migrations auto-discovered and run in version order by `database.js`

## Special Directories

**`.planning/codebase/`:**
- Purpose: GSD (Guided Software Development) codebase analysis documents
- Generated: By `/gsd:map-codebase` command
- Committed: Yes, in git
- Files: ARCHITECTURE.md, STRUCTURE.md, STACK.md, INTEGRATIONS.md, CONVENTIONS.md, TESTING.md, CONCERNS.md

**`.claude-plugin/`:**
- Purpose: Claude Code plugin metadata
- Generated: By plugin system
- Committed: Yes
- Contains: Plugin registration, permissions, capabilities

**`~/.ligamen/` (Runtime, not in repo):**
- Purpose: User data directory (outside codebase)
- Path: `~/.ligamen/projects/<hash>/impact-map.db` — per-project DB
- Path: `~/.ligamen/logs/worker.log` — structured worker logs
- Path: `~/.ligamen/settings.json` — runtime configuration
- Path: `~/.ligamen/worker.pid`, `worker.port` — process metadata

**`.bats/` in tests/:**
- Purpose: BATS test framework output
- Generated: By BATS test runner
- Committed: No (in .gitignore)

---

*Structure analysis: 2026-03-22*
