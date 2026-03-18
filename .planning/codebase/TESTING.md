# Testing Patterns

**Analysis Date:** 2026-03-18

## Test Framework

**Runner:**
- Node.js built-in test runner (`node:test`), available in Node 18+
- No external test framework (Jest, Vitest) — uses only Node's native capabilities
- Config: No test config file needed; tests run via `node --test <file.js>` or `node --input-type=module < file.js`

**Assertion Library:**
- `node:assert/strict` — Node's strict assertion module
- Import: `import assert from "node:assert/strict"`

**Run Commands:**
```bash
npm test                                                    # Run all tests (limited set)
npm run test:storage                                        # Run storage layer tests
node --test tests/storage/query-engine.test.js             # Run specific test file
node --test 'worker/**/*.test.js'                           # Run tests matching glob (if supported)
node --input-type=module < worker/db/database.test.js      # Alternative: stdin mode for scripts
```

## Test File Organization

**Location:**
- Co-located with source code: `worker/db/database.test.js` sits next to `worker/db/database.js`
- Some tests in separate `tests/` directory: `tests/storage/`, `tests/ui/`, `tests/worker/`
- Pattern: Test and source file share same directory structure, `.test.js` suffix

**Naming:**
- `*.test.js` suffix for all test files (not `.spec.js`)
- Test file names mirror source: `query-engine.js` → `query-engine.test.js`, `manager.js` → `manager.test.js`

**Structure:**
```
worker/
├── db/
│   ├── database.js
│   ├── database.test.js
│   ├── query-engine.js
│   └── query-engine.test.js
├── scan/
│   ├── manager.js
│   └── manager.test.js
└── server/
    ├── http.js
    └── http.test.js
```

## Test Structure

**Suite Organization:**

```javascript
import { describe, it, test, before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";

describe("feature name", () => {
  test("specific case description", () => {
    // arrange
    const input = ...;

    // act
    const result = someFunction(input);

    // assert
    assert.strictEqual(result, expected);
  });

  test("error case", () => {
    const result = someFunction(badInput);
    assert.ok("error" in result, "should return { error }");
    assert.equal(result.error, "expected message");
  });
});
```

**Patterns:**

1. **Describe blocks organize related tests:**
   ```javascript
   describe("database setup", () => { /* tests */ });
   describe("schema", () => { /* tests */ });
   describe("getChangedFiles", () => { /* tests */ });
   ```

2. **Setup/teardown with before/after:**
   ```javascript
   before(() => {
     const { dir, head } = makeTempRepo();
     repoDir = dir;
     initialHead = head;
   });

   after(() => cleanupDir(repoDir));
   ```

3. **Assertion style:**
   - `assert.strictEqual(actual, expected)` — equality check
   - `assert.ok(condition, message)` — truthy check with optional message
   - `assert.deepEqual(obj1, obj2)` — recursive object equality
   - `assert.throws(() => fn(), expectedError)` — exception testing
   - `assert.equal(result.error, "specific message")` — error message verification

## Mocking

**Framework:**
- No mocking library used — manual mocks created as plain JavaScript objects
- Mocks are test-local and simple

**Patterns:**

```javascript
// Inline mock object for QueryEngine
const mockQE = {
  getGraph: () => ({ nodes: [{ id: 1, name: "svc-a" }], edges: [] }),
  getImpact: (ep) => ({ affected: [{ id: 1, name: "svc-b" }] }),
  getService: (name) =>
    name === "svc-a"
      ? { service: { id: 1, name: "svc-a" }, upstream: [], downstream: [] }
      : null,
  getVersions: () => [{ id: 1, created_at: "2026-01-01", label: "v1" }],
};

// Use in test
const server = await createHttpServer(mockQE, { port: 0 });
```

**Dependency injection for testing:**
- Functions accept optional dependencies: `createHttpServer(queryEngine, options)`
- Tests pass mocks instead of real implementations
- Modules export setter functions for test injection:
  - `setScanLogger(logger)` — inject logger for test silence/capture
  - `setSearchDb(db)` — inject isolated in-memory DB for search tests
  - `setAgentRunner(fn)` — inject custom agent invoker for scan tests

**What to Mock:**
- HTTP/network layer (replace with in-memory server: `.inject()` calls)
- External dependencies (ChromaDB, agent runners)
- Heavy resources (real filesystem when temp dirs possible)

**What NOT to Mock:**
- Database (use real better-sqlite3 with `:memory:` or temp file)
- Git (use real git commands with temp repo)
- File I/O (use real `fs` with temp directories)
- Core business logic (test actual implementation)

## Fixtures and Factories

**Test Data:**

```javascript
// Factory function to create isolated test DB
function makeQE() {
  const dir = path.join(os.tmpdir(), "allclear-test-" + crypto.randomUUID());
  fs.mkdirSync(dir, { recursive: true });
  const dbPath = path.join(dir, "test.db");

  const db = new Database(dbPath);
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");

  // Bootstrap schema_versions and run all migrations in order
  db.exec(`CREATE TABLE IF NOT EXISTS schema_versions (...)`);
  for (const m of [migration001, migration002, /* ... */]) {
    db.transaction(() => {
      m.up(db);
      db.prepare("INSERT INTO schema_versions (version) VALUES (?)").run(m.version);
    })();
  }

  const qe = new QueryEngine(db);
  return { db, qe };
}

// Use in test
test("test case", () => {
  const { db, qe } = makeQE();
  // test...
  db.close(); // cleanup
});
```

**Location:**
- Helper functions defined at top of test file (after imports)
- Patterns include: `makeTempRepo()`, `makeQE()`, `makeTempDataDir()`, `createTestDb()`
- Each test is responsible for cleanup (call `rmSync()`, `db.close()`)

## Coverage

**Requirements:**
- No coverage threshold enforced (no coverage tools configured)
- Tests focus on critical paths: database schema, query correctness, file I/O error cases

**View Coverage:**
- Not configured — no coverage tools in codebase

## Test Types

**Unit Tests:**
- Scope: Single function or class method in isolation
- Approach: Use test doubles for dependencies; test input→output
- Examples: `query-engine.test.js` (QueryEngine methods), `findings.test.js` (validation)
- Files: `worker/db/*.test.js`, `worker/scan/*.test.js`

**Integration Tests:**
- Scope: Multiple modules working together (DB + QueryEngine + HTTP server)
- Approach: Use real databases (`:memory:` or temp file), real network stubs (Fastify `.inject()`)
- Examples: `http.test.js` (server + DB), `server.test.js` (MCP + QueryEngine)
- Files: `worker/server/*.test.js`, `worker/mcp/*.test.js`

**E2E Tests:**
- Framework: Not used (no Playwright, Cypress, etc.)
- UI testing done via inspection scripts: `worker/ui/modules/*.test.js` inspect source code for patterns
- Git repo tests use real git and temp directories: `manager.test.js` uses `makeTempRepo()`

## Common Patterns

**Async Testing:**
```javascript
import { test } from "node:test";

test("async operation", async () => {
  const result = await someAsyncFunction();
  assert.ok(result.ok);
});

// Or with before/after
before(async () => {
  data = await loadAsync();
});
```

**Error Testing:**
```javascript
test("returns error when repo has no .git", () => {
  const noGitDir = mkdtempSync(join(tmpdir(), "allclear-nogit-"));
  try {
    const result = getChangedFiles(noGitDir, null);
    assert.ok("error" in result, "should return { error }");
    assert.equal(result.error, "not a git repo");
  } finally {
    cleanupDir(noGitDir);
  }
});
```

**Database Testing:**
```javascript
// Create isolated in-memory DB per test
before(async () => {
  db = new Database(":memory:");
  db.pragma("foreign_keys = ON");
  db.exec(`CREATE TABLE...`);
});

test("query returns results", () => {
  db.prepare("INSERT INTO services (name) VALUES (?)").run("svc-1");
  const rows = db.prepare("SELECT * FROM services").all();
  assert.equal(rows.length, 1);
});
```

**Cleanup Pattern:**
```javascript
test("something", () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "allclear-test-"));
  try {
    // test code
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

// Or with after hook
after(() => {
  try {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  } catch (_) {}
});
```

---

*Testing analysis: 2026-03-18*
