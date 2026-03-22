# Coding Conventions

**Analysis Date:** 2026-03-22

## Naming Patterns

**Files:**
- Lowercase with hyphens for multi-word names: `query-engine.js`, `auth-db-extractor.js`
- Module purpose in filename: `logger.js`, `pool.js`, `manager.js`
- Test files: `.test.js` suffix on the corresponding module name: `findings.test.js` pairs with `findings.js`

**Functions:**
- camelCase for all function names: `validateFindings()`, `buildScanContext()`, `getChangedFiles()`
- Private functions use leading underscore: `_hasServiceEntryPoint()`, `_logger`
- Descriptive verb-object pattern: `createHttpServer()`, `formatHighConfidenceSummary()`, `registerEnricher()`

**Variables:**
- camelCase for all variables: `repoPath`, `queryEngine`, `poolCache`
- Module-level private state uses leading underscore: `_db`, `_logger`, `_migrations`
- Constants: SCREAMING_SNAKE_CASE: `VALID_PROTOCOLS`, `MAX_LOW_CONFIDENCE`, `VALID_SERVICE_TYPES`

**Types (JSDoc):**
- Use `@typedef` for complex object shapes with full property documentation
- Named types describe domain concepts: `Findings`, `Connection`, `Schema`, `Field`, `FindingsResult`
- Reference types by their typedef name in function signatures: `@param {Findings} findings`

## Code Style

**Formatting:**
- 2-space indentation (no tabs)
- No `.prettierrc` or ESLint config present — conventions are manual
- Line length follows Node.js readability standards (~80-100 chars for readability, no hard enforcement)

**Linting:**
- No eslint/prettier in package.json — code is formatted by hand
- Shellcheck for shell scripts in `plugins/ligamen/scripts/*.sh` and `plugins/ligamen/lib/*.sh` (see Makefile lint target)

## Import Organization

**Order:**
1. Node.js built-in modules: `import fs from "node:fs";`
2. Third-party packages: `import Fastify from "fastify";`, `import Database from "better-sqlite3";`
3. Local imports: `import { createLogger } from "./lib/logger.js";`

**Path Aliases:**
- No path aliases configured — all imports use relative paths (`./`, `../`, etc.)
- Absolute path imports from project root not used; favor relative paths

**Pattern:**
- Always use `node:` prefix for built-in modules: `import path from "node:path";`
- Use explicit file extensions: `import { QueryEngine } from "./query-engine.js";`
- Use default imports for single exports: `import Fastify from "fastify";`
- Use named imports for multiple exports: `import { test, describe } from "node:test";`

## Error Handling

**Patterns:**
- `try/catch` for sync operations with error logging via logger: `catch (err) { logger.error(...) }`
- Fail-safe approach: errors are caught, logged, and execution continues (see `enrichment.js` runEnrichmentPass)
- Return `{ error: string }` objects for synchronous validation: `{ valid: false, error: "..." }`
- Return `{ valid: true, ... }` for success: `{ valid: true, findings, warnings }`

**Process Errors:**
- `process.stderr.write()` for critical startup errors (db.js, pool.js)
- No `console.log` or `console.error` in production code — use structured logger with `logger.log(level, msg, extra)`

**HTTP Errors:**
- Fastify reply status codes: `.code(503)`, `.code(500)`, `.code(200)`
- Error responses as JSON: `reply.send({ error: "message" })`

## Logging

**Framework:** Custom structured logger in `worker/lib/logger.js`

**Patterns:**
- Logger created once per module with component tag: `createLogger({ dataDir, port, logLevel, component: 'worker' })`
- Structured logging with JSON: `logger.log(level, msg, { key: value })`
- Levels: DEBUG, INFO, WARN, ERROR
- No console logging in production code

**Where to log:**
- Startup/shutdown milestones: "worker started", "worker stopped"
- Error conditions: `.error()` for exceptions, `.warn()` for recoverable failures
- Debug info: `.debug()` for detailed traces (only when LIGAMEN_LOG_LEVEL=DEBUG)
- Not per-function entry/exit (too verbose)

## Comments

**When to Comment:**
- Explain *why* not *what*: code should be readable; comments explain design decisions
- Refactoring rationale: why a certain approach was chosen over alternatives
- Complex algorithms: boundary conditions, edge case handling
- Design notes and constraints: "SREL-01 (THE-933): Incremental scan constraint injection"

**JSDoc/TSDoc:**
- Use `/** */` blocks for all exported functions
- Document parameters with `@param {type} name - description`
- Document return values with `@returns {type} description`
- Document complex types with `@typedef`
- Include examples for complex functions: `@example validateFindings({ ... })`

**Example:**
```javascript
/**
 * Validates an agent findings object against the Ligamen findings schema.
 *
 * @param {unknown} obj - The object to validate
 * @returns {FindingsResult}
 */
export function validateFindings(obj) {
  // Top-level type check
  if (obj === null || typeof obj !== "object" || Array.isArray(obj)) {
    return err("findings must be an object");
  }
  // ...
}
```

## Function Design

**Size:**
- Aim for functions under 50 lines (readability preference, not hard rule)
- Break complex flows into named helper functions

**Parameters:**
- Use object parameters for 3+ arguments: `createHttpServer(queryEngine, { port, resolveQueryEngine, logger, dataDir })`
- Single or two primitive args are fine: `getChangedFiles(repoPath, sinceCommit)`
- Use destructuring for object parameters

**Return Values:**
- Return single values or objects: `function getQueryEngine(projectRoot) { return qe; }`
- Return `{ valid, error, ... }` objects for validation/checking: not exceptions
- Return arrays of objects for collections: `listProjects()` returns array of hashes/sizes
- Use null for "not found": `getQueryEngine() returns null if DB doesn't exist`

**Async:**
- Use `async/await` (not promises): `export async function createHttpServer(...) { ... await fastify.register(...) ... }`
- Error handling: wrapping try/catch around await calls, propagate errors to caller

## Module Design

**Exports:**
- Use named exports for single-responsibility modules: `export function validateFindings(obj) { ... }`
- Default exports only for servers/apps: `export default function()` or use factory: `export async function createHttpServer(...)`
- Explicit export list at top: see `manager.js`, `enrichment.js` for pattern

**Barrel Files:**
- Not used; direct imports from module files: `import { QueryEngine } from "./query-engine.js"`
- No `index.js` re-exports

**Module Boundaries:**
- Database layer: `worker/db/` — handles SQLite, migrations, pooling
- Query layer: `worker/db/query-engine.js` — QueryEngine class, all query logic
- Server layer: `worker/server/` — HTTP (Fastify), WebSocket, MCP
- Scan layer: `worker/scan/` — discovery, findings validation, enrichment
- UI layer: `worker/ui/` — browser modules, canvas, state management
- Helper layer: `worker/lib/` — logger, utilities

## Singleton Patterns

**Module-level state (injected for testing):**
- Database instance: `let _db = null;` in `database.js`, exposed via `openDb()` / `getDb()`
- Logger: `let _logger = null;` in `manager.js`, set via `setScanLogger(logger)`
- Agent runner: injected in `manager.js` via `setAgentRunner(fn)` for test mocking

**Why this pattern:**
- Avoids passing logger/db through 5+ function layers
- Testable: tests inject mock implementations
- Decouples core logic from infrastructure

---

*Convention analysis: 2026-03-22*
