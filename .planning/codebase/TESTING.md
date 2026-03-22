# Testing Patterns

**Analysis Date:** 2026-03-22

## Test Framework

**Runner:**
- Node.js built-in `node:test` module (no external test framework)
- Version: Node.js 20+
- Run command: `node --test path/to/file.test.js`

**Assertion Library:**
- Node.js `node:assert/strict` — strict equality checks
- No external assertion library

**Run Commands:**
```bash
node --test worker/db/query-engine.test.js       # Run single test file
node --test "worker/**/*.test.js"                 # Run all tests in directory (glob)
```

## Test File Organization

**Location:**
- Co-located with source: `findings.js` paired with `findings.test.js` in same directory
- Same file suffix pattern: source module name `.test.js`

**Naming:**
- File pattern: `{module-name}.test.js`
- Test descriptions use descriptive strings: `test("validateFindings returns valid:false with error for null input", () => { ... })`

**Structure:**
```
worker/
├── scan/
│   ├── findings.js
│   ├── findings.test.js
│   ├── manager.js
│   ├── manager.test.js
│   └── ...
├── db/
│   ├── query-engine.js
│   ├── query-engine-graph.test.js
│   ├── query-engine-upsert.test.js
│   └── ...
└── ...
```

## Test Structure

**Suite Organization:**
```javascript
import { test, describe, before, after, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";

describe("getChangedFiles", () => {
  let repoDir;
  let initialHead;

  before(() => {
    const { dir, head } = makeTempRepo();
    repoDir = dir;
    initialHead = head;
  });

  after(() => cleanupDir(repoDir));

  test("returns { error } when repoPath has no .git", () => {
    const noGitDir = mkdtempSync(join(tmpdir(), "ligamen-nogit-"));
    try {
      const result = getChangedFiles(noGitDir, null);
      assert.ok("error" in result, "should return { error }");
      assert.equal(result.error, "not a git repo");
    } finally {
      cleanupDir(noGitDir);
    }
  });

  test("with sinceCommit=null returns all tracked files as modified", () => {
    writeFileSync(join(repoDir, "a.txt"), "hello");
    execSync("git add a.txt", { cwd: repoDir, stdio: "pipe" });
    execSync('git commit -m "add a.txt"', { cwd: repoDir, stdio: "pipe" });

    const result = getChangedFiles(repoDir, null);
    assert.ok(Array.isArray(result.modified), "modified should be an array");
    assert.ok(result.modified.includes("a.txt"), "a.txt should be in modified");
  });
});
```

**Patterns:**
- Use `describe()` for grouping related tests by function/feature
- Use `before()` / `after()` for suite-wide setup/teardown (temp dirs, git repos)
- Use `beforeEach()` / `afterEach()` for per-test isolation
- Cleanup always in `finally` block: `rmSync(dir, { recursive: true, force: true })`

## Mocking

**Framework:** Manual mocking (no library)

**Patterns:**
```javascript
// Mock object for QueryEngine
const mockQE = {
  getGraph: () => ({ nodes: [{ id: 1, name: "svc-a" }], edges: [] }),
  getImpact: (ep) => ({ affected: [{ id: 1, name: "svc-b" }] }),
  getService: (name) =>
    name === "svc-a"
      ? { service: { id: 1, name: "svc-a" }, upstream: [], downstream: [] }
      : null,
  getVersions: () => [{ id: 1, created_at: "2026-01-01", label: "v1" }],
};

// Inject via function parameter
async function makeServer(qe = mockQE, opts = {}) {
  const server = await createHttpServer(qe, { port: 0, ...opts });
  return server;
}

// Test uses mock
test("GET /api/logs returns 200 with empty lines array", async () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "ligamen-test-"));
  const server = await makeServer(mockQE, { dataDir: tmpDir });
  const res = await server.inject({ method: "GET", url: "/api/logs" });
  assert.equal(res.statusCode, 200);
});
```

**What to Mock:**
- QueryEngine: return hardcoded test data for specific queries
- Database: use in-memory `:memory:` databases for tests
- Fastify servers: use `port: 0` (inject-only) and `.inject()` for HTTP testing
- File system: use `mkdtempSync()` / `mkdirSync()` / `writeFileSync()` for temp repos

**What NOT to Mock:**
- Git operations: use real git commands in temp repos (`execSync("git init")`)
- File I/O for setup: real `readFileSync()` / `writeFileSync()` to create fixtures
- SQLite database structure: real migrations, real schema creation

## Fixtures and Factories

**Test Data:**
```javascript
/** Minimal valid findings object */
function minimalValid() {
  return {
    service_name: "test-svc",
    confidence: "high",
    services: [
      {
        name: "test-svc",
        root_path: "src/",
        language: "typescript",
        confidence: "high",
      },
    ],
    connections: [],
    schemas: [],
  };
}

/** A valid connection */
function validConnection(overrides = {}) {
  return {
    source: "svc-a",
    target: "svc-b",
    protocol: "rest",
    method: "GET",
    path: "/health",
    source_file: "src/client.ts:callHealth",
    confidence: "high",
    evidence: "await fetch('/health')",
    ...overrides,
  };
}

// Test uses factory with overrides
test("validateFindings returns valid:false for unknown protocol", () => {
  const obj = minimalValid();
  obj.connections = [validConnection({ protocol: "websocket" })];
  const result = validateFindings(obj);
  assert.equal(result.valid, false);
});
```

**Location:**
- Helper functions defined at top of test file: `makeTempRepo()`, `makeServer()`, `minimalValid()`
- No shared fixtures directory — factories live in test files to keep tests self-contained

## Coverage

**Requirements:** No coverage enforcement (no coverage threshold in package.json)

**View Coverage:**
- No coverage tooling configured
- Manual inspection: `grep -r "test(" worker/ | wc -l` to count test cases

## Test Types

**Unit Tests:**
- Scope: Single function in isolation
- Approach: Call function with known inputs, verify outputs using `assert`
- Example: `validateFindings()` tests in `findings.test.js` — test all validation paths

**Integration Tests:**
- Scope: Multiple modules working together (e.g., HTTP server + database + QueryEngine)
- Approach: Real temp databases, real Fastify server in test mode (port 0), real file I/O
- Example: `manager.test.js` tests for `scanRepos()` — uses real git repos, real DB, real enrichers

**E2E Tests:**
- Framework: BATS (Bash Automated Testing System) in `tests/bats/`
- Pattern: Shell scripts that invoke CLI commands and assert outputs
- Not Node.js unit tests — separate from `*.test.js` files

## Common Patterns

**Async Testing:**
```javascript
test("scanRepos calls agentRunner and stores results", async () => {
  let agentCalled = false;
  const mockRunner = async () => {
    agentCalled = true;
    return { service_name: "test", services: [...], connections: [], schemas: [] };
  };
  setAgentRunner(mockRunner);

  const result = await scanRepos([testRepoPath], {}, mockQE);

  assert.ok(agentCalled, "agent should have been called");
  assert.ok(result.findings, "should have findings");
});
```

**Error Testing:**
```javascript
test("validateFindings returns valid:false when confidence is invalid value", () => {
  const obj = minimalValid();
  obj.confidence = "medium";  // Invalid — only "high" or "low" allowed
  const result = validateFindings(obj);
  assert.equal(result.valid, false);
  assert.ok(
    result.error.includes("high") || result.error.includes("low"),
    `Expected error about confidence values, got: ${result.error}`,
  );
});

test("buildTestDb throws when migration fails", async () => {
  const badDb = new Database(":memory:");
  // Don't run migrations — trigger migration failure
  assert.throws(
    () => { runMigrations(badDb); },
    /Migration error/,
    "should throw migration error"
  );
});
```

**Temp Directory Cleanup:**
```javascript
test("discovery finds nested services", () => {
  const tmpDir = mkdtempSync(join(tmpdir(), "ligamen-test-"));
  try {
    // Setup: create temp repo structure
    mkdirSync(join(tmpDir, "services", "api"), { recursive: true });
    writeFileSync(join(tmpDir, "services", "api", "package.json"), "{}");

    // Test: run discovery
    const result = discoverNew(tmpDir, []);

    // Assert
    assert.ok(result.some(r => r.path.includes("api")), "should find api service");
  } finally {
    // Cleanup: always remove temp dir
    rmSync(tmpDir, { recursive: true, force: true });
  }
});
```

## Test Isolation

**Database Isolation:**
- Each test that needs a database uses a fresh in-memory instance: `new Database(":memory:")`
- Migrations run fresh per test
- No shared test database across tests

**File System Isolation:**
- Each test creates its own temp directory: `mkdtempSync(join(tmpdir(), "ligamen-test-" + Date.now()))`
- Cleanup happens in `finally` or `after()` hook
- Temp dir names include Date.now() to avoid collisions in parallel test runs

**Module State Isolation:**
- Tests that inject logger/runner call the injection function in `before()` or at test start
- Tests that use enrichers call `clearEnrichers()` in `before()` to remove registered enrichers from prior tests
- See `manager.test.js` for pattern: `clearEnrichers()` called in test setup

---

*Testing analysis: 2026-03-22*
