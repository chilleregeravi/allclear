# Codebase Concerns

**Analysis Date:** 2026-03-22

## Tech Debt

**SBUG-02: Docker-Compose Repo Type Detection**
- Issue: Docker-compose repos are classified as "infra" by default, but may actually be local dev environments for services. Currently requires explicit service entry-point detection (start/serve scripts, main.py, main.go) to avoid false classification.
- Files: `plugins/ligamen/worker/scan/manager.js` (lines 150-156), `plugins/ligamen/worker/scan/manager.test.js` (lines 1054-1068)
- Impact: Services with docker-compose for local development could be mislabeled as infrastructure, affecting dependency graph accuracy and scan categorization
- Fix approach: Enhance entry-point detection to check for common service patterns in docker-compose.yml itself (exposed ports, service definitions), or make classification configurable per-repo

**SBUG-03: Dual Path Handling in CODEOWNERS Enricher**
- Issue: CODEOWNERS enricher uses `ctx.repoAbsPath` (absolute path) for file system probing but falls back to `ctx.repoPath` (relative service path) when absolute path unavailable. This inconsistency creates maintenance burden in enrichers.
- Files: `plugins/ligamen/worker/scan/codeowners.js` (lines 119-125), `plugins/ligamen/worker/scan/enrichment.js` (lines 34, 40)
- Impact: Test contexts without `repoAbsPath` may fail to locate CODEOWNERS files correctly; production behavior depends on context type
- Fix approach: Standardize enricher context to always provide `repoAbsPath`, or add a helper method to resolve absolute paths from relative service paths

**SREL-01: Incremental Scan Constraint Injection**
- Issue: Incremental scans append a hard constraint block to agent prompts to focus on changed files. When diff is empty, scan is skipped entirely (marked as "incremental-noop"), but the mechanism is tightly coupled to prompt generation.
- Files: `plugins/ligamen/worker/scan/manager.js` (lines 15-23)
- Impact: Changes to agent prompt structure could break constraint injection; difficult to test constraint effectiveness independently
- Fix approach: Extract constraint generation into a separate, testable function; document expected agent behavior for incremental scans

## Known Bugs

**OpenDB Readonly Connection Pragma Issue**
- Symptoms: Journal mode cannot be set on read-only database connections (WAL requires write access)
- Files: `plugins/ligamen/worker/db/pool.js` (lines 96, 237)
- Trigger: Calling `db.pragma("journal_mode = WAL")` on a database opened with `{ readonly: true }`
- Workaround: Code correctly avoids setting pragmas on readonly connections (see comments at lines 96, 237), but this constraint is fragile and easy to miss

**ChromaDB Initialization Timing**
- Symptoms: ChromaDB client constructor does not throw errors; errors surface on `.heartbeat()` call, which is asynchronous and can fail silently in some contexts
- Files: `plugins/ligamen/worker/server/chroma.js` (lines 92-97)
- Trigger: Network outage or unreachable ChromaDB host after process startup
- Workaround: Heartbeat failure sets `_chromaAvailable = false`, but errors are only logged if logger is set; silent failures possible if logging disabled

## Security Considerations

**Credential Rejection in Auth/DB Extraction**
- Risk: The auth-db enricher uses length-based and regex-based credential rejection (values >40 chars, tokens that look like JWTs). Attackers could craft mechanism names that bypass these checks.
- Files: `plugins/ligamen/worker/scan/enrichment/auth-db-extractor.js` (lines 43-57)
- Current mitigation: Basic heuristics reject obvious credential patterns (Bearer tokens, JWT bodies, URLs with passwords)
- Recommendations:
  - Add entropy-based detection (reject high-entropy strings)
  - Log extracted values that narrowly pass rejection (e.g., 38-40 chars)
  - Consider scanning enriched output for common secret patterns before persistence

**Path Traversal Protection**
- Risk: MCP server `resolveDb()` function uses basic path traversal guard (`project.includes('..')`) which is insufficient against sophisticated attacks
- Files: `plugins/ligamen/worker/mcp/server.js` (lines 79-80)
- Current mitigation: Rejects paths containing `..`, handles absolute paths via separate code path
- Recommendations:
  - Use `path.normalize()` and verify result starts with expected base directory
  - Reject symlinks that could escape project root
  - Add validation that resolved path is within `~/.ligamen/projects/`

**Database WAL Mode Concurrency**
- Risk: WAL (Write-Ahead Logging) with `busy_timeout = 5000` can still produce SQLITE_BUSY errors under high concurrent write load, but no backoff/retry mechanism exists
- Files: `plugins/ligamen/worker/db/database.js` (lines 100-104)
- Current mitigation: 5-second busy timeout, foreign keys enabled, NORMAL synchronous mode
- Recommendations:
  - Implement exponential backoff retry (3 attempts, 100-500ms) for SQLITE_BUSY in query wrapper
  - Add metrics/logging for SQLITE_BUSY occurrences to detect contention
  - Consider read-only query routing to avoid write lock conflicts

## Performance Bottlenecks

**Large File Scan in Auth/DB Extraction**
- Problem: Auth/DB enricher recursively scans entire service directory without early termination. No file size limits, depth limits, or exclusion of build artifacts
- Files: `plugins/ligamen/worker/scan/enrichment/auth-db-extractor.js` (no explicit recursion limit)
- Cause: `readdirSync` traversal in extractAuthAndDb visits every file; excluded patterns only apply post-traversal
- Improvement path:
  - Add pre-traversal exclusion list (node_modules, build/, dist/, .git, vendor/)
  - Implement depth limit (max 8 levels)
  - Skip files larger than 1MB
  - Cache directory traversal results per repo

**Transitive Dependency Traversal Depth**
- Problem: Impact queries with `transitive=true` perform recursive SQL queries without depth limit, potentially causing full-table scans on large dependency graphs
- Files: `plugins/ligamen/worker/db/query-engine.js` (impact/affected query methods)
- Cause: No explicit LIMIT on recursion depth; query planner may explore exponential paths
- Improvement path:
  - Limit transitive traversal to depth 5-7 (configurable)
  - Add query timeout (30s) for transitive queries
  - Implement breadth-first instead of depth-first traversal
  - Cache transitive closure results per service

**ChromaDB Sync Fire-and-Forget**
- Problem: `syncFindings()` is async but never awaited; large batches of findings could queue up during peak scan activity
- Files: `plugins/ligamen/worker/server/chroma.js` (syncFindings export)
- Cause: Fire-and-forget design prioritizes scan speed over sync guarantee; no backpressure mechanism
- Improvement path:
  - Add queue size limit with warning logs
  - Implement batch collection (e.g., sync every 100 findings or 5s)
  - Return a promise that resolves when ChromaDB write confirmed (optional for callers)
  - Monitor unresolved sync promises in logs

**FTS5 Search Query Compilation**
- Problem: FTS5 queries are compiled per call without caching; `search()` function builds three separate prepared statements per query
- Files: `plugins/ligamen/worker/db/query-engine.js` (lines 84-130)
- Cause: No prepared statement cache; three-tier fallback means up to 9 statement compilations per search
- Improvement path:
  - Cache prepared statements using `db.prepare(...).bind()`
  - Implement LRU cache for FTS5 normalized queries
  - Batch multiple searches in single database transaction

## Fragile Areas

**Agent Output Parsing**
- Files: `plugins/ligamen/worker/scan/findings.js`
- Why fragile: Depends on specific JSON block markers in agent output; any variation in Claude's formatting breaks parsing. No graceful degradation if block is malformed.
- Safe modification:
  - Always test changes against real agent output samples (stored in test fixtures)
  - Add multiple parsing strategies (try JSON block first, then fenced code block, then raw JSON)
  - Log parse failures with raw output for debugging
- Test coverage: Agent output parsing has unit tests but lacks integration tests with actual agent responses

**Module-Level Enricher Registration**
- Files: `plugins/ligamen/worker/scan/manager.js` (lines 36-41)
- Why fragile: Enrichers are registered at module load time (OWN-01, AUTHDB-01). If registration order matters or if enrichers have initialization side effects, order dependencies are hidden.
- Safe modification:
  - Document enricher initialization requirements
  - Add explicit ordering (e.g., codeowners must run before auth-db if they share metadata)
  - Consider lazy-loading enrichers or explicit registration in scan initialization
- Test coverage: Enricher execution order tested in manager.test.js but registration order assumed stable

**SQLite Journal Mode Edge Cases**
- Files: `plugins/ligamen/worker/db/pool.js` (lines 95-96, 236-237, 174-176)
- Why fragile: Journal mode pragma cannot be set on readonly connections. Code works around this but relies on careful ordering of `new Database()` and `db.pragma()` calls.
- Safe modification:
  - Create a helper function `openDbReadWrite()` vs `openDbReadOnly()` to encapsulate pragma rules
  - Document which pragmas require read-write vs read-only connections
  - Add unit tests specifically for pragma safety on different connection modes
- Test coverage: No explicit tests for pragma safety; only implicit coverage through integration tests

**Database Pool Concurrency**
- Files: `plugins/ligamen/worker/db/pool.js` (entire file)
- Why fragile: Pool uses simple `Map` for caching without synchronization. Multiple projects opening DBs simultaneously could create race conditions.
- Safe modification:
  - Document that pool is not thread-safe (Node.js is single-threaded, but Worker threads could cause issues)
  - Add reentrancy guard (e.g., flag to prevent concurrent getQueryEngine calls)
  - Lock opened DB path to prevent duplicate opens
- Test coverage: No concurrent access tests; single-threaded tests only

**Query Engine Search Fallback Chain**
- Files: `plugins/ligamen/worker/db/query-engine.js` (lines 59-140)
- Why fragile: Three-tier search (ChromaDB -> FTS5 -> SQL) has different result formats and scoring. If one tier fails, fallback may return inconsistent results.
- Safe modification:
  - Normalize all result formats (score, type, metadata) at each tier
  - Test each tier independently (skipChroma, skipFts5 options exist but untested)
  - Document expected result order and how scores compare across tiers
- Test coverage: Integrated tests exist but individual tier tests missing

## Scaling Limits

**Single Database File Per Project**
- Current capacity: SQLite handles ~10GB files efficiently on modern hardware (test suite uses small DBs)
- Limit: Dependency graphs for very large monorepos (1000+ services) may approach SQLite row limits (theoretically unlimited, but query performance degrades)
- Scaling path:
  - Shard by repo (separate DB per repo) with federation queries
  - Implement archive/pruning strategy for old scan data
  - Consider moving to PostgreSQL for >500 services/project

**Memory Usage During Large Scans**
- Current capacity: Agent output parsing and enrichment runs in-memory; findings array not paginated
- Limit: Scans with 10,000+ findings could consume 100MB+ RAM during processing
- Scaling path:
  - Stream findings to database during discovery (write-as-you-parse)
  - Implement pagination in enrichment pass (process 100 findings at a time)
  - Use generator functions to defer parsing until persistence

**HTTP Request Handling Under Load**
- Current capacity: Single Fastify instance, default connection limits
- Limit: 100+ concurrent impact queries could queue or timeout
- Scaling path:
  - Add rate limiting per project (e.g., 10 queries/sec per project)
  - Implement query result caching (30-minute TTL for static queries)
  - Spawn worker pool for CPU-intensive queries (transitive impact)

## Dependencies at Risk

**better-sqlite3 Native Binding**
- Risk: Native compilation required on install; breaks on unsupported platforms (Alpine Linux, Windows ARM)
- Impact: Plugin fails to load on platforms where native binding unavailable
- Migration plan: Provide Docker image with pre-built bindings, or support fallback to sql.js (pure JS SQLite)

**chromadb Optional Dependency**
- Risk: @chroma-core/default-embed is optional; if installed globally but incompatible version, silent failures
- Impact: ChromaDB may silently fail to initialize if embedding model unavailable
- Migration plan: Make chroma truly optional with clear error messages; consider bundling embedding model

## Missing Critical Features

**Scan Cancellation**
- Problem: Once started, scans cannot be interrupted. Long-running agent invocations block the UI.
- Blocks: Users cannot stop scans that discover unexpected repos (no kill/abort tool)
- Recommendation: Implement cancellation token in scan manager; expose `/cancel` endpoint in HTTP worker

**Scan Resumption**
- Problem: If scan crashes mid-way, entire scan must be restarted. No checkpoint/resume mechanism.
- Blocks: Scanning large monorepos (100+ repos) may fail midway with no recovery path
- Recommendation: Checkpoint scan state after each repo (write to DB); implement `--resume` flag in scan manager

**Query Result Pagination**
- Problem: Impact queries return all results unbounded; UI crashes on very large result sets (1000+ connections)
- Blocks: Cannot explore dependencies in large graphs interactively
- Recommendation: Add `limit` and `offset` parameters to all query functions; implement cursor-based pagination

**Concurrent Scan Protection**
- Problem: Two users can start scans on same project simultaneously, creating duplicate/conflicting data
- Blocks: Multi-user environments where multiple agents access same project DB
- Recommendation: Implement project lock (check for active scan); queue concurrent scans or reject with clear message

## Test Coverage Gaps

**Journal Mode Pragma Ordering**
- What's not tested: Correct pragma ordering on readonly vs read-write connections
- Files: `plugins/ligamen/worker/db/pool.js`, `plugins/ligamen/worker/db/database.js`
- Risk: Changes to pragma application could silently break on readonly connections without test failure
- Priority: High (affects all read operations)

**FTS5 Search Fallback Tiers**
- What's not tested: Each search tier (ChromaDB, FTS5, SQL) individually; only integration tests exist
- Files: `plugins/ligamen/worker/db/query-engine.js`
- Risk: Breaking changes to one tier not caught until production
- Priority: Medium (fallback chain well-tested overall)

**Concurrent Database Access**
- What's not tested: Multiple queries/writes to same DB simultaneously (e.g., scan write + UI read)
- Files: `plugins/ligamen/worker/db/pool.js`, `plugins/ligamen/worker/db/database.js`
- Risk: Race conditions in WAL mode not caught by single-threaded tests
- Priority: High (affects production under load)

**Agent Output Parsing Edge Cases**
- What's not tested: Malformed JSON blocks, nested braces, escaped quotes in agent output
- Files: `plugins/ligamen/worker/scan/findings.js`
- Risk: Agent output format changes could silently fail parsing; "incremental-noop" results hide parse errors
- Priority: High (core scanning functionality)

**Enricher Failure Cascading**
- What's not tested: Individual enricher failures and their impact on subsequent enrichers
- Files: `plugins/ligamen/worker/scan/enrichment.js`, `plugins/ligamen/worker/scan/manager.js`
- Risk: One enricher throwing could silently skip all downstream enrichers
- Priority: Medium (enrichment is best-effort but data loss risk)

**ChromaDB Initialization Failure Modes**
- What's not tested: Network timeouts, DNS failures, authentication errors during heartbeat
- Files: `plugins/ligamen/worker/server/chroma.js`
- Risk: Silent failures if logging disabled; unclear why ChromaDB unavailable
- Priority: Medium (gracefully falls back but poor observability)

---

*Concerns audit: 2026-03-22*
