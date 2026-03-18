# Coding Conventions

**Analysis Date:** 2026-03-18

## Naming Patterns

**Files:**
- Modules use kebab-case: `query-engine.js`, `database.js`, `pool-repo.js`
- Test files use `.test.js` suffix: `query-engine.test.js`, `manager.test.js`
- Migration files use numbered prefix: `001_initial_schema.js`, `002_service_type.js`

**Functions:**
- camelCase for all function names: `getQueryEngine()`, `buildScanContext()`, `makeQE()`, `resolveDb()`
- Private/helper functions (underscore prefix): `_searchDb`, `_logger`, `_migrations`
- Exported helper functions are lowercase/camelCase: `setSearchDb()`, `setScanLogger()`, `openDb()`

**Variables:**
- camelCase: `tmpDir`, `projectRoot`, `dbPath`, `queryEngine`, `isChromaAvailable`
- Constants in UPPERCASE: `LEVELS`, `VALID_PROTOCOLS`, `NODE_TYPE_COLORS`
- Private state variables: `_db`, `_logger`, `_migrations`, `_mcpLogLevel`

**Types:**
- Classes use PascalCase: `QueryEngine`, `McpServer`
- JSDoc type definitions use PascalCase in @typedef: `@typedef {{ ... }} Findings`, `Connection`, `Schema`
- Type tags follow TypeScript-like conventions: `{string}`, `{number}`, `{Array<{id: string}>}`

## Code Style

**Formatting:**
- Uses 2-space indentation (inferred from codebase)
- No enforced formatter (no .prettierrc, eslintrc config found)
- JSDoc comments precede all public functions and exports

**Linting:**
- No ESLint configuration found (not enforced)
- Code conventions followed manually through pattern consistency

## Import Organization

**Order:**
1. Node.js built-in modules first: `import fs from "node:fs"`, `import path from "node:path"`
2. Third-party packages: `import Database from "better-sqlite3"`, `import { z } from "zod"`
3. Local project modules: `import { QueryEngine } from "./query-engine.js"`

**Path Aliases:**
- No path aliases configured — imports use relative paths: `./db/database.js`, `../server/http.js`, `../lib/logger.js`
- File extensions (.js) are explicit for ES modules: `import { openDb } from "../../worker/db/database.js"`

**Module imports with :node prefix:**
- Node.js builtins explicitly use `node:` prefix for clarity: `import assert from "node:assert/strict"`, `import { test, describe } from "node:test"`

## Error Handling

**Patterns:**
- Try-catch blocks wrap file I/O and database operations:
  ```javascript
  try {
    const db = new Database(dbPath);
    // operations
  } catch (err) {
    process.stderr.write(`[context] Failed to do thing: ${err.message}\n`);
    return null; // graceful degradation
  }
  ```
- Silent catches used for optional operations: `try { ... } catch { /* ignore */ }`
- Functions return `null` for recoverable errors, propagate for critical failures
- No custom error classes — use standard Error with descriptive messages

**Logging patterns:**
- Log messages to `process.stderr.write()` directly for debugging: `process.stderr.write("[search] tier=chroma results=" + results.length + "\n")`
- Structured logger (`createLogger`) used for persistent logs: `logger.log("INFO", "message", { extraField: value })`
- Log output is JSON with fields: `{ ts, level, msg, pid, component, ... }`

## Comments

**When to Comment:**
- Block comments explain non-obvious algorithm logic (e.g., CTE traversal in query-engine.js)
- Section dividers use 75-char comment lines: `// ---------------------------------------------------------------------------`
- Inline comments rare — code is self-documenting through naming and structure

**JSDoc/TSDoc:**
- All exported functions have JSDoc blocks with @param, @returns, @deprecated tags
- Parameter types use TypeScript-like syntax in braces: `@param {string} projectRoot`, `@param {import('better-sqlite3').Database} db`
- Typedef blocks document complex types before use in a module
- Comment blocks precede each logical section (marked with `// ---...--- pattern`)

## Function Design

**Size:**
- Most functions 20-60 lines (readable in one screen)
- Complex query functions (query-engine.js) 40-100 lines due to SQL statement composition
- Helper functions 5-20 lines

**Parameters:**
- 3-4 parameters max; use objects for multiple options: `createHttpServer(queryEngine, { port, resolveQueryEngine, logger, dataDir })`
- Configuration objects are unpacked immediately and documented in JSDoc

**Return Values:**
- Single return type per function (no union returns of different shapes)
- Null used for "not found" or "error occurred": `getQueryEngine()` returns `QueryEngine|null`
- Objects with { ok, error } structure used for operations with clear success/failure: implicit in patterns like `getChangedFiles()` returning `{ modified, deleted, renamed } | { error }`
- Arrays for collections: `listProjects()` returns `Array<{hash, dbPath, size}>`

## Module Design

**Exports:**
- Each module exports specific public functions or classes
- Utility modules export multiple helpers (e.g., `database.js` exports `openDb`, `runMigrations`)
- Singleton patterns use module-level state: `let _db = null; export function openDb(...)`

**Barrel Files:**
- Not used — imports are direct from specific modules
- Each module imported explicitly: `import { QueryEngine } from "./query-engine.js"`

**Dependency Direction:**
- Core data layer (`worker/db/*`) has no dependencies on higher layers
- Query layer (`worker/db/query-engine.js`) depends only on `worker/server/chroma.js` for semantic search
- HTTP server (`worker/server/http.js`) depends on `worker/db/pool.js` for query engine resolution
- No circular dependencies

---

*Convention analysis: 2026-03-18*
