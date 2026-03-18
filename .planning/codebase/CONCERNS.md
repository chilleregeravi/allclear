# Codebase Concerns

**Analysis Date:** 2026-03-18

## Tech Debt

### Scan Data Integrity — Duplicate Services on Re-scan

**Issue:** Re-scanning a repository appends duplicate service rows instead of updating them. The database enforces UNIQUE(repo_id, name) via migration 004, but the upsert logic does not guarantee safe idempotency across multiple scan cycles.

**Files:**
- `worker/db/migrations/004_dedup_constraints.js` — Adds UNIQUE constraint to services
- `worker/db/query-engine.js` — upsertService() method uses INSERT OR IGNORE conflicting with constraint semantics
- `worker/scan/manager.js` — Triggers re-scans without explicit deduplication on client side

**Impact:**
- Graph shows flattened service state with no version history
- Cross-repo scanning of same service name from different repos creates duplicate nodes
- Potential for inconsistent graph state if scan is interrupted mid-flight

**Fix approach:**
- Enforce scan versioning: each scan creates a versioned snapshot (migration 005 + Phase 28 work)
- Update QueryEngine.upsertService() to use INSERT OR REPLACE instead of INSERT OR IGNORE
- Add explicit transaction boundaries around scan writes to prevent partial updates

**Tracked as:** SCAN-01 through SCAN-04 in requirements

---

### Inline Migration Workaround in pool.js

**Issue:** `getQueryEngineByHash()` contains an inline migration fallback (lines 173-188 in `worker/db/pool.js`) that manually runs migrations when opening a DB by hash instead of using the standard `openDb()` path. This workaround was necessary before migrations 004 and 005 existed.

**Files:** `worker/db/pool.js` lines 173-188

**Impact:**
- Code duplication: migrations logic appears in two places (database.js and pool.js)
- Risk: if migrations are updated in database.js, pool.js inline version may become stale
- Technical debt: adds conditional complexity to getQueryEngineByHash

**Fix approach:**
- Verification: After migrations 004 (dedup_constraints.js) and 005 (scan_versions.js) are confirmed to exist, remove the inline block (lines 173-188) and replace with standard `openDb()` invocation
- Status: Phase 29 plan includes conditional removal with TODO comment if migrations not present

---

### Fire-and-Forget ChromaDB Sync Without Observability

**Issue:** `writeScan()` in `worker/db/database.js` calls `syncFindings()` as fire-and-forget via `.catch()` handler. Errors in ChromaDB sync are logged to stderr but never bubble up to the caller. If ChromaDB is unavailable, the semantic search index silently diverges from SQLite state.

**Files:**
- `worker/db/database.js` line 214 — `.catch()` handler suppresses ChromaDB errors
- `worker/server/chroma.js` — syncFindings() design explicitly never rejects

**Impact:**
- Silent failures: admin cannot determine why semantic search returns empty results
- Index divergence: SQLite has data but ChromaDB is stale/missing
- Debugging difficulty: fire-and-forget pattern means no way to track sync status per scan

**Fix approach:**
- Add a background sync queue with retry logic and exponential backoff
- Emit sync status events (pending, completed, failed) via worker log sink
- Track last_successful_chroma_sync timestamp in database for diagnostics
- Option: make ChromaDB sync blocking for first scan (critical for initial semantic index)

---

## Known Bugs

### Module-Level Singleton Database Instance

**Bug:** `worker/db/database.js` exports a module-level singleton `_db` instance initialized once and reused for all callers. ESM module caching means the same `_db` is shared across tests and runtime, preventing test isolation.

**Symptoms:**
- Tests that modify `_db` state pollute subsequent tests
- Cannot reset database between test suites without restarting the process
- Thread-safety assumptions baked into architecture

**Files:**
- `worker/db/database.js` lines 27-28 — Module singleton pattern
- `worker/db/snapshot.test.js` lines 17-34 — Comments noting singleton isolation issues
- `worker/db/database.test.js` line 14 — Cannot reset module state in single import

**Trigger:**
1. Run `node --test worker/db/snapshot.test.js` followed by another DB test
2. Second test sees residual state from first test
3. Tests pass/fail inconsistently depending on execution order

**Workaround:**
- Use separate temp directories for each test
- Rely on database path hashing to isolate projects
- Cannot fully reset module — only isolation available is via different project roots

**Better Fix:**
- Remove module-level singleton; require callers to pass DB instance
- Use dependency injection for database handle instead of module export
- Refactor QueryEngine constructor to accept a DB instance parameter

---

### Concurrent Read Access and WAL Mode Contention

**Bug:** Multiple processes/workers reading the same SQLite database in WAL mode can create contentious checkpoint operations. `busy_timeout = 5000` (5 seconds) may not be sufficient for long-running graph traversals under load.

**Symptoms:**
- SQLITE_BUSY errors on concurrent impact queries
- Log lines showing fallback to FTS5/SQL when database is locked
- High latency on cross-project queries when multiple workers read simultaneously

**Files:**
- `worker/db/database.js` line 104 — busy_timeout pragma
- `worker/db/pool.js` — Multiple QueryEngine instances may hold readers

**Impact:**
- Agents in different repos querying MCP server can timeout
- Graph queries incomplete when database is locked
- User-facing latency spikes under concurrent access

**Fix approach:**
- Increase busy_timeout to 30000 (30 seconds) for graph traversal workloads
- Add retry logic with exponential backoff for SQLITE_BUSY
- Implement reader pool to reuse connections and reduce contention
- Consider using PRAGMA optimize at startup to improve checkpoint efficiency

---

### MCP Server Per-Call Database Resolution Has No Caching

**Bug:** Phase 29 refactors MCP server to call `resolveDb(project)` per-tool-invocation. Each call to `getQueryEngineByRepo()` scans all project directories and opens temporary read-only DBs, even if the result is already in the pool cache.

**Symptoms:**
- High latency on first query for a new repo name (reads all ~/. allclear/projects/*/impact-map.db)
- Repeated queries to same repo bypass cache due to per-call resolution
- Unnecessary disk I/O for repo name lookups

**Files:**
- `worker/db/pool.js` lines 202-269 — getQueryEngineByRepo scans all projects on each call
- `worker/mcp/server.js` — resolveDb() called per tool invocation

**Impact:**
- MCP tools slow down as more projects accumulate in ~/.allclear
- User perceives latency spike when querying unfamiliar repos
- Scales poorly: O(num_projects) per query

**Fix approach:**
- Implement project directory cache with filesystem watch for new projects
- Cache repo name → project hash mapping in memory
- Invalidate cache only on filesystem changes or periodic refresh
- Add metrics to track cache hit/miss ratio

---

## Security Considerations

### Path Traversal in resolveDb() Project Parameter

**Risk:** `worker/mcp/server.js` `resolveDb()` function accepts absolute paths via `project` parameter. Line 78 checks for `..` pattern but this is a string-based check vulnerable to encoded variants.

**Files:** `worker/mcp/server.js` lines 76-79

**Current mitigation:** Basic string check for `..` substring

**Recommendations:**
- Use `path.normalize()` and verify result is within expected directory
- Reject paths outside `~/.allclear/projects/` directory tree
- Use `path.resolve()` and validate against canonicalized base path
- Pattern: `if (!path.resolve(project).startsWith(path.resolve(allowedBase))) return null;`

---

### Database Readonly Mode Not Enforced on All Paths

**Risk:** MCP server opens databases in `readonly: true` mode, but the inline migration in `getQueryEngineByHash()` opens with `new Database(dbPath)` without readonly flag. This allows writes through the MCP server path if migrations need to run.

**Files:** `worker/db/pool.js` lines 173 — Opens database without readonly flag

**Impact:**
- If migrations are pending, MCP handler can modify the database
- Violates the contract that MCP server never writes
- Allows unintended side effects through tool handlers

**Fix approach:**
- After migrations 004+005 exist (Phase 27/28), remove the inline migration workaround (addresses this risk)
- Until then: explicitly validate readonly mode cannot trigger writes in that code path
- Document assumption: all projects must reach schema v5 before MCP server can read them

---

## Performance Bottlenecks

### Graph Traversal Recursion Depth Causes Full Scan

**Slow operation:** `transitiveImpact()` with `maxDepth: 10` on large graphs executes a recursive CTE that visits all transitive nodes. For a service with 100+ transitive dependencies, this traverses entire subgraph.

**Files:** `worker/db/query-engine.js` lines 190-211 — Recursive SQL CTE

**Cause:**
- The CTE `WITH RECURSIVE impacted AS ...` visits every edge in the dependency graph
- No early termination when target service found
- Graph grows unbounded as new services are discovered

**Improvement path:**
- Add optional `targetServiceId` parameter to stop traversal early
- Implement breadth-first search instead of recursive CTE for large graphs
- Cache transitive closure snapshots periodically
- Add query timeout to prevent runaway queries

---

### FTS5 Search Falls Back to SQL Tier Unnecessarily

**Slow operation:** If FTS5 table has no matches, search falls through to SQL full-table scan. No index on service names or connection paths for SQL tier.

**Files:** `worker/db/query-engine.js` lines 84-142 — Search tier fallback chain

**Cause:**
- SQL tier query `SELECT * FROM services WHERE name LIKE ?` scans entire table
- No index on services.name or connections.path
- FTS5 table may be stale if index not synchronized

**Improvement path:**
- Add index on `services(name)` for faster SQL fallback
- Implement FTS5 sync on every scan to keep index current
- Add query planner analysis to detect missing indexes
- Consider materializing frequently-searched fields

---

### List Projects Enumerates All Directories on Each Call

**Slow operation:** `listProjects()` in `worker/db/pool.js` enumerates all hashes in `~/.allclear/projects/` and opens each database to query repos table.

**Files:** `worker/db/pool.js` lines 77-132

**Cause:**
- Filesystem enumeration O(num_projects)
- Opens readonly connection to each database
- Queries repos table and aggregates stats for display

**Impact:**
- Project switcher dropdown loads slowly as project count grows
- HTTP /api/projects endpoint has high latency

**Improvement path:**
- Cache listProjects result with TTL (5-10 seconds)
- Watch `~/.allclear/projects/` for filesystem changes to invalidate cache
- Implement lazy-load in UI dropdown (load on click, not on page load)

---

## Fragile Areas

### Detail Panel Type Dispatch Routing

**Files:** `worker/ui/modules/detail-panel.js` lines 1-40 (showDetailPanel function)

**Why fragile:**
- Three branches: service, library, infra
- Fallback silently goes to service rendering if type unknown
- Adding new node type (e.g., "container") means finding and updating dispatch in multiple files

**Safe modification:**
- Always check `getNodeType()` return value before dispatch
- Add type guard at top of showDetailPanel: `if (!['service', 'library', 'infra'].includes(nodeType)) { return; }`
- Keep type enum in single place (utils.js)
- Test coverage: each branch tested with explicit type value

**Test coverage gaps:**
- Missing: infra type node doesn't crash when detail panel renders
- Missing: unknown type gracefully handled (no silent service fallthrough)

---

### Scan Manager Error Isolation

**Files:** `worker/scan/manager.js` lines 293-320 (scanRepos loop)

**Why fragile:**
- Error in one repo should not stop scanning others
- Current pattern: `try...catch` wraps individual repo, but incomplete findings not persisted
- Agent invocation failures logged but not communicated back to user

**Safe modification:**
- Always wrap each repo scan in try-catch with error logging
- Persist partial findings even if agent output incomplete
- Return array of `{ repoPath, status, error?, findings? }` instead of flat array
- Never allow one bad repo to poison results of subsequent repos

**Test coverage gaps:**
- Missing: bad agent output for repo 1 does not affect repo 2 scan completion
- Missing: partial findings from incomplete scan are persisted
- Missing: error messages include repo path for debugging

---

### Repo Type Detection Heuristics

**Files:** `worker/scan/manager.js` lines 52-103 (detectRepoType function)

**Why fragile:**
- Relies on file presence heuristics (Chart.yaml for infra, package.json for library vs service)
- False positives: library with start script detected as service
- False negatives: monorepo with Chart.yaml but multiple service packages

**Safe modification:**
- Document assumptions about each heuristic in comments
- Add debug logging to show which indicator matched
- Provide override via `.allclear/config.json` (repoType field)
- Test with monorepo that has multiple indicators

**Test coverage gaps:**
- Missing: Python monorepo with both [project] and [project.scripts]
- Missing: service that exports types but has no start script (incorrectly detected as library)

---

## Scaling Limits

### SQLite Connection Pool Has No Limits

**Resource:** In-memory Map of project root → QueryEngine in `worker/db/pool.js` lines 21

**Current capacity:** Unbounded — adds one entry per unique project root queried

**Limit:**
- Each QueryEngine holds one better-sqlite3 Database instance
- Each Database instance holds connection memory, prepared statement cache, file handles
- On 32-bit system: ~500-1000 concurrent connections before resource exhaustion
- On 64-bit system with 8GB RAM: ~10,000 connections before memory pressure

**Scaling path:**
- Implement LRU cache with max 100 active QueryEngines
- Close least-recently-used connections when pool exceeds limit
- Add pool.size() and pool.stats() for monitoring
- Track connection age and memory usage per project

---

### Worker Process Single-Threaded Event Loop

**Resource:** Node.js event loop processes all HTTP requests, MCP tool calls, and database queries sequentially

**Current capacity:**
- ~100 concurrent agents querying impact graph
- Long-running graph traversal blocks all other requests
- Agents in different repos experience head-of-line blocking

**Limit:**
- Graph traversal with maxDepth: 10 on 500-service graph takes ~500ms
- 100 concurrent queries = 50-second latency for last query
- User-perceived slow graph loads when many agents active

**Scaling path:**
- Implement query queue with priority (impact > search > project list)
- Use Worker threads for graph traversal (CPU-bound) separate from I/O
- Add query timeout and cancellation support
- Implement pagination for large result sets

---

### Chroma Vector Index Not Bounded

**Resource:** ChromaDB collection stores all discovered services in embedding vector space

**Current capacity:**
- Default Chroma in-process instance uses SQLite backend
- Vector storage grows linearly with number of (service, repo) pairs
- Unlimited growth as scans discover new services

**Limit:**
- ~500 services: typical multi-repo environment
- ~50,000 services: large monorepo or 100+ microservice org
- Beyond 50k: vector database search becomes memory-bound

**Scaling path:**
- Archive old scan versions to secondary storage
- Implement retention policy (keep last 10 scans per repo)
- Use external Chroma server with persistent storage
- Implement periodic vector index optimization

---

## Dependencies at Risk

### better-sqlite3 Native Module Dependency

**Risk:** `better-sqlite3` is a native Node addon compiled for specific OS/CPU/Node version. Version mismatch causes runtime failures.

**Impact:**
- Upgrading Node.js version requires rebuild
- Installation failures on CI systems without build tools
- Binary incompatibility on cross-platform development

**Migration plan:**
- Alternative: `sqlite3` (pure JS fallback) — slower but more portable
- Alternative: `@databases/sqlite` — compatibility layer with async API
- Current: better-sqlite3 is required for synchronous writes in scan path
- Action: document Node version constraint (>=20.0.0) and build tool requirement

---

### @modelcontextprotocol/sdk Dependency

**Risk:** MCP SDK is experimental; backward compatibility not guaranteed between versions. Current version pinned to 1.27.1.

**Impact:**
- Breaking API changes may require tool handler rewrites
- SDK versioning not coordinated with Claude releases
- Long-term support unclear

**Migration plan:**
- Monitor SDK release notes for breaking changes
- Pin version and test before upgrades
- Alternative: implement MCP protocol directly (higher maintenance cost)
- Action: subscribe to SDK repository releases

---

### chromadb Python Package Optional Dependency

**Risk:** Chroma requires Python runtime and embedding model. Optional dependency may be missing in production deployments.

**Impact:**
- Missing embedding model silently degrades search to FTS5
- No error in worker startup if Chroma unavailable
- User surprise when semantic search doesn't work

**Migration plan:**
- Make Chroma availability check explicit at startup
- Emit WARNING log if Chroma unavailable
- Document installation: `npm install @chroma-core/default-embed`
- Alternative: Bundle embedding model in Node.js (larger package size)

---

## Missing Critical Features

### Scan Versioning and History

**Problem:** Graph shows only latest scan state. No way to browse previous scans or understand when a service was added/removed.

**Blocks:**
- Impact analysis across time (service outages)
- Debugging sudden graph changes
- Understanding scan progression

**Feature:** Implement scan versioning (tracked as SCAN-03 in v2.1 requirements)
- Each scan creates a snapshot with version ID
- UI can browse historical snapshots
- Queries can target specific version or latest

---

### Service Naming Consistency Enforcement

**Problem:** Agent may discover service as "event-journal" in one scan and "event_journal" in the next, creating duplicate nodes in graph.

**Blocks:**
- Accurate impact analysis (same service has two nodes)
- Graph convergence (drift grows with each scan)
- Semantic search precision

**Feature:** Add naming constraint to agent prompt (tracked as SCAN-04)
- Enforce snake_case or camelCase consistently
- Provide service registry as context to agent
- Validate agent findings against naming rules

---

### Cross-Repo Service Identity

**Problem:** "auth-service" in repo-A and "auth-service" in repo-B are separate nodes in graph, even though they represent the same business service.

**Blocks:**
- Unified impact analysis across repos
- Discovering that repo-B auth-service breaks all downstream consumers

**Feature:** Add cross-repo service identity mapping
- Define "same service across repos" relationship
- Merge duplicate nodes in graph
- Query builder uses identity mapping for correct results

---

## Test Coverage Gaps

### Edge Cases in Scan Input Validation

**Untested area:** `worker/scan/manager.js` buildScanContext() — handling of malformed scan options

**Files:** `worker/scan/manager.js` lines 206-270

**What's not tested:**
- repoPath is absolute path requirement (no relative paths)
- Empty findings array handling
- scanRepos with null or undefined array
- Non-git directories (no .git folder)

**Risk:** Malformed input silently succeeds or crashes with unclear error
- "repo is not a git repository" error message could be clearer
- Null repoPath not validated at function entry

**Priority:** Medium — these are edge cases but no input validation guards

---

### Pool Eviction and Connection Lifecycle

**Untested area:** `worker/db/pool.js` — what happens when same projectRoot opened by two simultaneous callers

**Files:** `worker/db/pool.js` lines 44-70

**What's not tested:**
- Race condition: two threads call getQueryEngine(same projectRoot) simultaneously
- Pool entry is created twice (lost write to Map)
- Database opens twice (better-sqlite3 handles this but creates overhead)

**Risk:** Under load, pool becomes inconsistent
- Memory leaks: duplicate QueryEngine instances not garbage collected
- Unpredictable behavior when pool size exceeds memory budget

**Priority:** High — potential memory/resource leak under concurrent load

---

### Error Path in ChromaDB Sync

**Untested area:** `worker/server/chroma.js` and `worker/db/database.js` integration

**Files:**
- `worker/server/chroma.js` line 10-20
- `worker/db/database.js` line 214

**What's not tested:**
- Chroma connection lost mid-sync (partial upsert)
- Chroma returns 500 error
- Network timeout during vector embedding
- Findings larger than Chroma batch size

**Risk:**
- Index becomes partially updated, diverges from SQLite
- No visibility into sync failures
- Fire-and-forget pattern means caller never sees error

**Priority:** Medium — failures are logged but not alarmed

---

### Graph Traversal Cycle Detection

**Untested area:** `worker/db/query-engine.js` transitiveImpact() recursive CTE

**Files:** `worker/db/query-engine.js` lines 190-211

**What's not tested:**
- Circular dependency: service A → service B → service A
- Self-loop: service A → service A
- Traversal halts correctly when cycle detected

**Risk:**
- Infinite loop if cycle present in connections graph
- CTE with cycle can cause SQLITE_LIMIT_COMPOUND_SELECT exceeded
- User request hangs or crashes worker

**Priority:** High — data integrity issue that can crash worker

---

## Design Friction Points

### Module Caching vs Test Isolation

**Friction:** ESM modules cached at import time make test isolation difficult. Tests cannot reset database state between suites.

**Evidence:**
- `worker/db/snapshot.test.js` lines 17-34 comments acknowledging singleton isolation issues
- `worker/db/database.test.js` line 14 states "since we can't reset module state in a single import"
- Tests use workarounds: different project roots, temp directories

**Impact:**
- Test execution order matters (non-deterministic failures)
- Cannot test error recovery (database state pollution)
- New tests must work around singleton constraints

---

### Fire-and-Forget Pattern vs Error Observability

**Friction:** ChromaDB sync designed as fire-and-forget to prevent SQLite persistence from blocking on ChromaDB. But this sacrifices error visibility and creates divergence risk.

**Evidence:** `worker/db/database.js` line 214: `.catch(err => process.stderr.write(...))`

**Trade-off:**
- Pro: SQLite writes never blocked by ChromaDB availability
- Con: Silent failures, index divergence, no sync status visibility

**Better approach:**
- Sync in background with persistent queue
- Expose sync status in `/api/sync-status` endpoint
- Alert user if index and database diverge

---

### Heuristic-Based Repository Type Detection

**Friction:** Repo type detection relies on file presence heuristics that are error-prone and fragile.

**Evidence:** `worker/scan/manager.js` lines 52-103

**Failures:**
- Monorepo with Chart.yaml but multiple service packages incorrectly typed as infra
- Service that exports types but has no start script incorrectly typed as library
- False positives increase as codebases become more complex

**Better approach:**
- Config-driven classification via `.allclear/config.json`
- Agent-provided hints in scan findings
- Explicit registry of service/library/infra types
- Fallback to heuristics only when config absent

---

## Summary

| Category | Count | Severity |
|----------|-------|----------|
| Tech Debt | 3 | Medium |
| Known Bugs | 3 | High |
| Security | 2 | Medium |
| Performance | 3 | Medium |
| Fragile Areas | 3 | Medium |
| Scaling Limits | 3 | Low |
| Dependencies at Risk | 3 | Low |
| Missing Features | 3 | High |
| Test Gaps | 3 | Medium |
| Design Friction | 3 | Low |

**Total: 32 concerns identified**

**Critical Path Issues:** Module singleton, circular dependency detection, cross-project query caching

**Recommended Next Steps:**
1. Fix graph traversal cycle detection (HIGH priority, risk of worker crash)
2. Implement scan versioning (blocks future features, resolves 3 bugs)
3. Refactor database singleton with dependency injection (improves testability)
4. Add connection pool limits and LRU eviction (prevents resource leaks)

---

*Codebase concerns audit: 2026-03-18*
*AllClear v2.3 — Impact Graph & MCP Server*
