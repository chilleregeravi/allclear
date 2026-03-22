# Phase 74: Scan Bug Fixes - Research

**Researched:** 2026-03-22
**Domain:** Node.js scan pipeline — actor persistence, repo-type detection, CODEOWNERS enrichment
**Confidence:** HIGH

---

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|-----------------|
| SBUG-01 | `persistFindings` checks target against known services before creating actor — eliminates phantom actor hexagons (THE-945) | Bug located in `query-engine.js` line 1064: actor creation block has no known-service guard. Fix is a pre-check `SELECT id FROM services WHERE name = ?` before calling `_stmtUpsertActor`. |
| SBUG-02 | `detectRepoType` correctly classifies service repos with docker-compose.yml; expanded Go/Java/Poetry library detection (THE-955) | Bug located in `manager.js` line 74-79: `docker-compose.yml/yaml` is in `infraIndicators` with no exemption for service repos. Fix is conditional: only treat docker-compose as infra when no service entry-point is present. Go/Java/Poetry library heuristics do not currently exist and must be added. |
| SBUG-03 | CODEOWNERS enricher passes relative service `root_path` to `findOwners` instead of absolute repo path — ownership patterns now match correctly (THE-956) | Bug located in `codeowners.js` line 124: `findOwners(entries, ctx.repoPath)` uses the absolute repo path as file path for matching. The enrichment context holds `service.root_path` (relative path) as `ctx.repoPath` per `enrichment.js` line 38. The fix requires separating repo root discovery from the service path passed to findOwners; both pieces are available in the scan manager at enrichment time. |
</phase_requirements>

---

## Summary

Phase 74 fixes three correctness bugs in the scan pipeline. All three bugs are in pre-existing source files with precise, localized fixes needed. No new modules or migrations are required.

**SBUG-01** (`persistFindings` phantom actors): When a connection has `crossing='external'`, `persistFindings` unconditionally creates an actor row for the target name. If that target is already a known service (scanned in a prior or concurrent scan), a phantom hexagon node appears in the graph UI alongside the real service node. The fix is a single DB look-up before the actor creation block.

**SBUG-02** (`detectRepoType` misclassification): The current heuristic places `docker-compose.yml` and `docker-compose.yaml` in the `infraIndicators` array — they are checked first and immediately return `"infra"`. A Node.js or Python service repo that uses docker-compose for local dev will be misclassified. Additionally, Go and Java library repos lack any classification heuristic and fall through to the default `"service"` return. The fix requires reordering the detection logic: check for a service entry-point before treating docker-compose as an infra signal, and add Go/Java/Poetry library heuristics.

**SBUG-03** (CODEOWNERS absolute-path bug): The enrichment runner (`enrichment.js`) builds the enricher context from the service row: `ctx.repoPath = service.root_path`. In the DB, `root_path` is the value the agent reported — a relative path like `services/api`. `createCodeownersEnricher` calls `parseCODEOWNERS(ctx.repoPath)` (which needs the repo root to probe `.github/CODEOWNERS`) and `findOwners(entries, ctx.repoPath)` (which uses the same value as the file path for matching). The repo-root probe will fail because `ctx.repoPath` is relative. The fix is to pass the absolute repo path separately so `parseCODEOWNERS` receives the repo root, and `findOwners` receives the relative `root_path`.

**Primary recommendation:** Fix each bug in its source file with a surgical, targeted change; add a focused test for each fix alongside the existing test files.

---

## Standard Stack

### Core

| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| better-sqlite3 | (existing in node_modules) | In-memory and file DB for tests | Already the project's SQLite driver |
| node:test | Node.js built-in | Test runner for JS worker tests | Established pattern in codeowners.test.js and scan tests |
| node:assert/strict | Node.js built-in | Assertions | Established pattern in all existing .test.js files |
| picomatch | ^4.0.3 (existing) | CODEOWNERS glob matching | Locked decision in STATE.md; imported via createRequire |

No new dependencies are required for this phase.

---

## Architecture Patterns

### Relevant Source File Map

```
plugins/ligamen/worker/
├── db/
│   ├── query-engine.js          # SBUG-01: persistFindings() at line 1064
│   └── query-engine-actors.test.js  # Existing actor tests — add new test here
├── scan/
│   ├── manager.js               # SBUG-02: detectRepoType() at line 72-127
│   ├── codeowners.js            # SBUG-03: createCodeownersEnricher() at line 117
│   ├── codeowners.test.js       # Existing codeowners tests — add new test here
│   ├── enrichment.js            # Enrichment ctx contract (ctx.repoPath = service.root_path)
│   └── manager.test.js          # detectRepoType not yet tested here
```

### Pattern 1: Known-Service Guard Before Actor Creation (SBUG-01)

**What:** Before creating an actor row in `persistFindings`, check whether the connection target name already exists in the `services` table. If it does, skip actor creation — the connection already links to the real service node via `targetId`.

**When to use:** Every time `crossing === 'external'` is detected in the connection loop.

**Location:** `query-engine.js`, inside the `persistFindings` method, immediately before the `_stmtUpsertActor.run(...)` call.

**Fix skeleton:**
```javascript
// Source: analysis of query-engine.js lines 1061-1082
if (conn.crossing === "external" && this._stmtUpsertActor && this._stmtGetActorByName) {
  const actorName = conn.target;

  // SBUG-01 guard: skip actor creation if target is a known service
  const knownService = this._db
    .prepare("SELECT id FROM services WHERE name = ?")
    .get(actorName);
  if (knownService) {
    // Target is a real service — no actor hexagon needed
  } else {
    this._stmtUpsertActor.run({ name: actorName, kind: "system", direction: "outbound", source: "scan" });
    const actorRow = this._stmtGetActorByName.get(actorName);
    if (actorRow) {
      this._stmtUpsertActorConnection.run({ actor_id: actorRow.id, service_id: sourceId, direction: "outbound", protocol: conn.protocol || null, path: conn.path || null });
    }
  }
}
```

Note: `_stmtGetActorByName` already queries by name globally (`SELECT id FROM actors WHERE name = ?`) — the new guard similarly does a global `services` look-up, which is the right scope since actors represent truly external systems that are not scanned repos.

### Pattern 2: docker-compose Exemption in detectRepoType (SBUG-02)

**What:** Move docker-compose from a hard infra indicator to a conditional one. Only classify as infra when no service entry-point is present. Add Go/Java/Poetry library heuristics before the default `"service"` return.

**Current bug flow:**
```
detectRepoType(repoPath):
  → infraIndicators includes docker-compose.yml/yaml
  → existsSync(join(repoPath, 'docker-compose.yml')) → true for many service repos
  → return "infra"  ← WRONG for service repos using docker-compose for local dev
```

**Fixed flow:**
```
detectRepoType(repoPath):
  → Check Kubernetes/Helm/Terraform indicators (no docker-compose) → return "infra" if found
  → Check for service entry-point presence (package.json scripts.start, main.py, main.go, etc.)
  → If service entry-point present AND docker-compose present → not infra (it's a service with local dev setup)
  → If docker-compose present AND no service entry-point → return "infra"
  → Check library heuristics (existing Node.js/Python/Rust + new Go/Java/Poetry)
  → Default: return "service"
```

**New Go library heuristic:** A Go repo with only `_test.go` and library files but no `main.go` in root or `cmd/` directory is a library. Presence of `cmd/` directory with `main.go` = service/binary.

**New Java library heuristic:** `pom.xml` with `<packaging>jar</packaging>` and no `<mainClass>` in build config = library. Alternatively, absence of `src/main/java/**/Application.java` or `*Main.java` indicates library.

**New Poetry (Python) library heuristic:** `pyproject.toml` with `[tool.poetry]` but no `[tool.poetry.scripts]` section = library. This is the Poetry-specific equivalent of the existing `[project.scripts]` check.

### Pattern 3: Separate Repo Root from Service Root_Path (SBUG-03)

**What:** The CODEOWNERS enricher needs two distinct paths: (1) the absolute repo root to locate the CODEOWNERS file, and (2) the relative service `root_path` for matching against CODEOWNERS patterns.

**Root cause:** `enrichment.js` sets `ctx.repoPath = service.root_path` (line 38), which is the relative path stored by the agent. `parseCODEOWNERS(ctx.repoPath)` then probes for `.github/CODEOWNERS` at a relative path that doesn't exist as an absolute filesystem location.

**The fix has two parts:**

1. In `manager.js` (the scan loop), pass the absolute repo path alongside the service when calling `runEnrichmentPass`. The enrichment runner builds ctx from `service.root_path` — it needs a separate `repoAbsPath` field.

2. In `codeowners.js`, update `createCodeownersEnricher` to call `parseCODEOWNERS(ctx.repoAbsPath)` (for file system access) and `findOwners(entries, service.root_path)` (for pattern matching).

**Data available in manager.js at enrichment call site:**
```javascript
// manager.js line 425-429
const services = queryEngine._db
  .prepare('SELECT id, root_path, language, boundary_entry FROM services WHERE repo_id = ?')
  .all(repo.id);
for (const service of services) {
  await runEnrichmentPass(service, queryEngine._db, _logger);
}
// `repoPath` is in scope here — pass it to runEnrichmentPass
```

**Updated enrichment.js ctx contract (additive — no breaking changes):**
```javascript
// enrichment.js — add repoAbsPath to ctx alongside existing fields
const ctx = {
  serviceId: service.id,
  repoPath: service.root_path,   // keep: relative path for pattern matching
  repoAbsPath: repoAbsPath,      // new: absolute repo root for file system probing
  language: service.language ?? null,
  entryFile: service.boundary_entry ?? null,
  db,
  logger,
};
```

**Updated codeowners.js enricher:**
```javascript
// Use repoAbsPath for file probe, repoPath (relative) for pattern match
const entries = parseCODEOWNERS(ctx.repoAbsPath ?? ctx.repoPath);
const owners = findOwners(entries, ctx.repoPath);
```

---

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Glob pattern matching for CODEOWNERS | Custom regex | picomatch (already present) | Already handles matchBase, anchored patterns, trailing-slash dirs — complex edge cases are covered |
| Actor deduplication | Custom dedup logic | Existing ON CONFLICT upsert in `_stmtUpsertActor` | The upsert already handles re-runs without duplicates |
| Service name resolution | New lookup | Existing `_resolveServiceId` | Already handles same-repo and cross-repo resolution |

---

## Common Pitfalls

### Pitfall 1: Prepared Statement Prepared Outside the Guard (SBUG-01)

**What goes wrong:** Adding a new inline `this._db.prepare(...)` inside `persistFindings` for the known-service check is fine functionally but creates a statement prepared on every call in the connection loop. Under heavy scan load with many connections, this adds unnecessary overhead.

**How to avoid:** Prepare the known-service check statement in the QueryEngine constructor alongside `_stmtGetActorByName` and similar statements. Store it as `this._stmtCheckKnownService`. Wrap in the same `try/catch` block that guards actor statements (migration 008 check).

**Warning signs:** The statement preparation code block in the constructor (around line 376) already has this pattern — follow it.

### Pitfall 2: Broad docker-compose Check Breaks Legitimate Infra Repos (SBUG-02)

**What goes wrong:** Removing docker-compose from infra detection entirely would break pure-infra repos that use docker-compose as their primary deployment descriptor (e.g., a repo whose only job is running services with docker-compose, no application code).

**How to avoid:** Keep docker-compose as an infra signal but add an exemption when a service entry-point is present. The entry-point check must cover multiple languages: `package.json` with start/serve scripts, `main.py`, `main.go`, `cmd/` directory, `src/main/java/` directory, `Makefile` with server targets.

**Warning signs:** A test that asserts an infra repo with only docker-compose still returns `"infra"`.

### Pitfall 3: Breaking Existing Enricher Tests with ctx Contract Change (SBUG-03)

**What goes wrong:** Adding `repoAbsPath` to the enrichment ctx could break existing enricher tests that construct ctx manually without this field.

**How to avoid:** Use optional access `ctx.repoAbsPath ?? ctx.repoPath` in `parseCODEOWNERS` call — falls back to `ctx.repoPath` when `repoAbsPath` is absent (test contexts). Existing tests pass `repoPath` pointing to an actual tmpDir, which doubles as a valid absolute path — those tests continue to work with the fallback.

**Warning signs:** Existing `codeowners.test.js` tests failing after the enricher change.

### Pitfall 4: Go/Java Library Detection Over-Broad (SBUG-02)

**What goes wrong:** Checking only for absence of `main.go` as Go library signal would misfire on service repos that keep main in a subdirectory (e.g., `cmd/server/main.go` — a common Go convention).

**How to avoid:** For Go, check for absence of `main.go` in root AND absence of `cmd/` directory. For Java, check for absence of `*Main.java` or `Application.java` patterns. Use `readdirSync` with depth-1 check for `cmd/` directory existence.

---

## Code Examples

Verified patterns from source code analysis:

### SBUG-01: Prepared-Statement Constructor Pattern (existing in query-engine.js)
```javascript
// Source: query-engine.js lines 376-401 — existing actor statement initialization
this._stmtCheckKnownService = null;
try {
  // Add alongside _stmtUpsertActor, _stmtGetActorByName
  this._stmtCheckKnownService = db.prepare(
    "SELECT id FROM services WHERE name = ?"
  );
} catch {
  // actors table guard — same catch block as other actor statements
  this._stmtCheckKnownService = null;
}
```

### SBUG-02: Existing Library Heuristic Pattern (existing in manager.js)
```javascript
// Source: manager.js lines 91-123 — existing Node.js/Python/Rust library detection
// Go library pattern to add (same structure):
try {
  const goFiles = readdirSync(repoPath);
  const hasMainGo = goFiles.includes('main.go');
  const hasCmdDir = existsSync(join(repoPath, 'cmd'));
  if (!hasMainGo && !hasCmdDir) {
    const hasGoMod = goFiles.includes('go.mod');
    if (hasGoMod) return "library";
  }
} catch { /* ignore */ }
```

### SBUG-03: Enrichment Runner Call Site (existing in manager.js)
```javascript
// Source: manager.js lines 425-430 — where repoPath is in scope
const services = queryEngine._db
  .prepare('SELECT id, root_path, language, boundary_entry FROM services WHERE repo_id = ?')
  .all(repo.id);
for (const service of services) {
  // repoPath is the outer loop variable (absolute path to scanned repo)
  await runEnrichmentPass(service, queryEngine._db, _logger, repoPath);
  //                                                           ^^^^^^^^ add this
}
```

---

## Validation Architecture

### Test Framework

| Property | Value |
|----------|-------|
| Framework | node:test (built-in) + assert |
| Config file | none — files run directly with `node --test` |
| Quick run command | `node --test plugins/ligamen/worker/db/query-engine-actors.test.js` |
| Full suite command | `node --test plugins/ligamen/worker/db/query-engine-actors.test.js && node --test plugins/ligamen/worker/scan/codeowners.test.js && node plugins/ligamen/worker/scan/manager.test.js` |

Note: `query-engine-actors.test.js` uses a custom runner (not `node:test` describe/it) — run with `node` not `node --test`.

### Phase Requirements to Test Map

| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| SBUG-01 | When target of external connection is a known service, no actor row is created | unit | `node plugins/ligamen/worker/db/query-engine-actors.test.js` | Wave 0: add test to existing file |
| SBUG-02 | Node.js service with docker-compose.yml returns "service" not "infra" | unit | `node --test plugins/ligamen/worker/scan/manager.test.js` | Wave 0: add tests to existing file |
| SBUG-02 | Go repo without main.go or cmd/ directory returns "library" | unit | `node --test plugins/ligamen/worker/scan/manager.test.js` | Wave 0: add tests to existing file |
| SBUG-02 | Java repo without Main/Application class returns "library" | unit | `node --test plugins/ligamen/worker/scan/manager.test.js` | Wave 0: add tests to existing file |
| SBUG-02 | Pure docker-compose infra repo (no service entry-point) still returns "infra" | unit | `node --test plugins/ligamen/worker/scan/manager.test.js` | Wave 0: add tests to existing file |
| SBUG-03 | CODEOWNERS enricher matches relative root_path, not absolute repo path | unit | `node --test plugins/ligamen/worker/scan/codeowners.test.js` | Wave 0: add test to existing file |
| SBUG-03 | parseCODEOWNERS called with absolute repo root (finds .github/CODEOWNERS) | unit | `node --test plugins/ligamen/worker/scan/codeowners.test.js` | Wave 0: add test to existing file |

### Sampling Rate

- **Per task commit:** Run the specific test file for the changed module
- **Per wave merge:** Run all three test files listed in Full suite command
- **Phase gate:** Full suite green before `/gsd:verify-work`

### Wave 0 Gaps

- [ ] New test case in `plugins/ligamen/worker/db/query-engine-actors.test.js` — SBUG-01 guard test (target is known service → no actor created)
- [ ] New tests in `plugins/ligamen/worker/scan/manager.test.js` — SBUG-02 docker-compose exemption + Go/Java/Poetry library detection (check if file exists first)
- [ ] New test case in `plugins/ligamen/worker/scan/codeowners.test.js` — SBUG-03 correct relative root_path matching

---

## State of the Art

| Old Behavior | Fixed Behavior | Impact |
|--------------|----------------|--------|
| docker-compose.yml → always "infra" | docker-compose + service entry-point → "service" | Node.js/Python services with local dev setup classified correctly |
| actor created for any external crossing target | actor skipped when target is a known service | No phantom hexagons in graph for cross-scanned services |
| findOwners(entries, ctx.repoPath) with absolute path | findOwners(entries, service.root_path) with relative path | CODEOWNERS team ownership populated for relative patterns |
| No Go/Java library detection | Go: no main.go+cmd/ → library; Java: no Main/Application class → library | Multi-language library repos classified correctly |

---

## Open Questions

1. **manager.test.js existence and content**
   - What we know: The file is listed in the scan directory (`ls` output shows `manager.test.js`)
   - What's unclear: Whether `detectRepoType` is exported and tested there, or if it's only tested indirectly via `scanRepos`
   - Recommendation: Read `manager.test.js` at plan time to determine whether to add tests inline or export `detectRepoType` for direct testing. If it's not exported, export it.

2. **Java library detection heuristic depth**
   - What we know: The requirement says "Go or Java project containing only library-type files is classified as a library"
   - What's unclear: Java library detection via pom.xml packaging vs file pattern scan — pom.xml is XML (needs string matching, not JSON.parse); Spring Boot adds complexity
   - Recommendation: Use file-presence heuristic (absence of `*Main.java` / `Application.java` via `readdirSync` + recursive check in `src/main/java/`) rather than XML parse. Simpler and more reliable.

3. **runEnrichmentPass signature change**
   - What we know: Adding `repoAbsPath` as a 4th parameter to `runEnrichmentPass` is the cleanest path
   - What's unclear: Whether any other callers of `runEnrichmentPass` exist outside manager.js
   - Recommendation: Search for all `runEnrichmentPass` call sites before changing the signature. If only called from manager.js, the change is safe.

---

## Sources

### Primary (HIGH confidence)

- Direct source code analysis of `plugins/ligamen/worker/db/query-engine.js` — `persistFindings` actor creation block, `_resolveServiceId`, prepared statement pattern
- Direct source code analysis of `plugins/ligamen/worker/scan/manager.js` — `detectRepoType` infra/library heuristics, enrichment call site
- Direct source code analysis of `plugins/ligamen/worker/scan/codeowners.js` — `createCodeownersEnricher` bug on line 124
- Direct source code analysis of `plugins/ligamen/worker/scan/enrichment.js` — ctx contract, `ctx.repoPath = service.root_path` on line 38
- `.planning/REQUIREMENTS.md` — SBUG-01, SBUG-02, SBUG-03 definitions with Jira references
- `.planning/STATE.md` — Locked decisions: picomatch ^4.0.3 via createRequire, v5.3.0 CODEOWNERS enrichment architecture

### Secondary (MEDIUM confidence)

- Existing test files (`query-engine-actors.test.js`, `codeowners.test.js`) — reveal test patterns and test helper structure for new tests

---

## Metadata

**Confidence breakdown:**
- Bug locations: HIGH — all three bugs located precisely in source via direct code read
- Fix approach: HIGH — all fixes are localized, no architectural uncertainty
- Test approach: HIGH — existing test files provide patterns to follow exactly
- Go/Java library heuristics: MEDIUM — heuristics are reasonable but may need refinement for edge cases (monorepos, non-standard layouts)

**Research date:** 2026-03-22
**Valid until:** 2026-04-22 (stable codebase, no fast-moving external dependencies)
